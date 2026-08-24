# 研究与证据

## 一手案例证据

- 受控 DWG SHA-256：`2D28F2FDB31484B7522F6E16B2916A239E9C7132BD43EB48CBE063BB92737A56`
- ODA + ezdxf：TCH_OPENING class 528 共 194；模型空间 190；块定义 4；窗 168；门 22；未知 0。
- GNU LibreDWG 0.14：独立确认 class 528 总数 194。它没有独立确认 168/22 分类，因此文章不得写成“双解析器一致确认 168”。
- 位置解码：本文件版本特定规则，190/190 无歧义解析；这是位置锚点，不是精确轮廓、朝向或 bbox。
- `.origin`：776 个对象，388 条关系，8/8 可机器判定约束，198 条事务变更；`diagnose` 无 error。
- 单对象示例：`opening:38A.position_anchor` 由 `tch-opening-anchor-decoder` 写入，basis 指向该对象载荷指纹、字段证据和解码器观察。

## 官方背景资料

- ODA File Converter：Open Design Alliance 提供的 DWG/DXF 批量转换工具。https://www.opendesign.com/GUESTFILES/ODA_FILE_CONVERTER
- GNU LibreDWG：GNU 的自由 DWG 读写库，项目说明其当前状态为 beta。https://www.gnu.org/software/libredwg/
- Autodesk DXF `ACAD_PROXY_ENTITY` 说明：组码 91 是应用实体 class ID，310 可承载代理图形/实体二进制数据。https://help.autodesk.com/cloudhelp/2015/ENU/AutoCAD-DXF/files/GUID-89A690F9-E859-4D57-89EA-750F3FB76C6B.htm

## 必须保留的边界

- 168 的单位是窗樘/窗洞对象，不是玻璃分格数、玻璃片数或采购块数；其中可能包含按“窗”建模的百叶。
- ODA/LibreDWG 负责格式读取；大模型协助找规则、写代码、核对；本象协议负责把对象、关系、派生过程、证据和能力边界保存为可复核状态。
- 位置解码器只对本文件所见版本发证；换一份图必须重新过覆盖闸门和叠加图检查。

