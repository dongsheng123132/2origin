# 2026-08-06 · 实验装置第九起事故：hermes HTTP 通道从未真正生效（配置解析双转义 bug）

> 状态：事故记录。重跑实验进行中（results-v3/），结果出来后补 Run 编号与数据。

## 症状

`run.mjs --provider hermes` 在后台（无 TTY）环境立即崩溃，报 `stdin is not a tty`；
前台跑则极慢（单轮 >180s 无输出）。直觉上「模型生成慢」，实际是**通道错了**。

## 排查链（每一步都排除了一个假说）

1. ❌ 假说「后台模式坏了」：`echo` 后台正常 → background 机制本身好的
2. ❌ 假说「node 后台都崩」：`node -e "console.log(1)"` 后台也报 `stdin is not a tty` →
   但这个错误来自 **hermes.exe CLI 子进程**（spawn 无 TTY），不是 node 本身
3. ✅ 真根因：`readHermesModelConfig()` 的 `get()` 正则永远匹配不到任何键

## 根因

`arms/lib/model.mjs` 第 139 行（2026-08-06 修复前）：

```js
const m = sec.match(new RegExp(`^\\\\s*${k}:\\\\s*(?:['\"]([^'\"]+)['\"]|(\\\\S+))`, 'm'))
```

模板字面量里 `\\\\s` = 源码 4 个反斜杠 → 模板求值后 = 字符串 `\\s`（2 字符：反斜杠+s）
→ `new RegExp` 收到 `\\s` → 正则语义 = **字面反斜杠 + s**，而不是空白符 `\s`！

于是 `get('base_url')` 匹配「字面 `\s` + base_url」——config 里永远没有这种文本 → 返回 null
→ `cfg = { baseUrl: null, ... }` → `cfg.baseUrl && cfg.apiKey` 为 falsy → `readHermesModelConfig()` 返回 null
→ `complete()` 走 `completeViaCli()`（hermes.exe -z）→ 无 TTY 环境崩 / 长提示词超限报错。

**为什么之前没发现**：4f48d45 修的是 `(?=^\S|\Z)` 的 `\Z` 问题（那也是真 bug，让 `sec` 永远匹配失败）。
修完后 `sec` 能取到了，但 `get()` 的双转义 bug 依旧——**HTTP 通道从未真正生效过**，
所有「真实实验」其实都在走 CLI 兜底（Windows 上 hermes.exe 有 TTY 就能跑，所以本机前台没炸，
GitHub Actions 无 TTY 才暴露）。

## 修法

模板字面量里 `\\s` 才是「一个反斜杠+s」→ 正则空白符：

```js
const m = sec.match(new RegExp(`^\\s*${k}:\\s*(?:['\"]([^'\"]+)['\"]|(\\S+))`, 'm'))
```

## ⚠️ 追加更正（2026-08-06 当日再核）：第一次修复**从未真正提交**

上面这条修法描述是对的，但字节核对发现 `077692d` 提交里该行仍是**单反斜杠** `^\s*`——
JS 把模板字面量里的 `\s`（非法转义）退化成字面 `s`，正则变成 `/^s*k:/`，永远匹配不到任何键，
config 依旧读不出来，通道依旧在走 CLI 兜底。

**为什么「验证通过」却是假的**：第一次验证时只改了临时副本做 `get()` 测试，修好后把验证结果
写进了事故日志，但**代码改动没随提交落盘**——日志记录了正确的修法，仓库里却还是错的。

**真正落地**（本次会话）：把该行改为 `^\\s*` / `\\s*` / `(\\S+)` 双反斜杠写法并提交，
单发调用实测 HTTP 通道生效（`usage estimated: undefined`，真实 token 用量）。
教训升级：**「日志说修好了」不算修好，「字节核对 + 实跑验证」才算。**

验证（2026-08-06）：修复后 `get('base_url')` 返回 `https://api.u-claw.org.cn/v1`、
`get('api_key')` 返回真实 key、`get('default')` 返回 `deepseek-v4-flash`。HTTP 通道生效。

## 另一个发现（环境相关）

后台跑 node 需 `pty=true`（本环境 node 无 TTY 时 spawn 子进程的 stdin 报错）；
另需显式 `HERMES_HOME`（后台 shell 不继承 .bashrc 里的环境变量，落到 ~/.hermes/config.yaml
——那个文件 model: 段格式不同，正则也读不出）。

## 影响面

- **所有历史 hermes 通道实验**：如果当时 CLI 兜底在有 TTY 的本机跑的，结果仍有效但 Token
  是估算值（usageEstimated: true）；跑分数字本身不受通道选择影响（同一个模型同一个提示词）。
- 但「HTTP 直连无长度上限」的优势此前从未兑现——长提示词实验可能悄悄失败过。
- 本次重跑（results-v3/，deepseek-v4-flash 三臂 ×10 轮）是修复后第一轮真实 HTTP 数据，
  **W1 口径完全对齐补丁版判分器**，是论文 v0.2 要引用的数据源。
