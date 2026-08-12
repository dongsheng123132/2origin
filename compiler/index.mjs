// 本象协议参考实现 —— 公开接口。
//
//   import { loadOrigin, compileContext, validateTransaction, applyTransaction } from './compiler/index.mjs'
//
// 一个完整回合：
//   const origin = loadOrigin('spec/examples/sales-2026.origin')
//   const ctx    = compileContext({ origin, task })            // 输入侧：投影出该看见的
//   const tx     = JSON.parse(await llm(buildPrompt(ctx)))     // AI 只交语义事务
//   const norm   = normalizeTransaction(tx, origin.ids)
//   const check  = validateTransaction({ tx: norm, stateBefore: origin.state, constraints: origin.constraints })
//   if (!check.ok) retry(check.violations)                     // 带证据退回重写
//   const { state } = applyTransaction({ tx: norm, state: origin.state })

export { loadOrigin, stateFromObjects } from './origin.mjs'
export { checkConstraints, predicateNames } from './constraints.mjs'
export { compileContext, compileDelta, selectRelevant, castCamera, buildPrompt } from './context-compiler.mjs'
export { validateTransaction, applyTransaction, normalizeTransaction, normalizeId, fold } from './commit-compiler.mjs'
export { why, historyOf, diagnose, replay, stateChanges, findMirrorPairs, parseRef, nextSeq } from './provenance.mjs'
export { commit, appendHistory, initPackage, seqOf } from './store.mjs'
// 投影侧（一源万影的「影」）。format 层交给方言，核心只管选取、披露、溯源。
// ⚠️ 一致性向量尚未覆盖它——见 spec/conformance/README.md 五
export { planProjection, disclosure, projectionRecord } from './project.mjs'
// 第七要素：这份表示保证不了什么。接手一个陌生包时应当先问它。
export { checkLimits, relevantLimits, renderLimits, limit, LIMIT_KINDS } from './limits.mjs'
