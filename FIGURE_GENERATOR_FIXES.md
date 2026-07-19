# Figure Generator Fixes — 19 July 2026

**Trigger:** testing "show me average price change per district in london over time" returned a
single line with meaningless values, and "median price" behaviour bled into questions that never
asked for it.

**Diagnosis method:** the failing drafts were replayed deterministically through `planAnalysis` →
`compileClickHouseQuery` → `runAnalysis` against live ClickHouse, with no LLM involved. Every
failure reproduced.

## What was actually wrong

The redesign's pipeline skeleton (draft → resolve → policy → compile → validate → render) worked.
The failures were four **undeclared drifts** from `figure-generator-process-design.md`:

| # | Drift | Design section it violated | Observed symptom |
|---|---|---|---|
| 1 | `five_year_price_change_pct` and `latest_median_price` embed `today()`-relative windows *inside* the aggregate, and nothing checked measure × time-dimension compatibility | §10.3 (measure behaviour over time), §15.2 (analytical validation) | "price change … over time" compiled to `GROUP BY year` over a trailing-12-month window — a line of zeros |
| 2 | `"price change"` / `"price growth"` were synonyms of the five-year snapshot, so loose wording silently resolved to the wrong calculation | §9.1 (ask when the metric definition is material) | Wrong SQL with no clarification |
| 3 | Empty `measures` silently defaulted to `median_price`; "average X" had no path to a clarification about the medians-only policy | §2 non-goal ("never silently guess"), §5.2 (aggregation is part of intent) | Old median behaviour appearing uninvited |
| 4 | Dimension `cardinality` metadata existed but was never consulted before querying; a wide trend ran, hit the 1000-row cap, and dead-ended | §5.4 (capability inspection), §9.1/§11 (series-scope clarification) | Agent's only escape was dropping `district` → the single line |

## The fixes

### 1. Measures now declare `temporalScope` (`src/analysis/types.ts`)

`groupable` — aggregates within any displayed grain. `window` — embeds a fixed calendar window, so
grouping by time is meaningless. `period_change` — a groupable base aggregate that the SQL adapter
turns into "% change vs previous displayed period". The field is **required**, so onboarding a new
model forces the author to think about it.

### 2. A real per-period change measure (`src/analysis/models/uk-house-prices.ts`)

`median_price_change_pct` owns the `"price change"` / `"price growth"` synonyms now. Its
`expression` is the per-period median; the ClickHouse adapter compiles the change with a window
function so the generated SQL stays complete and inspectable:

```sql
round(100 * (median - lagInFrame(median, 1) OVER trend_window) / nullIf(lagInFrame(...), 0), 1)
...
WINDOW trend_window AS (PARTITION BY district ORDER BY sale_date ASC
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

The first period of each series is NULL by construction (no predecessor); the pipeline drops those
rows and the measure's registered limitations disclose the omission. The five-year snapshot keeps
only its precise synonyms ("five year growth", "5 year growth", "five year change").

### 3. planAnalysis guards (`src/analysis/semantic-model.ts`)

- **No silent measure default.** `measures: []` now returns a clarification, not `median_price`.
- **Average → median is a question, not a guess.** If a term like "average price change" fails to
  resolve but resolves once the aggregation word is stripped, the clarification explains the
  medians-only policy and recommends the governed equivalent. Term-based, so confirming once
  cannot loop.
- **Window × time-dimension is refused with alternatives.** "Latest median price by year" now asks
  which time-compatible measure to use (recommending the period-change one) instead of compiling
  nonsense.
- **Period-change without a time dimension is refused with alternatives** (recommending the
  five-year window measure for comparisons).
- **Series scope is asked before the query runs.** A trend over a category whose estimated series
  count (equals filter → 1, in filter → list length, otherwise registered cardinality) exceeds the
  8-line policy returns a `seriesSelection` clarification: *top-8 by transactions* (recommended) or
  *switch to a comparison*. Nothing is truncated silently — the choice is the user's, per design
  §9.1.

### 4. Confirmed top-N series selection (`types.ts`, `clickhouse-adapter.ts`, `tools.ts`)

`seriesSelection: { method: "top", n ≤ 8, by? }` is a new draft field the model may pass **only
after the user confirms it**. It compiles to a governed subquery over the same filtered population
(`district IN (SELECT district … ORDER BY count() DESC LIMIT 8)`), reusing the same named
parameters so values still never enter SQL text. The ranking measure defaults to the model's
`defaults.seriesRankMeasure` (transactions). The confirmed rule is disclosed in the explanation
scope ("Confirmed series scope: top 8 by Transactions").

### 5. Governed filter values with disambiguation (added later the same day)

The resolver governed filter *fields* but passed *values* through untouched, so "London" compiled
to `county = 'LONDON'` — zero rows, because the stored value is `GREATER LONDON`. This violated
design §5.3 ("multiple possible matches") and §5.4, and dropped the pre-redesign "don't guess
place names" disambiguation flow.

The fix follows the Snowflake `sample_values` pattern, using the dimensions already recorded in
the semantic layer:

- `scripts/snapshot-dimension-values.mjs` snapshots the distinct values of every category
  dimension at onboarding (132 counties, 467 districts, 1,173 towns, 5 property types, 3 tenures —
  32 KB) into `src/analysis/models/uk-house-prices.values.ts`, referenced by each dimension's new
  `values` field. Planning stays synchronous, offline, and deterministic; rerun the script after a
  data refresh.
- `resolveFilter` now validates string values for `equals`/`in`: an exact value in the resolved
  dimension passes; a term with **exactly one** governed interpretation anywhere is auto-applied
  as a correction ("flats" → property type `flat` — not a guess when only one reading exists);
  **multiple** interpretations return a disambiguation clarification ("London" → town `LONDON`
  [exact, recommended], county `GREATER LONDON`, district `CITY OF LONDON` …), ranked exact-first
  then coarsest-geography-first; **zero** matches return unsupported with the term named, instead
  of a doomed query and a misleading "broaden the date range" notice.
- Dimensions without a snapshot (e.g. the onboarding-test model) keep passthrough behaviour, so
  value governance is opt-in per dimension.

### 6. Simplification: measures are plain aggregates, change is a comparison (evening rework)

Testing showed the semantic layer was over-complicated: `temporalScope`, a stored per-period
change measure, and two fixed-window snapshot measures — machinery that existed only to keep the
old demo's KPI-card measures safe. The industry shape (Snowflake semantic models, Databricks
metric views) is simpler and we adopted it:

- **A measure is always a plain aggregate over the fact table.** The model now has exactly two:
  `median_price` and `transaction_count`. Any measure is valid at any displayed grain, so the
  whole `temporalScope` taxonomy and its two clarification guards were deleted.
- **Time math is a query-time construct.** The request gained `comparison: "vs_previous_period"`;
  the SQL adapter wraps each aggregate in the lag window, the pipeline switches display format to
  percent and labels to "— % change vs previous period". One rule replaced three: a comparison
  requires a time dimension.
- **"price change" / "sales growth" auto-resolve** to base measure + comparison (exact, no
  clarification needed), which removes one HITL turn from change questions.
- **Time scoping is a filter**, not a measure: "latest price" is `median_price` with a recent
  date filter; the trailing-12-month and five-year-window measures were deleted with their
  synonyms.

Trade-off, stated deliberately: the canned "five-year growth" comparison is gone. A
window-vs-window comparison ("change between 2021 and 2026 per borough") is a Phase-2 comparison
kind, and it belongs in the request like this one does — not in the measure list. The gallery
fixture and the "rose fastest" suggestion chip were updated accordingly.

Also in this pass: `.trigger/**` (generated worker build artifacts) added to the eslint ignores.

### 7. Ask less: resolve from reference data before ever asking (evening rework)

Testing "Show Lambeth median prices by year since 2015" produced a needless question ("Which
field best represents where Lambeth is?") and then a runtime ClickHouse error
(`CANNOT_PARSE_DATE` for the bare year "2015"). Both violated §9.2 ("do not ask for information
already available"). Two refinements:

- **Field inference from values.** When a filter's *field* term is unknown ("location", "place"),
  the resolver now looks the *value* up across every governed value domain. "Lambeth" exists only
  as a district → field and value both resolve silently. An in-list resolves when exactly one
  dimension fits every element. Only a genuinely ambiguous value ("London") still asks — and it
  asks the value question, never "which field is this?".
- **Time-bound normalization.** "since 2015" → `sale_date >= 2015-01-01`; "in 2015" (equals a
  bare year) → the whole-year `between`; bare months get their real last day. Unparseable date
  text is refused at planning time instead of exploding inside ClickHouse.

Verified in the browser: the Lambeth chip now goes question → figure with zero clarifications.

### 8. Testing round 2: recency guard, definition questions, live process (19 July, evening)

Three refinements from user testing on the `test-process-with-more` branch:

- **"Latest" is a window choice, not a word to drop.** "Top 10 districts with latest median
  price" sailed through with an all-time median because nothing questioned the recency word. The
  fix is a deterministic guard in `planAnalysis` (never a prompt — DeepSeek proved prompts get
  ignored): a snapshot question using latest/current/recent with no time filter returns a
  clarification whose options are anchored to the source's real freshness — trailing 12 months
  (recommended), latest full year, all time. "Latest median price" as a measure term resolves to
  the base measure via recency-word stripping so only ONE question is asked, about the window.
- **"How did you calculate X?" is now answerable.** `explainSemantics` (new tool in
  `src/agent/tools.ts`, resolver in `semantic-model.ts`) reads the semantic layer only — no SQL —
  and renders a definition tile: description, aggregation, expression, version, source freshness,
  limitations. Ungoverned terms are refused with the governed vocabulary as suggestions;
  off-topic questions are refused via a neutral verdict (system prompt).
- **The process streams.** The static "Resolving semantics · planning query…" line in `chat.tsx`
  now derives from the streamed tool parts — each tool call IS a pipeline stage, so the label
  tracks the run live (resolving → querying → validating → verdict) with no extra channel.
- Prompt hardening: the agent is told never to invent its own clarification questions — it
  relays inspectAnalysis options verbatim and acts on option descriptions directly.

Ops note for local dev: after switching worktrees, `preview_start` kept launching `next dev`
from the *old* worktree path (stale frontend, current worker — confusing to debug). The dev
server must run from the active worktree; verify with `lsof -p <pid> | grep cwd`.

## What the fixed flow does for the original question

1. `inspectAnalysis` with "average price change" → clarification: *averages aren't governed here
   (right-skewed prices); use "Median-price change vs previous period"?*
2. User confirms → trend per district resolves, but 467 districts > 8 → clarification: *top 8 by
   transactions, or switch to a comparison?*
3. User confirms top-8 → READY → SQL with the lag window + top-N subquery → multi-series
   year-over-year change per major London district, first year omitted and disclosed.

## Verification

- New offline tests: `src/analysis/temporal-guards.test.ts` (silent default, lossy average,
  window×time, change-without-time, pre-query series scope, top-N + window SQL compilation,
  null-first-period handling through the pipeline).
- New live test in `src/analysis/live-uk-house-prices.test.ts` replays the original failing
  question end-to-end against ClickHouse and asserts a multi-series, non-zero result.
- Existing suite unchanged in behaviour: the window measures remain valid in comparison/KPI
  contexts, and no prior test relied on the removed silent default.

## Still open (unchanged from the implementation notes)

Small multiples (the design's preferred answer for 8–30 series) remain Phase-2; the interim policy
is confirmed top-N or a comparison. Value matching is exact/containment only — a typo like
"Lambth" is refused rather than fuzzy-corrected; edit-distance suggestions would be a small
follow-up slice if refusals show up in practice.
