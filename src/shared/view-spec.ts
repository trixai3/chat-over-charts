import { z } from "zod";

/**
 * The contract between the agent's tools and the frontend renderer.
 *
 * This schema is the single source of truth: the server constructs specs by type
 * (`ViewSpec`), the client validates them by value (`ViewSpec.safeParse`).
 *
 * Specs are constructed by our own tool code after a ClickHouse query returns —
 * never by the model. The model only picks a tool and fills its params.
 */

export const QueryStats = z.object({
  rowsRead: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
});
export type QueryStats = z.infer<typeof QueryStats>;

/** Levels of the Land Registry geography tree, coarse to fine. */
export const GeoLevel = z.enum(["country", "county", "district", "town", "street"]);
export type GeoLevel = z.infer<typeof GeoLevel>;

/**
 * Where a tile can drill to next. Carried in the spec so the renderer stays
 * generic — it never needs to know anything about UK housing.
 */
export const DrillTarget = z.object({
  label: z.string(),
  level: GeoLevel,
  value: z.string(),
});
export type DrillTarget = z.infer<typeof DrillTarget>;

export const Unit = z.enum(["gbp", "count", "pct"]);
export type Unit = z.infer<typeof Unit>;

const VerdictSpec = z.object({
  kind: z.literal("verdict"),
  headline: z.string(),
  detail: z.string().optional(),
  tone: z.enum(["good", "bad", "neutral"]).default("neutral"),
});

const TimeseriesSpec = z.object({
  kind: z.literal("timeseries"),
  title: z.string(),
  unit: Unit,
  points: z.array(z.object({ t: z.string(), v: z.number() })).min(1),
  drillTargets: z.array(DrillTarget).default([]),
  stats: QueryStats,
});

const ComparisonSpec = z.object({
  kind: z.literal("comparison"),
  title: z.string(),
  metricLabel: z.string(),
  unit: Unit,
  rows: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
        /** Percent change vs the comparison period. Drives the red/green delta. */
        delta: z.number().optional(),
        drill: DrillTarget.optional(),
      }),
    )
    .min(1),
  stats: QueryStats,
});

const DistributionSpec = z.object({
  kind: z.literal("distribution"),
  title: z.string(),
  unit: Unit,
  bins: z.array(z.object({ from: z.number(), to: z.number(), count: z.number() })).min(1),
  median: z.number().optional(),
  stats: QueryStats,
});

/**
 * Rendered when a place name is ambiguous. This is not just a UI state — it is
 * the visible half of Trigger.dev's HITL primitive: the tool that emits this has
 * no `execute`, so the run suspends here until the user picks a candidate.
 */
const DisambiguationSpec = z.object({
  kind: z.literal("disambiguation"),
  query: z.string(),
  prompt: z.string(),
  candidates: z
    .array(
      z.object({
        label: z.string(),
        sublabel: z.string().optional(),
        target: DrillTarget,
      }),
    )
    .min(2),
});

export const ViewSpec = z.discriminatedUnion("kind", [
  VerdictSpec,
  TimeseriesSpec,
  ComparisonSpec,
  DistributionSpec,
  DisambiguationSpec,
]);

export type ViewSpec = z.infer<typeof ViewSpec>;
export type ViewSpecKind = ViewSpec["kind"];
