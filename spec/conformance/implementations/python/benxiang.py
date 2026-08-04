"""本象协议 —— 第二实现（Python 3，零依赖）。

这份代码存在的唯一理由：**证明本象是一个协议，而不是一个程序。**

参考实现是 JavaScript 的。只要世上只有那一份，"本象协议"和"本象这个库"
就没有区别——别人无从判断自己写的算不算数。这份 Python 实现照着
spec/conformance/vectors/ 里的 60 条向量写成，跑同一套向量、同样全绿，
协议才算有了第二个可核对的支点。

诚实的边界：两份实现出自同一作者，中间没有信息隔离，所以它证明的是
"这套语义可以在另一门语言里独立成立、向量是语言中立的契约"，
**不**证明"任何人只读规范就能写对"。后者要等真正的第三方实现。

对应规范：docs/03-协议草案-v0.1.md
"""

import json
import re

# JS 的 undefined 与 null 在协议里是两回事：字段"没写"不等于字段"写了空"。
# Python 只有 None，所以显式引入一个缺失哨兵，避免把两者悄悄合并。
MISSING = object()


def canon(v):
    """规范化取值用于比较。对应参考实现里的 JSON.stringify 比较。

    注意必须区分 True 与 1：Python 里 bool 是 int 的子类，直接用 == 会把
    True 和 1 判成相等，而协议要求它们是不同的值。json.dumps 天然分得开。
    """
    if v is MISSING:
        return "\x00undefined"
    return json.dumps(v, sort_keys=True, ensure_ascii=False)


def get(state, object_id, field):
    obj = (state or {}).get(object_id)
    if not isinstance(obj, dict) or field not in obj:
        return MISSING
    return obj[field]


# ── ID 归一化（§一.7）────────────────────────────────────────────────────
def normalize_id(raw, known):
    """补回命名空间前缀。前缀从已知 ID 现推，不写死任何一张表。"""
    if not isinstance(raw, str) or raw in known:
        return raw
    prefixes = set()
    for oid in known:
        i = oid.find(":")
        if i > 0:
            prefixes.add(oid[: i + 1])
    for p in prefixes:
        if p + raw in known:
            return p + raw
    return raw


def normalize_transaction(tx, known):
    if not isinstance(tx, dict) or not tx.get("state_changes"):
        return tx
    changes = tx["state_changes"]
    if not isinstance(changes, list):
        return tx
    out = []
    for c in changes:
        if not isinstance(c, dict):
            out.append(c)
            continue
        n = dict(c)
        n["object"] = normalize_id(c.get("object"), known)
        n["to"] = normalize_id(c.get("to"), known)
        # 只在原本就写了 from 时才回写——否则未声明前值的变更会凭空长出一个
        # from 键，前值检查便对一个并不存在的声明较真。
        if "from" in c:
            n["from"] = normalize_id(c["from"], known)
        out.append(n)
    return {**tx, "state_changes": out}


# ── 约束谓词（§二）──────────────────────────────────────────────────────
def _match_ids(state, pattern):
    if not isinstance(pattern, str):
        return []
    if "*" not in pattern:
        return [pattern] if pattern in (state or {}) else []
    rx = re.compile("^" + ".*".join(re.escape(p) for p in pattern.split("*")) + "$")
    return [i for i in (state or {}) if rx.match(i)]


def _p_equals(state, c, _before):
    got = get(state, c.get("object"), c.get("field"))
    if canon(got) == canon(c.get("value")):
        return None
    return f"{c.get('object')}.{c.get('field')} 应为 {canon(c.get('value'))}，实为 {canon(got)}"


def _p_not_equals(state, c, _before):
    got = get(state, c.get("object"), c.get("field"))
    if canon(got) != canon(c.get("value")):
        return None
    return f"{c.get('object')}.{c.get('field')} 不得为 {canon(c.get('value'))}"


def _p_not_contains(state, c, _before):
    arr = get(state, c.get("object"), c.get("field"))
    if not isinstance(arr, list):
        return None
    hit = any(canon(x) == canon(c.get("value")) for x in arr)
    return f"{c.get('object')}.{c.get('field')} 不得包含 {canon(c.get('value'))}" if hit else None


def _p_contains(state, c, _before):
    arr = get(state, c.get("object"), c.get("field"))
    ok = isinstance(arr, list) and any(canon(x) == canon(c.get("value")) for x in arr)
    return None if ok else f"{c.get('object')}.{c.get('field')} 必须包含 {canon(c.get('value'))}"


def _p_range(state, c, _before):
    got = get(state, c.get("object"), c.get("field"))
    # 字段不存在或非数值时不判——把"没写"误判成"写错"会淹没真问题。bool 不算数值。
    if isinstance(got, bool) or not isinstance(got, (int, float)):
        return None
    if c.get("min") is not None and got < c["min"]:
        return f"{c.get('object')}.{c.get('field')} = {got}，低于下限 {c['min']}"
    if c.get("max") is not None and got > c["max"]:
        return f"{c.get('object')}.{c.get('field')} = {got}，高于上限 {c['max']}"
    return None


def _p_in(state, c, _before):
    got = get(state, c.get("object"), c.get("field"))
    if got is MISSING:
        return None  # 缺失由 exists 负责，各司其职
    values = c.get("values") or []
    if any(canon(v) == canon(got) for v in values):
        return None
    return f"{c.get('object')}.{c.get('field')} = {canon(got)}，不在允许取值内"


def _p_exists(state, c, _before):
    got = get(state, c.get("object"), c.get("field"))
    empty = got is MISSING or got is None or got == "" or (isinstance(got, list) and not got)
    return f"{c.get('object')}.{c.get('field')} 必填，当前为空" if empty else None


def _p_unique(state, c, _before):
    seen, dups = {}, []
    for oid in _match_ids(state, c.get("object")):
        val = get(state, oid, c.get("field"))
        if val is MISSING or val is None or val == "":
            continue
        k = canon(val)
        if k in seen:
            dups.append(f"{val}（{seen[k]} 与 {oid}）")
        else:
            seen[k] = oid
    return f"{c.get('object')}.{c.get('field')} 出现重复：{'；'.join(dups)}" if dups else None


def _p_count(state, c, _before):
    n = len(_match_ids(state, c.get("object")))
    if isinstance(c.get("equals"), int) and not isinstance(c.get("equals"), bool):
        return None if n == c["equals"] else f"{c.get('object')} 实有 {n} 个，应为 {c['equals']} 个"
    if isinstance(c.get("equals_count_of"), str):
        m = len(_match_ids(state, c["equals_count_of"]))
        return None if n == m else f"{c.get('object')} 有 {n} 个，{c['equals_count_of']} 有 {m} 个，两处对不上"
    if isinstance(c.get("equals_ref"), str):
        ref = c["equals_ref"]
        i = ref.rfind(".")
        want = get(state, ref[:i], ref[i + 1:])
        return None if canon(n) == canon(want) else f"{c.get('object')} 实有 {n} 个，{ref} 声称 {canon(want)} 个"
    return None


def _p_unchanged(state, c, before):
    b = get(before, c.get("object"), c.get("field"))
    a = get(state, c.get("object"), c.get("field"))
    if canon(b) == canon(a):
        return None
    return f"{c.get('object')}.{c.get('field')} 不得改动（{canon(b)} → {canon(a)}）"


PREDICATES = {
    "equals": _p_equals, "not_equals": _p_not_equals, "contains": _p_contains,
    "not_contains": _p_not_contains, "range": _p_range, "in": _p_in,
    "exists": _p_exists, "unique": _p_unique, "count": _p_count, "unchanged": _p_unchanged,
}

# 聚合谓词判的是一组对象之间的关系，不能被通配展开成逐个校验
AGGREGATE = {"unique", "count"}


def check_constraints(state_after, constraints=None, state_before=None):
    out = []
    for c in constraints or []:
        check = c.get("check")
        # 没有机器判定的约束是人类可读的意图声明。静默跳过是危险的——
        # 会让"有约束"的假象掩盖"没校验"的事实。
        if not check:
            out.append({"id": c.get("id") or c.get("rule"), "severity": "warning",
                        "code": "unenforceable", "msg": f"约束「{c.get('rule') or c.get('id')}」无机器判定，未校验"})
            continue
        pred = PREDICATES.get(check.get("type"))
        if not pred:
            out.append({"id": c.get("id") or c.get("rule"), "severity": "warning",
                        "code": "unknown-predicate", "msg": f"未知谓词 {check.get('type')}"})
            continue
        obj = check.get("object")
        if check.get("type") in AGGREGATE or not isinstance(obj, str) or "*" not in obj:
            targets = [check]
        else:
            targets = [{**check, "object": i} for i in _match_ids(state_after, obj)]
        for one in targets:
            msg = pred(state_after, one, state_before or {})
            if msg:
                rule = c.get("rule")
                out.append({"id": c.get("id") or rule, "severity": c.get("severity") or "error",
                            "code": "constraint", "msg": f"{rule + '｜' if rule else ''}{msg}"})
    return out


# ── 折叠（§四之二）──────────────────────────────────────────────────────
def fold(state, changes=None):
    nxt = json.loads(json.dumps(state or {}))
    for c in changes or []:
        if not isinstance(c, dict) or not c.get("object") or not c.get("field"):
            continue
        obj = nxt.setdefault(c["object"], {})
        if c.get("op") == "append":
            if not isinstance(obj.get(c["field"]), list):
                obj[c["field"]] = []
            if not any(canon(x) == canon(c.get("to")) for x in obj[c["field"]]):
                obj[c["field"]].append(c.get("to"))
        else:
            obj[c["field"]] = c.get("to")
    return nxt


def created_ids(tx):
    out = set()
    for x in (tx or {}).get("creates") or []:
        cid = x if isinstance(x, str) else (x or {}).get("id")
        if cid:
            out.add(cid)
    return out


def _creation_changes(tx):
    return [{"object": x["id"], "field": "_type", "to": x["type"]}
            for x in ((tx or {}).get("creates") or [])
            if isinstance(x, dict) and x.get("id") and x.get("type")]


# ── 事务校验（§六）──────────────────────────────────────────────────────
def validate_transaction(tx, state_before, constraints=None, assertions=None):
    v = []
    if not isinstance(tx, dict):
        return {"ok": False, "violations": [{"code": "schema", "msg": "事务不是对象"}]}
    changes = tx.get("state_changes") or []
    if not isinstance(changes, list):
        return {"ok": False, "violations": [{"code": "schema", "msg": "state_changes 必须是数组"}]}

    created = created_ids(tx)
    for i, c in enumerate(changes):
        if not isinstance(c, dict) or not c.get("object") or not c.get("field"):
            v.append({"code": "schema", "msg": f"state_changes[{i}] 缺少 object 或 field"})
            continue
        exists = c["object"] in (state_before or {})
        if not exists and c["object"] not in created:
            v.append({"code": "unknown-object", "msg": f"state_changes[{i}] 未知对象 {c['object']}"})
        elif exists and "from" in c and c.get("op") != "append":
            # 快照隔离：前值接不上是**警告不是错误**。运行时本就知道当前值，
            # 要求模型精确复述旧值是接口刁难——曾按错误处理，一次运行废掉 3 章。
            now = get(state_before, c["object"], c["field"])
            if canon(now) != canon(c["from"]):
                v.append({"code": "stale-write", "severity": "warning",
                          "msg": f"{c['object']}.{c['field']} 前值不符"})

    state_after = fold(state_before, _creation_changes(tx) + changes)
    v.extend(check_constraints(state_after, constraints, state_before))

    for a in tx.get("assertions") or []:
        pred = (assertions or {}).get(a)
        if pred is None:
            v.append({"code": "unknown-assertion", "severity": "warning", "msg": f"断言 {a} 无法复核（未登记）"})
        elif not pred(state_after):
            v.append({"code": "assertion-failed", "msg": f"声明 {a}，复核不成立"})

    errors = [x for x in v if x.get("severity") != "warning"]
    return {"ok": not errors, "violations": v, "state_after": state_after}


# ── 落地与证据链（§四之二）──────────────────────────────────────────────
def apply_transaction(tx, state, history=None, by="unknown", at=None):
    all_changes = _creation_changes(tx) + ((tx or {}).get("state_changes") or [])
    nxt = fold(state, all_changes)
    journal = []
    seq = max([0] + [e.get("seq") or 0 for e in (history or []) if isinstance(e, dict)])

    for c in all_changes:
        if not isinstance(c, dict) or not c.get("object") or not c.get("field"):
            continue
        seq += 1
        actual_from = get(state, c["object"], c["field"])
        rec = {"event": "state_change", "seq": seq, "object": c["object"], "field": c["field"],
               "to": c.get("to"),
               "kind": c.get("kind") or (tx or {}).get("kind") or "observed",
               "tx": (tx or {}).get("transaction_id"), "by": by, "at": at}
        # from 记落地那一刻的**真实**前值；模型说错了另记 claimed_from
        if actual_from is not MISSING:
            rec["from"] = actual_from
        if c.get("op"):
            rec["op"] = c["op"]
        if c.get("op") != "append" and "from" in c and canon(c["from"]) != canon(actual_from):
            rec["claimed_from"] = c["from"]
        basis = c.get("basis") if c.get("basis") is not None else (tx or {}).get("depends_on")
        if isinstance(basis, list) and basis:
            rec["basis"] = basis
        journal.append(rec)
    return {"state": nxt, "journal": journal}


# ── 重放（§四之二）──────────────────────────────────────────────────────
def state_from_objects(objects):
    state = {}
    for o in objects or []:
        oid = o.get("id")
        if not oid:
            continue
        fields = {k: val for k, val in o.items() if k not in ("id", "type")}
        if o.get("type"):
            fields["_type"] = o["type"]
        state[oid] = fields
    return state


def replay(base_state, history=None, until=None):
    """当前状态 = 出生状态折叠全部变更。objects 是出生证明，history 是履历。"""
    all_changes = sorted([e for e in (history or []) if isinstance(e, dict) and e.get("event") == "state_change"],
                         key=lambda e: e.get("seq") or 0)
    if until is not None:
        if isinstance(until, bool):
            pass
        elif isinstance(until, (int, float)):
            all_changes = [r for r in all_changes if (r.get("seq") or 0) <= until]
        else:
            idx = next((i for i, r in enumerate(all_changes) if r.get("tx") == until), -1)
            if idx >= 0:
                all_changes = all_changes[: idx + 1]
    return fold(base_state, [{"object": r.get("object"), "field": r.get("field"),
                              "op": r.get("op"), "to": r.get("to")} for r in all_changes])
