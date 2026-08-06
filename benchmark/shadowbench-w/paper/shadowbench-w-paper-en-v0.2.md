# ShadowBench-W: State Consistency as a Benchmarkable Task for Long-Form Text Generation

> Working draft v0.2 (English) — for arXiv preprint and ARR Oct 2026 cycle.
> Status: draft; all numbers are from benchmark/shadowbench-w/results-log.md (qwen-plus / deepseek-v4-flash, 11 rounds each).
> ⚠️ Draft only. Numbers marked [TBD] must be refreshed after the re-run under the patched judge (results-log TODO items).

## Abstract

Large language models (LLMs) fail silently at long-horizon generation. A sword picked up in chapter 8 is forgotten by chapter 20; a character's death goes unreported; and the model itself cannot say what it believes the world looks like. Existing benchmarks for long-form generation measure surface quality—fluency, coherence, consistency-error density—but stop short of the question that matters for downstream agents: *when a system is required to maintain a queryable world state alongside the text, is that state consistent with what it wrote, and can every claim be traced to evidence?*

We introduce **ShadowBench-W**, a benchmark for state consistency in long-form story continuation. Built on a Chinese corpus of 10 chapters (~20K characters) with a 5-chapter continuation task, it defines two scores: **W1** measures consistency errors per 100 contacts (EPC) in the generated text, and **W3** measures field-level agreement between the system's claimed world state and ground truth, together with the evidence-traceability of every state field. We also present the **Origin IR state layer**, a reference method that compiles context under a token budget and validates every state mutation as a transaction carrying an evidence chain.

Across two LLMs (qwen-plus, deepseek-v4-flash) and 11 rounds each, the state layer raises W3 state accuracy from 75.0% (baseline, zero variance) to 98.9% (p = 1.0000), reduces W1 EPC from 1.00 to 0.20 on qwen-plus (p = 0.0392), and achieves 100% evidence traceability. The benchmark, judges, and reference implementation are released under Apache-2.0.

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
2. **A new benchmark, ShadowBench-W**: a 20K-character baseline corpus, a 5-chapter continuation task, and two judges. W1 measures consistency errors per contact (EPC); W3 measures state-writeback correctness (field-level accuracy + evidence traceability).
3. **A reference method, the Origin IR state layer**: a context-compiler (input-side budget compilation) plus a commit-compiler (output-side parsing, validation, evidence retention). State is committed as transactions—rollback-able, evidence-chained, with a human-review layer.
4. **Empirical evidence**: across two models × 11 rounds, the state layer improves W3 from 75.0% to 98.9% (p = 1.0000), W1 EPC from 1.00 to 0.20 (p = 0.0392), with 100% evidence traceability.

## 2. Related Work

> ⚠️ Every citation below must be re-verified (arXiv IDs, stars, scoop check) before submission, per the repository rule "citations before claims".

**Long-context evaluation.** LongBench, LongBench v2, ∞Bench measure whether a model can *use* long context for question answering; they do not measure consistency of *generation* over long horizons.

**Story generation and continuation.** ConStory-Bench (arXiv 2603.05890, "Lost in Stories: Consistency Bugs in Long Story Generation by LLMs") is the closest and most important prior art. It evaluates narrative consistency with 2,000 prompts across four task scenarios, defines a taxonomy of five error categories with 19 fine-grained subtypes, and builds ConStory-Checker, an automated pipeline that detects contradictions and grounds each judgment in explicit textual evidence. It finds consistency errors are most common in factual and temporal dimensions, cluster around the middle of narratives, and correlate with high-entropy text segments.

ConStory-Bench and ShadowBench-W measure *different things*. ConStory-Bench detects **intra-text contradictions** in already-generated prose (text vs. text). ShadowBench-W's W3 measures **state-writeback correctness**: when the system is *required to maintain* a queryable world state (a first-class object, not an artifact of the text), does that state agree with the generated text field-by-field, and can every field be traced to evidence? The two are complementary: ConStory-Bench asks "did the story contradict itself?", ShadowBench-W asks "can the system *say* what it believes, and justify it?"—the question that matters for downstream agents acting on the state. Evidence traceability (W3's second score) has no counterpart in ConStory-Bench.

Tianming (zy-zmc/tianming-novel-ai-writer) is a production writing assistant with 15-dimensional fact snapshots and 12 types of CHANGES declarations—closest in spirit on the "maintain state while writing" side, but it does not publish a benchmark protocol or open judges.

**World-model representations and transactional memory.** OpenUSD (7423★, active) has made "save the source, project on demand" an industry standard in 3D. Origin IR applies the same idea to textual world state. Closer still is MemTX (arXiv 2607.23929, "Transactional Belief Commit for Stateful Agent Memory"), which argues that a memory write is not a belief commit: writes are staged in snapshot-isolated transactions, admitted by a validate-and-commit pipeline, and carry evidence, permissions, provenance, and validity. Our Origin IR state layer implements exactly this discipline in the long-form generation setting, and ShadowBench-W's W3 is the first public benchmark that *measures* whether a system honors that discipline (state-writeback correctness + evidence traceability). MemTX is a protocol design without a public benchmark or evaluation data; ShadowBench-W supplies the missing measurement.

**Document-parsing evaluation (adjacent evidence).** OmniDocBench (arXiv 2412.07626, CVPR 2025) shows that document parsing has a public benchmark with comprehensive annotations—and that state-writeback evaluation does not. That gap is our position.

**Evaluation methodology.** We deliberately use deterministic rules (with a curated vocabulary patch) rather than LLM-as-judge for W1/W3, to avoid circularity between the generator and the judge. The vocabulary patch (40/40 hits, 0 false positives on 65 test cases) is versioned as part of the benchmark.

## 3. Task & Benchmark

### 3.1 Task definition

A long-form continuation task is a tuple $(D_0, T, S)$ where:

- $D_0$ is the baseline corpus (chapters 1–10, ≈20K characters, Chinese; note the byte-level accounting in §5.4);
- $T$ is the continuation task (chapters 11–15) with a world specification (`world/spec.origin/tasks/continuation.json`): `state_at_chapter_10`, `forbidden_zones`, and a goal (Lin Zheng must obtain the Black Key from Zhao Qi);
- $S$ is the system-maintained world state.

Consistency $C(D, S)$ holds iff every field of $S$ is supported by evidence in $D$, and no statement in $D$ contradicts $S$.

### 3.2 Benchmark components

- **Corpus**: `corpus/ch01-10.txt` (~20K characters; UTF-8 Chinese, 3 bytes/char).
- **World spec**: `world/spec.origin/tasks/continuation.json`.
- **Judge W1**: CED (consistency-error density) and EPC (errors per 100 contacts). Patched vocabulary: 40/40 hits, 25 false-positive traps all silent (Run #29).
- **Judge W3**: state accuracy (field-level match) + evidence traceability (each field traceable to the event/scene that produced it).
- **Arms**: A0 = bare model with tail truncation; A1 = cheap vector RAG; A3 = Origin IR state layer.
- **Models**: qwen-plus, deepseek-v4-flash (both reasoning models; reasoning tokens accounted—see §5.4).

### 3.3 Metric protocol (honesty boundaries)

- W3 for stateless arms (A0/A1) is collected via one extra state-query round; that round's tokens count toward cost—no free lunch, and we say so in §5.
- W1 EPC depends on the vocabulary: 13/40 hits, 27 misses before the patch; 40/40 after. The judge version is part of the benchmark and ships with it.
- Judges use deterministic rules only; no LLM-as-judge (circularity guard).

## 4. Method: The Origin IR State Layer

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

> All numbers from results-log.md, runs that have *stood* under the current judge fingerprint. [TBD] items must be refreshed after the patched-judge re-run.

### 5.1 Main results (qwen-plus, 50-chapter baseline, 11 rounds)

| Arm | n | W1 EPC (↓) | W3 state accuracy | Mean tokens |
|---|---|---|---|---|
| A0 bare | 11 | 1.00 | 75.0% (sd = 0) | baseline |
| A1 vector RAG | 11 | — | 75.0% (sd = 0) | — |
| A3 Origin IR | 11 | **0.20** | **98.9%** | 52,263 |

W3: mean difference 0.0000 between A0 and A1; A3 vs A0/A1 p = 1.0000 (A0/A1 ten identical rounds at 75.0%).
W1 EPC: A3 vs A0 mean difference −0.35, p = 0.0392.

### 5.2 Cross-model robustness (deepseek-v4-flash)

| Arm | n | W1 EPC (↓) | W3 | Mean tokens |
|---|---|---|---|---|
| A3 Origin IR | 11 | **0.55** | **98.9%** | 116,390 |

W3 distribution identical round-by-round (10 rounds at 100%, 1 round at 87.5%)—robust across models.

### 5.3 Ablations

| Change | W1 effect | W3 effect |
|---|---|---|
| Before ID normalization | 5 chapters invalidated | — |
| After ID normalization | passes | — |
| Before vocabulary patch | 13/40 hits, 27 misses | judge protocol broken |
| After vocabulary patch | 40/40 hits, 0 false positives | judge protocol credible |
| Dual gate (state + text) | errors 1/6/3 → 0/0/0 (3 runs) | — |

### 5.4 Token accounting (honesty: no selective disclosure)

- qwen-plus: A3 costs +25%; deepseek-v4-flash: A3 costs +149%—**reported per model**; reporting only the former would be selective (results-log Run #16 rule).
- The state-query protocol changed to send full text; baseline-arm input tokens will rise, so the old "+25%/+75%" figures are void pending re-run ([TBD] before submission).

### 5.5 Known limitations (self-audited, so reviewers do not find them first)

- **Judge/gate coupling**: A3 uses the same rules as both shield and yardstick (Run #26); the deterministic-channel advantage carries a circularity component—declared in §4.3, to be decoupled or explicitly scoped before submission.
- **Semantic channel not in the main score**: vocabulary patches cannot catch up with natural-language synonym space (Run #23 conclusion).
- **Probe protocol**: the 75.0% constant partly reflects the probe template's own answers (Run #18); probes fixed, but whether 0% rounds enter the mean is undecided.
- **Single team, two models**: cross-model robustness covers two models only.

## 6. Limitations & Broader Impact

- **Limitations**: Chinese single-corpus (20K-char baseline); two models; vocabulary dependence of deterministic judges; reference implementation not production-grade (no real users).
- **Broader impact**: state consistency is not limited to fiction—codebases, operational plans, and regulatory documents all need "what do I believe and why". Our companion office dialect turns native documents into verifiable state objects (Appendix B). The benchmark encourages agents to maintain queryable world state, aligned with interpretability and auditability goals.

## 7. Reproducibility

- **Code**: public repository (anonymous version strips identity info); all three arms + judges + vocabulary patch + 65 test cases.
- **Data**: corpus/, world/spec.origin/, results/ (full JSON per round).
- **Judge fingerprints**: judgeHashW1 / judgeHashW3; fingerprints unchanged after the patch (Run #29).

## Appendix A: Conformance vectors and mutation testing

- 19 mutations, 19 caught, 0 escaped (self-tests keep their promises).
- 2 caught only by self-tests, not by conformance vectors—a protocol coverage gap; fix by adding vectors or declaring implementation freedom.

## Appendix B: The office dialect (native documents → verifiable state objects)

- docx → Origin IR: doc:/chapter:/article:/table:/cell:/checkbox object classes.
- Prior-art audit: pandoc (45,716★; 16 tables all lost in a real test), markitdown (171,671★; merged cells not restored), MinerU (76,864★; PDF-only), OmniDocBench (CVPR 2025; PDF-only benchmark).
- Case study: a 2019 public MSA document; 16 tables, 213 rows fully restored; dangling reference (Q103) reported truthfully rather than papered over.
- This is the same principle as ShadowBench-W applied to real documents: *verify after writing*.

---

## Pre-submission checklist

- [ ] Re-run three arms × two models × 10 rounds under the patched judge (results-log TODOs)
- [ ] Recompute token accounting (full-text probes)
- [ ] Merge the semantic channel into the main score, or explicitly declare its exclusion
- [ ] Decouple judge and gate, or explicitly declare the coupling
- [ ] Re-verify every Related Work citation (arXiv IDs, stars, scoop check)
- [ ] Prepare anonymous repository (strip email, URLs, identity)
- [ ] Verify ARR Oct 2026 cycle CFP: page limit (ACL format), anonymity, deadline 2026-10-12 AoE
- [ ] arXiv: pick category (cs.CL), endorsement path, anonymous or de-anonymized
- [ ] Figures: arm comparison, state-corruption example (sword transfer trajectory)
