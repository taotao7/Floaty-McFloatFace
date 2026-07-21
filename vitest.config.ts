import { defineConfig } from "vitest/config";

// Node-environment test config. We deliberately avoid jsdom here — the
// recording pipeline's pure functions (coords, filename, mime negotiation)
// don't need a DOM, and component-level testing is deferred. Add jsdom per-
// file when a test actually needs `window`/`document`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    // Some source uses `@/`-style would-be aliases; keep resolution loose.
    alias: {},
  },
});
