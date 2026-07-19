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

// selectProvisionalFigure additionally surfaces the ranked, compatible kinds
// it didn't pick — finalizeFigure runs post-query and has nothing analogous
// to rank, so it stays on the plain Selection type above.
type ProvisionalSelection =
  | { status: "selected"; kind: FigureKind; reason: string; alternatives: FigureKind[] }
  | { status: "unsupported"; reason: string; suggestions: string[] };

// Ranked candidate order per analysis type — the single source of truth for
// both the default figure (first entry) and the compatible alternatives
// surfaced to the model (the rest, filtered by compatible()).
const CANDIDATES: Record<ResolvedAnalysisRequest["analysisType"], FigureKind[]> = {
  single_value: ["kpi", "table"],
  trend: ["timeseries", "area", "table"],
  category_comparison: ["comparison", "pie", "scatter", "table"],
  detail: ["table", "comparison"],
  distribution: ["distribution"],
};

function compatible(kind: FigureKind, request: ResolvedAnalysisRequest, model: SemanticModel) {
  const dimensions = request.dimensions.map((field) => model.dimensions[field.field]);
  const hasTime = dimensions.some((dimension) => dimension?.kind === "time");
  const hasCategory = dimensions.some((dimension) => dimension?.kind === "category");
  switch (kind) {
    case "kpi":
      return request.measures.length >= 1 && request.dimensions.length === 0;
    case "timeseries":
      return hasTime;
    case "comparison":
      return hasCategory;
    case "table":
      return request.dimensions.length + request.measures.length > 0;
    case "pie": {
      const categoryDimensions = dimensions.filter((dimension) => dimension?.kind === "category");
      const measure = model.measures[request.measures[0]];
      return categoryDimensions.length === 1 && !hasTime && measure?.additive === true;
    }
    case "scatter": {
      const categoryDimensions = dimensions.filter((dimension) => dimension?.kind === "category");
      return request.measures.length >= 2 && categoryDimensions.length === 1 && !hasTime;
    }
    case "area": {
      const measure = model.measures[request.measures[0]];
      return hasTime && hasCategory && measure?.additive === true;
    }
    case "distribution":
      // The compile path is different, so it is not reachable as a
      // preferredFigure on other analysis types.
      return request.analysisType === "distribution";
  }
}

/** The full ranked set of figures compatible with this request, most-preferred first. */
export function compatibleFigures(
  request: ResolvedAnalysisRequest,
  model: SemanticModel,
): FigureKind[] {
  return CANDIDATES[request.analysisType].filter((kind) => compatible(kind, request, model));
}

export function selectProvisionalFigure(
  request: ResolvedAnalysisRequest,
  model: SemanticModel,
): ProvisionalSelection {
  const compatibleKinds = compatibleFigures(request, model);
  const preferred = request.preferredFigure;

  if (preferred) {
    if (compatibleKinds.includes(preferred)) {
      return {
        status: "selected",
        kind: preferred,
        reason: `The requested ${preferred} is compatible with the governed data roles.`,
        alternatives: compatibleKinds.filter((kind) => kind !== preferred),
      };
    }
    return {
      status: "unsupported",
      reason:
        compatibleKinds.length > 0
          ? `A ${preferred} is incompatible with the resolved data roles; compatible figures are ${compatibleKinds.join(", ")}.`
          : `A ${preferred} is incompatible with the resolved data roles, and no figure in this source's policy is compatible either.`,
      suggestions: compatibleKinds,
    };
  }

  const [kind, ...alternatives] = compatibleKinds;
  if (!kind) {
    const registeredDefault = CANDIDATES[request.analysisType][0];
    return {
      status: "unsupported",
      reason: `The ${request.analysisType} request is missing roles required by ${registeredDefault}.`,
      suggestions: ["Add the required measure or dimension."],
    };
  }
  return {
    status: "selected",
    kind,
    reason: `${kind} is the registered default for ${request.analysisType.replaceAll("_", " ")}.`,
    alternatives,
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
  if (provisional === "pie" && profile.categoryCount > 8) {
    return {
      status: "selected",
      kind: "comparison",
      reason: "More than eight slices are unreadable in a pie, so a comparison is shown instead.",
    };
  }
  if (provisional === "area" && profile.seriesCount > MAX_LINE_SERIES) {
    return {
      status: "unsupported",
      reason: `${profile.seriesCount} series exceed the line policy limit of ${MAX_LINE_SERIES}.`,
      suggestions: ["Choose up to eight series or narrow the category filter."],
    };
  }
  if (provisional === "area" && profile.seriesCount <= 1) {
    return {
      status: "selected",
      kind: "timeseries",
      reason: "Stacking one series adds nothing, so a timeseries is shown instead.",
    };
  }
  if (provisional === "scatter" && profile.rowCount < 3) {
    return {
      status: "selected",
      kind: "table",
      reason: "Too few points to show correlation, so a table is shown instead.",
    };
  }
  return {
    status: "selected",
    kind: provisional,
    reason: "The returned data satisfies the provisional figure contract.",
  };
}
