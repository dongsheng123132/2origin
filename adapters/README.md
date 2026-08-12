# adapters/（占位，按方言逐个生长）

领域方言适配器——「通用外壳 + 领域方言」原则的落地处（登记表见 [docs/03-协议草案](../docs/03-协议草案-v0.1.md) 第八节）：

| 目录（未来） | 方言 | 底座 |
|---|---|---|
| `flint-chart/` | Chart | microsoft/flint-chart（MIT，仅对接公开接口） |
| `office/` | Office | **已落地雏形**：零依赖 docx→md（import.mjs，表格合并展开/章条结构化），底座规划 OfficeCLI + Docling + PDFium/MuPDF（见 [office/README.md](office/README.md)） |
| `story/` | Story | **已落地（2026-08-06）**：OriginWriter 写作引擎——init/state/submit/check/hooks/outline 六命令，事务性写作（正文+状态变更），禁区/伏笔状态机/正文对照五道门禁，26 项自测（见 [story/README.md](story/README.md)） |
| `memory/` | Memory | 自研 MCP Server |
| `cad/` | CAD | FreeCAD / CLI-Anything / Modulor（Phase 4） |
| `video/` | Video | **已落地（2026-08-09）**：两遍制粗读—精读 + ASR 通道 + 三段式 events/audiences/appraisals，fail-closed 校验器；四篇文档里三篇是负结果（见 [video/README.md](video/README.md)） |

原则：**不重新实现格式解析与渲染，成熟项目一律作为 Adapter 接入**（见 [docs/05-生态对照](../docs/05-生态对照.md)）。
