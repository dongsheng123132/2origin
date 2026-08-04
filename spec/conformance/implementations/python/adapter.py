#!/usr/bin/env python3
"""Python 实现的一致性适配器。契约与 compiler/conformance-adapter.mjs 完全相同。

    echo '{"version":1,"cases":[...]}' | python3 adapter.py

跑法：
    node spec/conformance/run.mjs --adapter "python spec/conformance/implementations/python/adapter.py"
"""

import json
import sys

sys.path.insert(0, __file__.rsplit("adapter.py", 1)[0] or ".")

from benxiang import (  # noqa: E402
    check_constraints, fold, normalize_transaction, validate_transaction,
    apply_transaction, state_from_objects, replay,
)


def build_assertions(decl):
    """断言跨语言传不了函数，所以向量把它写成「名字 → 约束判定」的数据。"""
    return {name: (lambda st, ck=check: not check_constraints(st, [{"id": "a", "check": ck}]))
            for name, check in (decl or {}).items()}


def codes(violations, want_warning):
    return sorted(v["code"] for v in violations
                  if (v.get("severity") == "warning") == want_warning)


def op_normalize(i):
    tx = normalize_transaction(i.get("transaction"), set(i.get("ids") or []))
    changes = tx.get("state_changes") if isinstance(tx, dict) else None
    return {"transaction": tx,
            "changeKeys": [sorted(c.keys()) for c in changes] if isinstance(changes, list) else []}


def op_validate(i):
    r = validate_transaction(i.get("transaction"), i.get("state") or {},
                             i.get("constraints") or [], build_assertions(i.get("assertions")))
    return {"ok": r["ok"], "codes": codes(r["violations"], False), "warnings": codes(r["violations"], True)}


def op_constraints(i):
    v = check_constraints(i.get("state") or {}, i.get("constraints") or [], i.get("stateBefore") or {})
    return {"codes": codes(v, False), "warnings": codes(v, True),
            "ids": sorted(x["id"] for x in v if x.get("severity") != "warning")}


def op_fold(i):
    return {"state": fold(i.get("state") or {}, i.get("changes") or [])}


def op_apply(i):
    r = apply_transaction(i.get("transaction"), i.get("state") or {}, i.get("history") or [],
                          i.get("by", "conformance"), i.get("at"))
    return {"state": r["state"], "journal": r["journal"]}


def op_replay(i):
    return {"state": replay(state_from_objects(i.get("objects") or []),
                            i.get("history") or [], i.get("until"))}


OPS = {"normalize": op_normalize, "validate": op_validate, "constraints": op_constraints,
       "fold": op_fold, "apply": op_apply, "replay": op_replay}


def main():
    req = json.loads(sys.stdin.read())
    results = []
    for case in req.get("cases") or []:
        fn = OPS.get(case.get("op"))
        if not fn:
            results.append({"id": case.get("id"), "unsupported": True})
            continue
        try:
            results.append({"id": case.get("id"), "output": fn(case.get("input") or {})})
        except Exception as e:  # 如实报错，不吞
            results.append({"id": case.get("id"), "error": f"{type(e).__name__}: {e}"})
    sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
