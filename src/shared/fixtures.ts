import type { ViewSpec } from "./view-spec";

/**
 * Fixtures for /gallery.
 *
 * Every number here is REAL — pulled from the ClickHouse playground on 17 Jul
 * 2026. That's deliberate: the gallery doubles as a dry run of the demo, so a
 * layout that looks wrong here will look wrong on camera. Fake data hides that.
 */

export const verdictFixture: ViewSpec = {
  kind: "verdict",
  headline: "On £600k you're priced out of 24 of 33 London boroughs — 9 work",
  detail: "Median asking price, 2025 sales. Havering gives you the most room.",
  tone: "neutral",
};

/** Real: median price per London district, 2025, with 5y growth vs 2020. */
export const comparisonFixture: ViewSpec = {
  kind: "comparison",
  title: "London boroughs by 2025 median price",
  metricLabel: "median price",
  unit: "gbp",
  rows: [
    { label: "WANDSWORTH", value: 630000, delta: -1.0, drill: { label: "Wandsworth", level: "district", value: "WANDSWORTH" } },
    { label: "BARNET", value: 547000, delta: 3.2, drill: { label: "Barnet", level: "district", value: "BARNET" } },
    { label: "LAMBETH", value: 526890, delta: -7.2, drill: { label: "Lambeth", level: "district", value: "LAMBETH" } },
    { label: "EALING", value: 520000, delta: 7.2, drill: { label: "Ealing", level: "district", value: "EALING" } },
    { label: "BROMLEY", value: 510000, delta: 11.6, drill: { label: "Bromley", level: "district", value: "BROMLEY" } },
    { label: "LEWISHAM", value: 450000, delta: 3.4, drill: { label: "Lewisham", level: "district", value: "LEWISHAM" } },
    { label: "HAVERING", value: 445500, delta: 17.9, drill: { label: "Havering", level: "district", value: "HAVERING" } },
    { label: "CROYDON", value: 410000, delta: 5.1, drill: { label: "Croydon", level: "district", value: "CROYDON" } },
  ],
  stats: { rowsRead: 31192683, elapsedMs: 47 },
};

/** Real: Lambeth median by year. Peaked in 2020 and has drifted down since. */
export const timeseriesFixture: ViewSpec = {
  kind: "timeseries",
  title: "Lambeth median price, 2015–2025",
  unit: "gbp",
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
  drillTargets: [{ label: "Lambeth streets", level: "street", value: "LAMBETH" }],
  stats: { rowsRead: 31192683, elapsedMs: 38 },
};

/** Real: Lambeth 2025 sales under £1.5M, £100k bins. Note the right skew. */
export const distributionFixture: ViewSpec = {
  kind: "distribution",
  title: "Lambeth 2025 sale prices",
  unit: "gbp",
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
    { from: 1000000, to: 1100000, count: 90 },
    { from: 1100000, to: 1200000, count: 85 },
    { from: 1200000, to: 1300000, count: 50 },
    { from: 1300000, to: 1400000, count: 40 },
    { from: 1400000, to: 1500000, count: 48 },
  ],
  stats: { rowsRead: 31192683, elapsedMs: 52 },
};

/** Real: "Clapham" resolves to 11 places across 6 counties. Bedford wins on volume. */
export const disambiguationFixture: ViewSpec = {
  kind: "disambiguation",
  query: "Clapham",
  prompt: "Which Clapham do you mean?",
  candidates: [
    { label: "Lambeth, Greater London", sublabel: "559 sales · SW4", target: { label: "Clapham (Lambeth)", level: "district", value: "LAMBETH" } },
    { label: "Bedford, Bedfordshire", sublabel: "1,359 sales", target: { label: "Clapham (Bedford)", level: "district", value: "BEDFORD" } },
    { label: "Wandsworth, Greater London", sublabel: "150 sales", target: { label: "Clapham (Wandsworth)", level: "district", value: "WANDSWORTH" } },
    { label: "Craven, North Yorkshire", sublabel: "226 sales", target: { label: "Clapham (Craven)", level: "district", value: "CRAVEN" } },
    { label: "Arun, West Sussex", sublabel: "136 sales", target: { label: "Clapham (Arun)", level: "district", value: "ARUN" } },
  ],
};

export const ALL_FIXTURES: { name: string; spec: ViewSpec }[] = [
  { name: "verdict", spec: verdictFixture },
  { name: "comparison", spec: comparisonFixture },
  { name: "timeseries", spec: timeseriesFixture },
  { name: "distribution", spec: distributionFixture },
  { name: "disambiguation", spec: disambiguationFixture },
];

/** Deliberately malformed — proves the safeParse boundary renders a broken tile. */
export const BROKEN_FIXTURE = { kind: "timeseries", title: "Missing points and stats" };
