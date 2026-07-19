import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs, type LanguageModel } from "ai";
import { z } from "zod";
import { getModel } from "../src/shared/model";
import { analysisTools } from "../src/agent/tools";

/**
 * The chat agent. In Trigger.dev's model this single task IS the backend — each
 * conversation runs as one durable run, and `useTriggerChatTransport` on the
 * frontend talks to it directly. No Next.js API routes (AGENTS.md invariant 7).
 *
 * Control flow is a tool loop, not a prompt chain: one `streamText` with
 * `stopWhen: stepCountIs(15)`, and the model picks its own steps until it calls
 * emitVerdict and stops (AGENTS.md invariant 4).
 */

/**
 * Wire data from the frontend. The only field today is an optional `model`,
 * which is how tests inject a `MockLanguageModelV3` (see house-agent.test.ts).
 * In production the frontend sends nothing here and we fall back to getModel().
 * A `LanguageModel` isn't JSON, so we use `z.custom` rather than a real schema —
 * this object never crosses the network in prod, it only exists in-process
 * during tests.
 */
type ClientData = { model?: LanguageModel };

// Declared once here, read back typed off the run() payload. Declaring on the
// config (not just streamText) is what makes each tool's toModelOutput survive
// history re-conversion from turn 2 onward (AGENTS.md invariant 3).
const tools = analysisTools;

const SYSTEM_PROMPT = [
  "You turn analytical questions into governed figures.",
  "You never write prose. The user sees tiles, not chat text.",
  "Never write SQL, table names, joins, or ViewSpecs.",
  "For each request call inspectAnalysis first using semantic terms from the question.",
  "If it reports NEEDS_CLARIFICATION, call requestClarification with its supported options.",
  "If it reports READY, call renderAnalysis using the exact resolved semantic IDs.",
  "After a figure renders, finish by calling emitVerdict exactly once.",
].join(" ");

export const houseAgent = chat
  .withClientData({ schema: z.custom<ClientData>() })
  .agent({
    id: "house-agent",
    tools,
    run: async ({ messages, tools, clientData, signal }) =>
      streamText({
        // Spread first so our explicit fields below win — this also wires up
        // compaction/steering via prepareStep (backend.mdx warning).
        ...chat.toStreamTextOptions({ tools }),
        // The injection seam: tests pass a mock; prod falls back to the env
        // switch in getModel().
        model: clientData?.model ?? getModel(),
        system: SYSTEM_PROMPT,
        messages,
        abortSignal: signal,
        stopWhen: stepCountIs(15),
      }),
  });
