// A client of the daemon: requests over the socket, and the attached conversation's
// transcript, kept by applying the daemon's view operations.
import { setTimeout as sleep } from "node:timers/promises";
import type { Context } from "@earendil-works/chord/context";
import { applyImmutable } from "@earendil-works/chord/delta";
import {
	type ConversationId,
	ConversationTranscript,
	type ConversationView,
	type TranscriptView,
} from "@earendil-works/pi-durable";
import { WebSocket } from "ws";
import {
	type AttachTarget,
	type Event,
	type Method,
	type Methods,
	PROTOCOL_VERSION,
	type ServerMessage,
} from "./protocol.ts";

/** The daemon answered a request with an error, as opposed to the connection failing. */
export class DaemonError extends Error {}

export class PierClient {
	readonly #socket: WebSocket;
	readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	readonly #listeners = new Set<(event: Event) => void>();
	#next = 1;
	/** Settles when the connection closes, from either side. */
	readonly closed: Promise<void>;

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		// A socket error (the daemon was killed mid-write) is followed by `close`, which is
		// what callers watch; without a listener, ws would throw it out of the process.
		socket.on("error", () => {});
		socket.on("message", (data) => {
			const message = JSON.parse(data.toString()) as ServerMessage;
			if ("event" in message) {
				for (const listener of this.#listeners) listener(message);
				return;
			}
			const pending = this.#pending.get(message.id);
			if (pending === undefined) return;
			this.#pending.delete(message.id);
			if ("error" in message) pending.reject(new DaemonError(message.error.message));
			else pending.resolve(message.result);
		});
		this.closed = new Promise((resolve) => {
			socket.once("close", () => {
				for (const pending of this.#pending.values()) pending.reject(new Error("The daemon closed the connection"));
				this.#pending.clear();
				resolve();
			});
		});
	}

	/** Connect to the daemon on `socketPath` and check that both speak the same protocol. */
	static async connect(socketPath: string): Promise<PierClient> {
		const socket = new WebSocket(`ws+unix://${socketPath}:/`);
		await new Promise<void>((resolve, reject) => {
			socket.once("open", () => resolve());
			socket.once("error", (error) => reject(error));
		});
		const client = new PierClient(socket);
		try {
			await client.request("hello", { version: PROTOCOL_VERSION });
		} catch (error) {
			client.close();
			throw error;
		}
		return client;
	}

	/** Whether the connection is still open. */
	get connected(): boolean {
		return this.#socket.readyState === WebSocket.OPEN;
	}

	request<M extends Method>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]> {
		const id = this.#next++;
		// ws drops a send on a closed socket without a word, which would leave this pending for good.
		if (!this.connected) return Promise.reject(new Error("Not connected to the daemon"));
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.#socket.send(JSON.stringify({ id, method, params }));
		});
	}

	onEvent(listener: (event: Event) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	close(): void {
		this.#socket.close();
	}
}

/**
 * Connect to the daemon on `socketPath`, retrying while nothing answers there, as while
 * it restarts, until `signal` aborts. A daemon that answers and refuses (a protocol of
 * another version) isn't retried: that rejects with its `DaemonError`.
 */
export async function connectWhenUp(
	socketPath: string,
	options: { signal?: AbortSignal; firstDelayMs?: number; maxDelayMs?: number } = {},
): Promise<PierClient> {
	const maxDelayMs = options.maxDelayMs ?? 2000;
	let delayMs = options.firstDelayMs ?? 250;
	for (;;) {
		options.signal?.throwIfAborted();
		try {
			return await PierClient.connect(socketPath);
		} catch (error) {
			if (error instanceof DaemonError) throw error;
		}
		await sleep(delayMs, undefined, { signal: options.signal });
		delayMs = Math.min(delayMs * 2, maxDelayMs);
	}
}

/**
 * The attached conversation, as the client sees it: Durable's view, rebuilt from the
 * daemon's operations, merged into a `ConversationTranscript` so entries the view's
 * window drops are kept, and older ones can be loaded.
 */
export class AttachedConversation {
	#client: PierClient;
	#unlisten: () => void;
	readonly #listeners = new Set<(view: TranscriptView) => void>();
	#transcript: ConversationTranscript;
	/** The conversation `#transcript` holds; a view of another one starts a new transcript. */
	#transcriptOf: ConversationId | undefined;
	#view: ConversationView | undefined;
	#current: TranscriptView | undefined;
	#id: ConversationId | undefined;
	#number: number | undefined;
	#ended: string | undefined;

	constructor(client: PierClient) {
		this.#client = client;
		this.#transcript = this.#newTranscript();
		this.#unlisten = client.onEvent((event) => this.#receive(event));
	}

	get id(): ConversationId | undefined {
		return this.#id;
	}

	/** pier's number for the conversation, as people see it. */
	get number(): number | undefined {
		return this.#number;
	}

	/** The latest view, once the daemon sent one. */
	get current(): TranscriptView | undefined {
		return this.#current;
	}

	/** Why the daemon stopped sending this view, if it did. */
	get ended(): string | undefined {
		return this.#ended;
	}

	async attach(target: AttachTarget, cwd: string, env: Record<string, string>): Promise<{ created: boolean }> {
		// The same conversation resumes its transcript; the view of another starts a new one
		// (`#receive`), so one that fails to attach leaves this as it was.
		const resuming = target.kind === "id" && target.id === this.#transcriptOf;
		this.#ended = undefined;
		const window = resuming ? this.#transcript.resume : undefined;
		const result = await this.#client.request("attach", { target, cwd, env, ...(window ? { window } : {}) });
		this.#id = result.conversation;
		this.#number = result.number;
		return { created: result.created };
	}

	/**
	 * Attach again to the same conversation over `client`, a new connection after the old
	 * one dropped (or the same one, after its view ended), resuming the transcript: the
	 * daemon sends only what was missed, or its newest entries and a gap.
	 */
	async reattach(client: PierClient, cwd: string, env: Record<string, string>): Promise<void> {
		const id = this.#id;
		if (id === undefined) throw new Error("Not attached to a conversation yet");
		if (client !== this.#client) {
			this.#unlisten();
			this.#client = client;
			this.#unlisten = client.onEvent((event) => this.#receive(event));
		}
		await this.attach({ kind: "id", id }, cwd, env);
	}

	/** Load the page of entries before the oldest one held. */
	async loadEarlier(context: Context): Promise<void> {
		this.#publish(await this.#transcript.loadEarlier(context));
	}

	subscribe(listener: (view: TranscriptView) => void): () => void {
		this.#listeners.add(listener);
		if (this.#current !== undefined) listener(this.#current);
		return () => this.#listeners.delete(listener);
	}

	#newTranscript(): ConversationTranscript {
		return new ConversationTranscript(async (query, limit) => {
			const { entries } = await this.#client.request("entries", { ...query, limit });
			return { items: entries };
		});
	}

	#receive(event: Event): void {
		if (event.conversation !== this.#id && event.event !== "view") return;
		switch (event.event) {
			case "view":
				if (event.conversation !== this.#transcriptOf) {
					this.#transcript = this.#newTranscript();
					this.#transcriptOf = event.conversation;
				}
				this.#id = event.conversation;
				this.#view = event.view;
				break;
			case "ops":
				if (this.#view === undefined) return;
				this.#view = applyImmutable(this.#view, event.ops);
				break;
			case "ended":
				this.#ended = event.reason;
				break;
		}
		if (this.#view !== undefined) this.#publish(this.#transcript.merge(this.#view));
	}

	#publish(view: TranscriptView): void {
		this.#current = view;
		for (const listener of this.#listeners) listener(view);
	}
}
