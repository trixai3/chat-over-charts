import type { QueryStats, ValueFormat, ViewSpec } from "../shared/view-spec";

export type AnalysisType =
  | "single_value"
  | "trend"
  | "category_comparison"
  | "detail"
  | "distribution";
export type TimeGrain = "day" | "month" | "quarter" | "year";
export type FigureKind =
  | "kpi"
  | "timeseries"
  | "comparison"
  | "table"
  | "pie"
  | "scatter"
  | "area"
  | "distribution";

export type FilterOperator = "equals" | "in" | "between" | "gte" | "lte";
export type FilterValue = string | number | string[] | number[];

export type AnalysisFilter = {
  field: string;
  operator: FilterOperator;
  value: FilterValue;
};

export type AnalysisField = {
  field: string;
  grain?: TimeGrain;
};

export type AnalysisOrder = {
  field: string;
  direction: "asc" | "desc";
};

/**
 * Design §13 `series_selection`: an explicit, user-confirmed rule for keeping a
 * multi-series figure readable. Never applied silently (design §14.3).
 */
export type SeriesSelection = {
  method: "top";
  n: number;
  /** Governed measure term (draft) or ID (resolved) used to rank the series. */
  by?: string;
};

/**
 * Query-time transform applied to every requested measure (design §5.7
 * "comparison calculations"): the % change versus the previous displayed
 * period. Requires a time dimension.
 */
export type Comparison = "vs_previous_period";

/** Terms may be semantic IDs, labels, or registered synonyms. */
export type AnalysisDraft = {
  question: string;
  sourceId: string;
  analysisType?: AnalysisType;
  measures: string[];
  dimensions: AnalysisField[];
  filters: AnalysisFilter[];
  orderBy: AnalysisOrder[];
  preferredFigure?: FigureKind;
  limit?: number;
  seriesSelection?: SeriesSelection;
  comparison?: Comparison;
};

/** Every field has been resolved to a governed semantic ID. */
export type ResolvedAnalysisRequest = Omit<AnalysisDraft, "analysisType" | "seriesSelection"> & {
  analysisType: AnalysisType;
  seriesSelection?: SeriesSelection & { by: string };
};

export type Clarification = {
  field: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
  recommended: string;
  reason: string;
};

export type AnalysisPlan = {
  status: "ready";
  request: ResolvedAnalysisRequest;
  figure: FigureKind;
  figureReason: string;
  figureAlternatives: FigureKind[];
};

export type AnalysisPlanResult =
  | AnalysisPlan
  | {
      status: "needs_clarification";
      /** The draft as far as it resolved; terms in it may still be ungoverned. */
      resolved: Partial<AnalysisDraft>;
      ambiguities: Clarification[];
    }
  | {
      status: "unsupported";
      reason: string;
      suggestions: string[];
    };

export type DimensionKind = "time" | "category" | "identifier";

/**
 * A measure is always a plain aggregate over the fact table — the same rule as
 * a Snowflake semantic model fact or a Databricks metric-view measure. Time
 * math (change, growth) is a query-time `comparison` on the request, never a
 * stored measure, so any measure is valid at any displayed grain.
 */
export type SemanticMeasure = {
  id: string;
  label: string;
  description: string;
  expression: string;
  format: ValueFormat;
  aggregation: string;
  version: string;
  synonyms: string[];
  limitations: string[];
  /**
   * Shown when a user asks for a different aggregation of this measure (e.g.
   * "average" when the governed measure is a median). Must explain why the
   * governed aggregation is the one this source publishes.
   */
  aggregationNote?: string;
  /**
   * True when values of this measure can be summed across category members
   * (counts, sums). Pies and stacked areas of non-additive aggregates
   * (medians) are lies, so the chart policy requires this flag.
   */
  additive?: boolean;
  /**
   * The raw per-row SQL expression the aggregate summarizes (e.g. "price").
   * Required to build a distribution; absent for measures with no per-row
   * value (counts).
   */
  valueExpression?: string;
};

export type SemanticDimension = {
  id: string;
  label: string;
  description: string;
  expression: string;
  kind: DimensionKind;
  synonyms: string[];
  cardinality?: number;
  valueNormalization?: "uppercase" | "lowercase";
  /**
   * Governed value domain, snapshotted at onboarding (design §5.4; the
   * `sample_values` role in a Snowflake semantic model). When present, filter
   * values are validated and disambiguated against it before SQL exists.
   * Stored in the same normalization as the source column.
   */
  values?: string[];
  grains?: Partial<Record<TimeGrain, string>>;
};

export type SemanticModel = {
  id: string;
  label: string;
  adapter: "clickhouse";
  database: string;
  table: string;
  sourceSystem: string;
  lastRefresh: string;
  availableRange?: [string, string];
  version: string;
  figurePolicyVersion: string;
  measures: Record<string, SemanticMeasure>;
  dimensions: Record<string, SemanticDimension>;
  defaults: {
    measure: string;
    timeDimension?: string;
    timeGrain?: TimeGrain;
    /** Measure used to rank series for a confirmed top-N selection. */
    seriesRankMeasure?: string;
  };
};

export type CompiledQuery = {
  sql: string;
  params: Record<string, unknown>;
  request: ResolvedAnalysisRequest;
  dimensionAliases: string[];
  measureAliases: string[];
  resultLimit: number;
};

export type QueryExecution = {
  rows: Array<Record<string, unknown>>;
  stats: QueryStats;
};

export interface SourceAdapter {
  execute(query: CompiledQuery): Promise<QueryExecution>;
}

export type DatasetProfile = {
  rowCount: number;
  categoryCount: number;
  timePointCount: number;
  seriesCount: number;
  truncated: boolean;
};

export type AnalysisResult = {
  spec: ViewSpec;
  profile: DatasetProfile;
  query: CompiledQuery;
};
