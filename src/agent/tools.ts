import { tool } from "ai";
import { z } from "zod";
import { planAnalysis } from "../analysis/semantic-model";
import { runAnalysis, summarizeSpec } from "../analysis/pipeline";
import type { AnalysisPlanResult } from "../analysis/types";
import type { ViewSpec } from "../shared/view-spec";

const filterValue = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.array(z.number()),
]);

export const analysisDraftSchema = z.object({
  question: z.string().describe("The user's original analytical question."),
  sourceId: z.string().default("uk-house-prices"),
  analysisType: z
    .enum(["single_value", "trend", "category_comparison", "detail"])
    .optional(),
  measures: z
    .array(z.string())
    .default([])
    .describe("Governed measure IDs, labels, or synonyms. Never SQL expressions."),
  dimensions: z
    .array(
      z.object({
        field: z.string(),
        grain: z.enum(["day", "month", "quarter", "year"]).optional(),
      }),
    )
    .default([]),
  filters: z
    .array(
      z.object({
        field: z.string(),
        operator: z.enum(["equals", "in", "between", "gte", "lte"]),
        value: filterValue,
      }),
    )
    .default([]),
  orderBy: z
    .array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }))
    .default([]),
  preferredFigure: z.enum(["kpi", "timeseries", "comparison", "table"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

function planSummary(plan: AnalysisPlanResult): string {
  if (plan.status === "ready") {
    return [
      "READY",
      `analysis=${plan.request.analysisType}`,
      `measures=${plan.request.measures.join(",")}`,
      `dimensions=${plan.request.dimensions.map((item) => `${item.field}${item.grain ? `:${item.grain}` : ""}`).join(",") || "none"}`,
      `filters=${plan.request.filters.map((item) => `${item.field}:${item.operator}:${Array.isArray(item.value) ? item.value.join("|") : item.value}`).join(",") || "none"}`,
      `figure=${plan.figure}`,
      `reason=${plan.figureReason}`,
      "Call renderAnalysis with these resolved semantic IDs.",
    ].join("; ");
  }
  if (plan.status === "needs_clarification") {
    return `NEEDS_CLARIFICATION; ${plan.ambiguities
      .map(
        (item) =>
          `${item.field}: ${item.question} options=[${item.options.map((option) => `${option.id}:${option.label}`).join("|")}] recommended=${item.recommended} because ${item.reason}`,
      )
      .join("; ")}; call requestClarification.`;
  }
  return `UNSUPPORTED; ${plan.reason}; suggestions=${plan.suggestions.join("|")}`;
}

/** Resolves user terms and applies the chart policy without executing SQL. */
export const inspectAnalysis = tool({
  description:
    "Resolve an analytical request through the selected semantic model and choose a provisional figure. " +
    "Always call this before renderAnalysis. It returns governed IDs or supported clarification choices.",
  inputSchema: analysisDraftSchema,
  execute: async (draft): Promise<AnalysisPlanResult> => planAnalysis(draft),
  toModelOutput: ({ output }) => ({
    type: "text",
    value: planSummary(output as AnalysisPlanResult),
  }),
});

/**
 * Generic HITL boundary. It has no execute function, so Trigger.dev suspends
 * until the frontend adds the selected option as tool output.
 */
export const requestClarification = tool({
  description:
    "Ask one material analytical clarification using only options returned by inspectAnalysis. " +
    "Do not ask about styling or other presentation-only choices.",
  inputSchema: z.object({
    field: z.string(),
    question: z.string(),
    options: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          description: z.string().optional(),
          recommended: z.boolean().default(false),
        }),
      )
      .min(2)
      .max(8),
  }),
});

/** Runs the deterministic query, validation, policy, and ViewSpec pipeline. */
export const renderAnalysis = tool({
  description:
    "Render a governed analysis after inspectAnalysis reports READY. Pass semantic IDs exactly as resolved. " +
    "The application compiles SQL, validates the dataset, selects the chart, and builds the ViewSpec.",
  inputSchema: analysisDraftSchema,
  execute: async (draft): Promise<ViewSpec> => {
    const plan = planAnalysis(draft);
    if (plan.status === "needs_clarification") {
      return {
        kind: "notice",
        title: "One choice is still needed",
        message: plan.ambiguities[0]?.question ?? "The analysis is not fully resolved.",
        tone: "warning",
        suggestions: plan.ambiguities[0]?.options.map((option) => option.label) ?? [],
      };
    }
    if (plan.status === "unsupported") {
      return {
        kind: "notice",
        title: "This analysis is not supported",
        message: plan.reason,
        tone: "warning",
        suggestions: plan.suggestions,
      };
    }
    return (await runAnalysis(plan)).spec;
  },
  toModelOutput: ({ output }) => ({
    type: "text",
    value: summarizeSpec(output as ViewSpec),
  }),
});

/** The only final answer channel; loose assistant prose remains forbidden. */
export const emitVerdict = tool({
  description:
    "Deliver the final answer as a one-line verdict tile. This is the ONLY way to conclude. " +
    "Call it exactly once, last, after renderAnalysis.",
  inputSchema: z.object({
    headline: z.string(),
    detail: z.string().optional(),
    tone: z.enum(["good", "bad", "neutral"]),
  }),
  execute: async ({ headline, detail, tone }): Promise<ViewSpec> => ({
    kind: "verdict",
    headline,
    detail,
    tone,
  }),
  toModelOutput: () => ({ type: "text", value: "Verdict delivered." }),
});

export const analysisTools = {
  inspectAnalysis,
  requestClarification,
  renderAnalysis,
  emitVerdict,
};
