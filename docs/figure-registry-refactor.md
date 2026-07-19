# Deferred refactor: per-kind figure registry

**Status: not started — do this together with the grouped-column chart, or after the hackathon.**
Recorded 2026-07-19 after an architecture review. The pain is real but only pays off
when more figure kinds are added; mid-hackathon the flat switches are fine.

## The problem

Adding one figure kind currently touches ~5 scattered places:

1. the `ViewSpec` discriminated union (`src/shared/view-spec.ts`)
2. `compatible()` + `CANDIDATES` + `finalizeFigure()` in `src/analysis/chart-policy.ts`
3. the `buildSpec` switch in `src/analysis/pipeline.ts`
4. a tile component in `src/components/tiles/`
5. the `RENDERERS` registry in `src/components/tile-renderer.tsx`

The compiler enforces completeness (`satisfies Record<FigureKind, …>` and the exhaustive
switches), so nothing can be *forgotten* — but the change is a vertical slice across five
files instead of a registration.

## The design (one sentence)

One figure = one server-side definition object + one client tile; two registries, and the
compiler proves both registries are complete.

```ts
// src/analysis/figures/pie.ts
export const pieFigure: FigureDefinition = {
  kind: "pie",
  compatible(request, model) { /* hard data-role rules */ },
  finalize(profile) { /* post-query shape guards / downgrades */ },
  build(execution, plan, model, manifest): ViewSpec { /* spec construction */ },
};

// src/analysis/figures/index.ts
export const FIGURES = {
  pie: pieFigure, kpi: kpiFigure, /* … */
} satisfies Record<FigureKind, FigureDefinition>;
```

- `chart-policy.ts` keeps only the cross-kind knowledge: the ranked `CANDIDATES` order per
  analysis type (which figure suits which intent is a *policy* judgement, not a property of
  a single figure) — its `compatible`/`finalize` bodies delegate to `FIGURES[kind]`.
- `pipeline.ts`'s `buildSpec` becomes `FIGURES[kind].build(...)`.
- New kind = `figures/<kind>.ts` + `tiles/<kind>-tile.tsx` + one line in each registry
  + a fixture. Two files and two lines instead of five scattered edits.

## The boundary that must hold

The server registry must **never import React**. `pipeline.ts` runs inside the Trigger.dev
worker; tiles are client components. So there are necessarily TWO registries — server
`FIGURES` and client `RENDERERS` — each guarded by its own `satisfies`. Merging them into
one table would drag React into the worker bundle. This is a constraint, not a smell.

## Why not now

- Pure structural refactor: zero user-visible behaviour change, moderate diff, and the
  85-test suite is the safety net — safe, but only worth it when the next kind lands.
- Best moment: implement the grouped-column chart (`column` kind — time × category grouped
  bars, zero baseline, negatives allowed, **no additivity requirement**, candidates entry
  under `trend`) *on top of* the new registry, so the refactor is validated by the first
  real addition.
