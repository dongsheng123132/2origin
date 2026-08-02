# adapters/（占位，按方言逐个生长）

领域方言适配器——「通用外壳 + 领域方言」原则的落地处（登记表见 [docs/03-协议草案](../docs/03-协议草案-v0.1.md) 第八节）：

| 目录（未来） | 方言 | 底座 |
|---|---|---|
| `flint-chart/` | Chart | microsoft/flint-chart（MIT，仅对接公开接口） |
| `office/` | Office | OfficeCLI + Docling + PDFium/MuPDF |
| `story/` | Story | 自研（正文分片 + 图谱 + 时间线 + 连续性检查） |
| `memory/` | Memory | 自研 MCP Server |
| `cad/` | CAD | FreeCAD / CLI-Anything / Modulor（Phase 4） |

原则：**不重新实现格式解析与渲染，成熟项目一律作为 Adapter 接入**（见 [docs/05-生态对照](../docs/05-生态对照.md)）。
