# 实现计划 —— 完整清单与进度

> **当前方向（2026-07-20）：Architecture V2。** 本页顶部是接下来工作的单一真相源；
> [`docs/architecture-v2.md`](docs/architecture-v2.md) 记录完整边界与理由。下面的 V1 部分
> 保留已有实现和 hackathon 历史，不再代表未来扩展顺序。

**图例：** ✅ 已完成并验证 · 🔨 进行中 · ⬜ 未开始 · 🟡 有证据后才做

---

## Architecture V2 — 实施总则

目标不是一次重写。每个切片都必须满足四条规则：

1. 结束时有一条真实的端到端路径，而不是只完成抽象层。
2. 现有 UK house-price 行为和 wire format 默认不变。
3. 未通过本切片的 failure-path 测试，不进入下一片。
4. 新 source 和新 figure 分开证明；不要在同一个 PR 同时改两条扩展轴。

**目标验收句：**

> 新 source 只增加一个受审查的 Source Pack；新图表只增加 Figure Definition、ViewSpec
> variant、renderer 和 fixture。两者仍共用同一个 planner、ClickHouse compiler、validator
> 和 tool loop，模型没有 SQL、ViewSpec、source 切换或计划改写通道。

### V2 进度总览

| 切片 | 产出 | 状态 | 预计 |
|---|---|---:|---:|
| V2-0 | 架构、威胁模型、验收标准 | ✅ | 0.5 天 |
| V2-1 | 服务器 canonical context + 不可篡改 `planId` | ⬜ | 1 天 |
| V2-2 | 可信 clarification ID/spec + HITL 恢复 | ⬜ | 1 天 |
| V2-3 | 静态 Figure Registry + 第一个新图 | ⬜ | 1–1.5 天 |
| V2-4 | 有界 `DecisionEvidence` + evidence-bound verdict | ⬜ | 0.5–1 天 |
| V2-5 | 房价迁入 Source Pack，无行为变化 | ⬜ | 1–1.5 天 |
| V2-6 | 通用 member resolution + semantic drill | ⬜ | 1–1.5 天 |
| V2-7 | 第二个真实 Source Pack，全链路证明 | ⬜ | 1–2 天 |
| V2-8 | 把已重复的接入步骤做成 onboarding CLI | 🟡 | 2–3 天 |
| V2-9 | 开源与生产保护 | ⬜ | 1–2 天 |

V2-1 至 V2-7 的可用内核约 **7–10 个开发日**。完成 V2-8 后，一个干净的 ClickHouse
单事实关系应能在 **0.5–1.5 天**接入；需要 enrichment、隐私治理或复杂指标时预计
**2–5 天**。这些是规划估算，不是交付承诺。

### 当前执行焦点：多源支线（2026-07-21）

目标是「每语义层支持多数据源」。这是 V2 的一个**子集**，不是全部重写：

- **纳入支线（core）：** V2-5（房价迁入 Source Pack）、V2-6（通用 member resolution）、
  V2-1 的 **source-binding 部分**（删除 model-facing `sourceId`，session 绑定已授权 source）、
  V2-7（第二个真实 Source Pack）。第二份测试数据由使用者另行提供。
- **随支线附带：** V2-2 中「服务器生成 clarification spec」的最小部分——它与 V2-6 的通用
  resolver 同源，无法干净拆开。
- **暂缓（独立 hardening pass）：** sealed `planId`/PlanStore、Figure Registry（V2-3）、
  DecisionEvidence verdict（V2-4）。它们与源数量正交，不阻塞第二源。
- **理由：** source binding 既是多源基建，也是防「同名指标跨源串线」的 hardening；其余
  hardening 随源增多更有价值，但可在多源跑通后独立补上。intent grounding（§8.2）在两个
  同名指标的源共存后值得提前。

**支线切片顺序**（每片端到端且带测试）：

1. Source Pack registry + 房价 model 迁入 `src/analysis/sources/`（**零行为变化**）。✅ 完成并验证
2. Source binding（删除 `sourceId`，`onBoot`/`chat.local` 注入）。⬜
3. 通用 member resolution（声明式 resolver 替换 `place-resolver.ts`）+ 最小 clarification spec。⬜
4. 领域解耦 prompt / measure menu。⬜
5. 第二个真实 Source Pack 全链路证明。⬜

### V2-0 — 固化边界 ✅

**交付：**

- `docs/architecture-v2.md`：Source Pack、sealed plan、Figure Registry、evidence、tool-loop 状态门。
- 本实施计划：切片顺序、停止条件、回滚点和第二 source 验收。
- 明确拒绝多 dialect、动态 JOIN、runtime plugin、任意公式 DSL 和跨 source 查询。

**完成定义：**文档能用一句话解释；每个模型输入都有可信代码的校验边界；ClickHouse
建议标明 official / derived / field provenance。

### V2-1 — Canonical context 与 sealed plan

**一句话：**模型只能提议 intent，不能改写问题、切 source 或修改已批准 plan。

**改动：**

1. 新建 run-local `AnalysisState`，在 `onBoot` 初始化 bound source、空的 `plans`/
   `evidence`；每次 `run()` 再从真实 messages 建立当前 `TurnState`。不要在 module global
   保存会话状态。
2. session 创建时由 UI/服务器选择并授权 source；从所有 model-facing schema 删除
   `sourceId`。
3. `run()` 从真实 messages 取当前 user message；从 `AnalysisDraft` 删除 `question`。
4. `inspectAnalysis` 内部组合 canonical question + bound source，READY 后保存完整
   `AnalysisPlan`，只把 `planId` 和短 summary 返回给模型。
5. `renderAnalysis` 输入缩成 `{ planId }`；lookup 失败时返回 `PLAN_EXPIRED`，ClickHouse
   调用次数必须为 0。
6. 保留 `chat.toStreamTextOptions().prepareStep`，再按状态限制 `activeTools`；每步
   `toolChoice: "required"`，终止条件为 verdict/notice tool 或 step budget。
7. `clientData` 改成 `.strict()` 的浏览器元数据 schema；model、ClickHouse executor 和测试
   dependencies 只从 server locals/agent factory 注入，并用 `onValidateMessages` 校验新消息。

**必须先红后绿的测试：**

- 模型伪造/复用另一 run 的 planId，不查询。
- inspect 后没有输入字段可改变 measure、filter、grain 或 source。
- 原问题包含 “average/latest” 时，即使 draft 没复述，guard 仍触发。
- 首步、任意中间步都不能以 prose 提前结束。
- turn 2/3 prompt 仍无 ViewSpec、raw rows 或 SQL。

**回滚点：**保留旧 tool 名和前端输出；此片不改 ViewSpec，不改 SQL 结果。

### V2-2 — 可信 clarification

**一句话：**用户看到的选项来自 resolver，不来自模型。

**改动：**

1. planner/resolver 生成 `ClarificationSpec`，存入 `AnalysisState`，输出
   `{ clarificationId, spec }` 给前端。
2. `toModelOutput` 只暴露 `clarificationId`；无 `execute` 的 HITL tool 只接受该 ID。
3. 前端从 inspect tool output 渲染 server spec，不从 pending tool input 读 question/options。
4. 用户只提交 `optionId`；恢复时同时校验 clarification、option、source 和 run。
5. `hydrateMessages` 把 option 与 pending toolCallId 和 run-local state 对照；重复提交幂等，
   跨 run/replay 拒绝。
6. resolver timeout/连接错误返回 `RESOLVER_UNAVAILABLE`，不冒充 “没有这个值”。
7. 有 pending HITL 时，`onAction` 拒绝 drill，避免两个状态流竞争。

**验收：**伪造 clarificationId/optionId 不显示选项、不查询；直接提交一个真实但歧义的
member 也必须进入 HITL，不能因 dimension ID 正确而绕过 resolver。

### V2-3 — Figure Registry 与第一个新图

**一句话：**加图不加 agent tool。

**改动顺序：**

1. 建静态 `FIGURES`，逐种迁入 `compatible`、`finalize`、`build`、`evidence`；
   `pipeline.ts` 只负责编排、验证、profiling 和 payload cap。
2. 保留客户端穷尽 `RENDERERS`，因为 Trigger worker 不应 import React。
3. `DatasetProfile` 改为按 dimension 记录 cardinality，而不是一个全局 category count。
4. 第一个新图优先 **grouped column**（时间 × 类别 × 一个 measure）；若现有 IR 不能自然
   表达，则改选 heatmap，但不能把 SQL 塞进 figure definition。
5. 同步增加 ViewSpec variant、renderer、真实 fixture 和 gallery case。

**验收：**新增图不改 agent tool schema、Source Pack 或 ClickHouse compiler；不兼容的
preferred figure 被确定性替代或拒绝；漏注册 renderer 在编译期失败。

### V2-4 — DecisionEvidence 与 verdict

**一句话：**模型只能在服务器证明过的结论候选中选择，不能撰写结论。

**改动：**

1. 每次 render 保存最多 4KB 的 typed `DecisionEvidence`，不把完整 evidence 送进 prompt。
2. label 去控制字符/换行并限长；自由文本列、category labels、数值和 table preview 都不进入
   后续 model prompt。
3. Figure Definition 从 typed facts 生成有限 `InsightCandidate`，完整 VerdictSpec 由 server
   template 构造。
4. `emitVerdict` 只接受 `{ evidenceId, candidateId }`，没有 headline/detail/数字/实体名字段；
   非当前 run/source 的 ID 或不兼容 template 产生中性 notice。
5. 新增只接受关闭 reason enum 的 `emitNotice`，由服务器生成 off-topic、unsupported、
   expired 和 budget-exhausted 等中性 VerdictSpec。
6. tool-loop 每 turn 有 query/step/evidence budget；达到预算后只允许 verdict/notice。

**验收：**恶意 label 不能进入下一轮 prompt；模型没有字段可伪造统计数字或因果关系；
同一 verdict 不能引用另一 run/source 的 evidence；模型仍看不到 ViewSpec 和 SQL。

### V2-5 — 房价迁入 Source Pack

**一句话：**先做一次零行为变化的领域解耦，再接第二份数据。

**改动：**

1. 建 `src/analysis/sources/` 和编译期 registry；Source Pack 是受 code review 的 TS，
   不是用户上传的 YAML。
2. 将房价 model、指标、值域 snapshot、place resolver、hierarchy、query budget、provenance
   和 limitations 搬进 `england-wales-house-prices/`。
3. 将全局 composed-price schema 改成 named measures；`p90_price` 等在房价 pack 内注册。
4. 所有 filter dimension 显式声明 ClickHouse parameter type 和成员策略：`snapshot`、
   `resolver` 或 `parameterized`。
5. `SourceAdapter` 改名 `QueryExecutor`；继续只有一个 ClickHouse compiler，不创建 dialect
   interface。
6. 修复全局 `CLICKHOUSE_DATABASE` 覆盖所有 model 的问题；relation 归 bound pack 所有。
7. system prompt 拆为通用约束 + 有界 source catalog；catalog 不含 SQL/table/database。

**验收：**现有 golden、fixture、agent 与 live query 行为保持一致；core 不再出现
price、county、district、locality、`GeoLevel` 等领域术语。

### V2-6 — 通用 member resolution 与下钻

**一句话：**地理、产品、团队等层级共用一个受治理语义 action。

**改动：**

1. 用声明式 `ValueResolver`/`memberLookup` 替换 `place-resolver.ts`；SQL 只使用注册
   expression，用户值全部 parameterized。
2. 将 `GeoLevel` 替换为 Source Pack hierarchy；builder 生成 semantic drill action。
3. `onAction` 针对 bound source、hierarchy、值域和当前 scope 再验证，然后直接
   plan → query → build → stream；不调用模型。
4. action 没有 SQL/表达式；V2 首版重新验证 scope，不先引入签名服务。

**验收：**无效层级、值或越权 source 不查询；正常 drill 不增加 LLM call；HITL pending
时 action 被拒绝。

### V2-7 — 第二个真实 Source Pack

**一句话：**只有第二份真实数据全链路通过，才能宣称“支持更多数据”。

选一个与房价明显不同的追加型事实数据，例如 support tickets、交通行程或能源读数。
它至少要有一个 time dimension、两个 category dimensions、一个 additive measure、一个
non-additive measure/ratio，以及一个适合 distribution 的 numeric value。

**变更约束：**除新 pack、registry entry、fixtures 和测试外，不得修改 agent、tools、
pipeline、compiler 或已有 Figure Definition；若必须修改，说明 core contract 仍不完整，
应先回到相应切片修复。

**验收：**

- 至少 12 个 golden questions 覆盖 KPI、趋势、比较、表格、分布及一个新图。
- 未知 measure/dimension/figure 在 SQL 生成前停止；歧义 value 进入 HITL。
- hostile filter injection 测试通过；所有用户值仍参数化。
- compile → execute stub → validate/profile → ViewSpec 全链路 fixture 通过。
- 至少 5 个 credential-gated live smoke cases，并验证 query limits 与 `EXPLAIN indexes = 1`。
- 每张图保留 source、freshness、measure definition、limitations、query ID 和扫描统计。
- pack README 写清 row grain、来源、许可证、刷新方式、PII、时区和 schema drift 操作。

### V2-8 — Onboarding CLI 🟡

**开始条件：**手工完成第二个 Source Pack 后，确实观察到重复步骤；此前不做 generator。

建议三个命令：

```bash
npm run source:inspect -- analytics.tickets
npm run source:init -- support-tickets
npm run source:doctor -- support-tickets
```

- `inspect` 只读采集 columns/comments、engine、row/byte count、ORDER BY/primary/partition、
  skip indexes、date range、cardinality、null coverage、有界脱敏 sample、schema fingerprint，
  并对代表查询运行 `EXPLAIN`。
- `init` 只生成带 `TODO: confirm` 的草稿。LLM 可以起草 label/description/synonym，不能
  发布 measure、SQL expression 或权限策略。
- `doctor` 检查 ID/synonym 冲突、默认指标、parameter type、additivity/limitation、SQL
  `EXPLAIN`、query caps、snapshot normalization、schema drift、golden case 和图表兼容性。

必须由人确认：row grain、指标业务定义、单位/货币/时区、ratio 分子分母、可加性、PII、
小样本抑制、权限、来源/许可证/freshness、enrichment 和 ORDER BY 是否符合真实查询。

### V2-9 — 开源与生产保护

- 保持 MIT；提供一份可公开的小型 demo data 或一键加载的开放数据说明。
- `.env.example` 只列变量名；CI 使用 stub executor，live tests 明确 opt-in。
- ClickHouse 使用 read-only role、settings profile、rows/bytes/time limits 和 per-user quota。
- source picker 只显示用户有权访问的 packs；日志不记录原始敏感 filter values。
- 发布 source-pack template、最小示例、contract checklist、架构图和 15 分钟 quickstart。
- 图表补 keyboard、色盲 palette、文本摘要/数据表 fallback；“答案是图”不等于排除读屏用户。
- 记录 telemetry：unknown term、clarification rate、query failure、fallback figure、scan/time；
  只用这些证据决定下一张图、rollup 或 resolver。

### 发布闸门与停止条件

1. **V2-1/V2-2 是安全闸门，先于扩图和接数据。**否则扩展只会放大当前可绕过边界。
2. **V2-3 与 V2-5 分开合并。**一个证明“加图”，一个证明“加 source”。
3. **V2-7 通过前，不对外声称任意数据。**准确说法是“支持经过治理的 ClickHouse
   单事实 Source Packs”。
4. 若新 source 需要 dynamic JOIN，先在 ClickHouse 用 dictionary、denormalization 或
   refreshable MV 形成一个逻辑事实关系；不把 JOIN planner 加进 agent。
5. 只有 query telemetry 证明重复聚合是热点，才加 incremental MV；始终保留 raw fallback。
6. hackathon 提交窗口内不一次性实施全部 V2；只选一个能端到端演示的安全切片，其余保持
   文档化，避免在 feature freeze 前大重构。

---

## V1 — 现有实现与历史进度

> **Figure generator redesign (19 Jul):** the generic semantic-query, chart-policy,
> validation, explanation, and clarification implementation is documented in
> [`FIGURE_GENERATOR_IMPLEMENTATION.md`](FIGURE_GENERATOR_IMPLEMENTATION.md).

> 下面记录 2026-07-18 起的 V1 状态，供核对已有能力与历史决策；Architecture V2 的
> 当前执行状态以上面的 V2 表为准。

**图例:** ✅ 已完成并验证 · 🔨 进行中 · ⬜ 未开始 · 🟡 可选/若领先才做

---

## 全局进度

| 层 | 状态 | 一句话 |
|---|---|---|
| 数据层(ClickHouse) | ✅ 基础完成,🔨 物化视图待建 | 31.35M 行已入我们自己的 schema |
| 视觉层(tiles + gallery) | ✅ 完成 | 5 种 tile 全部渲染,fixture 用真数据 |
| 模型层(getModel) | ✅ 完成,🔨 注入口待改 | OpenRouter/Anthropic env 切换 |
| Agent(chat.agent) | 🔨 双 tool 跑通 | 切片 1 ✅ emitVerdict;切片 2 ✅ compareAreas 接 31M 行 + 必过测试;接真模型/前端 ⬜ |
| 语义层 | ⬜ 未开始 | 三块,时机不同 —— 见 §4 |
| 前端接线(transport) | 🔨 构建完成 | 切片 B ✅ 页面+transport+tile 看板;真实流式待你的 worker+key 验 |
| 下钻(onAction) | ⬜ 未开始 | Day 4 |
| 离线管线(LLM dictionary) | 🟡 可选 | 降级为增强,非地基 —— 见 §4 |

---

## 1. 数据层 — ClickHouse ✅🔨

**为什么是我们自己的 service 而非 playground:** 25% 那项奖励的是"拥有数据层",不是"指着一个表"。

- ✅ `db/01-schema.sql` — `sales` 表,我们自己的 `ORDER BY (county, district, town, date)`
- ✅ `db/02-load.sql` — 从 Land Registry `prod2` URL 加载(注意:官方教程写的 `prod1` 会 301 跳转两次)
- ✅ 31,346,259 行已入库,1995-01-01 → 2026-05-29,132 郡 / 467 区
- ✅ `src/shared/clickhouse.ts` — 客户端工厂 `clickhouse()`
- ✅ 索引剪枝已验证(EXPLAIN 证明按 county 过滤只扫少量 granule)
- 🔨 **物化视图** — 每区每月中位数的 rollup,让下钻秒回。**计划提过,尚未建。** Day 2/3 加。
- ⬜ 增量摄入(每月 Land Registry)—— Day 5

## 2. 视觉层 — tiles + gallery ✅

**为什么先做:** viewSpec 是纯数据,所以视觉层能先于 agent 存在。solo 唯一的并行,也对冲 agent 风险。

- ✅ `src/shared/view-spec.ts` — Zod discriminated union,5 种 kind,单一真相源
- ✅ `src/components/tile-renderer.tsx` — registry(`satisfies` 编译期保证)+ 唯一运行时校验边界
- ✅ 5 个 tile:verdict / comparison / timeseries / distribution / disambiguation
- ✅ `src/app/gallery/page.tsx` — 全部 kind 用 fixture 渲染
- ✅ `src/shared/fixtures.ts` — 真实 playground 数据
- ✅ `src/shared/format.ts` — 货币/百分比/stats 格式化
- ✅ 生产构建通过,交互回调(drill/resolve)已测

## 3. 模型层 — getModel ✅🔨

- ✅ `src/shared/model.ts` — `MODEL_PROVIDER` env 切换 OpenRouter/Anthropic
- ✅ OpenRouter provider pin 在 2.10.0(3.0 只配 ai@7)
- 🔨 **注入口** — 改成 `clientData?.model ?? getModel()`,让 `mockChatAgent` 能塞假模型。
  **下一步就做**(见 §5)。

---

## 4. 语义层 — 三块,时机与难度不同 ⬜

> **关键认识(2026-07-18):** 语义层不是一整块。而且最重的那块被降级了。

### (a) 地名解析器 — 拆成两半

**核心(易,demo 关键)** ⬜ Day 3
- 纯 SQL 实时歧义检测:`WHERE locality=? GROUP BY county,district`,>1 个结果 → 发消歧 tile
- **零离线管线、零 LLM、零 dictionary。** 实测 Clapham 836ms 返回 5 个地方,最大在 Bedfordshire ✅ 已验证可行
- 配 HITL(无 `execute` 的 tool)→ run 挂起 → 用户点 chip → 恢复

**增强(难,规模/创新故事)** 🟡 Day 5 若领先
- 离线 LLM 批处理 7,726 个歧义地名 → ClickHouse dictionary → `dictGet`
- 处理 SQL 做不到的:别名("北伦敦")、邮编("SW4")、拼写、废弃行政区归并
- **降级理由:** 我原来把它当"为什么需要 Trigger.dev"的最强论据。但 `chat.agent()` 现在是整个后端,
  Trigger.dev 的存在感不再靠它。所以它从"Day 3 地基"变成"Day 5 锦上添花"——**降低风险**。

### (b) 指标注册表 ✅ 完成(`src/agent/metrics.ts`)
- 定义了 median price(`quantileTDigestIf`)+ 5年增长两个窗口。
- `avg(price)` 是谎言(右偏),必须 `quantileTDigest`。定义一次,防一次。✅ 落地

### (c) 维度层级(地理树) 🔨 薄版 ✅,完整版 Day 4
- ✅ 薄版:`compareAreas` 里 county 内按 district 分组(`GROUP_LEVEL`/`PARENT_LEVEL`)
- ⬜ 完整版:地理树声明成数据,支撑任意层级下钻(Day 4)

---

## 5. Agent — chat.agent ⬜ (Day 2 主线,现在开始)

**为什么零凭证也能开始:** `mockChatAgent`(Trigger.dev)+ `MockLanguageModelV3`(Vercel AI SDK)
= 整个 agent 逻辑离线可测。凭证只在最后接真模型那步要。

按顺序:

**切片 1(✅ 完成,无需 key):骨架跑通**
1. ✅ **model 注入口** — `clientData?.model ?? getModel()`,写在 `trigger/house-agent.ts`
2. ✅ **`trigger.config.ts` + `trigger/` 目录** — 手写 config(`maxDuration` 这版必填)
4. ✅ **`emitVerdict` tool** — `src/agent/tools.ts`,带 `toModelOutput`;output 即 VerdictSpec
5. ✅ **`chat.agent({ tools, run })`** — tools 声明在 config 上,注入缝就位
   - ✅ 离线冒烟测试:假模型调 emitVerdict,断言零散文 + 裁决 tile 到前端(`npm test` 绿)

**切片 2(✅ 完成,仍无需 key):接 31M 行 + 必过回归测试**
3. ✅ **`compareAreas` tool** — 第一个真 tool,ClickHouse 走 `locals` 注入(`getClickHouse()`/`clickhouseKey`)
   - ✅ 指标注册表 `src/agent/metrics.ts`(中位数 `quantileTDigestIf`)+ 薄版地理(county→district)
   - ✅ SQL 已对真数据验证:Barking +16.9% 等,扫 4.03M 行 /355ms(county 剪枝生效)
   - ✅ `execute` 返回 ComparisonSpec;**`toModelOutput` 压成一行**(无 spec 字段名)
6. ✅ **turn-2 回归测试** `trigger/no-leak.test.ts` — 连问三轮,断言 turn 2/3 prompt 无 ViewSpec JSON
   - ✅ **必过、有牙**:临时让 toModelOutput 泄漏 → 测试立刻变红(见 NOTES-day2 §6)
   - ✅ `mockChatAgent` + `setupLocals` 假 CH,完全离线

**Day 2 收尾于:** 打字提问 → agent 选 tool → 真图流进来。整个产品的瘦版本。

---

## 6. 前端接线 — transport 🔨 (切片 B,构建完成)

- ✅ 两个 **server actions**(`src/app/actions.ts`)——`startChatSession` + `mintChatAccessToken`。
  注意:是 server action **不是** API route,不违反不变量 7。
- ✅ `useTriggerChatTransport`(`@trigger.dev/sdk/chat/react`)—— `src/components/chat.tsx`
- ✅ 主页面替换掉 create-next-app 首页;tile 看板从 message 的 tool-output part 取 ViewSpec → 复用 `Tile`
- ✅ 等待时显示 "running the tool loop…"(不是转圈);停止按钮(`stop()`)
- ✅ 构建/类型/空状态渲染全绿,零 console 错误(浏览器实测)
- ⬜ **真实流式未验证** —— 需要 `trigger dev` 连本地 worker + `OPENROUTER_API_KEY`(你来)
- ⬜ Streams v2 自定义 data-* part(当前 tile 走 tool-output part,已够用;进度细分再说)
- ⬜ 页面刷新恢复(`resume` + 持久化)—— 之后加

---

## 7. 下钻 — onAction ⬜ (Day 4,差异化核心)

- ⬜ `actionSchema`(Zod)+ `onAction` handler
- ⬜ 点 tile → `transport.sendAction` → ClickHouse → 新 tile → **返回 void,不调模型**
- ⬜ 面包屑显示下钻路径
- ⬜ 用 `getPendingToolCalls()` 在消歧未决时挡住竞争 action
- ⚠️ **注意:** onAction 设计初衷是改对话状态(undo/edit),我们在借用它。边界要测。

---

## 8. 收尾 ⬜ (Day 5-6)

- ⬜ 每月增量摄入(`schedules.task()`)
- ⬜ 错误/空态
- ⬜ 部署 Vercel
- ⬜ README 的"CH/TD 各自怎么用"写作
- ⬜ demo 视频(分镜见 PLAN §11)
- 🟡 离线 LLM dictionary(§4a 增强)
- 🟡 地图(需 ONS 边界数据,§PLAN Risk 3)
- 🟡 自由查询 tool(只读用户 + 限行 + 超时)

---

## 9. 深化路线图 —— 多图种 / 多问题(19 Jul 新方向)

> **背景:** 第一次真跑后,Trish 觉得"只能问一种问题"太局限,想要"各种图、各种问题,而且更通用、不只房地产"。
> **决策(PLAN §12):深化,不做跨领域通用引擎。** 病根是"只有 1 个工具",不是"它是房地产"。
> **关键认识:架构本身已经领域无关** —— `ViewSpec`、tile 渲染器、`chat.agent`、约束工具模式,没一行绑房子;
> 只有 `compareAreas` 这一个工具是房产专属。通用性当**卖点**(这套模式换任何数据集都行,这里跑 UK 房价),
> 不当**建设目标**。被否掉的是"LLM 自由写 SQL"引擎(破不变量 5、丢 ClickHouse 深度、4 天 solo 发不出来)。

**架构红利:** 因为"工具 output 即 ViewSpec" + `RENDERERS` 按 kind 派发,**加一个返回新图种的工具 = 前端零改动**。

| 切片 | 新工具 | 问题形状 | 出的图 | 状态 |
|---|---|---|---|---|
| 3 | `priceHistory` | "{地方}这些年怎么变" / 单区历史 | timeseries | ⬜(SQL 待验) |
| 4 | `priceDistribution` | "{地方}价格分布" | distribution | ⬜ |
| 5 | 扩 `compareAreas` | "最贵的区" / "跌最多" | comparison(补两个方向) | ⬜ |

⚠️ **开工前有 4 个开放问题待 Trish 拍板(见 PLAN §12.1)** —— 尤其"地名/层级解析是否先于图种做"
(Wigan 是区不是郡的问题)。**探讨未完,Trish 喊停。别急着写代码。**

---

## 已知偏差 / 待验证(实测后更新)

| 项 | 状态 |
|---|---|
| Land Registry URL 从 `prod1` 跳到 `prod2` | ✅ 已用 prod2 |
| ClickHouse 库名大小写敏感(HACK_BWT) | ✅ 已修 .env.example |
| OpenRouter 3.0 只配 ai@7 | ✅ pin 2.10.0 |
| chat.agent 错误重试是否从头重跑 run | ⬜ 待实测(影响离线批处理) |
| 前端能否直接取消 run(public token 只读) | ⬜ 待实测(可能要走后端;chat.agent 有 stopSignal) |
| OpenRouter 能否透传 Anthropic prompt caching | ⬜ 待实测 |
| DeepSeek 在多步 tool calling 的可靠性 | ⬜ 待实测(demo 前可能需切强模型) |

---

## 提交历史(master)

```
b7bce37 Merge branch 'day2-agent'
7a19e89 Day 2: load 31M rows into our own ClickHouse schema
eb34313 Add OpenRouter with a provider switch, and fix the database name
524c08e Day 2 prep: credentials aren't a hard blocker after all
146ff48 Design the UX end to end, and derive the demo shot list from it
55be9f8 Correct the agent design: tool loop, not prompt chain
9e7114a Find the real docs: 159 shipped .mdx, not the skills
87691e8 Day 1: viewSpec contract + fixture gallery
```
