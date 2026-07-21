# Figure Generator Process Design

**Status:** Proposed architecture
**Purpose:** Design a chat-to-figure agent that converts a natural-language analytical question into a governed query, a validated figure-ready dataset, a suitable visualisation, and a plain-language explanation.

## 1. Goal

The system should let a user ask a business question such as:

> Show me how average UK house prices have changed over time by city.

The system should then:

1. Interpret the analytical intent.
2. Resolve business concepts against a semantic layer.
3. Inspect the available source data and its granularity.
4. Identify material ambiguities.
5. Ask concise clarification questions with supported options and recommendations.
6. Select an appropriate figure and define its data contract.
7. Generate a semantic query and dialect-specific SQL.
8. Execute and validate the resulting dataset.
9. Reconsider the figure if the returned data is unsuitable for the provisional choice.
10. Render the figure.
11. Explain the final data, calculations, filters, assumptions, provenance, and limitations.

The target flow is:

```text
User question
    ↓
Analytical intent
    ↓
Semantic resolution and source inspection
    ↓
Clarification, if required
    ↓
Confirmed analytical request
    ↓
Figure selection and data contract
    ↓
Semantic query plan
    ↓
SQL generation and execution
    ↓
Dataset validation and profiling
    ↓
Figure rendering
    ↓
Explanation and provenance
```

## 2. Non-goals

The first version should not attempt to:

- Generate arbitrary bespoke visualisations without a registered figure contract.
- Let individual figure tools independently interpret business definitions or construct joins.
- Silently guess material analytical choices.
- Silently remove categories or truncate data to make a chart fit.
- Treat a syntactically valid SQL query as proof that the result is analytically correct.
- Imply causation from descriptive charts.
- Expose data that the requesting user is not authorised to access.

## 3. Design principles

### 3.1 Separate analytical meaning from visual presentation

Maintain two primary schemas:

1. **Analytical intent:** what the user wants to understand.
2. **Figure data contract:** the dataset shape required by a renderer.

This allows the same analytical result to be displayed as a line chart, small multiples, table, or another compatible figure without redefining the business calculation.

### 3.2 The semantic layer owns business meaning

The semantic layer should define:

- Measures and their aggregation rules.
- Dimensions and hierarchies.
- Valid joins and relationship cardinality.
- Time dimensions and supported grains.
- Units, currencies, and formatting.
- Synonyms and business vocabulary.
- Data ownership and certification.
- Row- and column-level security.

A figure renderer must not redefine metrics such as revenue, active customer, margin, or average house price.

### 3.3 Figure tools declare requirements; they do not own SQL

A chart implementation should declare roles such as:

- Temporal X dimension.
- Numeric Y measure.
- Optional series dimension.
- Maximum recommended series cardinality.
- Required sorting.
- Missing-value policy.
- Validation rules.

A shared query planner should convert analytical intent into a semantic query. A database adapter should convert the semantic query into dialect-specific SQL.

### 3.4 Clarify material ambiguity, not every implementation detail

Ask the user when a choice could materially change the meaning, population, calculation, or interpretation. Apply documented defaults for presentation-only choices.

### 3.5 Inspect capabilities before asking

Clarification choices must reflect what the source can actually support. If the source is monthly, do not ask whether the user wants daily results.

### 3.6 Treat figure selection as provisional until data is validated

The initial question may suggest a line chart, but the returned dataset could contain 76 cities, excessive missing periods, or only one date. The system must be able to recommend small multiples, request a narrower scope, use a table, or report that the requested trend cannot be supported.

### 3.7 Make every transformation visible

The final response should disclose:

- Metric definition.
- Aggregation.
- Source grain and displayed grain.
- Filters.
- Comparison baseline.
- Series-selection or Top-N rule.
- Missing-data policy.
- Source and last refresh.
- Material assumptions and limitations.

## 4. Core data-role vocabulary

| Role | Definition | Examples |
|---|---|---|
| Measure | Quantitative result, normally aggregated | `revenue`, `sale_price`, `orders` |
| Dimension | Qualitative grouping or slicing field | `region`, `product`, `status` |
| Time dimension | Date or timestamp used for grouping or ordering | `order_date`, `completed_at` |
| Entity/detail ID | Identifier defining an observation | `customer_id`, `opportunity_id` |
| Series/segment | Dimension producing separate lines, colours, shapes, or facets | `city`, `channel`, `region` |
| Target/comparison | Reference measure or period | `budget`, `quota`, prior year |
| Order | Field defining a meaningful sequence | `stage_order`, `step_number` |
| Size | Numeric field controlling mark area | `market_size`, `revenue` |
| Geographic key | Field joined to verified geography | `country_code`, `postcode`, lat/lon |
| Hierarchy | Ordered drill path | `category → product → SKU` |
| Tooltip/detail | Additional contextual field | `owner`, `margin`, `sample_size` |
| Filter | Field restricting the analytical population | date range, country, status |
| Facet | Dimension creating aligned small multiples | `region`, `product_category` |

## 5. System components

### 5.1 Conversation orchestrator

Responsibilities:

- Maintain the current analytical state across user turns.
- Decide whether the next action is semantic discovery, clarification, planning, execution, or presentation.
- Preserve prior user choices.
- Avoid repeating resolved questions.
- Present clarification questions and recommendations.

### 5.2 Intent compiler

Converts natural language into a chart-independent analytical intent.

Expected outputs include:

- Business metric.
- Aggregation.
- Time dimension and requested time grain.
- Grouping dimensions.
- Filters and population.
- Time range.
- Comparison.
- Analytical purpose.
- Explicit presentation preference, if supplied.
- Unresolved concepts.

### 5.3 Semantic resolver

Maps user concepts to semantic-layer objects and reports:

- Exact matches.
- Synonym matches.
- Multiple possible matches.
- Unsupported concepts.
- Valid joins.
- Supported time grains.
- Access restrictions.
- Source freshness.
- Expected cardinality.

### 5.4 Source capability inspector

Inspects metadata before clarification or query generation:

- Minimum available time grain.
- Available date range.
- Dimension cardinality.
- Null coverage.
- Geographic levels.
- Certified measures.
- Estimated row volume.
- Freshness.
- Query cost indicators.

This can use catalog metadata, semantic-layer statistics, or bounded profiling queries.

### 5.5 Clarification planner

Determines which unresolved choices require user input, ranks them by materiality, and groups them into a concise clarification turn.

### 5.6 Figure policy registry

Stores versioned, testable recommendations and requirements for supported figures. It should be usable by both the language model and deterministic validators.

### 5.7 Query planner

Builds a database-independent semantic query containing:

- Selected measure expressions.
- Dimensions.
- Time grain.
- Filters.
- Comparison calculations.
- Grouping.
- Ordering.
- Limits.
- Required tooltip or validation measures.

### 5.8 SQL adapter

Converts the semantic query into the target dialect, for example:

- BigQuery.
- Snowflake.
- PostgreSQL.
- Databricks SQL.
- Trino.

### 5.9 Query executor

Responsibilities:

- Enforce permissions and resource limits.
- Execute read-only queries.
- Return results and query metadata.
- Capture runtime, scanned volume, warnings, and freshness.

### 5.10 Dataset validator and profiler

Checks whether the result satisfies the figure contract and whether it is analytically credible enough to display.

### 5.11 Figure renderer

Accepts only validated, figure-ready data. It does not discover tables, define joins, or reinterpret measures.

### 5.12 Explanation and provenance generator

Produces a concise explanation of the result and an inspectable record of how it was produced.

## 6. Process state machine

Recommended states:

```text
RECEIVED
  → INTENT_PARSED
  → SEMANTICS_RESOLVED
  → NEEDS_CLARIFICATION
  → PLAN_CONFIRMED
  → QUERY_PLANNED
  → QUERY_EXECUTED
  → DATA_VALIDATED
  → FIGURE_RENDERED
  → COMPLETED
```

Possible terminal or recovery states:

```text
UNSUPPORTED_REQUEST
ACCESS_DENIED
NO_DATA
INVALID_DATA_SHAPE
QUERY_FAILED
REQUIRES_NARROWER_SCOPE
```

Every state transition should preserve an audit record and the artefacts produced at that stage.

## 7. Analytical intent schema

Example:

```json
{
  "question": "Show me how average UK house prices have changed over time by city.",
  "analysis_type": "trend",
  "metric": {
    "user_term": "house price",
    "semantic_name": null,
    "aggregation": "average",
    "unit": "GBP"
  },
  "time": {
    "user_term": "over time",
    "semantic_name": null,
    "grain": null,
    "range": null
  },
  "group_by": [
    {
      "user_term": "city",
      "semantic_name": null
    }
  ],
  "filters": [
    {
      "user_term": "UK",
      "semantic_name": null,
      "operator": "=",
      "value": "United Kingdom"
    }
  ],
  "comparison": null,
  "preferred_figure": null,
  "unresolved": [
    "metric_definition",
    "time_grain",
    "time_range",
    "city_scope"
  ]
}
```

The intent schema must not contain physical table names or SQL expressions.

## 8. Semantic resolution schema

Example:

```json
{
  "metric": {
    "semantic_name": "average_completed_sale_price",
    "label": "Average completed sale price",
    "expression_owner": "semantic_layer",
    "unit": "GBP",
    "default_aggregation": "average",
    "certified": true,
    "alternatives": [
      "median_completed_sale_price",
      "official_house_price_index"
    ]
  },
  "time": {
    "semantic_name": "property_sale.completed_month",
    "source_timestamp": "property_sale.completed_at",
    "minimum_grain": "day",
    "available_grains": ["day", "week", "month", "quarter", "year"],
    "available_range": ["1995-01-01", "2026-06-30"]
  },
  "dimensions": [
    {
      "semantic_name": "geography.city",
      "cardinality": 76,
      "hierarchy": ["country", "region", "city"]
    }
  ],
  "filters": [
    {
      "semantic_name": "geography.country",
      "resolved_value": "United Kingdom"
    }
  ],
  "join_path": [
    "property_sale.geography_id = geography.geography_id"
  ],
  "security": {
    "authorised": true,
    "policies_applied": []
  }
}
```

## 9. Clarification policy

### 9.1 Ask when ambiguity is material

| Ambiguity | Default action | Reason |
|---|---|---|
| Metric definition | Ask when multiple governed measures match | Changes business meaning |
| Aggregation | Ask when not implied by a certified measure | Mean, median, sum, and distinct count differ materially |
| Population/filter | Ask | Changes which records are included |
| Time range | Ask when absent and no product default is accepted | Changes scope and interpretation |
| Time grain | Ask when several supported choices are reasonable | Changes smoothness and number of observations |
| Comparison baseline | Ask when the request implies comparison but not the reference | Target, prior year, and peers answer different questions |
| Series scope | Ask when cardinality would make the chart unreadable | Prevents silent Top-N truncation |
| Chart type | Recommend rather than ask in most cases | The agent should apply visualisation expertise |
| Colour and styling | Use defaults | Presentation-only choice |
| Tooltip fields | Add useful context automatically | Low-risk enhancement |

### 9.2 Resolve before asking

Do not ask the user for information already available from:

- The semantic layer.
- Source capability metadata.
- Previous turns.
- Explicit organisational defaults.
- The user's explicit query.

### 9.3 Ask a concise batch

Group related material questions into one turn where possible. Avoid a long serial interview.

Example:

> The source supports monthly, quarterly, and yearly city-level data from 1995 onward. I recommend monthly data for the last five years. There are 76 cities, which is too many for one line chart. Which time range and city set should I use?

### 9.4 Provide supported choices and a recommendation

Each clarification should include:

- The question.
- Valid options.
- A recommended choice.
- A short reason.
- Relevant source constraints.

### 9.5 Clarification response schema

```json
{
  "status": "needs_clarification",
  "resolved": {
    "metric": "average_completed_sale_price",
    "time_dimension": "property_sale.completed_at",
    "group_by": ["geography.city"],
    "country": "United Kingdom",
    "recommended_figure": "multi_series_line"
  },
  "source_capabilities": {
    "minimum_time_grain": "day",
    "available_time_grains": ["day", "week", "month", "quarter", "year"],
    "date_range": ["1995-01-01", "2026-06-30"],
    "city_count": 76
  },
  "ambiguities": [
    {
      "field": "metric_definition",
      "question": "Which house-price measure should be used?",
      "options": [
        "average completed sale price",
        "median completed sale price",
        "official house-price index"
      ],
      "recommended": "official house-price index",
      "reason": "It is less sensitive to changes in the mix of properties sold."
    },
    {
      "field": "time_grain",
      "question": "Which time interval should be displayed?",
      "options": ["month", "quarter", "year"],
      "recommended": "month",
      "reason": "Monthly data preserves the available trend without excessive daily variation."
    },
    {
      "field": "city_scope",
      "question": "Which cities should be displayed?",
      "options": ["selected cities", "top cities", "all cities as small multiples"],
      "recommended": "selected cities",
      "reason": "Seventy-six overlapping lines would be difficult to interpret."
    }
  ]
}
```

## 10. Time-grain selection

Time grain is a joint decision based on the user request, source capability, date range, metric behaviour, and figure density.

### 10.1 Resolution order

1. Use an explicit user-requested grain if supported.
2. Reject or explain unsupported finer grains.
3. Apply a registered organisational default if the user has accepted defaults.
4. Otherwise recommend a grain based on range and expected point count.
5. Ask when multiple reasonable choices could materially change interpretation.

### 10.2 Suggested point-density guidance

These are configurable product defaults, not universal statistical rules:

| Date range | Typical recommendation |
|---|---|
| Up to 14 days | Hour or day |
| Up to 6 months | Day or week |
| 6 months to 3 years | Week or month |
| 3 to 10 years | Month or quarter |
| More than 10 years | Quarter or year |

Also consider:

- Maximum points supported by the renderer.
- Metric volatility.
- Reporting calendar.
- Missing-period density.
- Number of series.
- Whether the measure is a flow or a snapshot.

### 10.3 Flow versus snapshot measures

Aggregation must respect measure behaviour:

- Revenue and units are flows and are commonly summed over time.
- Inventory and account balance are snapshots and should not normally be summed across dates.
- Price may use mean, median, last observation, or a governed index.
- Ratios should usually be recomputed from numerator and denominator rather than averaged blindly.

## 11. Figure policy registry

The registry should be stored as versioned configuration, for example YAML or JSON. It should not exist only as prose inside the language-model prompt.

Example:

```yaml
trend:
  default_figure: line
  requires:
    - temporal_dimension
    - numeric_measure
  optional:
    - series_dimension
    - comparison_measure
    - tooltip_measures
  rules:
    - if: series_cardinality <= 8
      recommend: multi_series_line
    - if: series_cardinality > 8 and series_cardinality <= 30
      recommend: small_multiples
    - if: series_cardinality > 30
      action: request_series_scope

category_comparison:
  default_figure: horizontal_bar
  requires:
    - categorical_dimension
    - numeric_measure
  optional:
    - series_dimension
    - target_measure
  rules:
    - sort: measure_descending
    - if: category_cardinality > 30
      action: request_scope_or_explicit_top_n

part_to_whole:
  default_figure: stacked_bar
  requires:
    - category_dimension
    - part_dimension
    - numeric_measure
  rules:
    - if: part_count <= 5 and represents_complete_whole
      allow: pie_or_donut
    - otherwise: stacked_bar

relationship:
  default_figure: scatter
  requires:
    - entity_id
    - numeric_x
    - numeric_y
  optional:
    - size_measure
    - series_dimension
    - label

distribution:
  default_figure: histogram
  requires:
    - observation_level_numeric_value
  alternatives:
    grouped_comparison: box_plot

target_progress:
  default_figure: bullet
  requires:
    - actual_measure
    - target_measure
    - category_or_kpi

flow:
  default_figure: funnel
  requires:
    - stage_dimension
    - stage_order
    - count_or_value

geospatial:
  defaults:
    regional_rate: choropleth
    point_location: symbol_map
  requires_one_of:
    - geographic_key
    - latitude_and_longitude
```

## 12. Common figure contracts

| Figure | Required roles | Optional roles | Expected result grain |
|---|---|---|---|
| Single-value card | Measure | Target, prior value, date context | One aggregated row |
| KPI | Actual, target or comparison | Trend date, status threshold | KPI × period |
| Gauge | Actual, minimum, maximum | Target | One KPI snapshot |
| Column chart | Category/date, measure | Series, target | Category × series |
| Horizontal bar | Category, measure | Series, target, rank | Category × series |
| Stacked bar | Category, part, measure | Date, tooltip | Category × part |
| 100% stacked bar | Category, part, measure | Labels | Category × part, normalised |
| Line chart | Ordered time, measure | Series, benchmark | Time grain × series |
| Area chart | Ordered time, measure | Small number of series | Time grain × series |
| Combo chart | Shared category/time, two measures | Series, target | Category/time × series |
| Ribbon/rank chart | Time, category, measure | Rank | Time × category |
| Pie/donut | Part/category, measure | Label | One row per part |
| Treemap | Hierarchy/category, non-negative measure | Colour measure | One row per hierarchy leaf |
| Scatterplot | Entity ID, numeric X, numeric Y | Segment, label, trend line | One row per entity |
| Bubble chart | Entity ID, numeric X, numeric Y, size | Segment, label | One row per entity |
| Histogram | Observation-level numeric value or compatible bins | Group | Observation or bin × group |
| Box plot | Group, observation-level numeric value | Facet | Observations within group |
| Funnel | Stage, stage order, count/value | Segment, entity ID | Stage × segment |
| Waterfall | Ordered step, signed change | Total flag | One row per contribution |
| Timeline/Gantt | Item, start, end | Group, status, progress | One row per interval |
| Table | Identifier/dimensions, measures | Status, link, dates | Usually one row per entity |
| Matrix | Row dimension, column dimension, measure | Hierarchies, totals | Row × column |
| Choropleth | Verified geographic key, normalised measure | Tooltip, period | Region × period |
| Point map | Latitude, longitude or point location | Size, segment, ID | One row per location/entity |
| Decomposition tree | Measure, explanatory dimensions | Drill order | Selected hierarchy level |
| Key influencers | Outcome, candidate explanatory fields | Segment, entity ID | One row per observation |

## 13. Figure plan schema

After clarification, produce a confirmed plan:

```json
{
  "status": "plan_confirmed",
  "analysis_type": "trend",
  "figure": {
    "type": "small_multiple_line",
    "reason": "The user requested all selected cities, and facets avoid overlapping lines.",
    "title": "Average completed sale price by city",
    "x": {
      "semantic_field": "property_sale.completed_month",
      "result_column": "month",
      "type": "temporal"
    },
    "y": {
      "semantic_measure": "average_completed_sale_price",
      "result_column": "average_house_price",
      "type": "currency",
      "unit": "GBP"
    },
    "series": null,
    "facet": {
      "semantic_field": "geography.city",
      "result_column": "city"
    },
    "tooltip": [
      "transaction_count",
      "median_completed_sale_price"
    ]
  },
  "result_grain": ["month", "city"],
  "filters": [
    {
      "field": "geography.country",
      "operator": "=",
      "value": "United Kingdom"
    },
    {
      "field": "property_sale.completed_month",
      "operator": "between",
      "value": ["2021-01-01", "2026-06-30"]
    }
  ],
  "sorting": ["city ASC", "month ASC"],
  "missing_value_policy": "show_gaps",
  "series_selection": {
    "method": "explicit_user_selection",
    "values": ["Birmingham", "Bristol", "Leeds", "London", "Manchester"]
  }
}
```

## 14. Query planning

### 14.1 Semantic query before SQL

Example semantic query:

```json
{
  "model": "property_sales",
  "dimensions": [
    {
      "name": "property_sale.completed_at",
      "grain": "month",
      "alias": "month"
    },
    {
      "name": "geography.city",
      "alias": "city"
    }
  ],
  "measures": [
    {
      "name": "average_completed_sale_price",
      "alias": "average_house_price"
    },
    {
      "name": "completed_transaction_count",
      "alias": "transaction_count"
    }
  ],
  "filters": [
    {
      "field": "geography.country",
      "operator": "equals",
      "value": "United Kingdom"
    },
    {
      "field": "geography.city",
      "operator": "in",
      "value": ["Birmingham", "Bristol", "Leeds", "London", "Manchester"]
    },
    {
      "field": "property_sale.completed_at",
      "operator": "between",
      "value": ["2021-01-01", "2026-06-30"]
    }
  ],
  "order_by": ["city ASC", "month ASC"]
}
```

### 14.2 Example generated SQL

```sql
SELECT
    DATE_TRUNC('month', sales.completed_at) AS month,
    geography.city_name AS city,
    AVG(sales.sale_price) AS average_house_price,
    COUNT(*) AS transaction_count
FROM property_sales AS sales
JOIN geography
  ON sales.geography_id = geography.geography_id
WHERE geography.country_name = 'United Kingdom'
  AND geography.city_name IN (
      'Birmingham',
      'Bristol',
      'Leeds',
      'London',
      'Manchester'
  )
  AND sales.completed_at >= DATE '2021-01-01'
  AND sales.completed_at < DATE '2026-07-01'
GROUP BY 1, 2
ORDER BY 2, 1;
```

### 14.3 SQL-generation requirements

- Generate read-only SQL.
- Use parameterised values where supported.
- Use approved semantic joins only.
- Protect against join fan-out.
- Apply user entitlements before execution.
- Preserve numerator and denominator for governed ratio measures.
- Apply timezone and reporting-calendar rules.
- Add explicit ordering required by the figure contract.
- Apply limits only when declared in the confirmed plan.
- Never silently add Top-N filtering.
- Record the semantic query separately from generated SQL.

## 15. Dataset validation

Validation should occur before rendering.

### 15.1 Structural validation

- Required result columns exist.
- Column types match the figure contract.
- Result grain is unique.
- Temporal values are parseable and sorted.
- Numeric values have compatible units.
- Category and series cardinalities are within declared limits.
- Row count is within renderer and product limits.

### 15.2 Analytical validation

- Aggregation matches the certified measure definition.
- Flow and snapshot measures are handled correctly.
- Ratios use valid denominators.
- Join cardinality has not multiplied facts.
- Currency conversion is consistent.
- Timezone and calendar rules are consistent.
- Comparisons use equivalent populations and grains.
- Part-to-whole values use a valid denominator.
- Geographic values are normalised when the question requires rates rather than counts.

### 15.3 Data-quality profiling

- Null rate by required field.
- Missing periods.
- Duplicate grain keys.
- Outliers and extreme values.
- Number of entities or series.
- Date coverage per series.
- Sample size or denominator size.
- Freshness.

### 15.4 Figure-specific validation examples

**Line chart**

- At least two ordered X values.
- Numeric Y values.
- Unique X × series grain.
- Series count within policy.
- Missing dates displayed as gaps unless an approved fill policy exists.

**Scatterplot**

- One row per entity.
- Numeric X and Y.
- Sufficient observations.
- Bubble size non-negative when present.

**Funnel**

- Ordered stages exist.
- Stage population is consistently defined.
- Counts refer to the same eligible cohort where conversion is claimed.

**Choropleth**

- Geographic keys successfully join to verified boundaries.
- Missing and unmatched regions are reported.
- Rates use a suitable denominator when raw counts would be misleading.

## 16. Adaptive figure selection

The system should reconsider the provisional figure after profiling.

Examples:

| Result condition | Recommended response |
|---|---|
| One temporal point | Replace line with bar/card or explain insufficient trend data |
| More than eight overlapping line series | Prefer small multiples or request narrower scope |
| More than thirty series | Require scope clarification unless an explicit overview supports it |
| Very long category labels | Prefer horizontal bars |
| Parts do not form a complete whole | Do not use pie/donut |
| Large differences in category totals and composition | Use stacked bars; consider a separate total measure |
| Two numeric measures at entity grain | Consider scatterplot |
| Result is detail-level and exact values matter | Use a table |
| Geographic join has poor coverage | Do not render a misleading map |

Any automatic figure change should preserve the analytical intent and be explained to the user.

## 17. Rendering contract

The renderer should receive a payload similar to:

```json
{
  "figure_plan": {},
  "dataset": {
    "columns": [
      {"name": "month", "type": "date"},
      {"name": "city", "type": "string"},
      {"name": "average_house_price", "type": "currency", "unit": "GBP"},
      {"name": "transaction_count", "type": "integer"}
    ],
    "rows": []
  },
  "profile": {
    "row_count": 330,
    "series_count": 5,
    "date_range": ["2021-01-01", "2026-06-01"],
    "missing_periods": 2
  },
  "provenance": {}
}
```

The renderer must not:

- Change aggregation.
- Apply undeclared filters.
- Drop series silently.
- Fill missing values without the declared policy.
- Change units.
- Reinterpret dimensions.

## 18. Final explanation contract

Every completed figure should be accompanied by a compact explanation containing:

### 18.1 What is shown

Example:

> Monthly average completed transaction price, grouped by city, for selected UK cities from January 2021 through June 2026.

### 18.2 How it was calculated

Example:

> Each point is the arithmetic mean of completed sale prices during the month. Transaction count is available in the tooltip.

### 18.3 Data scope

- Date range.
- Geography or population.
- Filters.
- Selected entities or series.
- Source grain and display grain.

### 18.4 Provenance

- Semantic model.
- Source system.
- Last refresh.
- Query ID.
- Figure-policy version.
- Measure-definition version.

### 18.5 Limitations

Examples:

- Average price may change because the mix of property types sold changed.
- Months with fewer than a minimum transaction count are suppressed.
- Two cities have missing observations.
- Results exclude transactions without a valid city mapping.

### 18.6 Inspectable details

Provide expandable access to:

- Analytical intent.
- Confirmed figure plan.
- Semantic query.
- Generated SQL.
- Result schema.
- Validation warnings.

## 19. Prompt architecture

Do not rely on one large prompt to perform every function.

### 19.1 System-level workflow prompt

The orchestration prompt should instruct the agent to:

1. Parse analytical intent before selecting data.
2. Resolve terms through the semantic layer.
3. Inspect source capabilities before asking questions.
4. Ask about unresolved material choices.
5. Recommend supported defaults with reasons.
6. Apply the versioned figure-policy registry.
7. Produce a confirmed figure plan.
8. Generate a semantic query before SQL.
9. Validate query results against the figure contract.
10. Explain all material transformations and limitations.

### 19.2 Structured context injected into the prompt

- Relevant semantic objects only.
- Source capabilities.
- User permissions.
- Figure-policy rules relevant to the classified intent.
- Previously resolved conversation state.
- Validation feedback from prior attempts.

### 19.3 Deterministic logic outside the prompt

Keep these outside free-form model reasoning where possible:

- Permission enforcement.
- SQL parsing and read-only enforcement.
- Join-path validation.
- Type checking.
- Cardinality limits.
- Required-column validation.
- Unit compatibility.
- Query-cost limits.
- Figure-contract validation.
- Audit logging.

### 19.4 Few-shot examples

Include examples covering:

- A fully specified question requiring no clarification.
- An ambiguous metric.
- Unsupported time grain.
- Excessive series cardinality.
- Comparison with an unspecified baseline.
- A request that should render a table rather than a chart.
- A result requiring a different figure after profiling.
- No-data and access-denied responses.

## 20. Suggested service interfaces

```text
POST /intent/compile
POST /semantics/resolve
POST /capabilities/inspect
POST /clarifications/plan
POST /figures/recommend
POST /queries/plan
POST /queries/compile-sql
POST /queries/execute
POST /datasets/validate
POST /figures/render
POST /explanations/generate
```

Possible shared artefacts:

```text
AnalyticalIntent
SemanticResolution
SourceCapabilities
ClarificationPlan
FigurePlan
SemanticQuery
CompiledQuery
QueryResult
DatasetProfile
ValidationReport
RenderedFigure
ExplanationManifest
```

## 21. Error and fallback behaviour

### Unsupported metric

Explain that the requested concept is unavailable and offer semantically close governed measures.

### Unsupported grain

Explain the minimum source grain and offer supported alternatives.

### Excessive cardinality

Ask for scope, recommend small multiples, or propose an explicit Top-N rule. Do not silently truncate.

### No data

Report the applied filters and suggest which constraint may be too narrow. Do not render an empty chart without explanation.

### Query failure

Attempt bounded repair only when semantic meaning is unchanged. Otherwise explain the failure and request input if needed.

### Validation failure

Do not render a misleading figure. Return the failed checks and either revise the plan or request clarification.

### Access denied

Do not reveal restricted metadata or values. Explain only that the requested data is unavailable under the current permissions.

## 22. Security, governance, and privacy

- Apply user identity and entitlements before semantic discovery and query execution.
- Enforce row- and column-level policies in the semantic layer or database.
- Use parameterised queries.
- Permit read-only statements only.
- Apply query timeouts, row limits, and cost limits.
- Suppress small groups where privacy policy requires it.
- Avoid exposing protected employee or customer attributes in tooltips or labels.
- Log semantic plans and policy decisions without logging restricted result values unnecessarily.
- Display certification and freshness for governed sources.
- Version metric definitions and figure policies.

## 23. Observability

Capture:

- Original question.
- Parsed intent.
- Semantic matches and confidence.
- Clarifications asked and user choices.
- Figure recommendation and reason.
- Semantic query and SQL hash.
- Query runtime and cost.
- Result row count and profile.
- Validation results.
- Figure changes after profiling.
- User edits, retries, and abandonment.
- Final user feedback.

Key operational metrics:

- Clarification rate.
- Average clarification turns.
- Query success rate.
- Validation failure rate.
- Figure-revision rate.
- Time to first useful figure.
- User acceptance without revision.
- Semantic-resolution error rate.
- Incidence of excessive-cardinality requests.

## 24. Evaluation and testing

### 24.1 Golden analytical questions

Maintain a versioned suite of questions with expected:

- Intent.
- Semantic objects.
- Clarifications.
- Figure type.
- Result grain.
- Query plan.
- Validation behaviour.
- Explanation content.

### 24.2 Unit tests

- Intent-schema validation.
- Semantic synonym resolution.
- Time-grain compatibility.
- Figure-contract validation.
- Join-cardinality protection.
- Ratio aggregation.
- Missing-period detection.
- Series-cardinality rules.
- SQL dialect generation.

### 24.3 Integration tests

- Natural language to semantic query.
- Clarification and resumed planning.
- Query execution to validated dataset.
- Dataset to figure.
- Permission changes.
- Source schema changes.

### 24.4 Visual regression tests

- Long labels.
- Missing values.
- Negative values.
- Large and small screens.
- Light and dark themes.
- High-cardinality series.
- Accessibility labels and keyboard interaction.

### 24.5 Adversarial tests

- Prompt injection in dimension values.
- Requests for unauthorised data.
- SQL injection attempts.
- Misleading denominators.
- Join fan-out.
- Conflicting units and currencies.
- Ambiguous definitions with high-confidence incorrect matches.

## 25. Implementation roadmap

### Phase 1: Governed single-figure MVP

Support:

- KPI card.
- Line chart.
- Bar chart.
- Table.

Build:

- Analytical-intent schema.
- Semantic resolver for one governed model.
- Clarification policy for metric, time range, time grain, and category scope.
- Figure registry for the four figures.
- Semantic query planner.
- One SQL dialect.
- Structural dataset validation.
- Basic explanation and provenance.

### Phase 2: Comparisons and richer BI patterns

Add:

- Targets and prior-period comparisons.
- Stacked bars.
- Scatterplots.
- Funnels.
- Waterfalls.
- Small multiples.
- More complete analytical validation.
- Cardinality-aware figure adaptation.

### Phase 3: Advanced analysis

Add:

- Histograms and box plots.
- Cohort and retention matrices.
- Geographic figures.
- Forecasts and uncertainty intervals.
- Anomaly detection.
- Multiple semantic models and sources.

### Phase 4: Production hardening

Add:

- Full access-control integration.
- Cost-aware query planning.
- Caching and result reuse.
- Versioned prompt and policy evaluation.
- Visual-regression suite.
- Comprehensive observability.
- User-facing inspection and correction tools.

## 26. MVP acceptance criteria

The MVP is acceptable when it can:

1. Parse a supported analytical question into a valid intent schema.
2. Resolve measures and dimensions through the semantic layer.
3. Identify missing time grain, time range, and category scope.
4. Ask only supported clarification questions.
5. Recommend a figure using the policy registry.
6. Produce a valid figure data contract.
7. Generate read-only SQL from a semantic query.
8. Detect duplicate grain, type errors, missing required columns, and excessive series.
9. Render a figure without silently altering the plan.
10. Explain metric definition, aggregation, filters, grain, source, freshness, and limitations.
11. Preserve a complete audit record.

## 27. Open product decisions

- Which semantic-layer technology or contract will be used?
- Which SQL dialect is first?
- Which clarification defaults may users pre-approve?
- What is the default maximum number of line series?
- Should Top-N ever be automatic, or always confirmed?
- How should the system choose between line overlays and small multiples?
- Which metric certification levels are allowed for automatic execution?
- What query-cost threshold requires confirmation?
- How will users inspect and correct semantic mappings?
- How will figure-policy versions be deployed and evaluated?
- What source freshness is acceptable for each dashboard or question type?
- Which privacy-suppression rules apply to small groups?

## 28. Reference guidance

The initial figure taxonomy and selection rules should be informed by:

- [Selecting an effective data visualization — Looker](https://docs.cloud.google.com/looker/docs/visualization-guide)
- [Visualizations overview in Power BI](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualizations-overview)

These references should guide the initial policy registry, while product-specific rules should be versioned and tested against real user questions and datasets.
