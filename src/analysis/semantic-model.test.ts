import { describe, expect, it } from "vitest";
import { describeDataSource, planAnalysis, registerSemanticModel } from "./semantic-model";
import type { SemanticModel } from "./types";

describe("semantic planning", () => {
  it("resolves UK house-price synonyms into governed IDs", () => {
    const plan = planAnalysis({
      question: "Show Lambeth house prices by year",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["house price"],
      dimensions: [{ field: "year", grain: "year" }],
      filters: [
        { field: "county", operator: "equals", value: "Greater London" },
        { field: "borough", operator: "equals", value: "Lambeth" },
      ],
      orderBy: [],
    });

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.measures).toEqual(["median_price"]);
    expect(plan.request.dimensions).toEqual([{ field: "sale_date", grain: "year" }]);
    expect(plan.request.filters.map((filter) => filter.field)).toEqual(["county", "district"]);
    expect(plan.figure).toBe("timeseries");
  });

  it("returns supported governed choices instead of guessing an unknown metric", () => {
    const plan = planAnalysis({
      question: "Show happiness by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["happiness"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].options.map((option) => option.id)).toContain("median_price");
    expect(plan.ambiguities[0].recommended).toBe("median_price");
  });

  it("onboards another semantic model without changing tools or chart policy", () => {
    const supportTickets: SemanticModel = {
      id: "support-tickets-test",
      label: "Support tickets",
      adapter: "clickhouse",
      database: "test",
      table: "tickets",
      sourceSystem: "Test fixture",
      lastRefresh: "2026-07-19",
      version: "1.0.0",
      figurePolicyVersion: "1.0.0",
      defaults: { measure: "ticket_count", timeDimension: "created_date", timeGrain: "month" },
      measures: {
        ticket_count: {
          id: "ticket_count",
          label: "Tickets",
          description: "Number of tickets.",
          expression: "count()",
          format: { style: "number", maximumFractionDigits: 0 },
          aggregation: "count",
          version: "1.0.0",
          synonyms: ["tickets", "volume"],
          limitations: [],
        },
      },
      dimensions: {
        created_date: {
          id: "created_date",
          label: "Created date",
          description: "Ticket creation date.",
          expression: "created_at",
          kind: "time",
          synonyms: ["date", "time"],
          grains: { month: "toStartOfMonth(created_at)" },
        },
        priority: {
          id: "priority",
          label: "Priority",
          description: "Ticket priority.",
          expression: "priority",
          kind: "category",
          synonyms: ["priority"],
        },
      },
    };
    const remove = registerSemanticModel(supportTickets);
    try {
      const plan = planAnalysis({
        question: "Tickets by priority",
        sourceId: supportTickets.id,
        analysisType: "category_comparison",
        measures: ["volume"],
        dimensions: [{ field: "priority" }],
        filters: [],
        orderBy: [],
      });
      expect(plan.status).toBe("ready");
      if (plan.status === "ready") {
        expect(plan.figure).toBe("comparison");
        expect(plan.request.measures).toEqual(["ticket_count"]);
      }
    } finally {
      remove();
    }
  });

  it("surfaces the governed measure's aggregationNote when 'average' fails to resolve", () => {
    const plan = planAnalysis({
      question: "Show average price by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["average price"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].recommended).toBe("median_price");
    expect(plan.ambiguities[0].question).toContain("right-skewed");
  });

  it("does not mention median for a governed measure without an aggregationNote", () => {
    const plan = planAnalysis({
      question: "Show average transactions by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["average transactions"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].recommended).toBe("transaction_count");
    expect(plan.ambiguities[0].question).not.toContain("median");
    expect(plan.ambiguities[0].question).not.toContain("right-skewed");
    expect(plan.ambiguities[0].question).toContain("governed equivalent");
    expect(plan.ambiguities[0].question).toContain("count");
  });

  it("strips leading 'total' the same way as 'average' to reach the governed measure", () => {
    const plan = planAnalysis({
      question: "Show total sales by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["total sales"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].recommended).toBe("transaction_count");
  });

  it("catches 'average' even when the model already rewrote the term to a governed synonym", () => {
    // "prices" is median_price's own synonym, so it resolves directly — the
    // lossy-aggregation guard above never sees an unresolved term to catch.
    const plan = planAnalysis({
      question: "Show Lambeth average prices by day since 2015",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["prices"],
      dimensions: [{ field: "sale_date", grain: "day" }],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].question).toContain("right-skewed");
    expect(plan.ambiguities[0].recommended).toBe("median_price");
  });

  it("lets a verbatim governed id through even after 'average' language — the confirmed escape hatch", () => {
    const plan = planAnalysis({
      question: "Show Lambeth average prices by day since 2015",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["median_price"],
      dimensions: [{ field: "sale_date", grain: "day" }],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });

    expect(plan.status).toBe("ready");
  });

  it("still asks for a governed measure without an aggregationNote, but doesn't invoke the median policy", () => {
    const plan = planAnalysis({
      question: "average transactions per district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].question).not.toContain("median");
    expect(plan.ambiguities[0].question).not.toContain("right-skewed");
  });

  it("does not overfire the average guard when the question has no average wording", () => {
    const plan = planAnalysis({
      question: "Show Lambeth prices by day since 2015",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["prices"],
      dimensions: [{ field: "sale_date", grain: "day" }],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });

    expect(plan.status).toBe("ready");
  });

  it("resolves the plural 'median prices' via the singularization fallback", () => {
    const plan = planAnalysis({
      question: "What are median prices in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["median prices"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.measures).toEqual(["median_price"]);
  });

  it("resolves the plural 'sale prices' too", () => {
    const plan = planAnalysis({
      question: "What are sale prices in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["sale prices"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.measures).toEqual(["median_price"]);
  });

  it("still resolves the already-plural registered synonym 'transactions' (exact pass, unaffected by the fallback)", () => {
    const plan = planAnalysis({
      question: "Show transactions by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.measures).toEqual(["transaction_count"]);
  });

  it("still asks for clarification when an unknown term (plural or not) matches no governed synonym", () => {
    const plan = planAnalysis({
      question: "Show widgets by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["widgets"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
  });

  it("recommends the fuzzy match for a typo'd measure, but still asks instead of auto-applying", () => {
    const plan = planAnalysis({
      question: "Show meidan price by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["meidan price"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].recommended).toBe("median_price");
  });

  it("recommends the fuzzy match for a typo'd measure synonym", () => {
    const plan = planAnalysis({
      question: "Show transactionz by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactionz"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].recommended).toBe("transaction_count");
  });

  it("suggests the nearest governed value for a typo'd filter value, but never auto-corrects it", () => {
    const plan = planAnalysis({
      question: "Show prices in Lambth",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "district" }],
      filters: [{ field: "district", operator: "equals", value: "Lambth" }],
      orderBy: [],
    });

    expect(plan.status).toBe("unsupported");
    if (plan.status !== "unsupported") return;
    expect(plan.suggestions[0]).toContain("LAMBETH");
  });

  it("falls back to the model default when a nonsense term is too far from any governed measure", () => {
    const plan = planAnalysis({
      question: "Show widgets by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["widgets"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });

    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].recommended).toBe("median_price");
  });
});

describe("describeDataSource", () => {
  it("renders the full catalog as a table tile without running SQL", () => {
    const spec = describeDataSource("uk-house-prices");
    expect(spec.kind).toBe("table");
    if (spec.kind !== "table") return;

    expect(spec.title).toBe("UK House Price Paid — what you can ask");
    // One row per governed concept: 2 measures + 6 dimensions.
    expect(spec.rows.filter((row) => row.role === "measure")).toHaveLength(2);
    expect(spec.rows.filter((row) => row.role === "dimension")).toHaveLength(6);

    const median = spec.rows.find((row) => row.name === "Median sale price");
    expect(median?.details).toContain("quantileTDigest median");
    const saleDate = spec.rows.find((row) => row.name === "Sale date");
    expect(saleDate?.details).toContain("day, month, quarter, year");
    expect(saleDate?.details).toContain("1995-01-01 → 2026-05-29");
    const district = spec.rows.find((row) => row.name === "District");
    expect(district?.details).toContain("467 governed values, e.g.");

    // The tile is a registry read: zero rows scanned, and the inspect drawer
    // says so instead of showing SQL.
    expect(spec.stats).toEqual({ rowsRead: 0, elapsedMs: 0 });
    expect(spec.explanation.inspect.generatedSql).toContain("no SQL");
    expect(spec.explanation.scope).toContain("≈31 million rows — one per completed sale");
  });

  it("returns a notice listing registered sources for an unknown id", () => {
    const spec = describeDataSource("not-a-source");
    expect(spec).toMatchObject({ kind: "notice", tone: "warning" });
    if (spec.kind !== "notice") return;
    expect(spec.suggestions).toContain("uk-house-prices");
  });
});
