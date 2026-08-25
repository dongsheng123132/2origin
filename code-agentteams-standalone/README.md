# AgentTeams 桥接包（可独立运行）

这是「2origin 本象计算机」的 AgentTeams 交付验证基础设施独立包。
**本目录自含全部依赖**：把本目录整个拷到任何有 Node.js >= 22 的机器上即可运行，
不需要原仓库的其他部分。

## 一分钟验证

```bash
node agentteams/selfcheck.mjs          # 自检：3/3
node agentteams/verify-agentteams.mjs  # 发证闸门判据：33/33
node agentteams/verify-runtime.mjs     # 运行时契约判据：13/13
```

四条全绿即包完好。

`verify-identity-anchors.mjs` 是复赛期新增的跨主机身份锚判据（承诺⑤）：
OIDC userinfo / SPIFFE JWT-SVID 本地验签 / K8s TokenReview 三种签发者适配，
发证闸门 G1~G8 零改动兼容。

## 它做什么

把「Worker 说做完了」改造成一条**可核验的三身份状态流**：

| 身份 | 能做什么 | 不能做什么 |
|---|---|---|
| Executor（作者） | 只能登记 `candidate` 经验 | 不能给自己发 `verified` |
| Sensor（取象） | **唯一**被允许执行检查命令的角色 | 不判分 |
| Examiner（考官） | 只读观察记录、判升降级 | 不执行任何命令 |

三个身份由 Matrix homeserver 签发的 attested 身份担任；无 attested 身份时闸门
fail-closed（拒绝发证并说明理由），而不是降级放行。

## 三身份实弹演示（可选）

需要三个不同的身份。没有真实 Tuwunel 时可用自带测试替身（`stub-homeserver.mjs`，
它只用于走通代码路径，其绿灯**不证明**任何身份强度——见该文件头注）：

```bash
# 终端 1：启动测试替身
node agentteams/stub-homeserver.mjs
# 输出 {"ready":true,"url":"http://127.0.0.1:PORT"}

# 终端 2/3/4：三个身份各自 export 后依次执行
export MATRIX_HOMESERVER_URL=http://127.0.0.1:PORT
export MATRIX_ACCESS_TOKEN=tok-alice
node agentteams/certify.mjs stamp --state demo/agentteams-bridge/task.origin.json \
    --lesson "演示经验" --recheck "node agentteams/selfcheck.mjs --dry-run"

export MATRIX_ACCESS_TOKEN=tok-bob
node agentteams/certify.mjs observe --state demo/agentteams-bridge/task.origin.json \
    --learning L-xxxxxx

export MATRIX_ACCESS_TOKEN=tok-carol
node agentteams/certify.mjs certify --state demo/agentteams-bridge/task.origin.json \
    --learning L-xxxxxx
```

三次调用的 stdout 都是一行 JSON：stamp 登记 candidate、observe 出判决依据、
certify 读观察记录发证。作者指纹 ≠ 考官指纹会落在台账里。

## 目录结构

```
agentteams/    桥接与发证模块本体（CLI 入口 + 两套判据套件）
southbridge/   学历读写核心（乐观锁、schema 闸门、事实生命周期闸门）+ 影核写动作层
xuetang/       学堂核心（经验升降级的纯逻辑）
benxiang/      观测采集（actor/model provenance）
schemas/       学历 JSON Schema（写入闸门的承重件）
demo/          示例学历与发证台账（可直接对它跑 stamp/observe/certify）
```

## 设计文档

- `agentteams/AGENT-IDENTITY.md` — 身份模型
- `agentteams/SKILLS.md` — Skill 形态与版本规矩

## 已知边界（诚实声明）

- 运行时代码零第三方 npm 依赖（仅 Node 标准库），但因此也未内置 OTel 导出器；
  OTel GenAI 映射见复赛材料另册。
- `stub-homeserver.mjs` 是测试替身：它能证明「闸门逻辑成立」，
  不能证明「身份已被外部锚定」——后者需要真实 Tuwunel + Worker 容器。
- Windows 上 runtime start 需要 WSL pin（`runtime.mjs start` 会探测并给出三态诊断）；
  dry-run 与全部判据套件跨平台直接可跑。

## License

MIT
