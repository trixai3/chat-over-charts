import type { ReactNode } from "react";
import type { QueryStats } from "@/shared/view-spec";
import { formatStats } from "@/shared/format";

export function TileFrame({
  title,
  stats,
  children,
}: {
  title?: string;
  stats?: QueryStats;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/15 dark:bg-white/5">
      {title && (
        <h3 className="mb-3 text-sm font-medium text-black/70 dark:text-white/70">{title}</h3>
      )}
      <div className="flex-1">{children}</div>
      {stats && (
        <div className="mt-3 border-t border-black/5 pt-2 font-mono text-[11px] text-black/40 dark:border-white/10 dark:text-white/40">
          {formatStats(stats.rowsRead, stats.elapsedMs)}
        </div>
      )}
    </div>
  );
}
