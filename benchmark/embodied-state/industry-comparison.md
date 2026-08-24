# 本象协议在机器人世界状态中的行业定位

## 结论

本象不是“机器人世界模型的最佳完整方案”，也不应替代 ROS、SLAM、场景图、规划器或 VLA。更准确的定位是：

> 面向机器人和 Agent 的、可审计的语义世界状态提交层。

它最有希望形成差异化的地方不是更准地看见世界，而是让系统能回答：当前相信什么、这是观察还是推断、从何时有效、依据哪段传感器证据、谁改过、冲突为何被拒绝。

## 与现有方案的关系

| 方案 | 行业内更擅长的部分 | 本象是否应替代 | 本象可能补的缺口 |
|---|---|---|---|
| ROS 2 / tf2 | 坐标系和时变变换 | 否 | 引用 frame 与时间戳，并记录语义结论的证据与版本 |
| MoveIt PlanningScene | 机器人状态、环境几何、碰撞与约束检查 | 否 | 跨会话语义身份、事实/推断分离、事务历史 |
| SLAM / Kimera / Hydra 3D Scene Graph | 实时几何、拓扑、物体/房间关系和回环优化 | 否 | 对高层语义变化做可审计提交；避免把高频图直接塞进语言模型上下文 |
| KnowRob | 成熟的机器人知识表示、OWL/Prolog推理和多源知识集成 | 否 | 更轻量的事务门禁、版本冲突和逐字段证据协议 |
| OpenUSD | 大规模3D场景、分层组合、非破坏式覆盖和工具互操作 | 否 | 运行期观测/推断状态与证据提交；必要时引用 USD prim 而不复制几何 |
| VLA / learned world model | 从感知到动作、预测动力学和策略学习 | 否 | 为高层Agent提供持久、可查询、可追责的符号状态 |

## 为什么不能现在说“最佳”

1. 当前只有4条固定机位摆拍，尚未跑三臂对照。
2. 本仓库自己的文本消融已经证明：单纯要求模型显式写状态，能复制大部分准确率收益；事务机制的确定优势更可能是证据和治理，而非准确率。
3. 实时机器人需要10–1000Hz的数据路径、概率估计、坐标变换和硬安全保证；本象当前实现不是实时数据库或安全控制器。
4. Hydra/Kimera、MoveIt、KnowRob和OpenUSD已经在各自层面拥有成熟实现、生态或实机论文证据。

所以合格的对外说法应是：“本象提出并实现一种可审计状态提交层，并正在验证其在机器人长期状态维护中的价值”，而不是“已经是最佳机器人世界模型”。

## 推荐架构

采用混合方案，而不是二选一：

1. `tf2 + SLAM/scene graph` 保存高频几何和跟踪；
2. `MoveIt/控制器` 负责规划、碰撞和实时安全；
3. 本象只接收语义变化，例如“B进入A”“跟踪目标A与D存在身份冲突”“A最后确认于R”；
4. 本象状态引用外部大对象和传感器时间段，不复制点云、图像或整段视频；
5. LLM/VLA按任务获取投影，任何写回必须带 `expected_state_version`、证据和认识论状态。

## Embodied 方言还必须补的字段

- `observed_at`、`valid_from/to`、`committed_at` 三种时间；
- `frame_id` 与外部 tf2/地图版本引用；
- `observed | inferred | predicted | unknown`；
- 置信度、TTL/陈旧状态和重新确认策略；
- 感知 track ID 与持久 object ID 分离；
- 身份候选、合并/拆分事务和冲突集合；
- 传感器、模型版本、视频/帧/点云证据引用；
- 派生关系的规则来源，例如 `inside(B,A) + location(A,R) -> derived location(B,R)`；
- 高风险动作所需的新鲜度与证据门槛。

这些应放在 `adapters/embodied` 方言与运行时适配层，不应把机器人专用字段硬塞进本象极简核心。

## 一手资料

- MoveIt PlanningScene：<https://moveit.picknik.ai/main/api/html/planning_scene_overview.html>
- MoveIt PlanningSceneMonitor：<https://moveit.picknik.ai/main/doc/examples/planning_scene_monitor/planning_scene_monitor_tutorial.html>
- Kimera 3D Dynamic Scene Graph：<https://arxiv.org/abs/2101.06894>
- Hydra实时3D场景图：<https://arxiv.org/abs/2201.13360>
- KnowRob：<https://www.knowrob.org/knowrob>
- OpenUSD Introduction：<https://openusd.org/release/intro.html>
