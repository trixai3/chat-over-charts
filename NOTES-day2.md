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

---

## 5. 切片 1 —— agent 骨架跑通(无需任何 key)

**做了什么:** 把 §5 那六步里"不碰 ClickHouse、不碰真模型"的部分先落地,证明 harness 在我们的
setup 下能跑。新增 4 个文件:

| 文件 | 作用 |
|---|---|
| `trigger.config.ts` | Trigger.dev 构建配置。**离线测试根本不读它**——vitest 直接 import agent 模块。它只为 `trigger dev`/deploy 服务。`project` 从 env 读(不写死进源码)。 |
| `src/agent/tools.ts` | `emitVerdict` 工具。**"零散文"的硬通道**:系统提示说"别写段落"是软约束,模型会破;把裁决做成*工具*,模型没有别的出口。 |
| `trigger/house-agent.ts` | `chat.withClientData().agent()`。整个后端就是这一个 durable task,没有 Next.js API route。 |
| `trigger/house-agent.test.ts` | 离线测试。假模型脚本化两步:step1 调 `emitVerdict`,step2 收尾。 |

**三个必须自己讲清楚的机制:**

1. **注入缝** `model: clientData?.model ?? getModel()`
   —— 测试时 `mockChatAgent(agent, { clientData: { model: 假模型 } })` 把假模型塞进去,生产回落到
   env 开关。一行代码,让整个 agent 逻辑离线可测。

2. **工具输出统一契约:每个工具的 output 就是一个 ViewSpec。**
   `execute()` 返回完整 ViewSpec → 流给前端渲染;`toModelOutput()` 压成一行 → 只有这行回到模型
   prompt。同一个工具结果,两个消费者,数据分流(AGENTS.md 不变量 2)。emitVerdict 的
   `toModelOutput` 返回 `"Verdict delivered to the user."`——模型自己写的话,不必回显给它自己。

3. **tools 声明在 config 上,不只在 streamText 上**(不变量 3)。否则 `toModelOutput` 从第 2 轮起
   被跳过,原始输出被塞回 prompt。切片 2 的 compareAreas 会把这条压到极限。

**踩的两个坑(都当场修了):**

- **`tool-call` 流块的 `input` 必须是 JSON 字符串,不是对象。** 类型标 `input: unknown`,但运行时
  SDK 会把它当 provider 流出的原始文本去 parse。传对象 → `tool-input-error` 在 execute 前就炸。
  改成 `JSON.stringify({...})` 就好。—— 又一次"类型签名骗人、运行时才是真相"。
- **这个 SDK 版本的 `TriggerConfig` 强制要 `maxDuration`。** 补 `maxDuration: 300`(秒,单轮计算上限;
  轮次之间挂起不计费不计时)。

**验证:** `npm test` 绿;`npm run typecheck` 干净。断言的是不变量 1(裁决 tile 到了前端 &
聊天流里零散文),不是"代码不报错"。

**切片 1 没碰的:** 真 ClickHouse、真模型、那个"turn-2 不泄漏"必过测试——全在切片 2。

---

## 6. 切片 2 —— compareAreas 接 31M 行 + 必过回归测试(仍无需模型 key)

**做了什么:** 第一个碰真数据的工具,加那个"只在多轮才炸"的坑的回归测试。新增/改动:

| 文件 | 作用 |
|---|---|
| `src/shared/clickhouse.ts` | 加 `clickhouseKey` + `getClickHouse()` —— ClickHouse 的 `locals` 注入缝 |
| `src/agent/metrics.ts` | 指标注册表:中位数(不是均值)、5年增长的两个窗口、薄版地理 |
| `src/agent/tools.ts` | 加 `compareAreas` 工具 |
| `trigger/no-leak.test.ts` | **必过测试**:连问三轮,断言 turn 2/3 的 prompt 无 ViewSpec JSON |

**先验证 SQL 再写工具**(fixtures-用真数据的规矩)。跑真查询确认形状:
- Barking and Dagenham +16.9%、Havering +13.1%…(真伦敦区,5年增长)
- **扫 4,030,464 行 / 355ms** —— county 剪枝生效(只碰伦敦行,不是全 31M)
- `quantileTDigestIf(0.5)(price, 条件)` 一次扫描出两期中位数;统计头是 `x-clickhouse-summary`

**三个要能自己讲的点:**

1. **ClickHouse 走 `locals`,不走 `clientData`。** 工具**不能**直接调 `clickhouse()`——那会把真客户端焊死、
   没 key 就没法测。改读 `getClickHouse()`,它从 run 的 `locals` 取。测试用 `setupLocals` 塞假客户端,
   生产没人塞就懒创建真的。**同一条代码路径,依赖可注入。**为什么不用 `clientData`?那是浏览器来的 wire
   data;DB 客户端是服务端依赖,归 `locals`(testing.mdx 明说)。

2. **county 先大写再进 SQL。** `county = {param}` 精确匹配 LowCardinality 值 → 命中主键索引剪枝。
   若用 `upper(county)=...` 做大小写不敏感,会**废掉索引、扫全 31M 行**。(模糊地名解析"London→GREATER
   LONDON"、"Clapham→消歧 tile"是 Day 3;这工具假设 county 已解析。)

3. **必过测试证明的是不变量 3。** `toModelOutput` 在 turn 1 有效(streamText 当场压),但若 tools 没声明
   在 config 上,turn 2 起历史重转换时**被跳过**,原始 ComparisonSpec JSON 被塞回 prompt。我们声明在
   config 上了,测试断言三轮里没有一次 prompt 带 `"metricLabel"`/`"kind":"comparison"`,同时正向断言压缩
   摘要("Scanned … rows")**在**历史里——区分"压缩了"和"整个没了"。

**给测试验牙(make-it-fail-once 纪律):** 临时把 `compareAreas` 的 `toModelOutput` 改成
`JSON.stringify(output)`,重跑 → turn 2 的 prompt 里立刻冒出
`\"kind\":\"comparison\",\"metricLabel\":...`,测试在 `metricLabel` 那行变红。**这正是要防的 bug,被抓到了。**
改回来,全绿。—— 证明测试有牙,不是摆设。

**切片 2 没碰的:** 真模型、前端 transport、消歧 HITL、下钻。都在后面的切片。key 依然不是阻塞。

---

## 7. 切片 B —— 前端 transport(页面真正长出来了)

**做了什么:** 把 create-next-app 首页换成真聊天页,tile 从 agent 流进来。新增 3 个文件:

| 文件 | 作用 |
|---|---|
| `src/app/actions.ts` | 两个 **server action**:建 session、mint token |
| `src/components/chat.tsx` | `useTriggerChatTransport` + `useChat`,输入框 + tile 看板 |
| `src/app/page.tsx` | 首页 = `<Chat/>`(create-next-app 首页删了) |

**要能自己讲的三点:**

1. **server action ≠ API route。** 不变量 7 禁的是 route handler;`useTriggerChatTransport` 用的是
   Next 的 server action(`"use server"` 函数),这是 SDK 钦定的做法。浏览器永远拿不到 secret key ——
   两个 action 都在服务端跑。`startChatSession` 幂等(同 chatId 并发收敛到一个 session)。

2. **"output 即 ViewSpec" 的契约在这里收网。** 前端从每条 assistant message 的 tool-output part 里取
   `part.output`(就是完整 ViewSpec),丢给现成的 `Tile`。compareAreas(comparison)和 emitVerdict
   (verdict)**走同一条渲染路径**,前端不需要知道任何房价知识。`Tile` 的 `safeParse` 是唯一运行时校验
   边界(不变量 6)——坏数据 → 破 tile,不白屏。

3. **type-only import 防止服务端代码进浏览器包。** chat.tsx 里
   `import type { houseAgent }` 只为给 transport 的 task/clientData 上类型;`import type` 编译期抹除,
   agent 那串服务端依赖(clickhouse/locals/model)不会被打进 client bundle。构建实测证明了这点。

**踩的坑:** `next dev`(Turbopack)对着我之前 `next build` 留下的 `.next` 目录,**所有路由 404**(连
旧的 /gallery 也 404),但没有报错。清掉 `.next` 重启 dev 就好。—— 记住:**prod 构建产物和 Turbopack
dev 不能共用一个 `.next`。**

**验证边界(诚实):** 我验到了 —— `npm run build` 通过、类型干净、空状态页面浏览器实测渲染、零 console
错误。**没验到的** —— 点问题 → 真实 run → tile 流进来。那需要 `npx trigger.dev@latest dev` 连本地
worker + `.env.local` 的 `OPENROUTER_API_KEY`。没 worker 会一直停在 "Thinking",不是干净测试。这两样是你的。
