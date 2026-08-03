// Memory 方言 —— 用本象表示「一个项目此刻的状态」。
//
// 通用外壳（对象 + 字段 + 确定性规则 + 证据链）由 compiler/ 提供，这里只加两样东西：
// **一组对象类型**，和**一组机器可判定的约束**。没有一行新的校验代码——
// 若表示一个项目的状态还需要改校验器，那说明它不是协议，只是又一个工具。
//
// 五类对象，覆盖「聊完之后真正值得留下来的东西」：
//
//   decision:  决策——定了什么、为什么定、还算不算数
//   task:      待办——谁在做、做到哪一步
//   risk:      风险——知道有这个坑、现在处理到哪
//   fact:      已核实的事实——附证据，与推断分开
//   module:    工作区/模块——状态挂在哪块地上
//
// 刻意不收的：聊天记录本身、临时想法、没有结论的讨论。
// 那些属于操作窗口，用完即弃——**能被丢掉而不心疼，正是这套设计要换来的东西**。

export const MEMORY_TYPES = ['decision', 'task', 'risk', 'fact', 'module']

export const DECISION_STATUS = ['proposed', 'decided', 'superseded']
export const TASK_STATUS = ['open', 'doing', 'done', 'dropped']
export const RISK_STATUS = ['open', 'mitigated', 'accepted', 'closed']

/**
 * 方言约束。全部用通配对象——新增一个决策/待办，约束自动覆盖它，
 * 不需要有人记得去补一条规则。「忘了加约束」是状态腐坏最常见的入口。
 */
export const MEMORY_CONSTRAINTS = [
  { id: 'decision-status', rule: '决策状态只能是 proposed / decided / superseded',
    check: { type: 'in', object: 'decision:*', field: 'status', values: DECISION_STATUS } },

  // 没有理由的决策，三个月后没人说得清当初为什么这么定——「为什么」比「是什么」更容易丢
  { id: 'decision-rationale', rule: '每个决策必须写明理由',
    check: { type: 'exists', object: 'decision:*', field: 'rationale' } },

  { id: 'task-status', rule: '待办状态只能是 open / doing / done / dropped',
    check: { type: 'in', object: 'task:*', field: 'status', values: TASK_STATUS } },

  { id: 'task-owner', rule: '每个待办必须有负责人',
    check: { type: 'exists', object: 'task:*', field: 'owner' } },

  { id: 'risk-status', rule: '风险状态只能是 open / mitigated / accepted / closed',
    check: { type: 'in', object: 'risk:*', field: 'status', values: RISK_STATUS } },

  // 事实与推断分离（docs/03 原则四）：声称是「已核实的事实」就得指得出证据在哪
  { id: 'fact-evidence', rule: '每条事实必须附证据引用',
    check: { type: 'exists', object: 'fact:*', field: 'evidence' } },
]

export const MEMORY_MANIFEST = (id, title) => `# 本象记忆包（Memory 方言）
artifact:
  id: ${id}
  kind: memory
  title: ${title}

provenance:
  history: ./provenance/history.jsonl
`

/** 交给模型的输出契约。模型只有知道要交什么形状的东西，才可能交对。 */
export const TX_CONTRACT = [
  '一个语义事务。只写本轮**真实发生**的状态变化，不要复述没变的东西。',
  'object 必须用完整 ID（含 decision: / task: / risk: / fact: / module: 前缀）。',
  '要新建对象，必须在 creates 里显式声明，如 creates: [{"id":"decision:mvp","type":"decision"}]，',
  '再在 state_changes 里写它的字段。未声明就写一个不存在的对象会被判为未知对象——',
  '这是为了让「ID 打错一个字母」当场暴露，而不是静默造出一个永远没人管的幽灵对象。',
  '不确定当前值就不要写 from——写错只记为偏差，不影响落地。',
].join('\n')

/** 一个空记忆包的初始对象表。留一个锚对象，免得包一出生连 ID 前缀都推不出来。 */
export const seedObjects = (projectId, title) => [
  { id: `module:${projectId}`, type: 'module', name: title, status: 'active' },
]
