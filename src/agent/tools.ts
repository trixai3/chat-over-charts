import { tool } from "ai";
import { z } from "zod";
import type { ViewSpec } from "../shared/view-spec";

/**
 * The agent's tools. The uniform contract here: **every tool's output IS a
 * ViewSpec** — the exact object the frontend renders. That keeps the frontend
 * dumb (it validates `part.output` once and renders) and lets each tool carry
 * its own `toModelOutput` to compress what the *model* sees down to one line.
 *
 * Two different consumers of one tool result:
 *   - execute()'s return value  → streamed to the frontend as the tile
 *   - toModelOutput()'s return  → what re-enters the model's prompt next step
 * The split is the whole point (AGENTS.md invariant 2): rendering data to the
 * frontend, decision data to the model.
 */

/**
 * The only way the agent is allowed to answer. There is no prose channel: a
 * system prompt saying "don't write paragraphs" is a request the model can
 * ignore; making the verdict a *tool* leaves it no other exit (AGENTS.md
 * invariant 1). The model authors the words, but they land inside a tone-tagged
 * tile, not as loose chat text.
 */
export const emitVerdict = tool({
  description:
    "Deliver the final answer as a one-line verdict tile. This is the ONLY way " +
    "to respond to the user — never write a prose reply. Call it exactly once, " +
    "last, after any data tools have run.",
  inputSchema: z.object({
    headline: z
      .string()
      .describe("The answer in one line, e.g. 'Havering rose fastest: +17.9% over 5 years.'"),
    detail: z
      .string()
      .optional()
      .describe("One short sentence of supporting context. Optional."),
    tone: z
      .enum(["good", "bad", "neutral"])
      .describe("Sentiment colour for the tile: good (green), bad (red), neutral."),
  }),
  // Our code assembles the spec; the model only filled the params. The output
  // type is the VerdictSpec variant of ViewSpec, so the frontend renders it
  // with zero branching.
  execute: async ({ headline, detail, tone }): Promise<ViewSpec> => ({
    kind: "verdict",
    headline,
    detail,
    tone,
  }),
  // The model wrote these words itself — echoing the full tile back into its
  // context on the next step buys nothing and bloats the cache prefix. Collapse
  // it to a one-line acknowledgement. This is the cheap demonstration of the
  // mechanism that compareAreas will lean on hard in slice 2.
  toModelOutput: () => ({
    type: "text",
    value: "Verdict delivered to the user.",
  }),
});
