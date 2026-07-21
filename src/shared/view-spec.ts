import { z } from "zod";

/**
 * The only runtime-validated contract: trusted server code builds these specs,
 * then the client parses the serialized value once before rendering it.
 */

export const QueryStats = z.object({
  rowsRead: z.number().int().nonnegative(),
  bytesRead: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().nonnegative(),
  queryId: z.string().optional(),
});
export type QueryStats = z.infer<typeof QueryStats>;

export const ValueFormat = z.discriminatedUnion("style", [
  z.object({ style: z.literal("currency"), currency: z.string().length(3) }),
  z.object({
    style: z.literal("number"),
    maximumFractionDigits: z.number().int().min(0).max(6).default(0),
  }),
  z.object({
    style: z.literal("percent"),
    maximumFractionDigits: z.number().int().min(0).max(4).default(1),
  }),
]);
export type ValueFormat = z.infer<typeof ValueFormat>;

export const ExplanationManifest = z.object({
  whatShown: z.string(),
  calculation: z.string(),
  scope: z.array(z.string()),
  provenance: z.object({
    semanticModel: z.string(),
    source: z.string(),
    lastRefresh: z.string(),
    modelVersion: z.string(),
    measureVersions: z.array(z.string()),
    figurePolicyVersion: z.string(),
    queryId: z.string().optional(),
  }),
  limitations: z.array(z.string()),
  inspect: z.object({
    semanticQuery: z.string(),
    generatedSql: z.string(),
  }),
});
export type ExplanationManifest = z.infer<typeof ExplanationManifest>;

const VerdictSpec = z.object({
  kind: z.literal("verdict"),
  headline: z.string(),
  detail: z.string().optional(),
  tone: z.enum(["good", "bad", "neutral"]).default("neutral"),
});

const KpiSpec = z.object({
  kind: z.literal("kpi"),
  title: z.string(),
  value: z.number(),
  format: ValueFormat,
  label: z.string(),
  comparison: z
    .object({ label: z.string(), value: z.number(), format: ValueFormat })
    .optional(),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

const TimeseriesSpec = z.object({
  kind: z.literal("timeseries"),
  title: z.string(),
  format: ValueFormat,
  series: z
    .array(
      z.object({
        label: z.string(),
        points: z.array(z.object({ t: z.string(), v: z.number() })).min(1),
      }),
    )
    .min(1),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

const ComparisonSpec = z.object({
  kind: z.literal("comparison"),
  title: z.string(),
  metricLabel: z.string(),
  comparisonLabel: z.string().optional(),
  format: ValueFormat,
  rows: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
        delta: z.number().optional(),
      }),
    )
    .min(1),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

const DistributionSpec = z.object({
  kind: z.literal("distribution"),
  title: z.string(),
  format: ValueFormat,
  bins: z.array(z.object({ from: z.number(), to: z.number(), count: z.number() })).min(1),
  median: z.number().optional(),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

const PieSpec = z.object({
  kind: z.literal("pie"),
  title: z.string(),
  metricLabel: z.string(),
  format: ValueFormat,
  slices: z.array(z.object({ label: z.string(), value: z.number() })).min(2),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

const ScatterSpec = z.object({
  kind: z.literal("scatter"),
  title: z.string(),
  xLabel: z.string(),
  yLabel: z.string(),
  xFormat: ValueFormat,
  yFormat: ValueFormat,
  points: z.array(z.object({ label: z.string(), x: z.number(), y: z.number() })).min(2),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

/** Same series schema as TimeseriesSpec — an area is a stacked reading of the same data shape. */
const AreaSpec = z.object({
  kind: z.literal("area"),
  title: z.string(),
  format: ValueFormat,
  series: z
    .array(
      z.object({
        label: z.string(),
        points: z.array(z.object({ t: z.string(), v: z.number() })).min(1),
      }),
    )
    .min(1),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

const TableSpec = z.object({
  kind: z.literal("table"),
  title: z.string(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      format: ValueFormat.optional(),
    }),
  ),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  stats: QueryStats,
  explanation: ExplanationManifest,
});

const NoticeSpec = z.object({
  kind: z.literal("notice"),
  title: z.string(),
  message: z.string(),
  tone: z.enum(["warning", "error", "neutral"]).default("neutral"),
  suggestions: z.array(z.string()).default([]),
});

export const ViewSpec = z.discriminatedUnion("kind", [
  VerdictSpec,
  KpiSpec,
  TimeseriesSpec,
  ComparisonSpec,
  DistributionSpec,
  PieSpec,
  ScatterSpec,
  AreaSpec,
  TableSpec,
  NoticeSpec,
]);

export type ViewSpec = z.infer<typeof ViewSpec>;
export type ViewSpecKind = ViewSpec["kind"];
