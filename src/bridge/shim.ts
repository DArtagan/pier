// Runs pi-claude-bridge on a Durable Harness by standing in for the parts of pi's
// ExtensionAPI it uses: provider registration, and the session and prompt events it
// keys its per-session state on. See todos/ for what each event has to carry.
import type { Context as ChordContext } from "@earendil-works/chord";
import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { Skill } from "@earendil-works/pi-coding-agent";
import {
	AgentDoc,
	CompactionTask,
	type ConversationId,
	defineExtension,
	type Extension,
	GenerationTask,
	type HookApi,
	hook,
	ProviderDoc,
} from "@earendil-works/pi-durable";
import type { LoadedBridge } from "./load.ts";

/** What the bridge reads from `before_agent_start`'s `systemPromptOptions`: the portable parts of the prompt. */
export interface SystemPromptOptions {
	customPrompt?: string;
	appendSystemPrompt?: string;
	contextFiles?: { path: string; content: string }[];
	skills?: Skill[];
	/** Custom sections, raw content by name. The bridge forwards them after the append. */
	sections?: Record<string, string>;
	selectedTools?: string[];
}

export interface BridgeShimOptions {
	/** Takes the bridge's `registerProvider` calls; pi's `ModelRuntime` does. */
	models: { registerProvider(id: string, config: never): void };
	/** The portable parts of the prompt a conversation's next request carries. */
	promptOptions(input: {
		conversationId: ConversationId;
		cwd: string;
	}): SystemPromptOptions | Promise<SystemPromptOptions>;
	/** The bridge's `ctx.ui.notify`. */
	notify?(message: string, type?: "info" | "warning" | "error"): void;
	/** Shim decisions, for debugging. */
	log?(message: string): void;
	/** Fallback working directory for a conversation without one. */
	cwd?: string;
	/** Tell the bridge when history was rewritten (default true). Off only as an experiment's control. */
	markRewrites?: boolean;
}

export interface BridgeShim {
	/** Install in the Harness registry; selected by every conversation that talks to claude-bridge. */
	readonly extension: Extension;
	/** Names of the pi events the bridge subscribed to. */
	readonly events: readonly string[];
	/** Tools the bridge tried to register, which the shim drops. */
	readonly droppedTools: readonly string[];
	/** Fire `session_shutdown`; call before closing the Harness. */
	shutdown(): Promise<void>;
}

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;

interface SessionState {
	cwd: string;
	/** Fingerprints of the non-system messages of the last request, to spot history rewrites. */
	history: string[];
	systemPrompt?: string;
}

export function createBridgeShim(bridge: LoadedBridge, options: BridgeShimOptions): BridgeShim {
	const log = options.log ?? (() => {});
	const handlers = new Map<string, Handler[]>();
	const droppedTools: string[] = [];
	// Provider session id -> state. A conversation's provider session id is the key the
	// bridge keeps its Claude Code session under, and it survives restarts, so a daemon
	// start sees each conversation as new to this process, as the bridge does.
	const sessions = new Map<string, SessionState>();

	const runSignals = new RunSignals();

	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerProvider(id: string, config: { streamSimple?: StreamSimple }) {
			log(`registerProvider(${id})`);
			const streamSimple = config.streamSimple;
			const wrapped = streamSimple === undefined ? config : { ...config, streamSimple: runSignals.wrap(streamSimple) };
			options.models.registerProvider(id, wrapped as never);
		},
		// Only AskClaude, which upstream has deprecated and claude-bridge's own models never get.
		registerTool(tool: { name: string }) {
			log(`dropping tool ${tool.name}`);
			droppedTools.push(tool.name);
		},
	};
	bridge.factory(pi);

	const emit = async (name: string, event: Record<string, unknown>, ctx: unknown): Promise<void> => {
		for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
	};

	const contextFor = (sessionId: string, state: SessionState) => ({
		sessionManager: { getSessionId: () => sessionId },
		cwd: state.cwd,
		mode: "tui",
		hasUI: true,
		ui: { notify: (message: string, type?: "info" | "warning" | "error") => options.notify?.(message, type) },
		modelRegistry: options.models,
		getSystemPrompt: () => state.systemPrompt ?? "",
	});

	/** The conversation's provider session, announced to the bridge on first use in this process. */
	const session = async (api: HookApi, context: ChordContext): Promise<[string, SessionState]> => {
		const provider = await api.snapshot(ProviderDoc, api.conversationId, context);
		if (provider === undefined) throw new Error(`Conversation ${api.conversationId} has no provider session id`);
		const sessionId = provider.sessionId;
		let state = sessions.get(sessionId);
		if (state === undefined) {
			const agent = await api.snapshot(AgentDoc, api.conversationId, context);
			state = { cwd: agent?.cwd ?? options.cwd ?? process.cwd(), history: [] };
			sessions.set(sessionId, state);
			// Not "new", "resume" or "fork": for those the bridge drops every session's
			// state, which in one process serving many conversations means all of them.
			log(`session_start ${sessionId} cwd=${state.cwd}`);
			await emit("session_start", { reason: "startup" }, contextFor(sessionId, state));
		}
		return [sessionId, state];
	};

	const beforeRequest = async (
		request: { readonly messages: readonly Message[] },
		api: HookApi,
		context: ChordContext,
	): Promise<undefined> => {
		const [sessionId, state] = await session(api, context);
		const ctx = contextFor(sessionId, state);

		// Compaction, reset and the like replace history rather than extend it. The
		// bridge has to rebuild its Claude Code session then, and discard a query
		// parked at a tool boundary, instead of resuming one that no longer matches.
		const history = request.messages.filter((message) => message.role !== "system").map(fingerprint);
		const extends_ = state.history.every((print, index) => history[index] === print);
		if (!extends_ && options.markRewrites !== false) {
			log(`session_compact ${sessionId}: history rewritten (${state.history.length} -> ${history.length})`);
			await emit("session_compact", { reason: "rewrite", willRetry: false }, ctx);
		}
		state.history = history;

		// Keyed exactly as the bridge will look it up: the same fold of the same messages.
		const systemPrompt = bridge.toBridgeContext({ messages: [...request.messages] }).systemPrompt;
		state.systemPrompt = systemPrompt;
		const systemPromptOptions = await options.promptOptions({ conversationId: api.conversationId, cwd: state.cwd });
		await emit("before_agent_start", { prompt: "", systemPrompt, systemPromptOptions }, ctx);
		return undefined;
	};

	const extension = defineExtension({
		name: "pier.claude-bridge",
		hooks: [
			hook(GenerationTask, { beforeRequest }),
			// A compaction can be a conversation's first request in this process; announce
			// its session first so the summary runs in the conversation's directory.
			hook(CompactionTask, {
				beforeCompact: async (_compaction, api, context) => {
					await session(api, context);
					return undefined;
				},
			}),
		],
	});

	return {
		extension,
		events: [...handlers.keys()],
		droppedTools,
		async shutdown() {
			for (const [sessionId, state] of sessions) {
				await emit("session_shutdown", {}, contextFor(sessionId, state));
			}
			sessions.clear();
		},
	};
}

type StreamSimple = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;

/**
 * The bridge keeps a Claude Code query alive across a tool round and ties it to the
 * signal of the request that started it, as pi's signal lasts a whole run. Durable's
 * lasts one task invocation: it aborts when the request's invocation ends, normally
 * too, which killed every query parked at a tool boundary. So the bridge gets one
 * signal per provider session instead, aborted only when a request's own signal
 * aborts while that request is still streaming: a real abort, not a finished task.
 */
class RunSignals {
	readonly #runs = new Map<string, AbortController>();

	wrap(streamSimple: StreamSimple): StreamSimple {
		return (model, context, options) => {
			const outer = options?.signal;
			const sessionId = options?.sessionId;
			// Summaries run in an isolated Claude Code process that lives for one request.
			if (outer === undefined || sessionId === undefined || options?.cacheRetention === "none") {
				return streamSimple(model, context, options);
			}
			let run = this.#runs.get(sessionId);
			if (run === undefined || run.signal.aborted) {
				run = new AbortController();
				this.#runs.set(sessionId, run);
			}
			const controller = run;
			const forward = () => controller.abort(outer.reason);
			if (outer.aborted) forward();
			else outer.addEventListener("abort", forward, { once: true });
			const stream = streamSimple(model, context, { ...options, signal: controller.signal });
			void stream.result().finally(() => outer.removeEventListener("abort", forward));
			return stream;
		};
	}
}

function fingerprint(message: Message): string {
	return `${message.role}:${message.timestamp}:${JSON.stringify(message.content).length}`;
}
