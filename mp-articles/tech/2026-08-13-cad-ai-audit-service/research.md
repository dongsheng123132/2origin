# 研究与证据

## 1. 通用多模态截图基线（2026-08-13 实跑）

- 模型：`qwen-vl-max`
- 工具：百炼 CLI `bl vision describe`
- 输入：公开脱敏总览图 `cases/cad-window-audit.origin/projections/sanitized-cad/overview.png`
- 普通提示词：只允许根据截图回答窗/门数量，以及第 97 个窗的 ID、坐标、分类依据；明确不得假设可读原始 CAD 或外部数据库。
- request_id：`59f90fa1-f473-9b30-ba6f-1778dc0e5de5`
- token：prompt 1357，completion 842，total 2199
- 原回答关键结论：窗 7、门 5；无法回答第 97 个窗的稳定对象 ID、坐标与分类依据。
- 解释：这是“总览截图 + 普通多模态提示词”的工作流基线，不是同输入、同工具条件下的模型能力排行榜。模型自己也明确指出需要原始 CAD 实体属性。

## 2. 本象对象级审计案例

- 受控原始 DWG：`194 = 4 个块定义 + 190 个模型空间实际对象`。
- 分类：`190 = 168 个窗 + 22 个门 + 0 个未分类`。
- 位置：190/190 个模型空间对象恢复位置锚点。
- `origin why metric:door-window-count.windows` 返回派生事务、前后值、写入者和 membership basis。
- `origin why opening:38A.position_anchor` 返回坐标、解码器、事务和依据。
- GNU LibreDWG 独立确认总数 194；168/22 分类来自 ODA 转换后的天正代理载荷，必须公开这个边界。
- 168 是窗樘/窗洞对象，不是玻璃片或采购块数；尚无精确轮廓、朝向和 bbox。

## 3. 美国官方 DXF 案例

- 来源：City of San Diego 官方 DS-3179 Construction Plan DXF 模板。
- 官方页面：https://www.sandiego.gov/development-services/forms-publications/design-guidelines-templates
- DXF SHA-256：`E29069D53AFF93278C5495F60D7B6324F52884CD5249A01B2FF7C073C9D6E1BA`
- 187 个对象、319 条关系、10/10 条机器约束。
- 恢复：inch 单位、9 个页索引、7 项引用标准、待填写字段及源对象关系。
- 这证明美国官方 DXF 的对象化与模板语义预检能力；不证明全美法规审查，不是 AHJ 认证或 PE 盖章。

## 4. 可宣传与不可宣传

可以说：

- 对受控复杂 DWG，交付了可逐对象查询和回图的 168 窗 / 22 门审计结果。
- 对美国官方 DXF，交付了对象、关系、语义、约束和来源证书。
- 普通截图式 AI 基线无法得到对象 ID、坐标与分类依据。

不能说：

- 本象比所有普通 AI 整体强 10 倍。
- 已经读懂任意 CAD 或任意天正版本。
- 已经通过美国建筑法规审批。
- 可以代替设计师、AHJ、建筑师或专业工程师签署。

