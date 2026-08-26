# Benxiang Protocol · Conformance Test Suite

> Normative document. The key words **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used
> as described in RFC 2119.
>
> [中文原文](README.md) — the Chinese version is the one maintained alongside the vectors;
> if the two ever disagree, **the vectors decide**, and the disagreement is a defect worth an issue.

## 1. Why this suite exists

Before it, this repository could only demonstrate that **one JavaScript implementation** was
self-consistent — `npm run verify` runs that implementation's own tests. Someone writing a second
implementation in Python or Rust had no way to tell whether what they wrote counted. In that state,
"the Benxiang protocol" and "the Benxiang library" are the same thing, and the protocol is just a
carefully worded design document.

The conformance suite draws the line: **the test vectors are data, not code.** They depend on no
host language. Any implementation that provides an adapter of a few dozen lines can run the same
vectors and certify itself. Whether the protocol is real becomes something you check, rather than
something you take on trust.

Current status:

| Implementation | Language | core | full | Adapter |
|---|---|---|---|---|
| Reference | JavaScript | ✅ 79/79 | ✅ 8/8 | [`compiler/conformance-adapter.mjs`](../../compiler/conformance-adapter.mjs) |
| Second | Python 3 | ⚠ 60/79 (19 ops declared unimplemented; unimplemented ≠ passing) | ⊘ not implemented | [`implementations/python/adapter.py`](implementations/python/adapter.py) |

> **Honest boundary on the second implementation:** both implementations were written by the same
> author, with no information isolation between them; and the second implementation covers only part
> of the suite (core 60/79, 19 ops declared unimplemented). What has passed supports the claim that
> **the vectors really are a language-neutral contract**; whether the full semantics stands up
> independently awaits the missing 19 operations, and "anyone can read the spec and get it right"
> awaits a genuine third-party implementation.
> That claim needs a genuine third-party implementation — which does not exist yet.

## 2. Two conformance levels

An implementation **MUST** declare which level it reaches. It **MUST NOT** claim "conformant"
without qualification.

**core — in-memory semantics** (chapters 1–5, 79 cases)
The decision core of the Origin IR: ID normalization, transaction validation, constraint predicates,
folding and the evidence chain, replay. Any implementation that never touches disk (a library, a
WASM module, a server-side middle layer) can reach this level.

**full — package format and persistence** (chapter 6 onward, 8 cases)
The on-disk semantics of an `.origin` package, honouring the three hard rules of §4.2 of the spec:
append-only (never rewrite), no zero-byte write path, and refusal to write when the sequence
watermark does not match.

An implementation that has not implemented an op **MUST** report it honestly as
`{"id":"…","unsupported":true}`. The runner counts *unsupported* as **not passing** — silently
skipping would let the appearance of "there are constraints" hide the fact that "nothing checks
them", which this protocol treats as strictly worse than not implementing the op at all.

```bash
npm run test:conformance                       # reference implementation, all levels
node spec/conformance/run.mjs --level core     # core only
node spec/conformance/run.mjs --level core \
  --adapter "python spec/conformance/implementations/python/adapter.py"
node spec/conformance/run.mjs --json           # machine-readable
```

Exit codes: `0` conformant / `1` non-conformant or partially conformant / `2` usage error.

## 3. The adapter contract

The adapter is the only interface between the protocol and your implementation. It **MUST**:

1. Read one JSON object from stdin:
   ```json
   { "version": 1, "cases": [ { "id": "…", "op": "…", "input": { } } ] }
   ```
2. Write one JSON object to stdout, one result per case, **in any order**:
   ```json
   { "results": [ { "id": "…", "output": { } } ] }
   ```
3. Write **nothing else** to stdout. Logs go to stderr.
4. Exit with code `0`. Per-case failures are reported as `{"id":"…","error":"…"}` and
   **MUST NOT** crash the process — in this protocol an error is a verdict you can return,
   not a crash.

Both reference adapters are under 100 lines and every op forwards directly to the public API;
not one line exists "in order to pass the tests":
[`compiler/conformance-adapter.mjs`](../../compiler/conformance-adapter.mjs) (JS) and
[`implementations/python/adapter.py`](implementations/python/adapter.py) (Python).

### The ops

| op | Level | Input | Output |
|---|---|---|---|
| `normalize` | core | `{ids, transaction}` | `{transaction, changeKeys}` |
| `validate` | core | `{state, constraints, assertions, transaction}` | `{ok, codes, warnings}` |
| `constraints` | core | `{state, stateBefore, constraints}` | `{codes, warnings, ids}` |
| `fold` | core | `{state, changes}` | `{state}` |
| `apply` | core | `{state, transaction, history, by, at}` | `{state, journal}` |
| `replay` | core | `{objects, history, until}` | `{state}` |
| `load` | full | `{objects, history, constraints}` | `{state, ids, seq}` |
| `commit` | full | `{objects, history, constraints, transaction, expectSeq, by, at}` | `{ok, codes, seq, state, objectsUntouched}` |

`codes` and `warnings` are arrays of violation codes and are sorted before comparison —
**emission order is not part of the protocol.** Every other field is compared deeply, as-is.

### Why assertions are expressed as data

In the protocol, an assertion is a **host-registered predicate** (`name → (state) => bool`), and
functions cannot cross a language boundary. The vectors therefore express them as data — a name
mapped to a constraint judgement — which each implementation assembles into its own predicate:

```json
{ "assertions": { "zhao-qi-alive": { "type": "equals", "object": "char:zhao-qi", "field": "alive", "value": true } } }
```

What is under test is the **mechanism** — an unregistered assertion degrades to a warning, while a
registered assertion that does not hold causes rejection — not the content of any particular
assertion. The protocol presumes no specific assertions.

## 4. Vector format

```json
{
  "title": "chapter title",
  "level": "core",
  "rationale": "what this chapter protects, and which real incident it was bought with",
  "cases": [
    {
      "id": "unique id, e.g. validate/unknown-object-rejected",
      "spec": "§6",
      "why": "why this must hold",
      "op": "validate",
      "input": { },
      "expect": { }
    }
  ]
}
```

`expect` is a **subset assertion**: only the keys that are written down are compared, and the rest
are ignored. This keeps new optional fields from invalidating existing vectors wholesale — but the
keys that *are* written down **MUST** match exactly. The runner performs no fuzzy "contains"
matching, because that lets assertions quietly go slack.

When adding a vector, `why` **SHOULD** state what rule it protects, and ideally which real incident
it came from. Every hard rule in this protocol has a provenance; none of them were designed in the
abstract.

## 5. Do the vectors have teeth?

"87 of 87 passing" proves nothing on its own — a suite that only asserts `1 + 1 = 2` also passes
completely. `npm run test:mutation` breaks the reference implementation one promise at a time and
runs both the self-tests and the conformance vectors against each mutant, to see **which of the two
catches it**:

- **caught by both** → the protocol really has pinned that promise down; a different implementation
  cannot quietly drop it
- **caught only by the self-tests** → a **coverage gap in the protocol**: the promise constrains this
  one implementation and nothing else
- **caught by neither** → that code could be broken silently and nobody would know

All 13 mutants are currently caught. Two of them fall into the middle category.

### Known coverage gaps (2)

Listed rather than hidden:

1. **Double-ledger detection** (§1.6, *derive rather than store*) — detecting that the same fact is
   stored in two places and the two disagree after a transfer. Only the reference implementation's
   `diagnose` covers this; no vector pins it. It is a diagnostic capability rather than a decision
   capability, and whether it belongs in the protocol core is undecided.
2. **Prose-against-state checking** (§1.9, *state can be governed, prose cannot*) — no vector pins
   the requirement that the prose-validation hook is actually invoked. The obstacle is that prose
   rules are strongly domain-specific; pinning this down first requires a declarative representation
   for prose rules.

Closing them means either adding vectors under `vectors/`, or explicitly conceding that the
behaviour is implementation freedom. **Until then, any claim that "the Benxiang protocol guarantees"
these two points is false.** The protocol guarantees exactly what the vectors pin down.

## 6. Writing a new implementation

1. Read [`docs/03-protocol-draft-v0.1.en.md`](../../docs/03-protocol-draft-v0.1.en.md) — the
   normative spec text. The vectors under [`vectors/`](vectors/) carry a `why` field per case in
   Chinese, but the `op`, `input` and `expect` structures are language-neutral and are the actual
   contract.
2. Expect roughly the scale of [`implementations/python/benxiang.py`](implementations/python/benxiang.py):
   about 250 lines for core level, zero dependencies.
3. Implement the adapter and run `--level core`.
4. Once green you **MAY** claim "core-level conformant", and **SHOULD** state which version of the
   vector set you ran against.

If a vector and the spec text disagree, **the vector wins — and please open an issue.** The prose
is written for humans, the vectors are what machines judge by; a disagreement between them is itself
a defect that must be fixed.

**A third-party implementation is the single most useful contribution this project can receive.**
Not because it adds a feature, but because it is the only thing that can falsify the claim in §1 —
that the vectors are a real contract and not one author's habits written down twice.
