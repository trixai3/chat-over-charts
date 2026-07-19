import type { SemanticModel } from "../types";

const latestWindow = "date >= today() - INTERVAL 1 YEAR";
const baselineWindow =
  "date >= today() - INTERVAL 6 YEAR AND date < today() - INTERVAL 5 YEAR";
const latestMedian = `round(quantileTDigestIf(0.5)(price, ${latestWindow}))`;
const baselineMedian = `round(quantileTDigestIf(0.5)(price, ${baselineWindow}))`;

/**
 * A governed description of the existing Land Registry table. Adding another
 * source means registering another object with this contract, not adding tools.
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
  version: "1.0.0",
  figurePolicyVersion: "1.0.0",
  defaults: {
    measure: "median_price",
    timeDimension: "sale_date",
    timeGrain: "year",
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
      synonyms: ["house price", "sale price", "property price", "median price"],
      limitations: [
        "Price changes can reflect a changing mix of property types sold as well as market movement.",
      ],
    },
    latest_median_price: {
      id: "latest_median_price",
      label: "Latest median sale price",
      description: "Median completed transaction price during the trailing twelve months.",
      expression: latestMedian,
      format: { style: "currency", currency: "GBP" },
      aggregation: "trailing-12-month quantileTDigest median",
      version: "1.0.0",
      synonyms: ["current price", "latest price", "recent median price"],
      limitations: ["The latest period is a rolling twelve-month window, not a calendar year."],
    },
    five_year_price_change_pct: {
      id: "five_year_price_change_pct",
      label: "Five-year median-price change",
      description:
        "Percentage change between the trailing twelve-month median and the equivalent window five years earlier.",
      expression: `round(100 * (${latestMedian} - ${baselineMedian}) / nullIf(${baselineMedian}, 0), 1)`,
      format: { style: "percent", maximumFractionDigits: 1 },
      aggregation: "change between two governed median windows",
      version: "1.0.0",
      synonyms: ["five year growth", "5 year growth", "price growth", "price change"],
      limitations: ["This is descriptive historical change and is not a forecast."],
    },
    transaction_count: {
      id: "transaction_count",
      label: "Transactions",
      description: "Number of completed sale records in the selected population.",
      expression: "count()",
      format: { style: "number", maximumFractionDigits: 0 },
      aggregation: "count",
      version: "1.0.0",
      synonyms: ["sales", "sale count", "transactions", "number of sales"],
      limitations: [],
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
    },
  },
};
