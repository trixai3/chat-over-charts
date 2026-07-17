# Day 2 开工前 —— 你需要做的事

> 预计 15–20 分钟。**只有第 1 步是硬阻塞**,其余可以边做边等。

---

## 好消息:你的凭证不会卡死我

Day 1 结束时我以为"没有 `.env.local` 就完全动不了"。查文档后发现不对 ——
`@trigger.dev/sdk/ai/test` 提供 **`mockChatAgent`**,文档原话:

> an offline harness that runs your `chat.agent` definition's `run()` function inside an in-memory
> task runtime — **no network, no task runtime, no mocking the SDK**

配合 `ai/test` 的 `MockLanguageModelV3`,意味着**整个 agent 逻辑可以零凭证开发和测试**:

| 不需要凭证(我可以先做) | 需要凭证(等你) |
|---|---|
| `chat.agent` 定义、tools、`toModelOutput` | 真实 ClickHouse 查询 |
| tool loop 的多轮行为 | 真实模型调用 |
| **"turn 2 才炸"那个 bug 的回归测试** | Trigger.dev dev server + Realtime |
| action / stop 信号 | 前端 transport 打通 |

所以你慢慢来,我不会干等。

---

## 🔴 1. Trigger.dev CLI 登录 —— 只有你能做

这一步会**开浏览器授权**,我做不了。

```bash
cd ~/ClaudeCode/projects/chatagent-bwt
npx trigger.dev@latest login
```

登录后在 dashboard 建一个 project(或用已有的),**记下 project ref**(形如 `proj_xxxxxxxx`)。

---

## 🟡 2. ClickHouse Cloud —— 确认服务活着

你说账号已经开好了。需要确认三件事:

1. **service 是否 running**(Cloud 会自动休眠,休眠的话点一下唤醒)
2. 从 **Connect** 面板抄出连接信息:host / port(8443)/ user / password
3. **建一个 database**:

```sql
CREATE DATABASE IF NOT EXISTS bwt;
```

> 数据加载(31M 行)是 Day 2 的长杆项,**我来做** —— 因为要顺便设计 ORDER BY key 和物化视图。
> 你只要保证 service 活着、database 存在就行。

---

## 🟡 3. 决定用哪个模型 key

你问过 OpenRouter,我还没等到你的动机。两条路:

| | OpenRouter | Anthropic 直连 |
|---|---|---|
| 装什么 | `@openrouter/ai-sdk-provider@2.10.0`(**必须 pin**,3.0 只配 ai@7) | `@ai-sdk/anthropic@ai-v6`(已装) |
| 好处 | 一个 key 随便换模型;你手上就有 | **prompt caching**:cache 命中只要 ~10% 输入价格 |
| 代价 | caching 能不能透传要实测 | 要单独申请 key |

**我的建议:两个都支持,用 env 变量切。**一个 15 行的 `getModel()` 而已。开发用 OpenRouter,
录 demo 前测一下哪个快。

**告诉我一句话就行:**你想用 OpenRouter 是因为手上有 key / 不想再申请 Anthropic?

---

## 🟡 4. 填 `.env.local`

```bash
cp .env.example .env.local
```

然后自己填。**⚠️ 别把值贴进对话** —— 会进聊天记录。你写文件就行,我不需要看见。

需要填:

- `CLICKHOUSE_URL` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE=bwt`
- `TRIGGER_PROJECT_REF`(第 1 步拿到的)
- `TRIGGER_SECRET_KEY`(dashboard → API keys)
- `ANTHROPIC_API_KEY` **或** `OPENROUTER_API_KEY`(看第 3 步怎么定)

已实测确认 `.env.local` 被 git 忽略,不会误提交。

---

## 🟢 5. 确认 LICENSE 署名

我写的是 `Copyright (c) 2026 Trish Xie` —— **这是我猜的**(从你的目录名推的)。
你的 git 身份是 `xct`。要改就说,现在改最省事。

---

## Day 2 会做什么

**目标:**打字提问 → agent 选 tool → 真图流进来。**整个产品的瘦版本。**

顺序:

1. 启动 ClickHouse 数据加载(长杆,后台跑)
2. **同时**写 `chat.agent` + 第一个 tool,用 `mockChatAgent` 离线测通
3. **必过测试:**连问三轮,断言 turn 2/3 的 prompt 里**没有 ViewSpec 的 JSON**
   (那个只在多轮时才炸的坑 —— 见 PLAN §5.3)
4. 接上真实 ClickHouse + 模型
5. 前端 `useTriggerChatTransport` + Streams v2 → tile 流进 UI

**Day 2 的风险:**`chat.agent` 是 15 天大的 API。但核心 API 已在 Day 1 验证存在,159 篇版本精确的
文档就在 `node_modules`,而且 `/gallery` 已经把最坏情况兜住了 —— 就算 agent 全崩,视觉层还活着。
