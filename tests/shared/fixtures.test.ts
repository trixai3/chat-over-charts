import { describe, expect, it } from "vitest";
import { ALL_FIXTURES, BROKEN_FIXTURE } from "../../src/shared/fixtures";
import { ViewSpec } from "../../src/shared/view-spec";

describe("ViewSpec gallery fixtures", () => {
  it("keeps one valid real-data fixture for every registered renderer", () => {
    const kinds = ALL_FIXTURES.map(({ spec }) => spec.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const fixture of ALL_FIXTURES) {
      expect(ViewSpec.safeParse(fixture.spec).success, fixture.name).toBe(true);
    }
  });

  it("retains a malformed fixture to exercise the client boundary", () => {
    expect(ViewSpec.safeParse(BROKEN_FIXTURE).success).toBe(false);
  });
});
