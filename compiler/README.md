# compiler/（占位，Phase 2 实现）

双向编译器——本象协议的核心机制（见 [docs/04-架构设计](../docs/04-架构设计.md) 第二节）：

- `context-compiler/` — 输入侧：按模型、任务、Token 预算，把本象编译成 AI 最需要的上下文（atlas + graph + exact 三层）
- `commit-compiler/` — 输出侧：解析语义事务 → 校验约束 → 更新状态 → 留存证据 → 重新投影

MVP 选定后（见 [docs/06-路线图](../docs/06-路线图与MVP候选.md)）从对应方言的最小闭环开始实现，不预建空壳。
