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

export const pieFixture: ViewSpec = {
  kind: "pie",
  title: "Transactions by property type",
  metricLabel: "Transactions",
  format: { style: "number", maximumFractionDigits: 0 },
  slices: [
    { label: "Terraced", value: 180000 },
    { label: "Semi-detached", value: 160000 },
    { label: "Flat", value: 120000 },
    { label: "Detached", value: 100000 },
    { label: "Other", value: 40000 },
  ],
  stats: { rowsRead: 31192683, elapsedMs: 41, queryId: "fixture-pie" },
  explanation,
};

export const scatterFixture: ViewSpec = {
  kind: "scatter",
  title: "London boroughs: median price vs transactions",
  xLabel: "Median sale price",
  yLabel: "Transactions",
  xFormat: { style: "currency", currency: "GBP" },
  yFormat: { style: "number", maximumFractionDigits: 0 },
  points: [
    { label: "WANDSWORTH", x: 630000, y: 121000 },
    { label: "BARNET", x: 547000, y: 118000 },
    { label: "LAMBETH", x: 526890, y: 104000 },
    { label: "EALING", x: 520000, y: 112000 },
    { label: "BROMLEY", x: 510000, y: 95000 },
    { label: "LEWISHAM", x: 450000, y: 90000 },
    { label: "HAVERING", x: 445500, y: 98000 },
    { label: "CROYDON", x: 410000, y: 105000 },
  ],
  stats: { rowsRead: 31192683, elapsedMs: 49, queryId: "fixture-scatter" },
  explanation,
};

export const areaFixture: ViewSpec = {
  kind: "area",
  title: "Transactions per year by property type",
  format: { style: "number", maximumFractionDigits: 0 },
  series: [
    {
      label: "Terraced",
      points: [
        { t: "2020", v: 12000 },
        { t: "2021", v: 12500 },
        { t: "2022", v: 13000 },
        { t: "2023", v: 12800 },
        { t: "2024", v: 12600 },
        { t: "2025", v: 12200 },
      ],
    },
    {
      label: "Semi-detached",
      points: [
        { t: "2020", v: 10000 },
        { t: "2021", v: 10300 },
        { t: "2022", v: 10600 },
        { t: "2023", v: 10400 },
        { t: "2024", v: 10200 },
        { t: "2025", v: 9900 },
      ],
    },
    {
      label: "Flat",
      points: [
        { t: "2020", v: 9000 },
        { t: "2021", v: 9500 },
        { t: "2022", v: 10000 },
        { t: "2023", v: 9800 },
        { t: "2024", v: 9600 },
        { t: "2025", v: 9200 },
      ],
    },
  ],
  stats: { rowsRead: 31192683, elapsedMs: 44, queryId: "fixture-area" },
  explanation,
};

export const tableFixture: ViewSpec = {
  kind: "table",
  title: "London borough comparison",
  columns: [
    { key: "district", label: "District" },
    { key: "median_price", label: "Median sale price", format: { style: "currency", currency: "GBP" } },
    { key: "transaction_count", label: "Transactions", format: { style: "number", maximumFractionDigits: 0 } },
  ],
  rows: [
    { district: "WANDSWORTH", median_price: 630000, transaction_count: 121000 },
    { district: "LAMBETH", median_price: 526890, transaction_count: 104000 },
    { district: "HAVERING", median_price: 445500, transaction_count: 98000 },
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

export const ALL_FIXTURES: { name: string; spec: ViewSpec }[] = [
  { name: "verdict", spec: verdictFixture },
  { name: "kpi", spec: kpiFixture },
  { name: "comparison", spec: comparisonFixture },
  { name: "timeseries", spec: timeseriesFixture },
  { name: "distribution", spec: distributionFixture },
  { name: "pie", spec: pieFixture },
  { name: "scatter", spec: scatterFixture },
  { name: "area", spec: areaFixture },
  { name: "table", spec: tableFixture },
  { name: "notice", spec: noticeFixture },
];

export const BROKEN_FIXTURE = { kind: "timeseries", title: "Missing series and provenance" };
