import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "table" }>;

export function TableTile({ spec }: { spec: Spec }) {
  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10">
              {spec.columns.map((column) => (
                <th key={column.key} className="px-2 py-2 font-medium text-black/55 dark:text-white/55">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, index) => (
              <tr key={index} className="border-b border-black/5 last:border-0 dark:border-white/5">
                {spec.columns.map((column) => {
                  const value = row[column.key];
                  return (
                    <td key={column.key} className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">
                      {typeof value === "number" && column.format
                        ? formatValue(value, column.format)
                        : value ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TileFrame>
  );
}
