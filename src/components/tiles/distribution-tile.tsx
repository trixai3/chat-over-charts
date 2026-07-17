"use client";

import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "distribution" }>;

/**
 * Histograms exist here to make skew visible. House prices are heavily
 * right-skewed, which is why every metric in this product is a median — showing
 * the shape is how we justify that choice without a paragraph.
 */
export function DistributionTile({ spec }: { spec: Spec }) {
  const maxCount = Math.max(...spec.bins.map((b) => b.count));
  const lo = spec.bins[0].from;
  const hi = spec.bins[spec.bins.length - 1].to;
  const medianPct =
    spec.median !== undefined ? ((spec.median - lo) / (hi - lo || 1)) * 100 : undefined;

  return (
    <TileFrame title={spec.title} stats={spec.stats}>
      <div className="relative">
        <div className="flex h-32 items-end gap-[2px]">
          {spec.bins.map((b) => (
            <div
              key={`${b.from}-${b.to}`}
              className="flex-1 rounded-t-[2px] bg-sky-500/60"
              style={{ height: `${Math.max((b.count / maxCount) * 100, 1)}%` }}
              title={`${formatValue(b.from, spec.unit)}–${formatValue(b.to, spec.unit)}: ${b.count}`}
            />
          ))}
        </div>
        {medianPct !== undefined && (
          <div
            className="absolute inset-y-0 border-l-2 border-dashed border-amber-500"
            style={{ left: `${medianPct}%` }}
          >
            <span className="absolute -top-1 left-1 font-mono text-[10px] whitespace-nowrap text-amber-600 dark:text-amber-400">
              median {formatValue(spec.median!, spec.unit)}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>{formatValue(lo, spec.unit)}</span>
        <span>{formatValue(hi, spec.unit)}</span>
      </div>
    </TileFrame>
  );
}
