// 第七要素：边界（limits）—— 这份表示**不承载什么、判不了什么、已知在哪里退化**。
//
// ## 为什么它是要素，不是文档惯例
//
// 本象原本声明六要素：对象、关系、载荷、状态、约束、来源。**六个全是「有什么」。**
// 但这个仓库落地四个方言 + 投影层的过程中，同一个动作被重复做了九次：
//
//   CAD    id_basis=content —— 稳定 ID 退化成内容哈希，写进包
//   法律   closed_world=false —— 条文库不完备，查不到判 uncovered 而不是 not-found
//   法律   DEFECTS D11/D12 —— 确定性检查抓不到的两类，写下来并断言抓不到
//   xlsx   DEFECTS D7-D10 —— 为压假阳性**主动放弃**的能力，写下来
//   xlsx   truncated_cells —— 超出 --max-cells 的必须报，悄悄少算等于假装全查了
//   投影   dropped —— 丢弃清单是 plan() 的主要产物，不是返回值里可有可无的一项
//   一致性 覆盖缺口 3 条如实列出，在补上之前「协议保证这几点」不成立
//   约束   无机器判定的约束报 unenforceable 警告，而不是静默跳过
//   实验   Run #18 / #27 撤回自己已经发布的主张
//
// 九次都在做同一件事：**说出自己保证不了什么。** 那它就不是九个决定，是一条原则。
//
// ## 为什么必须进包，而不是写在 README 里
//
// 因为消费方是 AI。**AI 不读 README，它读包。** 边界不进包，边界就不存在——
// 下游会把一个已知有损的东西当作本体继续用，而这正是本项目开篇要解决的
// 「投影的投影」。一份不声明自己边界的表示，比一份坦白说自己很粗糙的表示更危险，
// 因为后者至少让人知道该去核对。
//
// ## 商用上这一条同样是硬需求
//
// 企业拿本象包做审计或交付，第一个问题一定是「这东西保证了什么、不保证什么」。
// 有 limits 段，这个问题**可以被程序读取**；没有，就只能靠人读文档，
// 而人读文档这件事在交付环节从来不发生。

/** 边界的五种类型。分类不是为了好看——不同类型的补法完全不同。 */
export const LIMIT_KINDS = {
  degraded: '本该有的能力退化了，仍可用但会失真（补法：换更好的源）',
  uncovered: '参照数据不完备，判定范围小于声称范围（补法：补数据）',
  undetectable: '这一类问题确定性检查抓不到（补法：交给人，或换非确定性手段）',
  lossy: '这一步已经丢掉了信息（补法：回到上游取，不要从这里取）',
  unverified: '有主张但尚未在真实条件下测过（补法：去测）',
}

/**
 * 校验一组边界声明本身合不合格。
 *
 * **声明必须可执行地具体。** 「本工具可能有误差」这种话等于没说：
 * 它不告诉下游该去核对什么，也不告诉后来人该怎么补。所以强制四件事：
 * 类型合法、范围明确、陈述非空、补法非空。
 */
export function checkLimits(limits = []) {
  const out = []
  const seen = new Set()
  limits.forEach((l, i) => {
    const at = l?.code ?? `#${i}`
    if (!l?.code) out.push({ severity: 'error', code: 'limit-no-code', msg: `边界 ${at} 缺少 code——没有稳定标识就无法在下一版里说「这条已经补上了」` })
    else if (seen.has(l.code)) out.push({ severity: 'error', code: 'limit-duplicate-code', msg: `边界 code 重复：${l.code}` })
    else seen.add(l.code)

    if (!(l?.kind in LIMIT_KINDS)) out.push({ severity: 'error', code: 'limit-bad-kind', msg: `边界 ${at} 的 kind=${JSON.stringify(l?.kind)} 不在 ${Object.keys(LIMIT_KINDS).join(' / ')} 内` })
    if (!l?.scope) out.push({ severity: 'error', code: 'limit-no-scope', msg: `边界 ${at} 缺少 scope——不说清楚管到哪，下游无法判断自己受不受影响` })
    if (!l?.statement) out.push({ severity: 'error', code: 'limit-no-statement', msg: `边界 ${at} 缺少 statement` })
    // 「怎么补」是硬要求：一条不给补法的边界，会变成永久借口而不是待办
    if (!l?.remedy) out.push({ severity: 'warning', code: 'limit-no-remedy', msg: `边界 ${at} 没写补法——边界应当是待办，不是永久借口` })
  })
  return out
}

/**
 * 与本次任务相关的边界。
 *
 * 给 AI 的上下文里塞进全部边界会挤掉正事，但**一条都不塞是危险的**：
 * 模型会拿一个已知不完备的包当完备的用。折中是按 scope 匹配。
 * 匹配不上时仍然返回全部 lossy 与 degraded——那两类影响的是数据本身，与任务无关。
 */
export function relevantLimits(limits = [], scopePattern = null) {
  if (!scopePattern) return limits
  const re = new RegExp(String(scopePattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'))
  return limits.filter((l) => re.test(l.scope) || l.kind === 'lossy' || l.kind === 'degraded')
}

/** 渲染成给人和 AI 都读得懂的一段话。空清单**也要出话**——「未声明任何边界」本身是重要信息。 */
export function renderLimits(limits = []) {
  if (!limits.length)
    return '⚠ 本包未声明任何边界。这不等于它没有边界，只等于没人写下来——请勿据此认为它是无损、完备、已验证的。'
  const byKind = new Map()
  for (const l of limits) {
    if (!byKind.has(l.kind)) byKind.set(l.kind, [])
    byKind.get(l.kind).push(l)
  }
  const lines = ['本包已知的边界（这些是它**保证不了**的部分）：']
  for (const [kind, list] of byKind) {
    lines.push(`\n[${kind}] ${LIMIT_KINDS[kind] ?? ''}`)
    for (const l of list) lines.push(`  · ${l.code}（${l.scope}）：${l.statement}${l.remedy ? `\n      补法：${l.remedy}` : ''}`)
  }
  return lines.join('\n')
}

/** 方言声明边界时用它，省得每处手写字段名 */
export const limit = (code, kind, scope, statement, remedy = null) => ({ code, kind, scope, statement, ...(remedy ? { remedy } : {}) })
