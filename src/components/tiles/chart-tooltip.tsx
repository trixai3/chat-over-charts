import type { CSSProperties, ReactNode } from "react";

/**
 * The shared hover readout. Positioned by the owning chart inside a
 * `relative` container (percentage left keeps it correct while the SVG
 * scales); pointer-events-none so it never steals the hover that opened it.
 */
export function ChartTooltip({ style, children }: { style: CSSProperties; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-black/10 bg-[var(--tile-surface)] px-2 py-1.5 shadow-md dark:border-white/15"
      style={style}
    >
      {children}
    </div>
  );
}
