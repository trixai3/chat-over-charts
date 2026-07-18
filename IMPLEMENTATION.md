# 实现计划 —— 完整清单与进度

> **这份文档是"做什么、做到哪了"的单一真相源。**
> `PLAN.md` 记录*为什么*这么设计;这里记录*进度*。
> 状态核对于 2026-07-18(Day 2 进行中),对着文件系统和 ClickHouse 实测,不是凭记忆。

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
