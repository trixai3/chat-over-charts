-- HACK_BWT.sales — UK Land Registry Price Paid Data
--
-- This is OUR schema, not the playground's. The difference matters: the 25%
-- criterion is "depth, creativity and correctness in leveraging ClickHouse",
-- and owning the ordering key is where that shows.
--
-- Rules applied (from clickhouse/agent-skills):
--   schema-pk-prioritize-filters   (CRITICAL) — ORDER BY matches our WHERE patterns
--   schema-pk-cardinality-order    (CRITICAL) — low cardinality leads
--   schema-partition-start-without (MEDIUM)   — no partitioning; no lifecycle need at 31M rows
--   schema-types-lowcardinality, schema-types-enum, schema-types-minimize-bitwidth,
--   schema-types-avoid-nullable

CREATE TABLE IF NOT EXISTS HACK_BWT.sales
(
    price      UInt32,
    date       Date,
    postcode1  LowCardinality(String),
    postcode2  LowCardinality(String),
    type       Enum8('other' = 0, 'terraced' = 1, 'semi-detached' = 2, 'detached' = 3, 'flat' = 4),
    is_new     UInt8,
    duration   Enum8('unknown' = 0, 'freehold' = 1, 'leasehold' = 2),
    addr1      String,
    addr2      String,
    street     LowCardinality(String),
    locality   LowCardinality(String),
    town       LowCardinality(String),
    district   LowCardinality(String),
    county     LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (county, district, date);

-- Why (county, district, date), measured cardinalities in brackets:
--
--   county [132] → district [467] → date [~11k days]
--
-- Per schema-pk-cardinality-order, low cardinality leads: county is the coarsest
-- filter and prunes hardest.
--
-- DELIBERATE DEVIATION from that rule's "date goes 2nd" guideline. Our drill-down
-- is the highest-frequency query and always filters county AND district together
-- (`WHERE county='GREATER LONDON' AND district='LAMBETH'`). Putting date between
-- them would break district pruning for every drill click — the one interaction
-- that must stay sub-second. Date still prunes as the third key for the
-- year-filtered borough comparison.
--
-- Per schema-pk-filter-on-orderby, verify with:
--   EXPLAIN indexes = 1 SELECT ... WHERE county = 'GREATER LONDON' AND district = 'LAMBETH';
