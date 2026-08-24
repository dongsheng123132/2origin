# 美国 CAD / Plan Review 官方样本登记

更新时间：2026-08-13  
用途：给 CAD 对象级审计的美国兼容性、格式检查和后续 10×盲测提供可复核来源。这里严格区分“格式冒烟样本”和“有对象级真值的效果评测样本”。

## 已下载并锁定哈希

| ID | 官方来源 | 本机受控文件 | SHA-256 | 用途 | 状态 |
|---|---|---|---|---|---|
| US-SD-DXF-01 | [City of San Diego · Design Guidelines & Templates](https://www.sandiego.gov/development-services/forms-publications/design-guidelines-templates) | `tmp/cad-audit-us-samples/sandiego-ds3179-dxf.zip` | `62EF8174B3EB30FEE7DC9E26123E26BD42DC6CBFB322020CF4C1CBE1A26B31AD` | 美国政府 DXF 结构与模板语义 | 已形成对象级证据包 |
| US-SD-PDF-01 | [City of San Diego · Building Permit Templates](https://www.sandiego.gov/development-services/forms-publications/design-guidelines-templates) | `tmp/cad-audit-us-samples/sandiego-building-permit-template-pdf.zip` | `CBEBAF938FEFA3392D56A4F71FB878D68868BDEF3C43ADA3126BA7B7F6EF76EF` | PDF 图集结构与清单检查 | 已下载，未跑效果评测 |
| US-PDX-PDF-01 | [City of Portland · Sample Site Plan](https://www.portland.gov/ppd/documents/sample-site-plan/download) | `tmp/cad-audit-us-samples/portland-sample-site-plan.pdf` | `0755833BE0BBCCC65B073DE4E35CDA1FB6CA403C89E58C37D64333B1D740FB7A` | 官方许可图样式与字段检查 | 已下载，未跑效果评测 |

## 已完成的美国格式冒烟

输入：圣迭戈市 DS-3179 官方 DXF 压缩包中的 `3.2026_CP_1.dxf`。

```text
DXF version: AC1032
layers:      9
objects:     154
geometry:    46
text:        90
constraints: 6/6 machine-evaluable
```

临时本象包：`tmp/cad-audit-us-samples/sandiego-ds3179-smoke.origin`。

正式证据包：`cases/us-sandiego-ds3179-evidence.origin`。它从压缩包内 `3.2026_CP_1.dxf` 建立 187 个对象、319 条关系、9 个页索引条目、7 项引用标准和 10/10 条可执行语义约束。源 DXF SHA-256 为 `E29069D53AFF93278C5495F60D7B6324F52884CD5249A01B2FF7C073C9D6E1BA`。

这项对象级解构证明现有流水线能读取美国市政官方模板并恢复可验证结构与模板语义。它**没有**证明：

- 门窗识别准确率；
- 建筑法规合规性；
- 对完整建筑项目图集的跨页一致性；
- 任何 10×速度或成本提升。

## 规则与市场依据

- [ICC Code Adoption Resources](https://www.iccsafe.org/advocacy/code-adoption-resources/)：模型规范由州/地方 AHJ 采纳并可带本地修订。
- [GSA BIM Guide 07](https://www.gsa.gov/system/files/BIM_Guide_07_v_1.pdf)：联邦 BIM 交付要求 native 与 IFC 协调；自动检查时可随质量认证提交 QCR。
- [USACE A/E/C CAD Standard](https://www.saj.usace.army.mil/Portals/44/docs/Engineering/AECStandardR5.pdf)：联邦 A/E/C CAD 交付的一致性基线。
- [NCEES Licensure](https://ncees.org/licensure)：工程执照和正式签署仍受州级专业制度约束。

## 还缺的效果评测样本

10×实验仍需至少 3 份带对象级真值的美国项目图集，其中至少一份包含修订前后版本。官方空白模板只能做输入兼容性和格式规则测试，不能充当门窗识别或法规判断的效果真值。
