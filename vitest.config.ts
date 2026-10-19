import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The resolvers parse HTML and XML with DOMParser, which Obsidian provides
    // from Electron's renderer. jsdom stands in for it under test.
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    // `*.live.test.ts` hits the real services and has its own config; it is
    // run deliberately via `npm run smoke`, never as part of `npm test`.
    exclude: ["tests/**/*.live.test.ts", "node_modules/**"],
  },
  resolve: {
    alias: {
      // src imports `requestUrl` etc. from "obsidian"; the real module only
      // exists inside the app, so tests resolve it to a stub.
      obsidian: new URL("./tests/obsidian-stub.ts", import.meta.url).pathname,
    },
  },
});
