import { tool } from "ai";
import { z } from "zod";
import { describeDataSource, explainSemanticTerm, planAnalysis } from "../analysis/semantic-model";
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
    .enum(["single_value", "trend", "category_comparison", "detail", "distribution"])
    .optional()
    .describe(
      "The analytical intent. single_value: one headline number ('what is the median in X'). " +
        "trend: change over ordered time ('how did prices change'). category_comparison: rank or " +
        "compare groups ('which district is highest'). detail: inspect exact rows. distribution: " +
        "how values spread within one population ('what do prices look like in X', 'price histogram').",
    ),
  measures: z
    .array(z.string())
    .default([])
    .describe(
      "The user's own measure wording (or governed IDs once resolved). " +
        "Never SQL expressions, and never substitute a different aggregation than the user asked for.",
    ),
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
        field: z
          .string()
          .describe(
            "Best-guess field. For place names any guess is fine — values are resolved " +
              "against governed reference data, so never ask the user which field a place is.",
          ),
        operator: z.enum(["equals", "in", "between", "gte", "lte"]),
        value: filterValue,
      }),
    )
    .default([]),
  orderBy: z
    .array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }))
    .default([]),
  preferredFigure: z
    .enum(["kpi", "timeseries", "comparison", "table", "pie", "scatter", "area"])
    .optional()
    .describe(
      "Only set when the user names a chart style or their wording clearly implies one; otherwise " +
        "omit — the chart policy picks a default and reports compatible alternatives. When to use " +
        "each: kpi shows one isolated value; timeseries (line) shows continuous change over time; " +
        "area shows shifts in additive composition over time; comparison (bar) compares categories; " +
        "pie shows proportional shares of an additive whole (counts, never medians); scatter shows " +
        "correlation between two measures; table shows exact values. A distribution figure comes " +
        "from analysisType 'distribution', never from this field.",
    ),
  limit: z.number().int().min(1).max(1000).optional(),
  seriesSelection: z
    .object({
      method: z.literal("top"),
      n: z.number().int().min(1).max(8),
      by: z.string().optional().describe("Governed measure term used to rank the series."),
    })
    .optional()
    .describe(
      "Only after the user confirms a series scope via requestClarification. Never invent it.",
    ),
  comparison: z
    .enum(["vs_previous_period"])
    .optional()
    .describe(
      "For change/growth questions: display each measure as its % change versus the previous period. " +
        "Requires a time dimension (trend).",
    ),
});

export function planSummary(plan: AnalysisPlanResult): string {
  if (plan.status === "ready") {
    return [
      "READY",
      `analysis=${plan.request.analysisType}`,
      `measures=${plan.request.measures.join(",")}`,
      `dimensions=${plan.request.dimensions.map((item) => `${item.field}${item.grain ? `:${item.grain}` : ""}`).join(",") || "none"}`,
      `filters=${plan.request.filters.map((item) => `${item.field}:${item.operator}:${Array.isArray(item.value) ? item.value.join("|") : item.value}`).join(",") || "none"}`,
      `series=${plan.request.seriesSelection ? `top ${plan.request.seriesSelection.n} by ${plan.request.seriesSelection.by}` : "all"}`,
      `comparison=${plan.request.comparison ?? "none"}`,
      `figure=${plan.figure}`,
      `alternatives=${plan.figureAlternatives.join(",") || "none"}`,
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

/**
 * Definition questions ("how did you calculate X?") are answered from the
 * semantic layer alone — no SQL runs, and the reply is still a tile, not prose.
 */
export const explainSemantics = tool({
  description:
    "Explain how a governed measure or dimension is defined and calculated, using only the semantic layer. " +
    "Use when the user asks how a value was calculated or what a term means. Never runs a query. " +
    "Do not use for questions unrelated to the connected data.",
  inputSchema: z.object({
    sourceId: z.string().default("uk-house-prices"),
    term: z.string().describe("The measure or dimension the user asked about, in their words."),
  }),
  execute: async ({ sourceId, term }): Promise<ViewSpec> => explainSemanticTerm(sourceId, term),
  toModelOutput: ({ output }) => ({
    type: "text",
    value:
      (output as ViewSpec).kind === "notice"
        ? `Definition tile shown: ${(output as Extract<ViewSpec, { kind: "notice" }>).title}`
        : "Definition tile shown.",
  }),
});

/**
 * One line is all the model needs from the catalog tile: the governed names it
 * can use in follow-up inspectAnalysis calls. The full tile (descriptions,
 * examples, provenance) is rendering data and stays on the frontend.
 */
export function catalogSummary(spec: ViewSpec): string {
  if (spec.kind !== "table") {
    return spec.kind === "notice" ? `Catalog unavailable: ${spec.message}` : "Catalog tile shown.";
  }
  const names = (role: string) =>
    spec.rows
      .filter((row) => row.role === role)
      .map((row) => row.name)
      .join(", ");
  return (
    `Catalog tile shown: measures [${names("measure")}]; dimensions [${names("dimension")}]. ` +
    `${spec.explanation.scope.join("; ")}.`
  );
}

/**
 * The "what can I ask?" channel. Reads the semantic model registry only — no
 * SQL — so broad questions about the data get a catalog tile, not a refusal.
 */
export const describeData = tool({
  description:
    "Show a catalog tile of what the connected data can answer: every governed measure and " +
    "dimension, the source, its row scale, covered date range, and last refresh. Use when the " +
    "user asks what data is available, what they can ask, or where the data comes from. Never " +
    "runs a query.",
  inputSchema: z.object({
    sourceId: z.string().default("uk-house-prices"),
  }),
  execute: async ({ sourceId }): Promise<ViewSpec> => describeDataSource(sourceId),
  toModelOutput: ({ output }) => ({
    type: "text",
    value: catalogSummary(output as ViewSpec),
  }),
});

/** The only final answer channel; loose assistant prose remains forbidden. */
export const emitVerdict = tool({
  description:
    "Deliver the final answer as a one-line verdict tile. This is the ONLY way to conclude. " +
    "Call it exactly once, last, after renderAnalysis. The headline and detail may state only " +
    "facts present in renderAnalysis's summary (its displayed window, scope, and values) — never " +
    "the requested-but-not-displayed range.",
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
  describeData,
  inspectAnalysis,
  requestClarification,
  renderAnalysis,
  explainSemantics,
  emitVerdict,
};
