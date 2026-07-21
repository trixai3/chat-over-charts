import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/ mirrors the source layout: tests/analysis ↔ src/analysis,
    // tests/trigger ↔ trigger/, etc. Nothing here ships in any build.
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
