import { describe, expect, it } from "vitest";
import { getSemanticModel } from "../../src/analysis/semantic-model";
import { sourcePromptCatalog } from "../../src/agent/source-prompt";

describe("sourcePromptCatalog", () => {
  const model = getSemanticModel("uk-house-prices")!;
  const catalog = sourcePromptCatalog(model);

  it("carries the medians-not-averages rule from the value field's distributionNote", () => {
    expect(catalog).toContain(model.valueFields!.price.distributionNote);
  });

  it("conveys the intent-to-aggregation mapping via measure synonyms", () => {
    // "affordable" -> p25, "top" -> p90: the vocabulary the model needs to
    // compose {field, aggregation} without any hardcoded price menu in core
    // agent code — the pack's own synonyms carry it.
    expect(catalog).toContain("affordable");
    expect(catalog).toContain("top");
  });

  it("mentions member-resolution guidance because this source has memberResolvers", () => {
    expect(catalog).toMatch(/governed members/);
  });

  it("includes the pack's affordability promptHint verbatim", () => {
    expect(model.promptHints).toBeDefined();
    expect(catalog).toContain(model.promptHints![0]);
    expect(catalog).toMatch(/budget|afford/i);
  });

  it("contains no SQL, database, or query-expression tokens", () => {
    // Not a literal check against model.table ("sales") — that word is also
    // a legitimate synonym of the transaction_count measure, so it belongs in
    // the catalog. The actual leak risk is SQL/database internals: the
    // database name, SQL keywords, and the raw aggregate expressions
    // (measure-grammar.ts's AGGREGATION_SQL), none of which sourcePromptCatalog
    // ever reads.
    expect(catalog).not.toContain(model.database);
    expect(catalog).not.toMatch(/\bSELECT\b/i);
    expect(catalog).not.toContain("quantileTDigest");
    expect(catalog).not.toContain(model.table + ".");
  });
});
