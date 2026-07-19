"use client";

import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "timeseries" }>;

const W = 480;
const H = 140;
const PAD = 4;
const COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];

export function TimeseriesTile({ spec }: { spec: Spec }) {
  const allPoints = spec.series.flatMap((series) => series.points);
  const values = allPoints.map((point) => point.v);
  const times = [...new Set(allPoints.map((point) => point.t))].sort();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (time: string) => {
    const index = times.indexOf(time);
    return times.length === 1 ? W / 2 : (index / (times.length - 1)) * (W - PAD * 2) + PAD;
  };
  const y = (value: number) => H - PAD - ((value - min) / span) * (H - PAD * 2);

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
        {spec.series.map((series, seriesIndex) => {
          const line = series.points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.t)} ${y(point.v)}`)
            .join(" ");
          return (
            <path
              key={series.label}
              d={line}
              stroke={COLORS[seriesIndex % COLORS.length]}
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      {spec.series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-black/50 dark:text-white/50">
          {spec.series.map((series, index) => (
            <span key={series.label} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
              {series.label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>{times[0]} · {formatValue(min, spec.format)}</span>
        <span>{times[times.length - 1]} · {formatValue(max, spec.format)}</span>
      </div>
    </TileFrame>
  );
}
