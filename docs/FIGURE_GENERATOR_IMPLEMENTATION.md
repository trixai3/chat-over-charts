# Figure Generator Redesign — Implementation Notes

**Implemented:** 19 July 2026
**Design source:** `figure-generator-process-design.md`
**Scope:** semantic-model-driven SQL, deterministic chart policy, validated figure data, structured explanation, generic agent workflow, UK house-price tests. Drill-down remains a placeholder by explicit product decision.

## 1. Result

The agent no longer exposes housing or chart-specific tools such as `compareAreas`, `priceHistory`, or `buildBarChart`.

The implemented path is:

```text
question
  → inspectAnalysis (intent + semantic resolution + provisional chart)
  → requestClarification (no execute; only when a material choice is unresolved)
  → renderAnalysis
      → semantic query
      → ClickHouse SQL compiler
      → bounded query execution
      → structural dataset validation and profiling
      → final chart policy
      → ViewSpec + ExplanationManifest
  → emitVerdict
```

The LLM selects semantic concepts and writes the final headline. It never writes SQL, physical table names, joins, or ViewSpecs.

## 2. Main implementation

### Semantic layer

- `src/analysis/types.ts` defines analytical intent, semantic models, semantic queries, source adapters, profiles, and plan results.
- `src/analysis/models/uk-house-prices.ts` registers the Land Registry model:
  - governed measures: median price, latest median price, five-year median-price change, transactions;
  - governed dimensions: sale date, county, district, town, property type, tenure;
  - supported time grains, synonyms, formatting, provenance, limitations, and versions.
- `src/analysis/semantic-model.ts` resolves IDs, labels, and synonyms and returns either a ready plan, supported clarification choices, or an unsupported result.
- `registerSemanticModel()` is the onboarding seam. A second test semantic model proves that the agent and figure policy do not need source-specific changes.

### SQL compiler and source adapter

- `src/analysis/clickhouse-adapter.ts` converts a resolved semantic request into ClickHouse SQL.
- Only trusted semantic expressions enter SQL text.
- User values use ClickHouse `{name: Type}` parameters. Template-literal interpolation of user input would be a SQL injection risk and is not used.
- Database and table names use `Identifier` parameters from trusted semantic configuration.
- The adapter applies per-query limits:
  - `max_execution_time = 30`;
  - `max_rows_to_read = 1,000,000,000`;
  - `max_bytes_to_read = 100,000,000,000`;
  - bounded result rows.
- Default result limits are sentinels, not hidden Top-N rules. If the sentinel is reached without an explicit user limit, the chart policy refuses to render incomplete data.

### Chart policy

- `src/analysis/chart-policy.ts` maps analytical purpose to a provisional figure:
  - single value → KPI;
  - trend → timeseries;
  - category comparison → horizontal comparison bars;
  - detail → table.
- The policy runs again after profiling:
  - no rows → notice;
  - one time point → KPI or comparison instead of a misleading line;
  - more than eight line series → narrower scope required;
  - more than forty comparison categories → narrower scope required;
  - a safety cap reached without an explicit limit → no rendering.
- The policy never changes measures, filters, aggregation, or units.

### Dataset validation and ViewSpec construction

- `src/analysis/pipeline.ts` verifies required columns, numeric measure values, and unique dimensional grain before rendering.
- Tool code constructs ViewSpecs after execution; the model never sees or authors them.
- The frontend still has exactly one runtime ViewSpec boundary: `ViewSpec.safeParse` in `tile-renderer.tsx`.
- Added governed KPI, multi-series timeseries, comparison, table, and notice variants. The existing distribution variant remains available in the gallery but is not selected by the MVP policy.

### Explanation and provenance

Every governed figure contains an `ExplanationManifest` with:

- what is shown;
- how measures were calculated;
- filters, grains, and explicit limits;
- semantic model, source, last refresh, model version, measure versions, policy version, and query ID;
- limitations;
- inspectable semantic query and parameterized SQL.

`TileFrame` renders this under a collapsed **How this figure was made** disclosure. It is structured tile content, not loose assistant prose.

### Agent and frontend

- `src/agent/tools.ts` exposes only generic workflow tools:
  - `inspectAnalysis`;
  - `requestClarification`;
  - `renderAnalysis`;
  - `emitVerdict`.
- Tools remain declared on `chat.agent({ tools })`, so `toModelOutput` is reapplied when history is reconstructed on later turns.
- Planning output is compressed for the model and ignored by the visual frontend.
- `requestClarification` has no `execute`. The frontend renders its pending input, supplies `addToolOutput`, and automatically starts the continuation turn.
- Drill callbacks still log a placeholder. There is no `onAction`, breadcrumb, or drill query implementation.

## 3. Adding another source

For another dataset already available to a registered adapter:

1. Discover its tables, columns, comments, sort keys, indexes, sample values, and query plans.
2. Add a `SemanticModel` containing governed measures, dimensions, grains, synonyms, source metadata, and limitations.
3. Register it with `registerSemanticModel()`.
4. Add representative query and figure tests.

No agent tool or renderer is added merely because the business domain changed.

ClickHouse is the only implemented adapter in this version. The `SourceAdapter` interface is the boundary for another dialect or test implementation.

## 4. Adding another chart

A new chart requires:

1. a ViewSpec variant;
2. a deterministic policy rule and data-role requirements;
3. a ViewSpec factory;
4. a renderer;
5. a real-data fixture and policy tests.

It does **not** require a new agent tool.

## 5. ClickHouse decisions and provenance

### Workload summary

- Workload: interactive OLAP over append-only UK property transactions.
- Data shape: 31.3M rows, governed aggregations, geographic and temporal grouping.
- Latency target: interactive first figure; small aggregated result payloads.
- Primary patterns: filtered median trends and category comparisons.

### Rules applied

- `agent-discovery-schema` — source onboarding must discover schema and sort keys before semantic registration. **Official, high confidence.**
- `agent-query-safety` — generated queries use limits, scan caps, and execution timeouts. **Official, high confidence.**
- `schema-pk-filter-on-orderby` — UK tests filter `county` before grouping districts, matching the existing `(county, district, date)` ordering. **Official, high confidence.**
- `query-mv-incremental` — no materialized view was added speculatively. Add one only for a measured repeated append-only aggregation. **Derived decision from official MV behavior, high confidence.**
- Raw-table fallback for ad-hoc governed questions. **Derived, high confidence.** It preserves analytical flexibility; a hot-path MV can be introduced later without changing the semantic request.

Official context:

- https://clickhouse.com/docs/operations/query-complexity
- https://clickhouse.com/docs/best-practices/choosing-a-primary-key
- https://clickhouse.com/docs/materialized-view/incremental-materialized-view

## 6. Verification

The normal suite uses UK house-price rows previously verified against the Land Registry dataset and an injected ClickHouse client. It covers:

- semantic synonym resolution;
- onboarding a second unrelated semantic model;
- governed SQL compilation and value normalization;
- SQL-injection protection;
- ClickHouse scan/time/result settings;
- London borough comparison;
- multi-series Lambeth/Havering trend;
- duplicate-grain rejection;
- generic agent tool inventory;
- no-prose output;
- HITL clarification;
- turn-two/turn-three `toModelOutput` compression.

Verification commands:

```bash
npm run typecheck
<current-node> node_modules/vitest/vitest.mjs run
<current-node> node_modules/eslint/bin/eslint.js .
<current-node> node_modules/next/dist/bin/next build
```

Final acceptance results on 19 July 2026:

- TypeScript: passed;
- ESLint: passed;
- Vitest: 23 passed, 1 credential-gated live test skipped;
- Next.js production build: passed, with `/`, `/_not-found`, and `/gallery` prerendered;
- browser gallery check: every registered figure rendered, the malformed fixture was rejected at the client boundary, and no browser warnings or errors were reported;
- `git diff --check`: passed;
- invariant audit: no API routes, no chart/domain-specific production tools, and one production `ViewSpec.safeParse` boundary.

An opt-in live test exists at `tests/analysis/live-uk-house-prices.test.ts`. It skips without ClickHouse credentials. The managed implementation environment denied external ClickHouse Cloud access after a sandbox DNS failure, so the live path was not used as completion evidence; offline tests and the production build are the authoritative evidence for this branch.

## 7. Deviation log

| ID | Design expectation | Implementation | Reason and impact |
|---|---|---|---|
| D1 | Suggested `POST /intent/...`, `/queries/...`, and `/figures/...` services | Internal TypeScript functions | Required by the existing no-API-route architecture. The logical boundaries remain; network hops do not. |
| D2 | Multiple SQL dialect examples | `SourceAdapter` interface with ClickHouse implementation only | ClickHouse must remain primary for the hackathon. Another dialect can be added without changing the agent contract. |
| D3 | Figure policy may be YAML or JSON | Typed TypeScript registry | Preserves compile-time exhaustiveness and the single runtime ViewSpec validation boundary. |
| D4 | Plain-language explanation generator | Deterministic `ExplanationManifest` rendered inside the tile | Prevents loose prose and makes calculation/provenance inspectable and testable. The LLM still authors only the verdict headline. |
| D5 | Thirty-category comparison example | Forty-category maximum | London has 33 borough-level districts in the working dataset. A limit of 30 would reject the primary real-data case; 40 still prevents unreadable national comparisons. |
| D6 | All figure types in the broad taxonomy | Governed MVP selects KPI, line, comparison bar, and table | Matches the design's Phase-1 roadmap. Distribution rendering is retained but not selected by policy yet. |
| D7 | Full source capability inspection can include bounded live profiling | Versioned capabilities are registered in the semantic model; live metadata discovery is an onboarding responsibility | Avoids repeated catalog scans per chat turn. Dynamic capability refresh can be added when sources change independently of deployments. |
| D8 | Complete audit persistence for every state transition | Artifacts are present in tool history, explanation manifests, and Trigger traces; no separate audit table | A durable audit store is production hardening, not required for the current figure path. |
| D9 | Drill-down through semantic actions | Placeholder only | Explicit product decision on 19 July: defer drill behavior until the interaction is designed. |
| D10 | Rename the agent around the generalized domain | Kept task ID `house-agent` | Avoids unnecessary session/transport migration during the redesign. Its tools, prompt, and processing path are generic. |
| D11 | Live ClickHouse integration verification | Live test added but external access unavailable in the managed environment | The test remains runnable with credentials outside the sandbox. UK real-shaped fixtures and mocked query responses cover the implementation here. |

### Undeclared drifts found and fixed on 19 July 2026

Four drifts were **not** recorded above and caused a real failure ("average price change per
district in london over time" rendered a single meaningless line). They are diagnosed and fixed in
[FIGURE_GENERATOR_FIXES.md](FIGURE_GENERATOR_FIXES.md): measure temporal scope (design §10.3/§15.2),
greedy change synonyms (§9.1), silent measure/aggregation defaults (§2, §5.2), and missing
pre-query series-scope clarification (§5.4, §9.1, §11).

## 8. Remaining placeholders, not part of this redesign

- Drill-down and `onAction`.
- Persistent audit/event table.
- Automated source-discovery UI.
- Additional SQL dialect adapters.
- Small multiples and the wider Phase-2 chart taxonomy.
- Role-level ClickHouse settings profile and quotas; per-query settings are implemented as defense in depth.
