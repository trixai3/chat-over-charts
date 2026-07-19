import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "kpi" }>;

export function KpiTile({ spec }: { spec: Spec }) {
  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <p className="text-4xl font-semibold tracking-tight">{formatValue(spec.value, spec.format)}</p>
      <p className="mt-1 text-sm text-black/45 dark:text-white/45">{spec.label}</p>
      {spec.comparison && (
        <p className="mt-3 font-mono text-xs text-black/55 dark:text-white/55">
          {spec.comparison.label}: {formatValue(spec.comparison.value, spec.comparison.format)}
        </p>
      )}
    </TileFrame>
  );
}
