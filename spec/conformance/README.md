# 本象协议 · 一致性测试集

> 规范性文档。本文用「**必须**」（MUST）、「**不得**」（MUST NOT）、「**应当**」（SHOULD）、「**可以**」（MAY）表达要求强度，含义遵循 RFC 2119 的惯例。
>
> 🌍 **[English](README.en.md)** —— 想写第二实现的人多半读英文，这一页是采用的入口。

## 一、这套东西为什么存在

在它之前，本仓库只能证明**这一份 JavaScript 实现**自洽——`npm run verify` 跑的是它自己的自测。
别人用 Python 或 Rust 写一份，无从判断自己写的算不算数。那种状态下，「本象协议」和「本象这个库」
没有区别，所谓协议只是一份措辞讲究的设计文档。

一致性测试集把这条界线划出来：**测试向量是数据，不是代码**。它们不依赖任何宿主语言，
任何实现只要实现一个几十行的适配器，就能跑同一套向量自证合规。协议的真伪，
从此是一件可以当场核对的事，而不是一个需要相信的说法。

当前状态：

| 实现 | 语言 | core | full | 适配器 |
|---|---|---|---|---|
| 参考实现 | JavaScript | ✅ 79/79 | ✅ 8/8 | [`compiler/conformance-adapter.mjs`](../../compiler/conformance-adapter.mjs) |
| 第二实现 | Python 3 | ⚠ 60/79（19 项声明未实现，未实现 ≠ 通过） | ⊘ 未实现 | [`implementations/python/adapter.py`](implementations/python/adapter.py) |

> 第二实现的诚实边界：两份实现出自同一作者，中间没有信息隔离；且第二实现目前只覆盖部分向量
> （core 60/79，另 19 项声明未实现）。已通过的部分支持「**向量确实是语言中立的契约**」这一判断；
> **完整语义能否在另一门语言里独立成立**，要等 19 项补齐；「任何人只读规范就能写对」要等真正的第三方实现来验。

## 二、两个合规等级

一个实现**必须**声明自己达到哪一级，**不得**笼统地说「合规」。

**core —— 内存语义**（第一至五章，79 项）
Origin IR 的判定核心：ID 归一化、事务校验、约束谓词、折叠与证据链、重放。
只要不碰磁盘的实现（库、WASM 模块、服务端中间层）都能达到这一级。

**full —— 包格式与持久化**（第六章起，8 项）
`.origin` 包的落盘语义，兑现协议 §四之二 的三条硬规矩：只追加不覆写、
不通过零字节写入、写入时水位对不上则拒绝。

未实现某个 op 的实现**必须**回 `{"id":"…","unsupported":true}` 如实报告。
运行器把「未实现」计为**未通过**——沉默跳过会让「有约束」的假象掩盖「没校验」的事实，
这在本协议里一律视为比不实现更严重的问题。

```bash
npm run test:conformance                       # 参考实现，全部等级
node spec/conformance/run.mjs --level core     # 只测 core
node spec/conformance/run.mjs --adapter "python spec/conformance/implementations/python/adapter.py" --level core
node spec/conformance/run.mjs --json           # 机器可读
```

退出码：`0` 合规 / `1` 不合规或部分合规 / `2` 用法错。

## 三、适配器契约

适配器是「协议 ↔ 你的实现」之间唯一的接口。它**必须**：

1. 从 stdin 读一个 JSON 对象：
   ```json
   { "version": 1, "cases": [ { "id": "…", "op": "…", "input": { … } } ] }
   ```
2. 向 stdout 写一个 JSON 对象，**每个 case 一条结果，顺序不限**：
   ```json
   { "results": [ { "id": "…", "output": { … } } ] }
   ```
3. 除此之外**不得**向 stdout 写任何东西（日志走 stderr）。
4. 退出码为 `0`。case 级的失败通过 `{"id":"…","error":"…"}` 报告，**不得**让整个进程崩掉——
   协议的错误必须是可回传的判定，不是崩溃。

参考适配器不到 100 行，每个 op 都直接转调公开 API，没有一行是「为了通过测试」写的：
[`compiler/conformance-adapter.mjs`](../../compiler/conformance-adapter.mjs)（JS）、
[`implementations/python/adapter.py`](implementations/python/adapter.py)（Python）。

### op 一览

| op | 等级 | 输入 | 输出 |
|---|---|---|---|
| `normalize` | core | `{ids, transaction}` | `{transaction, changeKeys}` |
| `validate` | core | `{state, constraints, assertions, transaction}` | `{ok, codes, warnings}` |
| `constraints` | core | `{state, stateBefore, constraints}` | `{codes, warnings, ids}` |
| `fold` | core | `{state, changes}` | `{state}` |
| `apply` | core | `{state, transaction, history, by, at}` | `{state, journal}` |
| `replay` | core | `{objects, history, until}` | `{state}` |
| `load` | full | `{objects, history, constraints}` | `{state, ids, seq}` |
| `commit` | full | `{objects, history, constraints, transaction, expectSeq, by, at}` | `{ok, codes, seq, state, objectsUntouched}` |

`codes` 与 `warnings` 是违规码的数组，比对前会排序——**产出顺序不属于协议约定**。
其余字段按原样深比。

### 断言为什么写成数据

协议里断言是**宿主登记的谓词**（`名字 → (状态) => 布尔`），函数跨语言传不了。
所以向量把它写成「名字 → 约束判定」的数据，由各实现自己搭成谓词：

```json
{ "assertions": { "zhao-qi-alive": { "type": "equals", "object": "char:zhao-qi", "field": "alive", "value": true } } }
```

考的是机制——**未登记的断言降级为警告、已登记的断言不成立则拒绝**——
而不是任何一个具体断言的内容。协议不预设任何具体断言。

## 四、向量格式

```json
{
  "title": "章节标题",
  "level": "core",
  "rationale": "这一章在守什么，以及它从哪次真实事故里换来的",
  "cases": [
    {
      "id": "唯一 ID，形如 validate/unknown-object-rejected",
      "spec": "§六",
      "why": "这条为什么必须成立",
      "op": "validate",
      "input": { },
      "expect": { }
    }
  ]
}
```

`expect` 是**子集断言**：只比对写出来的键，没写的不管。这样新增可选字段不会让既有向量
集体失效——但写出来的键**必须**完全相等，运行器不做「包含即通过」的模糊匹配，
否则断言会在不知不觉中变松。

新增向量时，`why` **应当**写清这条规矩守的是什么、最好指出它从哪次真实事故里换来的。
本协议的每一条硬规矩都有出处，没有一条是凭空设计的。

## 五、向量本身有没有牙齿

「87 项全过」本身说明不了什么——一套只断言 1+1=2 的向量也能全过。
`npm run test:mutation` 把参考实现逐条打坏，同时跑自测与一致性向量，看谁抓得到：

- **自测+向量** 都抓到 → 这条承诺协议真的钉死了，换个实现也做不丢
- **仅自测** 抓到 → **协议的覆盖缺口**：只约束得了这一份实现，约束不了第二份
- 都没抓到 → 那部分代码可以被悄悄改坏而没人知道

### 当前已知的覆盖缺口（3 条）

如实列出，不掩盖：

1. **双份账本探测**（§一.6 派生优先于存储）——同一事实存在两处、转手后失配的检测，
   目前只有参考实现的 `diagnose` 覆盖，向量没钉。它是诊断能力而非判定能力，
   是否该进协议核心尚未定。
2. **正文与状态对照**（§一.9 管住状态管不住文字）——正文校验钩子必须被调用这件事，
   向量没钉。难点是正文规则本身高度领域相关，要钉死就得先定义一套声明式的正文规则表示。
3. **投影披露**（`compiler/project.mjs`，2026-08-05 新增）——「投影必须说清楚自己丢了什么」
   是协议级承诺（示例 manifest 里那条 `projection must_disclose_truncation`），
   但目前**一条向量都没有**。也就是说：另写一份实现，它可以合法地产出一份
   **不声明任何丢弃项的投影**而仍然「合规」——而那恰恰是本项目开篇要解决的
   「投影的投影」。这是三条缺口里最该优先补的一条，因为它约束的是**对外发出去的东西**。

   补法已经想清楚，只是还没做：向量给一份已知包 + 一份 carries 声明，
   断言 dropped 里必须出现哪几类条目（未选中对象 / 装不下的字段 / 悬空关系 / 证据链）。
   这套判定不依赖任何格式，是语言中立的。

补法要么给 `vectors/` 加向量，要么明确承认它属于实现自由。**在补上之前，
任何「本象协议保证了这两点」的说法都不成立**——协议只保证向量钉住的部分。

## 六、写一份新实现

1. 读 [`docs/03-协议草案-v0.1.md`](../../docs/03-协议草案-v0.1.md)，那是规范正文
2. 照 `implementations/python/benxiang.py` 的规模预期：core 级约 250 行，零依赖
3. 实现适配器，跑 `--level core`
4. 全绿之后**可以**声称「core 级合规」，并**应当**注明用的是哪个版本的向量集

发现向量与规范正文冲突时，**以向量为准并提 issue**——
规范正文是给人读的，向量是给机器判的，两者不一致本身就是必须修的缺陷。

### 给 AI 实现者（第三方采纳 stub）

上面是给人读的路径。**让 AI agent 帮你实现时，不要让它读完整本规范**——
「向量即需求」：`vectors/` 的 JSON 是语言中立的契约，比正文更硬。

```text
1. 看 vectors/*.json（core 级；项数随向量集版本演进，以 run.mjs 实际跑出为准）—— 每项 case 就是一条需求
2. 写 ~250 行实现 + 适配器，契约照抄 run.mjs 的 stdin/stdout：
     stdin:  {"version":1,"cases":[{"id":…,"op":…,"input":…},…]}
     stdout: {"results":[{"id":…,"output":…},…]}     # 除合法 JSON 外 stdout 不输出任何东西
     stderr: 日志；退出码 0
3. 跑：node spec/conformance/run.mjs --adapter "<你的命令>" --level core
4. 全过即可声明合规；**未实现的 op 必须如实回 {"id":…,"error":"unsupported"}**
   ——运行器把 unsupported 计为未通过，沉默跳过 = 拿「有约束」的假象掩盖「没校验」的事实
```

向量集有版本号、随协议演进。实现方**应当**在声明合规时注明所对向量集版本。
