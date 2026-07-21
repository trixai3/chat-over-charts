import type { SemanticModel, SemanticValueField } from "../../types";
import { buildMeasures } from "../../measure-grammar";
import { ukHousePriceDimensionValues } from "./values";

/**
 * The price grammar: one raw column plus the aggregations that are honest for
 * a right-skewed distribution. The model maps user intent ("top price",
 * "entry price") onto this menu; everything off-menu still clarifies.
 * Deliberately absent: avg/sum (the mean misleads on skew, prices are not
 * additive) and min (Land Registry contains nominal £1 transfers, so the
 * minimum is a data artifact, not a market fact).
 */
const price: SemanticValueField = {
  id: "price",
  label: "Sale price",
  valueExpression: "price",
  format: { style: "currency", currency: "GBP" },
  synonyms: ["house price", "sale price", "property price", "price", "prices"],
  distributionNote:
    "Averages are misleading for right-skewed prices, so this source publishes the median instead.",
  limitations: [
    "Price changes can reflect a changing mix of property types sold as well as market movement.",
  ],
  defaultAggregation: "median",
  version: "1.0.0",
  aggregations: [
    {
      kind: "median",
      label: "Median sale price",
      description: "The median completed transaction price in the selected population.",
      synonyms: ["median price", "typical price", "middle price"],
    },
    {
      kind: "p25",
      label: "Entry sale price (25th percentile)",
      description:
        "The price a quarter of completed sales fall below — the entry point of the selected market.",
      synonyms: ["entry price", "starter price", "affordable price", "lower quartile price", "p25 price", "25th percentile price"],
    },
    {
      kind: "p75",
      label: "Upper-quartile sale price (75th percentile)",
      description: "The price three quarters of completed sales fall below.",
      synonyms: ["upper quartile price", "p75 price", "75th percentile price"],
    },
    {
      kind: "p90",
      label: "Top-of-market sale price (90th percentile)",
      description:
        "The price the top tenth of completed sales exceed — the robust top of the selected market.",
      synonyms: ["top price", "top of market price", "high end price", "luxury price", "premium price", "p90 price", "90th percentile price"],
    },
    {
      kind: "max",
      label: "Highest recorded sale price",
      description: "The single largest completed transaction in the selected population.",
      synonyms: ["maximum price", "max price", "highest price", "record price", "most expensive sale"],
      caveat:
        "A single unusual transaction (a portfolio deal or data quirk) defines this number — treat it as a record, not the market.",
    },
  ],
};

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
  valueFields: { price },
  measures: {
    ...buildMeasures(price),
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
      parameterType: "String",
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
      parameterType: "String",
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
    // 24,049 values deliberately unsnapshotted (unlike county/district/town
    // above): a locality is a neighbourhood name, not a bounded administrative
    // list, and 62% of them span multiple districts ("Clapham" alone resolves
    // to 11 places). Existence is validated by a live lookup at query time
    // (member-resolver.ts) instead of a values array.
    locality: {
      id: "locality",
      label: "Locality",
      description: "Land Registry locality — a neighbourhood within a district (e.g. Clapham).",
      expression: "locality",
      kind: "category",
      synonyms: ["locality", "neighbourhood", "area name"],
      cardinality: 24049,
      valueNormalization: "uppercase",
      parameterType: "String",
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
  memberResolvers: [
    { dimensionId: "locality", hierarchy: ["district", "county"], countLabel: "sales" },
  ],
  // Domain-specific question recipes core agent code never hardcodes (Slice
  // 4: the static prompt is source-neutral, so this reasoning travels with
  // the pack instead).
  promptHints: [
    "Affordability or budget questions ('can I afford X with £N?') are judgements about WHERE a " +
      "budget works: render a category_comparison of the median by district scoped to the asked " +
      "area, then a verdict counting how many districts the budget covers — a whole-area " +
      "distribution or single KPI does not answer affordability.",
  ],
};
