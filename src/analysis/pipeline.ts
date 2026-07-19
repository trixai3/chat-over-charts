import type { ExplanationManifest, QueryStats, ViewSpec } from "../shared/view-spec";
import { finalizeFigure } from "./chart-policy";
import { ClickHouseAdapter, compileClickHouseQuery } from "./clickhouse-adapter";
import { getSemanticModel } from "./semantic-model";
import type {
  AnalysisPlan,
  AnalysisResult,
  DatasetProfile,
  FigureKind,
  QueryExecution,
  SemanticMeasure,
  SemanticModel,
  SourceAdapter,
} from "./types";

// A comparison changes what the numbers *are* (percent deltas, not levels), so
// display formatting and labels come from here, never from the raw measure.
function displayFormat(measure: SemanticMeasure, plan: AnalysisPlan) {
  return plan.request.comparison
    ? ({ style: "percent", maximumFractionDigits: 1 } as const)
    : measure.format;
}

function displayLabel(measure: SemanticMeasure, plan: AnalysisPlan): string {
  return plan.request.comparison
    ? `${measure.label} — % change vs previous period`
    : measure.label;
}

function numberValue(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} returned a non-numeric value.`);
  return parsed;
}

function stringValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function profile(
  execution: QueryExecution,
  plan: AnalysisPlan,
  model: SemanticModel,
  resultLimit: number,
  rawRowCount: number,
): DatasetProfile {
  const category = plan.request.dimensions.find(
    (field) => model.dimensions[field.field]?.kind === "category",
  );
  const time = plan.request.dimensions.find(
    (field) => model.dimensions[field.field]?.kind === "time",
  );
  const categories = new Set(
    category ? execution.rows.map((row) => stringValue(row[category.field])) : [],
  );
  const times = new Set(time ? execution.rows.map((row) => stringValue(row[time.field])) : []);
  return {
    rowCount: execution.rows.length,
    categoryCount: categories.size,
    timePointCount: times.size,
    seriesCount: category ? categories.size : execution.rows.length > 0 ? 1 : 0,
    // A distribution is one histogram(20) row for the whole population, like a
    // single_value query — the row cap it hits is never a truncation signal.
    truncated:
      plan.request.analysisType !== "single_value" &&
      plan.request.analysisType !== "distribution" &&
      plan.request.limit === undefined &&
      rawRowCount >= resultLimit,
  };
}

function validateExecution(
  execution: QueryExecution,
  plan: AnalysisPlan,
): string[] {
  const issues: string[] = [];
  const required = [
    ...plan.request.dimensions.map((field) => field.field),
    ...plan.request.measures,
  ];
  for (const [index, row] of execution.rows.entries()) {
    for (const field of required) {
      if (!(field in row)) issues.push(`Row ${index + 1} is missing required field ${field}.`);
    }
    for (const measure of plan.request.measures) {
      if (measure in row && !Number.isFinite(Number(row[measure]))) {
        issues.push(`Row ${index + 1} has a non-numeric value for ${measure}.`);
      }
    }
  }
  if (plan.request.dimensions.length > 0) {
    const keys = execution.rows.map((row) =>
      plan.request.dimensions.map((field) => stringValue(row[field.field])).join("\u001f"),
    );
    if (new Set(keys).size !== keys.length) {
      issues.push("The result contains duplicate rows at the declared dimensional grain.");
    }
  }
  return [...new Set(issues)];
}

function explanation(
  plan: AnalysisPlan,
  model: SemanticModel,
  querySql: string,
  stats: QueryStats,
): ExplanationManifest {
  const measures = plan.request.measures.map((id) => model.measures[id]);
  const dimensions = plan.request.dimensions.map((field) => model.dimensions[field.field]);
  const scope = plan.request.filters.map((filter) => {
    const label = model.dimensions[filter.field]?.label ?? filter.field;
    const value = Array.isArray(filter.value) ? filter.value.join(" – ") : String(filter.value);
    return `${label} ${filter.operator.replaceAll("_", " ")} ${value}`;
  });
  for (const field of plan.request.dimensions) {
    if (field.grain) scope.push(`${model.dimensions[field.field].label} displayed by ${field.grain}`);
  }
  if (plan.request.limit) scope.push(`Explicit result limit: ${plan.request.limit}`);
  if (plan.request.seriesSelection) {
    const rank = model.measures[plan.request.seriesSelection.by];
    scope.push(
      `Confirmed series scope: top ${plan.request.seriesSelection.n} by ${rank?.label ?? plan.request.seriesSelection.by}`,
    );
  }

  return {
    whatShown: `${measures.map((measure) => displayLabel(measure, plan)).join(" and ")}${
      dimensions.length > 0 ? ` by ${dimensions.map((dimension) => dimension.label).join(" and ")}` : ""
    }.`,
    calculation:
      measures
        .map((measure) => `${measure.label}: ${measure.description} (${measure.aggregation}).`)
        .join(" ") +
      (plan.request.comparison
        ? " Each value is displayed as the percentage change versus the previous displayed period."
        : ""),
    scope,
    provenance: {
      semanticModel: model.label,
      source: model.sourceSystem,
      lastRefresh: model.lastRefresh,
      modelVersion: model.version,
      measureVersions: measures.map((measure) => `${measure.id}@${measure.version}`),
      figurePolicyVersion: model.figurePolicyVersion,
      queryId: stats.queryId,
    },
    limitations: [
      ...new Set([
        ...measures.flatMap((measure) => measure.limitations),
        ...(plan.request.comparison
          ? ["The first displayed period is omitted because it has no previous period to compare against."]
          : []),
      ]),
    ],
    inspect: {
      semanticQuery: JSON.stringify(plan.request, null, 2),
      generatedSql: querySql,
    },
  };
}

function title(plan: AnalysisPlan, model: SemanticModel): string {
  const measure = displayLabel(model.measures[plan.request.measures[0]], plan);
  const dimensions = plan.request.dimensions
    .map((field) => model.dimensions[field.field].label)
    .join(" by ");
  return dimensions ? `${measure} by ${dimensions}` : measure;
}

function notice(titleText: string, message: string, suggestions: string[]): ViewSpec {
  return { kind: "notice", title: titleText, message, tone: "warning", suggestions };
}

function buildKpi(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const measure = model.measures[plan.request.measures[0]];
  const value = numberValue(rows[rows.length - 1]?.[measure.id], measure.id);
  return {
    kind: "kpi",
    title: title(plan, model),
    value,
    format: displayFormat(measure, plan),
    label: displayLabel(measure, plan),
    stats,
    explanation: manifest,
  };
}

function buildTimeseries(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const time = plan.request.dimensions.find(
    (field) => model.dimensions[field.field].kind === "time",
  );
  if (!time) throw new Error("Timeseries requires a time dimension.");
  const category = plan.request.dimensions.find(
    (field) => model.dimensions[field.field].kind === "category",
  );
  const measure = model.measures[plan.request.measures[0]];
  const grouped = new Map<string, Array<{ t: string; v: number }>>();
  for (const row of rows) {
    const label = category ? stringValue(row[category.field]) : displayLabel(measure, plan);
    const points = grouped.get(label) ?? [];
    points.push({ t: stringValue(row[time.field]), v: numberValue(row[measure.id], measure.id) });
    grouped.set(label, points);
  }
  return {
    kind: "timeseries",
    title: title(plan, model),
    format: displayFormat(measure, plan),
    series: [...grouped.entries()].map(([label, points]) => ({ label, points })),
    drillTargets: [],
    stats,
    explanation: manifest,
  };
}

function buildComparison(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const category = plan.request.dimensions.find(
    (field) => model.dimensions[field.field].kind === "category",
  );
  if (!category) throw new Error("Comparison requires a category dimension.");
  const measure = model.measures[plan.request.measures[0]];
  const deltaMeasure = plan.request.measures[1]
    ? model.measures[plan.request.measures[1]]
    : undefined;
  return {
    kind: "comparison",
    title: title(plan, model),
    metricLabel: displayLabel(measure, plan),
    comparisonLabel: deltaMeasure ? displayLabel(deltaMeasure, plan) : undefined,
    format: displayFormat(measure, plan),
    rows: rows.map((row) => ({
      label: stringValue(row[category.field]),
      value: numberValue(row[measure.id], measure.id),
      delta: deltaMeasure ? numberValue(row[deltaMeasure.id], deltaMeasure.id) : undefined,
    })),
    stats,
    explanation: manifest,
  };
}

function buildTable(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const dimensionColumns = plan.request.dimensions.map((field) => ({
    key: field.field,
    label: model.dimensions[field.field].label,
  }));
  const measureColumns = plan.request.measures.map((id) => ({
    key: id,
    label: displayLabel(model.measures[id], plan),
    format: displayFormat(model.measures[id], plan),
  }));
  return {
    kind: "table",
    title: title(plan, model),
    columns: [...dimensionColumns, ...measureColumns],
    rows: rows.map((row) => Object.fromEntries([
      ...dimensionColumns.map((column) => [column.key, stringValue(row[column.key])]),
      ...measureColumns.map((column) => [
        column.key,
        row[column.key] === null ? null : numberValue(row[column.key], column.key),
      ]),
    ])),
    stats,
    explanation: manifest,
  };
}

function buildPie(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const category = plan.request.dimensions.find(
    (field) => model.dimensions[field.field].kind === "category",
  );
  if (!category) throw new Error("Pie requires a category dimension.");
  const measure = model.measures[plan.request.measures[0]];
  return {
    kind: "pie",
    title: title(plan, model),
    metricLabel: displayLabel(measure, plan),
    format: displayFormat(measure, plan),
    slices: rows.map((row) => ({
      label: stringValue(row[category.field]),
      value: numberValue(row[measure.id], measure.id),
    })),
    stats,
    explanation: manifest,
  };
}

function buildScatter(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const category = plan.request.dimensions.find(
    (field) => model.dimensions[field.field].kind === "category",
  );
  if (!category) throw new Error("Scatter requires a category dimension.");
  const xMeasure = model.measures[plan.request.measures[0]];
  const yMeasure = model.measures[plan.request.measures[1]];
  if (!yMeasure) throw new Error("Scatter requires two measures.");
  return {
    kind: "scatter",
    title: title(plan, model),
    xLabel: displayLabel(xMeasure, plan),
    yLabel: displayLabel(yMeasure, plan),
    xFormat: displayFormat(xMeasure, plan),
    yFormat: displayFormat(yMeasure, plan),
    points: rows.map((row) => ({
      label: stringValue(row[category.field]),
      x: numberValue(row[xMeasure.id], xMeasure.id),
      y: numberValue(row[yMeasure.id], yMeasure.id),
    })),
    stats,
    explanation: manifest,
  };
}

function buildArea(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const time = plan.request.dimensions.find(
    (field) => model.dimensions[field.field].kind === "time",
  );
  if (!time) throw new Error("Area requires a time dimension.");
  const category = plan.request.dimensions.find(
    (field) => model.dimensions[field.field].kind === "category",
  );
  const measure = model.measures[plan.request.measures[0]];
  const grouped = new Map<string, Array<{ t: string; v: number }>>();
  for (const row of rows) {
    const label = category ? stringValue(row[category.field]) : displayLabel(measure, plan);
    const points = grouped.get(label) ?? [];
    points.push({ t: stringValue(row[time.field]), v: numberValue(row[measure.id], measure.id) });
    grouped.set(label, points);
  }
  return {
    kind: "area",
    title: title(plan, model),
    format: displayFormat(measure, plan),
    series: [...grouped.entries()].map(([label, points]) => ({ label, points })),
    stats,
    explanation: manifest,
  };
}

function buildDistribution(
  rows: Array<Record<string, unknown>>,
  plan: AnalysisPlan,
  model: SemanticModel,
  stats: QueryStats,
  manifest: ExplanationManifest,
): ViewSpec {
  const measure = model.measures[plan.request.measures[0]];
  const rawBins = rows[0]?.bins;
  if (!Array.isArray(rawBins)) throw new Error("Distribution requires a bins array in the result row.");
  const bins = rawBins.map((entry) => {
    const [from, to, height] = entry as [unknown, unknown, unknown];
    return {
      from: numberValue(from, "bin.from"),
      to: numberValue(to, "bin.to"),
      count: Math.round(numberValue(height, "bin.height")),
    };
  });
  // Median is only meaningful to overlay when the measure IS the median —
  // any other aggregate returned in the same row would mislabel the marker.
  const isMedianMeasure = measure.aggregation.toLowerCase().includes("median");
  const medianRaw = rows[0]?.[measure.id];
  const median =
    isMedianMeasure && medianRaw !== undefined ? numberValue(medianRaw, measure.id) : undefined;
  return {
    kind: "distribution",
    title: title(plan, model),
    format: measure.format,
    bins,
    median,
    stats,
    explanation: manifest,
  };
}

function buildSpec(
  kind: FigureKind,
  execution: QueryExecution,
  plan: AnalysisPlan,
  model: SemanticModel,
  manifest: ExplanationManifest,
): ViewSpec {
  switch (kind) {
    case "kpi":
      return buildKpi(execution.rows, plan, model, execution.stats, manifest);
    case "timeseries":
      return buildTimeseries(execution.rows, plan, model, execution.stats, manifest);
    case "comparison":
      return buildComparison(execution.rows, plan, model, execution.stats, manifest);
    case "table":
      return buildTable(execution.rows, plan, model, execution.stats, manifest);
    case "pie":
      return buildPie(execution.rows, plan, model, execution.stats, manifest);
    case "scatter":
      return buildScatter(execution.rows, plan, model, execution.stats, manifest);
    case "area":
      return buildArea(execution.rows, plan, model, execution.stats, manifest);
    case "distribution":
      return buildDistribution(execution.rows, plan, model, execution.stats, manifest);
  }
}

export async function runAnalysis(
  plan: AnalysisPlan,
  adapter?: SourceAdapter,
): Promise<AnalysisResult> {
  const model = getSemanticModel(plan.request.sourceId);
  if (!model) throw new Error(`Unknown semantic model: ${plan.request.sourceId}`);
  const query = compileClickHouseQuery(plan.request, model);
  const source = adapter ?? new ClickHouseAdapter();
  const raw = await source.execute(query);
  // Under a previous-period comparison the first period has no predecessor, so
  // the window function yields NULL there. Dropping it is a declared behaviour
  // — the explanation's limitations state the omission.
  const execution: QueryExecution = plan.request.comparison
    ? {
        ...raw,
        rows: raw.rows.filter((row) =>
          plan.request.measures.every((id) => row[id] !== null && row[id] !== undefined),
        ),
      }
    : raw;
  const datasetProfile = profile(execution, plan, model, query.resultLimit, raw.rows.length);
  const validationIssues = validateExecution(execution, plan);
  if (validationIssues.length > 0) {
    return {
      spec: {
        kind: "notice",
        title: "The dataset failed validation",
        message: validationIssues[0],
        tone: "error",
        suggestions: validationIssues.slice(1),
      },
      profile: datasetProfile,
      query,
    };
  }
  const final = finalizeFigure(plan.figure, datasetProfile);
  if (final.status === "unsupported") {
    return {
      spec: notice("This result needs a narrower request", final.reason, final.suggestions),
      profile: datasetProfile,
      query,
    };
  }
  const manifest = explanation(plan, model, query.sql, execution.stats);
  return {
    spec: buildSpec(final.kind, execution, plan, model, manifest),
    profile: datasetProfile,
    query,
  };
}

export function summarizeSpec(spec: ViewSpec): string {
  switch (spec.kind) {
    case "kpi":
      return `${spec.label}: ${spec.value}.`;
    case "timeseries": {
      const values = spec.series.flatMap((series) => series.points.map((point) => point.v));
      return `${spec.series.length} series, ${values.length} points, range ${Math.min(...values)}–${Math.max(...values)}.`;
    }
    case "comparison":
      return `${spec.rows.length} categories. First: ${spec.rows[0].label} ${spec.rows[0].value}.`;
    case "table":
      return `${spec.rows.length} rows and ${spec.columns.length} columns.`;
    case "notice":
      return `Cannot render yet: ${spec.message}`;
    case "distribution":
      return `${spec.bins.length} distribution bins.`;
    case "pie":
      return `${spec.slices.length} slices.`;
    case "scatter":
      return `${spec.points.length} points.`;
    case "area":
      return `${spec.series.length} series.`;
    case "disambiguation":
      return `${spec.candidates.length} candidates require a choice.`;
    case "verdict":
      return "Verdict delivered.";
  }
}
