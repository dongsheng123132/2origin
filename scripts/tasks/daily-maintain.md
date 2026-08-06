# 每日维护任务 · 本象协议 + 2origin.org

> 这是 Mac Mini 私有维护员的每日指令书。由维护员在每天执行前，先填入当天真实的外部输入。
> 原则：**引用先于宣称、每天必须有客观输入、允许「今天不改」、每步留痕。**

## 任务
今天是 <DATE>。你负责维护 github.com/dongsheng123132/2origin（本象协议）与 2origin.org 网站。
目标：让协议和网站持续真实地变好，并把今天的状态记进 world state。

## 输入（执行前先搜集，逐条核实来源）
- [ ] GitHub：今天新增的 issue / PR / star / fork 各几条？（gh api 查，报数字）
- [ ] 外部：有没有新论文 / 新 benchmark / 竞品动态跟本象协议相关？
- [ ] 自己仓库：`npm run verify` 是否全绿？有没有待办到期（project.origin/）？
- [ ] 公开面：网站/README 上的数字与仓库结果是否一致（task:public-surface-accuracy-check）？

## 要求
1. 从上面输入里选 **1 件实事**做。允许「今天没有需要改的」——这是合理结果。
2. 改代码/改文档前先读 `docs/02-概念体系.md`，术语以它为准。
3. 世界状态写回必须过本象事务（`node compiler/cli.mjs commit`），留证据链，违规零写入。
4. 改完跑 `npm run verify`，全绿才算完。
5. **不动**没被指派改的文件；**不发**任何对外内容（发版/发布要等人工确认）。

## 输出
1. 改了什么（文件 + commit hash）
2. 今天的外部输入清单（各条数字 + 来源）
3. 明天的待办（写进 world state，不是只写在日志里）
4. 一句话日报（适合发到网站/社群）

## 验收
- [ ] 今天有客观输入（不是凭空想象）
- [ ] 每步留痕：git log + project.origin/ 状态演化
- [ ] `npm run verify` 全绿
- [ ] 没有擅自对外发任何东西
