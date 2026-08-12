# 每日维护任务 · 本象协议 + 2origin.org

> 这是 Mac Mini 私有维护员的每日指令书。由维护员在每天执行前，先填入当天真实的外部输入。
> 原则：**引用先于宣称、每天必须有客观输入、允许「今天不改」、每步留痕。**
> ⚠️ **世界状态只读**（2026-08-07 起）：本象世界状态（project.origin/）是**单写者**——
> 只由主会话（本机）提交。维护员只能 `status` / `diagnose` / `why` / `history` **查询**，
> **绝不 `commit`**。原因：多写者会让 seq 撞号（risk:multi-writer-seq-collision）。
> 维护员的待办写进 `research/2026-08-08-维护员待办.md`（或当日日期）文件，由主会话下轮接手提交。

## 任务
今天是 <DATE>。你负责维护 github.com/dongsheng123132/2origin（本象协议）与 2origin.org 网站。
目标：让协议和网站持续真实地变好。**世界状态只读**，你的输出是代码/文档改进 + 待办清单文件。

## 输入（执行前先搜集，逐条核实来源）
- [ ] GitHub：今天新增的 issue / PR / star / fork 各几条？（gh api 查，报数字）
- [ ] 外部：有没有新论文 / 新 benchmark / 竞品动态跟本象协议相关？
- [ ] 自己仓库：`npm run verify` 是否全绿？世界状态有没有待办到期（只读查询 project.origin/）？
- [ ] 公开面：网站/README 上的数字与仓库结果是否一致（task:public-surface-accuracy-check）？

## 要求
1. 从上面输入里选 **1 件实事**做。允许「今天没有需要改的」——这是合理结果。
2. 改代码/改文档前先读 `docs/02-概念体系.md`，术语以它为准。
3. **世界状态只读**：可以用 `node compiler/cli.mjs status|diagnose|why|history project.origin` 查询，
   但**禁止** `node compiler/cli.mjs commit project.origin`——世界状态由主会话单写。
4. 改完跑 `npm run verify`，全绿才算完。
5. **不动**没被指派改的文件；**不发**任何对外内容（发版/发布要等人工确认）。

## 输出
1. 改了什么（文件 + commit hash）
2. 今天的外部输入清单（各条数字 + 来源）
3. 明天的待办 → **写进 `research/<当日日期>-维护员待办.md`**（不是 world state），主会话会接手提交
4. 一句话日报（适合发到网站/社群）

## 验收
- [ ] 今天有客观输入（不是凭空想象）
- [ ] 每步留痕：git log + 代码/文档 diff
- [ ] `npm run verify` 全绿
- [ ] **没有执行任何 `origin commit`**（世界状态只读）
- [ ] 没有擅自对外发任何东西
