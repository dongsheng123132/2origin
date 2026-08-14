# Benxiang Quant Dialect · 本象量化方言

> **状态：v0.1-draft，公开评测中。**
>
> 它不是荐股模型，也不承诺 Alpha。它保存交易系统当时看见的世界、提交的意图、风控决定、
> 委托与成交回报，并检查这些状态在重复、乱序和重启之后还能不能闭合。

[协议草案](RFC.md) · [公开评测邀请](CALL-FOR-REVIEW.md) · [合成交易日](fixtures/synthetic-day/events.jsonl) · [JSON Schema](schemas/)

## 一句话

> 模型可以犯错，但错误不能直接变成订单；每一笔成交都必须有来处。

模型只允许产生 `trade.intent`。`risk.decision` 必须来自确定性闸门；订单与成交只能由券商或
合成驱动产生。当前仓库**没有任何真实券商写接口**。

## 直接运行

Node.js ≥ 18，零依赖：

```bash
npm run test:quant
node adapters/quant/benchmark.mjs
node adapters/quant/replay.mjs adapters/quant/fixtures/synthetic-day/events.jsonl
```

- `selftest.mjs`：形状、重放、幂等、闭合与负向场景自测；总数以命令实际输出为准。
- `benchmark.mjs`：逐场景输出机器可读 JSON，任何判据没命中即退出码 1。
- `replay.mjs`：stdout 只输出 JSON 报告，stderr 只输出错误，适合被其他 Agent 或 CI 调用。

## 现在测什么

公开夹具是一段真 Alpha 严格未知、但交易状态真值完全已知的合成交易日。故障注入器会制造：

| 场景 | 必须观察到的结果 |
|---|---|
| 重复回调 | 重复被计数，业务状态哈希不变，持仓不重复增加 |
| 乱序到达 | 完整事件集重放后收敛到同一状态哈希 |
| 陈旧行情 | `APPROVE` 被判为 `UNSAFE_RISK_APPROVAL` |
| 幽灵订单 | 找不到 TradeIntent 的订单被判 `GHOST_ORDER` |
| 持仓分歧 | 推导持仓与券商快照不等时列出逐证券差额 |
| 冲突重复 | 同 event_id 不同内容全部隔离，不猜哪条是真的 |
| 部分成交中断 | 没有终态与账户快照时必须保留 `UNRESOLVED` |

健康场景也必须存在；一个只会报错的检查器与一个把所有输入都拒绝的检查器一样没有价值。

## 最欢迎怎样攻击

量化研究员、交易系统工程师、风控人员、QMT/XtQuant 用户可以直接提交最小反例：

1. 一组事件让相同成交被记仓两次；
2. 同一完整事件集因到达顺序不同得到不同状态哈希；
3. 没有 TradeIntent 的订单没被抓住；
4. 已过期行情仍能穿过最小风控闸门；
5. `FILLED / CANCELLED / REJECTED` 之后还能静默改终态；
6. 交易闭合率、幽灵订单率或持仓分歧指标定义不合理；
7. 某家券商的真实回报语义无法映射到当前事件契约。

开 issue 时请附：最小 JSONL、实际输出、预期输出，以及你认为哪个不变量被破坏。脱敏时不要提交
账号、姓名、资金规模、策略秘密或券商凭据。

## 明确不做什么

- 不预测涨跌，不提供投资建议，不比较策略收益。
- 不接 QMT 实盘，不保存账号凭据，不提供自动报单入口。
- 不把撤单请求称为回滚：请求可能失败，也可能在确认前继续成交。
- 不声称“baseline 持仓 + 成交”覆盖公司行动、申赎、行权、结算、划转或多账户。
- 不声称通过本方言校验等于满足监管或券商要求。
- 不把合成夹具上的全绿当成真实市场有效性证据。

下一阶段才是 **QMT Shadow Recorder**：只读采集脱敏行情、资产、委托与成交回报，转换成同一事件
契约再离线重放。写通道必须另行评审，不会从 Recorder 顺手打开。

## 规则背景

中国证监会将通过计算机程序自动生成或者下达交易指令纳入程序化交易管理，并要求履行
“先报告、后交易”；交易所实施细则进一步覆盖报告、交易行为、系统与风险管理。这里仅记录公开
规则背景，不构成对任何账户的合规意见：

- [证监会：《证券市场程序化交易管理规定（试行）》](https://www.csrc.gov.cn/csrc/c100028/c7480577/content.shtml)
- [上交所：《上海证券交易所程序化交易管理实施细则》](https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20250612_10781696.shtml)
- [迅投知识库：XtQuant 交易模块](https://dict.thinktrader.net/nativeApi/xttrader.html)
