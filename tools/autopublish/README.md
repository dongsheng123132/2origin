# 自动发布器 AutoPublish

> 基于影核协议（ActionParity）的自动发布工具。
> **一个动作（post.publish），多个执行器**：CLI 检测 → 浏览器发布 → 未来 API 直发。
> 登录态由浏览器会话提供，凭据只经用户之手；动作可 dry-run 验证、可回放。

## 为什么这么做（影核协议的核心主张）

`post.publish` 这个动作语义只有一个：「把文本发出去」。
但执行它的方式有无数种：网页按钮、官方 API、命令行、另一个 AI 的自动化工具。

影核协议要求：**一个动作，所有界面都能完成它，且行为一致、可验证**。
本工具是它的最小落地——CLI 负责无头验证，浏览器负责实际发布，
将来加官方 API 执行器，动作定义一行不用改。

## 用

```bash
# 登录态检测（无头，不发任何内容）
node tools/autopublish/publish.mjs check x

# 预览（dry-run：内容分段/字数，不会发布）
node tools/autopublish/publish.mjs preview x "推文内容"          # 或 @文件.txt
node tools/autopublish/publish.mjs preview wechat-mp @长文.md

# 正式发布（引导浏览器执行器）
node tools/autopublish/publish.mjs run x @推文1.txt
```

platform: `x`（推特）/ `weibo`（微博）/ `wechat-mp`（公众号）

## 执行器矩阵

| 执行器 | 状态 | 说明 |
|---|---|---|
| CLI（publish.mjs） | ✅ 已实现 | check/preview/run 编排，无头可验证 |
| 浏览器（Hermes browser） | ✅ 已实现 | 登录态下自动填入+发布+取 URL |
| X API | 规划 | 官方 API（需开发者账号） |
| 微博 API | 规划 | 开放平台 |
| 公众号 API | 已另有管线 | wechat-mp-publish skill（官方 API 草稿箱） |

## 合规验证

```bash
# 影核协议 manifest 校验（用 action-parity CLI）
cd /tmp/ap-spec && node bin/action-parity.mjs validate D:/uking编程/本象协议/tools/autopublish/action-parity.json
# → VALID DECLARATIONS, Declared parity 100%
```

## 安全边界

- **凭据不落地**：登录态在用户浏览器会话里，工具不存密码/token
- **dry-run 默认安全**：preview/check 不产生任何对外可见内容
- **发布需确认**：run 是 external+medium 风险动作，正式发布前提示确认
- **audit_required**：每次发布应记录（平台/内容 hash/时间），便于追责

## 文件

- `action-parity.json` — 影核协议 manifest（post.publish 动作定义，schema 合规）
- `publish.mjs` — CLI 执行器（check/preview/run）
- 推文素材：outreach/07-推文集-skill发布与无限长小说.md
