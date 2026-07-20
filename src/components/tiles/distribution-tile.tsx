"use client";

import { useState } from "react";
import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";
import { ChartTooltip } from "./chart-tooltip";

type Spec = Extract<ViewSpec, { kind: "distribution" }>;

/**
 * Histograms exist here to make skew visible. House prices are heavily
 * right-skewed, which is why every metric in this product is a median — showing
 * the shape is how we justify that choice without a paragraph.
 */
export function DistributionTile({ spec }: { spec: Spec }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const maxCount = Math.max(...spec.bins.map((b) => b.count));
  const lo = spec.bins[0].from;
  const hi = spec.bins[spec.bins.length - 1].to;
  const medianPct =
    spec.median !== undefined ? ((spec.median - lo) / (hi - lo || 1)) * 100 : undefined;
  const hoverBin = hoverIndex === null ? undefined : spec.bins[hoverIndex];

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <div className="relative">
        <div className="flex h-32 items-end gap-[2px]" onPointerLeave={() => setHoverIndex(null)}>
          {spec.bins.map((b, index) => (
            <div
              key={`${b.from}-${b.to}`}
              className={`chart-bar flex-1 rounded-t-[3px] bg-[var(--series-1)] ${
                hoverIndex !== null && hoverIndex !== index ? "opacity-50" : ""
              }`}
              style={{
                height: `${Math.max((b.count / maxCount) * 100, 1)}%`,
                animationDelay: `${index * 22}ms`,
                transition: "opacity 120ms",
              }}
              onPointerEnter={() => setHoverIndex(index)}
            />
          ))}
        </div>
        {/* The median is an annotation, not data — it wears ink, not a series hue,
            and dashing keeps it from reading as a ninth bar. */}
        {medianPct !== undefined && (
          <div
            className="pointer-events-none absolute inset-y-0 border-l border-dashed"
            style={{ left: `${medianPct}%`, borderColor: "var(--chart-annotation)" }}
          >
            <span
              className="absolute -top-1 left-1 font-mono text-[10px] whitespace-nowrap"
              style={{ color: "var(--chart-annotation)" }}
            >
              median {formatValue(spec.median!, spec.format)}
            </span>
          </div>
        )}
        {hoverBin && hoverIndex !== null && (
          <ChartTooltip
            style={{
              left: `${Math.min(88, Math.max(12, ((hoverIndex + 0.5) / spec.bins.length) * 100))}%`,
              top: 0,
            }}
          >
            <div className="font-mono text-[10px] text-black/50 dark:text-white/50">
              {formatValue(hoverBin.from, spec.format)} – {formatValue(hoverBin.to, spec.format)}
            </div>
            <div className="font-mono text-[11px] tabular-nums">
              {hoverBin.count.toLocaleString("en-GB")} sales
            </div>
          </ChartTooltip>
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>{formatValue(lo, spec.format)}</span>
        <span>{formatValue(hi, spec.format)}</span>
      </div>
    </TileFrame>
  );
}
