# Chart coverage

How our figure kinds (`src/analysis/types.ts` `FigureKind`) map onto the
visualization types in Looker's [visualization guide](https://cloud.google.com/looker/docs/visualization-types),
and what we've deliberately left out.

## Mapping

| Looker visualization type | Our figure kind |
|---|---|
| Column / bar | `comparison` |
| Line | `timeseries` |
| Single value | `kpi` |
| Table | `table` |
| Pie & donut | `pie` |
| Scatterplot | `scatter` |
| Area | `area` |
| Boxplot | `distribution` |

`distribution` renders as a histogram rather than a boxplot — both summarize
the spread of one population, but a histogram makes the skew that justifies
our median-over-average policy directly visible, which a five-number-summary
box does not.

## Deliberately not supported

- **Maps** — the governed model (`src/analysis/models/uk-house-prices.ts`) has
  no geographic coordinates, only county/district/town names.
- **Funnel, timeline, waterfall** — the dataset has no sequential-stage
  semantics (no order, no pipeline, no before/after state) for a funnel or
  waterfall to walk through.
- **Word cloud** — there is no text-frequency measure in the semantic model;
  every measure is a numeric aggregate over sale records.
- **Single record** — covered by `table` with `limit: 1` rather than a
  dedicated kind; a one-row table is already a single record.
