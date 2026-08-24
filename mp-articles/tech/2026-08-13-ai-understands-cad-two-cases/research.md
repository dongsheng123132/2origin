# 事实与来源

## 案例一：受控复杂 DWG

- 证据包：`cases/cad-window-audit.origin`
- 194 个 `TCH_OPENING` = 4 个块定义模板 + 190 个模型空间实际放置对象。
- 190 = 168 窗 + 22 门 + 0 未分类。
- 190/190 个对象有位置锚点；尚未恢复精确轮廓、朝向与 bbox。
- GNU LibreDWG 独立链只确认 class 528 总数 194，没有独立确认 168/22。
- “168”是窗樘/窗洞对象，不是玻璃片或采购构件。

## 案例二：美国官方模板

- 官方来源：[City of San Diego · Design Guidelines & Templates](https://www.sandiego.gov/development-services/forms-publications/design-guidelines-templates)
- 对象：DS-3179 Construction Plan DXF，源文件 SHA-256：`E29069D53AFF93278C5495F60D7B6324F52884CD5249A01B2FF7C073C9D6E1BA`。
- 证据包：`cases/us-sandiego-ds3179-evidence.origin`
- DXF AC1032；`$INSUNITS=1`、`$MEASUREMENT=0`，本案解析为 inch。
- 187 个对象、319 条关系、9 个页索引条目、7 项引用标准、10/10 约束通过。
- 识别内容包括 Cover Sheet、General Notes、Environmental Requirements、Improvement Plan、Traffic Control Plan 等页索引，以及 Greenbook、Whitebook、Citywide CADD Standards 等引用标准。
- 这是官方空白/示例模板，不是完整设计，不可用于证明法规合规。

## 美国审查边界

- [ICC Code Adoption Resources](https://www.iccsafe.org/advocacy/code-adoption-resources/)：模型规范由 AHJ 采纳，可带地方修订。
- [GSA BIM Guide 07](https://www.gsa.gov/system/files/BIM_Guide_07_v_1.pdf)：要求 native 与 IFC 协调；自动模型检查可形成 QCR。
- [NCEES Licensure](https://ncees.org/licensure)：正式工程执业、签署受州级执照制度约束。

## 对外口径

允许：AI 辅助流水线读懂了这两份 CAD 中可验证的对象、结构与语义，并能把结论回到原对象。

禁止：已经读懂所有 CAD；已经通过美国图纸审批；比所有 CAD 软件整体好 10 倍；可以替代 AHJ 或持证建筑师/工程师。

