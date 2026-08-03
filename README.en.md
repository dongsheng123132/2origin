# Benxiang · 本象协议

> **Save the origin, project on demand.** 一源万影：保存本象，按需投影。
>
> 「立象以尽意」——《易传·系辞》 · *Establish the image to exhaust the meaning.*

**Benxiang** (pronounced *bun-SHYAHNG*): Ben (本) = origin, Xiang (象) = archetypal image. From the *Book of Changes* — «the sage establishes images to exhaust meaning» — and the *Tao Te Ching* — «the great image has no form», and therefore can be projected into any form. The technical core is called **Origin IR**.

**Status: v0.1 — protocol draft + working reference implementation + two-tier experimental data**
([reference implementation](compiler/) · [experiment log](benchmark/shadowbench-w/results-log.md), in Chinese)

---

## What the data says

The claim has been **narrowed by experiment** to exactly one dimension: **state tracking**.

**State accuracy (W3)**

| Model · baseline | Benxiang | Naive LLM | Vector RAG |
|---|---|---|---|
| qwen-plus · S-tier (20k chars, 10 runs each) | **92.5%** | 75.0% | 75.0% |
| qwen-plus · M-tier (95k chars, 11 runs each) | **98.9%** | 75.0% | 75.0% |
| deepseek-v4-flash · M-tier (**n=1, smoke**) | **100.0%** | **37.5%** | 75.0% |

**The last row carries the most weight.** Bare deepseek scores 37.5% — half of what qwen manages. These two models are not in the same league at tracking state. Put both behind the same state machine and gate, and both land at or near a perfect score.

**Benxiang lifts two models of very different strength to the same height. State correctness comes from the architecture, not from the model.** That is the property a *protocol* ought to have: it should not depend on how strong the machine underneath happens to be.

Stretching the baseline from 20k to 95k characters made the gap **wider**, not narrower. Vector RAG is exactly the technique that should benefit from a longer context — it didn't move at all. Retrieval can find text; it cannot find *who is holding the key right now*. That answer appears in no passage — it is derived. RAG can carry a weak model up to the 75% wall; it does not get over it.

**What we do *not* claim:** prose consistency shows **no significant difference** from RAG (S-tier p=0.9905, M-tier p=0.3361). Benxiang costs **more** tokens, and how much more depends on the model: **+25% on qwen, +149% on the long-reasoning deepseek**. Earlier claims of "writes more consistently" and "saves tokens" have been withdrawn — the data does not support the first and contradicts the second.

---

## The problem

Three structural defects in how AI works with documents today:

| Defect | Symptom | Benxiang's answer |
|---|---|---|
| **Perception** | AI can generate Word/Excel/PPT/CAD but has no stable open→see→locate→edit→verify loop; it reads projections of projections (OCR of a screenshot, summary of a summary) | Keep source objects, projection rules and edit history; compile the context the task actually needs |
| **Memory** | Chat logs get treated as project state; the longer the session the closer to overflow, and compression keeps losing fidelity | Chat is a temporary window onto the origin; world state persists outside it and is restorable |
| **Output** | AI emits whole artifacts (a 40-page deck, a million-word draft) and content, format and references fail together | AI emits compact **semantic transactions** (what changed, on what it depends, what it asserts); a deterministic compiler produces the final state |

## The core idea

The origin is **not "a bigger JSON"**. It holds six things at once:

```text
objects      — real entities with stable IDs
relations    — who owns / references / depends on / derives from whom
payloads     — native domain data (geometry, formulas, timelines…)
states       — past, present, change, and cause
constraints  — what may be done, what must never be violated
provenance   — who created it, who changed it, what is inferred
```

PDFs, images, Markdown and EPUB are **not source files** — they are **projections** (cached views) generated from the origin.

---

## Try it

```bash
node compiler/selftest.mjs     # 27 checks across two unrelated domains
```

One full round trip:

```js
import { loadOrigin, compileContext, buildPrompt,
         normalizeTransaction, validateTransaction, applyTransaction } from './compiler/index.mjs'

const origin = loadOrigin('spec/examples/sales-2026.origin')
const ctx    = compileContext({ origin, task, budget: 6000 })   // project what should be seen
const tx     = JSON.parse(await llm(buildPrompt(ctx)))          // AI emits a transaction, not a final artifact
const norm   = normalizeTransaction(tx, origin.ids)
const res    = validateTransaction({ tx: norm, stateBefore: origin.state, constraints: origin.constraints })

if (!res.ok) return retry(res.violations)                       // bounce back with evidence
const { state, provenance } = applyTransaction({ tx: norm, state: origin.state })
```

### Why constraints are data, not code

This is the line between *a protocol* and *a program that happens to work once*.

In the benchmark arm, constraints were three hard-coded types — `field_must_stay`, `knows_must_not_gain`, `hook_must_stay`. The names give it away: `knows` and `hook` are narrative concepts. The sales-data example needed something else entirely (`revenue must_not_be_negative`). If every domain writes its own validator, that is not a protocol — it is several programs that resemble one another.

They collapse into six general predicates — `equals`, `not_equals`, `contains`, `not_contains`, `range`, `unchanged` — and all three narrative types are expressible **without a line of new code**:

| Domain-specific type | General predicate |
|---|---|
| `field_must_stay` | `{ type: 'equals', object, field, value }` |
| `knows_must_not_gain` | `{ type: 'not_contains', object, field: 'knows', value }` |
| `hook_must_stay` | `{ type: 'equals', object: '<hook-id>', field: 'status', value }` |
| revenue non-negative | `{ type: 'range', object, field, min: 0 }` |

`selftest.mjs` runs **the same code, unmodified**, over a sales dataset (no characters, no plot, no foreshadowing) and a narrative world. That test *is* the claim.

Constraints that carry only prose and no machine check are reported as `unenforceable` warnings rather than silently passing — silence would let "we have constraints" hide "nobody checks them".

---

## Honest boundaries

What exists: a protocol draft, a working reference implementation with cross-domain tests, and two tiers of controlled experimental data with a permutation test.

**What does not exist yet:**

1. **Multi-run cross-model validation** — the second model (deepseek-v4-flash) has been run **once**, as a smoke test. The result is unambiguous (zero errors, 8/8 state fields) but a single run is not a statistical claim. Treat the qwen numbers as measured (n=10–11) and the deepseek row as indicative (n=1).
2. Production-grade adapters for real formats.
3. Any real user.

The [experiment log](benchmark/shadowbench-w/results-log.md) records **six instrumentation accidents in a single day**, all self-caught, each with the guardrail that now prevents it — including one where the judge graded M-tier answers against the S-tier answer key, marked a *correct* answer wrong, and handed back a *more flattering-sounding negative result* ("the advantage disappears as the baseline grows") that was written into the log before the cause was found.

An erroneous negative result is harder to question than an erroneous positive one, because it looks like the researcher being admirably self-critical. We log these because for a benchmark, **the honesty of the instrument is the asset**.

---

## Layout

📜 **[The Benxiang Manifesto](MANIFESTO.en.md)** — why this exists, what has been demonstrated, where it goes next.
🔬 **[Contributing / Reproducing](CONTRIBUTING.md)** — the most welcome contribution is not a feature. It is refuting our results.

```text
spec/        protocol schemas + example .origin packages
compiler/    bidirectional compiler — reference implementation (runnable)
benchmark/   ShadowBench-W — the experiment that produced the numbers above
docs/        vision, concepts, protocol draft v0.1, architecture, roadmap
research/    competitive landscape review
outreach/    drafts for contacting related projects (unsent)
```

Documentation is primarily in Chinese; this page is the English entry point.
