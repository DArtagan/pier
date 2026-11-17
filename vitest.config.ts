import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Only this checkout's tests: by default vitest also finds the copies in .worktrees/,
		// so a branch's tests would run (and could fail) in main's pre-commit hook.
		include: ["test/**/*.test.ts"],
	},
});
