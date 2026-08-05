# OriginWriter · 百万字小说写作引擎（Story 方言）

> 长篇小说写不长、写不圆的病根是同一个：**世界状态只存在于模型的上下文里**。
> 写到第 30 章，模型已经忘了第 3 章埋的伏笔、第 9 章受的伤、谁在什么时候知道了什么。
> 上下文会丢，状态不会——前提是它被持久化，并且每次改动都过门禁。
>
> OriginWriter 把长篇写作变成**事务性写作**：AI 每写一章 = 提交一个语义事务
> （正文 + 状态变更声明），门禁逐条复核后才落盘。角色不会突然用上他不知道的信息，
> 物品不会凭空易主，伏笔不会收了又埋。新会话秒恢复——任何时候 `state` 一条命令
> 拿到全部世界状态，不依赖聊天记录。

## 用

```bash
# 1. 从世界规格建写作包（世界重放到第 10 章，之后由你写）
node adapters/story/cli.mjs init <specDir> <pkg.origin> --until 10

# 2. 新会话第一件事：拿世界状态投影（秒恢复）
node adapters/story/cli.mjs state <pkg.origin>

# 3. AI 写一章，以事务提交（正文 + 状态变更）
node adapters/story/cli.mjs submit <pkg.origin> ch11.json

# 4. 伏笔图谱 / 章节登记表 / 事务水位
node adapters/story/cli.mjs hooks <pkg.origin>
node adapters/story/cli.mjs outline <pkg.origin>
node adapters/story/cli.mjs seq <pkg.origin>
```

## 真实续写闭环（模型 → 事务 → 门禁 → 落盘）

```bash
# 让真实模型续写一章：自动拿世界状态投影 → 生成正文+状态事务 → 过门禁 → 落盘
node adapters/story/run-chapter.mjs <pkg.origin> 11 --provider hermes --max-tokens 20000

# 失败自动按门禁理由重写重试（--retries 3）；无模型时可 --provider stub 跑通流程
# provider：hermes（本机 config 端点）/ bailian（本地 bl CLI）/ anthropic / stub
```

实测（2026-08-06，deepseek-v4-flash）：ch11 续写 2883 字，自动产出
1 条状态变更 + 5 条断言，门禁通过落盘 seq 11-11，正文风格与基线一致。

事务文件（ch11.json）形状：

```json
{
  "chapter": 11,
  "transaction_id": "ch11-s01",
  "text": "…本章正文…",
  "state_changes": [
    { "object": "obj:black-key", "field": "holder", "from": "char:zhao-qi", "to": "char:lin-zheng", "basis": ["scene:11-07"] }
  ],
  "assertions": ["zhao-qi-alive", "gate-not-opened", "betrayal-undisclosed"],
  "hooks": [{ "id": "hook:new-mystery", "summary": "…", "status": "planted_unresolved", "setup": { "chapter": 11 } }]
}
```

## 门禁五道（全过才落盘，失败零写入并返回可据以重写的理由）

| # | 门禁 | 抓什么 | 实现 |
|---|---|---|---|
| ① | 正文非空 | 写作事务交不出正文 | engine 层 |
| ② | 结构/引用/快照隔离 | 未知对象、缺字段、记错前值（降级警告） | `compiler/commit-compiler.mjs` |
| ③ | 禁区约束 | `forbidden_zones` 的 machine_check（钥匙不得用、赵七不得死、主角不得获知叛变…） | `dialect.mjs` → 核心约束谓词 |
| ④ | 伏笔状态机 | 状态非法取值；回收无依据（hook-payoff） | `dialect.mjs` |
| ⑤ | 正文对照状态 | 正文写了左手挥刀、正午开门等 CED 规则命中 | `benchmark/shadowbench-w/eval/ced.mjs` |

另有**模型自报断言复核**：事务里的 `assertions` 是 AI 自己立的字据
（「我保证赵七还活着」「我保证钥匙没用过」），门禁逐条验收，说大话就拒绝。

## 世界规格（spec）约定

`init` 吃 ShadowBench-W 风格的世界规格目录：

```
specDir/
├── canon/*.jsonl              # 初始对象：characters / locations / objects / factions（id 前缀定类型）
├── narrative/foreshadowing.jsonl  # 伏笔：id / summary / setup.chapter / payoff.chapter
├── timeline/state-changes.jsonl   # 重放历史：object / field / from / to / chapter / evidence
└── tasks/*.json               # forbidden_zones（禁区，machine_check 可机器判定）
```

`--until N`：世界重放到第 N 章（canon + 章 ≤ N 的变更 + 伏笔状态按 setup/payoff 章号推导），
之后的变更由作者亲手以事务提交。重放历史逐条进 provenance，`origin why <pkg> obj.field` 能回答
「这个值凭什么」。

## 为什么这样就能写百万字

1. **状态与正文分离**：正文是投影产物（`narrative/chapters/chNN.txt`），世界状态才是真身。
   模型不用记住一切，每次只带投影 + 本章正文。
2. **门禁代替记性**：一致性错误（用上不该知道的信息、物品易主、伏笔提前回收）
   是确定性检查，不是模型自觉。
3. **零写入拒绝**：违规事务一个字节都不落，理由原样返回——AI 照着理由重写即可，
   不会带病前进污染后续章节。
4. **证据链**：每个状态字段都有来源（哪一章、哪个场景、谁提交的），
   对不上账时查得出是谁在哪一步写错了。

## 验证

```bash
node adapters/story/selftest.mjs    # 26 项断言：建包/投影/提交/禁区/正文对照/伏笔状态机/写冲突
```

## 目录

- `dialect.mjs` — Story 方言：伏笔状态机、禁区→约束翻译、断言表、伏笔回收依据检查
- `engine.mjs` — 引擎：initWriter / projectState / submitChapter / checkChapter / hookGraph
- `cli.mjs` — 命令行入口（init / state / submit / check / hooks / outline / seq）
- `selftest.mjs` — 26 项自测
