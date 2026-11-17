// What the daemon accepts as a request: parseRequest, against the protocol's schemas.
import { describe, expect, it } from "vitest";
import { parseRequest } from "../src/host/protocol.ts";

const ok = (message: unknown) => expect(parseRequest(message)).toEqual({ request: message });
const refused = (message: unknown, id: number, error: RegExp) =>
	expect(parseRequest(message)).toEqual({ id, error: expect.stringMatching(error) });

describe("parseRequest", () => {
	it("takes the requests the client sends", () => {
		ok({ id: 1, method: "hello", params: { version: 5 } });
		ok({ id: 2, method: "attach", params: { target: { kind: "continue" }, cwd: "/w", env: { PATH: "/bin" } } });
		ok({
			id: 3,
			method: "attach",
			params: { target: { kind: "id", id: 47 }, cwd: "/w", env: {}, window: { from: 120, min: 50 } },
		});
		ok({ id: 4, method: "submit", params: { text: "hi", whenBusy: "steer" } });
		ok({
			id: 5,
			method: "configure",
			params: { model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: "off" },
		});
		ok({ id: 6, method: "entries", params: { maxEntryId: 9, order: "descending", limit: 50 } });
		ok({ id: 7, method: "detach", params: {} });
	});

	it("refuses what isn't JSON-RPC-shaped, with the id when there is one", () => {
		refused("hello", -1, /^Not a request: \//u);
		refused(null, -1, /^Not a request/u);
		refused({ method: "hello", params: { version: 5 } }, -1, /\/id missing/u);
		refused({ id: 1.5, method: "hello", params: { version: 5 } }, -1, /\/id /u);
		refused({ id: 8, method: "launch", params: {} }, 8, /\/method /u);
		refused({ id: 9, method: "detach" }, 9, /\/params missing/u);
	});

	it("refuses params of the wrong shape, saying where", () => {
		refused({ id: 1, method: "attach", params: { target: { kind: "nearest" }, cwd: "/w", env: {} } }, 1, /\/target/u);
		refused(
			{ id: 2, method: "attach", params: { target: { kind: "new" }, cwd: "/w", env: { N: 1 } } },
			2,
			/\/env\/N /u,
		);
		refused({ id: 3, method: "attach", params: { target: { kind: "new" }, env: {} } }, 3, /\/cwd missing/u);
		refused({ id: 4, method: "fork", params: { before: "12" } }, 4, /^Bad params for fork: \/before /u);
		refused({ id: 5, method: "entries", params: { limit: 0 } }, 5, /\/limit /u);
		refused({ id: 6, method: "configure", params: { thinkingLevel: "extreme" } }, 6, /\/thinkingLevel /u);
		refused({ id: 7, method: "submit", params: { text: "hi", whenBusy: "now" } }, 7, /\/whenBusy /u);
		refused({ id: 8, method: "detach", params: { all: true } }, 8, /\/all unknown field/u);
	});
});
