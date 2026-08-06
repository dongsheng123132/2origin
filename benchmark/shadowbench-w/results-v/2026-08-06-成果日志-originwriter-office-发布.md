# 成果日志 · 2026-08-06（OriginWriter / origin-office / 发布调研）

> 记录与 ShadowBench-W 基准（results-log.md）平行的三条产品化线：
> 引擎落地、文档结构化、对外发布准备。基准日志只管「跑分」，这里管「能用」。

## 一、OriginWriter（adapters/story/）—— 从占位到 26 项自测全过的写作引擎

**动机**：adapters/README 里 story/ 一直是「自研（正文分片+图谱+时间线+连续性检查）」占位。
本轮把它做成可应用的引擎。核心主张：**长篇写作 = 事务性写作**——每章提交
正文+状态变更事务，过五道门禁才落盘。

**交付**：
- `dialect.mjs` — Story 方言：伏笔状态机（planted_unresolved/resolved/abandoned）、
  禁区→核心约束翻译（含 hook_must_stay 一体化处理，比 a3 臂的独立投影更简）、断言表
- `engine.mjs` — initWriter（世界重放到第 N 章）/ projectState（新会话秒恢复）/
  submitChapter（五道门禁）/ checkChapter / hookGraph / seqOf
- `cli.mjs` — init/state/submit/check/hooks/outline/seq 七命令
- `run-chapter.mjs` — 真实续写闭环：模型 → 事务 → 门禁 → 落盘，失败按理由重写重试
- `selftest.mjs` — 26 项断言；`demo.mjs` — 对外演示
- `.agents/skills/origin-writer/` — 可发布 skill（ClawHub/SkillHub 格式）

**门禁五道**（全过才落盘，失败零写入）：
① 正文非空 ② 结构/引用/快照隔离（核心校验）③ 禁区约束（machine_check 翻译）
④ 伏笔状态机（非法取值 + 回收无依据 hook-payoff）⑤ 正文对照状态（CED 规则引擎）
另有断言复核（AI 自报字据由机器验收）。

**实测闭环（2026-08-06，deepseek-v4-flash / hermes 通道）**：
- 《月落渡口》世界重放到 ch10 → 提交 ch11 真实续写（2883 字），自动产出
  1 条状态变更 + 5 条断言，门禁通过落盘 seq 11-11
- 禁区违规（钥匙 used=true）→ constraint + assertion-failed 双防线拒绝，零写入
- 正文「白遥左手挥刀」→ CED 规则拦截（正文与状态脱钩的修复实证）
- 记错前值 → stale-write 降级警告（「模型记忆偏差率」可观测化）
- expect_seq 不符 → 写冲突拒绝（多 agent 插队检测）

**踩过的坑**（已修复）：
1. zonesOf 只读第一个 tasks/*.json → 合并所有任务文件并按 id 去重
   （continuation.json 与 continuation-m.json 重复声明禁区导致同条报两次）
2. store.commit 内部第二次校验没传 assertions → 断言全部误报「未登记」
   （修复：commit 时传 STORY_ASSERTIONS）
3. 事务缺 chapter 会静默写 ch00.txt → 改为拒绝落盘（engine）+
   run-chapter 注入命令行章号（模型可能漏）
4. 推理型模型吃 max_tokens：max_tokens=12000 时 reasoning 吃掉 15944 tokens，
   正文 0 输出（finishReason=length）；给 20000 后正常（实测 203s / 2883 字）

## 二、origin-office（adapters/office/）—— 从 docx 单格式到三格式统一 CLI

**交付**：
- `pptx.mjs` — 零依赖 pptx 解析：占位符类型（title/subTitle/body）、
  表格+gridSpan 合并展开（递归找 ph/tbl，修了迷你 DOM 的 a:t 文本取法）
- `cli.mjs` — 统一 CLI：`import`（docx/pptx → 本象包，每处结构一个对象 +
  SHA-256 结构指纹入库）/ `inspect` / `verify`（重算哈希比对，篡改即检出）
- `fixtures/make-pptx-fixture.mjs` — 最小合法 pptx 生成器（库/CLI 双模式）
- selftest 扩到 20 项（docx 11 + pptx 5 + 统一 CLI 4：建包/指纹/verify 一致/篡改检出）

**实测**：
- synthetic.pptx：2 页 / 5 形状 / 1 表（合并展开正确），import → verify 一致
- 海事局红头文件 2019：409 个结构对象（6 章 / 77 条 / 16 表 / 59 勾选），verify 一致

**坑**：cli.mjs 缺 main 守卫被 selftest import 时误执行 → 加 isMain 守卫；
篡改测试改 zip 尾部字节会炸 EOCD → 改为重打包合法 zip 但内容不同。

## 三、Skill 发布（已完成 ClawHub，SkillHub 待登录）— 调研见 research/2026-08-06-skill发布平台调研与商业化方案.md

**ClawHub（已发布 ✅ 2026-08-06，owner=dongsheng123132）**：
- `origin-writer@1.0.1`（k97a8v7dwzmngdd5r1pn38wrx98bx636）
- `benxiang-memory@1.0.1`（k97c55c88sq1fg52gbmxqbzh1x8bxxvx）
- `origin-office@1.0.1`（k97fsek7a4ne6ps5p61vbpmm498bwtnc）
- 发布后自动安全扫描，扫描完成前处于 pending.publication 隐藏态（约 50s）
- LICENSE 已随包（Apache-2.0 全文）；ClawHub 展示 License 字段识别为 MIT-0（其识别逻辑对 LICENSE 文件内容的解析，法律效力以文件为准）
- 版本策略：1.0.0 首发 → 补 LICENSE 后自动升 1.0.1（changelog 记录）

**SkillHub（腾讯，中文主战场）— 已发布 ✅ 2026-08-06**：
- origin-writer（skillId 145380）、benxiang-memory（145381）、origin-office（145382）
- 网页版确认：https://skillhub.cn/skills/user_abeb50e0/origin-writer（AI 评分 4.4/5.0「优秀」、安全扫描、内容指纹+数字签名）
- 作者显示「贺去病ai工作室-软件+品牌」
- 注意：SkillHub 服务端拒绝 LICENSE 文件（license 走 frontmatter 字段声明），发布用临时目录排除 LICENSE，仓库保留（ClawHub 需要）
- 发布频率限制：连续发布第三个被限流，间隔 30s 后重试成功

**可发布 skill**（.agents/skills/）：origin-writer / benxiang-memory / origin-office（均带 LICENSE）。

**商业化三方向**（方案文档详述）：
A. 百万字小说网站（引擎已有，缺 Web 壳）—— 卖「真长篇」+「可验证」+「伏笔图谱」
B. 无限长小说挑战（GitHub + 官网连载，传播杠杆）——「AI 以事务机制续写且状态可验证」
C. 企业文档合规底座（office 方言 B 端，海事局案例已验证）

## 四、状态

- 全部测试绿：compiler 81 / CAD 44 / LAW 101 / OFFICE 20 / XLSX 87 / STORY 26 / E2E 18 /
  conformance 全过 / mutation 全 KILLED
- 未提交改动：git status 见仓库（story/、office/pptx.mjs、office/cli.mjs、office/fixtures/、
  .agents/skills/、research/、package.json、adapters/README.md 等）
- 下一步（用户已确认方向）：发 skill（需用户登录）→ 无限长小说挑战 repo →
  百万字小说站 MVP
