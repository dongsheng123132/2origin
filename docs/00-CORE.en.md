# 00 · The Core

> **If you read one page, read this one.**
> This page is the skeleton of the whole family of protocols — Benxiang (Origin), ActionParity,
> and Origin-Environment — checked against [Reference-First](09-Reference-First.en.md) recursively.
> Every other document is an expansion of this page, a dialect of it, or a proof of it.
>
> 🇨🇳 **[中文](00-极简核心.md)**

## In one sentence

**An object has a stable ID pointing at a single source of truth; everyone else carries only a
reference, resolved at use-time and version-checked; an AI ships only transactions that a validator
lands; and the protocol promises only what is checkable.**

## Five concepts (the whole system is these)

| # | Concept | What it is | The question it answers |
|---|---|---|---|
| 1 | **Object** | stable ID + single source of truth | What is this? Which one is real? |
| 2 | **Reference** | minimal · stable · resolvable · fresh (version/watermark/fingerprint) | Am I holding an address or a copy? |
| 3 | **Projection** | on demand, rebuildable, discloses what it dropped; never the source | Can this view stand in for the original? |
| 4 | **Transaction** | AI's output = what it references + what it asserts + what it changes | How does an AI write back to the world safely? |
| 5 | **Validation** | checkable = promised; unpinned = honestly labelled | Does this statement count? |

## The three protocols = these five concepts + dialects

| Protocol | Its "object" | Dialects (optional extensions, never core) |
|---|---|---|
| **Benxiang** | `.origin` pack / object ID | Story · Office · CAD · Chart · Memory … |
| **ActionParity** | action name | every executor is a dialect of it |
| **Origin-Environment** | environment fingerprint | detectors · rules · adapters are dialects of it |

## Complexity audit (everything outside the core, by kind)

| Layer | It is | Required? |
|---|---|---|
| Core | the five concepts above | ✅ required |
| Dialect | a domain's own schema | on demand; never enters the core |
| Proof | conformance vectors, mutation, evidence chain | the more you promise, the more required; may grow |
| Convention/docs | glossary, layout, action surface, README | ⚠️ where the real trimmable bloat lives |

Example: the unified action surface lists nine actions, but **the true core is three** —
`inspect` (read), `commit` (write), `validate` (check);
`render / query / act / diff / project / replay` are all derived from them.
Everything outside the core is optional.

## One hard rule (Reference-First applied to the protocols themselves)

> **If a new dialect or protocol cannot be stated in these five concepts, it is quietly growing fat.**
> Ask first: does it introduce a **new concept**, or a **new dialect**?
> A new concept → the core must be reviewed to take it. A new dialect → it stays out of the core, freely.

---

> Everything is a reference; truth is resolved at runtime. Outside the core, all is optional.
