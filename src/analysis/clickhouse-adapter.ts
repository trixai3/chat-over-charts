import type { ClickHouseClient } from "@clickhouse/client";
import { getClickHouse } from "../shared/clickhouse";
import type {
  AnalysisFilter,
  CompiledQuery,
  ResolvedAnalysisRequest,
  SemanticDimension,
  SemanticMeasure,
  SemanticModel,
  SourceAdapter,
} from "./types";

const MAX_RESULT_ROWS = 1000;
// A trend's row count is structurally bounded by time buckets × the 8-series
// policy cap (worst case ~daily 1995–2026 × 8 ≈ 92k) — this cap is a safety
// net against grain bugs, not a scope limit, so it sits well above that bound.
const MAX_TREND_ROWS = 100_000;

function normalizedValue(value: unknown, dimension: SemanticDimension): unknown {
  if (typeof value === "string") {
    if (dimension.valueNormalization === "uppercase") return value.toUpperCase();
    if (dimension.valueNormalization === "lowercase") return value.toLowerCase();
  }
  if (Array.isArray(value)) return value.map((item) => normalizedValue(item, dimension));
  return value;
}

function parameterType(dimension: SemanticDimension): string {
  return dimension.kind === "time" ? "Date" : "String";
}

function compileFilter(
  filter: AnalysisFilter,
  dimension: SemanticDimension,
  index: number,
  params: Record<string, unknown>,
): string {
  const key = `filter_${index}`;
  const expression = dimension.expression;
  const type = parameterType(dimension);
  const value = normalizedValue(filter.value, dimension);

  switch (filter.operator) {
    case "equals":
      if (Array.isArray(value)) throw new Error(`${filter.field} equals requires one value.`);
      params[key] = value;
      return `${expression} = {${key}:${type}}`;
    case "in":
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${filter.field} in requires at least one value.`);
      }
      params[key] = value;
      return `${expression} IN {${key}:Array(${type})}`;
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error(`${filter.field} between requires exactly two values.`);
      }
      params[`${key}_from`] = value[0];
      params[`${key}_to`] = value[1];
      return `${expression} >= {${key}_from:${type}} AND ${expression} <= {${key}_to:${type}}`;
    }
    case "gte":
      if (Array.isArray(value)) throw new Error(`${filter.field} gte requires one value.`);
      params[key] = value;
      return `${expression} >= {${key}:${type}}`;
    case "lte":
      if (Array.isArray(value)) throw new Error(`${filter.field} lte requires one value.`);
      params[key] = value;
      return `${expression} <= {${key}:${type}}`;
  }
}

/**
 * A measure filter compiles to HAVING over the full aggregate expression (not
 * the SELECT alias, so the thresholded measure need not be displayed). The
 * planner has already restricted operators to numeric thresholds.
 */
function compileMeasureFilter(
  filter: AnalysisFilter,
  measure: SemanticMeasure,
  index: number,
  params: Record<string, unknown>,
): string {
  const key = `having_${index}`;
  switch (filter.operator) {
    case "between": {
      const [from, to] = filter.value as number[];
      params[`${key}_from`] = from;
      params[`${key}_to`] = to;
      return `${measure.expression} >= {${key}_from:Float64} AND ${measure.expression} <= {${key}_to:Float64}`;
    }
    case "gte":
      params[key] = filter.value;
      return `${measure.expression} >= {${key}:Float64}`;
    case "lte":
      params[key] = filter.value;
      return `${measure.expression} <= {${key}:Float64}`;
    default:
      throw new Error(`Measure filter on ${filter.field} does not support ${filter.operator}.`);
  }
}

function resultLimit(request: ResolvedAnalysisRequest): number {
  if (request.limit !== undefined) return Math.min(Math.max(request.limit, 1), MAX_RESULT_ROWS);
  switch (request.analysisType) {
    case "single_value":
      return 1;
    case "category_comparison":
      // Forty may render; the extra row is a sentinel proving that scope is too broad.
      return 41;
    case "detail":
      // One extra sentinel row proves that the default table scope is too broad.
      return 101;
    case "trend":
      return MAX_TREND_ROWS;
    case "distribution":
      // histogram(20) always returns one row holding the whole bin array.
      return 1;
  }
}

export function compileClickHouseQuery(
  request: ResolvedAnalysisRequest,
  model: SemanticModel,
): CompiledQuery {
  const params: Record<string, unknown> = {
    database: process.env.CLICKHOUSE_DATABASE ?? model.database,
    table: model.table,
  };
  const dimensionAliases = request.dimensions.map((field) => field.field);
  const measureAliases = request.measures;

  const dimensions = request.dimensions.map((field) => {
    const dimension = model.dimensions[field.field];
    if (!dimension) throw new Error(`Unknown governed dimension: ${field.field}`);
    const expression = field.grain ? dimension.grains?.[field.grain] : dimension.expression;
    if (!expression) throw new Error(`${dimension.label} does not support grain ${field.grain}.`);
    return `${expression} AS ${field.field}`;
  });
  const timeAlias = request.dimensions.find(
    (field) => model.dimensions[field.field]?.kind === "time",
  )?.field;
  const categoryAliases = request.dimensions
    .filter((field) => model.dimensions[field.field]?.kind === "category")
    .map((field) => field.field);

  // `comparison: "vs_previous_period"` turns every requested aggregate into
  // its % change with a window function, so the generated SQL stays complete
  // and inspectable — measures themselves remain plain aggregates.
  const usesTrendWindow = request.comparison === "vs_previous_period";
  if (usesTrendWindow && !timeAlias) {
    throw new Error("A previous-period comparison requires a time dimension in the semantic query.");
  }
  const measures = request.measures.map((id) => {
    const measure = model.measures[id];
    if (!measure) throw new Error(`Unknown governed measure: ${id}`);
    if (usesTrendWindow) {
      const previous = `lagInFrame(${measure.expression}, 1) OVER trend_window`;
      return `round(100 * (${measure.expression} - ${previous}) / nullIf(${previous}, 0), 1) AS ${id}`;
    }
    return `${measure.expression} AS ${id}`;
  });

  // WHERE and HAVING are split here: dimension filters scope rows before
  // aggregation, measure filters threshold the aggregates after GROUP BY.
  const filters: string[] = [];
  const havingFilters: string[] = [];
  for (const [index, filter] of request.filters.entries()) {
    const measure = model.measures[filter.field];
    if (measure) {
      havingFilters.push(compileMeasureFilter(filter, measure, index, params));
      continue;
    }
    const dimension = model.dimensions[filter.field];
    if (!dimension) throw new Error(`Unknown governed filter field: ${filter.field}`);
    filters.push(compileFilter(filter, dimension, index, params));
  }

  // A distribution bins raw per-row values, not grouped aggregates: same
  // governed table and WHERE filters, but histogram(20) replaces GROUP BY.
  // ClickHouse's histogram(20)(expr) returns Array(Tuple(Float64, Float64,
  // Float64)) = [lower, upper, height] per bin, one row for the whole population.
  if (request.analysisType === "distribution") {
    const measureId = request.measures[0];
    const measure = model.measures[measureId];
    if (!measure) throw new Error(`Unknown governed measure: ${measureId}`);
    if (!measure.valueExpression) {
      throw new Error(`${measure.label} has no per-row value to bin.`);
    }
    const limit = resultLimit(request);
    const sql = [
      `SELECT\n  histogram(20)(${measure.valueExpression}) AS bins,\n  ${measure.expression} AS ${measureId}`,
      "FROM {database:Identifier}.{table:Identifier}",
      filters.length > 0 ? `WHERE ${filters.join("\n  AND ")}` : "",
      `LIMIT ${limit}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      sql,
      params,
      request,
      dimensionAliases: [],
      measureAliases: [measureId],
      resultLimit: limit,
    };
  }

  // A confirmed top-N series selection (design §13) scopes the series
  // dimension with a subquery over the same filtered population. It reuses the
  // same named parameters, so values still never enter the SQL text.
  if (request.seriesSelection) {
    const seriesDimension = request.dimensions
      .map((field) => model.dimensions[field.field])
      .find((dimension) => dimension?.kind === "category");
    const rank = model.measures[request.seriesSelection.by];
    if (seriesDimension && rank) {
      const scopeWhere = filters.length > 0 ? `\n  WHERE ${filters.join("\n    AND ")}` : "";
      const topN = Math.max(1, Math.floor(request.seriesSelection.n));
      filters.push(
        `${seriesDimension.expression} IN (\n  SELECT ${seriesDimension.expression}\n  FROM {database:Identifier}.{table:Identifier}${scopeWhere}\n  GROUP BY ${seriesDimension.expression}\n  ORDER BY ${rank.expression} DESC\n  LIMIT ${topN}\n)`,
      );
    }
  }

  const selectedAliases = new Set([...dimensionAliases, ...measureAliases]);
  const requestedOrder = request.orderBy.map((order) => {
    if (!selectedAliases.has(order.field)) {
      throw new Error(`Sort field ${order.field} must be selected by the semantic query.`);
    }
    return `${order.field} ${order.direction.toUpperCase()}`;
  });
  const defaultOrder =
    request.analysisType === "trend" && dimensionAliases.length > 0
      ? [`${dimensionAliases[0]} ASC`]
      : request.analysisType === "category_comparison" && measureAliases.length > 0
        ? [`${measureAliases[measureAliases.length - 1]} DESC`]
        : [];

  const trendWindow = usesTrendWindow
    ? `WINDOW trend_window AS (${
        categoryAliases.length > 0 ? `PARTITION BY ${categoryAliases.join(", ")} ` : ""
      }ORDER BY ${timeAlias} ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`
    : "";

  const limit = resultLimit(request);
  const sql = [
    `SELECT\n  ${[...dimensions, ...measures].join(",\n  ")}`,
    "FROM {database:Identifier}.{table:Identifier}",
    filters.length > 0 ? `WHERE ${filters.join("\n  AND ")}` : "",
    dimensions.length > 0 && measures.length > 0
      ? `GROUP BY ${dimensionAliases.join(", ")}`
      : "",
    havingFilters.length > 0 ? `HAVING ${havingFilters.join("\n  AND ")}` : "",
    trendWindow,
    requestedOrder.length > 0 || defaultOrder.length > 0
      ? `ORDER BY ${(requestedOrder.length > 0 ? requestedOrder : defaultOrder).join(", ")}`
      : "",
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    sql,
    params,
    request,
    dimensionAliases,
    measureAliases,
    resultLimit: limit,
  };
}

function parseSummary(header: unknown) {
  try {
    return JSON.parse(String(header ?? "{}")) as Record<string, string>;
  } catch {
    return {};
  }
}

export class ClickHouseAdapter implements SourceAdapter {
  constructor(private readonly client: ClickHouseClient = getClickHouse()) {}

  async execute(query: CompiledQuery) {
    const result = await this.client.query({
      query: query.sql,
      query_params: query.params,
      format: "JSONEachRow",
      clickhouse_settings: {
        max_execution_time: 30,
        timeout_before_checking_execution_speed: 0,
        max_rows_to_read: "1000000000",
        max_bytes_to_read: "100000000000",
        max_result_rows: String(query.resultLimit),
        result_overflow_mode: "break",
      },
    });
    const rows = await result.json<Record<string, unknown>>();
    const summary = parseSummary(result.response_headers?.["x-clickhouse-summary"]);
    return {
      rows,
      stats: {
        rowsRead: Number(summary.read_rows ?? 0),
        bytesRead: Number(summary.read_bytes ?? 0),
        elapsedMs: Math.round(Number(summary.elapsed_ns ?? 0) / 1e6),
        queryId: result.query_id,
      },
    };
  }
}
