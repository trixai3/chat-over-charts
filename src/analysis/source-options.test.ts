import { describe, expect, it } from "vitest";
import { listSourceOptions } from "./source-options";
import { registerSemanticModel } from "./semantic-model";
import type { SemanticModel } from "./types";

describe("listSourceOptions", () => {
  it("includes the housing entry with its exact example questions", () => {
    const options = listSourceOptions();
    const housing = options.find((option) => option.id === "uk-house-prices");

    expect(housing).toBeDefined();
    expect(housing?.label).toBe("UK House Price Paid");
    expect(housing?.sourceSystem).toContain("Land Registry");
    expect(housing?.database).toBe("HACK_BWT");
    expect(housing?.table).toBe("sales");
    expect(housing?.rowScale).toBeDefined();
    expect(housing?.exampleQuestions).toEqual([
      "How did median prices change per year in London's top districts?",
      "Show Lambeth median prices by year since 2015",
      "Compare property types in Greater London by median price",
    ]);
  });

  it("is plain-JSON serializable — no expressions or SQL leak through", () => {
    const options = listSourceOptions();
    expect(JSON.parse(JSON.stringify(options))).toEqual(options);
  });

  it("defaults exampleQuestions to [] for a model that declares none", () => {
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
      const options = listSourceOptions();
      const ticketOption = options.find((option) => option.id === "support-tickets-test");
      expect(ticketOption).toEqual({
        id: "support-tickets-test",
        label: "Support tickets",
        sourceSystem: "Test fixture",
        database: "test",
        table: "tickets",
        exampleQuestions: [],
      });
    } finally {
      remove();
    }
  });
});
