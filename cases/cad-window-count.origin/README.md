# 真实 CAD 门窗计数 `.origin`（公开脱敏版）

这不是把文章改个后缀，而是一份可被本象 CLI 加载、体检、追责的真实包。

## 结论

- 天正 `TCH_OPENING`：194 个
- 仅在块定义中：4 个
- 模型空间实际门窗洞：190 个
- 窗对象：**168 个**
- 门对象：**22 个**
- 未分类：0

## 复核

```bash
node compiler/cli.mjs status   cases/cad-window-count.origin
node compiler/cli.mjs why      cases/cad-window-count.origin metric:door-window-count.windows
node compiler/cli.mjs diagnose cases/cad-window-count.origin
node compiler/cli.mjs limits   cases/cad-window-count.origin
```

`why` 会返回：`windows = 168`，责任者为 `deterministic-count-compiler`，依据为
`membership:window/*`。6 条计数约束均可机器判定，`diagnose` 无 error。

## 隐私处理

- 不包含客户原始 DWG。
- 不包含客户名、原文件名、本机路径、图签或图纸文字。
- 每个代理对象只保留稳定 handle、owner、图层、分类、字节长度和 SHA-256 载荷指纹。
- `projections/sanitized-cad/` 只渲染 WINDOW 图层几何；无 `TEXT`、`MTEXT`、`ATTRIB`、块名和图签。

## 不能夸大的地方

- 168 是窗樘/窗洞对象，不是玻璃分格或采购数量；包含被建模为窗的百叶窗。
- GNU LibreDWG 独立链只确认 `class 528` 总数也是 194；168/22 分类来自 ODA 代理载荷字段。
- 当前包没有解出每个天正门窗对象的精确位置与几何，公开截图来自原始 DWG 的 WINDOW 图层普通几何投影。
- 分类规则尚未覆盖所有天正版本。

因此，这可以称为“本象协议真实 CAD 对象计数案例”，但仍是一个有明确边界的窄域案例，
不是“本象已经理解所有 CAD”的证明。

