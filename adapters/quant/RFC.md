# RFC · Benxiang Quant Dialect v0.1-draft

- 状态：Draft / Call for Falsification
- 日期：2026-08-14
- 位置：本象协议的领域方言，不进入 Origin IR 核心
- 首版模式：`replay` 与合成事件；无券商写接口

## 1. 问题

量化系统最容易展示的是一条漂亮收益曲线，最难证明的是曲线背后的状态有没有说谎：

- 同一成交回调是否被执行两次；
- 报单超时后，券商到底有没有收到；
- 部分成交后程序重启，本地仓位能否恢复；
- 当前行情、策略和组合引用是否仍然新鲜；
- 本地推导仓位与券商快照发生分歧后，系统是否承认；
- 一笔盈亏能否追到策略版本、市场快照、TradeIntent、风险决定、订单和成交。

本 RFC 不回答“买什么”，只回答：**当判断要变成交易时，状态能否被重放、校验、拒绝和追责。**

## 2. 可证伪主张

在事件契约覆盖的范围内，给定同一完整事件集合：

1. 到达顺序不会改变最终业务状态哈希；
2. 完全相同的重复事件不会重复改变仓位；
3. 同 event_id 的不同内容不会被任选一个继续执行；
4. 每笔订单必须引用已存在的 TradeIntent 与 APPROVE；
5. 每笔成交必须引用订单和 TradeIntent，方向与证券一致；
6. 推导持仓必须能与账户快照逐证券对账；
7. 不到终态的意图必须保留 `UNRESOLVED`。

任何一个最小反例都能推翻对应主张。合成夹具全绿只证明代码符合这份自定契约，不证明契约覆盖
真实券商，更不证明策略有收益。

## 3. 五概念自检

| 本象概念 | 量化方言中的对象 |
|---|---|
| 对象 | 证券、组合快照、TradeIntent、风险决定、订单、成交 |
| 引用 | 数据源指纹、事件时间、接收时间、序列号、水位、策略 commit、组合版本 |
| 投影 | 订单账本、预期持仓、券商持仓、对账报告、交易日 Episode |
| 事务 | 模型只提交 TradeIntent；外部事件以追加语义进入事件账本 |
| 校验 | 形状、引用、新鲜度、版本、幂等、生命周期、成交合计与持仓对账 |

五行均能落到既有“对象/引用/投影/事务/校验”，因此这是方言，不是第六个核心概念。

## 4. 真相源与引用

| 事实 | 真相源 | 本象中保存什么 |
|---|---|---|
| 行情 | 指定行情源 | snapshot ID、源、时间、水位、价格与过期时间 |
| 组合 | 券商账户快照 | snapshot ID、version 与脱敏持仓 |
| 策略 | 版本库或内容寻址存储 | `strategy_ref`，不复制策略正文 |
| 风控 | 确定性 Risk Gate | decision、原因与 checked refs |
| 委托/成交 | 券商回报 | broker sequence、业务 ID、状态与数量 |

`received_at` 不能代替 `occurred_at`，本地事件序号也不能冒充券商序号。不同源之间没有凭空假设的
全局时钟；跨源关系靠稳定业务 ID 和显式引用闭合。

## 5. 事件信封

所有事件共享：

```json
{
  "event_id": "evt-fill-1",
  "kind": "fill.event",
  "occurred_at": "2026-08-14T09:30:07.000+08:00",
  "received_at": "2026-08-14T09:30:07.050+08:00",
  "source": {
    "system": "synthetic-broker",
    "stream": "broker",
    "sequence": 3
  },
  "payload": {}
}
```

v0.1 登记六类事件：

- `market.snapshot`
- `portfolio.snapshot`
- `trade.intent`
- `risk.decision`
- `order.event`
- `fill.event`

公开形状见 [`schemas/`](schemas/)，零依赖执行闸门见 [`dialect.mjs`](dialect.mjs)。JSON Schema 管形状，
重放器管跨事件语义；两者不能互相冒充。

## 6. TradeIntent 与最小风险闸门

TradeIntent 必须固定：策略引用、行情快照引用、组合快照及 version、证券、方向、数量、过期时间与模式。

最小闸门只判断所有实现都必须拒绝的条件：

| 条件 | 决定 |
|---|---|
| `mode=live` | `REQUIRE_HUMAN`（draft 禁止实盘） |
| 行情快照不存在 | `STATE_CONFLICT` |
| 组合快照不存在或 version 不符 | `STATE_CONFLICT` |
| 行情或意图已过期 | `EXPIRED` |
| 行情证券与意图不一致 | `STATE_CONFLICT` |
| 上述均通过 | `APPROVE` |

宿主风控可以更严格地 `REJECT` 或 `REQUIRE_HUMAN`，不能在最小闸门拒绝时反向 `APPROVE`。

## 7. 订单终态与 effect 语义

订单状态：

```text
SUBMITTED → ACKNOWLEDGED → PARTIALLY_FILLED → FILLED
                         ↘ CANCEL_REQUESTED → CANCELLED
SUBMITTED / ACKNOWLEDGED → REJECTED
```

现实中回调可以缺失、重复和乱序，所以 reducer 不把这张图当成“每条边都必须出现”；它只强制：

- broker sequence 不得互相冲突；
- 累计成交量不得减少或超过意图数量；
- `FILLED` 数量必须等于意图数量；
- 终态之后不能静默跳到另一个终态；
- 成交回报合计必须与订单累计成交一致。

`rollback` 在交易里不是一个诚实的统一词：

| 状态 | `effect_semantics` | 含义 |
|---|---|---|
| 已报、零成交 | `cancel_may_be_attempted` | 只能请求撤单，不能保证成功 |
| 部分成交 | `compensatable_partial` | 剩余可尝试撤，已成交部分只能另发补偿交易 |
| 完全成交 | `compensatable` | 原成交不可抹除，只能用新交易改变风险暴露 |
| 拒绝/零成交撤单 | `terminal_without_fill` | 已到无成交终态 |

补偿交易是新的 TradeIntent、风险决定、订单和成交，不得修改或删除原事件。

## 8. 重放、闭合与指标

重放器先按 `event_id` 去重，再按 `source.system + stream + sequence` 去重——重连后本地 Recorder
可能给同一上游回调换一个新 ID，不能因此重复记仓。完全相同的重复计数后保留一份；同一 ID 或同一
source coordinate 出现不同内容时全部隔离。随后按业务 ID 聚合实体，订单内部按 broker sequence
排序，从 baseline 持仓叠加可归因成交，再与最新 actual 快照对账。

首批指标：

- `closure_rate`
- `exact_duplicate_events`
- `source_duplicate_events`
- `divergent_duplicate_events`
- `ghost_orders`
- `orphan_fills`
- `stale_intents`
- `unsafe_risk_approvals`
- `position_divergences`
- `unresolved_intents`

指标不是产品 SLA。真实分母、观察窗口和账户覆盖范围尚未定义，故不得把合成夹具上的比率外推。

## 9. ShadowBench-Q 初始故障集

[`fault-inject.mjs`](fault-inject.mjs) 只修改输入，不把场景名称透露给重放器。公开基准当前包含健康
对照、重复、乱序、陈旧、幽灵订单、持仓分歧、冲突重复和部分成交中断。判据写在
[`benchmark.mjs`](benchmark.mjs)，不是跑完之后看结果再讲故事。

## 10. 边界与发布闸门

机器可读边界由 `quantLimits()` 返回，至少包括：无 Alpha 主张、仅合成数据、无券商适配、撤单不是
回滚、非合规认证。

进入下一阶段前必须同时满足：

1. 公开 Schema、合成交易日和故障注入器；
2. 健康场景零 error，所有负向场景各自击中预注册判据；
3. `npm run test:conformance` 仍全绿；
4. `git diff origin/main -- compiler/ spec/` 为空，证明方言没有反向撑大核心；
5. 真实账户信息与凭据不进入仓库。

QMT 只读 Recorder 是下一份 RFC。写通道、人工批准与实盘风险内核必须作为独立安全边界评审。

## 11. 公开征求反例

特别希望外部评审回答：

1. 哪些券商状态无法映射到当前订单状态集？
2. `broker_sequence` 在真实 QMT/XtQuant 回报里应由哪些字段组合而成？
3. 当前闭合定义会不会把某类“表面终态、实际待清算”的交易提前关账？
4. 以 baseline + fills 推导持仓，在哪些公司行动、费用、申赎、期权行权或跨日场景必然失真？
5. 哪个故障场景能让判据全绿但账仍然错？

如果答案是“很多”，那正是 draft 应该公开的原因。
