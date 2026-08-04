# 03 · Protocol Draft v0.1

> Status: **Draft**. This document defines the minimal structure of an Origin package (`.origin/`),
> the six-part core of the Origin IR, the three-layer context projection, and the semantic
> transaction format. Draft JSON Schemas are in [`spec/schemas/`](../spec/schemas/).
>
> [中文原文](03-协议草案-v0.1.md) — the Chinese version is maintained alongside the implementation.
> Where this translation and the [conformance vectors](../spec/conformance/README.en.md) disagree,
> **the vectors decide.**

## 1. Design principles

Seven of the ten principles below carry an **Evidence** note. Those are not design intuitions —
each one was bought with a specific failure in a real experiment, and the note records which one.
A principle without an incident behind it is a principle nobody has tested yet.

1. **A federated meta-format; do not invent another large binary.** Do not attempt to replace USD,
   DOCX, Arrow, HDF5, images or video. Build unified identity, relations, projections, actions,
   provenance and validation *on top of* them. The model is the OCI image spec: a manifest plus
   independently addressable layered payloads, rather than one enormous inextensible blob.

2. **Generic shell + domain dialects.** The generic shell defines only lifecycle and minimal
   structure; Office, CAD, Story, Memory and Chart each extend the schema. They share no internal
   objects — only one action surface:
   `inspect / render / query / act / diff / validate / commit / rollback`.

3. **The source text is the origin; a summary is a projection.** Exact prose, events and
   human-confirmed settings are the source of truth. Summaries can be rebuilt at any time and have
   no authority to overwrite the origin.

4. **Separate inference from fact.** An AI's guess MUST be explicitly marked `status: inference`
   with a confidence and an evidence reference. It MUST NOT be silently promoted into canon.

5. **Every state has a source.** Any state field must be traceable to the event and evidence that
   produced it.

6. **Derive rather than store.** A fact may have exactly one home. Anything derivable MUST NOT be
   stored a second time.
   > **Evidence:** the very first run of the validator against the ShadowBench-W world spec caught
   > this class of defect. Custody was recorded twice — on the character's `carries` and on the
   > item's `holder` — so the moment an item changed hands the two disagreed, and the previous
   > holder was still carrying a key they had already given away. The fix was to delete the
   > character side and derive it from the item. **A double ledger is the single largest source of
   > state rot, and the protocol must forbid it.**

7. **IDs must come with a normalization layer.** An ID-based protocol that requires the model to
   reproduce namespace prefixes exactly will fail at scale in practice.
   > **Evidence:** in the first real experiment the model produced acceptable prose and sensible
   > state changes, but wrote `zhao-qi` instead of `char:zhao-qi` and `dukou-teahouse` instead of
   > `loc:dukou-teahouse`. The validator classified these as unknown objects and **five chapters
   > were discarded in full.** A semantically unambiguous form was rejected by strict matching:
   > that is interface hostility, not a model defect. Two fixes are required, and neither alone
   > is sufficient — (a) always present the full ID when projecting to the model, never strip
   > prefixes for readability, because the model copies the form you show it; (b) normalize on the
   > commit side (restore prefixes, disambiguate aliases).

8. **A validator must distinguish "rejected" from "completed".** A system that rejects every
   submission scores perfectly on any error-rate metric.
   > **Evidence:** in the same experiment the Benxiang arm produced *zero words* because every
   > submission was rejected. Its consistency error rate was therefore 0.000, and under a
   > judgement that compared only error rates it "beat" the bare model. The criterion must require
   > task completion first and compare quality second.

9. **You can govern state; you cannot govern prose — so gate the two separately.** Correct
   structured state does not imply correct generated content.
   > **Evidence:** the Benxiang arm produced runs where every state field was correct while the
   > prose put a key object in the wrong character's hands. The commit compiler initially validated
   > only the declared state changes and never checked the prose against the state. After wiring a
   > deterministic prose check into the gate, errors across three runs went from 1 / 6 / 3 to
   > **0 / 0 / 0**.

10. **A system may refuse, but it may not go silent.** A refusal must leave behind something a
    human can pick up.
    > **Evidence:** once the gate was tightened, the Benxiang arm began withholding anything
    > substandard and dropped 1–2 chapters per run — trading completeness for correctness, which
    > is unacceptable in real use. Changing it to "when retries are exhausted, accept the draft
    > with the fewest errors and flag it for human review" restored full completion while keeping
    > the quality advantage. This is exactly where the PodApp (human confirmation layer) sits in
    > the protocol.

## 2. The minimal Origin IR core (six parts + provenance)

A minimal origin is no more than these six parts (YAML, illustrative):

```yaml
artifact:
  id: sales-2026
  kind: dataset

payload:
  uri: ./sales.arrow          # native payload, content-addressed

semantics:
  month: YearMonth
  revenue:
    type: Amount
    unit: CNY
  region: Region

relations:
  - revenue derived_from order_items

constraints:
  - revenue must_not_be_negative
  - projection must_disclose_truncation

projections:
  - engine: flint
    chart: Line Chart
    encoding: { x: month, y: revenue, color: region }

provenance:
  source: sales.xlsx
  imported_at: 2026-08-02
```

The generic shell's JSON skeleton:

```json
{
  "artifact_id": "...",
  "type": "pptx",
  "nodes": [],
  "resources": [],
  "views": [],
  "provenance": [],
  "validations": [],
  "operations": []
}
```

## 3. Package layout (`.origin/`)

```text
example.origin/
├── manifest.yaml            # entry point: artifact metadata + index of each part
├── graph/                   # structural origin (responsible for *understanding*)
│   ├── objects.jsonl        #   objects (stable IDs)
│   ├── relations.jsonl      #   relations
│   └── constraints.json     #   constraints
├── payloads/                # native payloads (each domain's own format)
│   ├── building.usd
│   ├── finance.arrow
│   └── contract.docx
├── atlas/                   # visual overview (responsible for *finding*, low token)
│   ├── overview.webp
│   ├── page-map.webp
│   └── diff-map.webp
├── exact/                   # exact payloads (responsible for *precision*, read on demand)
│   ├── text/
│   ├── tables/
│   ├── formulas/
│   └── geometry/
├── behavior/                # behaviour and actions (interfaces with the Shadow Core)
│   ├── actions.json         #   permitted actions
│   └── validators.json      #   validations that must pass after a change
├── projections/             # human-facing output projections (cached views)
│   ├── report.pdf
│   ├── overview.png
│   └── summary.md
├── provenance/              # provenance and history
│   └── history.jsonl        #   event log (append-only)
└── evidence/                # validation evidence (interfaces with the Overlay)
    └── validation.json
```

Notes:

- `atlas / graph / exact` are the three context layers (see
  [02 · Concept system](02-概念体系.md) §5 — Chinese only for now; the short version is
  *atlas finds, graph understands, exact gets it right*)
- All directories are optional. The minimal legal package is `manifest.yaml` plus at least one of
  `payloads/` or `graph/`
- Domain dialects extend this layout (the Story dialect, for instance, adds
  `canon/ narrative/ timeline/ summaries/ style/`)

## 4. Representing state and inference

A state field must carry its source:

```json
{
  "object": "character:bai-yao",
  "field": "left_hand_injured",
  "value": true,
  "valid_from": "event:821-07",
  "evidence": "scene:821-04"
}
```

Inference must be kept apart from fact:

```json
{
  "claim": "Bai Yao may want to protect Lin Zheng",
  "status": "inference",
  "confidence": 0.63,
  "evidence": ["scene:604-03", "scene:702-02"]
}
```

### 4.2 Change log and write rules (implemented in v0.1)

**`graph/objects.jsonl` is the birth certificate; `provenance/history.jsonl` is the career record.**
Current state = the birth state with every change replayed over it. Writes only append to the
history and never rewrite `objects` — the moment you allow the current value to be written back into
`objects`, the history degrades into a document that describes what happened, and when the two
disagree there is no way to assign responsibility.

Each change record:

```json
{
  "event": "state_change", "seq": 2,
  "object": "part:beam-A1", "field": "level",
  "from": 3.20, "claimed_from": 3.60, "to": 2.90,
  "kind": "observed", "basis": ["dwg:S-201"],
  "tx": "tx-20260804-003", "by": "design-zhang", "at": "2026-08-04T09:12:00Z"
}
```

| Field | Meaning |
|---|---|
| `seq` | Monotonic watermark. Note it on read, pass it back on write, and a concurrent writer is detected (first writer wins) |
| `from` | The **actual** prior value at the moment of landing |
| `claimed_from` | The prior value the model *claimed*, present only when it differs from the actual one. Accumulated, this is the **model memory deviation rate** |
| `kind` | `observed` written directly by a transaction / `derived` computed from other fields / `asserted` a human assertion |
| `basis` | For `derived`, the fields it rests on. Retraction cascades (MemTX-style belief repair) will walk back along this edge |

Three hard rules:

1. **Append only, never rewrite** — otherwise the evidence chain does not hold
2. **No write without passing validation** — on failure, exactly zero bytes are written and the
   violation reasons are returned verbatim so the submission can be rewritten
3. **Take an exclusive lock and check the watermark on write** — when two agents submit
   concurrently the first writer wins and the second retries carrying the latest state

## 5. Context projection requests (input side)

The AI no longer "opens a file". It **requests a projection from the origin, fitted to the task at
hand.** One request carries:

```text
intent + origin object references + required projection types + precision level
    + permitted actions + constraints + required acceptance evidence
```

CLI sketch:

```bash
origin project company.origin \
  --target claude \
  --budget 1500 \
  --task "check for duplicated content and layout anomalies"

origin fetch company.origin slide-17/chart-2 --exact
```

Model profiles are independent of the origin — the same origin yields different projections
according to each model's visual token accounting and capabilities:

```text
profiles/
├── claude.yaml
├── gemini.yaml
└── deepseek-ocr2.yaml
```

## 6. Semantic transactions (output side — the AI's unit of output)

The AI does not emit full text or a final state. It emits a commit package:

```json
{
  "transaction_id": "tx-20260802-001",
  "operation": "append_scene",
  "target": "volume-07/chapter-823/scene-004",
  "depends_on": [
    "scene:volume-07/chapter-823/scene-003",
    "character:lin-zheng@state-822",
    "object:black-key"
  ],
  "content": { "format": "markdown", "text": "…scene prose…" },
  "state_changes": [
    { "object": "character:lin-zheng", "field": "location",
      "from": "north-corridor", "to": "moon-platform" },
    { "object": "object:black-key", "field": "holder",
      "from": "zhao-qi", "to": "lin-zheng" }
  ],
  "foreshadowing": {
    "resolved": ["hook:missing-letter-702"],
    "created":  ["hook:bell-sound-823"]
  },
  "assertions": [
    "bai-yao-betrayal-remains-secret",
    "zhao-qi-remains-alive"
  ]
}
```

Key points:

- **`depends_on`** — the objects and state versions the transaction declares it depends on; the
  runtime checks for conflicts against them
- **`state_changes`** — explicit from→to, therefore checkable and reversible
- **`assertions`** — boundaries the AI declares it has *not* violated, re-checked by the validator
- **The Flint principle** — never re-emit a large payload; reference the object ID and let the
  runtime bind the real content

After submission the runtime performs:

```text
parse content → check dependency state → check constraints → check continuity
→ commit payload → update state and relation graph → update summaries
→ regenerate projections → retain evidence
```

For a projection-only change (source data untouched) the transaction degrades to a semantic patch:

```yaml
patch:
  target: projections[0]
  set:
    chart: Grouped Bar Chart
```

## 7. The unified action surface (every dialect must implement it)

```bash
origin inspect  <artifact>        # overall information and health
origin render   <artifact>        # produce a visual projection
origin query    <artifact> <expr> # structured query (e.g. /slide[2]/shape[*])
origin project  <artifact> --as … # projection on demand (pdf/semantic/…)
origin act      <artifact> --action …  # execute an action through the Shadow Core
origin diff     <old> <new>       # structural / semantic / visual difference
origin validate <artifact>        # constraint and integrity validation
origin commit   <transaction>     # submit a semantic transaction
```

Exposure forms: CLI, MCP, REST API, SDK, PodApp review interface.

### 7.2 Reference implementation status (as of v0.1)

Subcommands actually landed in `compiler/cli.mjs` — aligned with the table above.
**What is not implemented is not pretended into existence:**

| Command | Action surface | Status |
|---|---|---|
| `origin status` | inspect | ✅ |
| `origin diagnose` | validate + inspect | ✅ constraints, dangling references, double ledgers, deviation rate |
| `origin why <obj.field>` | (new) evidence chain query | ✅ why this value is this value |
| `origin history` | (new) change timeline | ✅ filterable by object / field / transaction / author |
| `origin replay --until` | precursor to diff | ✅ replay to any seq or transaction |
| `origin seq` | (new) watermark | ✅ pairs with `commit --expect` for conflict detection |
| `origin commit` | commit | ✅ zero bytes written when validation fails |
| `origin render / project / act / query / diff` | — | ⬜ not implemented |

Output follows the *ai-cli-design* convention: stdout carries data only (TSV, or `--json`), stderr
carries explanation, and the exit code is `0` success / `1` errors found / `2` usage error — so that
an AI can call it directly as a local API.

### 7.3 Conformance

**The spec text is written for humans; the conformance vectors are what machines judge by.**

Before the vectors existed there was no checkable relationship between this document and one
JavaScript implementation: someone writing a second implementation had no way to tell whether it
counted, and in that state a "protocol" is just a carefully worded design document.
[`spec/conformance/`](../spec/conformance/README.en.md) draws the line:

- **The test vectors are data, not code** (`vectors/*.json`), depending on no host language
- Any implementation can certify itself by writing an adapter of a few dozen lines
  (read cases on stdin, write results on stdout)
- Two levels: **core** (in-memory semantics, 60 cases) and **full** (`.origin` persistence, 8 cases)
- An unimplemented op **MUST** honestly return `unsupported`, and the runner counts it as *not
  passing* — silently skipping lets the appearance of "there are constraints" hide the fact that
  nothing checks them

```bash
npm run test:conformance          # reference implementation: 68/68
node spec/conformance/run.mjs --adapter "python …/adapter.py" --level core
```

Two implementations pass today: the JavaScript reference (core + full) and a Python second
implementation (core). The second implementation demonstrates that **this semantics stands up
independently in another language and that the vectors really are a language-neutral contract.**
It does *not* demonstrate that anyone can read the spec and get it right, because both were written
by the same author. That claim requires a genuine third party.

Whether the vectors have teeth is answered by `npm run test:mutation`: it breaks the reference
implementation one promise at a time and runs both the self-tests and the vectors against each
mutant to see which catches it. A mutant caught only by the self-tests is a **coverage gap in the
protocol** — that promise constrains this one implementation and nothing else. Two gaps are
currently known (double-ledger detection, prose-against-state checking) and are listed openly in
[conformance/README §5](../spec/conformance/README.en.md).
**The protocol guarantees exactly what the vectors pin down** — without discount.

## 8. Domain dialect register (v0.1)

| Dialect | What the origin is | Lifecycle example |
|---|---|---|
| Office | pages, paragraphs, cells, slides | open → object tree → page render → edit → diff → native Office validation |
| CAD | geometry, constraints, parameters, assemblies | open → geometry tree → multi-view render → change parameters → geometry check → export validation |
| Archive (ZIP) | container and file tree | open → file tree → security scan → recursive parse → modify → repack → integrity validation |
| Web | DOM and runtime state | open → DOM/a11y tree → screenshot → interact → replay → pixel and behaviour validation |
| Media | timeline, shots, subtitles, audio tracks | open → timeline → edit → preview → encode and content validation |
| Chart (Flint) | data + field semantics + chart intent | data → semantic types → projection intent → compile → multi-backend charts |
| Story | prose, characters, timeline, foreshadowing, style | context pod → AI transaction → continuity check → commit → export EPUB/DOCX |
| Memory | facts, decisions, state and todos from a conversation | per turn → extract changes → write to origin → checkpoint → drop old conversation from context |

## 9. Open questions (deferred to v0.2)

- [ ] Object ID specification (URI scheme, cross-package references, content-addressing granularity)
- [ ] Whether the normative manifest form is YAML or JSON (currently: `manifest.yaml` as the
      human-facing entry, schemas defined in JSON)
- [ ] Transaction conflict resolution strategy (optimistic locking / state version numbers /
      three-way merge)
- [ ] The formal binding to the Shadow Core action schema
- [ ] The `semantics` type table (referencing Flint's 70+ semantic types, defining a common
      Benxiang subset)
