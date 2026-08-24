# CAD 门窗对象级审计案例

这不是一张重画图，而是从受控原始 DWG 导入、脱敏后生成的本象 `.origin` 包。

## 已验证结果

| 项目 | 数量 |
|---|---:|
| `TCH_OPENING` | 194 |
| 块定义模板（不计入实际放置） | 4 |
| 模型空间实际放置 | 190 |
| 窗对象 | **168** |
| 门对象 | **22** |
| 未分类 | 0 |
| 位置锚点覆盖 | **190 / 190** |

`168` 的单位是窗樘/窗洞对象，不是玻璃分格、玻璃片或采购构件数。当前已恢复每个对象的位置锚点，尚未恢复天正对象的精确轮廓、朝向与 bbox。

## 直接查看

- [交互对象地图](./projections/object-map.html)：搜索 handle、点击对象、查看坐标和证据字段。
- [总览截图](./projections/object-map-preview.png)
- [单对象 `opening:38A` 截图](./projections/object-map-selected-38A.png)
- [位置锚点数据](./projections/opening-anchors.json)
- [脱敏 CAD 投影](./projections/sanitized-cad/overview.svg)

## 可复核命令

```bash
node compiler/cli.mjs status cases/cad-window-audit.origin
node compiler/cli.mjs diagnose cases/cad-window-audit.origin
node compiler/cli.mjs why cases/cad-window-audit.origin metric:door-window-count.windows
node compiler/cli.mjs why cases/cad-window-audit.origin opening:38A.position_anchor
node compiler/cli.mjs limits cases/cad-window-audit.origin
```

对象位置由独立派生事务 `tx-derived-opening-position-anchors` 写入，不是静态截图里的装饰点。`why` 会返回写入者、事务、字段前后值和 basis。

## 工具分工

- ODA File Converter 27.1：DWG → DXF 离线转换。
- ezdxf：读取 `ACAD_PROXY_ENTITY` 与代理对象数据。
- GNU LibreDWG 0.14：独立交叉确认 class 528 总数 194。
- 大模型：分析载荷规律、实现解码器和测试、检查投影。
- 本象协议：保存对象身份、关系、确定性派生、证据与能力边界，并生成不同复核投影。

LibreDWG 没有独立确认 168/22 分类；该限制已写进 `limits.json`。位置规则也是本文件版本特定规则，换图必须重新过覆盖闸门和脱敏叠加图复核。

## 隐私

公开包不包含原始 DWG、文件名、客户名、项目名、原路径、图签文字或代理对象原始载荷。受控原件只以 SHA-256 指纹对回。

