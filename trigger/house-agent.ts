import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs, type LanguageModel, type PrepareStepFunction } from "ai";
import { z } from "zod";
import { getModel } from "../src/shared/model";
import { analysisTools } from "../src/agent/tools";
import { bindSource, getBoundSourceId } from "../src/agent/source-context";
import { getSemanticModel } from "../src/analysis/semantic-model";
import { sourcePromptCatalog } from "../src/agent/source-prompt";

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
 * Wire data from the frontend. `model` is how tests inject a
 * `MockLanguageModelV3` (see house-agent.test.ts); in production the frontend
 * sends nothing here and we fall back to getModel(). `sourceId` is how the
 * server/UI binds which source this session analyzes — the model never sees
 * or sets this field (AGENTS.md: the model does not choose the source).
 * A `LanguageModel` isn't JSON, so we use `z.custom` rather than a real schema —
 * this object never crosses the network in prod, it only exists in-process
 * during tests.
 */
type ClientData = { model?: LanguageModel; sourceId?: string };

// Declared once here, read back typed off the run() payload. Declaring on the
// config (not just streamText) is what makes each tool's toModelOutput survive
// history re-conversion from turn 2 onward (AGENTS.md invariant 3).
const tools = analysisTools;

// stepCountIs(n) stops the loop once `steps.length === n` — checked *after*
// each step is appended (ai@6 streamText loop, node_modules/ai/dist/index.js
// ~L4660-5003: prepareStep's `stepNumber` is `steps.length` *before* the step
// runs, so the last step the loop will ever run has stepNumber === n - 1).
const STEP_BUDGET = 15;

// Source-neutral: no measure, dimension, or unit vocabulary belongs here —
// that lives in the bound source's semantic model and reaches the model only
// via sourcePromptCatalog (Slice 4). Mechanics (the tool loop, clarification
// protocol, figure-selection cues) are the only things fixed at this layer.
const GENERIC_SYSTEM_PROMPT = [
  "You turn analytical questions into governed figures.",
  "You never write prose. The user sees tiles, not chat text.",
  "Never write SQL, table names, joins, or ViewSpecs.",
  "For each request call inspectAnalysis first using semantic terms from the question.",
  "Use the user's own measure wording; inspectAnalysis resolves it to a governed measure, and you may compose {field, aggregation} from a value field's vetted menu.",
  "When inspectAnalysis reports that a value matches several governed members, relay those options with requestClarification verbatim — never pick one yourself, not even the largest.",
  "If it reports NEEDS_CLARIFICATION, call requestClarification relaying its options verbatim.",
  "Never invent clarification questions of your own. When a clarification option's description tells you the exact next call, make that call directly.",
  "If it reports READY, call renderAnalysis using the exact resolved semantic IDs.",
  "The verdict must describe what the figure actually displays, as reported by renderAnalysis (its displayed window and scope), not what was requested.",
  "If renderAnalysis reports it cannot render (the result starts 'Cannot render yet'), do not retry it; conclude immediately with emitVerdict (tone bad) whose detail relays the notice's suggestion.",
  "When the user names a chart style, pass it as preferredFigure; the READY summary lists the figure plus compatible alternatives — only switch figures by re-calling renderAnalysis with a preferredFigure from that list.",
  "Map phrasing to figures: 'share of'/'proportion'/'breakdown' suggests pie, 'correlation'/'X vs Y' suggests scatter, 'spread'/'distribution' of values means analysisType distribution, 'over time' means trend; when nothing is implied, omit preferredFigure.",
  "If the user asks how a measure or value is defined or calculated, or about the dataset itself (its source, freshness, or why an aggregation was chosen), call explainSemantics with their term instead of running an analysis.",
  "Threshold questions (a measure compared to a number, e.g. 'where the value is over X') are ordinary filters: pass a filter whose field is the governed measure with operator gte, lte, or between.",
  "If the user asks what data is available, what they can ask, or where the data comes from, call describeData to show the catalog — never refuse these questions.",
  "Only call describeData for those questions. For an analytical question go straight to inspectAnalysis — it resolves the user's own wording into governed IDs itself, so no catalog lookup is needed first.",
  "When the question needs a judgement (which is better, is it expensive, which should I pick), first render the supporting evidence — one or more renderAnalysis calls — then conclude with emitVerdict stating only facts from those render summaries.",
  "If the question is unrelated to the connected data or its figures, call no analysis tool; conclude with emitVerdict (tone neutral) saying only governed analytics for the connected source are supported here.",
  "Finish every turn by calling emitVerdict exactly once.",
].join(" ");

/**
 * The generic block plus the bound source's generated vocabulary catalog
 * (measure synonyms, distribution notes, member-resolution note, pack
 * hints — see source-prompt.ts). Falls back to the generic block alone if no
 * source is bound yet or the id doesn't resolve, rather than crash the run.
 */
function buildSystemPrompt(): string {
  try {
    const model = getSemanticModel(getBoundSourceId());
    if (model) return `${GENERIC_SYSTEM_PROMPT} ${sourcePromptCatalog(model)}`;
  } catch {
    // No source bound yet (e.g. multiple sources registered, none chosen) —
    // fall through to the generic prompt rather than fail the run.
  }
  return GENERIC_SYSTEM_PROMPT;
}

export const houseAgent = chat
  .withClientData({ schema: z.custom<ClientData>() })
  .agent({
    id: "house-agent",
    tools,
    // A session that supplies no sourceId stays unbound and falls back to the
    // sole registered source via getBoundSourceId (single-source deployment).
    onBoot: async ({ clientData }) => {
      if (clientData?.sourceId) bindSource(clientData.sourceId);
    },
    run: async ({ messages, tools, clientData, signal }) => {
      // Spread first so our explicit fields below win — this also wires up
      // compaction/steering via prepareStep (backend.mdx warning).
      const base = chat.toStreamTextOptions({ tools });
      // toStreamTextOptions returns Record<string, unknown> by design (stays
      // version-agnostic across streamText's TOOLS inference); narrow just
      // enough to call it from our own prepareStep below.
      const basePrepareStep = base.prepareStep as PrepareStepFunction<typeof tools> | undefined;

      // Typed explicitly (rather than inline in the streamText call) so
      // `options` resolves against our concrete tool set instead of widening
      // to the generic ToolSet default — streamText's own TOOLS inference is
      // ambiguous here because `base` (spread below) is an untyped Record.
      const prepareStep: PrepareStepFunction<typeof tools> = async (options) => {
        const fromBase = await basePrepareStep?.(options);
        const isFinalStep = options.stepNumber === STEP_BUDGET - 1;
        const verdictAlreadyCalled = options.steps.some((step) =>
          step.toolCalls.some((call) => call.toolName === "emitVerdict"),
        );
        if (!isFinalStep || verdictAlreadyCalled) return fromBase;
        return {
          ...fromBase,
          toolChoice: { type: "tool", toolName: "emitVerdict" },
          activeTools: ["emitVerdict"],
        };
      };

      return streamText({
        ...base,
        // Repeated explicitly (base already carries it, untyped) so
        // streamText's TOOLS generic anchors on our concrete tool set rather
        // than defaulting — that default is what made the `prepareStep`
        // below fail to type-check against it.
        tools,
        // The injection seam: tests pass a mock; prod falls back to the env
        // switch in getModel().
        model: clientData?.model ?? getModel(),
        system: buildSystemPrompt(),
        messages,
        abortSignal: signal,
        stopWhen: stepCountIs(STEP_BUDGET),
        // The no-prose invariant (AGENTS.md #1) is only as strong as its
        // termination guarantee: "finish every turn with emitVerdict" is a
        // system-prompt instruction, not a hard stop — the model can burn the
        // whole step budget without ever calling it. On the final allowed
        // step, mechanically force the call via toolChoice/activeTools so a
        // run can never end verdict-less. `base.prepareStep` must still run
        // every step (not just get overridden away) — it's what drives
        // compaction, mid-turn steering, and background injection; assigning
        // our own `prepareStep` after the spread without calling theirs would
        // silently disable all three (backend.mdx, compaction.mdx).
        prepareStep,
      });
    },
  });
