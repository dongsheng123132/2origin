# 示例导读

## sales-2026.origin/

构思文档中「Excel 本象 → Flint → 多影输出」场景的可读示例包：一份销售数据集的本象，登记了字段语义、关系、约束和一个 Flint 折线图投影意图。

- `manifest.yaml` — 总入口，符合 [`../schemas/manifest.schema.json`](../schemas/manifest.schema.json)
- `graph/` — 对象、关系、约束（结构本象层）
- `payloads/` — 原生载荷位置（本示例仅占位说明，不含真实 .arrow 文件）
- `projections/` — 投影产物位置（占位）
- `provenance/history.jsonl` — append-only 事件日志

## tx-change-chart.json

一个最小语义事务示例：把销售图从折线图改为分组柱状图（纯投影修改，事务退化为 patch）。符合 [`../schemas/transaction.schema.json`](../schemas/transaction.schema.json)。

对应的工作流：

```text
用户：「改成同比柱状图」
  → AI 只输出这个几行的 patch 事务（不重新输出数据、不生成完整图表配置）
  → Commit Compiler 校验约束（如 projection must_disclose_truncation）
  → Flint 重新编译 → 叠象展示前后差异
```
