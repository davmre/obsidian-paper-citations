import { defineConfig } from "vitest/config";

/**
 * The live suite hits the real arXiv, Crossref, LessWrong and ACL endpoints,
 * so it is deliberately separate from `npm test`: it is how you find out that
 * an upstream response shape changed, not something to run on every edit.
 */
export default defineConfig({
	test: {
		environment: "jsdom",
		include: ["tests/**/*.live.test.ts"],
		// Real network calls, and arXiv asks for a pause between requests.
		testTimeout: 60_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
	resolve: {
		alias: {
			obsidian: new URL("./tests/obsidian-live.ts", import.meta.url).pathname,
		},
	},
});
