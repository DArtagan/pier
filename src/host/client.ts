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
	type BlockedTask,
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
	/** Why this end closed the connection, if it did on its own. */
	#failure: string | undefined;
	/** Settles when the connection closes, from either side. */
	readonly closed: Promise<void>;

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		// A socket error (the daemon was killed mid-write) is followed by `close`, which is
		// what callers watch; without a listener, ws would throw it out of the process.
		socket.on("error", () => {});
		socket.on("message", (data) => {
			const message = parseServerMessage(data.toString());
			if (message === undefined) {
				// The daemon said hello with this protocol's version, so this is a bug, not a
				// mismatch; thrown here, it would take the whole process down.
				this.#failure = "The daemon sent a message that isn't one of pier's";
				socket.close(1002, "protocol error");
				return;
			}
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
				const reason = this.#failure ?? "The daemon closed the connection";
				for (const pending of this.#pending.values()) pending.reject(new Error(reason));
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
 * `text` as a message from the daemon: JSON, with an `event` or a numeric `id`. Its
 * contents are Durable's own and aren't checked further: the daemon speaks this protocol's
 * version, which `hello` checked.
 */
function parseServerMessage(text: string): ServerMessage | undefined {
	let message: unknown;
	try {
		message = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof message !== "object" || message === null) return undefined;
	if ("event" in message) return typeof message.event === "string" ? (message as ServerMessage) : undefined;
	return "id" in message && typeof message.id === "number" ? (message as ServerMessage) : undefined;
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
			// biome-ignore lint/performance/noAwaitInLoops: a retry, each try after the last
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
	#blocked: readonly BlockedTask[] = [];

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

	/** The conversation's tasks Durable can't run, as the daemon last said. */
	get blocked(): readonly BlockedTask[] {
		return this.#blocked;
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
		const transcript = this.#transcript;
		const view = await transcript.loadEarlier(context);
		if (transcript === this.#transcript) this.#publish(view);
	}

	/**
	 * Load what's missing between the entries held, page by page, until no gap is left: a
	 * gap opens when the daemon's window moved on without this client (a long outage, or a
	 * client too slow for it). Rejects if the connection drops; reattaching resumes.
	 */
	async fillGaps(context: Context): Promise<void> {
		for (;;) {
			const gap = this.#current?.items.find((item) => item.kind === "gap");
			if (gap === undefined || gap.kind !== "gap") return;
			const transcript = this.#transcript;
			// biome-ignore lint/performance/noAwaitInLoops: the next gap is found in the view this fill brings
			const view = await transcript.fillGap(gap, context);
			// Another conversation's view arrived meanwhile: its transcript is a new one.
			if (transcript !== this.#transcript) return;
			this.#publish(view);
		}
	}

	subscribe(listener: (view: TranscriptView) => void): () => void {
		this.#listeners.add(listener);
		if (this.#current !== undefined) listener(this.#current);
		return () => this.#listeners.delete(listener);
	}

	#newTranscript(): ConversationTranscript {
		return new ConversationTranscript(async (query, limit) => {
			const { entries, next } = await this.#client.request("entries", { ...query, limit });
			return next === undefined ? { items: entries } : { items: entries, next };
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
				// The daemon sends them again after the view; until then, none are known.
				this.#blocked = [];
				break;
			case "ops":
				if (this.#view === undefined) return;
				this.#view = applyImmutable(this.#view, event.ops);
				break;
			case "ended":
				this.#ended = event.reason;
				break;
			case "blocked":
				this.#blocked = event.tasks;
				break;
		}
		if (this.#view !== undefined) this.#publish(this.#transcript.merge(this.#view));
	}

	#publish(view: TranscriptView): void {
		this.#current = view;
		for (const listener of this.#listeners) listener(view);
	}
}
