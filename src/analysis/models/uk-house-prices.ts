import type { SemanticModel } from "../types";
import { ukHousePriceDimensionValues } from "./uk-house-prices.values";

/**
 * A governed description of the existing Land Registry table. Adding another
 * source means registering another object with this contract, not adding tools.
 *
 * The source grain is one row per completed sale (~31M rows), so every
 * displayed number aggregates many transactions. Measures are deliberately the
 * minimum: a price level and a volume. Time math ("change", "growth") is the
 * request-level `comparison`, and time scoping ("latest", "since 2015") is a
 * date filter — neither is a stored measure, mirroring how Snowflake semantic
 * models and Databricks metric views keep measures as plain aggregates.
 */
export const ukHousePrices: SemanticModel = {
  id: "uk-house-prices",
  label: "UK House Price Paid",
  adapter: "clickhouse",
  database: "HACK_BWT",
  table: "sales",
  sourceSystem: "HM Land Registry Price Paid Data",
  lastRefresh: "2026-05-29",
  availableRange: ["1995-01-01", "2026-05-29"],
  rowScale: "≈31 million rows — one per completed sale",
  version: "2.0.0",
  figurePolicyVersion: "1.0.0",
  defaults: {
    measure: "median_price",
    timeDimension: "sale_date",
    timeGrain: "year",
    seriesRankMeasure: "transaction_count",
  },
  measures: {
    median_price: {
      id: "median_price",
      label: "Median sale price",
      description: "The median completed transaction price in the selected population.",
      expression: "round(quantileTDigest(0.5)(price))",
      format: { style: "currency", currency: "GBP" },
      aggregation: "quantileTDigest median",
      version: "1.0.0",
      synonyms: ["house price", "sale price", "property price", "median price", "price", "prices"],
      limitations: [
        "Price changes can reflect a changing mix of property types sold as well as market movement.",
      ],
      aggregationNote:
        "Averages are misleading for right-skewed prices, so this source publishes the median instead.",
      valueExpression: "price",
    },
    transaction_count: {
      id: "transaction_count",
      label: "Transactions",
      description: "Number of completed sale records in the selected population.",
      expression: "count()",
      format: { style: "number", maximumFractionDigits: 0 },
      aggregation: "count",
      version: "1.0.0",
      synonyms: ["sales", "sale count", "transactions", "number of sales", "volume"],
      limitations: [],
      additive: true,
    },
  },
  dimensions: {
    sale_date: {
      id: "sale_date",
      label: "Sale date",
      description: "Date the transaction completed.",
      expression: "date",
      kind: "time",
      synonyms: ["date", "time", "year", "month", "completion date"],
      grains: {
        day: "date",
        month: "toStartOfMonth(date)",
        quarter: "toStartOfQuarter(date)",
        year: "toStartOfYear(date)",
      },
    },
    county: {
      id: "county",
      label: "County",
      description: "Land Registry county recorded for the transaction.",
      expression: "county",
      kind: "category",
      synonyms: ["county", "counties"],
      cardinality: 132,
      valueNormalization: "uppercase",
      values: ukHousePriceDimensionValues.county,
    },
    district: {
      id: "district",
      label: "District",
      description: "Local authority district recorded for the transaction.",
      expression: "district",
      kind: "category",
      synonyms: ["district", "borough", "area", "districts", "boroughs", "areas"],
      cardinality: 467,
      valueNormalization: "uppercase",
      values: ukHousePriceDimensionValues.district,
    },
    town: {
      id: "town",
      label: "Town or city",
      description: "Postal town recorded for the transaction.",
      expression: "town",
      kind: "category",
      synonyms: ["town", "city", "towns", "cities"],
      cardinality: 1173,
      valueNormalization: "uppercase",
      values: ukHousePriceDimensionValues.town,
    },
    property_type: {
      id: "property_type",
      label: "Property type",
      description: "Land Registry property-type classification.",
      expression: "type",
      kind: "category",
      synonyms: ["property type", "home type", "type"],
      cardinality: 5,
      valueNormalization: "lowercase",
      values: ukHousePriceDimensionValues.property_type,
    },
    tenure: {
      id: "tenure",
      label: "Tenure",
      description: "Freehold, leasehold, or unknown duration category.",
      expression: "duration",
      kind: "category",
      synonyms: ["tenure", "duration", "freehold", "leasehold"],
      cardinality: 3,
      valueNormalization: "lowercase",
      values: ukHousePriceDimensionValues.tenure,
    },
  },
};
