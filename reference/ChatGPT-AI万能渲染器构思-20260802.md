# AI万能渲染器构思

**User:** Anonymous  
**Created:** 8/2/2026 2:49:18  
**Updated:** 8/2/2026 10:44:15  
**Exported:** 8/2/2026 13:51:41  
**Link:** [https://chatgpt.com/c/6a6e3faa-8094-83ea-8174-b652f2157a03](https://chatgpt.com/c/6a6e3faa-8094-83ea-8174-b652f2157a03)  

## Prompt:
2026/8/2 02:50:49

![85DA32AD-CE85-4836-BAE3-E8D9448D5607.png](https://chatgpt.com/backend-api/estuary/content?id=file_00000000b4148206a930ef7adf126a7e&fn=85DA32AD-CE85-4836-BAE3-E8D9448D5607.png&cd=attachment&ts=496013&p=fs&cid=1&sig=0ed37bdace21bb09a8d4cfeb21cd91695c371dd6ee2d2e5f1b12002a9d9b55e5&v=0)

Office渲染器，不能用，我是不是可以做一个面向ai的万能渲染器呢？office cad zip 等等？就是我们讨论的redline 叠象？ai时代的新基建，，，ai友好的，，，结合我之前说的，github上有更好的吗？之前都是给人用的，现在是给ai first

## Response:
2026/8/2 02:50:51

> **搜索 GitHub 上通用文件解析与渲染项目**
>
> [Awesome Open Source AI](https://github.com/alvinreal/awesome-opensource-ai)
> [Changed Paths · GitHub](https://gist.github.com/GrahamcOfBorg/caafe6e4a53c1654d9b4cf648048df89)
>
> **已搜索 2 个网站**
>
> 
>
> **构建设想框架**
>
> 我认为方向成立，但核心不该只是“万能渲染器”，而是面向 AI 的 Artifact Runtime：统一解析、渲染、语义抽取、差异叠加与验证。Office、CAD、ZIP 作为适配器接入；Redline/叠象负责版本对比和证据输出。
>
> **构建设想框架**
>
> 
>
> **正在搜索网页**
>
> [CLI-Anything/README.md at main · HKUDS/CLI-Anything · GitHub](https://github.com/HKUDS/CLI-Anything/blob/main/README.md)
>
> **已搜索 1 个网站**
>
> 
>
> 思考了 2m 25s

## 判断：值得做，但不要把它定义成“万能渲染器”

截图暴露的是一个很关键的基础设施缺口：

> AI 已经能生成 Word、Excel、PPT、CAD 等真实文件，却没有一套稳定的“打开-看见-定位-修改-复验”系统。

但你真正应该做的，不是重新写一个能够打开所有文件的 GUI，而是：

# 面向 AI 的通用生成物运行时  
**AI Artifact Runtime**

它更像是 AI 的：

**文件浏览器 + 渲染驱动 + 对象模型 + 测试框架 + 证据系统。**

---

## 一、为什么不能只做一个 Office 渲染器

你截图里的问题其实分为两层：

1. **可用性问题**：当前 Windows 环境没有可调用的 LibreOffice 渲染器。
2. **真实性问题**：即便安装了 LibreOffice，渲染结果也不一定等于 Microsoft Office。

例如，Gotenberg 使用 LibreOffice 转换 DOCX 时，就有人遇到原始 A4 文档被渲染成 Letter 的问题。([GitHub](https://github.com/gotenberg/gotenberg/issues/1342?utm_source=chatgpt.com))

而直接在服务器后台调用原生 Microsoft Office 也不适合做核心架构。微软明确表示，不推荐且不支持从无人值守、非交互式服务器进程自动化 Office，因为可能出现不稳定或死锁。([微软支持](https://support.microsoft.com/en-us/visio/considerations-for-server-side-automation-of-office?utm_source=chatgpt.com))

所以，正确答案不是寻找一个“绝对正确的万能渲染器”，而是做：

# 多渲染器路由与证据共识

同一个文件可以同时经过：

- 结构解析器
- 开源渲染器
- AI 语义解析器
- 原生软件验证器
- 截图及像素比较器

最后给 AI 一个可信度结果，而不是只给一张 PNG。

---

# 二、它和“Redline／叠象”是什么关系

是同一条主线，但最好拆成四层：

| 你的项目 | 负责什么 |
|---|---|
| **ActionParity／影核协议** | AI 怎么操作、修改软件和文件 |
| **Artifact Runtime／生成物运行时** | AI 怎么打开、理解、渲染文件 |
| **Redline／叠象** | 修改前后如何比较、审阅、验证 |
| **PodApp／舟舱小程序** | 人如何查看结果、标注和最终确认 |

可以概括成：

> **影核负责“做”，运行时负责“看”，叠象负责“比”，舟舱负责“确认”。**

所以，Redline 不应该只是一个 Word 修订工具。

它应该升级成：

# AI 生成物的审阅与验收基础设施

AI 生成一个 PPT、Word、Excel、CAD、网页、图片之后，Redline 自动完成：

- 是否能正常打开
- 文件结构是否损坏
- 页面是否溢出
- 字体是否缺失
- 公式是否错误
- 图片是否丢失
- 修改了哪些对象
- 视觉上变化了哪些区域
- 语义上改变了什么
- 在不同渲染器下是否一致

这就很有基础设施价值。

---

# 三、GitHub 上已经出现了哪些接近的项目

## 1. OfficeCLI：与你的 Office 子方向最接近

OfficeCLI 已经在做“AI First Office”：

- AI 原生 CLI 和 JSON 输出
- 用稳定路径定位对象，例如 `/slide[1]/shape[2]`
- 读取、创建、修改 Word、Excel、PPT
- HTML、PNG 渲染
- 实时预览
- 文档校验及错误建议
- MCP 接入
- “render → look → fix”闭环

它不依赖安装 Microsoft Office，是你现在 Office 方向最应该研究和接入的项目。([GitHub](https://github.com/iOfficeAI/OfficeCLI))

**结论：不要从头再造 OfficeCLI。**

更合理的做法是把它作为：

```text
redline-adapter-officecli
```

然后在它上面补充多渲染器比对、证据追溯和统一报告。

---

## 2. kkFileView：最接近“传统万能文件预览器”

kkFileView 支持的范围非常广：

- Word、Excel、PPT、WPS
- PDF、OFD、Visio
- DWG、DXF、STEP、IFC 等 CAD/3D
- ZIP、RAR、7Z
- 图片、音视频、邮件、EPUB、XMind、Draw.io
- REST API 和可扩展的预览接口

它非常适合研究“格式适配器目录”，但本质仍然是给人看的在线预览器，Office 部分也大量依赖 LibreOffice。([GitHub](https://github.com/kekingcn/kkFileView))

你可以借鉴它的：

- 文件类型路由
- 转换缓存
- 适配器体系
- 格式覆盖清单
- 超时和任务队列

但不要以它的 Web 预览 UI 为核心。

---

## 3. Docling：最适合做 AI 语义层

Docling 能把多种文档转换为统一的 `DoclingDocument`，包含：

- 文本、表格、图片
- 文档层级
- 页面布局
- Bounding Box 坐标
- 内容来源和 Provenance
- JSON、Markdown、HTML 等输出
- MCP 和 API 服务

这正是 AI 理解文档所需要的“语义投影”，但它不是高保真 Office/CAD 渲染器。([GitHub](https://github.com/docling-project/docling))

它可以成为：

```text
redline-adapter-docling
```

负责回答：

> “这一段文字、这个表格、这个标题，原来在第几页、什么坐标、来自哪个对象？”

---

## 4. MarkItDown：轻量级兜底提取器

MarkItDown 支持 PDF、Word、Excel、PPT、图片、音频、ZIP、EPUB 等格式转 Markdown，目标明确是供 LLM 消费。

但它自己也明确说明，它不适合高保真的人类视觉转换。([GitHub](https://github.com/microsoft/markitdown))

所以适合做低成本的：

```text
extract_text()
summarize()
search()
```

不适合作为最终验收渲染器。

---

## 5. CLI-Anything：你的“AI First 软件层”思路已经被验证

CLI-Anything 的方向几乎就是：

> 把原来给人使用的软件，转换成 Agent 可以调用的结构化 CLI。

它已经覆盖 FreeCAD、Blender、GIMP、Inkscape、Draw.io 等，并且强调：

- JSON 输出
- Preview
- Live Preview
- Trajectory
- 命令与渲染结果关联
- 真实软件渲染，而不是玩具实现

其中 FreeCAD 和 Blender 示例已经形成“操作-渲染-观察-继续修改”的轨迹闭环。([GitHub](https://github.com/HKUDS/CLI-Anything/blob/main/README.md))

这个项目证明了你的判断：

> 未来不是让 AI 模拟鼠标使用旧软件，而是给旧软件增加 Agent-Native 外壳。

---

## 6. Modulor：非常像 AI 原生 CAD 内核

Modulor 更激进：

- 没有传统 GUI
- JSON 输入，几何结果输出
- CLI、MCP、Python API
- 参数化模型
- DXF、GLTF、PNG 等输出
- 内置 measure、validate、render-and-see 验证闭环

它目前还很早期，但概念上与你的“AI First CAD”高度一致。([GitHub](https://github.com/bcllcc/modulor))

---

# 四、你的真正机会在哪里

从这轮检索看，已经有很多“局部正确”的项目，但我没有看到一个成熟项目同时完成：

- Office、CAD、压缩包等跨领域接入
- 视觉渲染
- 结构化对象定位
- 语义提取
- 像素差异
- 结构差异
- 语义差异
- 多渲染器一致性
- 可回放的修改轨迹
- 完整证据包

这正是你的差异化空间。

但核心卖点不要写成：

> 支持 500 种文件预览。

这个已经是传统软件的打法。

应该写成：

> **让 AI 能够可靠地看见、理解、修改和验证任何数字生成物。**

---

# 五、AI First 的“万能渲染器”应该输出什么

不要只输出一张截图，而要输出一个 Artifact Bundle：

```text
result/
├── artifact.json          # 文件总体信息
├── structure.json         # 对象结构
├── semantic.json          # AI 可理解内容
├── document.md            # 低 Token 文本投影
├── previews/
│   ├── page-001.png
│   ├── page-002.png
│   └── overview.png
├── assets/                # 图片、字体、嵌入对象
├── validation.json        # 文件和布局问题
├── evidence.json          # 渲染器、字体、系统、版本
├── diff.json              # 结构和语义差异
└── report.html            # 人类审阅报告
```

统一提供六个最基本的动作：

```bash
redline inspect file.pptx
redline render file.pptx
redline query file.pptx "/slide[2]/shape[*]"
redline validate file.pptx
redline diff old.pptx new.pptx
redline report file.pptx
```

然后同时暴露：

- CLI
- MCP
- REST API
- SDK
- PodApp 审阅界面

---

# 六、不要试图设计一个巨大的“万能 DOM”

Office、CAD、ZIP 本质完全不同：

- Office 是页面、段落、单元格、幻灯片
- CAD 是几何体、约束、材质、坐标系
- ZIP 是容器和文件树，本身不是可视文档
- 视频是时间轴
- 网页是 DOM 和运行态
- 数据库是表和查询

所以应该采用：

## 一个通用外壳 + 多个领域模型

通用外壳只定义：

```json
{
  "artifact_id": "...",
  "type": "pptx",
  "nodes": [],
  "resources": [],
  "views": [],
  "provenance": [],
  "validations": [],
  "operations": []
}
```

Office、CAD、Archive、Media 再分别扩展自己的 Schema。

否则做出来的“万能格式”只会变成最低公分母，什么都能表示一点，但什么都表示不好。

---

# 七、最合理的 MVP

第一版不要直接挑战所有格式。

## 第一阶段：AI 办公生成物验收

先做：

- PPTX
- DOCX
- XLSX
- PDF
- PNG/JPG
- ZIP

底层组合：

- OfficeCLI：Office 结构、修改和基础渲染
- Docling：语义结构和坐标
- PDFium 或 MuPDF：PDF 真正渲染
- 7-Zip/libarchive：压缩包递归分析
- Playwright：HTML 报告和截图
- 原生 PowerPoint：仅作为可选的 Windows 黄金验证节点

第一版价值就已经很明确：

> Claude、Codex、DeepSeek 生成 Office 文件以后，自动打开、截图、检查、打分、生成证据报告。

## 第二阶段：CAD 与三维生成物

再接入：

- FreeCAD
- OpenCascade
- IfcOpenShell
- Blender
- CLI-Anything
- Modulor

提供：

- 多视角渲染
- 几何尺寸检查
- 空体、破面、碰撞检测
- 对象树差异
- 修改轨迹回放

---

# 八、项目命名与仓库结构

不建议再开一个完全无关的新品牌。直接并入 Redline／叠象：

```text
redline
├── redline-runtime
├── redline-protocol
├── redline-adapters
│   ├── officecli
│   ├── docling
│   ├── pdf
│   ├── archive
│   ├── freecad
│   └── blender
├── redline-diff
├── redline-bench
└── redline-viewer
```

定位可以写成：

> **Redline is an AI-native artifact runtime for rendering, inspecting, comparing and validating digital work.**

中文：

> **叠象是面向 AI 的数字生成物运行时，让智能体能够看见、理解、比较并验证它所创造的文件。**

---

## 最终结论

**这个方向成立，而且可能比单独的 PodApp、Office 工具或文件预览器更接近“AI 时代的新基建”。**

但关键战略是：

- 不重新实现每一种文件格式
- 不与 OfficeCLI、Docling、FreeCAD 正面重复
- 把成熟项目作为 Adapter
- 重点建设统一协议、证据系统、差异系统和验收标准
- 先从“AI 生成 Office 文件的自动验收”切入
- 再扩展到 CAD、网页、视频和所有数字生成物

最准确的一句话是：

> **过去的渲染器，是把文件展示给人看；Redline 要做的，是把数字世界展示给 AI 看，并证明 AI 真的做对了。**

---

**Sources:**

- [Paper size mismatch (A4 → Letter) when converting DOCX ...](https://github.com/gotenberg/gotenberg/issues/1342?utm_source=chatgpt.com)
- [Considerations for server-side Automation of Office](https://support.microsoft.com/en-us/visio/considerations-for-server-side-automation-of-office?utm_source=chatgpt.com)

## Prompt:
2026/8/2 03:01:18

要结合我的其他理念吗？影核协议，？是不是能更高维度？

## Response:
2026/8/2 03:01:31

> **构建统一架构**
>
> 我正在把这些概念提升为一个“AI-native 工作世界层”：万能渲染器负责感知，Redline负责状态与证据，ActionParity负责执行闭环，PodApp负责协作，ShadowFork负责扩展，U-King负责部署。核心不再是应用，而是可验证的行动系统。
>
> **构建统一架构**
>
> 
>
> **提升统一层级**
>
> 我正在把这些模块收束为“影核运行时”：一个意图、多种执行器；一个对象、多种投影；一个动作、多重验证；一条证据链、多方复核。ActionParity保持为行动协议，而不是吞并渲染、协作和部署。
>
> **提升统一层级**
>
> 
>
> 思考了 20s

**可以，而且结合影核协议之后，它就不再是“万能渲染器”，而会升维成一套 AI 操作数字世界的基础协议。**

真正高维度的定义应该是：

> **让 AI 能够看见、理解、操作、验证并提交数字世界中的一切生成物。**

Office、CAD、网页、压缩包、图片、视频，只是不同的“数字对象”。

---

# 一、影核协议解决的不是界面，而是“动作统一”

你原来的影核协议：

> **One Core, Many Shadows｜一核多影**

核心意思是：

- Word GUI 是一个影子
- Word CLI 是一个影子
- OfficeCLI 是一个影子
- Microsoft Office 原生软件也是一个影子
- 手机上的确认界面也是一个影子

真正重要的不是这些界面，而是它们背后的统一动作：

```text
insert_text
replace_image
resize_shape
set_cell_formula
export_pdf
create_layer
move_object
validate_document
```

同一个动作，可以被不同的软件、不同平台、不同界面执行。

所以：

## 影核协议是 AI 数字世界的“动作层”

它回答的是：

> AI 想做什么，以及不同软件如何以统一方式执行这个动作。

---

# 二、叠象 Redline 是“状态与证据层”

但光有动作不够。

AI 执行了：

```text
replace_image(slide=3, shape=7)
```

它还需要知道：

- 替换前是什么
- 替换后是什么
- 位置是否正确
- 图片有没有变形
- 有没有遮住文字
- PowerPoint 打开后是否一致
- 修改是否只影响了指定对象
- 能不能撤销
- 谁在什么时间做了修改

这正是叠象应该负责的。

## 叠象不是单纯的 Diff 工具

更高维度的定义是：

> **叠象是数字生成物的状态、差异、证据和版本层。**

它保存的不仅是截图差异，还包括：

```text
视觉差异
结构差异
语义差异
几何差异
数据差异
行为差异
渲染器差异
修改轨迹
验证结果
```

所以：

- 影核负责“怎么改”
- 叠象负责“改了什么、对不对、能不能证明”

---

# 三、“万能渲染器”其实是 AI 的感知层

你现在发现的 Office 渲染问题，本质上是：

> AI 没有眼睛。

传统渲染器的目标是：

> 把文件显示给人看。

而你需要的 AI First 渲染器，目标是：

> 把数字对象转换成 AI 可以理解和操作的世界模型。

它不能只输出 PNG，还要输出：

```json
{
  "type": "pptx",
  "pages": 12,
  "objects": [],
  "text_blocks": [],
  "tables": [],
  "images": [],
  "coordinates": [],
  "relationships": [],
  "warnings": [],
  "available_actions": []
}
```

因此，它更适合叫：

- Artifact Projection Engine
- AI Artifact Runtime
- Shadow Renderer
- 叠象引擎
- 数字生成物运行时

“万能渲染器”只是对外容易理解的产品名，不是它最终的技术本质。

---

# 四、把你的几个理念组合起来，就形成完整闭环

你现在其实已经不只是几个独立项目，而是逐渐形成了一套完整的 AI 工作系统。

| 项目 | 在系统中的角色 |
|---|---|
| **ShadowSpace／影域** | AI 安全工作的隔离空间 |
| **Redline／叠象** | 感知、状态、差异、证据 |
| **ActionParity／影核协议** | 统一动作与执行协议 |
| **PodApp／舟舱小程序** | 人类确认、标注和控制界面 |
| **ShadowFork／影刻** | 快速定制、分发、品牌化 |
| **U-King** | 安装、部署、环境与商业入口 |
| **Open365** | 面向办公场景的应用层 |

可以浓缩成一句话：

> **影域负责隔离，叠象负责看见，影核负责行动，舟舱负责人类确认，影刻负责复制扩散，U-King 负责落地部署。**

这已经不是一个渲染器，而是一套：

# AI 原生数字工作栈

---

# 五、最关键的升维：建立“影子世界”

我认为你可以把整个体系抽象为一个很强的理念：

# AI 不直接操作现实文件，而是先操作它的“影子”

例如，一个 PPT 文件进入系统后，生成几个不同的影子：

```text
原始 PPTX
   ↓
结构影子：幻灯片、形状、文字、图片
语义影子：标题、结论、数据关系
视觉影子：每页截图、总览图
动作影子：允许执行的修改动作
版本影子：修改前后差异
证据影子：真实 Office 打开的结果
```

AI 先在影子世界里：

1. 看见文件
2. 理解结构
3. 模拟修改
4. 预测影响
5. 执行动作
6. 重新渲染
7. 检查差异
8. 再提交到真实文件

这和软件开发中的：

```text
源码 → 编译 → 测试 → 提交
```

非常类似。

你要建立的是数字办公领域的：

```text
生成物 → 投影 → 修改 → 验证 → 提交
```

这就是更高维度的价值。

---

# 六、影核协议也可以从“一核多影”继续升级

原来的定义：

> 一套核心动作，适配多个界面。

现在可以扩展为四个“一”：

## 1. One Semantic Core，Many Surface Shadows

一个语义核心，多个界面投影。

同一个 Excel 操作，可以通过：

- Excel GUI
- LibreOffice
- Python
- OfficeCLI
- WPS
- Web Office

完成。

## 2. One Artifact，Many Projections

一个文件，生成多个 AI 可读投影：

- 视觉投影
- 结构投影
- 语义投影
- 数据投影
- 行为投影

## 3. One Action，Many Executors

一个动作可以由多个执行器完成：

```text
replace_text
```

可以由：

- 原生 Office
- OOXML 直接修改
- LibreOffice
- OfficeCLI
- GUI 自动化

分别执行。

## 4. One Result，Many Verifiers

同一个结果经过多个验证器：

- 文件结构验证
- 原生软件打开验证
- 视觉验证
- 语义验证
- 用户确认
- AI 交叉验证

这比单纯的“一核多端”更加完整。

---

# 七、完整的 AI 工作闭环

整个系统可以形成六步闭环：

```text
Observe → Understand → Act → Render → Verify → Commit
```

中文就是：

```text
看见 → 理解 → 行动 → 呈现 → 验证 → 提交
```

对应你的项目：

```text
叠象感知
   ↓
影子对象模型
   ↓
影核动作协议
   ↓
真实软件执行
   ↓
叠象重新渲染与比较
   ↓
舟舱人工确认
   ↓
提交真实文件
```

这就是 AI 真正能够“干活”的完整基础设施。

现在绝大多数 Agent 只覆盖：

```text
理解 → 行动
```

它们缺失：

```text
可靠感知
真实渲染
结果验证
证据留存
安全提交
```

这正是你的机会。

---

# 八、Office、CAD、ZIP 如何纳入同一个体系

不要试图让它们共享完全相同的数据结构，而是共享同一套生命周期。

## Office

```text
打开 → 对象树 → 页面渲染 → 编辑 → Diff → 原生 Office 验证
```

## CAD

```text
打开 → 几何树 → 多视角渲染 → 修改参数 → 几何检查 → 导出验证
```

## ZIP

```text
打开 → 文件树 → 安全扫描 → 内容递归解析 → 修改 → 重新打包 → 完整性验证
```

## 网页

```text
打开 → DOM/Accessibility Tree → 截图 → 操作 → 重放 → 像素与行为验证
```

## 视频

```text
打开 → 时间轴 → 镜头/字幕/音轨 → 编辑 → 预览 → 编码与内容验证
```

它们不必共享相同的内部对象，却可以共享：

```text
inspect
render
query
act
diff
validate
commit
rollback
```

这才是通用协议的边界。

---

# 九、建议形成三套协议，而不是全部塞进影核

不要把所有能力都叫影核协议，否则协议会越来越大，最终难以实现。

比较合理的是：

## 1. Artifact Projection Protocol

数字对象如何被投影给 AI。

负责：

- 文件结构
- 语义
- 坐标
- 预览
- 可用动作
- 来源追踪

可以归入 **Redline／叠象协议**。

## 2. ActionParity Protocol

AI 动作如何被不同执行器实现。

负责：

- 动作定义
- 参数
- 前置条件
- 执行器选择
- 失败回退
- 撤销

这就是 **影核协议**。

## 3. Evidence Commit Protocol

修改结果如何验证和提交。

负责：

- 多渲染器验证
- 差异报告
- 风险评分
- 人工审批
- 证据链
- 最终提交

也可以由 Redline 承担。

三者合在一起，成为更大的：

# Shadow Runtime Protocol  
# 影子运行时协议

---

# 十、你的最高层定位可以这样写

## 技术定位

> **Shadow Runtime 是面向 AI 的数字工作运行时。它将 Office、CAD、网页、媒体和其他数字生成物投影为 AI 可理解、可操作、可验证的影子对象。**

## 中文宣言

> 过去的软件把数字世界展示给人。  
> 影子运行时把数字世界展示给 AI。  
>   
> AI 不再盲目点击界面，也不再修改文件后靠猜测结果。  
> 它能够看见对象、理解结构、执行动作、比较变化，并用证据证明工作已经完成。

## 影核协议的升级表述

> **一核多影，不只是同一功能拥有多个界面，而是同一个数字意图，可以跨软件、跨平台、跨执行器稳定完成。**

---

# 十一、商业和开源边界也会变得很清楚

适合开源：

- 影核协议
- 叠象数据格式
- Adapter SDK
- 基础 CLI
- 通用验证规范
- AI-Ready 文件标准
- 开源适配器

可以商业化：

- Windows 原生 Office 验证节点
- 云端渲染集群
- CAD 商业软件适配器
- 企业证据链
- 批量文档验收
- 安全沙箱
- 私有部署
- 高保真字体环境
- Artifact Benchmark
- “AI Ready”认证

所以它既可以形成开源标准，也有明确的商业护城河。

---

## 最后的核心判断

你的最高维度，不应该是：

> 做一个能打开 Office、CAD、ZIP 的万能渲染器。

而应该是：

> **建立 AI 与数字世界之间的感知、动作和验证层。**

在这个体系里：

- **影核是动作内核**
- **叠象是感知与证据系统**
- **影域是安全运行空间**
- **舟舱是人类控制面板**
- **影刻是生态扩散机制**
- **U-King 是部署入口**

整个体系可以统一称为：

# Shadow Runtime／影子运行时  
或者更有野心地称为：

# ShadowOS／影子操作系统

一句话总结：

> **传统操作系统管理程序和文件；ShadowOS 管理 AI 对程序和文件的观察、操作、验证与提交。**

## Prompt:
2026/8/2 03:17:30

非常好，另外，，，那么，我们在想，是不是应该用一种更加通配的文档格式？

其实我们之前为了给人看，把很多真实的信息做了大量压缩，变成了平面的文字。但真实的世界其实是立体的、三维的、多维的，甚至是四维的。

所以我们想，是不是可以用一种新的格式？它既能投影、压缩为 PDF、文字和数学符号，又能够还原为它本源的样子。我们应该有这样一种格式，这才是本源的样子。

这种格式甚至可以兼容很多很多的东西。我大概在想，是不是有一种面向 AI 的格式？通过这种格式和 AI 交流，会更加渗透、更加高效，而不应该是传统的这种纯文字的方式。是不是这样？

## Response:
2026/8/2 03:17:41

> **构建设计框架**
>
> 我会先验证它与现有格式的关系：它更像“语义对象容器”，而不是单一文件格式。核心应统一数据、关系、时间、版本、来源、空间与可执行语义，再允许生成表格、报告、事件流等视图。
>
> **构建设计框架**
>
> 
>
> **梳理AI原生本源对象格式及投影架构**
>
> [USD Home — Universal Scene Description 26.05 ...](https://openusd.org/)
> [JSON-LD - JSON for Linked Data](https://json-ld.org/)
> [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)
> [OFFICIAL | English meaning - Cambridge Dictionary](https://dictionary.cambridge.org/dictionary/english/official)
> [Apache Arrow | Apache Arrow](https://arrow.apache.org/)
> [Welcome! - The Apache HTTP Server Project](https://httpd.apache.org/)
> [Apache](https://www.apache.kiwi/)
> [The HDF5® Library & File Format](https://www.hdfgroup.org/solutions/hdf5/)
> [PixarAnimationStudios/OpenUSD: Universal Scene ...](https://github.com/PixarAnimationStudios/OpenUSD)
> [Apache Software Foundation](https://www.apache.org/)
> [Hierarchical Data Formats - What is HDF5?](https://www.neonscience.org/resources/learning-hub/tutorials/about-hdf5)
> [Introduction to HDF5](https://support.hdfgroup.org/documentation/hdf5/latest/_intro_h_d_f5.html)
> [Universal Scene Description (OpenUSD): Composition and ...](https://www.youtube.com/watch?v=zRyKI55qEZY)
> [What Is OpenUSD and How Does It Work?](https://www.nvidia.com/en-us/glossary/openusd/)
> [Apache Arrow explained](https://iomete.com/resources/blog/apache-arrow-format)
> [Apache](https://en.wikipedia.org/wiki/Apache)
> [Hierarchical data formats](https://nceas.github.io/oss-lessons/spatial-data-gis-law/5-tues-intro-hierarchical-formats.html)
> [HDF5 - Plateforme MatriCS - Université de Picardie Jules Verne](https://www.matrics.u-picardie.fr/en/hierarchical-data-format-5/)
> [Layers — Learn OpenUSD](https://docs.nvidia.com/learn-openusd/latest/composition-basics/layers.html)
> [The Alliance for OpenUSD (AOUSD)](https://aousd.org/)
> [JSON-LD 1.1 Framing](https://w3c.github.io/json-ld-framing/)
> [JSON-LD — JSON for Linked Data, Explained](https://flur.ee/json-ld/)
> [Zero-Copy Data Processing in Python Using Apache Arrow](https://medium.com/%40majidbasharat21/zero-copy-data-processing-in-python-using-apache-arrow-831beb90c59d)
> [Hierarchical Data Format 5 : HDF5](https://www.researchgate.net/publication/251288057_Hierarchical_Data_Format_5_HDF5)
> [USD Layers and Variants: Mastering LIVRPS Composition](https://innoactive.io/resources/portal/layers-and-variants)
> [OPENUSD](https://www.pixar.com/openusd)
> [Apache Arrow: A Beginner's Guide with Practical Examples](https://www.datacamp.com/tutorial/apache-arrow)
> [What is Apache Arrow? Columnar In-Memory Data Format](https://spice.ai/learn/apache-arrow)
> [Zero-Cost, Arrow-Enabled Data Interface for Apache Spark](https://arxiv.org/pdf/2106.13020)
> [Hierarchical Data Format Version 5 (HDF5®)](https://www.ogc.org/standards/hdf5/)
>
> **已搜索 30 个网站**
>
> 
>
> 思考了 1m 33s

**是，而且你碰到的已经不是“新文档格式”，而是 AI 时代的信息表示层。**

过去人类为了适应纸张、屏幕、语言和带宽，把真实对象不断压扁：

```text
真实建筑 → CAD模型 → 平面图 → PDF → 截图 → OCR文字
真实企业 → 业务流程 → Excel表 → 汇总数字 → 一段报告
真实思想 → 关系网络 → 文章结构 → 线性文字
真实运动 → 时空过程 → 视频 → 抽帧 → 图片描述
```

越往下，越容易传播，却也丢失越多信息。

AI 现在大量读取的，往往已经是这种经过多轮压缩后的“影子”。

# 关键判断

你真正想建立的应该是：

> **一个保存数字对象本源结构，并能按需要投影为文字、PDF、图像、三维模型、界面和声音的 AI 原生对象格式。**

我建议先把这个概念叫作：

# 本象协议 / Origin Artifact Protocol

其中：

- **本象**：对象相对完整的源状态
- **影子**：面向某个用户、设备或任务生成的投影
- **叠象**：不同版本、不同投影之间的比较与叠加
- **影核**：对本象执行操作的统一动作内核

一句话就是：

> **一源万影：保存本象，按需投影。**

---

## 一、它不能只是一种“更复杂的文件格式”

这里有一个非常关键的技术边界。

从三维模型生成一张二维图片是容易的：

```text
三维模型 → 二维投影
```

但仅从二维图片恢复唯一的三维模型，通常是不可能的：

```text
二维投影 ⇏ 唯一三维本体
```

因为无数不同的三维对象，都可能产生近似甚至完全相同的二维投影。

所以你说的“能够还原为本源的样子”，不能依靠事后从 PDF、文字或者图片里猜回来，而必须：

> **始终保留本源对象、投影规则和修改历史。**

也就是说，PDF、文字、图片不是源文件，而是本象生成出来的缓存或者视图。

这和数据库很像：

```text
数据库里的真实数据
    ↓
查询
    ↓
表格、图表、报告
```

人看到的是报表，但系统真正保存的是数据、关系和查询逻辑。

未来的文档也应该这样。

---

# 二、本象不是“一个更大的 JSON”

它至少应该同时保存六种东西。

## 1. 对象

文档中的真实对象不再只是字符，而可以是：

```text
人物
组织
房间
零件
公式
合同条款
数据表
业务流程
图片
视频片段
代码
模型
传感器
```

每个对象都有稳定 ID。

## 2. 关系

不只保存“这段话写了什么”，还要保存：

```text
谁拥有谁
谁引用谁
谁依赖谁
谁位于谁里面
谁由谁生成
哪个数字来自哪个公式
哪个结论由哪些证据支持
```

这部分可以借鉴 JSON-LD。JSON-LD 本身就是用 JSON 表达带有上下文和关系的关联数据，使不同系统里的对象能够互相理解。([JSON-LD](https://json-ld.org/?utm_source=chatgpt.com))

## 3. 多维数据

不同对象保存自己的原生数据：

- CAD 保存几何、参数、约束
- Excel 保存公式、依赖、数据类型
- 视频保存时间轴、镜头、字幕、音轨
- 地图保存坐标、图层和路径
- 科学数据保存多维数组和单位
- 文档保存章节、论点、引用和布局

对于大型结构化数据，可以借鉴 Apache Arrow 的类型化列式数据和高效交换方式，以及 HDF5 对大型、异构、层次化数据的组织方式。([Apache Arrow](https://arrow.apache.org/?utm_source=chatgpt.com))

## 4. 时间与状态

真实对象不是静止的。

它要能够表达：

```text
过去是什么
现在是什么
什么时间发生变化
变化由什么动作造成
未来可能有哪些状态
```

OpenUSD 在这个方向上最接近你的理念：它不仅描述三维场景，还支持时间采样、分层组合、引用和多个来源共同构成一个完整场景。它的意义也已经超出单纯的“3D 文件扩展名”。([OpenUSD](https://openusd.org/?utm_source=chatgpt.com))

## 5. 行为和约束

本象不应该只是“数据”，还应该告诉 AI：

```text
这个对象能做什么
哪些动作允许执行
哪些条件不能违反
修改后必须通过哪些验证
如何撤销
如何重新生成投影
```

例如，一个财务表格不只是单元格，还包含：

```text
总额 = 所有明细之和
税率必须在合法范围
删除明细后总额必须重新计算
```

CAD 对象则可能包含：

```text
两个孔必须同轴
壁厚不能小于 2mm
零件之间不能碰撞
```

这部分正好由影核协议承担。

## 6. 来源和证据

本象还应该保留：

```text
由谁创建
使用了哪个模型
引用了什么来源
执行了什么操作
经过哪些软件处理
哪些内容由人确认
哪些内容仍然只是推断
```

W3C 的 PROV-O 已经提供了跨系统表达实体、活动和来源关系的方法；C2PA 则通过清单、修改声明和内容哈希记录数字资产的来源及编辑过程。它们可以成为证据层的参考，而不是重新发明全部来源模型。([W3C](https://www.w3.org/TR/prov-o/?utm_source=chatgpt.com))

---

# 三、AI First 的重点不是“更多信息”，而是按需投影

如果把所有三维数据、视频、代码、历史和关系，一次性全部交给 AI，反而会更慢、更贵。

真正的 AI 原生格式应该让模型可以询问：

```text
给我这个建筑的消防语义视图
给我第二层的几何结构，不要材质
给我这份合同中涉及付款义务的子图
给我 Excel 里影响利润的公式依赖链
给我 PPT 第三页的视觉投影和对象结构
给我视频 15-30 秒的镜头、字幕和人物运动
```

也就是说，AI 不再总是“打开一个文件”，而是：

> **从本象中申请一个适合当前任务的投影。**

这才会真正减少 Token 消耗和歧义。

可以把一次 AI 请求写成：

```text
意图
+ 本象对象引用
+ 需要的投影类型
+ 精度等级
+ 允许执行的动作
+ 约束条件
+ 验收证据
```

而不是把几十万字全部塞入提示词。

---

# 四、文字不会消失，它只是其中一种投影

这里也需要避免走向另一个极端。

文字并不落后。

文字是人类发明的极高压缩率、低带宽、强组合的信息表示方式。数学符号也是如此。

问题不是使用文字，而是：

> **我们错误地把文字投影当成了对象本身。**

例如：

- 对法律条款，文字可能就是最核心的本源层。
- 对 CAD，文字描述只是投影，几何和约束才更接近本源。
- 对 Excel，屏幕像素不是本源，公式和数据依赖才是。
- 对音乐，歌词、乐谱、MIDI、音频波形都是不同投影。
- 对软件，截图不是本源，代码、状态和运行行为才是。

所以 AI 原生格式不是“反文字”，而是：

# 多表示、可切换、可追溯

同一个本象可以拥有：

```text
文字视图
数学视图
数据视图
几何视图
时间视图
因果视图
视觉视图
交互视图
```

---

# 五、这会把你的几个项目真正统一起来

整个体系现在可以形成非常清晰的层次。

## 本象协议：对象层

回答：

> 这个数字对象究竟是什么？

保存对象、关系、数据、时间、行为、约束和来源。

## 影核协议：动作层

回答：

> AI 想对它做什么？

例如：

```text
replace
move
resize
calculate
simulate
annotate
approve
export
```

同一个动作可以由 Office、WPS、LibreOffice、CAD、CLI、网页或者直接修改文件结构来执行。

## Shadow Runtime：运行层

回答：

> 由哪个执行器加载、计算、投影并运行本象？

它相当于这种新格式的虚拟机。

## 叠象 Redline：版本与证据层

回答：

> 修改前后发生了什么，结果是否可信？

负责结构差异、视觉差异、语义差异、轨迹和证据。

## 舟舱 PodApp：人类投影层

回答：

> 哪部分需要给人看、让人确认？

不同人会看到不同的投影：

- 老板看到结论
- 工程师看到参数
- 法务看到风险条款
- 客户看到效果图
- AI 看到完整对象图

## 影域 ShadowSpace：安全空间

回答：

> AI 在哪里尝试、模拟和验证修改，而不破坏真实文件？

---

# 六、它在计算机体系里的位置，类似“AI 时代的中间语言”

这是我认为最高维度的理解。

传统编程有：

```text
高级语言
   ↓
中间表示 IR
   ↓
机器指令
   ↓
不同硬件执行
```

你的体系可以变成：

```text
Word / CAD / Excel / 视频 / 网页 / 数据库
                  ↓
             本象表示
                  ↓
             影核动作
                  ↓
 Office / CAD / CLI / GUI / Agent 等执行器
                  ↓
         PDF / 图片 / 文字 / 三维 / 界面投影
```

于是：

- **本象协议类似 AI 的通用中间表示**
- **影核协议类似统一指令集**
- **Shadow Runtime 类似虚拟机**
- **叠象类似调试器、测试系统和 Git**
- **舟舱类似面向人的显示器和控制台**

这就比“万能文档格式”高出了一个层次。

---

# 七、现有技术没有必要全部推翻

不要第一步就发明一个巨大的二进制文件，并要求所有软件改用它。

更现实的方式是做一个**联合式元格式**：

```text
example.origin/
├── manifest.jsonld
├── graph/
│   ├── entities.json
│   ├── relations.json
│   └── constraints.json
├── payloads/
│   ├── building.usd
│   ├── finance.arrow
│   ├── contract.docx
│   └── source-data.h5
├── behavior/
│   ├── actions.json
│   └── validators.json
├── projections/
│   ├── report.pdf
│   ├── overview.png
│   └── summary.md
├── provenance/
│   └── history.json
└── evidence/
    └── validation.json
```

它不强行替代 USD、DOCX、Arrow、HDF5、图片和视频，而是在上面建立：

- 统一身份
- 统一关系
- 统一投影
- 统一动作
- 统一来源
- 统一验证

这种“清单 + 分层载荷 + 内容寻址”的包装思路，也可以参考 OCI 镜像规范：一个对象由 manifest、配置和多个可独立寻址的层组成，而不是必须塞成一个无法扩展的巨大数据块。([https://opencontainers.github.io](https://specs.opencontainers.org/image-spec/?utm_source=chatgpt.com))

Jupyter Notebook 也提供了一个较小规模的先例：同一个文件中同时保存文字、代码、富媒体输出和元数据，而不是只保存最终截图。([Nbformat](https://nbformat.readthedocs.io/en/latest/format_description.html?utm_source=chatgpt.com))

---

# 八、第一版应该怎么落地

第一版不要声称描述整个物理宇宙。

先聚焦：

# AI 数字生成物的本象格式

先覆盖：

```text
DOCX
XLSX
PPTX
PDF
HTML
图片
ZIP
基础 CAD
```

导入后形成统一的本象包，然后提供七个命令：

```bash
origin inspect file.pptx
origin query file.pptx "所有包含财务数据的对象"
origin project file.pptx --as pdf
origin project file.pptx --as semantic
origin act file.pptx --action replace-image
origin diff before.pptx after.pptx
origin validate after.pptx
```

第一阶段的核心不是格式覆盖数量，而是跑通：

```text
导入 → 形成对象图 → 按需投影
→ 影核修改 → 叠象验证 → 提交
```

---

# 最适合你的一组核心表达

## 本象协议

> 保存对象，而不是只保存对象的截图。

## 一源万影

> 一个本源对象，可以投影为文字、数学、图像、三维、界面和声音。

## 影核协议

> 一个数字意图，可以跨软件、跨平台、跨执行器稳定完成。

## 叠象

> 每一次修改都可以被看见、比较、验证和追溯。

## Shadow Runtime

> AI 不再只阅读人类压缩后的文档，而是直接进入数字对象的结构、关系、状态和行为。

最终，你要做的可能不是下一代 PDF。

而是：

# PDF、Office、CAD、网页和多媒体之上的“本象层”

PDF 是面向印刷时代的最终投影。

HTML 是面向网络时代的可交互投影。

**本象协议可以成为面向 AI 时代的源对象表示。**

一句最有力量的话是：

> **过去，人类把世界压缩成文档交给计算机；未来，AI 将直接理解世界的本象，再为人类生成所需要的投影。**

---

**Sources:**

- [JSON-LD - JSON for Linked Data](https://json-ld.org/?utm_source=chatgpt.com)
- [Apache Arrow | Apache Arrow](https://arrow.apache.org/?utm_source=chatgpt.com)
- [USD Home — Universal Scene Description 26.05 ...](https://openusd.org/?utm_source=chatgpt.com)
- [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/?utm_source=chatgpt.com)
- [The OpenContainers Image Spec](https://specs.opencontainers.org/image-spec/?utm_source=chatgpt.com)
- [The Notebook file format — nbformat 5.10 documentation](https://nbformat.readthedocs.io/en/latest/format_description.html?utm_source=chatgpt.com)

## Prompt:
2026/8/2 03:31:15

是，可是ai理解本象更快一些。。。之前说，把很多文字，放入一张图中，反而更省token ，，，这个东西要怎么做，怎么开源，怎么执行，在哪些方面有突出优势呢？目前看似乎不明显。

## Response:
2026/8/2 03:31:27

> **构思开源路径**
>
> 我会先验证视觉表示在特定任务中的真实优势，再设计可转换的中间表示、评测集与参考实现。重点不是宣称图片普遍更省令牌，而是证明它在界面、表格和空间关系任务中更高效。
>
> **构思了开源路径**
>
> 
>
> **搜索图像压缩与视觉模型令牌机制**
>
> [Google Images](https://images.google.com/)
> [Image Processing Cost for Input "tokens"? - API](https://community.openai.com/t/image-processing-cost-for-input-tokens/1003085)
> [Vision - Claude Platform Docs](https://docs.anthropic.com/en/docs/build-with-claude/vision)
> [Understand and count tokens | Gemini API](https://ai.google.dev/gemini-api/docs/tokens)
> [DeepSeek-OCR: Contexts Optical Compression](https://github.com/deepseek-ai/DeepSeek-OCR)
> [IMAGE | English meaning - Cambridge Dictionary](https://dictionary.cambridge.org/dictionary/english/image)
> [DeepSeek-OCR: Contexts Optical Compression](https://arxiv.org/html/2510.18234v1)
> [DeepSeek](https://chat-deep.ai/)
> [GPT Image 1 Model | OpenAI API](https://developers.openai.com/api/docs/models/gpt-image-1)
> [Token counts for image processing inside PDF documents](https://discuss.ai.google.dev/t/token-counts-for-image-processing-inside-pdf-documents/112376)
> [deepseek-ai/DeepSeek-OCR](https://huggingface.co/deepseek-ai/DeepSeek-OCR)
> [【DL輪読会】DeepSeek-OCR: Contexts Optical Compression](https://www.docswell.com/s/DeepLearning2023/Z13N8R-2025-11-14-115321)
> ["DeepSeek-OCR: A Novel Optical Compression Method for ...](https://www.linkedin.com/posts/ajazshussain_deepseek-ocr-contexts-optical-compression-activity-7386830483248095232-OHzR)
> [Business Pricing](https://openai.com/business/pricing/)
> [New Deepseek model drastically reduces resource usage by converting text and documents into images - 'vision-text compression' uses up to 20 times fewer tokens](https://www.tomshardware.com/tech-industry/artificial-intelligence/new-deepseek-model-drastically-reduces-resource-usage-by-converting-text-and-documents-into-images-vision-text-compression-uses-up-to-20-times-fewer-tokens)
> [Deepseek's new tool can extract text from photos of pages: What it means for users](https://timesofindia.indiatimes.com/technology/tech-news/deepseeks-new-tool-can-extract-text-from-photos-of-pages-what-it-means-for-users/articleshow/124725207.cms)
>
> **已搜索 16 个网站**
>
> 
>
> **规划开源方向**
>
> 我会把它做成“上下文编译器”：将文档、界面、表格转换为视觉总览、结构化索引和按需原文。先用界面、表格、流程图建立基准，证明空间关系与全局浏览的成本优势，再开放规范、转换器和评测集。
>
> **检索视觉压缩、标注与结构化表示证据**
>
> [Set-of-Mark Prompting Unleashes Extraordinary Visual Grounding in GPT-4V](https://arxiv.org/abs/2310.11441)
> [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
> [USD Terms and Concepts](https://openusd.org/release/glossary.html)
> [microsoft/SoM: [arXiv 2023] Set-of-Mark Prompting for GPT- ...](https://github.com/microsoft/SoM)
> [The New MCP Specification: What Security Teams Must ...](https://www.akamai.com/blog/security-research/new-mcp-specification-security-teams-must-prepare)
> [Layers — Learn OpenUSD](https://docs.nvidia.com/learn-openusd/latest/composition-basics/layers.html)
> [SoM-GPT4V](https://som-gpt4v.github.io/)
> [Paper page - Glyph: Scaling Context Windows via Visual- ...](https://huggingface.co/papers/2510.17800)
> [Announcing v2.0 of the official MCP C# SDK - .NET Blog](https://devblogs.microsoft.com/dotnet/announcing-v20-of-the-official-mcp-csharp-sdk/)
> [USD Layers and Variants: Mastering LIVRPS Composition](https://innoactive.io/resources/portal/layers-and-variants)
> [Set-of-Mark Prompting Unleashes Extraordinary Visual ...](https://scispace.com/papers/set-of-mark-prompting-unleashes-extraordinary-visual-41iy4t5fna)
> [MCP 2026-07-28: What's Changing and How to Migrate](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate)
> [Time offset for referenced USD - AOUSD Forum](https://forum.aousd.org/t/time-offset-for-referenced-usd/2570)
> [Set-of-Mark Prompting Unleashes Extraordinary Visual ...](https://www.opentrain.ai/papers/set-of-mark-prompting-unleashes-extraordinary-visual-grounding-in-gpt-4v--arxiv-2310.11441/)
> [DeepSeek-OCR: Solving LLM Long-Context with Visual- ...](https://medium.com/aimonks/deepseek-ocr-solving-llm-long-context-with-visual-text-compression-ddea5b5896f6)
> [MCP Cheat Sheet (2026) - Model Context Protocol Quick ...](https://www.webfuse.com/mcp-cheat-sheet)
> [Set-of-Mark Prompting Unleashes Extraordinary Visual ...](https://www.bibsonomy.org/bibtex/1ef89be9e16766fbcc5955a360d5a63fd)
> [Exploring Multimodal LLMs' Performance in Text-as-Image ...](https://papers.ssrn.com/sol3/Delivery.cfm/5666771.pdf?abstractid=5666771&mirid=1)
> [Model Context Protocol Specification Version Timeline](https://hidekazu-konishi.com/entry/mcp_specification_version_timeline.html)
> [People See Text, But LLM Not | CSU-JPG Lab Stories](https://csu-jpg.github.io/Blog/people_see_text.html)
> [YouTube](https://www.youtube.com/watch?v=zRyKI55qEZY)
> [Experimenting with Set-of-Mark Prompting with GPT4-Vision](https://djajafer.medium.com/experimenting-with-set-of-mark-prompting-with-gpt4-vision-65c7f03fb491)
> [CVPR 2025 Open Access Repository](https://openaccess.thecvf.com/content/CVPR2025/html/Liu_Hybrid-Level_Instruction_Injection_for_Video_Token_Compression_in_Multi-modal_Large_CVPR_2025_paper.html)
> [Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol)
> [Explainer Series for Developers: What Is OpenUSD?](https://aousd.org/blog/explainer-series-what-is-openusd/)
> [New Deepseek model drastically reduces resource usage by converting text and documents into images - 'vision-text compression' uses up to 20 times fewer tokens](https://www.tomshardware.com/tech-industry/artificial-intelligence/new-deepseek-model-drastically-reduces-resource-usage-by-converting-text-and-documents-into-images-vision-text-compression-uses-up-to-20-times-fewer-tokens)
>
> **已搜索 26 个网站**
>
> 
>
> 思考了 1m 21s

是，但要把一个关键点说透：

> **“本象”不等于把文字截图成图片。**  
> 图片压缩只是本象的一种投影技术。

你现在觉得优势不明显，是因为“发明一种万能格式”离实际价值太远。真正应该先做的，不是新格式，而是：

# AI 上下文编译器  
**Shadow Context Compiler｜影象编译器**

它把 Office、CAD、网页、代码、图片等真实对象，按当前模型、任务和 Token 预算，编译成 AI 最容易理解的上下文。

一句话：

> **不是把所有东西都塞给 AI，而是把本象编译成 AI 此刻最需要看到的影子。**

---

# 一、把大量文字放进图片，确实可能省 Token，但不能过度乐观

DeepSeek-OCR 已经验证了“视觉-文字压缩”这条路线：在其测试中，文字 Token 与视觉 Token 比例低于约 10 倍时，OCR 解码精度可达约 97%；压缩到 20 倍时，精度降到约 60%。DeepSeek-OCR 2 又进一步探索了更接近人类阅读顺序的视觉编码。([arXiv](https://arxiv.org/html/2510.18234v1))

但目前研究也发现两个问题：

第一，**能把文字识别回来，不等于能理解长距离关系**。VTCBench 的测试显示，多数视觉语言模型虽然能读出被压缩的文字，但在长距离检索、关联推理和长期记忆任务上表现仍然较差。([arXiv](https://arxiv.org/abs/2512.15649?utm_source=chatgpt.com))

第二，一些研究发现，视觉压缩在真正的语言建模任务中不一定优于普通的层次编码、摘要或截断；过度压缩时，模型会依赖语言猜测，产生“看起来读对了，实际是补出来的”问题。([arXiv](https://arxiv.org/abs/2601.03714))

而且不同模型的视觉 Token 算法差别很大。例如 Claude 对一张 1000×1000 图片大约计算为1296个视觉 Token；Gemini 对不超过384×384的图片按258个 Token 计算，更大的图片会分块计数。因此，同一张“文字图”在不同模型上的成本和效果可能完全不同。([Claude Platform Docs](https://docs.anthropic.com/en/docs/build-with-claude/vision))

所以不能把产品定义为：

> 把文字变成图片，节约 Token。

这很容易成为一种模型附属技巧，而且不够稳定。

---

# 二、真正的突破是“视觉索引 + 精确载荷”

最可行的结构不是纯图片，也不是纯 JSON，而是三层：

## 第一层：视觉总览

把几百页、几千个对象压缩成一张或几张“视觉地图”：

- 页面缩略图
- 时间轴
- 关系图
- 文件结构
- 表格热力图
- CAD 多视角图
- 对象编号
- 修改状态
- 风险标记

AI 先花很少的 Token 获得全局认识。

## 第二层：结构本象

保存准确的对象和关系：

```json
{
  "id": "slide-17/chart-2",
  "type": "chart",
  "source": "sales.xlsx",
  "depends_on": ["sheet-3/B2:B24"],
  "actions": ["inspect", "edit_data", "resize", "replace"]
}
```

AI 不必从图片里猜“这是哪个对象”。

## 第三层：精确载荷

当 AI 真正需要某一部分时，再取：

- 原始文字
- Excel 公式
- CAD 参数
- 图片原图
- 代码
- 合同条款
- 数据表

也就是：

> **图片负责找，结构负责懂，原文负责准。**

这才是你的核心方案。

---

# 三、本象格式应该是“中间表示”，而不是让模型直接裸读

当前 AI 不会因为你设计了一个 `.origin` 文件，就自动理解这种格式。

所以本象应该像编译器里的 IR：

```text
Office / CAD / HTML / 视频 / ZIP
                 ↓
             本象 IR
                 ↓
       根据任务和模型编译
                 ↓
视觉地图 + 对象图 + 精确片段 + 可执行动作
```

最终交给 Claude、DeepSeek、Gemini 的，仍然是它们已经支持的：

- 图片
- 文字
- JSON
- 工具调用
- 文件片段

但这些内容是动态编译出来的，不是把整个文件粗暴塞进去。

因此你的创新重点不是“模型支持一种新文件扩展名”，而是：

> **同一个本象，针对不同模型和任务，自动生成最优上下文。**

---

# 四、真正有突出优势的场景

## 1. PPT 和长文档全局审阅

例如100页PPT。

传统方式：

- 全部提取文字，丢失版式和视觉关系
- 每页单独截图，Token 高且缺少整体视野
- AI 不容易发现跨页重复、风格漂移和前后矛盾

本象方式：

- 一张总览图显示100页缩略图
- 每页和每个对象都有稳定编号
- AI 先找出异常页
- 只加载相关页的精确文字和对象结构
- 修改后由叠象验证

这是最容易让用户一眼看出价值的场景。

---

## 2. Excel 和复杂数据

Excel 的本源不是屏幕上的格子，而是：

- 公式
- 单元格依赖
- 数据类型
- 工作表关系
- 异常分布
- 时间变化

可以先把整个工作簿编译成：

- 工作表关系图
- 公式依赖图
- 数据热力图
- 异常点总览

AI 看到一张图，就知道应该深入哪个工作表、哪个区域，而不是阅读几十万个单元格。

---

## 3. CAD、建筑和工业设计

这类场景比纯文字更能证明“本象”的价值。

因为 CAD 的本源本来就是：

- 几何
- 层级
- 参数
- 约束
- 材质
- 装配关系
- 空间坐标

AI 可以先看到：

- 六视图
- 爆炸图
- 零件树
- 碰撞区域
- 尺寸异常
- 参数依赖

然后精确操作具体零件。

这不是把文字变成图片，而是让 AI 直接处理更接近现实对象的表示。

---

## 4. UI 和软件操作

一张带对象编号的界面图，可以比几千行 DOM 或 Accessibility Tree 更容易让多模态模型理解全局。

微软的 Set-of-Mark 研究已经验证：在图片区域上覆盖可被模型引用的数字、字母和标记，可以显著改善视觉定位能力。([arXiv](https://arxiv.org/abs/2310.11441?utm_source=chatgpt.com))

这与影核协议天然结合：

```text
AI 看见按钮 [A17]
        ↓
影核解析 A17 对应的真实对象
        ↓
执行 click / input / drag
        ↓
叠象重新截图并验证
```

---

## 5. AI 长期记忆

传统 Agent 记忆是一堆线性聊天记录。

你可以把几个月的工作历史编译成：

- 时间线
- 项目关系图
- 决策分支图
- 文件变化图
- 人物与任务关系图

AI 先看“记忆地图”，再按需读取原始记录。

这个方向可能比单纯的文档格式更有长期价值。

---

# 五、第一版不要叫“万能本象格式”

第一版建议做一个非常具体、可以测量的项目：

# ShadowPack｜影象包

它是 AI 的动态上下文包。

```text
project.shadowpack/
├── manifest.json
├── graph/
│   ├── objects.jsonl
│   ├── relations.jsonl
│   └── actions.json
├── atlas/
│   ├── overview.webp
│   ├── page-map.webp
│   └── diff-map.webp
├── exact/
│   ├── text/
│   ├── tables/
│   ├── formulas/
│   └── geometry/
├── source/
│   └── original.pptx
├── provenance/
│   └── history.json
└── validation/
    └── report.json
```

其中：

- `atlas` 是低 Token 的视觉地图
- `graph` 是对象和关系
- `exact` 是需要时才读取的精确信息
- `actions` 对接影核协议
- `validation` 对接叠象
- `source` 保留原始本体

---

# 六、运行方式

```bash
# 把PPT编译成影象包
shadow pack company.pptx

# 针对Claude生成1500 Token预算的上下文
shadow project company.shadowpack \
  --target claude \
  --budget 1500 \
  --task "检查内容重复和版式异常"

# 查看某个对象的精确内容
shadow fetch company.shadowpack slide-17/chart-2 --exact

# 通过影核执行修改
shadow act company.shadowpack \
  --action replace_chart_data \
  --target slide-17/chart-2

# 用叠象检查修改前后
shadow verify company.shadowpack

# 输出给人看的PDF
shadow export company.shadowpack --as pdf
```

模型配置单独保存：

```text
profiles/
├── claude.yaml
├── gemini.yaml
├── deepseek-ocr2.yaml
├── openai.yaml
└── local-vlm.yaml
```

同一个本象，可以根据不同模型的图片分辨率、视觉 Token 算法和能力，生成不同投影。

---

# 七、怎么开源

建议采用“标准先开源，商业能力后置”的方式。

## 开源部分

仓库可以叫：

```text
shadow-context
```

结构：

```text
shadow-context/
├── spec/                 # 本象IR和ShadowPack规范
├── compiler/             # 上下文编译器
├── runtime/              # 查询和投影运行时
├── adapters/
│   ├── pptx/
│   ├── docx/
│   ├── xlsx/
│   ├── html/
│   └── cad/
├── actionparity/         # 影核动作映射
├── redline/              # Diff和验证
├── mcp-server/
├── viewer/
└── benchmark/
```

许可证建议：

- 协议、核心运行时：**Apache-2.0**
- 示例和简单 SDK：MIT
- 测试数据：自行生成，使用 CC BY 4.0 或 CC0
- 商业 Office、CAD 适配器另行授权

Apache-2.0 比 MIT 更适合做标准型基础设施，因为它还包含较明确的专利授权条款。

---

# 八、第一步不是写协议，而是做 ShadowBench

你现在之所以感觉“不明显”，最主要原因是还没有基准测试。

先做一个公开 Benchmark：

## 三种输入方式对比

1. 原始纯文字/Markdown
2. PDF 或普通截图
3. ShadowPack 混合本象

## 比较指标

```text
理解准确率
输入 Token
响应时间
API 成本
对象定位成功率
修改成功率
验证成功率
错误和幻觉率
```

可以定义一个综合指标：

```text
有效效率 =
正确完成任务数
────────────────
Token成本 × 延迟
```

测试任务先选：

- 找出100页PPT中的重复页
- 找出PPT中文字与图表数据矛盾
- 找出Excel中影响利润的公式链
- 找出网页截图中对应的可操作对象
- 找出CAD装配体中的碰撞和尺寸异常

只有当 ShadowPack 在这些任务上明显优于纯文本和普通截图，协议才真正成立。

---

# 九、最适合的首个演示

我建议第一个 Demo 只做：

# 100页PPT，AI低成本全局审阅并自动修复

完整过程：

```text
PPTX
 ↓
生成100页视觉总览
 ↓
给所有页面和对象编号
 ↓
提取页面关系、标题、数据来源
 ↓
AI用少量Token完成全局扫描
 ↓
按需加载异常页面精确信息
 ↓
影核执行修改
 ↓
PowerPoint真实打开
 ↓
叠象生成修改前后证据图
```

这个 Demo 能同时展示：

- 本象协议
- 视觉压缩
- 影核动作
- 叠象验证
- Office 渲染
- 舟舱人工确认

而且非常容易做出对照：

> 普通方式用了多少 Token，ShadowPack 用了多少；普通方式找出几个问题，ShadowPack 找出几个；最后是否真的修改成功。

---

# 十、你的护城河不是“图片省 Token”

“把文字塞进图片”很快会成为模型厂商自己的功能，DeepSeek-OCR 已经在做，其他模型也会跟进。

你真正可以建立的壁垒是：

## 可寻址的多维上下文

图片中的每个对象都能定位回真实文件。

## 任务自适应编译

不是固定截图，而是针对任务和 Token 预算生成不同视图。

## 可执行

AI 看见的对象可以直接通过影核操作。

## 可验证

每次操作都能通过叠象重新渲染、比较和留证。

## 跨格式

PPT、Excel、网页、CAD 都共享同一个：

```text
observe
query
fetch
act
verify
commit
```

最终定位应该是：

> **Shadow Context Compiler 不是把文字变成图片，而是把复杂的数字世界编译成 AI 能以最低成本理解、精确定位并可靠操作的上下文。**

最适合对外传播的一句话：

> **图负责全局，结构负责关系，原文负责精确，影核负责执行，叠象负责证明。**

先把“100页PPT低 Token 审阅和修改”做成公开 Benchmark。它跑赢之后，“本象协议”就不再是抽象哲学，而会自然变成事实标准。

---

**Sources:**

- [DeepSeek-OCR: Contexts Optical Compression](https://arxiv.org/html/2510.18234v1)
- [Vision - Claude Platform Docs](https://docs.anthropic.com/en/docs/build-with-claude/vision)

## Prompt:
2026/8/2 03:47:26

反过来，ai这样输出也最稳的，，，比如写100万字的小说，传统的就炸了。。。怎么办。。。。之前老有和ai聊久了，上下文爆了，怎么办？本象协议是不是更好的方案？

## Response:
2026/8/2 03:47:38

> **设计长篇记忆方案**
>
> 我会把 Origin 类协议理解为“外部记忆与状态管理”，而不是无限上下文。更稳妥的方案是分层保存正文、摘要、人物关系、世界规则和版本记录，再按当前场景检索，避免整部小说反复塞入对话。
>
> **设计了长篇记忆方案**
>
> 
>
> **设计“原象协议”管理长文本上下文**
>
> [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
> [Context engineering: memory, compaction, and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)
> [Archival memory](https://docs.letta.com/guides/core-concepts/memory/archival-memory/)
> [Welcome - GraphRAG](https://microsoft.github.io/graphrag/)
> [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)
> [letta-ai/letta: Platform for stateful agents: AI with advanced ...](https://github.com/letta-ai/letta)
> [GraphRAG: Unlocking LLM discovery on narrative private ...](https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/)
> [Lost in the Middle: How Language Models Use Long ...](https://cs.stanford.edu/~nfliu/papers/lost-in-the-middle.arxiv2023.pdf)
> [Claude Memory Tool in Practice: The Complete Guide to ...](https://claudeapi.com/en/blog/dev-guides/claude-memory-tool-guide/)
> [Claude API Memory Tool: Build Agents That Learn](https://thomas-wiegold.com/blog/claude-api-memory-tool-guide/)
> [Letta vs. Graphlit: Agent Memory That Edits Itself vs. ...](https://www.graphlit.com/vs/letta)
> [How Would Microsoft GraphRAG Work Alongside a Graph ...](https://memgraph.com/blog/how-microsoft-graphrag-works-with-graph-databases)
> [Why Language Models Are “Lost in the Middle”](https://pub.towardsai.net/why-language-models-are-lost-in-the-middle-629b20d86152)
> [Claude Memory 2026: Complete Guide — What It Stores ...](https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use)
> [Tutorial on building agent with memory using Letta](https://www.reddit.com/r/AI_Agents/comments/1glzob6/tutorial_on_building_agent_with_memory_using_letta/)
> [Building the Graph with GraphRAG: Community Reports ...](https://medium.com/%40QuarkAndCode/building-the-graph-with-graphrag-community-reports-and-summaries-f212f8dd09e5)
> [(PDF) Lost in the Middle: How Language Models Use Long ...](https://www.researchgate.net/publication/378284067_Lost_in_the_Middle_How_Language_Models_Use_Long_Contexts)
> [Anthropic-Style Context Editing… Now for Every LLM in ...](https://www.youtube.com/watch?v=Gkv0L_32SPU)
> [Surviving Session Crashes: How Anthropic, OpenAI, xAI and ...](https://felixschmidt.software/en/blog/session-state-persistence-2026)
> [Context Editing](https://docs.agno.com/models/providers/native/anthropic/usage/context-management)
> [Global Community Summary Retriever | GraphRAG](https://graphrag.com/reference/graphrag/global-community-summary-retriever/)
> [Exploring Anthropic's Memory Tool](https://www.leoniemonigatti.com/blog/claude-memory-tool.html)
> [How to Build an AI Agent in 2026: A Practical Guide](https://www.developersdigest.tech/blog/how-to-build-ai-agent-2026)
> [GraphRAG library: A summary of its features](https://www.linkedin.com/posts/tonyseale_the-microsoft-graphrag-library-has-recently-activity-7230121112158830593-m8At)
> [Lost in the Middle: How Language Models Use Long ...](https://aclanthology.org/2024.tacl-1.9/)
> [Lost in the Middle: Why LLMs Struggle With Long Contexts](https://pristren.com/blog/lost-in-middle-attention-paper/)
> [Giving AI Coding Agents the 'Power to Learn from ...](https://zenn.dev/akky_tech/articles/25_12_ai_learned_with_letta?locale=en)
> [How to Use Letta's Archival Memory in Python SDK?](https://stackoverflow.com/questions/79614552/how-to-use-lettas-archival-memory-in-python-sdk)
>
> **已搜索 28 个网站**
>
> 
>
> 思考了 40s

**是，而且“反过来输出”可能比输入压缩更有价值。**

不过，本象协议真正解决的不是“让上下文变得无限长”，而是：

> **从根本上取消“必须把整个世界塞进上下文，AI 才能继续工作”这个前提。**

100 万字小说不应该作为一个巨大字符串交给 AI，也不应该让 AI 每次继续写作时重新阅读前面 100 万字。

它应该成为一个持续存在、可查询、可修改、可验证的**故事世界本象**。AI 每次只加载当前任务需要的投影，然后以“增量提交”而不是“整篇输出”的方式工作。

# 一、传统 Chat 为什么一定会炸

传统对话的默认逻辑是：

```text
聊天记录 = 项目状态
```

聊得越久，历史越长。最终会出现：

- 旧信息占满上下文
- 重要设定埋在中间
- 摘要多次压缩后失真
- AI 忘记早期决定
- 新旧设定互相冲突
- 成本和响应时间不断增加

即使上下文窗口足够容纳内容，也不代表模型能够同等有效地利用所有位置的信息。“Lost in the Middle”研究发现，模型对长上下文中间区域的信息利用通常弱于开头和结尾。([arXiv](https://arxiv.org/abs/2307.03172?utm_source=chatgpt.com))

因此，无限扩大上下文不是根本答案。

官方和开源 Agent 体系也在向“上下文之外保存状态”发展：Anthropic 将外部记忆、压缩和清除已处理工具结果作为长期 Agent 的上下文管理方式；Letta 则把长期信息保存在可检索的 archival memory 中，而不是全部永久放在当前提示词里。([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents?utm_source=chatgpt.com))

但这些方案主要解决的是“记住信息”。

**本象协议应该进一步解决：对象、关系、状态、动作、证据和最终生成物如何保持一致。**

---

# 二、本象协议的核心：对话不再是状态，世界才是状态

传统方式：

```text
聊天记录
   ↓
AI 从聊天记录里猜测项目当前状态
   ↓
继续输出文字
```

本象方式：

```text
真实项目本象
├── 精确内容
├── 对象关系
├── 当前状态
├── 历史事件
├── 约束规则
├── 未完成事项
└── 版本证据
      ↓
按当前任务生成上下文投影
      ↓
AI 输出局部修改事务
      ↓
验证后提交回本象
```

最关键的变化是：

> **Chat 只是操作本象的一个临时窗口，不再是项目本身。**

即使关掉对话、切换模型、上下文清空，项目仍然完整存在。

---

# 三、100 万字小说应该保存成什么

不是简单地拆成 1000 个 Markdown 文件。

它应该同时包含七类信息：

| 层 | 保存内容 |
|---|---|
| 原文层 | 每一卷、章、场景的精确正文 |
| 世界层 | 人物、地点、组织、物品、能力和规则 |
| 状态层 | 每个角色在特定时间点的位置、知识、关系和身体状态 |
| 时间层 | 事件发生顺序、并行时间线和因果关系 |
| 叙事层 | 主线、支线、伏笔、悬念、冲突和主题 |
| 风格层 | 视角、语气、节奏、词汇偏好、禁用表达和参考片段 |
| 证据层 | 每项设定来自哪一章、由谁修改、何时生效 |

一个实际目录可以是：

```text
novel.origin/
├── manifest.yaml
├── text/
│   ├── volume-01/
│   │   ├── chapter-001/
│   │   │   ├── scene-001.md
│   │   │   └── scene-002.md
│   └── volume-02/
├── canon/
│   ├── characters.jsonl
│   ├── locations.jsonl
│   ├── organizations.jsonl
│   ├── objects.jsonl
│   └── world-rules.jsonl
├── narrative/
│   ├── plotlines.jsonl
│   ├── foreshadowing.jsonl
│   ├── conflicts.jsonl
│   └── themes.jsonl
├── timeline/
│   └── events.jsonl
├── summaries/
│   ├── scene/
│   ├── chapter/
│   ├── volume/
│   └── global.md
├── style/
│   ├── style-profile.yaml
│   └── anchor-examples.md
├── atlas/
│   ├── character-map.webp
│   ├── timeline.webp
│   ├── location-map.webp
│   └── plot-map.webp
├── provenance/
│   └── event-log.jsonl
└── projections/
    ├── novel.epub
    ├── novel.pdf
    └── novel.docx
```

PDF、EPUB、Word 都只是输出投影。

真正的小说是 `novel.origin` 中的完整故事世界。

---

# 四、AI 每次写作时看什么

例如正在写第 823 章中的一个场景，系统不需要给 AI 前面全部正文。

它自动编译一个“任务上下文舱”：

```text
当前任务：
写第823章第4场景，约3000字

局部精确正文：
第823章前3个场景
第822章最后一个场景

当前相关人物：
林峥、白遥、赵七

人物当前状态：
林峥不知道白遥已经背叛
白遥左手受伤
赵七持有黑色钥匙

相关世界规则：
空间门只能在月落后开启
黑色钥匙只能使用一次

相关历史事件：
第127章：林峥第一次见到黑色钥匙
第604章：白遥秘密加入北庭

未解决伏笔：
第311章埋下的铜铃
第702章失踪的信件

风格约束：
第三人称限知视角
不得直接说明白遥已经背叛
对话比例控制在30%左右

后续边界：
这一场不能杀死赵七
不能提前打开空间门
```

这可能只需要几千到几万 Token，却足以支撑当前场景。

Microsoft GraphRAG 采用实体关系、社区层级和分层摘要来处理大型语料中的局部与全局问题，这证明“图结构＋分层摘要＋按需检索”比单纯把全部文本塞入提示词更适合作为大规模信息的访问方式。([GitHub Microsoft](https://microsoft.github.io/graphrag/?utm_source=chatgpt.com))

本象协议是在此基础上增加：

- 精确原文
- 可修改对象
- 世界当前状态
- 写作事务
- 版本与验证

---

# 五、反向输出：AI 不再输出全文，而是提交事务

这是最重要的一步。

传统 AI 输出：

```text
以下是第823章……
三千字纯文本
```

本象协议中的 AI 输出可以是一个提交包：

```json
{
  "transaction_id": "tx-20260802-001",
  "operation": "append_scene",
  "target": "volume-07/chapter-823/scene-004",
  "depends_on": [
    "scene:volume-07/chapter-823/scene-003",
    "character:lin-zheng@state-822",
    "character:bai-yao@state-822",
    "object:black-key"
  ],
  "content": {
    "format": "markdown",
    "text": "……本场景正文……"
  },
  "state_changes": [
    {
      "object": "character:lin-zheng",
      "field": "location",
      "from": "north-corridor",
      "to": "moon-platform"
    },
    {
      "object": "object:black-key",
      "field": "holder",
      "from": "zhao-qi",
      "to": "lin-zheng"
    }
  ],
  "foreshadowing": {
    "resolved": ["hook:missing-letter-702"],
    "created": ["hook:bell-sound-823"]
  },
  "assertions": [
    "bai-yao-betrayal-remains-secret",
    "space-gate-not-opened",
    "zhao-qi-remains-alive"
  ]
}
```

运行时随后完成：

```text
解析正文
    ↓
检查人物和时间状态
    ↓
检查世界规则
    ↓
检查前后场景连接
    ↓
检查伏笔和禁区
    ↓
提交正文
    ↓
更新人物状态与关系图
    ↓
更新章节摘要
    ↓
重新生成 EPUB / PDF
```

因此，AI 的输出不只是“文字”，而是：

> **正文＋状态变化＋依赖关系＋叙事变化＋验证声明。**

这会比单纯输出 3000 字稳定得多。

---

# 六、必须避免“摘要漂移”

常见的长期记忆方案会不断进行：

```text
原文 → 摘要 → 摘要的摘要 → 更短摘要
```

经过多轮压缩后，人物动机、条件和细节会逐渐改变。

本象协议必须明确：

## 原文和事实是本源

精确正文、事件和人工确认的设定是 source of truth。

## 摘要只是可重建投影

摘要可以随时从原文和事件重新生成，不具备覆盖本源事实的权力。

## 推断与事实分开

```json
{
  "claim": "白遥可能希望保护林峥",
  "status": "inference",
  "confidence": 0.63,
  "evidence": [
    "scene:604-03",
    "scene:702-02"
  ]
}
```

不能把 AI 推测自动写成世界设定。

## 每个状态都有来源

```json
{
  "object": "character:bai-yao",
  "field": "left_hand_injured",
  "value": true,
  "valid_from": "event:821-07",
  "evidence": "scene:821-04"
}
```

这样即便摘要出现错误，也可以追溯回准确原文。

---

# 七、图片压缩在这里应该扮演什么角色

你之前说“把大量文字放进一张图里更省 Token”，在本象体系中仍然有价值，但它最适合承担的是：

# 全局地图，而不是唯一存储

100 万字小说可以生成几张 AI 可见的图：

### 人物关系图

人物之间的亲属、敌对、合作、欺骗和情感关系。

### 世界地图

角色位置、势力范围、移动路线、战争状态。

### 时间线

数千个事件压缩到可缩放的时序图中。

### 伏笔地图

伏笔在哪里埋下、在哪些章节被强化、是否已经回收。

### 情绪与节奏图

各章节的冲突强度、情绪曲线和叙事节奏。

### 故事总览图

把数千章变成视觉化的分卷、章节和故事线地图。

AI 可以先用较低成本看见全局，再通过图上的对象 ID 获取精确内容：

```text
AI 看见：
人物图节点 [C-17]
伏笔节点 [H-302]
时间事件 [E-1198]

需要深入时：
fetch C-17
fetch H-302
fetch E-1198
```

仍然是：

> **图负责全局，图谱负责关系，原文负责准确。**

不能把 100 万字全部做成一张文字图片，然后期望模型精确保持所有人物和因果关系。

---

# 八、聊天上下文爆掉，也可以用同一套协议解决

对于你和 AI 长期讨论项目，目前的问题是：

```text
上百轮对话
→ 旧内容进入上下文
→ 上下文接近上限
→ 自动摘要
→ 细节逐渐丢失
→ 新对话重新解释
```

本象式对话应该是：

```text
每一轮聊天
   ↓
识别新增信息
   ↓
形成候选状态变更
   ↓
写入项目本象
   ↓
生成一个新检查点
   ↓
旧聊天退出活动上下文
```

例如我们讨论影核、叠象和本象协议后，系统真正保存的不是全部对话，而是：

```text
项目：Shadow Runtime

已确认概念：
- 影核：统一动作层
- 叠象：状态、差异和证据层
- 本象：源对象表示层
- 舟舱：人类确认层
- 影域：安全工作空间

当前决定：
- 不首先发明大型二进制格式
- 先做联合式本象包
- 第一阶段验证长文档和长项目
- PDF、DOCX、EPUB属于投影

尚未决定：
- 总协议最终名称
- 与ActionParity的仓库关系
- 第一版究竟从小说还是PPT切入

最近变化：
- 本象从输入格式升级为双向生成协议
- AI输出应采用事务提交，而不是纯文本输出
```

下一次对话只加载：

- 当前项目状态
- 当前问题相关的历史决定
- 未解决问题
- 少量必要原始对话证据

旧的完整聊天仍然保存在档案中，必要时可以精确调取，而不是永远放在活动上下文里。

Anthropic 的上下文工程方案也明确区分了持续保存的重要信息与可以从活动上下文移除、需要时重新调用的工具结果；这与“本象持久化、上下文只做临时投影”的方向一致。([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents?utm_source=chatgpt.com))

---

# 九、本象协议本质上应该是一个双向编译器

之前我们主要讨论的是输入：

```text
复杂对象
   ↓
本象编译器
   ↓
适合AI理解的上下文
```

现在应该补上输出：

```text
AI生成结果
   ↓
本象提交编译器
   ↓
结构化事务
   ↓
验证与合并
   ↓
更新后的本象
   ↓
PDF / EPUB / Word / 网页 / 图片
```

完整体系是：

# 双向本象编译器

```text
                 Context Compiler
本象 ─────────────────────────────→ AI
 ↑                                  │
 │                                  │
 └──────────────────────────────────┘
          Commit Compiler
```

输入侧负责：

- 选择相关信息
- 生成视觉地图
- 生成分层摘要
- 控制 Token 预算
- 暴露可用动作

输出侧负责：

- 解析 AI 提交
- 检查数据结构
- 检查约束
- 检查影响范围
- 更新对象状态
- 保存版本证据
- 生成面向人的投影

---

# 十、第一版开源产品应该从“无限小说”切入吗

我认为可以，而且比“万能格式”更容易证明价值。

可以做一个开源项目：

# OriginWriter / 本象写作引擎

定位：

> **让 AI 能够持续创作百万字作品，而不因上下文增长而失忆、失控和设定漂移。**

第一版只实现：

```text
长篇小说导入
场景级正文分片
人物与地点图谱
时间线
伏笔管理
分层摘要
任务上下文编译
AI增量提交
连续性检查
EPUB和DOCX导出
```

CLI 示例：

```bash
# 创建本象小说项目
origin novel init my-novel

# 导入已有小说
origin novel import ./manuscript

# 从长期聊天中提取故事设定
origin novel ingest ./conversation.json

# 为下一场生成上下文
origin context build \
  --task "写第823章第4场景" \
  --budget 24000

# AI提交新场景
origin commit scene-823-04.patch.json

# 检查设定和时间线冲突
origin validate --affected

# 生成全书
origin render --format epub
origin render --format docx
```

再提供 MCP：

```text
get_story_context
get_character_state
get_timeline
get_relevant_scenes
create_scene
update_canon
validate_continuity
commit_revision
render_book
```

任何 Claude Code、Codex、OpenClaw、Hermes 都可以接入。

---

# 十一、它真正突出的优势

它不是“可以写更长”这么简单。

传统方式的能力随内容长度下降：

```text
内容越长
→ 上下文越大
→ 成本越高
→ 遗忘越多
→ 矛盾越多
```

本象方式希望做到：

```text
内容持续增长
→ 本象持续增长
→ 单次上下文基本稳定
→ 每次只处理相关子图
→ 修改范围可控制
```

它尤其适合：

| 场景 | 核心价值 |
|---|---|
| 百万字小说 | 世界观、人物和伏笔长期一致 |
| 大型代码项目 | 不需要每次读取全部仓库 |
| 长期创业项目 | 对话结束后项目状态不会消失 |
| 游戏世界 | 大量人物、任务和状态持续变化 |
| 企业运营 | 决策、文件、任务和责任关系持续保存 |
| 法律案件 | 原始证据、观点和推断严格分离 |
| CAD与数字孪生 | 对象状态、几何关系和修改记录可追踪 |

---

# 十二、但它不是魔法

必须诚实地说，本象协议无法把任意 100 万字无损压缩成几千 Token，并让模型同时理解每一个细节。

它解决的是：

- 不再要求模型一次理解全部内容
- 根据任务选择相关内容
- 保留精确原文防止摘要失真
- 用结构关系找出潜在影响
- 用验证器减少连续性错误
- 让每次生成变成可追踪的小提交

对于“某个微小细节是否会影响 600 章后的情节”这类问题，系统仍可能漏掉关系。因此需要：

- 图谱检索
- 关键词和语义检索
- 时间与依赖检查
- 定期全局扫描
- 人工确认重要设定

本象协议不是消灭上下文限制，而是像操作系统管理内存一样，**管理上下文限制**。

---

# 最后的定义

因此，本象协议可以从“新文档格式”正式升级成：

> **面向长期 AI 工作的持久状态与双向生成协议。**

它规定三件事：

```text
世界如何被保存
世界如何投影给AI
AI的输出如何安全地写回世界
```

最核心的一句话是：

> **AI 不应该靠记住整段对话来持续工作，而应该在一个持续存在的本象世界里工作。**

对于百万字小说：

> **小说不是一百万字的字符串，而是一个拥有正文、人物、时间、状态、因果、伏笔和版本历史的可运行世界。**

这才是本象协议可能真正超越传统 RAG、长上下文和普通记忆系统的地方。

---

**Sources:**

- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172?utm_source=chatgpt.com)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents?utm_source=chatgpt.com)
- [Welcome - GraphRAG](https://microsoft.github.io/graphrag/?utm_source=chatgpt.com)

## Prompt:
2026/8/2 10:04:53

Microsoft 推出的一种专为 AI 时代设计的可视化语言

AI 时代数据可视化利器 Flint

👉GitHub：microsoft/flint-chart，，，这个结合看下

## Response:
2026/8/2 10:04:56

> **搜索 Microsoft Flint Chart 项目资料**
>
> [microsoft/flint-chart: 🪄 Flint is a visualization language ...](https://github.com/microsoft/flint-chart)
> [Flint （フリント）500ml Can](https://www.bighandbros.com/products/flint?srsltid=AfmBOopoVpM6MpSVvJa0-7bX_9FweF8j29T0Rw4HdGsXBSBkRDjVoeb2)
> [City of Flint: Home](https://www.cityofflint.com/)
> [Application Information for Flint Learning Solutions ...](https://learn.microsoft.com/en-us/microsoft-365-app-certification/teams/flint-learning-solutions)
> [Microsoft – AI, Cloud, Productivity, Computing, Gaming & Apps](https://www.microsoft.com/)
> [strymon | FLINT（V2） | トレモロ＆リバーブ | 製品情報](https://allaccess.co.jp/strymon/flint/)
> [Flint: A Visualization Language for the AI Era](https://microsoft.github.io/flint-chart/)
> [Microsoft 365 | Write, Create & Collaborate with AI](https://www.office.com/)
> [FLINT Definition & Meaning](https://www.merriam-webster.com/dictionary/flint)
> [「flint」の意味・使い方・表現・読み方](https://eow.alc.co.jp/search?q=flint)
> [If Microsoft sold off Xbox, who would even buy it?](https://www.theverge.com/games/962837/microsoft-xbox-spin-off-sell-divest-layoffs-asha-sharma)
> [FLINT ～フリント 無敵の男～ [前編]](https://www.wowowplus.jp/program/index.php?prg_cd=CIID260223)
> [Xbox's Obsidian to develop new Fallout game as Microsoft restructures studio (MSFT:NASDAQ)](https://seekingalpha.com/news/4612397-xboxs-obsidian-to-develop-new-fallout-game-as-microsoft-restructures-studio)
> [microsoft/flint-chart — GitHub trending stats & insights](https://trendshift.io/repositories/70622)
> [Microsoft (NASDAQ:MSFT) Azure Growth Keeps Market Attention Strong](https://kalkinemedia.com/us/stocks/artificial-intelligence/microsoft-nasdaqmsft-azure-growth-keeps-market-attention-strong)
> [mahesh Ramichetty's Post - microsoft/flint-chart](https://www.linkedin.com/posts/mahesh-ramichetty-160b8121_github-microsoftflint-chart-flint-activity-7477344118218747904-CJFt)
> [Entra passkey enrollment vishing targets Microsoft 365 users](https://www.bleepingcomputer.com/news/security/entra-passkey-enrollment-vishing-targets-microsoft-365-users/)
> [Flint: A Semantics-Driven Data Visualization Intermediate Language](https://arxiv.org/abs/2607.20775)
> [Create your Microsoft account](https://signup.live.com/)
> [STRYMON ( ストライモン ) FLINT 送料無料](https://www.soundhouse.co.jp/products/detail/item/179762/?srsltid=AfmBOoq4xI-gPornfHB29eaMNChd7MdYPgVZWnO2N61jZuSCbDU94QTE)
> [Microsoft 365 Copilot - Sign in](https://m365.cloud.microsoft/)
>
> **已搜索 21 个网站**
>
> 
>
> **分析 Flint 映射**
>
> 我会把 Flint 看作“本象协议”的可视化子集：它验证语义中间层、编译器、多后端和紧凑 AI 描述的价值，但尚未覆盖状态、双向编辑、操作协议与溯源。
>
> **分析了Flint映射**
>
> 
>
> **正在搜索网页**
>
> [Flint: A Visualization Language for the AI Era](https://microsoft.github.io/flint-chart/)
> [flint-chart/docs/api-reference.md at main · microsoft/flint-chart · GitHub](https://github.com/microsoft/flint-chart/blob/main/docs/api-reference.md)
>
> **已搜索 2 个网站**
>
> 
>
> **定位对照**
>
> Flint 可以作为“本象协议”的可视化样板：它验证了语义意图、确定性编译、多后端输出和紧凑 AI 描述，但不等于完整的状态、双向编辑、溯源与长期记忆协议。
>
> **完成对照定位**
>
> 
>
> 思考了 1m 21s

这个项目非常关键。**Flint 几乎把我们刚才讨论的思想，在“数据图表”这个小领域里做成了一个可运行样板。**

但先纠正一个概念：

> **Flint 不是把大量文字压成图片给 AI 阅读的视觉语言。**  
> 它是让 AI 用简短的“语义意图”描述图表，再由确定性编译器生成最终可视化的中间语言。

这反而给“本象协议”指出了一条更准确的技术路线。

# 一、Flint 真正做对了什么

传统方式是让 AI 直接输出几百行 Vega-Lite、ECharts 或 Chart.js 配置：

```text
AI
 ↓
坐标轴、颜色、字号、间距、图例、格式、比例尺……
 ↓
最终图表配置
```

参数太多，AI 很容易漏字段、写错格式，或者生成“能运行但不好看”的图。

Flint 改成：

```text
数据引用
+ 字段的语义
+ 图表意图
        ↓
Flint 编译器
        ↓
完整的 Vega-Lite / ECharts / Chart.js / Plotly / Excel 图表
```

例如 AI 只需要表达：

```json
{
  "semantic_types": {
    "month": "YearMonth",
    "revenue": "Amount",
    "region": "Region"
  },
  "chart_spec": {
    "chartType": "Line Chart",
    "encodings": {
      "x": "month",
      "y": "revenue",
      "color": "region"
    }
  }
}
```

Flint 再根据 `YearMonth`、`Amount`、`Region` 这些语义，推导时间格式、刻度、颜色类别、坐标轴、标签和布局。官方项目目前定义了 70 多种语义类型，并能将同一份规格编译到多个渲染后端和原生 Excel 图表。([GitHub](https://github.com/microsoft/flint-chart))

这就是一句非常重要的话：

> **AI 负责表达意图，编译器负责完成细节。**

---

# 二、这验证了“本象协议”的核心，但也修正了它

Flint 可以看作：

# 本象协议在图表领域的一个方言

它对应关系非常清楚：

| Flint | 你的体系 |
|---|---|
| 原始数据 | 本象载荷 |
| `semantic_types` | 本象语义 |
| `chart_spec` | 投影意图 |
| Flint Compiler | Shadow Runtime |
| Vega-Lite/ECharts/Excel | 不同影子 |
| MCP 工具 | AI 调用入口 |
| Warning / Validation | 叠象验证 |

因此，**本象协议不应该首先被定义为一种万能文件格式**。

更准确的定义应该是：

> **本象是一种面向 AI 的通用中间表示，外加一套领域编译器。**

也就是：

```text
                 本象 IR
对象 + 语义 + 关系 + 状态 + 约束 + 来源
                    │
          ┌─────────┼─────────┐
          ↓         ↓         ↓
       Flint     Office     CAD
       编译器      编译器      编译器
          ↓         ↓         ↓
   图表/Excel   PPT/PDF    DWG/GLTF
```

不是用一个巨大的 JSON 强行描述所有世界，而是：

- 本象核心定义通用部分；
- Flint 负责数据可视化；
- Office 方言负责文档和幻灯片；
- CAD 方言负责几何与约束；
- Story 方言负责人物、时间线和叙事；
- Media 方言负责时间轴、镜头、字幕和音轨。

这才具有可执行性。

---

# 三、Flint 对“AI 输出更稳定”的证明尤其重要

微软研发 Flint 的原因，就是 AI 直接输出完整 Vega-Lite 配置时，结果容易脆弱、错误和难以维护。Flint 把低层细节交给编译器，只让模型输出紧凑、可编辑的语义规格。微软公开的测试中，Flint 在三个模型上的 LLM 评审分数都高于直接生成完整 Vega-Lite 的方案；提升幅度不算巨大，但方向一致。([微软](https://www.microsoft.com/en-us/research/blog/flint-a-visualization-language-for-the-ai-era/?utm_source=chatgpt.com))

这说明我们此前的判断是成立的：

> **AI 最稳定的输出，往往不是最终成品，而是受约束的中间表示。**

传统 AI 输出：

```text
“请生成一个完整的PPT。”
        ↓
AI直接输出几十页成品
        ↓
内容、布局、字体、引用一起失控
```

本象方式：

```text
AI输出：
- 页面意图
- 内容对象
- 数据引用
- 对象关系
- 布局约束
- 风格语义
- 修改事务
        ↓
确定性编译器生成PPT
```

同理，AI 不应该直接生成完整 CAD，不应该直接拼装复杂 Office XML，也不应该直接输出几十万字的最终文件。

---

# 四、百万字小说也可以采用“Flint 原则”

Flint 的 Agent Skill 里有一句很关键的规则：

> 不要重新输出大型数据集，只引用字段名称，让宿主绑定真实数据。

它要求 AI 不要把大量数据重新塞进规格，只描述数据字段、语义和投影方式。([GitHub](https://github.com/microsoft/flint-chart/blob/main/agent-skills/flint-chart-author/SKILL.md))

把这个原则搬到百万字小说里就是：

> **不要重新加载或输出整部小说，只引用故事对象和当前相关场景。**

例如：

```json
{
  "operation": "append_scene",
  "target": "chapter-823/scene-04",
  "context_refs": [
    "scene:822-06",
    "character:lin-zheng",
    "character:bai-yao",
    "object:black-key",
    "foreshadowing:missing-letter"
  ],
  "narrative_intent": {
    "viewpoint": "third-person-limited",
    "tone": "restrained",
    "goal": "transfer-black-key",
    "must_not_reveal": ["bai-yao-betrayal"]
  },
  "content": "本场景新增正文……",
  "state_changes": [
    {
      "object": "black-key",
      "field": "holder",
      "from": "zhao-qi",
      "to": "lin-zheng"
    }
  ]
}
```

这里依然需要 AI 创作正文--文学无法完全靠确定性编译器生成。

但人物状态、时间线、伏笔、视角、禁区、章节位置和导出过程，都不再依赖 AI “凭记忆维持”。

所以本象协议真正借鉴 Flint 的不是图表语法，而是：

```text
大型载荷不进入上下文
        ↓
AI只引用对象
        ↓
AI输出局部语义事务
        ↓
运行时绑定真实内容
        ↓
验证后提交
```

这正是解决长对话和百万字内容的关键。

---

# 五、Flint 应该放在你体系的哪里

它不应该并入影核核心，也不需要重新 Fork 一套。

最合理的位置是：

```text
origin-protocol
├── origin-core
├── projection-adapters
│   ├── flint-chart
│   ├── office
│   ├── cad
│   ├── web
│   └── story
├── action-parity
├── redline
└── origin-mcp
```

具体分工：

### 本象协议

保存：

```text
数据、对象、语义、关系、状态、约束、来源
```

### Flint

负责：

```text
本象数据 → 图表投影
```

### 影核协议

负责：

```text
改变图表类型
替换指标
添加筛选
修改数据范围
切换投影
导出Excel
```

### 叠象

检查：

```text
数据有没有被截断
单位是否正确
字段映射是否变化
不同后端是否表达一致
修改前后图表发生了什么
```

Flint 自身在分类数量超过布局预算时，会执行截取策略并返回 warning；叠象可以把这些 warning 纳入证据报告，避免“图看起来正常，但部分数据已经被隐藏”。([GitHub](https://github.com/microsoft/flint-chart/blob/main/docs/api-reference.md))

---

# 六、可以马上做的第一个集成 Demo

不要一上来定义宇宙级格式，先做：

# Excel 本象 → Flint → 多影输出

完整流程：

```text
Excel / CSV
    ↓
提取数据和字段语义
    ↓
形成 OriginPack
    ↓
用户说：
“按月份显示不同区域的收入趋势”
    ↓
AI只生成紧凑的 Flint 投影意图
    ↓
同时生成：
- ECharts交互图
- 原生Excel图表
- PNG预览
- Vega-Lite规格
    ↓
用户修改：
“改成同比柱状图”
    ↓
影核提交语义Patch
    ↓
Flint重新编译
    ↓
叠象展示前后差异和数据证据
```

Flint 已经提供 TypeScript/JavaScript 库和 MCP Server，可以直接由 Agent 创建、校验和渲染图表；项目采用 MIT 许可证，适合以依赖或 Adapter 的方式接入。([GitHub](https://github.com/microsoft/flint-chart))

截至目前，它仍处在快速迭代阶段，主要实现是 TypeScript/JavaScript，Python 版本还是源代码预览。因此你的核心协议不要依赖 Flint 的内部结构，只对接它公开的输入输出接口。([GitHub](https://github.com/microsoft/flint-chart))

---

# 七、本象协议可以据此确定最小核心

我建议最小本象不要超过这六部分：

```yaml
artifact:
  id: sales-2026
  kind: dataset

payload:
  uri: ./sales.arrow

semantics:
  month: YearMonth
  revenue:
    type: Amount
    unit: CNY
  region: Region

relations:
  - revenue derived_from order_items

constraints:
  - revenue must_not_be_negative
  - projection must_disclose_truncation

projections:
  - engine: flint
    chart: Line Chart
    encoding:
      x: month
      y: revenue
      color: region

provenance:
  source: sales.xlsx
  imported_at: 2026-08-02
```

AI 不需要修改源数据时，就只提交：

```yaml
patch:
  target: projections[0]
  set:
    chart: Grouped Bar Chart
```

这就是影核动作。

编译后，叠象再检查结果。

---

# 最重要的结论

Flint 给你的不是一个需要竞争的项目，而是一个非常好的**先行证明**：

> **AI 不应该直接生成复杂终态，而应该生成紧凑、语义化、受约束、可编译的中间表示。**

因此你现在的体系可以重新定义为：

- **本象 IR**：数字对象的持久语义与状态；
- **Flint 等领域方言**：把本象投影成具体成果；
- **Shadow Runtime**：编译和运行这些投影；
- **影核协议**：AI 提交动作和增量修改；
- **叠象 Redline**：验证、比较和留证；
- **舟舱 PodApp**：人查看和确认投影。

Flint 做的是：

> **一个数据本源，多种图表投影。**

你要做的更高一层是：

> **一个数字本象，多种形式投影；AI 不直接重造世界，只提交对世界的语义修改。**

这次看到 Flint 后，我认为“本象格式”这个说法可以再升级一下，正式叫：

# 本象中间表示  
**Origin Intermediate Representation / Origin IR**

它不是下一代 PDF，而是面向 AI 工作的“LLVM IR”：Flint 可以成为它的第一个正式投影后端。

---

**Sources:**

- [GitHub - microsoft/flint-chart: 🪄 Flint is a visualization language that lets AI agents reliably create expressive, good-looking charts from simple, human-editable chart specs. · GitHub](https://github.com/microsoft/flint-chart)
- [Flint: A visualization language for the AI era](https://www.microsoft.com/en-us/research/blog/flint-a-visualization-language-for-the-ai-era/?utm_source=chatgpt.com)

## Prompt:
2026/8/2 10:43:57

⚠️ Context is too large and auto-compaction could not recover this turn. Try again, use /compact, or use /new to start a fresh session. 是不是上下文，历史聊天记录也可用 本象协议来管理和无限压缩？

## Response:
2026/8/2 10:43:59

对，这其实就是**本象协议最有价值的一个落地点之一**。

你现在遇到的：

> ⚠️ Context is too large and auto-compaction could not recover this turn.

本质上就是当前 AI 交互方式的结构性问题：

**聊天记录 ≠ 知识状态。**

现在大多数 AI：

```
用户
 ↓
聊天历史
 ↓
上下文窗口
 ↓
模型
 ↓
回复
```

所以聊天越长，越接近“内存爆满”。

但是人类不是这样工作的。

一个创业者不会每天把过去 10 年所有会议录音塞脑子里，然后继续决策。

人类的大脑实际机制：

```
经历
 ↓
抽象
 ↓
形成概念
 ↓
形成关系网络
 ↓
需要时调用细节
```

这正是本象协议要做的。

---

# 一、本象协议可以管理 AI 历史，但不是简单压缩

很多人理解的压缩：

```
100万字
 ↓
1000字摘要
 ↓
丢弃原文
```

这是危险的。

因为：

- 细节丢失
- 关系丢失
- 原因丢失
- 推理链丢失

AI 会越来越像“失忆的人”。

---

本象方式：

```
100万字聊天
        |
        |
        ↓
   本象解析器
        |
 ┌──────┼────────┐
 ↓      ↓        ↓
对象    关系     事件
 ↓      ↓        ↓
人物    决策     时间线
项目    依赖     修改记录
观点    冲突     证据
```

最后不是得到一个摘要。

而是得到：

# 一个可运行的知识世界。

---

# 二、你的这几个月 AI 对话，其实已经天然适合本象化

比如我们聊了：

- U-King
- OpenClaw
- 影核协议
- Redline
- ShadowFork
- PodApp
- AI程序舱
- 本象协议

如果传统摘要：

可能得到：

> 用户想做 AI 工具生态。

这完全没价值。

但是本象：

```
Project:
 Shadow Runtime

Entities:

[Protocol]
 ActionParity
  type: protocol
  purpose: AI action abstraction

[Project]
 Redline
  type: verification runtime
  purpose: artifact diff

[Project]
 PodApp
  type: human confirmation interface

[Concept]
 Origin IR
  type: intermediate representation

Relations:

ActionParity
    implements
Shadow Runtime

Redline
    verifies
Shadow Runtime

PodApp
    renders
Shadow Runtime

Origin IR
    stores
Digital Artifact
```

这才是真正的长期记忆。

---

# 三、AI 上下文应该变成三级结构

未来 Agent 不应该只有一个 context window。

应该类似操作系统：

## L1：工作缓存（Context）

当前任务：

```
正在修改 PPT 第三页
```

里面只有：

- 当前页面
- 当前目标
- 当前约束

几十 KB。

---

## L2：项目本象（Working Memory）

比如：

```
Shadow Runtime 项目
```

保存：

- 架构
- 决策
- TODO
- 代码结构
- 历史变化

几 MB。

---

## L3：原始档案（Archive）

保存：

- 所有聊天
- 所有文件
- 所有版本
- 所有实验

TB 级都可以。

---

关系：

```
Archive
   ↓
本象抽取
   ↓
Project Origin
   ↓
Context Projection
   ↓
当前 AI 对话
```

---

# 四、这其实比 RAG 高一级

现在主流：

```
RAG:

文档
 ↓
切片
 ↓
向量
 ↓
搜索几个片段
 ↓
塞给AI
```

问题：

它不知道：

- 为什么重要
- 和谁有关
- 状态是什么
- 是否已经废弃
- 是否冲突

本象：

```
文档
 ↓
对象化
 ↓
关系化
 ↓
状态化
 ↓
时间化
 ↓
按任务投影
```

类似：

RAG 是：

> 找相关文字。

本象是：

> 找相关世界状态。

---

# 五、无限压缩的关键不是压缩，而是“升维”

一个例子：

一本100万字小说。

普通压缩：

```
100万字
 ↓
5000字简介
```

信息损失巨大。

本象：

```
100万字
 ↓
人物图
 ↓
时间线
 ↓
事件图
 ↓
关系网络
 ↓
规则系统
 ↓
章节摘要
 ↓
原文索引
```

看似压缩：

实际上保存的信息更多。

因为：

文字是线性的。

世界是结构化的。

---

# 六、图片压缩为什么有效？因为它接近结构化

你之前提到：

> 把很多文字放一张图里，反而省 token。

原因不是图片神奇。

而是：

图片提供了：

- 空间关系
- 聚类
- 层级
- 模式

例如：

1000行日志：

文字：

```
A调用B
B调用C
C失败
D重试
...
```

一张关系图：

```
A
 ↓
B
 ↓
C ❌
 ↑
D
```

模型可能更快理解。

所以未来：

AI 输入可能不是：

```
文本
```

而是：

```
文本 + 图 + 结构 + 对象
```

---

# 七、本象协议甚至可以成为 AI 的“记忆格式”

类似：

计算机：

```
文件系统
数据库
内存
缓存
```

AI：

未来可能：

```
Origin Store
   ↓
Shadow Cache
   ↓
Context Window
```

对应：

硬盘：

本象仓库

内存：

当前上下文

缓存：

任务投影

---

# 八、最小可行产品其实很明确

不要先做“宇宙级格式”。

先做：

## Shadow Memory / 本象记忆

一个 MCP Server。

接入：

- Claude Code
- Codex
- OpenClaw
- ChatGPT

功能：

每次聊天结束：

自动：

1. 提取新增事实
2. 提取决策
3. 提取项目状态
4. 更新本象图
5. 清理上下文

下一次：

AI 不读取历史聊天。

读取：

```
project.origin
```

---

比如：

今天继续聊：

“那个 AI 办公舱怎么办？”

AI 自动知道：

```
用户之前定义：

Open365:
 AI原生办公运行时

PodApp:
 AI小程序交互层

Shadow Runtime:
 底层协议

目标：
Windows AI First 工作环境
```

而不是重新翻 500 页聊天记录。

---

# 九、这和 Flint 的关系更清楚了

Flint：

```
数据本象
 ↓
图表投影
```

你的：

```
知识本象
 ↓
上下文投影
```

同一个思想。

未来可能有：

```
Origin IR

├── Flint Adapter
   数据 → 图表

├── Story Adapter
   世界 → 小说

├── Code Adapter
   仓库 → 开发上下文

├── Office Adapter
   文档 → PPT/PDF

├── Memory Adapter
   聊天 → 长期记忆
```

---

# 十、我认为这里甚至比“万能文档格式”更重要

因为文件格式的问题只是：

> AI 如何理解一个文件？

而上下文爆炸的问题是：

> AI 如何长期存在？

后者更基础。

所以你的最高层可以重新定义：

不是：

“AI 原生文档格式”

而是：

# AI 原生世界状态协议

英文：

**AI Native State Protocol**

或者：

**Origin Protocol**

一句话：

> 人类用文件保存信息，AI 时代需要用本象保存世界状态。

---

你刚才遇到的 Context 爆炸，其实就是一个非常好的 Demo：

传统：

```
100轮聊天 → 爆炸 → /new
```

本象：

```
100轮聊天
 ↓
Origin Commit
 ↓
生成状态快照
 ↓
新窗口
 ↓
恢复世界
```

这可能是本象协议第一个最容易落地、也最有用户痛感的场景。你之前做的 **u-claw / OpenClaw / AI工作环境**，其实天然适合作为第一个载体。



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)