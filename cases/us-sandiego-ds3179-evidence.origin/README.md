# 美国官方 CAD 模板对象级解构案例

对象：City of San Diego 官方 `DS-3179 Construction Plan` DXF 模板（2026）。

## 可验证结论

- 原始 DXF：`AC1032`，SHA-256 `E29069D53AFF93278C5495F60D7B6324F52884CD5249A01B2FF7C073C9D6E1BA`。
- 单位：从 `$INSUNITS=1` 与 `$MEASUREMENT=0` 解析为 `inch`。
- 本象对象：187；关系：319；机器约束：10/10。
- 恢复 9 个页索引条目、7 项引用标准以及模板中待填写的联系人/项目字段。
- 源实体和文字保留 DXF handle；派生语义对象保留 `source_object(s)` 和 `derived_from` 关系。
- `metric:us-template-understanding.certified_statement` 由语义事务写入，可通过 `origin why` 追溯。

## 可使用的宣传表述

> AI 辅助流水线读懂了这份美国官方 CAD 模板中可验证的结构与语义，并把每项结论落回原始对象。

这里的“验真证书”是本象工程证据证书，不是政府、AHJ、建筑师、工程师、实验室或认证机构签发的合规证书。

## 不能推出

- 这不是完成设计图，不能证明任何项目已满足建筑、结构、消防、机电或无障碍法规。
- 尚未绑定具体 AHJ 的现行规则集，不能声称“通过美国图纸审批”。
- 当前语义 profile 针对 DS-3179 2026 模板，不直接外推到所有美国城市或任意 CAD。
- 块定义内部图元尚未逐个展开；视觉排版应回到原始 DXF 或 CAD 原生渲染复核。

## 查看与复核

- `projections/evidence-certificate.html`：图文验真页。
- `projections/evidence-certificate.json`：机器可读证书。
- `projections/official-dxf-entity-projection.svg`：由原 DXF 实体直接生成的投影，不是人工重画。
- `projections/semantic-summary.json`：页索引、引用标准和待填字段摘要。

```bash
node compiler/cli.mjs status cases/us-sandiego-ds3179-evidence.origin
node compiler/cli.mjs diagnose cases/us-sandiego-ds3179-evidence.origin
node compiler/cli.mjs why cases/us-sandiego-ds3179-evidence.origin metric:us-template-understanding.certified_statement
node compiler/cli.mjs limits cases/us-sandiego-ds3179-evidence.origin
```

官方来源：<https://www.sandiego.gov/development-services/forms-publications/design-guidelines-templates>

