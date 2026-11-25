// pier's wire protocol: JSON messages over a WebSocket, on the daemon's Unix socket.
//
// A client sends requests and gets one response each, matched by `id`. Once attached to
// a conversation, it also gets that conversation's view: Durable's ConversationView,
// then the operations of each change (Chord's delta format), which it applies with
// `applyImmutable` from `@earendil-works/chord/delta`. The view is Durable's own, so this
// protocol is only an envelope: when Durable's view changes shape, clients do too, and
// they ship with the daemon.
//
// A request's params are JSON Schema (pi-schema), which the daemon checks every request
// against before it acts on one; their types are the schemas'. Responses and events
// aren't checked: the client trusts the daemon it said hello to.
import type { Op } from "@earendil-works/chord/delta";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { ModelThinkingLevelSchema } from "@earendil-works/pi-ai/providers/model-schema";
import type {
	BlockedReason,
	ConversationId,
	ConversationView,
	Cursor,
	EntryId,
	EntryRecord,
	SubmissionId,
	TaskId,
} from "@earendil-works/pi-durable";
import {
	compile,
	int,
	lit,
	obj,
	oneOf,
	opt,
	type Static,
	str,
	union,
	unknown,
	unsafe,
	type ValidationError,
	type Validator,
} from "@earendil-works/pi-schema";

/** Bumped whenever a message changes shape; a client and a daemon of different versions refuse each other. */
export const PROTOCOL_VERSION = 7;

// Durable's ids are branded numbers.
const conversationId = unsafe<ConversationId>(int({ minimum: 0 }));
const entryId = unsafe<EntryId>(int({ minimum: 0 }));
const none = obj({});
const modelRef = obj({ provider: str({ minLength: 1 }), modelId: str({ minLength: 1 }) });

/** Which conversation `attach` opens. */
const AttachTarget = union([
	obj({ kind: lit("new") }),
	// The newest conversation in the client's directory, or a new one if there's none.
	obj({ kind: lit("continue") }),
	// By the number pier gave it: #1, #2, … on this host.
	obj({ kind: lit("number"), number: int({ minimum: 1 }) }),
	// By Durable's own id, which clients use to reattach; it isn't shown to people.
	obj({ kind: lit("id"), id: conversationId }),
]);
export type AttachTarget = Static<typeof AttachTarget>;

/** Durable's `ConversationWindow`, as its documentation bounds it. */
const ConversationWindow = obj({
	from: opt(entryId),
	min: opt(int({ minimum: 1 })),
	max: opt(int({ minimum: 1 })),
});

/** Every request's params, by method. */
const Params = {
	hello: obj({ version: int() }),
	/**
	 * Attach this connection to a conversation, replacing any earlier attachment. `cwd` is
	 * the client's directory, for a new conversation or `continue`; nothing else of the
	 * client's reaches the conversation's tools. `window` resumes a transcript after a
	 * dropped connection (`ConversationTranscript.resume`).
	 */
	attach: obj({ target: AttachTarget, cwd: str({ minLength: 1 }), window: opt(ConversationWindow) }),
	detach: none,
	/** Send input. While a run is going, `steer` joins it and `followUp` (the default) waits for it. */
	submit: obj({ text: str(), whenBusy: opt(oneOf(["steer", "followUp"])) }),
	/**
	 * Withdraw the attached conversation's queued messages, as pi's Alt+Up does, and return
	 * their text, oldest first, for the editor. One the run took in meanwhile stays sent.
	 */
	dequeue: none,
	/** Stop the attached conversation's run, as Esc does, and withdraw what's queued. */
	abort: none,
	compact: obj({ instructions: opt(str()) }),
	/**
	 * Change the attached conversation's model or thinking level. A thinking level the model
	 * doesn't support is clamped to one it does, as pi does; the result says which.
	 */
	configure: obj({ model: opt(modelRef), thinkingLevel: opt(ModelThinkingLevelSchema) }),
	/** The models the daemon can run: those whose provider has its credentials. */
	models: none,
	/**
	 * Fork the attached conversation just before its user message `before`, as pi's `/fork`
	 * does: the new conversation's history runs up to that message, which the client can
	 * edit and send again. The client attaches to it by number.
	 */
	fork: obj({ before: entryId }),
	/**
	 * What the client can't see of a model: its context window, from the daemon's model
	 * catalog, for the footer's context gauge. Undefined for a model the daemon doesn't know.
	 */
	model: modelRef,
	/** Conversations, newest first, in one directory if `cwd` is given. */
	list: obj({ cwd: opt(str()), limit: opt(int({ minimum: 1 })) }),
	/**
	 * A page of the attached conversation's entries, for `ConversationTranscript`'s loader.
	 * `next` is Durable's cursor, present when more entries match: the transcript takes a
	 * page without one to mean it reached the start, or that a gap is filled.
	 */
	entries: obj({
		minEntryId: opt(entryId),
		maxEntryId: opt(entryId),
		order: opt(oneOf(["ascending", "descending"])),
		limit: int({ minimum: 1 }),
	}),
};

export interface ConversationSummary {
	readonly id: ConversationId;
	/** pier's number for it, counting up from 1 on this host. Durable's ids share one counter with every entry and task, so they jump. */
	readonly number: number;
	readonly cwd?: string;
	/** The first user message, cut short. */
	readonly title?: string;
	readonly busy: boolean;
	/** For a fork: the conversation it was forked from. */
	readonly parent?: { readonly number: number };
	/** For a fork: its first message of its own, after those it shares with its parent. */
	readonly branch?: string;
	/** For a fork: how many messages it has of its own. */
	readonly ownMessages?: number;
	/** The newest user message, cut short. */
	readonly latest?: string;
	/** When its newest message was sent, in ms since the epoch. */
	readonly active?: number;
	/** Whether Durable can't run one of its ordinary tasks, so the conversation waits for it (`BlockedTask`). */
	readonly blocked?: boolean;
}

/**
 * A task of the conversation that Durable can't run, as its task graph says, for as long
 * as it says so: no installed definition takes it (`missing_task`), it was written by a
 * newer Durable (`task_too_old`), or its saved state couldn't be migrated
 * (`migration_failed`). Durable never ends it for that: it waits, unchanged, until code
 * that fits is installed, or it's aborted, which orphans it without its cleanup (spec
 * section 5.4). An ordinary one holds its conversation busy, and the conversation's abort
 * reaches it; a `background` one does neither.
 */
export interface BlockedTask {
	readonly id: TaskId;
	readonly kind: string;
	readonly reason: BlockedReason;
	readonly background: boolean;
}

/** A model the daemon can run, for the client's `/model` and `/thinking` pickers. */
export interface ModelSummary {
	readonly provider: string;
	readonly id: string;
	readonly name?: string;
	/** The thinking levels it supports, as pi-ai's `getSupportedThinkingLevels` says. */
	readonly thinkingLevels: readonly ModelThinkingLevel[];
}

/** Every request's result, by method. */
interface Results {
	hello: { version: number; pid: number };
	attach: { conversation: ConversationId; number: number; created: boolean };
	detach: Record<string, never>;
	submit: { submission: SubmissionId };
	dequeue: { texts: string[] };
	abort: Record<string, never>;
	compact: { task: TaskId };
	configure: { thinkingLevel?: ModelThinkingLevel };
	models: { models: ModelSummary[] };
	fork: { number: number };
	model: { contextWindow?: number };
	list: { conversations: ConversationSummary[] };
	entries: { entries: EntryRecord[]; next?: Cursor };
}

export type Method = keyof typeof Params & keyof Results;

/** Every request, by method: its params and its result. */
export type Methods = { [M in Method]: { params: Static<(typeof Params)[M]>; result: Results[M] } };

export type Request = { [M in Method]: { id: number; method: M; params: Methods[M]["params"] } }[Method];

const envelope = compile(obj({ id: int(), method: oneOf(Object.keys(Params) as Method[]), params: unknown() }));
const paramsOf = Object.fromEntries(
	Object.entries(Params).map(([method, schema]) => [method, compile(schema)]),
) as unknown as { [M in Method]: Validator<Methods[M]["params"]> };

/**
 * `message`, a parsed JSON message from a client, as a request; else why it isn't one,
 * and its `id` if it has one, for the error response.
 */
export function parseRequest(message: unknown): { request: Request } | { id: number; error: string } {
	if (!envelope.check(message)) {
		const id = (message as { id?: unknown } | null)?.id;
		return {
			id: Number.isInteger(id) ? (id as number) : -1,
			error: `Not a request: ${describe(envelope.errors(message))}`,
		};
	}
	const params = paramsOf[message.method];
	if (!params.check(message.params)) {
		return { id: message.id, error: `Bad params for ${message.method}: ${describe(params.errors(message.params))}` };
	}
	return { request: message as Request };
}

function describe(errors: readonly ValidationError[]): string {
	return errors.map((error) => `${error.path === "" ? "/" : error.path} ${error.message}`).join("; ");
}

export type Response = { id: number; result: unknown } | { id: number; error: { message: string } };

/** Pushed by the daemon to an attached connection. */
export type Event =
	/** The attached conversation's view as it was at attachment. */
	| { event: "view"; conversation: ConversationId; view: ConversationView }
	/** The operations of the changes since, in order. */
	| { event: "ops"; conversation: ConversationId; ops: readonly Op[] }
	/** The view can't be followed any more (the daemon is closing, or its storage failed). */
	| { event: "ended"; conversation: ConversationId; reason: string }
	/** The conversation's blocked tasks: after the view, and each time they change. */
	| { event: "blocked"; conversation: ConversationId; tasks: readonly BlockedTask[] };

export type ServerMessage = Response | Event;

/** The reason of the `ended` event a daemon sends as it closes, just before it closes the connection. */
export const DAEMON_CLOSING = "the daemon is closing";
