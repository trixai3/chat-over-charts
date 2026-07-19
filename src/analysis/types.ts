import type { QueryStats, ValueFormat, ViewSpec } from "../shared/view-spec";

export type AnalysisType = "single_value" | "trend" | "category_comparison" | "detail";
export type TimeGrain = "day" | "month" | "quarter" | "year";
export type FigureKind = "kpi" | "timeseries" | "comparison" | "table";

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
};

/** Every field has been resolved to a governed semantic ID. */
export type ResolvedAnalysisRequest = Omit<AnalysisDraft, "analysisType"> & {
  analysisType: AnalysisType;
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
};

export type AnalysisPlanResult =
  | AnalysisPlan
  | {
      status: "needs_clarification";
      resolved: Partial<ResolvedAnalysisRequest>;
      ambiguities: Clarification[];
    }
  | {
      status: "unsupported";
      reason: string;
      suggestions: string[];
    };

export type DimensionKind = "time" | "category" | "identifier";

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
