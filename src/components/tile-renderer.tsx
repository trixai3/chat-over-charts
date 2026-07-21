"use client";

import type { ComponentType } from "react";
import { ViewSpec, type ViewSpecKind } from "@/shared/view-spec";
import { VerdictTile } from "./tiles/verdict-tile";
import { TimeseriesTile } from "./tiles/timeseries-tile";
import { ComparisonTile } from "./tiles/comparison-tile";
import { DistributionTile } from "./tiles/distribution-tile";
import { KpiTile } from "./tiles/kpi-tile";
import { TableTile } from "./tiles/table-tile";
import { NoticeTile } from "./tiles/notice-tile";
import { PieTile } from "./tiles/pie-tile";
import { ScatterTile } from "./tiles/scatter-tile";
import { AreaTile } from "./tiles/area-tile";

export type TileProps = {
  spec: never;
};

/**
 * `satisfies` is doing real work here: add a variant to ViewSpec and forget its
 * renderer, and this fails at build time instead of white-screening mid-demo.
 */
const RENDERERS = {
  verdict: VerdictTile,
  kpi: KpiTile,
  timeseries: TimeseriesTile,
  comparison: ComparisonTile,
  distribution: DistributionTile,
  pie: PieTile,
  scatter: ScatterTile,
  area: AreaTile,
  table: TableTile,
  notice: NoticeTile,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<ViewSpecKind, ComponentType<any>>;

function BrokenTile({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-dashed border-rose-500/40 bg-rose-500/5 p-4">
      <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
        Can’t render this tile
      </p>
      <p className="mt-1 font-mono text-[10px] break-all text-black/40 dark:text-white/40">
        {reason}
      </p>
    </div>
  );
}

/**
 * The one runtime validation boundary in the system.
 *
 * Specs are built by our own tool code, so they can't be hallucinated — but they
 * cross the wire as JSON through Trigger.dev streams and arrive as `unknown`.
 * Parsing here turns a version-skew white screen into a visible broken tile.
 */
export function Tile({ part }: { part: unknown }) {
  const parsed = ViewSpec.safeParse(part);
  if (!parsed.success) {
    return <BrokenTile reason={parsed.error.issues.map((i) => i.message).join("; ")} />;
  }

  const spec = parsed.data;
  const Renderer = RENDERERS[spec.kind] as ComponentType<{ spec: typeof spec }>;

  return <Renderer spec={spec} />;
}
