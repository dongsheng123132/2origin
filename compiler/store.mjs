// 持久化层——把「校验通过」变成「真的写进去了」。
//
// 在此之前整套参考实现是纯内存的：applyTransaction 返回一个新状态对象，
// 然后就没有然后了。能跑 benchmark，不能真用——**没有落盘就没有「持久对象表示层」**。
//
// 三条规矩，都是为了让证据链站得住：
//
// ① **只追加，不覆写。** 提交只往 provenance/history.jsonl 追加记录，
//    永远不改 graph/objects.jsonl。objects 是出生证明，history 是履历，
//    当前状态由二者重放得出（见 origin.mjs 的 loadOrigin）。
//    一旦允许把当前值写回 objects，历史就降级成一份说明文档，对不上账时无从追责。
//
// ② **不通过就不落盘。** 校验失败时一个字节都不写，违规原因原样返回给调用方重写。
//    「拒绝」与「静默」的区别在于前者留下可供人接手的产物（docs/03 原则十）。
//
// ③ **写入要抢锁，并检查有没有人插队。** 两个 agent 同时提交是迟早的事。
//    锁用 O_EXCL 独占创建，冲突检测用 expectedSeq——读的时候世界是第 N 号，
//    写的时候若已经是第 N+2 号，说明有人插队，本次提交作废重来（首个写者胜）。
//    这是快照隔离最省的一种实现，也是多 agent 协作的最低门槛。

import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, statSync, openSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { loadOrigin } from './origin.mjs'
import { normalizeTransaction, validateTransaction, applyTransaction } from './commit-compiler.mjs'
import { nextSeq } from './provenance.mjs'

const HISTORY = ['provenance', 'history.jsonl']
const LOCK_STALE_MS = 30_000

/** 追加事件记录。records 为空时直接返回，不创建文件。 */
export function appendHistory(dir, records = []) {
  if (!records.length) return 0
  const path = join(dir, ...HISTORY)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  return records.length
}

/** 独占锁。O_EXCL 创建即占有；超过 LOCK_STALE_MS 的锁视为持有者已死，可抢占。 */
function withLock(dir, fn) {
  const lock = join(dir, '.origin.lock')
  let fd
  for (let i = 0; i < 50; i++) {
    try { fd = openSync(lock, 'wx'); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { unlinkSync(lock); continue }
      } catch { /* 锁刚被别人释放，下一轮重试 */ }
      const until = Date.now() + 20
      while (Date.now() < until) { /* 短自旋：提交是毫秒级操作，不值得引入异步 */ }
    }
  }
  if (fd === undefined) throw new Error(`无法获取写锁 ${lock}（超时）`)
  try { closeSync(fd); return fn() } finally { try { unlinkSync(lock) } catch { /* 已被抢占清理 */ } }
}

/**
 * 提交一个语义事务到磁盘。
 *
 * @param dir          .origin 包路径
 * @param tx           语义事务（见 spec/schemas/transaction.schema.json）
 * @param by           责任者，会写进每条记录——「谁改的」不许缺省为匿名
 * @param at           时间戳，缺省取当前时刻
 * @param expectedSeq  读取时看到的 seq 水位；落盘前若已被他人推进则拒绝（首个写者胜）
 * @param assertions   断言名 → 谓词，用于复核模型自报的 assertions
 * @param prose        正文校验钩子（见 commit-compiler.validateTransaction）
 *
 * @returns 成功 { ok: true, receipt: { tx, by, at, seq_from, seq_to, changed, warnings } }
 *          失败 { ok: false, violations, errors }      —— 一个字节都没写
 *          冲突 { ok: false, conflict: { expected, actual } }
 */
export function commit(dir, tx, { by = 'unknown', at = null, expectedSeq = null, assertions = {}, prose = null } = {}) {
  return withLock(dir, () => {
    const origin = loadOrigin(dir)
    const seqNow = nextSeq(origin.history) - 1

    if (expectedSeq !== null && expectedSeq !== seqNow)
      return { ok: false, conflict: { expected: expectedSeq, actual: seqNow }, violations: [{ code: 'write-conflict', msg: `读取时世界在第 ${expectedSeq} 号，现已是第 ${seqNow} 号——有人插队，请基于最新状态重写` }], errors: 1 }

    const norm = normalizeTransaction(tx, origin.ids)
    const check = validateTransaction({ tx: norm, stateBefore: origin.state, constraints: origin.constraints, assertions, prose })
    if (!check.ok) return { ok: false, violations: check.violations, errors: check.errors }

    const stamp = at ?? new Date().toISOString()
    const { journal } = applyTransaction({ tx: norm, state: origin.state, history: origin.history, by, at: stamp })
    appendHistory(dir, journal)

    return {
      ok: true,
      receipt: {
        tx: norm.transaction_id ?? null,
        by, at: stamp,
        seq_from: journal[0]?.seq ?? seqNow,
        seq_to: journal[journal.length - 1]?.seq ?? seqNow,
        changed: journal.map((r) => `${r.object}.${r.field}`),
        warnings: check.violations.filter((v) => v.severity === 'warning'),
      },
    }
  })
}

/** 建一个空包。objects 写进出生证明，此后只能由事务改动。 */
export function initPackage(dir, { manifest = '', objects = [], relations = [], constraints = [], limits = [] } = {}) {
  mkdirSync(join(dir, 'graph'), { recursive: true })
  mkdirSync(join(dir, 'provenance'), { recursive: true })
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  if (manifest) writeFileSync(join(dir, 'manifest.yaml'), manifest, 'utf8')
  writeFileSync(join(dir, 'graph', 'objects.jsonl'), jsonl(objects), 'utf8')
  writeFileSync(join(dir, 'graph', 'relations.jsonl'), jsonl(relations), 'utf8')
  writeFileSync(join(dir, 'graph', 'constraints.json'), JSON.stringify(constraints, null, 2) + '\n', 'utf8')
  // 第七要素：这份表示保证不了什么。空清单也要落盘——
  // 有一个空文件，和根本没这个文件，对下游是两回事。
  writeFileSync(join(dir, 'graph', 'limits.json'), JSON.stringify(limits, null, 2) + '\n', 'utf8')
  if (!existsSync(join(dir, ...HISTORY))) writeFileSync(join(dir, ...HISTORY), '', 'utf8')
  return loadOrigin(dir)
}

/** 当前 seq 水位。提交前读一次，落盘时当 expectedSeq 传回，即可发现插队。 */
export function seqOf(dir) {
  const path = join(dir, ...HISTORY)
  if (!existsSync(path)) return 0
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
  return Math.max(0, ...lines.map((l) => { try { return JSON.parse(l).seq ?? 0 } catch { return 0 } }))
}
