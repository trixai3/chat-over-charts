import { defineConfig } from "@trigger.dev/sdk";

/**
 * Trigger.dev build config. Only `trigger dev` and `deploy` read this — the
 * offline vitest suite imports the agent module directly and never loads it.
 *
 * The project ref comes from the environment so it isn't hard-coded in source;
 * the CLI loads .env.local before evaluating this file. It's not a secret, but
 * keeping it in one place (the env) means there's a single source of truth.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_ref_unset",
  dirs: ["./trigger"],
  // Per-run compute cap in seconds. A chat agent suspends between turns (idle
  // time is unbilled and doesn't count here), so this bounds a single active
  // turn's tool loop — 5 minutes is generous for our ~50ms ClickHouse queries.
  maxDuration: 300,
});
