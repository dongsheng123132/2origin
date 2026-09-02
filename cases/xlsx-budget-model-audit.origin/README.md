# xlsx 公式体检案例：季度成本预算模型

对象：一份**自造但拟真**的季度成本预算模型（`假设` / `明细` / `汇总` / `说明` 四张表）。
**不是真实客户数据**——是为了同时展示「这个方言能查到什么」和「明知查不到什么」而手工搭的教学卷，
生成器在 `fixtures/make-case.mjs`，任何人都能重新跑出同一份 payload 来复核（不是我说了算，是命令说了算）。

## 可验证结论

- 原始 xlsx：SHA-256 `a2092d1a0d6595190b9790bcc284ffa5371c533b35da15a97f2096c7710254b8`。
- 本象对象：121（105 个数据格 + 11 个表头 + 4 个 sheet + 1 个 book）；关系：124；机器约束：13/13 可判定。
- `diagnose` 报出 **5 条 error + 2 条 warning**，逐条对应下表六类真实缺陷（D1–D6）：

| # | 缺陷 | 位置 | 判据 |
|---|---|---|---|
| D1 | 公式列混入硬编码常量 | `明细!D9`（应为 2363.5，被人填死成 2300） | `formula-column-purity` |
| D2 | 同列公式形状不一致 | `明细!F7`（引用错了一行：`=D7+E6`） | `formula-column-consistency`（**warning**，机器拿不准是不是故意的） |
| D3 | 求和漏行 | `明细!B14`（`SUM(B2:B12)` 漏了 B13） | `aggregate-covers-data` |
| D4 | 错误值残留 | `明细!G5`（`#DIV/0!`） | `no-error-values` |
| D5 | 悬空引用 | `汇总!B6`（引用了不存在的工作表"旧汇总"） | `no-dangling-ref` + `dangling-relation` |
| D6 | 文本型数字 | `明细!B4`（"110" 存成文本，SUM 会当 0） | `text-number` |

- 同一份文件里还埋了 **4 类本方言明确查不到的缺陷**（D7–D10），diagnose 里**一条都不出现**——这不是漏报，是设计：

| # | 缺陷 | 位置 | 为什么查不到 |
|---|---|---|---|
| D7 | 整列用错了列 | `明细!E2:E13` 整列本该乘税率（`假设!$B$2`）却乘了折扣率（`假设!$B$3`） | 形状全列一致、无错误值、数值合法——`xlsx-semantic-errors` |
| D8 | 数量级错误 | `假设!B5` 单价基准填成 1000（应约 10~20 元） | 值本身完全合法，机器分不出"错的多"和"对的大" |
| D9 | 文本粘贴到公式格 | `明细!D12`（整格是文本"见附注"，不是公式也不是数字） | 本方言只判"块内硬编码**数字**"，文字型故意不报（`xlsx-text-paste-undetectable`，51 份真表实测让假阳性从 310 降到 20） |
| D10 | 文本数字未被聚合覆盖 | `说明!C4`（"1,200"，不在任何 SUM 范围内） | 没人对它求和就没有危害，报了也没意义（248 例真表假警报的教训） |

- 依赖链深度 ≥3：`汇总!B3 → 明细!F14 → 明细!F2..F13 → 明细!D*/E* → 假设!B3`（52 个人工录入格子最终决定这个数，见 `projections/trace-汇总-B3.txt`）。
- 事务门禁：本包**当前拒绝任何 `origin commit`**——因为它本身违反 5 条约束（`checkConstraints` 校验的是整个 stateAfter，不是只看这次改了什么）。这是 fail-closed 设计的直接后果，不是 bug；`projections/stale-after-tx.json` 里那次"折扣率 0.05→0.06"的过期格演示，是用 `appendHistory` 手写的一条 `state_change` 记录，**不是真实 commit 落地的**（见该文件里的 `trigger.note`）。

## 可使用的宣传表述

> 这个方言不只是"读懂了一张静态表格"（cad 案例证明的是这个），
> 而是"读懂了一份会算的模型，并且知道改一个数之后哪些数变脏了"。

## 不能推出

- 这不是财务审计，不构成对任何真实预算模型正确性的背书——素材是自造的教学卷，不是真实业务数据。
- D7–D10 四类缺陷"查不到"是**已知且写进 `graph/limits.json` 的边界**，不是"以后会修"的承诺——修法需要接一个真正的公式引擎（语义错误/数量级）或先能区分"段标题"与"被粘贴的文本"（D9），当前都没有。
- 三条公式类规则（`formula-column-purity` / `formula-column-consistency` / `aggregate-covers-data`）**未在真实财务模型上验证过假阳性率**——已跑过的 51 份真表全是物流/报价/清单类，不含多层引用与情景假设的财务模型（见 `xlsx-formula-rules-unverified`）。
- 自己出的卷子考出 6/6 检出、0 个假警报，只能证明"改代码不会让检出变差"，不能证明"在陌生真实财务模型上也这么准"。

## 查看与复核

- `projections/health-report.md`：九节体检报告（含红点表、依赖追溯、假警报防线、边界清单）。
- `projections/diagnose.txt`：`origin diagnose` 原始输出。
- `projections/trace-汇总-B3.{txt,json}`：`汇总!B3` 的完整依赖树。
- `projections/stale-after-tx.json`：模拟一次输入变更后的 28 个过期格清单。
- `projections/evidence-certificate.json`：机器可读证书。
- `projections/projected.xlsx` + `projection-plan.json`：投影回 xlsx，带"投影披露"表，如实列出丢了什么。

```bash
node adapters/xlsx/import.mjs cases/xlsx-budget-model-audit.origin/payloads/季度成本预算模型.xlsx cases/xlsx-budget-model-audit.origin --name "季度成本预算模型"
node compiler/cli.mjs diagnose cases/xlsx-budget-model-audit.origin
node compiler/cli.mjs limits cases/xlsx-budget-model-audit.origin
node adapters/xlsx/trace.mjs cases/xlsx-budget-model-audit.origin "汇总!B3" --depth 8
node adapters/xlsx/report.mjs cases/xlsx-budget-model-audit.origin --key "汇总!B3" --depth 8
node cases/xlsx-budget-model-audit.origin/fixtures/make-case.mjs && sha256sum cases/xlsx-budget-model-audit.origin/payloads/季度成本预算模型.xlsx
```

素材：自造，不是真实客户数据。生成器：`fixtures/make-case.mjs`（可复现重建 payload）。
