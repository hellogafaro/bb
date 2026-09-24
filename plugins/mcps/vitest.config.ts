import path from "node:path";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    silent: "passed-only",
    testTimeout: 15_000,
    server: {
      deps: {
        inline: [/@modelcontextprotocol\//, "eventsource"],
      },
    },
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      aliases: { "@": path.resolve(import.meta.dirname, ".") },
      name: "bb-plugin-mcps",
      include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
      exclude: ["dist/**", "node_modules/**"],
    }),
  },
});
