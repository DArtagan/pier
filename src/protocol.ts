// pier's wire protocol: JSON messages over a WebSocket, on the daemon's Unix socket.
//
// A client sends requests and gets one response each, matched by `id`. Once attached to
// a conversation, it also gets that conversation's view: Durable's ConversationView,
// then the operations of each change (Chord's delta format), which it applies with
// `applyImmutable` from `@earendil-works/chord/delta`. The view is Durable's own, so this
// protocol is only an envelope: when Durable's view changes shape, clients do too, and
// they ship with the daemon.
import type { Op } from "@earendil-works/chord/delta";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
	ConversationId,
	ConversationView,
	ConversationWindow,
	EntryId,
	EntryRecord,
	SubmissionId,
	TaskId,
} from "@earendil-works/pi-durable";

/** Bumped whenever a message changes shape; a client and a daemon of different versions refuse each other. */
export const PROTOCOL_VERSION = 1;

/** Which conversation `attach` opens. */
export type AttachTarget =
	| { readonly kind: "new" }
	/** The newest conversation in the client's directory, or a new one if there's none. */
	| { readonly kind: "continue" }
	| { readonly kind: "id"; readonly id: ConversationId };

export interface ConversationSummary {
	readonly id: ConversationId;
	readonly cwd?: string;
	/** The first user message, cut short. */
	readonly title?: string;
	readonly busy: boolean;
}

/** Every request, by method: its params and its result. */
export interface Methods {
	hello: { params: { version: number }; result: { version: number; pid: number } };
	/**
	 * Attach this connection to a conversation, replacing any earlier attachment. `env` is
	 * the client's whole environment; the conversation's tools run with it from now on.
	 * `window` resumes a transcript after a dropped connection (`ConversationTranscript.resume`).
	 */
	attach: {
		params: {
			target: AttachTarget;
			cwd: string;
			env: Record<string, string>;
			window?: ConversationWindow;
		};
		result: { conversation: ConversationId; created: boolean };
	};
	detach: { params: Record<string, never>; result: Record<string, never> };
	/** Send input. While a run is going, `steer` joins it and `followUp` (the default) waits for it. */
	submit: {
		params: { text: string; whenBusy?: "steer" | "followUp" };
		result: { submission: SubmissionId };
	};
	/** Stop the attached conversation's run, as Esc does, and withdraw what's queued. */
	abort: { params: Record<string, never>; result: Record<string, never> };
	compact: { params: { instructions?: string }; result: { task: TaskId } };
	configure: { params: { thinkingLevel?: ModelThinkingLevel }; result: Record<string, never> };
	/** Conversations, newest first, in one directory if `cwd` is given. */
	list: { params: { cwd?: string; limit?: number }; result: { conversations: ConversationSummary[] } };
	/** A page of the attached conversation's entries, for `ConversationTranscript`'s loader. */
	entries: {
		params: { minEntryId?: EntryId; maxEntryId?: EntryId; order?: "ascending" | "descending"; limit: number };
		result: { entries: EntryRecord[] };
	};
}

export type Method = keyof Methods;

export type Request = { [M in Method]: { id: number; method: M; params: Methods[M]["params"] } }[Method];

export type Response = { id: number; result: unknown } | { id: number; error: { message: string } };

/** Pushed by the daemon to an attached connection. */
export type Event =
	/** The attached conversation's view as it was at attachment. */
	| { event: "view"; conversation: ConversationId; view: ConversationView }
	/** The operations of the changes since, in order. */
	| { event: "ops"; conversation: ConversationId; ops: readonly Op[] }
	/** The view can't be followed any more (the daemon is closing, or its storage failed). */
	| { event: "ended"; conversation: ConversationId; reason: string };

export type ServerMessage = Response | Event;
