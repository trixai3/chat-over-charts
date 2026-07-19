import { describe, expect, it } from "vitest";
import { planAnalysis } from "./semantic-model";
import { runAnalysis } from "./pipeline";

const hasCredentials = Boolean(
  process.env.CLICKHOUSE_URL &&
    process.env.CLICKHOUSE_USER &&
    process.env.CLICKHOUSE_PASSWORD &&
    process.env.CLICKHOUSE_DATABASE,
);

describe.skipIf(!hasCredentials)("live UK House Price Paid integration", () => {
  it("compiles, executes, validates, and renders a London borough comparison", async () => {
    const plan = planAnalysis({
      question: "Compare London boroughs by latest median price and five-year change",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["latest median price", "five year growth"],
      dimensions: [{ field: "borough" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [{ field: "five year growth", direction: "desc" }],
    });
    if (plan.status !== "ready") throw new Error(`Plan was not ready: ${plan.status}`);

    const result = await runAnalysis(plan);
    expect(result.spec.kind).toBe("comparison");
    if (result.spec.kind !== "comparison") return;
    expect(result.spec.rows.length).toBeGreaterThan(20);
    expect(result.spec.rows.some((row) => row.label === "HAVERING")).toBe(true);
    expect(result.spec.stats.rowsRead).toBeGreaterThan(0);
    expect(result.spec.explanation.provenance.queryId).toBeTruthy();
  }, 30_000);
});
