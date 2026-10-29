// Prints what each of Durable's watch APIs sends for one faux tool turn, as JSON lines,
// with byte counts, for comparing wire formats (todos/wire-format.md).
//   node experiments/wire/sample.ts <ops|events> [--late]
// --late attaches mid-run, while the tool runs, as a client joining late would.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, LiveDoc, MemoryStorage, watchEvents } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

const context = BACKGROUND_CONTEXT;
const mode = process.argv[2] === "events" ? "events" : "ops";
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
	if (mode === "events") {
		const stream = await watchEvents(harness, root.id, context);
		print(stream.snapshot);
		stream.start(async (events) => {
			for (const event of events) print(event);
		});
		return () => stream.stop();
	}
	const watch = await root.watch(context);
	print({ view: watch.value });
	watch.start(async (_value, ops) => print({ ops }));
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
console.error(`${mode}${late ? " (late)" : ""}: ${frames} frames, ${bytes} bytes`);
