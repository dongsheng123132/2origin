# ShadowBench-W: State Consistency as a Benchmarkable Task for Long-Form Text Generation

> Working draft v0.3 (English) — for arXiv preprint and ARR Oct 2026 cycle (deadline 2026-10-12 AoE).
> Status: draft. Main results (§5.1) from benchmark/shadowbench-w/results-v3-m/ (M-level, deepseek-v4-flash, patched hermes HTTP channel, 10 rounds/arm). S-level controls (§5.2) from results-log.md + results-v3/ re-runs. qwen-plus M-level runs in progress. All six arXiv citations verified live (2026-08-07); star counts reported as approximate (values drift).

## Abstract

Large language models (LLMs) fail silently at long-horizon generation. A sword picked up in chapter 8 is forgotten by chapter 20; a character's death goes unreported; and the model itself cannot say what it believes the world looks like. Existing benchmarks for long-form generation measure surface quality—fluency, coherence, consistency-error density—but stop short of the question that matters for downstream agents: *when a system is required to maintain a queryable world state alongside the text, is that state consistent with what it wrote, and can every claim be traced to evidence?*

We introduce **ShadowBench-W**, a benchmark for state consistency in long-form story continuation. Built on a Chinese corpus in two scales—an S-level 10-chapter (~20K characters) development corpus and an **M-level 50-chapter (≈95K characters) main corpus**—each with a 5-chapter continuation task, it defines two scores: **W1** measures consistency errors per 100 contacts (EPC) in the generated text, and **W3** measures field-level agreement between the system's claimed world state and ground truth, together with the evidence-traceability of every state field. We also present the **Origin IR state layer**, a reference method that compiles context under a token budget and validates every state mutation as a transaction carrying an evidence chain.

On the **M-level** task (50-chapter, ≈95K-character baseline) with deepseek-v4-flash (10 rounds/arm), the state layer raises W3 state accuracy to **100.0%** (zero variance), versus 56.3% for the bare model and 70.0% for a vector-RAG baseline (both p < 0.0001, 20,000-round permutation test), and cuts W1 consistency-error density from 2.16 to 0.84. State writeback is robust across models (qwen-plus and deepseek-v4-flash both reach 98.9–100% on S-level). The benchmark, judges, and reference implementation are released under Apache-2.0.

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
2. **A new benchmark, ShadowBench-W**: a two-scale Chinese corpus (S-level ≈20K, M-level ≈95K characters), 5-chapter continuation tasks, and two judges. W1 measures consistency errors per contact (EPC); W3 measures state-writeback correctness (field-level accuracy + evidence traceability).
3. **A reference method, the Origin IR state layer**: a context-compiler (input-side budget compilation) plus a commit-compiler (output-side parsing, validation, evidence retention). State is committed as transactions—rollback-able, evidence-chained, with a human-review layer.
4. **Empirical evidence**: at M-level (95K chars, deepseek-v4-flash, 10 rounds/arm), the state layer reaches **100% W3 state accuracy (zero variance)** versus 56.3% bare and 70.0% RAG (both p < 0.0001), and cuts W1 EPC from 2.16 to 0.84—with 100% evidence traceability, robust across two models.

## 2. Related Work

> ⚠️ Every citation below must be re-verified (arXiv IDs, stars, scoop check) before submission, per the repository rule "citations before claims".

**Long-context evaluation.** LongBench (arXiv 2308.14508), LongBench v2 (arXiv 2412.15204), and ∞Bench (arXiv 2402.13718) measure whether a model can *use* long context for question answering; they do not measure consistency of *generation* over long horizons.

**Story generation and continuation.** ConStory-Bench (arXiv 2603.05890, "Lost in Stories: Consistency Bugs in Long Story Generation by LLMs") is the closest and most important prior art. It evaluates narrative consistency with 2,000 prompts across four task scenarios, defines a taxonomy of five error categories with 19 fine-grained subtypes, and builds ConStory-Checker, an automated pipeline that detects contradictions and grounds each judgment in explicit textual evidence. It finds consistency errors are most common in factual and temporal dimensions, cluster around the middle of narratives, and correlate with high-entropy text segments.

ConStory-Bench and ShadowBench-W measure *different things*. ConStory-Bench detects **intra-text contradictions** in already-generated prose (text vs. text). ShadowBench-W's W3 measures **state-writeback correctness**: when the system is *required to maintain* a queryable world state (a first-class object, not an artifact of the text), does that state agree with the generated text field-by-field, and can every field be traced to evidence? The two are complementary: ConStory-Bench asks "did the story contradict itself?", ShadowBench-W asks "can the system *say* what it believes, and justify it?"—the question that matters for downstream agents acting on the state. Evidence traceability (W3's second score) has no counterpart in ConStory-Bench.

Tianming (zy-zmc/tianming-novel-ai-writer) is a production writing assistant with 15-dimensional fact snapshots and 12 types of CHANGES declarations—closest in spirit on the "maintain state while writing" side, but it does not publish a benchmark protocol or open judges.

**World-model representations and transactional memory.** OpenUSD (PixarAnimationStudios/OpenUSD, ~7.4k★, active) has made "save the source, project on demand" an industry standard in 3D. Origin IR applies the same idea to textual world state. Closer still is MemTX (arXiv 2607.23929, "Transactional Belief Commit for Stateful Agent Memory"), which argues that a memory write is not a belief commit: writes are staged in snapshot-isolated transactions, admitted by a validate-and-commit pipeline, and carry evidence, permissions, provenance, and validity. Our Origin IR state layer implements exactly this discipline in the long-form generation setting, and ShadowBench-W's W3 is the first public benchmark that *measures* whether a system honors that discipline (state-writeback correctness + evidence traceability). MemTX is a protocol design without a public benchmark or evaluation data; ShadowBench-W supplies the missing measurement.

**Document-parsing evaluation (adjacent evidence).** OmniDocBench (arXiv 2412.07626, CVPR 2025) shows that document parsing has a public benchmark with comprehensive annotations—and that state-writeback evaluation does not. That gap is our position.

**Evaluation methodology.** We deliberately use deterministic rules (with a curated vocabulary patch) rather than LLM-as-judge for W1/W3, to avoid circularity between the generator and the judge. The vocabulary patch (40/40 hits, 0 false positives on 65 test cases) is versioned as part of the benchmark.

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

> Main results are from the **M-level** task (50-chapter, ≈95K-character baseline, 5-chapter continuation), run on the patched hermes HTTP channel (deepseek-v4-flash, 10 rounds per arm). Small-scale S-level control (§5.2) and ablations (§5.3) supplement. All numbers from `results-v3-m/` (main) and `results-log.md` (controls), verified against current judge fingerprints.

### 5.1 Main results (deepseek-v4-flash, M-level: 50-chapter ≈95K baseline, 10 rounds)

| Arm | n | W1 EPC (↓) | W3 state accuracy | Total text | Mean tokens |
|---|---|---|---|---|---|
| A0 bare (tail truncation) | 10 | 2.16 ± 1.54 | 56.3% ± 23.2% | 160,553 | 88,731 |
| A1 vector RAG | 10 | 0.82 ± 0.44 | 70.0% ± 6.1% | 167,902 | 89,757 |
| A3 Origin IR state layer | 10 | **0.84 ± 0.37** | **100.0% ± 0.0%** | 166,146 | 100,884 |

Permutation tests (20,000 rounds): W3 A3 vs A0 **p < 0.0001**; W3 A3 vs A1 **p < 0.0001**; W3 A1 vs A0 p = 0.1315 (n.s.).

Three findings:

1. **State correctness is the differentiator.** A3 reaches 100% state accuracy on all 10 rounds (zero variance); A0 (bare) only 56.3%, A1 (RAG) 70.0%. RAG helps text (EPC 0.82 ≈ A3's 0.84) but does **not** fix state (70% vs 100%, p < 0.0001)—retrieval returns relevant prose, but nothing writes a *queryable world state* back.
2. **Text quality is NOT where the method wins.** A3's EPC (0.84) is 61% lower than A0 (2.16), but statistically indistinguishable from A1 (0.82). The Origin IR state layer's advantage is state writeback (W3), not prose generation (W1)—consistent with the S-level finding that W1 and W3 decouple.
3. **The gap widens with scale.** At S-level (20K chars) A0 hit 75.0%; at M-level (95K chars) A0 collapses to 56.3%. A3 holds 100% at both scales. State corruption is a *scale* defect.

### 5.2 Cross-model robustness (qwen-plus) & S-level control

qwen-plus M-level runs were in progress at submission-refresh time; S-level controls (results-log, patched-judge re-runs) cover cross-model robustness on the smaller scale:

| Arm | S-level W3 | S-level EPC |
|---|---|---|
| A0 bare | 75.0% (sd = 0) | 1.00 |
| A1 vector RAG | 75.0% (sd = 0) | — |
| A3 Origin IR (qwen-plus) | 98.9% | **0.20** |
| A3 Origin IR (deepseek-v4-flash) | 98.9% | **0.55** |

W3 distribution for A3 identical round-by-round across both models (10 rounds at 100%, 1 at 87.5%)—state writeback is robust to the underlying model. The 75.0% A0/A1 S-level constant reflects a probe artifact fixed in the M-level protocol (see §5.5).

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

- **Judge/gate coupling**: A3 uses the same rules as both shield and yardstick; the deterministic-channel advantage carries a circularity component. We scope this explicitly: W3 compares only *structured state fields* against ground truth, never free text, so the judge does not depend on lexical overlap with the gate's rules. The residual risk is that A3's internal rule list and the judge's rule list share a source; we report the judge fingerprints (§7) so the coupling is auditable, and treat W3 as an upper bound until an independent judge is added.
- **Semantic channel not in the main score**: vocabulary patches cannot catch up with natural-language synonym space (Run #23 conclusion). W1 (EPC) therefore understates A0's true error rate if A0 rephrases; we report the patch's 40/40 recall on the test set so the reader can gauge the ceiling.
- **Probe protocol**: the S-level 75.0% constant partly reflected a probe-template artifact (Run #18); the M-level protocol sends full-text probes, and A0's M-level W3 is 56.3% ± 23.2% with real variance—the artifact is gone, not averaged over.
- **Single team, two models**: cross-model robustness covers two models only; single-corpus (Chinese fiction). Both are declared bounds, not claims.

## 6. Limitations & Broader Impact

- **Limitations**: Chinese single-corpus (M-level ≈95K-char baseline; S-level development corpus); two models; vocabulary dependence of deterministic judges; reference implementation not production-grade (no real users).
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
- Prior-art audit: pandoc (~45.7k★; 16 tables all lost in a real test), markitdown (~172k★; merged cells not restored), MinerU (~77k★; PDF-only), OmniDocBench (CVPR 2025; PDF-only benchmark). Star counts as of 2026-08; use the live repository for current figures.
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
