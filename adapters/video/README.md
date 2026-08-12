# adapters/video —— Video 方言

**Status:** v0.3 · 2026-08-09
**归属：** 本象协议的一个方言，与 Story / Office / CAD / xlsx / Memory 同级。**不是新协议。**

按 [00-极简核心](../../docs/00-极简核心.md) 的方言自检表填过：五个概念全填得出，
**没有一个新概念**——所以进方言区，不进核心评审。

在 [RFC-0000](https://github.com/dongsheng123132/2origin-computer/blob/main/rfcs/RFC-0000-2origin-computer.md)
的分层里，本象是「世界表示 / 显卡」那一层。

---

## 一句话

**视频 → 可复核的结构化事实 + 分受众估值 → 任意投影（成片 / 字幕 / 检索 / 情报）。**

剪辑只是出口之一。

## 方言自检表

| 概念 | video 的"它" | 实例 |
|---|---|---|
| **对象** | 事件（一段有语义的时间区间） | `ev:E02` = 40–70s「点一次完成配置」 |
| **引用** | `<file>@<sha256前8>#t=<start>,<end>` | `example.mp4@00000000#t=40,70` |
| **投影** | 同一本象按不同目标生成的成片 | `newcomer_30s` / `changelog_60s` |
| **事务** | 保留 / 丢弃 / 改口径重投影 | 改 `projections.*.pick`，不动 events |
| **校验** | 指纹新鲜度、时间码值域、覆盖率、判据来源、边界完整性 | `validate.mjs` |

## 三段式结构

```
events[]      本象：ref / gist / gist_from / evidence / prosody —— 只放能复核的
audiences[]   受众与口径：谁在看、按什么标准、什么时候定的、维度权重
appraisals[]  投影：{event × audience} → grades(1–5) → value 由权重确定性算出
```

**`value` 不属于本象。** 同一个 10 秒片段，对新客是爆点、对老用户是废话；今年管用、明年过时。
价值是内容与观众之间的**关系**，不在内容里面。

模型**无权手写 value**：先按维度打 1–5 档（判断），value 由权重算出（决策）。
判断与决策不能同时握在一只手里（bugscope A3）。

看 [`example/timeline.origin.json`](example/timeline.origin.json)——里面有个刻意设计的对照：
**同一个「演示失败重试」事件，对新客是 `veto`（不能出现），对老用户 value 0.475（知道哪里容易卡是有用信息）。**
单个 value 表达不了这件事。

## 怎么用

```bash
node asr.mjs <视频> --engine bl               # 转写，出句级+词级时间码
node sheet.mjs <视频> --stride 15 --auto-crop # 联系表，100% 覆盖不盲丢
node srt.mjs <视频>                           # 字幕（纯音频会自动跳过 omni 复核）
node snap.mjs <timeline> <asr> --find "关键词" # 按台词查时间码
node validate.mjs <timeline>                  # 校验，fail-closed
./render.sh <投影名> [timeline]                # 出片，不过校验不出片
```

## 文档

| | |
|---|---|
| [`spec.md`](spec.md) | **先读这个** —— 全部工程约定 |
| [`docs/00`](docs/00-反思-bugscope审视.md) | 用 bugscope 审视自己，找出三条真缺陷 |
| [`docs/01`](docs/01-粗筛层-一个被推翻的方案.md) | 声学粗筛跑输随机（−18%），被两遍制替代 |
| [`docs/02`](docs/02-n2-真直播素材.md) | n=2 推翻了建议顺序，ASR 是唯一阻塞点 |
| [`docs/03`](docs/03-语音通道-阻塞点解除.md) | 四条 ASR 通道实测；`basis`/`gist_from` 拆分 |
| [`docs/04`](docs/04-韵律通道-开通之后的负结果.md) | 语速/情绪能量与价值无关；话密度才有用 |
| [`docs/05`](docs/05-八个引擎的横评与一条结构性结论.md) | 八引擎横评 + 为什么必须分工 |
| [`docs/06`](docs/06-术语库负结果与一个机制发现.md) | 术语库迁移失败；**视频原生 LLM 是在读屏幕** |
| [`proposals/A6`](proposals/A6-代理之问.md) | 给 bugscope 的增补提案 |
| [`publish/README.md`](publish/README.md) | 投放实验清单 + 预注册预测 |

**四篇里有三篇是负结果。** 这是有意的——那些是实测换来的，比正面结论更贵。

## 诚实边界

- **n=2 素材**，且同一个人、同一类题材。
- **所有估值 100% 是 `asserted`**。校验器每次都会报这个数。这不是标注不够努力，
  是缺了构成"价值"的另一半——真实受众反馈。`ingest.mjs` 已写好等数据。
- **没有跟任何现成字幕工具做过实测对比**。「纯 ASR 在带屏内容上必错」是从机制推的
  （见 docs/06 的黑屏对照），**不是跟具体产品比出来的**。
- **成本未精确计量**：一天混合用量粗算 omni 复核 ¥5–7/小时素材，ASR 可忽略。
- 本目录**只含方法论与工具**。实验用的素材、转写、timeline 实例是作者的业务内容，
  留在本地未公开——所以照着跑需要你自己的素材。

---

**License:** Apache-2.0
