# The Benxiang Manifesto

> **Save the origin, project on demand.** 一源万影
>
> *«The sage establishes images to exhaust meaning.»* — Book of Changes

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

| Model · baseline | Benxiang | Naive LLM | Vector RAG |
|---|---|---|---|
| qwen-plus · 20k chars (10 runs each) | **92.5%** | 75.0% | 75.0% |
| qwen-plus · 95k chars (11 runs each) | **98.9%** | 75.0% | 75.0% |
| deepseek-v4-flash · 95k chars (n=1) | **100.0%** | **37.5%** | 75.0% |

**That last row is the most important result this project has produced.**

Bare deepseek manages 37.5%. Bare qwen manages 75%. These two models are not remotely in the same league at holding state. Put both behind the same state machine and the same gate, and both land at or near perfect.

> **Benxiang lifts two models of very different strength to the same height.**
> **State correctness comes from the architecture, not from the model.**

That is precisely the property a *protocol* should have: **it does not depend on how strong the machine underneath happens to be.** Models turn over every six months. This layer does not have to.

Two more findings worth stating plainly:

- **The longer the baseline, the bigger the gap** (20k chars: 92.5% → 95k chars: 98.9%). Vector RAG is exactly the technique that ought to shine as context grows — across thirty-three runs it did not move once. Retrieval finds text. It cannot find *who holds the key right now*, because that fact appears in no passage; it is derived.
- **RAG can carry a weak model up to the 75% wall. It does not get over it.** Only a state machine does.

## V. Why this is not a novel-writing tool

One dialect working could be a coincidence. **Two is a protocol.**

The shape is *generic shell + domain dialects*: the shell defines lifecycle and minimal structure, each domain brings its own schema, and they share one action surface —

```text
inspect · render · query · act · diff · validate · commit · rollback
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

- **Not "writes more consistently."** Prose consistency shows **no significant difference** from vector RAG (p=0.9905 / p=0.3361). Cheap RAG already owns that half.
- **Not "saves tokens."** The opposite — **more expensive**: +25% on qwen, +149% on the long-reasoning deepseek.
- **Cross-model is indicative only.** The second model has been run once (n=1). Multi-run validation is in progress.
- **No production adapters, no real users.** CAD and Office are, today, a line in a table.

The [experiment log](benchmark/shadowbench-w/results-log.md) records **six instrumentation accidents in a single day** — all self-caught, each with the guardrail that now prevents it. Including the one where the judge graded M-tier answers against the S-tier answer key, marked a **correct answer wrong**, and handed back a *more flattering-sounding negative result* ("the advantage vanishes as the baseline grows"), which was written into the log before the cause was found.

**An erroneous negative result is harder to question than an erroneous positive one**, because it reads as a researcher being admirably self-critical.

We publish all of it, because for a benchmark **the honesty of the instrument is the entire asset**.

---

> Humans compressed the world into documents and handed them to computers.
> Now AI should read the origin directly, and generate whatever projection a human needs.

**Save the origin, project on demand.**
