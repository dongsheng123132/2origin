# 09 · Reference-First

> **Carry references, not truth. Resolve at use-time, and pin the version you resolve to.**
>
> This page states the principle that runs through all three protocols — Benxiang (Origin),
> ActionParity, and Origin Environment — and the four-layer stub system. It is not a new clause
> of any single protocol; it names the one mechanism all three were already using, so it can
> become a check every new design must pass.
>
> 🇨🇳 **[中文](09-引用优先-Reference-First.md)**

---

## §0 · In one sentence

**A system stays unrotten at scale the same way everywhere: nobody ships truth around; everyone
carries only the smallest address that can find it.**

- **Don't carry it.** Truth lives in exactly one place (the source). Everyone else holds a
  *reference* — an ID, a name, an address, a fingerprint — never a copy of the truth.
- **Resolve it lazily.** A reference resolves to the concrete truth *at use-time*, through a resolver.
- **Verify it.** Resolution checks version / watermark / fingerprint along the way —
  *content always matches the installed version*.

## §1 · The root disease: copies drift

Copying a truth into a second place creates **two copies plus a sync obligation**. Synchronizing is
a losing fight against entropy: you update A, forget B, and now both A and B are "correct" yet
inconsistent — and nobody knows which to trust.

Version numbers in docs go stale. Summaries drift from the source text. Exported images drift from
the model. Double-entry ledgers desync the moment an object changes hands. **All of these are one
disease: truth was carried into a second place.** Reference-First does not fight the drift; it
*makes drift structurally impossible* — the second copy never exists, so there is nothing to desync.

> Evidence (Benxiang, double-entry): custody was recorded in both the character's `carries` and the
> item's `holder`; the moment the item changed hands, the two sides disagreed. Fix: delete the
> character side, derive it from the item side — truth in one place, the other is a reference.
> The protocol forbids double-entry outright. **Double-entry ledgers are the #1 source of state rot.**

## §2 · The five properties of a trusted reference

"Reference" here does not mean any pointer — it means a **Trusted Reference**, which counts only if
all five hold:

| # | Property | Meaning | Violation |
|---|---|---|---|
| 1 | **Minimal** | The reference is orders of magnitude smaller than the referent | stuffing a whole manual into a stub |
| 2 | **Stable** | The referent changes; the reference does not | the reference embeds mutable content |
| 3 | **Resolvable** | At use-time it resolves to current truth via a registry/address | a reference with no resolver |
| 4 | **Fresh** | Resolution is version / watermark / fingerprint-checked | you got the truth, but don't know which version |
| 5 | **Single source** | Truth is stored once; references never duplicate it | truth stored in both A and B |

Missing 1 → you carried content, not an address. Missing 2 → the reference dies the moment truth
moves. Missing 3 → dead link. Missing 4 → you resolve to the wrong version. Missing 5 → double-entry.
**A reference is trustworthy only when all five hold.**

## §3 · Anti-patterns (the everyday ones)

| Anti-pattern | Property violated |
|---|---|
| Hard-coding a version number in a doc | 1 (carried content) · 4 (necessarily stale) |
| Editing a projection as if it were the source (PDF/screenshot/summary) | 2 · 5 (source is not what you touch) |
| Double-entry ledger (one fact in two places) | 5 |
| Preloading all schemas/actions into context (40 KB handed to an agent) | 1 (fetch one on demand instead) |
| Specifying a rule twice, in docs and in code | 2 · 5 (docs inevitably lag the implementation) |
| Storing a value that could be derived | 5 (derive it instead) |

> Of these, "double-entry ledger" is already detected by `diagnose` but **not yet pinned by a
> conformance vector** (conformance §5, gap #1) — so per §6 below, it still counts as
> implementation freedom. Adding the vector is follow-up work.

## §4 · The three protocols and the four stubs are all instances of it

One mechanism at different scales — what it points to, who resolves it, what keeps it fresh:

| Reference | Points to | Resolver | Freshness check | Scale |
|---|---|---|---|---|
| Origin object ID + `depends_on` | object state | origin CLI / MCP | `seq` watermark | content |
| Origin semantic transaction (Flint) | large payloads | commit compiler | validation / vector-set version | content |
| ActionParity action name | action schema + executor | open365 registry | ActionParity version | action |
| Origin Environment fingerprint | a whole machine's state | (future env-git) | SHA-256 layered hash | environment |
| uenv stub | the environment-check workflow | `uenv doctor --agent` | `CARGO_PKG_VERSION` | onboarding |
| CLAUDE.md pointer | this machine's truth | `uenv doctor` + `llms.txt` | nothing hard-coded at runtime | onboarding |

The Benxiang manifesto's skeleton — "save the origin, project on demand", "projection ⇏ unique
origin", "AI ships transactions, not final states" — is Reference-First stated at the scale of
digital artifacts. The four-layer stub system (machine → project → protocol → action) is its
smallest instance at the scale of onboarding: the stub only points; truth is fetched on demand and
pinned to a version.

## §5 · Relation to existing principles

Reference-First is not a new invention; it recognizes that principles already written into the
protocols are one thing:

- Design principle #6 **derive, don't store** — "never store what can be derived": Reference-First
  applied to state.
- Design principle #7 **IDs need a normalization layer** — models failing to write a full ID means
  references must be reliably resolvable.
- The **Flint rule** — "don't re-emit large payloads; reference object IDs; let the runtime bind the
  real content": Reference-First on the output side.

These three were already in the protocol. Reference-First generalizes them **to every design
decision** — not just state and output, but docs, schemas, schema preloading, and onboarding.

## §6 · How to use it (the four daily questions)

For every state/field/content a new design introduces, answer four questions; **if you can't answer
one, the design isn't thought through**:

> ① Who is the single source of truth?
> ② Where does the reference live? (don't copy truth elsewhere)
> ③ Who resolves it? (how do you get current truth at use-time)
> ④ What keeps it fresh? (version / watermark / fingerprint)

Day to day:
- **Design review** — `CONTRIBUTING.md` hard rule #6 turns the four questions into a pre-commit check.
- **Decision records** — every pending decision in uenv's `DECISIONS.md` passes this standing question first.
- **Protocol promises** — Reference-First guarantees only what is checkable: what can be written as a
  vector/validator counts; everything else is honestly marked "not pinned".
- **Onboarding** — every new tool/protocol ships with a stub (minimal, points only, version-pinned)
  so a stranger agent fetches truth on demand.

---

> Once, humans compressed the world into documents for computers.
> Next, AI understands the world's origin directly, then generates the projections humans need.
> **Everything is a reference; truth is resolved at runtime.**
