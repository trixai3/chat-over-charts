// Slice 5a acceptance test (V2 §16.5, "governed extension of data sources").
// The claim under test: the analysis engine is source-agnostic. This file is
// wholly additive — it registers a second SemanticModel, deliberately unlike
// housing (tube ridership: no geography, a line/station hierarchy instead of
// county/district/town), and drives it through plan -> compile -> stub-
// execute -> ViewSpec, plus generic member resolution and the generated
// prompt catalog. Zero lines change in tools.ts, pipeline.ts,
// clickhouse-adapter.ts, chart-policy.ts, or any figure-building code. If a
// change to any of those had been required to make this pass, that would be
// a residual leak in the spine — a finding to report, not something to
// quietly patch here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planAnalysis, registerSemanticModel } from "./semantic-model";
import { runAnalysis } from "./pipeline";
import { planWithMemberResolution } from "./member-resolver";
import { buildMeasures } from "./measure-grammar";
import { sourcePromptCatalog } from "../agent/source-prompt";
import type {
  AnalysisDraft,
  CompiledQuery,
  SemanticModel,
  SemanticValueField,
  SourceAdapter,
} from "./types";

const stats = { rowsRead: 12000, bytesRead: 900000, elapsedMs: 12, queryId: "transit-test" };

// The value grammar: one raw column (minutes) plus the vetted menu, same
// shape as price's — median for "typical", p25/p90 for the honest ends of a
// right-skewed distribution, deliberately no avg/sum (a few long transfers
// stretch the tail; minutes aren't additive across trips).
const duration: SemanticValueField = {
  id: "duration",
  label: "Trip duration",
  valueExpression: "duration_minutes",
  format: { style: "number", maximumFractionDigits: 0 },
  synonyms: ["duration", "trip duration", "ride duration"],
  distributionNote:
    "A handful of long out-of-station interchanges stretch trip duration's tail, so this source publishes the median instead of the mean.",
  limitations: ["Recorded duration excludes time spent outside the gate line."],
  defaultAggregation: "median",
  version: "1.0.0",
  aggregations: [
    {
      kind: "median",
      label: "Median trip duration",
      description: "The median recorded trip duration in the selected population.",
      synonyms: ["median duration", "typical duration", "typical trip duration"],
    },
    {
      kind: "p25",
      label: "Quick trip duration (25th percentile)",
      description: "The duration a quarter of trips fall below — the quick end of the selected population.",
      synonyms: ["quick trip", "quickest trip", "p25 duration", "25th percentile duration"],
    },
    {
      kind: "p90",
      label: "Long trip duration (90th percentile)",
      description: "The duration the top tenth of trips exceed — the long end of the selected population.",
      synonyms: ["long trip", "longest trip", "p90 duration", "90th percentile duration"],
    },
    {
      kind: "max",
      label: "Longest recorded trip duration",
      description: "The single longest recorded trip in the selected population.",
      synonyms: ["maximum duration", "max duration", "record duration"],
      caveat: "A single unusual journey (a stalled train, a forgotten tap-out) defines this number, not the network.",
    },
  ],
};

// A structurally different second source: no geography at all, an
// entity/category hierarchy (line -> station) instead. Registering it proves
// member resolution and the rest of the engine are generic, not secretly
// place-shaped.
const transitModel: SemanticModel = {
  id: "london-transit-test",
  label: "London Tube Ridership (test fixture)",
  adapter: "clickhouse",
  database: "test",
  table: "rides",
  sourceSystem: "Test fixture — TfL-shaped",
  lastRefresh: "2026-07-01",
  availableRange: ["2015-01-01", "2026-07-01"],
  rowScale: "≈900 million rows — one per tap-in/tap-out journey (synthetic scale, fixture only)",
  version: "1.0.0",
  figurePolicyVersion: "1.0.0",
  defaults: {
    measure: "ride_count",
    timeDimension: "ride_date",
    timeGrain: "month",
    seriesRankMeasure: "ride_count",
  },
  valueFields: { duration },
  measures: {
    ...buildMeasures(duration),
    ride_count: {
      id: "ride_count",
      label: "Rides",
      description: "Number of ride records in the selected population.",
      expression: "count()",
      format: { style: "number", maximumFractionDigits: 0 },
      aggregation: "count",
      version: "1.0.0",
      synonyms: ["rides", "journeys", "volume"],
      limitations: [],
      additive: true,
    },
  },
  dimensions: {
    ride_date: {
      id: "ride_date",
      label: "Ride date",
      description: "Date the ride occurred.",
      expression: "ride_date",
      kind: "time",
      synonyms: ["date", "time", "month", "day"],
      grains: {
        day: "ride_date",
        month: "toStartOfMonth(ride_date)",
        quarter: "toStartOfQuarter(ride_date)",
        year: "toStartOfYear(ride_date)",
      },
    },
    tube_line: {
      id: "tube_line",
      label: "Tube line",
      description: "TfL line the ride was recorded on.",
      expression: "line",
      kind: "category",
      synonyms: ["line", "tube line", "line name"],
      cardinality: 4,
      valueNormalization: "uppercase",
      parameterType: "String",
      values: ["VICTORIA", "CENTRAL", "NORTHERN", "JUBILEE"],
    },
    // No `values` snapshot, unlike tube_line above: too many stations to list,
    // mirroring why locality has no snapshot in the housing model. Existence
    // is checked live via memberResolvers below instead.
    station: {
      id: "station",
      label: "Station",
      description: "Station recorded for the ride — the leaf of the line hierarchy.",
      expression: "station",
      kind: "category",
      synonyms: ["station", "stop", "station name"],
      valueNormalization: "uppercase",
      parameterType: "String",
    },
  },
  memberResolvers: [{ dimensionId: "station", hierarchy: ["tube_line"], countLabel: "rides" }],
};

describe("a second, structurally unlike semantic model runs the whole engine (V2 §16.5)", () => {
  let remove: () => void;
  beforeAll(() => {
    remove = registerSemanticModel(transitModel);
  });
  afterAll(() => {
    remove();
  });

  it("renders a KPI for a composed value-field measure", async () => {
    const plan = planAnalysis({
      question: "What is the median trip duration?",
      sourceId: transitModel.id,
      analysisType: "single_value",
      measures: ["median duration"],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({ rows: [{ median_duration: 14 }], stats }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("kpi");
    if (result.spec.kind !== "kpi") return;
    expect(result.spec.value).toBe(14);
    expect(result.spec.label).toBe("Median trip duration");
    expect(result.spec.format).toEqual(duration.format);
  });

  it("renders a category comparison by line, carrying this source's own provenance", async () => {
    const plan = planAnalysis({
      question: "Compare rides by tube line",
      sourceId: transitModel.id,
      analysisType: "category_comparison",
      measures: ["rides"],
      dimensions: [{ field: "tube_line" }],
      filters: [],
      orderBy: [{ field: "rides", direction: "desc" }],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { tube_line: "VICTORIA", ride_count: 900000 },
          { tube_line: "CENTRAL", ride_count: 850000 },
        ],
        stats,
      }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("comparison");
    if (result.spec.kind !== "comparison") return;
    expect(result.spec.rows[0]).toMatchObject({ label: "VICTORIA", value: 900000 });
    expect(result.spec.explanation.provenance.source).toBe(transitModel.sourceSystem);
  });

  it("renders a trend through the same generic timeseries path", async () => {
    const plan = planAnalysis({
      question: "Show rides by month",
      sourceId: transitModel.id,
      analysisType: "trend",
      measures: ["rides"],
      dimensions: [{ field: "ride_date", grain: "month" }],
      filters: [],
      orderBy: [{ field: "ride_date", direction: "asc" }],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { ride_date: "2026-05-01", ride_count: 12000000 },
          { ride_date: "2026-06-01", ride_count: 12500000 },
        ],
        stats,
      }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("timeseries");
  });

  it("renders a distribution by parsing the histogram row into bins", async () => {
    const plan = planAnalysis({
      question: "How is trip duration distributed?",
      sourceId: transitModel.id,
      analysisType: "distribution",
      measures: ["median duration"],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          {
            bins: [
              [0, 10, 58],
              [10, 30, 752],
              [30, 60, 121],
            ],
            median_duration: 14,
          },
        ],
        stats,
      }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("distribution");
    if (result.spec.kind !== "distribution") return;
    expect(result.spec.bins).toEqual([
      { from: 0, to: 10, count: 58 },
      { from: 10, to: 30, count: 752 },
      { from: 30, to: 60, count: 121 },
    ]);
    expect(result.spec.median).toBe(14);
  });

  it("resolves a station name through the generic member resolver, pinning its line — proving the hierarchy is data, not geography", async () => {
    let lastQuery: CompiledQuery | undefined;
    const adapter: SourceAdapter = {
      execute: async (query) => {
        lastQuery = query;
        return { rows: [{ tube_line: "VICTORIA", _count: 5000 }], stats };
      },
    };
    // "Oxford Circus" is a station, not a governed tube_line value — the same
    // shape as "Clapham" filtered on district in the housing model.
    const draft: AnalysisDraft = {
      question: "Rides through Oxford Circus",
      sourceId: transitModel.id,
      analysisType: "detail",
      measures: ["rides"],
      dimensions: [],
      filters: [{ field: "tube_line", operator: "equals", value: "Oxford Circus" }],
      orderBy: [],
    };
    const plan = await planWithMemberResolution(draft, adapter);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters).toEqual(
      expect.arrayContaining([
        { field: "station", operator: "equals", value: "Oxford Circus" },
        { field: "tube_line", operator: "equals", value: "VICTORIA" },
      ]),
    );
    // The compiled lookup itself: generic over the registered leaf/ancestor
    // expressions (station, line), never a hardcoded geography column.
    expect(lastQuery?.sql).toContain("station = {member:String}");
    expect(lastQuery?.sql).toContain("GROUP BY line");
  });

  it("compiles SQL from this source's own table and expressions, with no housing tokens", async () => {
    const plan = planAnalysis({
      question: "Compare rides by tube line",
      sourceId: transitModel.id,
      analysisType: "category_comparison",
      measures: ["rides"],
      dimensions: [{ field: "tube_line" }],
      filters: [],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const result = await runAnalysis(plan, {
      execute: async () => ({ rows: [{ tube_line: "VICTORIA", ride_count: 900000 }], stats }),
    });
    // The table name is a bound query parameter, never inlined into the SQL
    // text — asserted on the compiled query, not string-matched in the SQL.
    expect(result.query.params.table).toBe("rides");
    expect(result.spec.kind).toBe("comparison");
    if (result.spec.kind !== "comparison") return;
    const sql = result.spec.explanation.inspect.generatedSql;
    expect(sql).toContain("line AS tube_line");
    expect(sql).toContain("count() AS ride_count");
    for (const housingToken of ["price", "locality", "district", "HACK_BWT"]) {
      expect(sql.toLowerCase()).not.toContain(housingToken.toLowerCase());
    }
  });

  it("generates this source's own prompt catalog, with no housing vocabulary", () => {
    const prompt = sourcePromptCatalog(transitModel);
    expect(prompt).toContain("Rides");
    expect(prompt).toContain("duration");
    expect(prompt).not.toContain("price");
    expect(prompt).not.toContain("£");
  });
});
