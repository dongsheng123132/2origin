# Benxiang · 本象协议

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![verify](https://img.shields.io/badge/verify-81%20%2B%2020%20%2B%2018%20%2B%2013%2F13-brightgreen.svg)](#try-it)
[![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![中文](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-lightgrey.svg)](README.md)

> **Save the origin, project on demand.** 一源万影：保存本象，按需投影。
>
> 「立象以尽意」——《易传·系辞》 · *Establish the image to exhaust the meaning.*

**Benxiang** (pronounced *bun-SHYAHNG*): Ben (本) = origin, Xiang (象) = archetypal image. From the *Book of Changes* — «the sage establishes images to exhaust meaning» — and the *Tao Te Ching* — «the great image has no form», and therefore can be projected into any form. The technical core is called **Origin IR**.

**Status: v0.1 — protocol draft + working reference implementation + three dialects + two-tier experimental data**
([reference implementation](compiler/) · [CAD dialect](adapters/cad/) · [Law dialect](adapters/law/) · [Memory dialect](adapters/memory/) · [experiment log](benchmark/shadowbench-w/results-log.md), in Chinese)

---

## What the data says

The claim has been **narrowed by experiment** to exactly one dimension: **state tracking**.

**State accuracy (W3)**

| Model · baseline | Benxiang | Naive LLM | Vector RAG |
|---|---|---|---|
| qwen-plus · S-tier (20k chars, 10 runs each) | **92.5%** | 75.0% (sd 0) | 75.0% (sd 0) |
| qwen-plus · M-tier (95k chars, 11 runs each) | **98.9%** | 75.0% (sd 0) | 75.0% (sd 0) |
| deepseek-v4-flash · M-tier | *n=1: 100.0%* ⏳ | 53.8% ± 32.6 (n=10) | 32.1% ± 37.1 (n=7) |

**The qwen rows are solid.** Both control arms sat at exactly 75.0% with zero standard deviation across all 33 runs — not "slightly worse on average", but stuck against the same wall without moving once. Benxiang went 92.5% → 98.9%.

Stretching the baseline from 20k to 95k characters made the gap **wider**, not narrower. Vector RAG is exactly the technique that should benefit from a longer context — it didn't move at all. Retrieval can find text; it cannot find *who is holding the key right now*. That answer appears in no passage — it is derived.

⚠️ **The deepseek row is not a result yet.** Variance on that model is enormous and the control arms are bimodal — most runs land at 75%, several collapse to 0%. **A single run tells you nothing about the distribution**: the smoke test measured A0 at 37.5% and A1 at 75.0%; ten runs later those are 53.8% and 32.1%. The Benxiang arm is **still at n=1**: the first multi-run was interrupted at 17/30 on 2026-08-03 and was resumed from rep2 for 9 more runs on 2026-08-04 (spec hash, judge hash, task tier and provider all identical to rep1 and to both control arms, so the runs are poolable). This row will be updated when it lands. Until then, treat only the qwen rows as findings.

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
npm run verify   # self-test 81 + CAD 44 + law 95 + MCP end-to-end 18 + conformance 68 + mutation 13/13
```

No build step, no dependencies. `mutation-check` is the important one: it deliberately
breaks each promise the protocol makes and checks that the test suite notices. Anything it
fails to kill is a promise nobody was actually enforcing — its first run found exactly that
(zero coverage on the prose-vs-state gate).

A `.origin` package is inspectable from the command line:

```bash
P=spec/examples/sales-2026.origin
node compiler/cli.mjs status   $P                        # what is in this package
node compiler/cli.mjs why      $P revenue-trend.chart    # why does this value hold this value
node compiler/cli.mjs diagnose $P                        # constraints, dangling refs, drift

S=$(node compiler/cli.mjs seq $P -q)                     # watermark
node compiler/cli.mjs commit $P tx.json --expect $S      # the only write path
```

`commit` writes **nothing at all** if validation fails, and returns the violations on stdout
for the model to rewrite against. On success it only *appends* to `provenance/history.jsonl` —
`graph/objects.jsonl` is a birth certificate, never overwritten. Current state is the replay of
both, which is why every field can answer "why". Add `--json` to use it as a local API.

One full round trip in code:

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

They collapse into ten general predicates — `equals`, `not_equals`, `contains`, `not_contains`, `range`, `in`, `exists`, `unique`, `count`, `unchanged` — and all three narrative types are expressible **without a line of new code**:

| Domain-specific type | General predicate |
|---|---|
| `field_must_stay` | `{ type: 'equals', object, field, value }` |
| `knows_must_not_gain` | `{ type: 'not_contains', object, field: 'knows', value }` |
| `hook_must_stay` | `{ type: 'equals', object: '<hook-id>', field: 'status', value }` |
| revenue non-negative | `{ type: 'range', object, field, min: 0 }` |

`selftest.mjs` runs **the same code, unmodified**, over a sales dataset (no characters, no plot, no foreshadowing) and a narrative world. That test *is* the claim.

Two of the predicates are **aggregate** — `unique` and `count` judge a *set* of objects rather than one field, and that turned out to be where real defects live. `count` with `equals_count_of` is the general shape of "the same fact is stated in two places and they must agree": a door schedule listing 5 windows while the floor plan draws 4, a table of contents that outnumbers the chapters, a plan with more line items than todos. Same predicate, three domains.

Three dialects are wired up and tested:

```bash
# CAD drawing consistency (adapters/cad/)
node adapters/cad/import.mjs adapters/cad/fixtures/A-101.dxf /tmp/A-101.origin
node compiler/cli.mjs diagnose /tmp/A-101.origin
#   → catches: geometry left on layer 0 / duplicate tag C2 / 4 windows drawn, only 3 tagged

# Chain of authority in a court judgment (adapters/law/)
node adapters/law/import.mjs adapters/law/fixtures/B-缺陷.txt /tmp/B.origin
node compiler/cli.mjs diagnose /tmp/B.origin
#   → catches: a ministerial rule cited as binding authority / a repealed judicial
#     interpretation / a citation to a document that does not exist / a 55% reduction
#     for voluntary surrender where the guideline caps it at 40% / an amount stated as
#     6800 in the reasoning and 8600 in the findings

# Project state as an MCP server (adapters/memory/)
claude mcp add -s local benxiang -- node <abs-path>/adapters/memory/mcp-server.mjs <package>
```

All three dialects together added **4 lines** to the core (`why` gained a `basis` column).
Domain knowledge enters as *data* — constraint tables, a statute database — not as code.

⚠️ The law dialect's numbers (10/12 planted defects caught, 0 false positives on the
compliant fixture) come from **fixtures we wrote ourselves**. Grading your own exam is
not evidence of capability: those numbers only guarantee the checks don't silently
degrade. The false-positive rate on real judgments is **not yet measured**.

Constraints that carry only prose and no machine check are reported as `unenforceable` warnings rather than silently passing — silence would let "we have constraints" hide "nobody checks them".

---

## Why this is a protocol and not just a library

One implementation passing its own tests proves nothing about a protocol. The line is drawn by the
[conformance suite](spec/conformance/README.en.md): **68 test vectors that are data, not code.**
They depend on no host language. Any implementation that writes an adapter of a few dozen lines —
read cases on stdin, write results on stdout — can certify itself on the spot.

```bash
npm run test:conformance                       # JavaScript reference: 68/68 (core + full)
node spec/conformance/run.mjs --level core \
  --adapter "python spec/conformance/implementations/python/adapter.py"   # second impl: 60/60
```

The [Python second implementation](spec/conformance/implementations/python/benxiang.py) is about
250 lines with zero dependencies and passes the same vectors. The honest boundary: both
implementations were written by the same author, so what it demonstrates is that **the vectors are
genuinely a language-neutral contract** — it does **not** demonstrate that anyone can read the spec
and get it right.

`compiler/mutation-check.mjs` is the part that matters most. It deliberately breaks each promise the
protocol makes, one at a time, and runs both the self-tests and the conformance vectors against every
mutant to see **which of the two catches it**. A mutant caught only by the self-tests marks a
**coverage gap in the protocol** — that promise constrains this one implementation and nothing else.
All 13 mutants are currently caught; 2 of them are coverage gaps, listed openly in
[conformance/README §5](spec/conformance/README.en.md). **The protocol guarantees exactly what the
vectors pin down, and nothing more.**

> **A third-party implementation is the most useful contribution this project can receive** —
> not because it adds a feature, but because it is the only thing that can falsify the claim above.

---

## Honest boundaries

What exists: a protocol draft, a working reference implementation with cross-domain tests, and two tiers of controlled experimental data with a permutation test.

**What does not exist yet:**

1. **Multi-run cross-model validation** — on the second model (deepseek-v4-flash) the Benxiang arm is mid-run toward a planned n=10, with the control arms already at n=10 / n=7. The [experiment log](benchmark/shadowbench-w/results-log.md) carries the current count and every raw result; this page is not updated per run, because a number that expires every twenty minutes does not belong on a front page. Until the run is full, treat the qwen numbers as measured (n=10–11) and the deepseek row as unsettled — and note that a run of clean results is worth no more than one clean result was, a mistake already made once here and recorded as incident #7.
2. Production-grade adapters for real formats.
3. Any real user.

The [experiment log](benchmark/shadowbench-w/results-log.md) records **six instrumentation accidents in a single day**, all self-caught, each with the guardrail that now prevents it — including one where the judge graded M-tier answers against the S-tier answer key, marked a *correct* answer wrong, and handed back a *more flattering-sounding negative result* ("the advantage disappears as the baseline grows") that was written into the log before the cause was found.

An erroneous negative result is harder to question than an erroneous positive one, because it looks like the researcher being admirably self-critical. We log these because for a benchmark, **the honesty of the instrument is the asset**.

---

## Layout

📜 **[The Benxiang Manifesto](MANIFESTO.en.md)** — why this exists, what has been demonstrated, where it goes next.
🔬 **[Contributing / Reproducing](CONTRIBUTING.en.md)** — the most welcome contribution is not a feature. It is refuting our results.
📐 **[Protocol spec](docs/03-protocol-draft-v0.1.en.md)** · **[Conformance suite](spec/conformance/README.en.md)** — everything needed to write an independent implementation.

```text
spec/        protocol schemas + example .origin packages
compiler/    bidirectional compiler — reference implementation (runnable)
benchmark/   ShadowBench-W — the experiment that produced the numbers above
docs/        vision, concepts, protocol draft v0.1, architecture, roadmap
research/    competitive landscape review
outreach/    drafts for contacting related projects (unsent)
```

Documentation is primarily in Chinese; this page is the English entry point.
