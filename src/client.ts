// A client of the daemon: requests over the socket, and the attached conversation's
// transcript, kept by applying the daemon's view operations.
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

export class PierClient {
	readonly #socket: WebSocket;
	readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	readonly #listeners = new Set<(event: Event) => void>();
	#next = 1;
	/** Settles when the connection closes, from either side. */
	readonly closed: Promise<void>;

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.on("message", (data) => {
			const message = JSON.parse(data.toString()) as ServerMessage;
			if ("event" in message) {
				for (const listener of this.#listeners) listener(message);
				return;
			}
			const pending = this.#pending.get(message.id);
			if (pending === undefined) return;
			this.#pending.delete(message.id);
			if ("error" in message) pending.reject(new Error(message.error.message));
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
		await client.request("hello", { version: PROTOCOL_VERSION });
		return client;
	}

	request<M extends Method>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]> {
		const id = this.#next++;
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
 * The attached conversation, as the client sees it: Durable's view, rebuilt from the
 * daemon's operations, merged into a `ConversationTranscript` so entries the view's
 * window drops are kept, and older ones can be loaded.
 */
export class AttachedConversation {
	readonly #client: PierClient;
	readonly #listeners = new Set<(view: TranscriptView) => void>();
	#transcript: ConversationTranscript;
	#view: ConversationView | undefined;
	#current: TranscriptView | undefined;
	#id: ConversationId | undefined;
	#ended: string | undefined;

	constructor(client: PierClient) {
		this.#client = client;
		this.#transcript = this.#newTranscript();
		client.onEvent((event) => this.#receive(event));
	}

	get id(): ConversationId | undefined {
		return this.#id;
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
		// The view of another conversation starts a new transcript; the same one resumes.
		const resuming = target.kind === "id" && target.id === this.#id;
		if (!resuming) {
			this.#transcript = this.#newTranscript();
			this.#view = undefined;
			this.#current = undefined;
		}
		this.#ended = undefined;
		const window = resuming ? this.#transcript.resume : undefined;
		const result = await this.#client.request("attach", { target, cwd, env, ...(window ? { window } : {}) });
		this.#id = result.conversation;
		return { created: result.created };
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
