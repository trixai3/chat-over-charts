import type {
  DatasetProfile,
  FigureKind,
  ResolvedAnalysisRequest,
  SemanticModel,
} from "./types";

export const CHART_POLICY_VERSION = "1.0.0";
export const MAX_COMPARISON_CATEGORIES = 40;
export const MAX_LINE_SERIES = 8;

type Selection =
  | { status: "selected"; kind: FigureKind; reason: string }
  | { status: "unsupported"; reason: string; suggestions: string[] };

const DEFAULTS: Record<ResolvedAnalysisRequest["analysisType"], FigureKind> = {
  single_value: "kpi",
  trend: "timeseries",
  category_comparison: "comparison",
  detail: "table",
};

function compatible(kind: FigureKind, request: ResolvedAnalysisRequest, model: SemanticModel) {
  const dimensions = request.dimensions.map((field) => model.dimensions[field.field]);
  switch (kind) {
    case "kpi":
      return request.measures.length >= 1 && request.dimensions.length === 0;
    case "timeseries":
      return dimensions.some((dimension) => dimension?.kind === "time");
    case "comparison":
      return dimensions.some((dimension) => dimension?.kind === "category");
    case "table":
      return request.dimensions.length + request.measures.length > 0;
  }
}

export function selectProvisionalFigure(
  request: ResolvedAnalysisRequest,
  model: SemanticModel,
): Selection {
  const preferred = request.preferredFigure;
  if (preferred) {
    if (compatible(preferred, request, model)) {
      return {
        status: "selected",
        kind: preferred,
        reason: `The requested ${preferred} is compatible with the governed data roles.`,
      };
    }
    return {
      status: "unsupported",
      reason: `A ${preferred} is incompatible with the resolved data roles.`,
      suggestions: [DEFAULTS[request.analysisType]],
    };
  }

  const kind = DEFAULTS[request.analysisType];
  if (!compatible(kind, request, model)) {
    return {
      status: "unsupported",
      reason: `The ${request.analysisType} request is missing roles required by ${kind}.`,
      suggestions: ["Add the required measure or dimension."],
    };
  }
  return {
    status: "selected",
    kind,
    reason: `${kind} is the registered default for ${request.analysisType.replaceAll("_", " ")}.`,
  };
}

export function finalizeFigure(
  provisional: FigureKind,
  profile: DatasetProfile,
): Selection {
  if (profile.rowCount === 0) {
    return {
      status: "unsupported",
      reason: "The governed query returned no rows.",
      suggestions: ["Broaden the date range or remove one filter."],
    };
  }
  if (profile.truncated) {
    return {
      status: "unsupported",
      reason: "The query reached its safety result cap, so rendering it would silently omit data.",
      suggestions: ["Narrow the filters or explicitly choose a result limit."],
    };
  }
  if (provisional === "timeseries" && profile.timePointCount < 2) {
    return {
      status: "selected",
      kind: profile.categoryCount > 1 ? "comparison" : "kpi",
      reason:
        profile.categoryCount > 1
          ? "Only one time point was returned, so a category comparison is more truthful than a line."
          : "Only one time point was returned, so a KPI is more truthful than a line.",
    };
  }
  if (provisional === "timeseries" && profile.seriesCount > MAX_LINE_SERIES) {
    return {
      status: "unsupported",
      reason: `${profile.seriesCount} series exceed the line policy limit of ${MAX_LINE_SERIES}.`,
      suggestions: ["Choose up to eight series or narrow the category filter."],
    };
  }
  if (provisional === "comparison" && profile.categoryCount > MAX_COMPARISON_CATEGORIES) {
    return {
      status: "unsupported",
      reason: `${profile.categoryCount} categories exceed the policy limit of ${MAX_COMPARISON_CATEGORIES}.`,
      suggestions: ["Narrow the category scope or explicitly request a smaller set."],
    };
  }
  return {
    status: "selected",
    kind: provisional,
    reason: "The returned data satisfies the provisional figure contract.",
  };
}
