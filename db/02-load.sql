-- Load ~31M rows straight from HM Land Registry into ClickHouse Cloud.
--
-- NOTE ON THE URL: ClickHouse's own tutorial points at `prod1`, which now 301s
-- twice — prod1 → prod → prod2. We target prod2 directly rather than rely on
-- url() following redirects. 5.1 GB, verified reachable 17 Jul 2026.
--
-- Source columns (16, positional):
--   c1 tx_uid  c2 price  c3 date  c4 postcode  c5 type  c6 is_new  c7 duration
--   c8 paon    c9 saon   c10 street  c11 locality  c12 town  c13 district
--   c14 county c15 ppd_category  c16 record_status

INSERT INTO HACK_BWT.sales
SELECT
    c2 AS price,
    toDate(parseDateTimeBestEffortOrNull(c3)) AS date,
    splitByChar(' ', c4)[1] AS postcode1,
    splitByChar(' ', c4)[2] AS postcode2,
    transform(c5, ['T', 'S', 'D', 'F', 'O'],
                  ['terraced', 'semi-detached', 'detached', 'flat', 'other'],
                  'other') AS type,
    c6 = 'Y' AS is_new,
    transform(c7, ['F', 'L'], ['freehold', 'leasehold'], 'unknown') AS duration,
    c8 AS addr1,
    c9 AS addr2,
    c10 AS street,
    c11 AS locality,
    c12 AS town,
    c13 AS district,
    c14 AS county
FROM url(
    'http://prod2.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-complete.csv',
    'CSV',
    'c1 String, c2 UInt32, c3 String, c4 String, c5 String, c6 String, c7 String,
     c8 String, c9 String, c10 String, c11 String, c12 String, c13 String,
     c14 String, c15 String, c16 String'
)
SETTINGS max_http_get_redirects = 10, input_format_allow_errors_ratio = 0.001;
