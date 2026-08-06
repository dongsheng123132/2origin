你的任务：在 hequbing.com 官网博客发布一篇文章《全球第一个「AI 状态回写正确性」榜单：本象协议 ShadowBench-W》。

严格按以下步骤执行，不许跳步，不许编造：

## 0. 先加载技能
调用 skill_view(name='hequbing-site') 并完全遵循其中的流程（发布管线、SEO 清单、关键坑、提交身份、委派工作流）。

## 1. 素材来源（只准用这些，不许编造）
- 事实 1（榜单空白，已调研核实）：SWE-bench / GAIA / τ-bench / TerminalBench 全是 agent 能力榜，不考「状态是否被正确持久化」；全球没有持久对象层/状态写回验证的 leaderboard。W3（状态回写正确性）考题空白。
- 事实 2（ShadowBench-W 实测）：基准在 benchmark/shadowbench-w/，W3 状态回写正确率 A3 臂 98.9% vs 裸模型/RAG 的 75.0%（三十三轮实验）；三臂对比：A0 裸模型 / A1 RAG / A3 本象。
- 事实 3（文档赛道，已调研）：行业四层方案（pandoc 45.7k★ / markitdown 171k★ / MinerU 76.9k★ / LlamaParse）全在啃 PDF 扫描件；OmniDocBench（CVPR 2025）表格 TEDS≈0.78 封顶（中文更低 0.752）——OCR 物理误差是天花板。原生电子文档（docx/xlsx/pptx）无损结构化「无人认真做」：markitdown 不还原合并单元格、pandoc 复杂 docx 漏表。
- 事实 4（本象实测）：海事局红头文件 2019 → 409 个结构对象（6 章/77 条/16 表/59 勾选），verify 一致；「转换即语义事务」+ SHA-256 结构指纹可验证。
- 事实 5（名字冲突）：GitHub 搜 shadowbench 已有 4+ 项目占用，本基准用全名 ShadowBench-W。
- 仓库：github.com/dongsheng123132/2origin

## 2. 写文章（HTML content）
- title: 全球第一个「AI 状态回写正确性」榜单：ShadowBench-W
- slug: shadowbench-w-world-first
- date: 2026-08-06
- 正文 HTML（h3/p/ul/strong/blockquote/table），受众 = AI 从业者/研究者
- 结构：
  ① 开篇：一个没人定义过的考题——「AI 改完世界，世界对不对？」
  ② 全球现状：四大 agent 榜都不考状态持久化，列表佐证
  ③ ShadowBench-W：三臂（A0 裸模型/A1 RAG/A3 本象）+ W1/W3 双判分 + 实测数字
  ④ 文档赛道第二战场：OCR 物理误差天花板 vs 原生无损结构化（表格式对比）
  ⑤ 结论：定义考题的人拿标准制定权；开放榜单 + 开源
- 必须带「诚实边界」声明：实测基于单一模型、自造夹具、数字会随重跑更新
- 全文约 1000-1400 字

## 3. SEO 清单（每项都做）
- gh repo edit dongsheng123132/hequbing-blog --homepage "https://blog.hequbing.com/post?slug=shadowbench-w-world-first"
- public/sitemap.xml 追加该 slug
- CONTENT-PLAN.md 勾选
- 日期用 2026-08-06

## 4. 提交与验证
- git pull → 改 data/posts.json（python ensure_ascii=False indent=2）→ node server.js 冒烟 curl localhost:3000/api/posts/shadowbench-w-world-first
- 提交身份：-c user.name="dongsheng123132" -c user.email="hefangsheng@gmail.com"
- push 后独立验证：轮询 https://blog.hequbing.com/api/posts/shadowbench-w-world-first 直到 200 且 content 含「ShadowBench-W」
- gh 超时重试；需代理用 HTTPS_PROXY=http://127.0.0.1:7897

## 5. 最终报告（如实）
- commit hash、线上 URL 验证输出、SEO 逐项状态
- 失败如实报告，不许伪造成功

开始执行。
