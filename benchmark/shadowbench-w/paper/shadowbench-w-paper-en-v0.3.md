---
title: "ShadowBench-W: State Consistency as a Benchmarkable Task for Long-Form Text Generation"
author: "He Fangsheng"
date: "2026-08-07"
lang: en
---

# ShadowBench-W: State Consistency as a Benchmarkable Task for Long-Form Text Generation

> Working draft v0.4 (English) — for arXiv preprint and ARR Oct 2026 cycle (deadline 2026-10-12 AoE).
> Status: draft; main-result data complete, **method ablation run 2026-08-13 and it overturned our own attribution** (§5.3).
> v0.3 → v0.4 changed what this paper claims. Two corrections, both against our own interest, both from data in this repository:
> **(i)** the gain we attributed to the Origin IR state layer is almost entirely produced by *requiring the model to maintain an explicit state at all* — a prompt-only arm (A2) captures 41.3 of the 43.8 points, and the remaining 2.5 are not significant (p = 0.48 / 0.72);
> **(ii)** the "100% evidence traceability" reported in v0.3 used a self-selected denominator; measured against the fields the benchmark actually asks about, coverage is **27.5% / 15.0%**.
> Main results (§5.1) and cross-model (§5.2) come from `benchmark/shadowbench-w/results-v3-m/` (M-level, 50-chapter ≈95K baseline, 10 rounds/arm, both deepseek-v4-flash and qwen-plus, patched hermes HTTP + bailian channels).
> **Every cell of the §5.1 and §5.2 tables is recomputable from the 60 per-round JSON files in that directory** — re-verified 2026-08-12, all twelve accuracy/EPC cells reproduce exactly.
> All six arXiv citations verified live (2026-08-07); star counts approximate (values drift).

## Abstract

Large language models (LLMs) fail silently at long-horizon generation. A sword picked up in chapter 8 is forgotten by chapter 20; a character's death goes unreported; and the model itself cannot say what it believes the world looks like. Existing benchmarks for long-form generation measure surface quality—fluency, coherence, consistency-error density—but stop short of the question that matters for downstream agents: *when a system is required to maintain a queryable world state alongside the text, is that state consistent with what it wrote, and can every claim be traced to evidence?*

We introduce **ShadowBench-W**, a benchmark for state consistency in long-form story continuation. Built on a Chinese corpus in two scales—an S-level 10-chapter (~20K characters) development corpus and an **M-level 50-chapter (≈95K characters) main corpus**—each with a 5-chapter continuation task, it defines two scores: **W1** measures consistency errors per 100 contacts (EPC) in the generated text, and **W3** measures field-level agreement between the system's claimed world state and ground truth, together with the evidence-traceability of every state field. We also present the **Origin IR state layer**, a reference method that compiles context under a token budget and validates every state mutation as a transaction carrying an evidence chain.

On the **M-level** task (50-chapter, ≈95K-character baseline, 10 rounds/arm, two unrelated models), bare models score 56.3% / 53.8% on W3 and vector RAG does not fix it (70.0% / 58.8%). A full state layer reaches 100.0% / 97.5%. **But an ablation shows the machinery is not what produces this.** A prompt-only arm — the model is simply told to emit and update an explicit world state each chapter, with no validator, no evidence chain, and no context compiler — reaches **97.5% / 95.0%**, capturing 41.3 of the state layer's 43.8-point advantage on *both* models; the residual 2.5 points are not significant (p = 0.48 / 0.72). The prompt-only arm is also **cheaper than the bare baseline** (−9.7% / −28.2% tokens), while the full state layer costs +13.7% / +21.1%.

The premise survives a frontier control: a flagship model (qwen3.7-max) writes the best prose we have measured (EPC 0.60) and still scores **56.3%** on state — state corruption is a missing mechanism, not a capability gap that scale closes.

What the machinery does buy is the thing prompting cannot produce at all: an evidence chain. Prompt-only and bare arms have zero evidence coverage by construction; the state layer attaches source-traceable evidence to **27.5% / 15.0%** of the fields under test — a real categorical difference, and far below the "100%" we reported in v0.3 under a self-selected denominator. Our headline finding is therefore not *"build a state layer"* but *"ask for the state"*: the expensive part of the system reproduces almost none of the benefit its own authors attributed to it, and ShadowBench-W is what made that visible. The benchmark, judges, all four arms, and 80 per-round result files are released under Apache-2.0.

## 1. Introduction

**Motivating scenario.** Ask an LLM to continue a novel for 50 chapters, then ask it: *whose hand is the protagonist's sword in now?* A baseline model cannot answer—not because it failed to read the earlier chapters, but because it was *never required to maintain* a queryable world state. While generating, it wrote "the sword is in Zhao Qi's hands" into some passage, but the next generation step may freely write "Lin Zheng draws his sword"—the text contradicts itself and the model does not notice, because no mechanism aligns *what it wrote* with *what it believes*.

We call this defect **state corruption**: generated content reads fluently at a local level yet contradicts itself over long horizons, and the system can neither detect, localize, nor explain its own errors.

**Three structural defects.** Failures in long-form generation can be attributed to three families (full argument in MANIFESTO.md):

1. **Perception**: the model never systematically reads the earlier context—the context window cannot hold 50 chapters, and tail truncation drops critical information.
2. **Memory**: the model has no persistent state—"the context always overflows" is a memory defect, not a length problem.
3. **Output validation**: the model cannot verify what it writes—there is no commit gate, no rollback, no evidence chain.

**The blind spot of existing benchmarks.** Long-context benchmarks (LongBench et al.) ask "can the model *use* a long context to answer questions". Story-continuation benchmarks measure text quality and even intra-text contradiction (ConStory-Bench, arXiv 2603.05890). But "when a system is *required* to maintain a queryable world state, is that state consistent with the text, and is every field traceable to evidence"—no public benchmark covers this. ConStory-Bench detects contradictions *in prose after the fact*; ShadowBench-W evaluates the *state-writeback contract*: can the system say what it believes, and justify it? The distinction matters for any agent that must act on state (writing, coding, operations): it needs to answer "what do I believe now, and why".

**Contributions.** We contribute four things:

1. **A new task definition**: the state-writeback contract in long-form continuation—requiring the system to maintain a queryable, verifiable world state *as a first-class object*, and evaluating whether that state agrees with the text and can be justified field-by-field. Distinct from intra-text contradiction detection (ConStory-Bench).
2. **A new benchmark, ShadowBench-W**: a two-scale Chinese corpus (S-level ≈20K, M-level ≈95K characters), 5-chapter continuation tasks, and two judges. W1 measures consistency errors per contact (EPC); W3 measures state-writeback correctness — field-level accuracy, evidence **coverage**, and evidence **precision**, reported separately (§3.2). Its first serious use falsified the method its own authors proposed (§5.3), which we regard as the strongest available evidence that it measures something.
3. **A negative result about our own method**: the Origin IR state layer (context-compiler + commit-compiler, transactional state with evidence chains) is *not* what produces the accuracy gain. A prompt-only arm reaches within 2.5 points of it on both models (p = 0.48 / 0.72) at lower token cost than even the bare baseline. We report this because the benchmark we built is what detected it; a benchmark that cannot embarrass its author is not measuring anything.
4. **A separation of two things the field conflates**: *state accuracy* ("can the system say what it believes") is obtainable by prompting alone; *evidence traceability* ("can it say why") is not obtainable by prompting at all, and remains largely unsolved even with machinery — our own coverage is 27.5% / 15.0%. Systems that must justify their beliefs, not merely state them, are where a state layer still has something to prove.

## 2. Related Work

> Citations below were verified live on 2026-08-07 (arXiv IDs confirmed to exist with matching titles; star counts reported approximate). Re-verify once more before final submission, per the repository rule "citations before claims".

**Long-context evaluation.** LongBench (arXiv 2308.14508), LongBench v2 (arXiv 2412.15204), and ∞Bench (arXiv 2402.13718) measure whether a model can *use* long context for question answering; they do not measure consistency of *generation* over long horizons.

**Story generation and continuation.** ConStory-Bench (arXiv 2603.05890, "Lost in Stories: Consistency Bugs in Long Story Generation by LLMs") is the closest and most important prior art. It evaluates narrative consistency with 2,000 prompts across four task scenarios, defines a taxonomy of five error categories with 19 fine-grained subtypes, and builds ConStory-Checker, an automated pipeline that detects contradictions and grounds each judgment in explicit textual evidence. It finds consistency errors are most common in factual and temporal dimensions, cluster around the middle of narratives, and correlate with high-entropy text segments.

ConStory-Bench and ShadowBench-W measure *different things*. ConStory-Bench detects **intra-text contradictions** in already-generated prose (text vs. text). ShadowBench-W's W3 measures **state-writeback correctness**: when the system is *required to maintain* a queryable world state (a first-class object, not an artifact of the text), does that state agree with the generated text field-by-field, and can every field be traced to evidence? The two are complementary: ConStory-Bench asks "did the story contradict itself?", ShadowBench-W asks "can the system *say* what it believes, and justify it?"—the question that matters for downstream agents acting on the state. Evidence traceability (W3's second score) has no counterpart in ConStory-Bench.

Tianming (zy-zmc/tianming-novel-ai-writer) is a production writing assistant with 15-dimensional fact snapshots and 12 types of CHANGES declarations—closest in spirit on the "maintain state while writing" side, but it does not publish a benchmark protocol or open judges.

**World-model representations and transactional memory.** OpenUSD (PixarAnimationStudios/OpenUSD, ~7.4k★, active) has made "save the source, project on demand" an industry standard in 3D. Origin IR applies the same idea to textual world state. Closer still is MemTX (arXiv 2607.23929, "Transactional Belief Commit for Stateful Agent Memory"), which argues that a memory write is not a belief commit: writes are staged in snapshot-isolated transactions, admitted by a validate-and-commit pipeline, and carry evidence, permissions, provenance, and validity. Our Origin IR state layer implements exactly this discipline in the long-form generation setting, and ShadowBench-W's W3 is the first public benchmark that *measures* whether a system honors it. MemTX is a protocol design without a public benchmark or evaluation data; ShadowBench-W supplies the missing measurement — and the measurement's first verdict (§5.3) is that transactional machinery buys evidence, not accuracy. Any transactional-memory proposal evaluated only against a stateless baseline should be read with that in mind.

**Document-parsing evaluation (adjacent evidence).** OmniDocBench (arXiv 2412.07626, CVPR 2025) shows that document parsing has a public benchmark with comprehensive annotations—and that state-writeback evaluation does not. That gap is our position.

**Evaluation methodology.** We deliberately use deterministic rules (with a curated vocabulary patch) rather than LLM-as-judge for W1/W3, to avoid circularity between the generator and the judge. The vocabulary patch (40/40 true-violation hits, 0 false positives, re-verified by `vocab-patch-check.mjs`) is versioned as part of the benchmark.

## 3. Task & Benchmark

### 3.1 Task definition

A long-form continuation task is a tuple $(D_0, T, S)$ where:

- $D_0$ is the baseline corpus at one of two scales—S-level (chapters 1–10, ≈20K characters) or **M-level (chapters 1–50, ≈95K characters)**, Chinese; note the byte-level accounting in §5.4;
- $T$ is the continuation task (S: chapters 11–15; M: chapters 51–55) with a world specification (`world/spec.origin/tasks/continuation.json` / `continuation-m.json`): `state_at_<baseline_end>`, `forbidden_zones`, and a goal (Lin Zheng must obtain the Black Key from Zhao Qi);
- $S$ is the system-maintained world state.

Consistency $C(D, S)$ holds iff every field of $S$ is supported by evidence in $D$, and no statement in $D$ contradicts $S$.

### 3.2 Benchmark components

- **Corpus**: `corpus/ch01-10.txt` (S, ≈20K chars) and `corpus/ch01-50.txt` (M, ≈95K chars); UTF-8 Chinese, 3 bytes/char.
- **World spec**: `world/spec.origin/tasks/continuation.json` (S) and `continuation-m.json` (M).
- **Judge W1**: CED (consistency-error density) and EPC (errors per 100 contacts). Patched vocabulary: 40/40 hits, 25 false-positive traps all silent (Run #29).
- **Judge W3**: three numbers, reported separately because reporting one of them is selective disclosure —
  **state accuracy** (field-level match against ground truth);
  **evidence coverage** (of the fields under test, how many carry evidence that points back to a source scene — denominator is the *required* field set);
  **evidence precision** (of the evidence the arm *did* supply, how much is source-traceable — denominator is the arm's own output, hence `null` when it supplies none).
  v0.3 of this paper reported precision alone and called it traceability; see §7.2.
- **Arms**: A0 = bare model with tail truncation; A1 = cheap vector RAG; **A2 = prompt-only state** (told to emit and update an explicit world state each chapter; no validator, no evidence requirement, no context compiler); A3 = Origin IR state layer.
- **Models**: qwen-plus, deepseek-v4-flash (both reasoning models; reasoning tokens accounted—see §5.4).

### 3.3 Metric protocol (honesty boundaries)

- W3 for stateless arms (A0/A1) is collected via one extra state-query round; that round's tokens count toward cost—no free lunch, and we say so in §5.
- W1 EPC depends on the vocabulary: 13/40 hits, 27 misses before the patch; 40/40 after. The judge version is part of the benchmark and ships with it.
- Judges use deterministic rules only; no LLM-as-judge (circularity guard).

## 4. Method: The Origin IR State Layer

> Read this section knowing where §5.3 ends up: on state accuracy, everything below is matched by a prompt. We describe it in full anyway, because it is the arm that produces evidence chains, because its failure is a result of this paper rather than an embarrassment to be trimmed, and because the design lessons in §4.3 were paid for and are reusable by anyone building the arm that *does* win.

### 4.1 Architecture

```
Input side: context-compiler (budget compilation)
  corpus + world spec → pruned/projected under a token budget → prompt (≈6K tokens)

Output side: commit-compiler (parse / validate / retain evidence)
  model output → parse state-change declarations → validator (deterministic rules
  + vocabulary patch) → pass: commit transaction with evidence chain
                        → fail: keep best-effort output flagged for human review
```

### 4.2 State as transactions

Every state change is committed as a transaction carrying `valid_from` (which event) and `evidence` (which scene/passage). The system may reject, but it must not stay silent: a rejected write leaves a hand-off artifact for human review (the "docking bay" layer).

### 4.3 Design decisions learned from real failures

- **ID normalization layer.** The model wrote `zhao-qi` instead of `char:zhao-qi`, invalidating 5 chapters. Fix: projections always present full IDs; the commit side normalizes (prefix completion, alias disambiguation). Lessons documented in the protocol (docs/03, empirical rule #7).
- **Judges must distinguish "rejected" from "done".** A system that rejects everything scores a perfect error rate of 0.0. Judgment requires task completion first, then quality (empirical rule #8).
- **State and text are gated separately.** Correct state does not imply correct text; the gate checks both (empirical rule #9; three runs: errors 1/6/3 → 0/0/0).
- **Vocabulary patch.** Deterministic rules have systematic synonym blind spots (13/40 → 40/40). The vocabulary is part of the judge and versioned with it.

## 5. Experiments

> Main results are from the **M-level** task (50-chapter, ≈95K-character baseline, 5-chapter continuation), four arms × two models × 10 rounds. §5.2 replicates the whole design on a second model; §5.3 is the method ablation and is the section that changed this paper's conclusion. All numbers recomputable from `results-v3-m/` (A0/A1/A3) and `results-v3-m-ablation/` (A2), 80 files, verified against current judge fingerprints.

### 5.1 Main results (deepseek-v4-flash, M-level: 50-chapter ≈95K baseline, 10 rounds)

| Arm | n | W1 EPC (↓) | W3 state accuracy | Evidence coverage | Mean tokens (Δ vs A0) |
|---|---|---|---|---|---|
| A0 bare (tail truncation) | 10 | 2.16 ± 1.54 | 56.3% ± 23.2% | 0% (by construction) | 88,731 (—) |
| A1 vector RAG | 10 | 0.82 ± 0.44 | 70.0% ± 6.1% | 0% (by construction) | 89,757 (+1.2%) |
| **A2 prompt-only state** | 10 | 1.17 ± 0.70 | **97.5% ± 5.0%** | 0% (by construction) | **80,112 (−9.7%)** |
| A3 Origin IR state layer | 10 | **0.84 ± 0.37** | **100.0% ± 0.0%** | **15.0%** | 100,884 (+13.7%) |

Permutation tests (20,000 rounds): W3 A2 vs A0 **p < 0.0001** (Δ = 41.3 pt); W3 A3 vs A0 **p < 0.0001** (Δ = 43.8 pt); **W3 A3 vs A2 p = 0.4774 (n.s., Δ = 2.5 pt)**; W1 EPC A3 vs A2 p = 0.2551 (n.s.); W3 A1 vs A0 p = 0.1315 (n.s.).

Four findings:

1. **The demand for state is the differentiator — not the state layer.** Of A3's 43.8-point advantage over the bare model, **41.3 points (94%) are reproduced by A2**, which does nothing but instruct the model to emit and update an explicit world state. The 2.5 points that remain are indistinguishable from noise. Whatever the validator, the transaction log, and the evidence chain are worth, it is not state accuracy on this benchmark.
2. **And the cheap arm is cheaper than doing nothing.** A2 uses **9.7% fewer tokens than A0**. The bare and RAG arms must reconstruct their state in an end-of-run probe over the full text (§3.3); A2 carries a compact state forward and never pays for that reconstruction. Higher accuracy at negative cost is not a trade-off — it is a free lunch that the field has been walking past.
3. **RAG is the arm that actually fails.** Retrieval returns relevant prose and improves text (EPC 0.82), but leaves state at 70.0% — below A2's 97.5% at essentially the same token cost. Retrieving what was written is not the same as maintaining what is believed.
4. **The gap widens with scale.** At S-level (20K chars) A0 hit 75.0%; at M-level (95K chars) A0 collapses to 56.3%. State corruption is a *scale* defect — which is why the demand for explicit state pays off more the longer the horizon.

### 5.2 Cross-model robustness (qwen-plus)

To test whether the effect is model-specific, we re-ran the full M-level protocol with qwen-plus (10 rounds/arm, same probe protocol, same judge):

| Arm | n | W3 state accuracy | W1 EPC | Evidence coverage | Mean tokens (Δ vs A0) |
|---|---|---|---|---|---|
| A0 bare | 10 | 53.8% ± 11.3% | 1.12 ± 0.53 | 0% | 58,313 (—) |
| A1 vector RAG | 10 | 58.8% ± 13.8% | 1.22 ± 0.54 | 0% | 58,569 (+0.4%) |
| **A2 prompt-only state** | 10 | **95.0% ± 8.3%** | 1.10 ± 0.84 | 0% | **41,885 (−28.2%)** |
| A3 Origin IR | 10 | **97.5% ± 5.0%** | **0.66 ± 0.54** | **27.5%** | 70,605 (+21.1%) |

Permutation tests (20,000 rounds): A2 vs A0 **p < 0.0001** (Δ = 41.3 pt); A3 vs A0 **p < 0.0001**; **A3 vs A2 p = 0.7151 (n.s., Δ = 2.5 pt)**; EPC A3 vs A2 p = 0.2287 (n.s.); A1 vs A0 p = 0.5264 (n.s.).

**Robustness conclusion — including the part that goes against us.** Every qualitative claim replicates on a second, unrelated model, *including the ablation*: the A2-vs-A0 gap is **41.3 points on both models** (to the decimal), and the A3-vs-A2 gap is **2.5 points on both**, non-significant in both (p = 0.48 / 0.72). A result this stable across models is not a fluke of one decoder. The token finding replicates and amplifies: on qwen-plus the prompt-only arm costs **28.2% less** than the bare baseline while scoring 41 points higher.

The one dimension that does not replicate-to-zero is evidence: A3 supplies source-traceable evidence for 27.5% (qwen) / 15.0% (deepseek) of the fields under test, and A0/A1/A2 supply none on either model. That is the honest residual of the state layer — a categorical capability at low coverage, not an accuracy advantage.

#### 5.2.1 Frontier-model control: is state corruption just a weak-model artifact?

The obvious objection to this paper's premise is that both main models are inexpensive ones, and that a frontier model would simply not lose track of its world. We ran the bare arm on **qwen3.7-max-2026-06-08**, 10 rounds, same corpus, task and judge:

| Arm | Model | n | W3 state accuracy | W1 EPC |
|---|---|---|---|---|
| A0 bare | deepseek-v4-flash | 10 | 56.3% ± 23.2% | 2.16 |
| A0 bare | qwen-plus | 10 | 53.8% ± 11.3% | 1.12 |
| **A0 bare** | **qwen3.7-max (frontier)** | 10 | **56.3% ± 16.1%** | **0.60** |

**The frontier model writes markedly better prose and is no better at state.** EPC falls to 0.60 — 72% below deepseek-v4-flash, the best text quality of any bare arm we have measured — while state accuracy lands at 56.3%, indistinguishable from the cheap models and never once exceeding 75% in ten rounds. Scaling the generator improves the thing that is easy to see and does not touch the thing this benchmark was built to see. State corruption is not a capability gap that a larger model closes; it is a **missing mechanism**, and the cheapest sufficient mechanism is a prompt that demands the state (§5.3).

(Only the bare arm was run at this scale; a full four-arm frontier sweep is future work. We report the single arm because it is the arm that could have falsified the paper's premise, and it did not.)

### 5.3 The method ablation — and, separately, judge/harness validation

The table below is often mistaken for an ablation study. It is not, and we label it accordingly: it records **fixes to the judge and the harness**, each with a before/after measurement. It says nothing about which *component of the method* produces the effect in §5.1.

| Change (judge / harness, **not** method components) | W1 effect | W3 effect |
|---|---|---|
| Before ID normalization | 5 chapters invalidated | — |
| After ID normalization | passes | — |
| Before vocabulary patch | 13/40 hits, 27 misses | judge protocol broken |
| After vocabulary patch | 40/40 hits, 0 false positives | judge protocol credible |
| Dual gate (state + text) | errors 1/6/3 → 0/0/0 (3 runs) | — |

#### The method ablation (run 2026-08-13) — and what it did to our claim

A3 bundles three interventions: **(a) the demand** — instructing the model to keep an explicit, queryable state while it writes; **(b) the validator** — rejecting state writes that fail deterministic rules; **(c) the evidence chain** — requiring each field to carry `valid_from` and a supporting passage. v0.3 of this paper reported the bundle's effect and attributed it, in prose, to the machinery. It never separated (a).

**A2 isolates (a) alone.** Same corpus, same task, same judge, same models, 10 rounds each; the arm is a prompt instructing the model to emit and update a world state per chapter — no validator, no evidence requirement, no context compiler.

| | deepseek-v4-flash | qwen-plus |
|---|---|---|
| A0 → A2 (the demand alone) | +41.3 pt, p < 0.0001 | +41.3 pt, p < 0.0001 |
| A2 → A3 (validator + evidence chain + compiler) | **+2.5 pt, p = 0.4774 (n.s.)** | **+2.5 pt, p = 0.7151 (n.s.)** |
| Token cost of the demand | **−9.7%** vs bare | **−28.2%** vs bare |
| Token cost of the machinery | +13.7% vs bare (+26.0% vs A2) | +21.1% vs bare (+68.6% vs A2) |
| Evidence coverage, A2 vs A3 | 0% vs 15.0% | 0% vs 27.5% |

**Reading, without softening it.** On state accuracy — the metric this paper introduced and built a benchmark around — **the Origin IR state layer does not beat a prompt**, on either model, at a cost premium of 26–69% over that prompt. The effect we spent the paper explaining is 94% attributable to asking the model for something we had never asked the baselines for. Note also that A2 *outperforms A1 (RAG) by 27–36 points at lower cost*: the relevant comparison for practitioners is not "retrieval vs. state layer" but "asking vs. not asking".

**What survives.** Exactly one thing, and it is categorical rather than quantitative: A2 cannot produce an evidence chain at all — not poorly, but structurally, because nothing in a prompt-only arm distinguishes a belief from its justification. A3 produces one for 15–27.5% of the fields under test. A system that must answer *"why do you believe that"* still needs machinery; a system that must only answer *"what do you believe"* does not. That is a much narrower claim than v0.3 made, and it is the one the data supports.

**What is still not separated.** (b) from (c). Two further arms — A3 minus validator, A3 minus evidence chain — would tell us whether the residual 2.5 points and the evidence capability come from the same component. Given that 2.5 points is not significant, the honest expectation is that the validator contributes nothing measurable here and the evidence chain is doing all the remaining work; we have not run it, and we do not claim it.

### 5.4 Token accounting (honesty: no selective disclosure)

M-level, deepseek-v4-flash, patched HTTP channel (real `usage` from the API, not estimates), mean tokens per round:

| Arm | deepseek-v4-flash | Δ vs A0 | qwen-plus | Δ vs A0 |
|---|---|---|---|---|
| A0 bare | 88,731 | — | 58,313 | — |
| A1 vector RAG | 89,757 | +1.2% | 58,569 | +0.4% |
| **A2 prompt-only state** | **80,112** | **−9.7%** | **41,885** | **−28.2%** |
| A3 Origin IR | 100,884 | +13.7% | 70,605 | +21.1% |

The A2 column is the one that changes the practical recommendation. A2 is not a cheaper approximation of A3 — it is **cheaper than doing nothing at all**, on both models, while scoring 41 points higher than doing nothing. The mechanism is visible in §3.3: stateless arms pay for an end-of-run probe over the full text to reconstruct what they believe; an arm that carried a compact state forward never incurs that cost. Any paper reporting a state-maintenance method against a bare baseline without this arm is reporting a cost premium that may not exist.

We report cost **per model and per arm** rather than only the favorable combination. Earlier figures (+149% deepseek, old S-level estimates) were from the pre-patch CLI-fallback channel and are void. The correct summary is now: the demand costs *less* than nothing, and the machinery costs 26–69% on top of the demand for no significant accuracy gain and 15–27.5% evidence coverage.

### 5.5 Known limitations (self-audited, so reviewers do not find them first)

- **Judge/gate coupling**: A3 uses the same rules as both shield and yardstick; the deterministic-channel advantage carries a circularity component. We scope this explicitly: W3 compares only *structured state fields* against ground truth, never free text, so the judge does not depend on lexical overlap with the gate's rules. The residual risk is that A3's internal rule list and the judge's rule list share a source; we report the judge fingerprints (§7) so the coupling is auditable, and treat W3 as an upper bound until an independent judge is added.
- **Semantic channel not in the main score**: vocabulary patches cannot catch up with natural-language synonym space (Run #23 conclusion). W1 (EPC) therefore understates A0's true error rate if A0 rephrases; we report the patch's 40/40 recall on the test set so the reader can gauge the ceiling.
- **Probe protocol**: the S-level 75.0% constant partly reflected a probe-template artifact (Run #18); the M-level protocol sends full-text probes, and A0's M-level W3 is 56.3% ± 23.2% with real variance—the artifact is gone, not averaged over.
- **Our own method does not survive its ablation on the main metric** (§5.3). We leave this in the limitations list rather than only in the results, because a reader who skims should not be able to miss it. The Origin IR state layer is retained in this paper as the arm that produces evidence chains, not as a state-accuracy method.
- **The evidence result is weak in absolute terms**: 15–27.5% coverage is a capability demonstration, not a solved problem. We do not know whether the shortfall is a model limitation, a prompt-design limitation, or a defect in our commit-compiler; we have not run the experiment that would tell us.
- **(b) and (c) remain entangled**: validator vs. evidence chain (§5.3, final paragraph).
- **Single team, three models, one corpus**: the full four-arm design ran on two models; a third (frontier) model was run on the bare arm only (§5.2.1). Single corpus, Chinese fiction. Declared bounds, not claims.

## 6. Limitations & Broader Impact

- **Limitations**: Chinese single-corpus (M-level ≈95K-char baseline; S-level development corpus); two models; vocabulary dependence of deterministic judges; reference implementation not production-grade (no real users).
- **Broader impact**: state consistency is not limited to fiction—codebases, operational plans, and regulatory documents all need "what do I believe and why". Our companion office dialect turns native documents into verifiable state objects (Appendix B). The benchmark encourages agents to maintain queryable world state, aligned with interpretability and auditability goals.

## 7. Reproducibility

- **Code**: public repository (anonymous version strips identity info); all **four** arms + judges + vocabulary patch. Self-tests, re-run 2026-08-13, all green: compiler **91**, CAD 55, conformance **87/87**, compiler mutation **19/19 killed**, judge mutation **12/12 killed** (§7.1).
- **Data**: `corpus/`, `world/spec.origin/`, and **80 per-round result files** — `results-v3-m/` (A0/A1/A3 × 2 models × 10) and `results-v3-m-ablation/` (A2 × 2 models × 10). Every cell of §5.1, §5.2, §5.3 and §5.4 is recomputable from these files.
- **Judge fingerprints**: judgeHashW1 / judgeHashW3. **judgeHashW3 changed on 2026-08-13** when `evidenceCoverage` was added (§7.2). State accuracy is unaffected: re-scoring all 80 rounds under the new judge reproduces every previously reported `stateAccuracy` with zero drift, which is the property that matters and which we checked rather than asserted.

### 7.1 Who validates the validator?

A self-test that kills no mutant is indistinguishable from no self-test: it keeps passing after every refactor while the benchmark quietly hands out points to every arm. We therefore mutate the *judges* themselves — plausible human errors injected into `ced.mjs` (W1), `detect-score.mjs` (W2) and `state-diff.mjs` (W3), one at a time, each followed by a full self-test run and a revert.

Mutants include: W3 accuracy pinned to full marks, W3 strict comparison degraded to string comparison, W3 evidence checks loosened, evidence coverage reverted to a self-selected denominator, W1 error count pinned to zero, W1 chain-of-custody check for the Black Key removed, and W2 recall computed over *found* rather than *planted* errors.

**Result: 12 injected, 12 killed, 0 survived** (`eval/mutation-check.mjs --json`). The runner also reports *stale* mutants — anchors that no longer match the source — because a mutation that can never fire would otherwise masquerade as coverage; this fired once during the 2026-08-13 judge change and was repaired rather than ignored.

This does not remove the judge/gate coupling declared in §5.5. And §7.2 shows what it does **not** catch.

### 7.2 What mutation testing cannot catch: a metric that was wrong by definition

Version 0.3 of this paper reported **"100% evidence traceability"** for the state layer. The number was computed correctly, was under assertion, survived every mutant, and was wrong to report.

`evidenceTraceability` divided source-traceable evidence entries by *the entries the arm chose to supply*. An arm supplying evidence for four of eight required fields, all four well-formed, scored 100%. One of our ten qwen rounds is exactly that case. Arms supplying no evidence scored `null` — excluded from means rather than counted as zero. Measured against the fields the benchmark actually asks about, the state layer's coverage is **27.5% (qwen) / 15.0% (deepseek)**.

Both numbers are true; they answer different questions. We were reporting a **precision** and reading it as a **coverage**. The judge now emits both, `evidenceCoverage` counts a field only when the evidence key matches the tested `id.field` exactly (evidence for `char:lin-zheng.location` does not discharge `char:lin-zheng.knows`), and arms with no evidence score 0 rather than `null`.

The methodological point generalizes beyond this paper. Mutation testing asks *"does the code still do what the code intends?"* — it cannot ask *"is that intention the right one?"* Our 9/9 kill rate was real and told us nothing about this defect, because no mutation of a metric's implementation can reveal that the metric's **definition** flatters its author. The check that caught it was recomputing a published number from raw data with a denominator chosen by someone looking for the flattering assumption — which, in this case, was the same authors, one day later, and is the only reason it is in this paper instead of in a reviewer's report.

## Appendix A: Conformance vectors and mutation testing

- 19 mutations, 19 caught, 0 escaped (self-tests keep their promises).
- 2 caught only by self-tests, not by conformance vectors—a protocol coverage gap; fix by adding vectors or declaring implementation freedom.

## Appendix B: The office dialect (native documents → verifiable state objects)

- docx → Origin IR: doc:/chapter:/article:/table:/cell:/checkbox object classes.
- Prior-art audit: pandoc (~45.7k★; 16 tables all lost in a real test), markitdown (~172k★; merged cells not restored), MinerU (~77k★; PDF-only), OmniDocBench (CVPR 2025; PDF-only benchmark). Star counts as of 2026-08; use the live repository for current figures.
- Case study: a 2019 public MSA document; 16 tables, 213 rows fully restored; dangling reference (Q103) reported truthfully rather than papered over.
- This is the same principle as ShadowBench-W applied to real documents: *verify after writing*.

---

## Pre-submission checklist

- [x] Re-run three arms × two models × 10 rounds under the patched judge — **complete**: M-level deepseek 3 arms × 10 and qwen-plus 3 arms × 10, all 60 runs in `results-v3-m/`; S-level a1/a3 re-runs in `results-v3/`
- [x] **Run the A2 prompt-only arm** — done 2026-08-13, 10 rounds × 2 models in `results-v3-m-ablation/`. **It overturned the paper's attribution**; §5.3 rewritten, abstract and contributions rewritten, §5.5 leads with it
- [x] **Fix the evidence metric** — `evidenceCoverage` added, `null`-exemption removed, `id.field` exact matching, 3 new mutants (12/12 killed), zero drift on all 80 rounds' state accuracy (§7.2)
- [ ] **Run A3-minus-validator and A3-minus-evidence-chain** — separates (b) from (c); the last unseparated confound (§5.3)
- [ ] **Re-examine why evidence coverage is only 15–27.5%** — model limit, prompt-design limit, or a defect in our commit-compiler? Currently unknown and declared as such
- [x] Recompute token accounting (full-text probes) — M-level real usage in §5.4
- [x] Merge the semantic channel into the main score, or explicitly declare its exclusion — declared in §5.5
- [x] Decouple judge and gate, or explicitly declare the coupling — scoped in §5.5
- [x] Re-verify every Related Work citation (arXiv IDs, stars, scoop check) — all 6 arXiv IDs verified live 2026-08-07; stars reported approximate
- [ ] Prepare anonymous repository (strip email, URLs, identity) — before arXiv submission
- [x] Verify ARR Oct 2026 cycle CFP — deadline 2026-10-12 AoE confirmed (aclrollingreview.org); COLING 2027 uses this cycle
- [ ] arXiv: pick category (cs.CL), endorsement path, anonymous or de-anonymized — before submission
- [ ] Figures: arm comparison, state-corruption example (sword transfer trajectory) — before submission
- [x] LaTeX package builds — **fixed 2026-08-12**. The 2026-08-07 build emitted `$\\pm$` / `$\\to$` (double backslash = line break in math mode) and had never compiled. Rebuild recipe in `BUILD.md`; **XeLaTeX only** (pdfLaTeX dies on `≈` U+2248). Verified: 11-page PDF, exit 0.
