# AgentTeams 桥接包复现（Windows / Node 18+）

在新解压的 `code-agentteams-standalone` 根目录执行；不需要 access token、Docker 或 Bash。
四角色演示自行启动独立的 Matrix homeserver stub，只用于验证闸门逻辑，不主张外部身份锚定。

```powershell
node agentteams/verify-agentteams.mjs
node agentteams/verify-runtime.mjs
node agentteams/verify-identity-anchors.mjs
node agentteams/selfcheck.mjs
node agentteams/demo-four-roles.mjs
node agentteams/demo-publishing.mjs --identity-mode auto
```

预期上述命令均退出 `0`。每个 CLI 的 stdout 只有一行 JSON；判据的人类可读诊断走 stderr。
`demo-publishing.mjs` 在没有主仓 `demo/book-project/` 时自动使用包内的样稿一致性检查器；
在主仓存在真实出版社检查器时优先使用真实检查器。

## 四角色与人工确认

`demo-four-roles.mjs` 使用**声明式批准回执闸门（防止批准者标识与考官标识相同；回执绑定学历、经验与时间并留内容哈希；拒绝时学历零改动）**，在同一份临时 `task.origin.json` 上按以下顺序运行：

1. executor / `certify.stamp`（`xueji.append`）登记 candidate；
2. observer / `certify.observe`（`quxiang.observe`）产生 observed evidence；
3. examiner / `certify.certify`（`certify.*`）先因缺少人工回执以退出码 `2` 拒绝，学历不变；
4. 模拟人工回执绑定学历 ID、learning ID、批准者和时间；examiner 消费回执与观察并发证；
5. auditor / `certify.audit`（`certify.*`）以第四个独立、attested 身份消费证书并写入
   `demo/agentteams-bridge/four-roles-ledger.jsonl`。

发证闸门当前 50 条均为可复跑判据，其中 44 条是反向用例；脚本输出为最终计数真相源。
异常判据包含：观察命令超时（`4`，重派后完成且带 `attempt_id/supersedes`）、homeserver 不可达（明确
`*_unreachable`、`unreachable:true` 且不产出观察）、人工确认拒绝或回执不一致（`2`、学历零改动、台账留痕）。

## 并发语义与 claim 恢复

- **claim 原子占位**：observe 跑考题前以 `sha256(attempt_id)` 为名在台账同目录 `.claims/`
  下 `open('wx')` 独占创建占位文件——并发下同 attempt_id 只有一个进程取得资格，其余
  `attempt_replay`（exit 4）；正常完成的观察自动释放占位，**进程被 kill 时占位残留，
  该 attempt_id 保持 fail-closed（拒绝重放），这是有意的**。
- **崩溃恢复**：被 kill 的观察者留下的 `.claims/<hash>.json` 可清理（占位只是并发闸，
  不是数据；学历里没有观察记录，**清理后必须换新 attempt_id 重试**——旧 attempt_id
  的预查仍会因台账历史拒绝重放，属预期 fail-closed。两个路径都要清：默认
  claim 在台账同目录 `demo/agentteams-bridge/.claims/`，自测判据用的是
    `demo/.claims/`）。判据套件每次运行起点会自动清理**自测目录**的
    `demo/.claims/`（自测 ledger 派生，判据运行不触碰生产 claim 目录）。
    清理命令（PowerShell / bash 两版，任选其一）：
  - PowerShell：`Remove-Item -Path demo/agentteams-bridge\.claims\*, demo\.claims\* -Force -Recurse -ErrorAction SilentlyContinue`
  - bash：`rm -rf demo/agentteams-bridge/.claims demo/.claims`
- **写入层原子性**：`putState` 用 `<state>.lock`（路径 sha256 命名）覆盖读→比→写→回读，
  并发写同一学历时后来者拿 `diverged`（exit 4），不会静默覆盖或丢观察。
  学历写入因此支持多进程并发（不同 attempt 各自持有锁串行落盘）。
- **锁崩溃恢复**：写者被 SIGKILL/断电可能遗留 `<sha256>.lock` 文件——它是空占位，
  清掉即可恢复写入：PowerShell `Get-ChildItem demo -Recurse -Filter *.lock | Remove-Item -Force -ErrorAction SilentlyContinue`，
  或 bash `find demo -name '*.lock' -delete`（锁文件不带数据，删除安全；
  残留期间该学历只能读不能写，这是 fail-closed 的预期行为）。

## publishing 身份模式

`demo-publishing.mjs` 支持 `--identity-mode auto|configured|stub`：`auto` 仅在**没有**
`MATRIX_HOMESERVER_URL` 且 `AT_TOKEN_DIR` 不含 token 时启用 stub；一旦检测到真实配置，
homeserver 预检或 token 缺失必须以 `instrument_unavailable` / 退出码 `3` 失败，绝不静默降级。
`configured` 强制真实配置，`stub` 仅用于包内逻辑复现。输出 JSON 中的 `identity_mode` 是实际运行模式。
