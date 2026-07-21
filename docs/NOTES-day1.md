# Day 1 实现笔记(7月17日)

> 这份笔记的目的:让你能**自己讲清楚**今天建的每一样东西。
> 验收标准不是"代码能跑",而是"你理解发生了什么"。

---

## 1. 今天的状态

计划里 Day 1 的收尾条件是:**`/gallery` 用 fixture 渲染出所有 tile 种类,不需要 LLM,不需要 ClickHouse。**

✅ **达成。** 而且额外拿下两件计划外的好消息:

1. **Risk 1 的核心不确定性在 Day 1 就消掉了** —— `chat.agent` / `toStreamTextOptions` /
   `createStopSignal` / `isStopped` / `useTriggerChatTransport` 全部真实存在,已实测 import 成功。
   研究报告说的都对,架构假设成立。
2. **`satisfies` 的编译期保证已被证明**(不是我嘴上说的),见 §3.2。

⏸ **未开始:**ClickHouse 数据加载 —— 需要你的凭证,见 §6。

---

## 2. 建了什么 —— 文件地图

```
src/
├── shared/
│   ├── view-spec.ts      ← 【核心契约】Zod schema,全系统的唯一真相源
│   ├── format.ts         ← 数字格式化(£630,000 / +17.9%)
│   └── fixtures.ts       ← 假数据,但数字全是真的
├── components/
│   ├── tile-renderer.tsx ← 【registry + 唯一的运行时校验边界】
│   └── tiles/
│       ├── tile-frame.tsx        ← 卡片外框 + 底部 "31.2M rows · 47ms"
│       ├── verdict-tile.tsx      ← 一句话结论(全产品唯一的文字)
│       ├── comparison-tile.tsx   ← 【demo 高潮】横条 + 涨跌
│       ├── timeseries-tile.tsx   ← 手写 SVG 折线
│       ├── distribution-tile.tsx ← 直方图 + 中位数虚线
│       └── disambiguation-tile.tsx ← 【HITL 的可见半边】
└── app/
    └── gallery/page.tsx  ← 把上面全部渲染一遍
```

根目录还加了:`LICENSE`(MIT)、`.env.example`、`.claude/launch.json`(让我能一键起 dev server)。

---

## 3. 三个你需要理解的设计

### 3.1 为什么运行时校验只放在**一个**边界

这是整个设计里最省事的一个判断,关键在于:**viewSpec 不是 LLM 生成的。**

```
模型  →  只选 tool + 填参数        ← 不可信,Zod 校验(AI SDK 自动做,失败自动重试)
我们的代码 → 查完 ClickHouse 后构造 viewSpec  ← 可信,TypeScript 编译期保证
                ↓ JSON 序列化过 Trigger.dev streams
浏览器  →  收到 `unknown`            ← 唯一需要运行时校验的地方
```

所以 `tile-renderer.tsx` 里那句 `ViewSpec.safeParse(part)` 防的**不是幻觉**,而是**版本漂移**
—— 你部署了新版 task,但用户浏览器里还是旧的 bundle,收到一个不认识的 tile。没有这句就是白屏,
有了就是一张"Can't render this tile"的红框卡片。

**Zod 是白拿的** —— 它本来就是 `@trigger.dev/sdk` 和 `@ai-sdk/anthropic` 的 peer dependency。

**一份 schema 两处用:**服务端 `z.infer` 出类型来构造,客户端 `safeParse` 来收。

### 3.2 `satisfies` —— 已证明能防白屏

`tile-renderer.tsx` 里这行:

```ts
} satisfies Record<ViewSpecKind, ComponentType<any>>;
```

**我实测验证过了**,不是纸上谈兵。做法:临时给 `ViewSpec` 加一个 `choropleth` kind、故意不写渲染器,
然后跑 typecheck:

```
error TS1360: Property 'choropleth' is missing in type '{ verdict: ...; timeseries: ...; }'
              but required in type 'Record<"choropleth" | "verdict" | ... , ComponentType<any>>'
```

**构建直接失败。**这意味着:以后你(或我)加了新 tile 却忘了写渲染组件,`npm run build` 当场报错,
而不是等到录 demo 时白屏。用一个关键字换掉一整类 bug。

> 想自己验证的话:照上面的步骤改一下 `view-spec.ts`,跑 `npm run typecheck`,看到报错再改回来。

### 3.3 fixture gallery —— solo 开发唯一能"并行"的地方

`/gallery` 不接 LLM、不接 ClickHouse,纯静态数据。这带来四件事:

1. **顺序解耦** —— 视觉层不用等 agent。一个人开发,这是唯一的并行方式。
2. **迭代快** —— 调样式不用每次跑模型和查询。
3. **测试面** —— 每个 kind 一个 fixture,天然是快照测试的基础。
4. **demo 保险** —— 录视频当天模型抽风,视觉层照样活着。

**最重要的是它对冲了 Risk 1:**如果明天 `chat.agent()` 攻坚翻车,你手上仍然有一个能跑的东西,不是零。

**fixture 里的数字全是真的** —— 7月17日从 playground 查的。这是刻意的:gallery 就是 demo 的彩排,
假数据会掩盖排版问题。而且真数据自带故事:

- **Lambeth 2020 见顶 £567,750,之后一路阴跌到 2025 的 £526,890** —— timeseries 图一眼看懂
- **Havering +17.9%(绿)紧挨着 Lambeth −7.2%(红)** —— 这就是 demo 高潮
- **分布图右偏,中位数虚线明显在众数右边** —— 这张图本身就证明了"为什么必须用中位数而不是平均数",
  一个字都不用写

---

## 4. 偏差记录(实现过程中与计划不符的地方)

### ✅ 4.1 官方 skills 没覆盖 `chat.agent()` —— 但我当时的结论是**错的**,Risk 1 其实**下降**

> **本节已于 7/17 晚修正。**留着原始判断和修正过程,因为犯错的过程本身有价值。

**我当时观测到的(仍然成立):**skills 里搜 `chat.agent` / `sdk/ai` / `toStreamTextOptions` /
`useTriggerChatTransport` —— **全部 0 命中**。`trigger-agents` 讲的是老的 `/guides/ai-agents`
track(plain `task()` + `generateText`)。

**我当时下的结论(错了):**"Day 2 没有兜底,只能靠官方文档,Risk 1 上升。"

**实际情况:**官方文档**就在本地** —— Trigger.dev 把 **159 个 `.mdx` 打包进了 npm 包**:

```
node_modules/@trigger.dev/sdk/docs/          ← 159 篇
node_modules/@trigger.dev/sdk/docs/ai-chat/  ← 39 篇,专讲 chat.agent,含 13 个 patterns
```

覆盖度实测:

| 搜索词 | skills | **打包文档** |
|---|---|---|
| `chat.agent` | 0 | **47 个文件** |
| `useTriggerChatTransport` | 0 | **18** |
| `onAction` | 0 | **17** |
| `toStreamTextOptions` | 0 | **15** |
| `actionSchema` | 0 | **11** |

**所以真相是:Trigger.dev 把 chat.agent 的知识放在打包文档里,不是 skills 里。我查错了地方。**
这不是缺口 —— 反而是**比 skills 更好的来源**,因为它跟着你装的版本走,不会像网站或我的记忆那样过时。

**Risk 1 ⬇️ 下降。**Day 2 有版本精确的一手文档。

**这个模式值得记住 —— 三家都这么做:**

| 来源 | 位置 | 数量 |
|---|---|---|
| Trigger.dev | `node_modules/@trigger.dev/sdk/docs/` | 159 篇 |
| Next.js 16 | `node_modules/next/dist/docs/` | 423 个文件 |
| ClickHouse | `.agents/skills/` + `@clickhouse/client/skills/` | 17 skills |

**为什么会这样:**因为 LLM 的训练数据必然过时,这些公司开始把**版本精确的文档随包分发**。
Next.js 那句 "Read the relevant guide in `node_modules/next/dist/docs/`" 就是同一件事。
**以后先查 `node_modules`,再查网络,最后才轮到我的记忆。**已写进 `AGENTS.md`。

### 4.1b 拿打包文档验证了两个架构假设 —— 一对一错

既然文档在本地,我立刻验证了 Day 3/Day 4 依赖的两块基石。

**✅ HITL(消歧 tile)—— 假设完全正确,细节比我说的还好**

`ai-chat/patterns/human-in-the-loop.mdx` 原话:*"the building block is a tool with no `execute`
function"*。完全对。而且:

- 模型调用无 `execute` 的 tool → `streamText` 结束,tool call 停在 `input-available` 状态
- run 先热等 `idleTimeoutInSeconds`(默认 30s),然后**挂起并释放算力**
- **用户思考时间不计费,且不消耗 `maxDuration`** —— 文档说用户可以花几分钟、几小时甚至几天
- 前端用 `addToolOutput({ tool, toolCallId, output })` 唤醒
- AI SDK 会自动复用同一条 assistant message ID,所以恢复后是**合并好的完整消息**

**⚠️ Actions(下钻)—— 我理解偏了,但结论仍然成立**

我在计划里说"下钻就是 action,`onAction` 是为这个而生的"。**不准确。**文档说 actions 的设计目的是
*"mutate chat state — undo, rollback, edit, regenerate"*,是**改对话状态**,不是"跑一个查询"。

但关键的一句救了这个设计:**"returning void → side-effect-only, no model call"**。
所以下钻可以这样做:前端 `transport.sendAction(chatId, {...})` → `actionSchema` 用 Zod 校验 →
`onAction` 里跑 ClickHouse 查询 → 推 tile → **返回 void,不调模型**。

**结论不变(下钻不走 LLM、亚秒、同一个 run),但我描述的理由是错的。**这个区别在 Day 4 会变得重要 ——
我们是在借用 action 机制,不是在用它的设计初衷,所以边界情况要自己测。

**意外收获:**`chat.history.getPendingToolCalls()` 可以在**消歧未决时挡住竞争性 action** ——
正好防止用户在 Clapham 还没选完时乱点下钻。这个我没想到,文档送的。

### ⚠️ 4.2 Next.js 16 自己警告"你认识的 Next.js 已经变了"

`create-next-app` 自动生成了 `AGENTS.md`,内容是:

> **This is NOT the Next.js you know.** This version has breaking changes — APIs, conventions,
> and file structure may all differ from your training data. Read the relevant guide in
> `node_modules/next/dist/docs/` before writing any code.

**我保留了这个文件**(以及指向它的 `CLAUDE.md`),因为它是对的。

这是今天**第三次**撞到同一个模式:`chat.agent()` 才 15 天、AI SDK 的 dist-tag 陷阱、现在 Next 16。
**结论:这个项目的整个技术栈都比我的训练数据新。**我会持续以文档和实测为准,而不是记忆 —— 你今天
逼我去查 Trigger.dev 文档那次,直接改写了整个架构,这个习惯要保持。

### 4.3 图表库:决定**手写 SVG**,不用 Recharts

- **理由:**图表种类少且固定;完全可控;少一个依赖少一个风险;Next 16 + React 19 下第三方图表库
  是 hydration bug 的常见来源(见 4.2 的警告)。
- **代价:**以后要做复杂交互(缩放、tooltip 跟随)会比 Recharts 费事。
- **反悔成本:**低。viewSpec 是纯数据,换渲染实现不影响契约 —— 这正是契约设计的好处。

### 4.4 `.gitignore` 的 `.env*` 会把 `.env.example` 一起吞掉

create-next-app 默认的 `.gitignore` 里是 `.env*`,这会导致**该提交的模板文件也被忽略**。
已加 `!.env.example` 修复,并实测确认:`.env.example` 会提交、`.env.local` 仍被忽略。

### 4.5 其他小偏差

| 偏差 | 处理 |
|---|---|
| `create-next-app --no-git` 无效,仍然 init 了 git | 在 scratchpad 生成后搬运,排除了 `.git` |
| skills 装到 `.agents/skills/` 再 symlink 到 `.claude/skills/`,而非直接装 | **比预期好** —— 自动就是项目级,没污染你的全局 `tx-skills/` |
| React 装到 19.2.4(不是最新的 19.2.7) | 无影响,仍满足 `@ai-sdk/react@ai-v6` 的 `^19.2.1` |
| npm 报 22 个漏洞(1 个 high:`ws`) | **改不了**。来自 `@trigger.dev/react-hooks → core → socket.io-client → engine.io-client → ws@8.17.1`,是 Trigger.dev 自己的依赖链。`npm audit fix` 无效,强行 override 可能搞坏 socket.io。**记录,不阻塞。** |
| 浏览器 pane 滚动后截图白屏 | 工具问题,不是应用问题 —— `get_page_text` 证明内容完好 |

---

## 5. 测试 —— 进入 Day 2 之前

### 5.1 我已经跑过的(附结果)

| # | 测试 | 结果 |
|---|---|---|
| 1 | `npx tsc --noEmit` | ✅ 通过 |
| 2 | `npx eslint src` | ✅ 通过 |
| 3 | React 版本交集(`^18 \|\| ~19.0.1 \|\| ~19.1.2 \|\| ^19.2.1` vs 19.2.4) | ✅ 满足 |
| 4 | 依赖配对(dist-tag 是否真的解决了 majors 对不上) | ✅ `ai@6.0.229` ↔ `@ai-sdk/react@3.0.231` ↔ `@ai-sdk/anthropic@3.0.97` |
| 5 | **`chat.agent` 能否 import** | ✅ 全部关键 API 存在(37 个成员) |
| 6 | **`satisfies` 能否抓住遗漏的渲染器** | ✅ 已证明报错(见 §3.2) |
| 7 | gallery 渲染全部 5 种 tile | ✅ |
| 8 | **malformed fixture → BrokenTile** | ✅ 正确落到红框,错误信息清晰 |
| 9 | 点击 comparison 行 | ✅ `comparison → district=HAVERING` |
| 10 | 点击 disambiguation chip | ✅ `disambiguation → district=LAMBETH` |
| 11 | `.env.local` 是否被 git 忽略 | ✅ 忽略(密钥安全) |

### 5.2 🙋 需要**你亲自做**的(验收标准是"你理解")

> dev server 已经在跑。打开 **http://localhost:3000/gallery**

**A. 看 —— 这五张卡片说服你了吗?**

1. **comparison** —— Havering +17.9% 绿、Lambeth −7.2% 红。
   **问自己:**如果这是一段文字,你还能一眼看出这个反差吗?(这是全场 demo 的核心论点)
2. **distribution** —— 看那条黄色的 median 虚线,和它右边的长尾。
   **问自己:**你能不能只指着这张图,就跟评委解释清楚"为什么我们全程用中位数不用平均数"?
3. **timeseries** —— Lambeth 2020 的那个尖顶。
4. **verdict** —— **这是全产品唯一的文字**。如果它哪天长成了一段话,我们就跑题了。
5. **malformed** —— 最下面那个红框。这是 `safeParse` 边界在工作。

**B. 动手 —— 点一下**

- 点 comparison 里任意一行 → 顶部应该出现 `comparison → district=XXX`
- 点 Clapham 的任意一个选项 → 应该出现 `disambiguation → district=XXX`

**这两个回调就是 Day 4 下钻功能的接口。**现在它们只是打印;Day 4 会接到 `onAction` 上。

**C. 理解检查 —— 你能回答这三个问题吗?**

1. 为什么 viewSpec 的运行时校验**只**放在客户端一处,而不是每一层都校验?
   <details><summary>参考答案</summary>因为 viewSpec 是我们自己的代码构造的,不经过模型,不可能被幻觉污染。唯一不可信的边界是 JSON 过网络到浏览器(版本漂移),所以只在那里 safeParse。</details>
2. 如果我明天加一个 `choropleth` tile 但忘了写渲染组件,会发生什么?
   <details><summary>参考答案</summary>`npm run build` / typecheck 当场报错(`Property 'choropleth' is missing`),不会到运行时才白屏。靠的是 registry 上的 `satisfies`。</details>
3. 为什么 fixture 要用真数据而不是随便编的?
   <details><summary>参考答案</summary>gallery 是 demo 的彩排;假数据会掩盖真实的排版和分布问题(比如右偏的长尾)。而且真数据自带故事。</details>

**D. 如果哪一条你觉得"我讲不出来"** —— 直接告诉我,那是我的问题不是你的,我会重讲或者重写。

### 5.3 🔑 需要你提供的(否则 Day 2 走不动)

1. **`.env.local`** —— 复制 `.env.example`,自己填。**别把值贴给我**(会进对话记录),你自己写文件就行。
   需要:ClickHouse Cloud 的 URL / user / password、Trigger.dev 的 project ref / secret key、Anthropic API key。
2. **确认 LICENSE 署名** —— 我写的是 `Copyright (c) 2026 Trish Xie`。**这是我猜的**,要改告诉我。
3. **git commit 的建议** —— 我按规矩没有替你 commit。但有个论点值得考虑:
   规则要求"所有代码必须在 7/17–7/23 窗口内写",而 **git history 恰好是这件事最好的证据**。
   越早开始 commit,证据链越干净。要不要我帮你 commit?

---

## 6. 下一步

**Day 2 计划:**`chat.agent()` 攻坚 + `useTriggerChatTransport` + 一个真的 ClickHouse tool + Streams v2。
收尾于:**打字提问 → agent 选 tool → 真图流进来**(整个产品的瘦版本)。

**阻塞项:**

- 🔴 `.env.local`(见 5.3)—— 没有它 Day 2 动不了
- 🟡 ClickHouse 数据加载 —— 计划里的"长杆项"。今天没做,因为没凭证。
  Day 2 一开始就要启动,建议边加载边写 chat.agent(它不依赖数据)。

**风险变化:**

- Risk 1(chat.agent 太新)⬇️ **下降**(7/17 晚修正,原判断是上升)。三个理由:
  1. 核心 API 已实测存在(§5.1 测试 5)
  2. **159 篇版本精确的官方文档就在 `node_modules`**,39 篇专讲 ai-chat(§4.1)
  3. gallery 已经把最坏情况兜住了(§3.3)
  另外 HITL 假设已用文档验证为正确,actions 虽然理解有偏差但方案成立(§4.1b)。
- Risk 2/3/4/5 无变化。
