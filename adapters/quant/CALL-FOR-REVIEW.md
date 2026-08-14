# 本象量化方言 v0.1 开启公开评测

我们不发布荐股策略，也不承诺 Alpha。

第一阶段只研究一件事：当行情过期、回报重复或乱序、程序中断、订单部分成交、账户状态发生冲突时，
AI 交易系统能不能保持账本真实、拒绝重复执行，并把失败闭合。

现在公开的是：

- TradeIntent、OrderEvent、FillEvent JSON Schema；
- 一个状态真值已知的合成交易日；
- 确定性重放与持仓对账器；
- 重复、乱序、陈旧行情、幽灵订单、持仓分歧、冲突重复、部分成交中断故障集；
- 机器可读的能力边界与一键自测。

```bash
npm run test:quant
node adapters/quant/benchmark.mjs
```

欢迎量化研究员、交易系统工程师、券商接口开发者、风控人员和 QMT/XtQuant 用户来攻击它。

最有价值的贡献不是增加策略，而是提供一个最小反例：

- 相同成交被记仓两次；
- 相同事件集重放出不同状态；
- 没有 TradeIntent 的订单没被发现；
- 陈旧行情仍被批准；
- 已经终态的订单又静默变了；
- 系统显示已闭合，真实账户却对不上；
- 当前状态机无法表达某家券商真实存在的回报。

本版本没有券商写接口，不保存账号凭据，不提供投资建议。真实夹具请先脱敏：不要提交账号、姓名、
资金规模、策略秘密或任何 token/key。

> 模型可以犯错，但错误不能直接变成订单；每一笔成交都必须有来处。

项目入口：[`adapters/quant/`](README.md)

---

## Short English call

**Benxiang Quant Dialect v0.1-draft is open for falsification.** It is not an alpha model and it
contains no live broker write path. We publish schemas, a synthetic trading day, deterministic
replay/reconciliation, and fault injection for duplicates, reordering, stale data, ghost orders,
position divergence, conflicting duplicates, and interrupted partial fills. The most valuable
contribution is a minimal event sequence that makes the ledger look correct when it is not.
