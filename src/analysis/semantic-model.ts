import { ukHousePrices } from "./models/uk-house-prices";
import type {
  AnalysisDraft,
  AnalysisField,
  AnalysisFilter,
  AnalysisPlanResult,
  AnalysisType,
  SemanticDimension,
  SemanticMeasure,
  SemanticModel,
} from "./types";
import { selectProvisionalFigure } from "./chart-policy";

const MODELS: Record<string, SemanticModel> = {
  [ukHousePrices.id]: ukHousePrices,
};

export function getSemanticModel(id: string): SemanticModel | undefined {
  return MODELS[id];
}

export function listSemanticModels(): SemanticModel[] {
  return Object.values(MODELS);
}

/** Trusted onboarding seam used by application modules and isolated tests. */
export function registerSemanticModel(model: SemanticModel): () => void {
  if (MODELS[model.id]) throw new Error(`Semantic model already registered: ${model.id}`);
  MODELS[model.id] = model;
  return () => {
    delete MODELS[model.id];
  };
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
}

function resolveEntry<T extends SemanticMeasure | SemanticDimension>(
  term: string,
  entries: Record<string, T>,
): T | undefined {
  const target = normalized(term);
  return Object.values(entries).find(
    (entry) =>
      normalized(entry.id) === target ||
      normalized(entry.label) === target ||
      entry.synonyms.some((synonym) => normalized(synonym) === target),
  );
}

function resolveField(field: AnalysisField, model: SemanticModel): AnalysisField | undefined {
  const dimension = resolveEntry(field.field, model.dimensions);
  if (!dimension) return undefined;
  if (field.grain && (!dimension.grains || !dimension.grains[field.grain])) return undefined;
  return { field: dimension.id, grain: field.grain };
}

function resolveFilter(filter: AnalysisFilter, model: SemanticModel): AnalysisFilter | undefined {
  const dimension = resolveEntry(filter.field, model.dimensions);
  return dimension ? { ...filter, field: dimension.id } : undefined;
}

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  single_value: "One headline value",
  trend: "Change over ordered time",
  category_comparison: "Compare categories",
  detail: "Inspect exact rows",
};

export function planAnalysis(draft: AnalysisDraft): AnalysisPlanResult {
  const model = getSemanticModel(draft.sourceId);
  if (!model) {
    return {
      status: "unsupported",
      reason: `Unknown semantic model “${draft.sourceId}”.`,
      suggestions: listSemanticModels().map((item) => item.id),
    };
  }

  if (!draft.analysisType) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "analysisType",
          question: "What should the figure help you understand?",
          options: (Object.keys(ANALYSIS_LABELS) as AnalysisType[]).map((id) => ({
            id,
            label: ANALYSIS_LABELS[id],
          })),
          recommended: "category_comparison",
          reason: "The analytical purpose determines the required data roles and chart policy.",
        },
      ],
    };
  }

  const measureTerms = draft.measures.length > 0 ? draft.measures : [model.defaults.measure];
  const measures = measureTerms.map((term) => resolveEntry(term, model.measures));
  const missingMeasure = measureTerms.find((_, index) => !measures[index]);
  if (missingMeasure) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "measures",
          question: `Which governed measure should replace “${missingMeasure}”?`,
          options: Object.values(model.measures).map((measure) => ({
            id: measure.id,
            label: measure.label,
            description: measure.description,
          })),
          recommended: model.defaults.measure,
          reason: "Only measures defined by the semantic layer can be queried.",
        },
      ],
    };
  }

  let dimensions = draft.dimensions.map((field) => resolveField(field, model));
  const missingDimension = draft.dimensions.find((_, index) => !dimensions[index]);
  if (missingDimension) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "dimensions",
          question: `Which governed dimension should replace “${missingDimension.field}”?`,
          options: Object.values(model.dimensions).map((dimension) => ({
            id: dimension.id,
            label: dimension.label,
            description: dimension.description,
          })),
          recommended: model.defaults.timeDimension ?? Object.keys(model.dimensions)[0],
          reason: "Only dimensions and grains supported by the source can be selected.",
        },
      ],
    };
  }

  if (draft.analysisType === "trend" && !dimensions.some((field) => {
    const dimension = field && model.dimensions[field.field];
    return dimension?.kind === "time";
  })) {
    const timeId = model.defaults.timeDimension;
    if (!timeId) {
      return {
        status: "unsupported",
        reason: "This semantic model has no time dimension for a trend.",
        suggestions: ["Use a category comparison or table instead."],
      };
    }
    dimensions = [
      { field: timeId, grain: model.defaults.timeGrain },
      ...dimensions,
    ];
  }

  if (
    draft.analysisType === "category_comparison" &&
    !dimensions.some((field) => field && model.dimensions[field.field]?.kind === "category")
  ) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "dimensions",
          question: "Which category should be compared?",
          options: Object.values(model.dimensions)
            .filter((dimension) => dimension.kind === "category")
            .map((dimension) => ({ id: dimension.id, label: dimension.label })),
          recommended: "district",
          reason: "A category comparison requires one governed categorical dimension.",
        },
      ],
    };
  }

  const filters = draft.filters.map((filter) => resolveFilter(filter, model));
  const missingFilter = draft.filters.find((_, index) => !filters[index]);
  if (missingFilter) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "filters",
          question: `Which governed field should “${missingFilter.field}” filter?`,
          options: Object.values(model.dimensions).map((dimension) => ({
            id: dimension.id,
            label: dimension.label,
          })),
          recommended: Object.keys(model.dimensions)[0],
          reason: "Filters must resolve to governed dimensions before SQL is compiled.",
        },
      ],
    };
  }

  const orderBy = draft.orderBy.map((order) => {
    const measure = resolveEntry(order.field, model.measures);
    const dimension = resolveEntry(order.field, model.dimensions);
    return measure || dimension ? { ...order, field: (measure ?? dimension)!.id } : undefined;
  });
  if (orderBy.some((order) => !order)) {
    return {
      status: "unsupported",
      reason: "The requested sort field is not in the semantic model.",
      suggestions: [...Object.keys(model.dimensions), ...Object.keys(model.measures)],
    };
  }

  const request = {
    ...draft,
    analysisType: draft.analysisType,
    measures: measures.map((measure) => measure!.id),
    dimensions: dimensions.map((dimension) => dimension!),
    filters: filters.map((filter) => filter!),
    orderBy: orderBy.map((order) => order!),
  };
  const figure = selectProvisionalFigure(request, model);
  if (figure.status !== "selected") {
    return { status: "unsupported", reason: figure.reason, suggestions: figure.suggestions };
  }

  return {
    status: "ready",
    request,
    figure: figure.kind,
    figureReason: figure.reason,
  };
}
