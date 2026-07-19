import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent tests live next to the agent in trigger/; shared-code tests in src/.
    // Trigger's own build excludes *.test.ts, so these files never ship.
    include: ["trigger/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
