import type { ExplanationManifest, ViewSpec } from "./view-spec";

/** All displayed values are from the UK Price Paid dataset. */
const explanation: ExplanationManifest = {
  whatShown: "Median completed transaction price from HM Land Registry records.",
  calculation: "Median price uses quantileTDigest(0.5), chosen because house prices are right-skewed.",
  scope: ["Completed UK transactions", "Fixture data queried for the original gallery"],
  provenance: {
    semanticModel: "UK House Price Paid",
    source: "HM Land Registry Price Paid Data",
    lastRefresh: "2026-05-29",
    modelVersion: "1.0.0",
    measureVersions: ["median_price@1.0.0"],
    figurePolicyVersion: "1.0.0",
    queryId: "fixture-query",
  },
  limitations: [
    "Price changes can reflect a changing mix of property types sold as well as market movement.",
  ],
  inspect: {
    semanticQuery: JSON.stringify({ sourceId: "uk-house-prices", measures: ["median_price"] }, null, 2),
    generatedSql: "SELECT round(quantileTDigest(0.5)(price)) AS median_price FROM HACK_BWT.sales",
  },
};

export const verdictFixture: ViewSpec = {
  kind: "verdict",
  headline: "On £600k you're priced out of 24 of 33 London boroughs — 9 work",
  detail: "Median completed sale price. Havering gives you the most room.",
  tone: "neutral",
};

export const kpiFixture: ViewSpec = {
  kind: "kpi",
  title: "Lambeth median sale price",
  label: "Median sale price",
  value: 526890,
  format: { style: "currency", currency: "GBP" },
  stats: { rowsRead: 3892, elapsedMs: 16, queryId: "fixture-kpi" },
  explanation,
};

export const comparisonFixture: ViewSpec = {
  kind: "comparison",
  title: "London boroughs by median price",
  metricLabel: "Median sale price",
  comparisonLabel: "Five-year change",
  format: { style: "currency", currency: "GBP" },
  rows: [
    { label: "WANDSWORTH", value: 630000, delta: -1.0 },
    { label: "BARNET", value: 547000, delta: 3.2 },
    { label: "LAMBETH", value: 526890, delta: -7.2 },
    { label: "EALING", value: 520000, delta: 7.2 },
    { label: "BROMLEY", value: 510000, delta: 11.6 },
    { label: "LEWISHAM", value: 450000, delta: 3.4 },
    { label: "HAVERING", value: 445500, delta: 17.9 },
    { label: "CROYDON", value: 410000, delta: 5.1 },
  ],
  stats: { rowsRead: 31192683, elapsedMs: 47, queryId: "fixture-comparison" },
  explanation,
};

export const timeseriesFixture: ViewSpec = {
  kind: "timeseries",
  title: "Lambeth median price by year",
  format: { style: "currency", currency: "GBP" },
  series: [
    {
      label: "Lambeth",
      points: [
        { t: "2015", v: 450000 },
        { t: "2016", v: 500000 },
        { t: "2017", v: 500000 },
        { t: "2018", v: 501500 },
        { t: "2019", v: 530000 },
        { t: "2020", v: 567750 },
        { t: "2021", v: 550000 },
        { t: "2022", v: 540000 },
        { t: "2023", v: 540000 },
        { t: "2024", v: 535000 },
        { t: "2025", v: 526890 },
      ],
    },
  ],
  drillTargets: [],
  stats: { rowsRead: 31192683, elapsedMs: 38, queryId: "fixture-timeseries" },
  explanation,
};

export const distributionFixture: ViewSpec = {
  kind: "distribution",
  title: "Lambeth sale-price distribution",
  format: { style: "currency", currency: "GBP" },
  median: 526890,
  bins: [
    { from: 0, to: 100000, count: 29 },
    { from: 100000, to: 200000, count: 58 },
    { from: 200000, to: 300000, count: 241 },
    { from: 300000, to: 400000, count: 672 },
    { from: 400000, to: 500000, count: 752 },
    { from: 500000, to: 600000, count: 602 },
    { from: 600000, to: 700000, count: 424 },
    { from: 700000, to: 800000, count: 303 },
    { from: 800000, to: 900000, count: 193 },
    { from: 900000, to: 1000000, count: 121 },
  ],
  stats: { rowsRead: 31192683, elapsedMs: 52, queryId: "fixture-distribution" },
  explanation,
};

export const tableFixture: ViewSpec = {
  kind: "table",
  title: "London borough comparison",
  columns: [
    { key: "district", label: "District" },
    { key: "latest_median_price", label: "Latest median", format: { style: "currency", currency: "GBP" } },
    { key: "five_year_price_change_pct", label: "Five-year change", format: { style: "percent", maximumFractionDigits: 1 } },
  ],
  rows: [
    { district: "HAVERING", latest_median_price: 445500, five_year_price_change_pct: 17.9 },
    { district: "LAMBETH", latest_median_price: 526890, five_year_price_change_pct: -7.2 },
    { district: "WANDSWORTH", latest_median_price: 630000, five_year_price_change_pct: -1.0 },
  ],
  stats: { rowsRead: 4030464, elapsedMs: 45, queryId: "fixture-table" },
  explanation,
};

export const noticeFixture: ViewSpec = {
  kind: "notice",
  title: "This result needs a narrower request",
  message: "The result contains more categories than the comparison policy allows.",
  tone: "warning",
  suggestions: ["Choose one county or select up to forty categories."],
};

export const disambiguationFixture: ViewSpec = {
  kind: "disambiguation",
  query: "Clapham",
  prompt: "Which Clapham do you mean?",
  candidates: [
    { label: "Lambeth, Greater London", sublabel: "559 sales", target: { label: "Clapham (Lambeth)", level: "district", value: "LAMBETH" } },
    { label: "Bedford, Bedfordshire", sublabel: "1,359 sales", target: { label: "Clapham (Bedford)", level: "district", value: "BEDFORD" } },
  ],
};

export const ALL_FIXTURES: { name: string; spec: ViewSpec }[] = [
  { name: "verdict", spec: verdictFixture },
  { name: "kpi", spec: kpiFixture },
  { name: "comparison", spec: comparisonFixture },
  { name: "timeseries", spec: timeseriesFixture },
  { name: "distribution", spec: distributionFixture },
  { name: "table", spec: tableFixture },
  { name: "notice", spec: noticeFixture },
  { name: "disambiguation", spec: disambiguationFixture },
];

export const BROKEN_FIXTURE = { kind: "timeseries", title: "Missing series and provenance" };
