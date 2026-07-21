# Architecture V3 — 同一 source 内的多表与关系，走向可开源产品

**状态：已评估，已决定方向，暂缓实现（parked）**
**日期：2026-07-21**
**前置：**V2 多源支线切片 1–5a 已完成（见 [`IMPLEMENTATION.md`](../IMPLEMENTATION.md)）

## 1. 一句话

> 一个 Source Pack 可以声明同一数据库下的多张表及其 many-to-one 关系；
> 关系由语义层解析成 JOIN，planner 与 LLM 契约完全不变。

V3 的 MVP：使用者接入**一个数据库**，其下**多张表**，表间关系与指标全部由语义层解析。
这比 V2 略大——V2 §3 明确「不做动态 JOIN」、§4 限定「单事实关系」；V3 在**单个 pack 内部**
放开声明式 JOIN，但**跨 pack JOIN 仍然禁止**（V2 不变量 9 不变）。

## 2. 现状盘点（V3 评估时点）

MVP 的三个组成部分处于三种状态：

1. **「接入一个数据库」——已完成。**连接来自 env；每个 pack 拥有自己的
   `database`/`table`（b28371c 修复后 pack 声明为权威）；切片 5a 证明结构完全不同的
   pack 零 core 改动即可运行。
2. **「同库多张表」——已完成，带一个限制。**注册 N 个 pack 指向同库 N 张表没有任何
   障碍；限制是**一个问题不能横跨两张表**。
3. **「关系由语义层解析」——唯一真正的新工程。**当前每个 `SemanticModel` 是单关系：
   compiler 只输出 `FROM {database}.{table}`，所有表达式默认属于这一张表
   （`clickhouse-adapter.ts` 的 SQL 组装段）。代码里不存在 JOIN 概念。

## 3. 两条路线

### Option A：JOIN 放在数据库层（视图），引擎零改动 — **V3 的 v0**

Pack 的 `table` 指向一个 ClickHouse **VIEW**，视图 SQL 作为 `schema.sql` 随 pack 目录
发布。「多表 + 关系」当天可用：关系由 pack 作者用 SQL 声明——这与整体设计一致
（**人写 SQL，LLM 永远不写**）。V2 §9「跨源分析先在 ClickHouse 建受治理的分析关系」
已经预留了这条路。

### Option B：SemanticModel 内声明式 JOIN（约 3–4 个切片）— V3 的正题

```
joins: [{ table, alias, on, relationship: "many_to_one" }]
```

- 维度/指标表达式可引用别名列；
- compiler 只输出请求实际需要的 JOIN（join pruning）；
- **planner 与 LLM 契约完全不变**——JOIN 是编译细节，这正是现有架构的红利；
- member resolver 需感知 JOIN（leaf 与 ancestors 跨表时），但在星型约束下
  层级通常在同一张 lookup 表里，问题基本自动消失。

### Option B 的硬约束：只允许 many-to-one（星型）

**Fan-out 是语义层的经典深坑：**one-to-many JOIN 会让每个 `count()` 静默重复计数、
让 sum 膨胀——Cube.dev 和 dbt 为此建了整套 symmetric aggregates 机制。V3 的安全裁剪：

- **只允许 fact → lookup 的 many-to-one JOIN**，注册时校验并拒绝其它关系；
- 该约束下聚合数学天然正确，不需要任何聪明机制；
- 放开任意关系 = 重造 Cube.dev，明确不做（延续 V2 §3 的克制）。

## 4. 开源化的打包缺口（不难，但是实活）

1. **注册时校验（约 1 切片）：**类型只管编译期；语义坏掉的 pack（指标引用不存在的列、
   resolver 指向不存在的维度）今天要到查询时才炸。开源需要 Zod schema + 交叉引用检查，
   启动时大声失败，报错信息陌生人能看懂能行动。
2. **Pack 编写指南 + 模板（约 1 切片，以写作为主）：**`sources/_template/` 目录 + README，
   讲清 measures / valueFields 语法 / dimensions / memberResolvers / promptHints。
   切片 5a 的合成 transit 源已经是模板的 80%。
3. **通用 golden-question harness（约 1 切片）：**即 5b 的机制泛化，让 pack 作者用自己的
   数据冒烟测试自己的 pack。
4. **信任边界加固（约 1 切片）：**`clientData.sourceId` 目前是 `z.custom`、无运行时校验；
   使用者变成陌生人后，暂缓的 hallucination-hardening 项（sealed planId、Figure
   Registry、evidence verdict）价值上升。
5. **仓库卫生：**LICENSE、面向开源受众的 README、secrets 审计、CI、以及
   Trigger.dev + Anthropic key 的安装摩擦文档——**这是最大的采纳门槛**（跑起来就需要
   Trigger 账号），必须写清楚。

## 5. 明确不做（V3 追加）

- 不做 one-to-many / many-to-many JOIN，不做 symmetric aggregates。
- 不做跨 Source Pack 的 JOIN（V2 不变量 9 不变）。
- 不做多 dialect / 「自动连接任何数据库」（V2 §3 不变）。
- 不做运行时插件加载；pack 仍是编译期注册的可信代码（dbt / Cube 亦如此）。

## 6. 规模与顺序

在既有切片节奏下约 **6–8 个切片**，前提是接受星型约束：

1. **2026-07-23 前不动 compiler。**Demo 跑已提交的版本。
2. Hackathon 后第一周：打包缺口（校验、模板、harness、卫生）+ 把 **Option A 视图**
   作为多表故事写进文档发布。
3. 再根据早期用户真实问题，决定 Option B 声明式 JOIN 是否配得上它的复杂度。

## 7. 已知风险（非代码）

**Option B 无法只靠合成测试验收：**合成测试能证明 SQL 形状，证明不了 fan-out 数学
诚实。JOIN 工作必须等一份**有已知正确答案的真实多表数据集**——与 5b 等同一份数据，
这也是 park 的直接原因之一。

## 8. 验收（沿用 V2 §16.5 的口径）

- 一个声明了 2+ 张表和 many-to-one 关系的新 pack：agent、pipeline、figure 代码零修改。
- 注册一个声明 one-to-many 关系的 pack：启动时被拒绝，报错可读。
- 同一问题在单表 pack 与视图 pack（Option A）上答案一致——JOIN 是编译细节的证明。
