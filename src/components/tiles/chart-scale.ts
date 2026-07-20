/**
 * Gridline values must be clean numbers (£450,000, not £508,875) — a tick is a
 * reading aid, and a reader can't do arithmetic against an arbitrary value.
 * Standard nice-step algorithm: pick a 1/2/5×10ⁿ step near span/count, then
 * emit the multiples of it that fall inside the domain.
 */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) return [min];
  const span = max - min;
  const rough = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const ratio = rough / magnitude;
  const step = magnitude * (ratio >= 7.5 ? 10 : ratio >= 3.5 ? 5 : ratio >= 1.5 ? 2 : 1);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    ticks.push(v);
  }
  return ticks;
}
