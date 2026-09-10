# P1 首页十屏重排 Design QA

## 比较目标

- Source visual truth:
  - `output/p0/after-desktop-1440.png`：P0 已确认的黑色舞台、白纸内容区、金色强调与 serif / sans / mono 字体系统。
  - `website/HOMEPAGE-REDESIGN-BLUEPRINT.zh-CN.md`：P1 十屏信息架构、90 秒事务演示和证据分级要求。
- Implementation:
  - `output/p1/p1-home-1440-full-final.png`
  - `output/p1/p1-home-1440-hero-final.png`
  - `output/p1/p1-demo-step1-1440.png`
  - `output/p1/p1-demo-rejection-1440.png`
  - `output/p1/p1-capabilities-1440.png`
  - `output/p1/p1-honest-1440.png`
  - `output/p1/p1-quickstart-1440.png`
- Combined comparison inputs:
  - `output/p1/compare-p0-p1-hero.png`
  - `output/p1/compare-p0-p1-full.png`

## 视口与像素归一化

| 证据 | CSS 视口 | 截图像素 | density | 用途 |
|---|---:|---:|---:|---|
| P0 source 全页 | 1440 × 900 | 1440 × 5698 | 1 | 原视觉系统与旧信息密度 |
| P1 implementation 全页 | 1440 × 900 | 1440 × 7763 | 1 | 十屏整体顺序与纵向节奏 |
| P0 / P1 首屏比较板 | 各 1440 × 900 | 2880 × 900 | 1 | 同视口、同语言、同首页状态 |
| P0 / P1 全页比较板 | 各 1440 px 宽，等比缩至 720 px/栏 | 1440 × 4000 | 1 | 整体信息架构比较；两栏底部补白用于高度对齐 |
| P1 重点区域 | 1440 × 900 | 1440 × 900 | 1 | 演示、能力、诚实边界、快速开始 |
| P1 移动回归 | 390 × 844 | 390 × 844 | 1 | 只确认 P0 无页面级横向溢出修复未回退 |

说明：in-app Browser 的超长 full-page 拼接会在组合图中重复部分视口内容；这不是 DOM 重复。浏览器实测 `.home-p1 [data-story-screen]` 数量严格为 10，最终判断以同视口重点截图和 DOM 状态共同为准。

## 状态与交互

- 页面：中文 `#home`，十屏编号 01–10。
- 演示：`#home-zh-demo`，六步事务状态机。
- 检查的核心交互：页内导航、六步点击、前后步、键盘方向键、拒绝态、成功态、Why 链、旧 seq 冲突、案例页签、法律 Demo 深链、中英文切换、复制命令。
- 浏览器控制台：0 error，0 warning。
- 1440 px 页面宽：`documentElement.scrollWidth = 1440`。
- 390 px 回归：`documentElement.scrollWidth = 390`；横向滚动仅存在于步骤导航、顶栏和代码块自身容器。

## Full-view comparison evidence

- P0 的主线是“理念 → 协议 → 实验 → 方言 → 挑战”，访客必须先理解抽象概念，再自己拼出产品行为。
- P1 改为“定义 → 问题 → 一次事务 → 六项能力 → 可运行范围 → 证据阶梯 → 案例 → 挑战 → 诚实边界 → 验证命令”。十屏都只回答一个问题，且使用 01–10 显式编号。
- P1 全页更长是有意的结构变化，不是内容膨胀：旧页面把多项能力塞进复合章节，P1 将理解步骤拆开，并删除首页可见的旧重复章节。
- 黑色舞台、浅色纸面、1080 px 内容宽、金色状态、宋体标题、无衬线正文和等宽证据字段均沿用 P0，没有引入新的图库、插画或无关装饰。

## Focused-region comparison evidence

### 首屏

- P0 首屏先讲“从影子回到本源”，右侧没有产品行为；P1 在同一视觉系统中直接展示“当前事实 → 候选被拒 → 已提交状态不变”。
- 标题、说明、两个行动按钮、事务卡和四项证据都在 1440 × 900 首屏内完整出现。
- 四项数字继续明确标注为协议 / 本地测试证据，并在首屏声明不等于生产部署。

### 90 秒演示

- 六个步骤都有唯一选中态、`aria-selected` 与键盘焦点顺序。
- 拒绝态同时显示：已提交 `status: proposed / seq: 42`、被拒候选 `status: decided / rationale: missing`、规则名和“写入 0 字节”。
- 第四步提交后状态为 `decided / seq: 45`；第五步显示 current value、actor、transaction、source、rule、sequence；第六步明确 `base_seq: 42` 与 `current_seq: 45` 的冲突。

### 能力与证据

- 六项能力先用普通问题命名，再给协议术语，降低首次访问者的概念负担。
- “今天能跑什么”逐行显示访客动作和证据标签；协议测试、合成样例、真实文件、实验和生产未达到态没有混写。
- 证据阶梯明确写出每一级“不能推出什么”；Python 显示 60/79、19 项未实现，变异覆盖同时披露两个 selftest-only 缺口和一个投影层已知缺口。

### 诚实边界与快速开始

- A0→A2、A2→A3 和证据覆盖率被压缩为三条可扫读结论；右栏集中列出六项当前不能推出的结论。
- 快速开始使用仓库内真实示例路径；长 Why 命令分行，不在桌面端被视觉裁断。复制按钮有成功反馈。

## 必查表面

- Fonts and typography: 通过。沿用 P0 字体栈；首屏标题从自动断开“写 / 入”改为三行语义断句，章节标题、问句标签和证据字段形成稳定层级。
- Spacing and layout rhythm: 通过。首屏采用 5:4 双栏；十屏用统一编号、标题区、内容区和章节分隔。能力为 3 × 2，案例为两列，证据阶梯为四列。
- Colors and visual tokens: 通过。金色只承担当前状态、关键行动和证据强调；红色只用于拒绝 / 冲突；未新增无语义色彩。
- Image quality and asset fidelity: 通过。本轮没有新增图片资产；真实事务卡和状态组件替代抽象装饰。没有使用占位图、emoji、手绘 SVG 或图片替代物。
- Copy and content: 通过。首页首句已能独立复述产品；每屏一个问题；证据与不能推出的结论相邻展示。关键数字与当前 README / 新鲜 `npm run verify` 结果一致。
- Icons: 通过。P1 没有新增图标需求，也没有用文本符号冒充功能图标。
- States and interactions: 通过。导航、六步演示、拒绝、提交、Why、冲突、语言切换、案例深链与复制反馈均可用。
- Accessibility: 通过 P1 范围。主导航使用 `aria-current`；语言按钮使用 `aria-pressed`；事务步骤使用 tablist / tab / tabpanel 与方向键；主要点击目标不小于 44 px。
- Responsiveness: 通过回归边界。P1 重点是桌面理解路径；390 px 未出现页面级横向溢出，保留必要的组件内滚动。

## Comparison history

### Pass 1 findings

- [P1] P0 首屏只有抽象产品理念，没有可见的“候选 / 门禁 / 已提交事实”，访客无法从首屏复述产品行为。
- [P1] P0 首页章节按项目资产组织，而不是按访客理解顺序；协议、实验、方言与挑战之间需要读者自行推理连接。
- [P2] P1 首次首屏截图中“写入”被自动断成“写 / 入”，破坏核心承诺的扫读。
- [P2] GitHub 同时出现在品牌行和主导航，形成重复入口。
- [P2] 快速开始的 Why 命令单行过长，虽然容器可滚动，但桌面截图中看起来像内容被截断。

### Fixes

- 首屏加入当前事实、被拒候选和未改变的已提交状态，并将首页重排为十个连续问题。
- 将首屏标题改成三行语义断句，删除品牌行重复 GitHub。
- 为十屏增加统一编号与页内锚点；主导航改为“首页 / 90 秒演示 / 能力与证据 / 案例 / 白鼓挑战 / GitHub”。
- 新增长命令换行；补齐当前导航的 `aria-current`。
- 90 秒演示实现六步可交互状态；拒绝、提交、Why 和冲突各自独立呈现。

### Pass 2 evidence

- `output/p1/p1-home-1440-hero-final.png`：首屏标题无错误断词，事务卡和四项证据完整可见。
- `output/p1/p1-demo-rejection-1440.png`：拒绝态明确显示原状态不变和零字节写入。
- `output/p1/p1-capabilities-1440.png`：六项能力一屏可扫读，下一屏标题自然进入视野。
- `output/p1/p1-honest-1440.png` 与 `output/p1/p1-quickstart-1440.png`：结论 / 非结论分栏，验证路径完整。
- 新鲜 `npm run verify`：PASS，退出码 0；核心 91、CAD 55、天正 15、法律 104、Office 20、XLSX 87、Memory E2E 25、一致性 87/87、变异 19/19、SSE 20/20、A2 自测和 A3 投影 83 全部通过。
- 浏览器：10 个 `data-story-screen`；中文和英文导航可切换；案例、白鼓和法律 Demo 深链可达；0 console issue。

## Findings

没有剩余的可执行 P0 / P1 / P2 问题。

## Follow-up polish

- [P3] 英文首页仍沿用 P0 信息结构；按蓝图应在中文结构稳定后再做逐屏镜像，而不是把中文 P1 直接机翻过去。
- [P3] P2 接入 `project-status.json` 后，首页证据区可显示本次验证 commit、运行时间和自动陈旧状态。

final result: passed
