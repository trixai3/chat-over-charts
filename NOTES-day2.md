# Day 2 实现笔记

> 目的同 Day 1:让你能**自己讲清楚**。验收标准是你理解,不是代码能跑。

---

## 状态

- ✅ **数据层完成** —— 31,346,259 行进了你自己的 ClickHouse Cloud
- ⏳ **agent 未开始** —— 卡在 `OPENROUTER_API_KEY` 未填(见最后)

---

## 1. 数据加载:发生了什么

**结果:31,346,259 行,日期到 2026-05-29**(比 playground 的 3 月还新)。

三个文件:

- `db/01-schema.sql` —— 我们**自己的**表结构
- `db/02-load.sql` —— 从 Land Registry 直接灌进 ClickHouse
- `src/shared/clickhouse.ts` —— 应用连接客户端

### 为什么 schema 是我们自己设计的(这是 25% 分数的核心)

playground 有现成的 `uk_price_paid`,但直接指过去等于"用了 ClickHouse"。**自己设计 ORDER BY key 才是"深度使用"。**

**ORDER BY (county, district, date)** —— 我按 skill 里两条 CRITICAL 规则定的:

- `schema-pk-cardinality-order`:低基数在前(county 132 → district 467 → date ~11k 天)
- `schema-pk-prioritize-filters`:ORDER BY 要匹配 WHERE 模式

**一处刻意偏离规则,值得你知道:**规则说"date 应该放第 2 位"。我没照做,把 district 紧跟在 county 后面。原因:**下钻是最高频查询,永远同时按 county+district 过滤**(`WHERE county='...' AND district='...'`)。如果 date 插在中间,每次下钻点击的 district 剪枝就废了 —— 而下钻必须亚秒。这是"理解规则后有理由地偏离",不是无视规则。

### 铁证:索引真的在剪枝

`EXPLAIN indexes=1` 跑下钻查询,结果:

```
Granules: 23/3828      ← 3828 个数据块里只读了 23 个
Search Algorithm: binary search
```

**主键剪掉了 99.4% 的数据。**这个数字就是 demo 里"为什么用 ClickHouse"的答案 —— 不是"它快",而是"它只读了该读的那 0.6%"。你可以在视频里直接指着这个 EXPLAIN 说。

---

## 2. 偏差记录

### ⚠️ 2.1 数据源 URL 变了 —— ClickHouse 官方教程是错的

教程里写的 `prod1.publicdata.landregistry.gov.uk`,现在会 **301 两次**:
`prod1 → prod → prod2`。真实数据在 `prod2`(5.1 GB)。

我直接用 `prod2`,并在 SQL 里加了 `max_http_get_redirects=10` 兜底。**这是"整个栈都比训练数据新"的又一例** —— 连 ClickHouse 自己的教程都过时了。

### ⚠️ 2.2 `ECONNRESET` —— ClickHouse Cloud 必须关掉 keep-alive

加载后第一次查询直接崩:`read ECONNRESET`。这不是数据问题,是连接问题 —— **ClickHouse Cloud 的负载均衡器会重置空闲的 keep-alive socket**,客户端下次复用就炸。

skill(`clickhouse-js-node-troubleshooting`)证实这是已知失败模式。解法写进了 `src/shared/clickhouse.ts`:`keep_alive: { enabled: false }`。

**为什么重要:**这个 bug 的模式和"turn 2 才炸"一样阴 —— 单次查询不复现,连续查询才炸。放到 demo 现场就是灾难。现在锁死在客户端配置里了。

### 2.3 enum 在加载时转换

Land Registry 存的是单字母(`T`/`S`/`D`/`F`/`O`、`F`/`L`)。我在 `02-load.sql` 里用 `transform()` 转成了可读 enum(`terraced`、`freehold`…)。验证过分布正常:terraced 928 万、flat 564 万,合理。

---

## 3. 需要你做的

### 🔴 只差这一件:OpenRouter key

我检查了 `.env.local`,**所有东西都齐了,除了 `OPENROUTER_API_KEY` 是空的**(你设了 `MODEL_PROVIDER=openrouter` 但没填 key)。

去 **https://openrouter.ai/keys** 拿一个填进去。填完 agent 就能开工。

已验证齐全的:ClickHouse(连通,31M 行)、Trigger.dev(ref + secret)、`OPENROUTER_MODEL=deepseek/deepseek-chat`。

### 理解检查

1. 为什么我们自己设计 schema,而不是指向 playground 的现成表?
   <details><summary>答案</summary>指过去只是"用了";自己设计 ORDER BY 才是 25% 分数要的"深度"。而且自己的表才能加物化视图、dictionary。</details>
2. `Granules: 23/3828` 说明了什么?
   <details><summary>答案</summary>下钻查询只读了 3828 个数据块里的 23 个,主键剪掉 99.4%。这是"为什么用 ClickHouse"最直接的证据。</details>
3. 为什么 ORDER BY 里 date 没有按规则放第 2 位?
   <details><summary>答案</summary>下钻永远同时过滤 county+district,date 插中间会废掉 district 剪枝,而下钻必须亚秒。有理由地偏离规则。</details>

---

## 4. 下一步(拿到 key 后)

用 `mockChatAgent` 离线写 `chat.agent` + 第一个真 ClickHouse tool + `emitVerdict` + `toModelOutput`,
必过测试:连问三轮,断言 turn 2/3 的 prompt 里没有 ViewSpec JSON。
