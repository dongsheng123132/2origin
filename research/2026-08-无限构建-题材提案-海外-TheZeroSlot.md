# 《The Zero Slot》(第 0 槽位) —— 海外向英文题材提案

> 2026-08-06 · 本会话提案之二（海外/英文市场；国内版另见
> 《规则怪谈·无限层》题材提案——两份题材不同，一恐一强，两个市场）
> 定位：世界最长 AI 小说挑战（英文版）· GitHub 共创 · 本象协议状态可验证
> 创作语言：英文（面向 RoyalRoad / Webnovel / Amazon Kindle 连载受众）

## 0. 一句话（英文钩子）

> In 2037, the Panel arrived. Everyone on Earth got a game interface —
> levels, stats, skills, quests. The world became a game, and humanity started
> to level up. Everyone, except Kael, who has one extra slot on his panel:
> **Slot Zero**. It is blank. No identify spell can read it. And every time
> the System releases a version update, a single word appears in it.

（2037 年，"面板"降临。地球每个人都有游戏界面——等级、属性、技能、任务。
世界变成了游戏，人类开始升级。只有 Kael 的面板上多出一个**第 0 槽位**：
空白，任何鉴定术都读不出内容。而每当系统发布版本更新，槽位里就浮现一个词。）

## 1. 题材判断：为什么是海外市场的正确选择

| 依据 | 说明 |
|---|---|
| LitRPG 是海外网文头部品类 | RoyalRoad 站内 LitRPG/Progression Fantasy 长期霸榜（该站最大品类），Webnovel 海外站、Amazon Kindle 连载（KU）同类书销量稳定。2026-2028 预计持续：该品类读者粘性极高（追"变强"过程） |
| 数值成长=天然连载结构 | 等级/技能/装备进度本身就是"下一章看什么"的答案——每天一章的无限构建节奏完美匹配，读者为"升级"而追更 |
| 英文+全球化 | 英文创作天然面向全球（RoyalRoad 读者北美+欧洲+东南亚），"世界最长 AI 小说"挑战用英文跑，传播半径比中文大一个量级 |
| 系统流+悬疑双钩 | 面板降临世界观 + "第 0 槽位"悬念线——爽文外壳、悬疑内核，兼得流量与讨论度 |

## 2. 为什么适合 GitHub 共创（海外社区天然契合）

LitRPG 读者社区（Reddit r/litrpg、RoyalRoad 评论区、Discord）是**全世界最爱讨论 build 的人群**。共创机制顺水推舟：

1. **技能树/装备提交**（门槛最低）：PR 提交新技能或装备设计（名称+效果+数值），合入 spec 后主角可能在下一章获得它。海外开源文化 = PR 文化，零教学成本。
2. **副本/裂隙设计**：每个副本 = 一个自包含单元（怪物+机制+掉落），模板化提交，投票进正文。
3. **Build 投票**：主角升级时的属性点/技能分支抉择开投票（GitHub Discussions / Issues Reactions）——读者票选"这一章怎么加点"，追更变成参与。
4. **攻略番外**：读者写副本攻略/世界观考据，合入 canon 署名。
5. **状态公开可查**：主角面板（等级/属性/装备/任务）就是 origin 包状态——任何读者 clone 仓库就能 verify 当前面板。**"小说主角的数值面板是机器可验证的"**——LitRPG 读者最吃的信任状（防"作者数值崩了"），全球无第二部。

## 3. 世界观设定（核心概念）

- **面板（The Panel）**：2037 年瞬间降临全球的游戏化界面。等级 1-100，属性（STR/AGI/INT/VIT/WIS），技能树，任务，背包，地图，社交（公会）。面板不可关闭，死了才消失。
- **裂隙（Rifts）**：怪物来源。城市周边随机开裂的次元缝，刷怪、掉装备、藏副本。裂隙深度 = 难度梯度，天然分层。
- **系统版本（System Versions）**：面板偶尔全局更新（0.9 → 0.9.1 → 1.0），每次更新会改规则（新系统上线、旧技能削弱、世界事件预告）。版本更新 = 跨章状态事件，是天然的"赛季"节奏。
- **第 0 槽位（Slot Zero）**：Kael 独有的第 0 个槽位，在"等级"上面。空白。无鉴定术可读。版本更新时浮现一个词：VERSION → UPDATE → ... 悬念主线。
- **系统是谁（Who runs the System?）**：大秘密。面板不是游戏，是某个东西的**测试版**。第 0 槽位是测试者的注释栏。

## 4. 对象模型（origin 包）

```text
panel:<char>    主角面板  { level, xp, stat_points, version_seen }
attr:<char>     属性      { str, agi, int, vit, wis }
skill:<id>      技能      { name, effect, tier, source(PR 贡献者), acquired_chapter }
item:<id>       装备      { name, slot, stats, durability, drop_from }
quest:<id>      任务      { title, objective, reward, status(active/done/abandoned) }
zone:<id>       裂隙/副本  { name, depth, monsters[], loot_table, cleared }
hook:<id>       伏笔      { summary, status(planted/resolved), payoff_chapter }
```

- 状态变更：升级（level/xp/attr）、获得技能装备、任务完成、副本 cleared、版本更新（system_version 事件）
- 约束（门禁拒绝）：属性点总数与等级不符（数值账本对不上=违反约束）、已获得的技能被遗忘、任务无理由消失、副本状态回退
- 数值账本 = 约束的绝佳载体：**LitRPG 的"数值崩了"痛点，用约束系统根治**——这就是本象协议的活广告

## 5. 前十章规划

| 章 | 内容 | 状态要点 |
|---|---|---|
| 01 | The Panel Arrives —— Kael 发现自己有第 0 槽位 | 建面板对象 |
| 02 | First Rift —— 第一只裂隙兽，首次升级 | 属性点分配 |
| 03 | Tutorial Quest —— 新手任务（接/弃二选一） | 任务系统约束 |
| 04 | "VERSION" —— 首次版本更新，第 0 槽位浮现第一个词 | 悬念对象 planted |
| 05 | Guild —— 公会系统开放，组队 | 社交对象 |
| 06 | Hidden Instance —— 隐藏副本（投票章节：下一站去哪） | 副本设计 |
| 07 | 0.9.1 —— 第二次更新，槽位 +"UPDATE" | hook 推进 |
| 08 | Deep Rift —— 裂隙深处，世界观扩展 | 地图/zone |
| 09 | Build Divergence —— 技能树分歧（读者投票加点） | build 分叉 |
| 10 | Version 1.0 Announcement —— 系统公告：大更新预告 | 赛季结算+悬念上线 |

## 6. 与国内版《规则怪谈·无限层》的差异化

| 维度 | 海外《The Zero Slot》 | 国内《规则怪谈·无限层》 |
|---|---|---|
| 语言/市场 | 英文 / RoyalRoad·Webnovel·Kindle | 中文 / 番茄·七猫·知乎 |
| 类型 | LitRPG 数值成长+系统悬疑 | 规则怪谈+无限流恐怖 |
| 情绪 | 变强（爽、期待） | 怕死（紧张、好奇） |
| 对象模型核心 | 数值账本（属性/技能/装备/任务） | 约束（规则/禁区/伏笔） |
| 共创钩子 | Build 投票、技能/副本 PR | 层设定提交、规则抓虫 |
| 可验证卖点 | "主角面板机器可查"（防数值崩） | "规则可机器验证"（防穿帮） |

同一套无限构建引擎（GitHub cron 每日一章 + 事务 + 门禁 + 状态公开），两个市场、两种题材、两套对象模型——正好证明本象协议是**通用状态层**，不是某个题材专用工具。这也是对外叙事的一部分："同一个协议跑出两部完全不同的长篇小说"。

## 7. 落地路径

1. 本周：英文 spec 草案（面板/属性/前 3 个裂隙 + 数值账本约束）+ story 方言适配（数值约束谓词：总和恒等式）
2. 下周：GitHub 无限构建 repo（英文 README + cron + Issue 模板：技能/副本/投票）→ 首章英文正文
3. 内容线：每 10 章一次版本更新（赛季结算+面板公开），第 0 槽位每 5 章推进一词
4. 传播线：README 挂"主角当前面板"实时状态页（由 origin 状态自动渲染）+ "数值可验证"宣传点

## 8. 待拍板

- 海外版主角名：Kael（中性安全）还是别的？
- 第 0 槽位词汇序列：VERSION → UPDATE → TEST → 下一个是什么（留悬念由共创投票？）
- 两版是否共用同一个 GitHub org/repo（2origin 下建两个独立 repo）还是各自独立？
