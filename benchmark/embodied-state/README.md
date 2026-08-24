# Benxiang Embodied-State Mini Benchmark

这是本象协议面向机器人的第一套**试验性状态基准**。它不是目标检测数据集，也不测试机械臂控制；它测试系统在遮挡、移动、相似物替换和容器携带期间，能否维护可查询、可追溯、不过度声称的世界状态。

## 本象在这里负责什么

本象不负责从像素识别盒子，也不负责实时定位或控制电机。它位于感知/跟踪之后、规划/Agent之前，负责四件事：

1. 把对象身份、位置、包含关系变成持续存在的显式状态；
2. 把一次感知更新变成带前值、后值和证据的语义事务；
3. 用门禁拒绝无证据身份合并、幽灵对象和陈旧写入；
4. 同时保存“世界真值”和“机器人有资格知道的内容”，不让推断冒充观察。

因此正确的系统分层是：

```text
相机/雷达/触觉
      ↓
SLAM、检测、跟踪、场景图（高频、概率、几何）
      ↓ 只提交语义上重要的状态变化
本象 Embodied 方言（身份、关系、证据、版本、冲突）
      ↓ 按任务投影
规划器 / VLA / LLM Agent
      ↓
实时控制与安全回路（不经过本象）
```

## 四个场景

| 场景 | 原片 | 测试点 | 机器人观察版 |
|---|---|---|---|
| S01 | IMG_8216.MOV | 遮挡期间静态持续 | 4–10 秒数字遮挡 A |
| S02 | IMG_8217.MOV | 隐藏移动与诚实弃权 | 8.5–13 秒遮挡 M→R 路径 |
| S03 | IMG_8214.MOV | 相似物不能自动合并身份 | 4.25–9.75 秒隐藏替换动作 |
| S04 | IMG_8218.MOV | `inside(B,A)` 随 A 携带并在取出时解除 | 使用自然遮挡 |

原片是不可修改的 `truth_master`；数字遮挡只施加在派生的机器人观察版。文件指纹、事件和问题都在 [benchmark.json](./benchmark.json) 中。

## 验证与生成

```powershell
node benchmark/embodied-state/validate.mjs --source-dir "D:\xwechat_files\wxid_t0g172bwfghi12_df5c\msg\file\2026-08"
node benchmark/embodied-state/render-observations.mjs --source-dir "D:\xwechat_files\wxid_t0g172bwfghi12_df5c\msg\file\2026-08"
node benchmark/embodied-state/score.mjs benchmark/embodied-state/example-response.json
```

默认输出到 `artifacts/observations/`，该目录不会进入 Git。所有观察版统一转为 H.264/yuv420p，便于浏览器和常见模型读取。

## 公平对照

不能只比较“普通模型”和“本象”，那会把“要求模型显式维护状态”的收益错误归给协议。因此预注册三臂：

- A0：无状态视频问答；
- A1：只用提示词维护显式状态表，无事务、门禁和证据要求；
- A2：本象事务状态层。

分别报告状态值准确率、认识论状态准确率、编造次数、证据覆盖率/精度、无效事务拒绝率与更新延迟，不压成一个容易挑口径的总分。

## 当前结论边界

现在得到的是**合格装置和可执行判分协议**，不是本象优于行业方案的实验结果。4条摆拍视频只够冒烟测试；要做公开结论，至少需要更多场景、多人独立标注、不同相机/物体/光照、真实机器人数据和预注册统计方案。

行业定位与替代方案见 [industry-comparison.md](./industry-comparison.md)。

## 首轮模型试跑

已用同一`qwen3.5-omni-plus`模型完成单次试跑。A0、A1与只有事务结构门禁的A2，状态值均为7/9；探索性语义门禁A2G把自信编造从2降为0，但误伤正确回答，总准确率仍为7/9。**没有证据表明本象在当前装置上提高了状态准确率。**

完整口径、逐题缺陷和下一版对象模型见 [pilot-report.md](./pilot-report.md)。

运行命令：

```powershell
node benchmark/embodied-state/prepare-clips.mjs
node benchmark/embodied-state/upload-clips.mjs
node benchmark/embodied-state/run-pilot.mjs --arm A0
node benchmark/embodied-state/run-pilot.mjs --arm A1
node benchmark/embodied-state/run-pilot.mjs --arm A2
node benchmark/embodied-state/run-pilot.mjs --arm A2G
```

`local-sources.json`包含48小时临时上传URL，不进入Git；运行过期后重新执行上传脚本。
