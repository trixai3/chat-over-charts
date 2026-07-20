"use client";

import { useState } from "react";
import type { ViewSpec } from "@/shared/view-spec";
import { formatValue, timeLabelFormatter } from "@/shared/format";
import { TileFrame } from "./tile-frame";
import { seriesColor } from "./chart-palette";
import { niceTicks } from "./chart-scale";
import { ChartTooltip } from "./chart-tooltip";

type Spec = Extract<ViewSpec, { kind: "area" }>;

const W = 480;
const H = 168;
const PAD_TOP = 16;
const PAD_BOTTOM = 8;
const PAD_X = 6;

/**
 * Stacked, not overlaid: chart-policy only reaches "area" for an additive
 * measure (finalizeFigure downgrades single-series requests to timeseries),
 * so summing series cumulatively per time point is truthful here.
 */
export function AreaTile({ spec }: { spec: Spec }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
    return times.length === 1 ? W / 2 : (index / (times.length - 1)) * (W - PAD_X * 2) + PAD_X;
  };
  const y = (value: number) => H - PAD_BOTTOM - (value / maxTotal) * (H - PAD_TOP - PAD_BOTTOM);
  const gridValues = niceTicks(0, maxTotal).filter((value) => value > 0);
  const timeLabel = timeLabelFormatter(times);

  const hoverTime = hoverIndex === null ? undefined : times[hoverIndex];
  const hoverRows =
    hoverTime === undefined
      ? []
      : spec.series.map((series, index) => ({
          label: series.label,
          color: seriesColor(index),
          value: series.points.find((point) => point.t === hoverTime)?.v ?? 0,
        }));
  const hoverTotal = hoverRows.reduce((sum, row) => sum + row.value, 0);

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (times.length < 2) {
      setHoverIndex(0);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * W;
    const raw = ((svgX - PAD_X) / (W - PAD_X * 2)) * (times.length - 1);
    setHoverIndex(Math.min(times.length - 1, Math.max(0, Math.round(raw))));
  };

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={spec.title}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {gridValues.map((value) => (
            <line
              key={value}
              x1={PAD_X}
              y1={y(value)}
              x2={W - PAD_X}
              y2={y(value)}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
          ))}
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
                className="chart-fade"
                style={{ animationDelay: `${seriesIndex * 90}ms` }}
                d={`${top} ${bottom} Z`}
                fill={seriesColor(seriesIndex)}
                fillOpacity={0.85}
                stroke="var(--tile-surface)"
                strokeWidth={2}
              />
            );
          })}
          {hoverTime !== undefined && (
            <line
              x1={x(hoverTime)}
              y1={PAD_TOP}
              x2={x(hoverTime)}
              y2={H - PAD_BOTTOM}
              stroke="var(--chart-annotation)"
              strokeWidth={1}
            />
          )}
          {/* Labels after the fills so the mid-scale value stays readable on top of them. */}
          {gridValues.map((value) => (
            <text
              key={value}
              x={PAD_X}
              y={y(value) - 4}
              fontSize={10}
              fill="var(--chart-muted)"
              stroke="var(--tile-surface)"
              strokeWidth={3}
              paintOrder="stroke"
              className="font-mono"
            >
              {formatValue(value, spec.format)}
            </text>
          ))}
        </svg>
        {hoverTime !== undefined && hoverRows.length > 0 && (
          <ChartTooltip
            style={{
              left: `${Math.min(88, Math.max(12, (x(hoverTime) / W) * 100))}%`,
              top: 0,
            }}
          >
            <div className="font-mono text-[10px] text-black/50 dark:text-white/50">
              {timeLabel(hoverTime)}
            </div>
            {hoverRows.map((row) => (
              <div key={row.label} className="mt-0.5 flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
                <span className="text-[11px]">{row.label}</span>
                <span className="ml-auto pl-2 font-mono text-[11px] tabular-nums">
                  {formatValue(row.value, spec.format)}
                </span>
              </div>
            ))}
            <div className="mt-0.5 flex items-center gap-1.5 border-t border-black/10 pt-0.5 dark:border-white/15">
              <span className="text-[11px]">total</span>
              <span className="ml-auto pl-2 font-mono text-[11px] tabular-nums">
                {formatValue(hoverTotal, spec.format)}
              </span>
            </div>
          </ChartTooltip>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-black/60 dark:text-white/60">
        {spec.series.map((series, index) => (
          <span key={series.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: seriesColor(index) }} />
            {series.label}
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>{timeLabel(times[0])}</span>
        <span>
          {timeLabel(times[times.length - 1])} · total {formatValue(maxTotal, spec.format)}
        </span>
      </div>
    </TileFrame>
  );
}
