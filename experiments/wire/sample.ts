// Prints what a conversation watch sends for one faux tool turn, as JSON lines, with
// byte counts, for the wire format report (todos/wire-format.md): the view, then the
// folded operations of each delivery. (Durable 1.5 removed the agent event stream this
// used to compare against.)
//   node experiments/wire/sample.ts [--late]
// --late attaches mid-run, while the tool runs, as a client joining late would.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, LiveDoc, MemoryStorage } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

const context = BACKGROUND_CONTEXT;
const late = process.argv.includes("--late");
let bytes = 0;
let frames = 0;
const print = (value: unknown) => {
	const line = JSON.stringify(value);
	bytes += line.length + 1;
	frames += 1;
	process.stdout.write(`${line}\n`);
};

const faux = fauxProvider({ tokensPerSecond: 400 });
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
	fauxAssistantMessage(
		[fauxText("Let me look."), fauxToolCall("bash", { command: "for i in 1 2 3; do echo line $i; sleep 0.2; done" })],
		{
			stopReason: "toolUse",
		},
	),
	fauxAssistantMessage([fauxText("The command printed three lines, one every fifth of a second, and exited cleanly.")]),
]);
const registry = createRegistry();
registry.install(CodingTools);
const env = new NodeExecutionEnv({ cwd: process.cwd() });
const harness = await Harness.open(new MemoryStorage(), { models, registry, env: () => env }, context);
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });

const attach = async () => {
	const watch = await root.watch(context);
	print({ view: watch.value });
	watch.start(async (call) => {
		if (call.kind === "value") print({ ops: call.ops });
	});
	return () => watch.stop();
};

let stop = late ? undefined : await attach();
await root.submit({ type: "input", content: "Run the loop" }, context);
if (late) {
	// Wait until the tool is running, then join.
	while ((await harness.snapshot(LiveDoc, root.id, context))?.tools?.[0]?.status !== "running") {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	stop = await attach();
}
await harness.waitForIdle(context);
await new Promise((resolve) => setTimeout(resolve, 50));
await stop?.();
await harness.close(context);
console.error(`ops${late ? " (late)" : ""}: ${frames} frames, ${bytes} bytes`);
