# 02 · Concept system (project-wide terminology reference)

> This document is the terminology baseline for every document, code comment and public statement in
> the project. A new term MUST be registered here first.
>
> [中文原文](02-概念体系.md)

## 1. Core glossary

Chinese terms are given because the code and comments use them; the English column is what the
English documents use.

| Chinese | English | One-line definition | Question it answers |
|---|---|---|---|
| **本象协议**（brand） | **Benxiang** | The project's English brand (fixed 2026-08-02): *Ben* = origin, *Xiang* = the archetypal image. "Origin Protocol" was dropped — it collides with the OGN crypto project | What is this project called? |
| **本象** | **Origin** | The reasonably complete source state of a digital object: objects + relations + data + state + constraints + provenance | What *is* this digital object? |
| **本象 IR** | **Origin IR** (Intermediate Representation) | The normalized intermediate representation of an origin — the "LLVM IR" of the AI era | In what structure is an origin stored and exchanged? |
| **影子** | **Shadow** | A projection generated for one user, device or task | Who sees what, in which situation? |
| **投影** | **Projection** | The process and the result of generating a shadow from an origin (PDF, image, text, 3D, UI are all projections) | How does an origin become something consumable? |
| **叠象** | **Redline** | The state / difference / evidence / version layer: visual, structural, semantic, geometric, data and behavioural diffs, plus change trails and validation results | What changed? Is it right? Can it be proven? |
| **影核协议** | **ActionParity Protocol** | The unified action layer: one semantic action, many executors | What does the AI want to do, and how do different applications carry it out uniformly? |
| **影域** | **ShadowSpace** | The isolated space where the AI works safely — try, simulate and validate without damaging real files | Where does the AI fail safely? |
| **舟舱** | **PodApp** | The human confirmation, annotation and control surface | Which part needs a human to see and decide? |
| **影刻** | **ShadowFork** | The mechanism for rapid customization, distribution and branding | How does the system replicate and spread? |
| **Shadow Runtime** | **Shadow Runtime** | The execution layer: the "virtual machine" that loads origins, runs compilation and produces projections | Who actually runs all this? |
| **本象包** | **Origin Pack** (`.origin/`) | The on-disk form of the federated meta-format: manifest + layered payloads + projections + evidence | What does an origin look like on disk? |
| **语义事务** | **Semantic Transaction** | The AI's unit of output: operation + target + dependencies + content + state changes + assertions | How does the AI's output get written back to the world safely? |
| **上下文编译器** | **Context Compiler** | Input side: compiles an origin into the context the AI most needs, given the model, task and token budget | What should the AI be looking at right now? |
| **提交编译器** | **Commit Compiler** | Output side: parses the transaction, validates constraints, updates state, retains evidence, re-projects | How does the AI's output get verified and landed? |
| **引用优先** | **Reference-First** | Carry references, not truth; resolve at use-time, version-pinned. The common mechanism behind Origin / ActionParity / Origin-Environment and the four-layer stub system | For any state a new design introduces: store the source, or only a reference? |

The division of labour, as a single line:

> **ShadowSpace isolates, the Origin preserves, the Redline sees and compares, the Shadow Core acts,
> the PodApp gets human confirmation, and the ShadowFork replicates.**

## 2. One Origin, Many Shadows

The core idea unfolds into four "one to many" statements:

### 2.1 One semantic core, many surface shadows

The same Excel operation can be performed through the Excel GUI, LibreOffice, Python, OfficeCLI,
WPS or Web Office. Every interface is a shadow; there is only one semantic core.

### 2.2 One artifact, many projections

The same origin can carry a textual view, a mathematical view, a data view, a geometric view, a
temporal view, a causal view, a visual view and an interactive view.

### 2.3 One action, many executors

`replace_text` can be executed by native Office, by direct OOXML manipulation, by LibreOffice, by
OfficeCLI or by GUI automation. The ActionParity protocol handles routing and fallback.

### 2.4 One result, many verifiers

The same result passes file-structure validation, native-application open validation, visual
validation, semantic validation, AI cross-checking and user confirmation. The Redline aggregates
these into a confidence result — what the AI receives is not a PNG, but a conclusion with evidence.

## 3. The six-step loop

```text
Observe → Understand → Act → Render → Verify → Commit
```

Mapped to components:

```text
Redline perception → shadow object model → ActionParity → real application executes
→ Redline re-renders and compares → PodApp human confirmation → commit to the real file
```

## 4. A concrete example

When a PPT file enters the system it produces several shadows:

```text
original PPTX
   ↓
structural shadow: slides, shapes, text, images
semantic shadow:   titles, conclusions, data relations
visual shadow:     per-page screenshots, an overview map
action shadow:     the modifications that are permitted
version shadow:    before/after differences
evidence shadow:   the result of opening it in real Office
```

The AI works in the shadow world first — see → understand → simulate a change → predict the impact →
execute → re-render → inspect the difference — and only then commits to the real file.

## 5. The three-layer context structure (the standard shape of a projection)

The context handed to an AI is neither pure images nor pure JSON. It has three layers:

| Layer | Content | Responsibility |
|---|---|---|
| **atlas** (visual overview) | page thumbnails, timelines, relation graphs, heat maps, object numbering, risk markers | **the map finds**: global awareness for very few tokens |
| **graph** (structural origin) | objects, relations, dependencies, available actions (with stable IDs) | **the structure understands**: no guessing objects out of an image |
| **exact** (precise payload) | raw text, formulas, parameters, source images, code, clauses | **the source text gets it right**: fetched only when needed |

As a single line:

> **The map handles the whole, the structure handles relations, the source text handles precision,
> the Shadow Core handles execution, and the Redline handles proof.**

## 6. Three protocols and their boundaries (do not stuff everything into the Shadow Core)

| Protocol | Belongs to | Responsible for |
|---|---|---|
| **Artifact Projection Protocol** | Origin / Redline | file structure, semantics, coordinates, previews, available actions, provenance tracking |
| **ActionParity Protocol** | Shadow Core | action definitions, parameters, preconditions, executor selection, failure fallback, undo |
| **Evidence Commit Protocol** | Redline | multi-renderer validation, difference reports, risk scoring, human approval, evidence chain, final commit |

Together they are the **Shadow Runtime Protocol**.

## 7. The negative list (these statements are wrong)

To prevent concept drift, the following are explicitly **not** true:

- ❌ *"Benxiang means screenshotting text into images to save tokens."* Image compression is one
  projection technique, not a storage format.
- ❌ *"Benxiang is a bigger universal JSON / universal DOM."* Office, CAD and ZIP are fundamentally
  different; they share only a lifecycle (`inspect / validate / commit` core, plus
  `render / project / query / act / diff / rollback` derived), never a data structure. Generic shell
  plus domain dialects — anything else converges on the lowest common denominator.
- ❌ *"Benxiang is a previewer supporting 500 formats."* That is how traditional software competes.
- ❌ *"Benxiang can compress a million words into a few thousand tokens losslessly."* It **manages**
  the context limit the way an operating system manages memory. It does not abolish it.
- ❌ *"A summary can stand in for the source."* A summary is a rebuildable projection with no
  authority to overwrite source fact; inference and fact must be labelled separately.
- ❌ *"Reference-First forbids all copying / caching."* It forbids **carrying truth** (one fact stored
  in two places). Caching a **projection** is fine — as long as the projection is rebuildable and
  says what it dropped, because a projection is not the source.
- ❌ *"Reference-First is a new clause Benxiang just added."* It is the **generalized name** for
  principles the protocol already used (derive-don't-store #6, ID normalization #7, the Flint rule),
  extended to every design decision — not just state and output.
