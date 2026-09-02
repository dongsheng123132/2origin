// 浏览器端图纸版本对比——逻辑照抄 adapters/cad/diff.mjs 的 comparePackages()，
// 字段级语义完全一致（同一 ID 存在但字段有差异才算 changed，否则 stable/added/removed）。
;(function () {
  const IDENTITY = new Set(['id', 'type', '_type', 'drawing'])

  function stateOf(o) {
    const s = {}
    for (const [k, v] of Object.entries(o)) {
      if (IDENTITY.has(k)) continue
      if (k === 'id_basis') continue
      s[k] = v
    }
    return s
  }

  function comparePackages(oldObjects, newObjects) {
    const pick = (o) => o.type === 'ent' || o.type === 'text' || o.type === 'block'
    const oldEnts = oldObjects.filter(pick)
    const newEnts = newObjects.filter(pick)
    const oldMap = new Map(oldEnts.map((o) => [o.id, o]))
    const newMap = new Map(newEnts.map((o) => [o.id, o]))

    const changed = [], added = [], removed = [], stable = []

    for (const [id, no] of newMap) {
      const oo = oldMap.get(id)
      if (!oo) { added.push({ id, state: stateOf(no), object: no }); continue }
      const a = stateOf(oo), b = stateOf(no)
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      const diffs = []
      for (const k of keys) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ field: k, from: a[k] ?? null, to: b[k] ?? null })
      }
      if (diffs.length) changed.push({ id, type: no.type, layer: no.layer, diffs, object: no })
      else stable.push({ id, object: no })
    }
    for (const [id, oo] of oldMap) {
      if (!newMap.has(id)) removed.push({ id, type: oo.type, layer: oo.layer, state: stateOf(oo), object: oo })
    }
    return { changed, added, removed, stable }
  }

  window.CadEngine = { comparePackages, stateOf }
})()
