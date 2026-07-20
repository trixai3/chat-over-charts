"use client";

import { useState } from "react";
import type { ViewSpec } from "@/shared/view-spec";
import { formatValue, timeLabelFormatter } from "@/shared/format";
import { TileFrame } from "./tile-frame";
import { seriesColor } from "./chart-palette";
import { niceTicks } from "./chart-scale";
import { ChartTooltip } from "./chart-tooltip";

type Spec = Extract<ViewSpec, { kind: "timeseries" }>;

const W = 480;
const H = 168;
// Top padding leaves room for the gridline value labels, which sit above their line.
const PAD_TOP = 16;
const PAD_BOTTOM = 8;
const PAD_X = 6;

export function TimeseriesTile({ spec }: { spec: Spec }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const allPoints = spec.series.flatMap((series) => series.points);
  const values = allPoints.map((point) => point.v);
  const times = [...new Set(allPoints.map((point) => point.t))].sort();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (time: string) => {
    const index = times.indexOf(time);
    return times.length === 1 ? W / 2 : (index / (times.length - 1)) * (W - PAD_X * 2) + PAD_X;
  };
  const y = (value: number) => H - PAD_BOTTOM - ((value - min) / span) * (H - PAD_TOP - PAD_BOTTOM);
  const gridValues = niceTicks(min, max);
  const timeLabel = timeLabelFormatter(times);

  const hoverTime = hoverIndex === null ? undefined : times[hoverIndex];
  const hoverRows =
    hoverTime === undefined
      ? []
      : spec.series
          .map((series, index) => ({
            label: series.label,
            color: seriesColor(index),
            value: series.points.find((point) => point.t === hoverTime)?.v,
          }))
          .filter((row): row is typeof row & { value: number } => row.value !== undefined);

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
            <g key={value}>
              <line
                x1={PAD_X}
                y1={y(value)}
                x2={W - PAD_X}
                y2={y(value)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD_X}
                y={y(value) - 4}
                fontSize={10}
                fill="var(--chart-muted)"
                className="font-mono"
              >
                {formatValue(value, spec.format)}
              </text>
            </g>
          ))}
          {hoverTime !== undefined && (
            <line
              x1={x(hoverTime)}
              y1={PAD_TOP}
              x2={x(hoverTime)}
              y2={H - PAD_BOTTOM}
              stroke="var(--chart-baseline)"
              strokeWidth={1}
            />
          )}
          {spec.series.map((series, seriesIndex) => {
            const color = seriesColor(seriesIndex);
            const line = series.points
              .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.t)} ${y(point.v)}`)
              .join(" ");
            const last = series.points[series.points.length - 1];
            const hovered = series.points.find((point) => point.t === hoverTime);
            return (
              <g key={series.label}>
                <path
                  d={line}
                  pathLength={1}
                  className="chart-line"
                  stroke={color}
                  strokeWidth={2}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {last && (
                  <circle
                    className="chart-fade"
                    style={{ animationDelay: "550ms" }}
                    cx={x(last.t)}
                    cy={y(last.v)}
                    r={4}
                    fill={color}
                    stroke="var(--tile-surface)"
                    strokeWidth={2}
                  />
                )}
                {hovered && (
                  <circle
                    cx={x(hovered.t)}
                    cy={y(hovered.v)}
                    r={4}
                    fill={color}
                    stroke="var(--tile-surface)"
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
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
                {spec.series.length > 1 && (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
                    <span className="text-[11px]">{row.label}</span>
                  </>
                )}
                <span className="ml-auto pl-2 font-mono text-[11px] tabular-nums">
                  {formatValue(row.value, spec.format)}
                </span>
              </div>
            ))}
          </ChartTooltip>
        )}
      </div>
      {spec.series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-black/60 dark:text-white/60">
          {spec.series.map((series, index) => (
            <span key={series.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: seriesColor(index) }} />
              {series.label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>{timeLabel(times[0])}</span>
        <span>{timeLabel(times[times.length - 1])}</span>
      </div>
    </TileFrame>
  );
}
