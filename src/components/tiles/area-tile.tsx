"use client";

import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "area" }>;

const W = 480;
const H = 140;
const PAD = 4;
const COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];

/**
 * Stacked, not overlaid: chart-policy only reaches "area" for an additive
 * measure (finalizeFigure downgrades single-series requests to timeseries),
 * so summing series cumulatively per time point is truthful here.
 */
export function AreaTile({ spec }: { spec: Spec }) {
  const times = [...new Set(spec.series.flatMap((series) => series.points.map((point) => point.t)))].sort();
  const stacks = times.map((t) => {
    let running = 0;
    return spec.series.map((series) => {
      const value = series.points.find((point) => point.t === t)?.v ?? 0;
      const base = running;
      running += value;
      return { base, top: running };
    });
  });
  const maxTotal = Math.max(...stacks.map((stack) => stack[stack.length - 1]?.top ?? 0), 1);
  const x = (t: string) => {
    const index = times.indexOf(t);
    return times.length === 1 ? W / 2 : (index / (times.length - 1)) * (W - PAD * 2) + PAD;
  };
  const y = (value: number) => H - PAD - (value / maxTotal) * (H - PAD * 2);

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
        {spec.series.map((series, seriesIndex) => {
          const top = times
            .map((t, index) => `${index === 0 ? "M" : "L"} ${x(t)} ${y(stacks[index][seriesIndex].top)}`)
            .join(" ");
          const bottom = times
            .map((t, index) => `L ${x(t)} ${y(stacks[index][seriesIndex].base)}`)
            .reverse()
            .join(" ");
          return (
            <path
              key={series.label}
              d={`${top} ${bottom} Z`}
              fill={COLORS[seriesIndex % COLORS.length]}
              fillOpacity={0.55}
              stroke={COLORS[seriesIndex % COLORS.length]}
              strokeWidth={1}
            />
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-black/50 dark:text-white/50">
        {spec.series.map((series, index) => (
          <span key={series.label} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
            {series.label}
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>{times[0]}</span>
        <span>
          {times[times.length - 1]} · total {formatValue(maxTotal, spec.format)}
        </span>
      </div>
    </TileFrame>
  );
}
