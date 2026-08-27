# AgentTeams 证据链桥

这个目录把“Worker 说完成了”改造成一条可核验的三身份状态流：Executor 只能登记 `candidate`，Sensor 独立运行检查器并产生观察，Examiner 只读观察发证。作者、取象者、考官由 AgentTeams 自带 Tuwunel 签发，令牌不写进学历或输出。

运行时仅使用 Node.js 标准库。当前一键生命周期入口面向 Windows 11 + WSL2 + Docker CE，默认管理 `agentteams-controller`、`agentteams-manager`、`agentteams-dashboard` 三个现有容器；它不负责安装 Docker 或首次创建容器。

## 30 秒验证

```powershell
node agentteams/selfcheck.mjs --dry-run
node agentteams/selfcheck.mjs
node agentteams/runtime.mjs start
node agentteams/selfcheck.mjs --live
```

`selfcheck` 不读取模型 API key 或 Matrix token。默认验证运行控制的 13 条故障注入、发证闸门 50 条判据（其中 44 条反向用例），以及启动 dry-run 无副作用；`--live` 额外验证 WSL 常驻钉、Docker daemon、三个容器、三个 HTTP 入口。

所有 CLI 的 stdout 都只有一行 JSON，日志走 stderr，成功退出码为 0。`runtime health` 不健康返回 3，启动或停止动作失败返回 4。

## 生命周期

```powershell
node agentteams/runtime.mjs start --dry-run
node agentteams/runtime.mjs start
node agentteams/runtime.mjs health
node agentteams/runtime.mjs stop
```

`start` 是幂等的：已有专用 WSL 常驻钉和运行中的容器不会重复启动。成功不是“docker start 返回 0”，而是专用常驻钉、Docker、容器状态、Matrix/Manager/Dashboard HTTP 四层都通过。配置项见 `agentteams/runtime.env.example`；URL 中的凭据、query 和 fragment 会从诊断证据中删去。

## 出版社审稿 Trace

首次运行或临时令牌目录被系统清理后，先让本机 AgentTeams/Tuwunel 签发三个演示身份：

```powershell
node agentteams/provision-identities.mjs
```

脚本只把三个短期令牌原子写入本机 `AT_TOKEN_DIR`（默认 `%LOCALAPPDATA%\\Temp\\at-tokens`），stdout 只返回身份指纹，不打印令牌。随后运行：

```powershell
node agentteams/runtime.mjs start
node agentteams/demo-publishing.mjs
```

脚本使用真实教材一致性检查器 `demo/book-project/verify-book.mjs`，顺序证明：

1. Executor 只能写入 candidate；
2. 没有第三方观察时 Examiner 被拒，学历字节级不变；
3. Sensor 独立跑检查器，只产出观察；
4. Examiner 不跑命令，只读观察升为 verified；
5. 同一观察无法重复发证。

成功输出 `demo.result`，包含 8 个布尔判据和三方身份指纹，不含 token。审计事件经南桥追加到 `demo/agentteams-bridge/publishing-demo-ledger.jsonl`。更完整的真实身份攻击面验证与跨领域复用分别是：

```powershell
node demo/agentteams-bridge/e2e-real-attestation.mjs
node demo/agentteams-bridge/e2e-crossdomain.mjs
```

## CAD 窗户计数证据

```powershell
node agentteams/cad-window-audit.mjs
```

默认对能力测试图 `D:/uking编程/本象协议/adapters/cad/fixtures/A-101.dxf` 运行真实 CAD 解析器，按门窗层闭合实体计数，并把标注文字逐樘关联回实体与 bbox。当前固定样例的结论是 4 樘窗、3 个标注、2 个唯一编号；C2 重号且第 4 樘漏编号。图文报告、原图/高亮图和机器可读 Trace 输出到 `agentteams/submission/cad-window-audit/`。

这张 A-101 是能力测试图，不是客户原图。客户实图应优先提供 DXF（推荐 R13+，可保留实体 handle）；DWG 需先在本地离线转换，禁止把客户图上传在线转换站。R12/AC1009 仍可可靠计数，但跨版本实体身份只能退化为内容哈希。

演示材料分开维护：初赛原稿 `agentteams/submission/AgentInfra-证据链-初赛方案.pptx` 不覆盖；包含 CAD 实体证据与运行证据的 13 页版本位于 `agentteams/submission/AgentInfra-证据链-路演演示版.pptx`；进一步把四层在线、出版社 Trace、真实身份/反向闸门、跨领域复用都做成实跑截图的 17 页版本位于 `agentteams/submission/AgentInfra-证据链-路演演示版-证据可视化.pptx`。

## 文件入口

- `certify.mjs`：`stamp` / `observe` / `certify` 三段式发证协议。
- `identity.mjs`：通过 Matrix `whoami` 观察平台签发身份。
- `runtime.mjs`：一键 start / health / stop。
- `selfcheck.mjs`：不带密钥的可分发自检。
- `verify-agentteams.mjs`：核心安全闸门判据。
- `verify-runtime.mjs`：生命周期故障注入判据。
- `cad-window-audit.mjs`：CAD 门窗实体计数、标注一致性与图文证据导出。
- `AGENT-IDENTITY.md`：身份威胁模型和证明强度边界。
- `SKILLS.md`：完整 Skill 输入输出、失败处理与复用说明。

## 明确边界

- 本地 Tuwunel 的身份强度来自进程和用户名空间隔离，不等于第三方运营的身份锚。
- `runtime.mjs` 管理已经存在的容器，不替代 AgentTeams 的安装和首次配置。
- 真身份 Demo 需要本地预置的三个 Matrix token；无密钥自检不需要。
- 模型推理和付费 API 不在这条验证路径中，缺少模型 key 不影响闸门与审稿证据链复核。

协议以 Apache-2.0 兼容方式分发，运行时代码无第三方 npm 依赖。
