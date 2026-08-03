# compiler/ · 双向编译器参考实现

本象协议的核心机制（见 [docs/04-架构设计](../docs/04-架构设计.md) 第二节）。**可运行，有自测。**

```bash
node compiler/selftest.mjs     # 27 项，跨两个领域
```

## 两侧

| 文件 | 侧 | 职责 |
|---|---|---|
| [`context-compiler.mjs`](context-compiler.mjs) | 输入 | 按任务与预算，把本象投影成 AI 此刻**该看见的**上下文 |
| [`commit-compiler.mjs`](commit-compiler.mjs) | 输出 | 解析语义事务 → 校验 → 折叠状态 → 逐字段留存来源 |
| [`constraints.mjs`](constraints.mjs) | 判定 | 领域无关的约束谓词（协议里唯一「判对错」的地方） |
| [`origin.mjs`](origin.mjs) | 加载 | 读 `.origin` 包为内存中的世界 |

## 一个完整回合

```js
import { loadOrigin, compileContext, buildPrompt,
         normalizeTransaction, validateTransaction, applyTransaction } from './compiler/index.mjs'

const origin = loadOrigin('spec/examples/sales-2026.origin')
const ctx    = compileContext({ origin, task, budget: 6000 })   // 投影出该看见的
const tx     = JSON.parse(await llm(buildPrompt(ctx)))          // AI 只交语义事务，不交终态
const norm   = normalizeTransaction(tx, origin.ids)
const res    = validateTransaction({ tx: norm, stateBefore: origin.state, constraints: origin.constraints })

if (!res.ok) return retry(res.violations)                       // 带证据退回重写
const { state, provenance } = applyTransaction({ tx: norm, state: origin.state })
```

## 为什么约束是数据而不是代码

这是「本象是不是一个协议」的分水岭。

ShadowBench-W 的实验臂里，约束是三个写死的类型——`field_must_stay` / `knows_must_not_gain` / `hook_must_stay`——名字里就带着小说味：`knows`、`hook` 是叙事概念。销售数据那边是另一套（`revenue must_not_be_negative`）。**若每个域各写各的校验器，那不是协议，只是若干个碰巧长得像的程序。**

这里收敛成一组小而完备的谓词：

```
equals · not_equals · contains · not_contains · range · unchanged
```

三个小说专用类型全部可以表达，且不需要任何新代码：

| 原领域专用类型 | 通用谓词 |
|---|---|
| `field_must_stay` | `{ type: 'equals', object, field, value }` |
| `knows_must_not_gain` | `{ type: 'not_contains', object, field: 'knows', value }` |
| `hook_must_stay` | `{ type: 'equals', object: '<hook-id>', field: 'status', value }` |
| `revenue 非负` | `{ type: 'range', object, field, min: 0 }` |

`selftest.mjs` 用**同一份代码、零改动**同时跑通销售数据与叙事世界，就是为了守住这条线。

## 无机器判定的约束不会被静默放行

只有自然语言描述、没有 `check` 字段的约束，会被显式报为 `unenforceable` 警告。静默跳过它们更危险——那会让「有约束」的假象掩盖「没人校验」的事实。

## 三条用代价换来的接口教训

均来自 ShadowBench-W 的真实运行，`selftest.mjs` 有回归保护：

1. **ID 必须自带归一化层。** 模型极易漏掉命名空间前缀（写 `black-key` 而非 `obj:black-key`），语义上毫无歧义，用严格匹配判为「未知对象」纯属接口刁难——曾致整章作废。
2. **前值对不上只能警告，不能拦截。** 运行时本就知道当前值，要求模型精确复述旧值是刁难；曾按错误处理，一次运行废掉 3 章。降级为警告并计入指标——「模型记忆偏差率」本身是有价值的观测量。
3. **给模型看的格式就是它会模仿的格式。** 曾为「好读」把 ID 前缀剥掉渲染，模型照抄了那份写法，交上来的事务全被门禁判为未知对象，5 章全废。**可读性优化必须让位于可回传性。**

## 与实验臂的关系

[`benchmark/shadowbench-w/arms/a3-benxiang/`](../benchmark/shadowbench-w/arms/a3-benxiang/) 是这套机制在叙事域的实测版本，取得 W3 状态准确率 **98.9%**（对照：裸模型与向量 RAG 均为 75.0%，标准差 0，见 [实验记录](../benchmark/shadowbench-w/results-log.md) Run #14）。本目录是从中抽出的领域无关内核；实验臂尚未改为依赖它，两者暂时并存——**先证明抽象成立，再动已在产出数据的代码。**
