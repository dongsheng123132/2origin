# The Benxiang Manifesto

> **Save the origin, project on demand.** 一源万影
>
> *«The sage establishes images to exhaust meaning.»* — Book of Changes
>
> If you read one page, read [The Core](docs/00-CORE.en.md).

---

## I. The disease: we mistook the shadow for the thing

The history of human information is a history of flattening the world.

```text
a real building → CAD model → floor plan → PDF → screenshot → OCR text
a real business → workflows → spreadsheet → summary figures → one paragraph
a real argument → a web of relations → an outline → a line of prose
```

Every step travels better. Every step loses something. Among humans this trade was fine — we carry enough common sense to reconstruct the original from a damaged projection.

**But what AI reads today is the shadow of a shadow, seven or eight compressions deep.**

Worse: we started treating that last shadow as the source file. Edit the PDF, edit the screenshot, edit the summary — every one of those edits lands on a projection, while the actual object never existed in any file at all.

This is not an argument against text. Text is a spectacularly high-compression, highly composable representation, and for a legal clause the text *is* the origin. The error is narrower than that — it is **mistaking a projection for the object**:

| Domain | What the origin actually is | What we edit instead |
|---|---|---|
| CAD | geometry, constraints, parameters, assemblies | the exported drawing |
| Spreadsheets | formulas and data dependencies | pixels on screen |
| Novels | character state, timeline, planted-payoff graph | paragraphs of prose |
| Software | code, state, runtime behaviour | screenshots |

## II. One irreversible line

Rendering a 2D image from a 3D model is easy. Recovering *the* 3D model from a 2D image is, in general, **impossible** — infinitely many objects cast the same shadow.

```text
origin → projection      ✅ deterministic, repeatable
projection ⇏ the origin  ❌ irreversible
```

That asymmetry sets the architecture: **stop trying to infer the body from its shadow — keep the body.**

PDFs, images, Markdown, EPUB are not source files. They are **projections** — cached views generated on demand. Deleting one costs nothing, because it can always be cast again.

## III. AI should not deliver final artifacts. It should deliver transactions.

Today's AI emits whole artifacts: a forty-page deck, a novel, hundreds of lines of chart config. Content, formatting and references fail together, and the only remedy is to regenerate everything.

Benxiang demands a different output:

> **The AI submits only a semantic transaction — what changed, what it depends on, what it asserts.**
> **A deterministic compiler validates it, applies it, and generates the final artifact.**

The model says *"I handed the black key to Shen Yan, and I assert Zhao Qi is still alive."* The validator does not take its word for it. It checks. If the check fails, the transaction is bounced back with the evidence attached.

This is not distrust of the model. It is **keeping separate books for "claimed" and "verified".**

## IV. What has actually been demonstrated

Enough philosophy. Here are numbers you can check — [full log](benchmark/shadowbench-w/results-log.md), [raw results](benchmark/shadowbench-w/results/) committed to the repository.

The task is state tracking across long-form narrative: *who holds the key right now, who learned the secret, which planted threads are still open.*

**✅ The only currently valid comparison** ([Run #27](benchmark/shadowbench-w/results-log.md), 2026-08-05, after the probe fix)

| qwen-plus · 95k chars · n=6 each | Benxiang | Naive LLM | Vector RAG |
|---|---|---|---|
| **W3 state accuracy** | **95.8% ± 5.9** | 52.1% ± 19.7 | 58.3% ± 11.8 |
| Permutation test vs Benxiang | — | **p = 0.0024** | **p = 0.0024** |

This time the control arms got every character they had just written, no answer anywhere in the prompt, and all eight fields asked. Benxiang still leads by 43.8 and 37.5 points.

> **The 75% wall was fake. What stood behind it is real.**

**The unfavourable part first:** Benxiang scores **4/6 on `obj:black-key.holder` — worse than either control arm** — and that is exactly the field recoverable from the prose it just wrote. Its whole advantage lives in the two fields where both controls collapse:

| Field | Naive | RAG | Benxiang |
|---|---|---|---|
| `black-key.holder` (last handover written in its own prose) | 5/6 | 5/6 | **4/6** |
| `bai-yao.secret_betrayal` (secret accumulated over dozens of chapters) | 1/6 | 0/6 | **6/6** |
| `hook:shen-yan-suspicion.status` (**never stated in any passage**) | 0/6 | 0/6 | **6/6** |

> **State readable from your own recent prose: retrieval and a bare model both suffice; Benxiang has no edge. State accumulated across the whole book and never stated in any passage: only the state machine answers it.**

*"Has this thread been paid off"* is not a fact in any passage. It is a ledger entry. Retrieval can fetch the passage that says so — except none exists.

---

🛑 **Old-probe archive below. Both control columns are void.**

| Old instrument · archived | Benxiang | 🛑 Naive (void) | 🛑 RAG (void) |
|---|---|---|---|
| qwen-plus · 20k chars (10 runs each) | 92.5% | ~~75.0% (sd 0)~~ | ~~75.0% (sd 0)~~ |
| qwen-plus · 95k chars (11 runs each) | 98.9% | ~~75.0% (sd 0)~~ | ~~75.0% (sd 0)~~ |
| deepseek-v4-flash · 95k chars (11 runs each) | 98.9% ± 3.59 | 🛑 void | 🛑 void |

What I originally wrote here was: *"Both control arms sat at exactly 75.0% with zero standard deviation across 33 runs — stuck against the same wall."* That sentence is wrong, and wrong in an ugly way.

Self-audit ([Run #18](benchmark/shadowbench-w/results-log.md)): the control arms' state is collected via one **extra probe call** that **carries no conversation history** — its opening line, "based on what you just wrote," reaches a model that has never seen that prose. And the JSON template in that prompt **prints 5 of the 8 correct answers literally in the question**; a 6th passes trivially on an empty array; a 7th (foreshadowing status) is never asked for and is structurally unreachable for the control arms. Exactly one field actually tests anything.

**6 ÷ 8 = 75.0%.** That wall is the template's own answer key.

**The beautiful zero variance should have been the loudest alarm.** A real model, on a real task, returning the identical number twenty times running has only one explanation: it isn't doing the task. I treated it as my strongest evidence instead.

**The Benxiang column is unaffected** (A3 never uses the probe). But until the control arms are re-run, **no comparison stands — including the ones that favour this project.**

**The deepseek row has to be held back.** The smoke run measured the bare model at 37.5% and RAG at 75.0%, and on that basis I wrote *"Benxiang lifts two models of very different strength to the same height."* Ten runs later those numbers are 53.8% and 32.1%. **A single run tells you nothing about the distribution.** Variance on that model is enormous and the control arms are bimodal — most runs land at 75%, several collapse to 0%.

The Benxiang arm is now full ([Run #19](benchmark/shadowbench-w/results-log.md)): counting the smoke run, **n=11 at 98.9% ± 3.59**, every run completing 5/5. Ten were perfect; one scored 87.5% — and the field it missed was `obj:black-key.holder`, precisely the one field Run #18 identified as the only one that actually tests anything.

**That imperfect run is the good news.** A flat ten-out-of-ten with zero variance would, under the rule established the previous day, have to be treated as a suspect rather than a triumph. A real model producing a distribution that occasionally errs is evidence that what was measured is capability, not a template.

The same thing happened once on qwen: each model's single imperfect run missed the **same field**, in different ways — deepseek left the key with Lin Zheng (never executed the handover), qwen filled in `loc:moon-platform`, a location in a character field.

**Half the cross-model claim now holds. The other half does not.**

The half that holds is the **within-arm** comparison — A3 against itself on two models, which never touches the probe and is therefore unaffected by Run #18. After a uniform rescore, 11 runs against 11:

| | qwen-plus (n=11) | deepseek-v4-flash (n=11) | Permutation test |
|---|---|---|---|
| **W3 state accuracy** | **98.9%** | **98.9%** | diff 0.0000, **p = 1.0000** |
| **W1 EPC** (prose, lower is better) | **0.20** | **0.55** | diff −0.35, **p = 0.0392** |

The W3 distributions are **identical run for run** (10 perfect + 1 at 87.5% each), while prose quality differs by nearly 3×.

> **State-layer correctness is independent of the base model; prose-layer quality is not.**

That is exactly the property a *protocol* ought to have: **it does not depend on how strong the machine underneath is.** And this time it is not the n=1 flattery of Run #15 — it is 11 against 11.

The half that does not hold is the **comparison**. *"Benxiang lifts two models of very different strength to the same height"* still cannot be used: "to the same height" is a statement about the control arms, which are void — and even the premise that the two models differ greatly in strength rested on A0's 37.5%/75%, void for the same reason. **I can say the first half of that sentence and not the second.**

The correction is worth keeping in the manifesto: **an n=1 result that flatters you is exactly as worthless as an n=1 result that doesn't.** The mistake in the previous version was not fabrication — it was treating "this leaves no room for interpretation" as a substitute for sample size.

Two more findings worth stating plainly:

- **The longer the baseline, the higher Benxiang's own score** (20k chars: 92.5% → 95k chars: 98.9%). This is a within-arm comparison that never touches the control arms, so it is **unaffected by Run #18**. But "the *gap* widens" has to wait for the control arms to be re-run — the other half of that difference is currently void.
- ~~**Vector RAG did not move across thirty-three runs; retrieval cannot find state.**~~ **Withdrawn (Run #18)**, and for a reason uglier than "RAG doesn't help": the retrieved passages went into the *chapter-writing* calls, while state was collected by a separate probe call **carrying no history** — so **the retrieval never reached the moment being measured.** Retrieval did not fail the exam; it never sat it. **And the first data after fixing the probe (Run #22, n=6, A0 only, interrupted) suggests at least half of it is wrong.** Given its own 20k characters of prose in context, the bare model answered *"who holds the black key right now"* correctly in **five of six runs** — the very field this claim always used as its example. It could not answer before because it had never been shown a single word, not because state is unanswerable.

Where A0 does fail consistently is elsewhere: whether Zhao Qi is alive (0/6) and the foreshadowing status (0/6). If the claim is to be re-made, it has to be re-made on those fields, and only after all three arms have run.
- **RAG's effect is model-dependent, and can be negative.** On qwen it changed nothing (75.0% → 75.0%). On deepseek, across 10 and 7 runs, it came out **worse than the bare model** (53.8% → 32.1%): retrieved passages are one more source of distraction for a model that is already unstable. The earlier line — "RAG carries a weak model to the 75% wall" — also came from a single run, and is withdrawn.
  > 🛑 **This whole bullet was withdrawn with Run #18.** "RAG changed nothing" has a far more boring explanation: the retrieved passages go into the *chapter-writing* calls, while W3 is measured by a separate probe call **with no history** — the retrieval never reaches the moment of measurement. It isn't that retrieval doesn't help; it never sat the exam. Re-run required.

## V. Why this is not a novel-writing tool

One dialect working could be a coincidence. **Two is a protocol.**

The shape is *generic shell + domain dialects*: the shell defines lifecycle and minimal structure, each domain brings its own schema, and they share one action surface —

```text
inspect · validate · commit (core) · render · project · query · act · diff · rollback (derived)
```

The [reference implementation](compiler/)'s test suite is built to prove exactly this line: **the same code, unmodified**, drives a narrative world (characters, secrets, foreshadowing) and a sales dataset (no characters, no plot, no foreshadowing).

The move that made it a protocol was turning constraints from code into data. In the benchmark they were three hard-coded types whose names reek of fiction — `knows_must_not_gain`, `hook_must_stay`. They now collapse into six general predicates:

```text
equals · not_equals · contains · not_contains · range · unchanged
```

*"The protagonist must not learn this secret"* and *"revenue must never go negative"* are the same statement at the protocol layer.

## VI. Where this goes

**Now** — the narrative dialect. Validated at a 95k-character baseline; the target is **a million characters**: character state, timeline, planted-payoff graph and forbidden zones held without amnesia, written transactionally. It is the hardest tier on purpose — long, state-dense, constraints tangled with each other, and errors are immediately visible to a human reader.

**Next** — the same shell over other origins.

| Dialect | What the origin is |
|---|---|
| **CAD / 3D** | geometry, constraints, parameters, assemblies |
| **Office** | document structure, styles, reference graph |
| **Chart / data** | data dependencies and formulas, not the rendered image |
| **Memory** | project world-state that outlives the conversation |

CAD deserves a special mention: irreversibility is most obvious there — **a drawing is never the model** — and its constraints are natively machine-checkable (geometric conflicts, assembly interference, parameters out of range), landing squarely in the cell where Benxiang is strongest.

**Further out** — if this holds, a "file" in the age of AI should no longer be a `.docx` or a `.pdf`, but an **origin package** that can be opened, seen, located, modified and re-verified. Humans read projections. AI edits the origin. The system proves the edit was correct.

## VII. What we do not claim

The credibility of this project rests on stating its limits precisely.

- **Not "writes more consistently."** Prose consistency shows **no significant difference** from vector RAG — after a uniform M-tier rescore, qwen p=0.1852 and deepseek p=0.3341. Cheap RAG already owns that half.
  > On deepseek, A3 does beat the **bare** model significantly (p=0.0278). That is not enough to claim: A0 is the weak baseline, and beating it is a different sentence from beating RAG; four tests were run this round, so the Bonferroni threshold is 0.0125, which it does not clear; and the same comparison on qwen gives p=0.3386. Recorded in Run #19, kept out of the claims.
- **Not "saves tokens" — but no longer "more expensive" either.** Measured on the fixed probe at matched conditions (Run #27, n=6 each): Benxiang 64612 vs bare model 57598 — **+12.2%, permutation p = 0.5253, not significant**. Every earlier figure published here (+25%, +75%, +149%) came from the old probe or a single run and is **withdrawn**: back then the control arms' probe was nearly free because it sent no context at all. Worth noting that Benxiang's *input* tokens are the lowest of the three (36740 vs 40469) — its context is budget-bounded; the excess is all output, from gate retries.
- **Cross-model holds only halfway.** What holds is **within-arm**: Benxiang's own W3 is identical on both models (98.9% vs 98.9%, n=11 vs 11, p=1.0000) while its prose layer differs significantly (p=0.0392). What does not hold is the **comparison**: the control arms on the second model were withdrawn with Run #18 and must be re-run, so *"lifts two models of very different strength to the same height"* remains unusable — both halves of that sentence depend on the control arms.
- **No production adapters, no real users.** CAD and Office are, today, a line in a table.

The [experiment log](benchmark/shadowbench-w/results-log.md) records **six instrumentation accidents in a single day** — all self-caught, each with the guardrail that now prevents it. Including the one where the judge graded M-tier answers against the S-tier answer key, marked a **correct answer wrong**, and handed back a *more flattering-sounding negative result* ("the advantage vanishes as the baseline grows"), which was written into the log before the cause was found.

**An erroneous negative result is harder to question than an erroneous positive one**, because it reads as a researcher being admirably self-critical.

We publish all of it, because for a benchmark **the honesty of the instrument is the entire asset**.

---

> Humans compressed the world into documents and handed them to computers.
> Now AI should read the origin directly, and generate whatever projection a human needs.

**Save the origin, project on demand.**
