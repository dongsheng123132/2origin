# Contributing to Benxiang

> [中文原文](CONTRIBUTING.md)

**The contribution we want most is not a feature. It is a refutation.**

Everything this project claims rests on a set of checkable numbers. If a number is wrong, the sooner
we know the better — the record of seven self-caught incidents is in
[results-log.md](benchmark/shadowbench-w/results-log.md), and we do not assume there is no eighth.

**The seventh is worth reading on its own.** The first six were the *instrument* lying: concurrent
overwrites, spec drift, corpus leakage, an unfingerprinted scorer, results clobbered by a same-named
file, the wrong answer key. Every one of those can be fixed with a guardrail. The seventh had no
instrument failure at all — the scorer, the answer key, the fingerprints and the result files were
all correct. What was wrong was reading an n=1 result as a conclusion.
**A flattering n=1 result is exactly as untrustworthy as an unflattering one.**

---

## 1. Reproduce (most valuable)

Every raw result is committed (`benchmark/shadowbench-w/results/`), each carrying its own
provenance: wall-clock time, pid, command line, `gitCommit`, the spec fingerprint `specHash` and the
scorer fingerprint `judgeHash`. **Any number should be traceable back to which version of the spec
and which version of the scorer produced it.**

Run the whole pipeline at zero cost first (no API spend):

```bash
npm run verify                          # everything: 81 + CAD 44 + law 95 + MCP 18 + conformance 68 + mutation 13/13
cd benchmark/shadowbench-w
node eval/selftest.mjs                  # the scorer's own tests: who validates the validator
node run.mjs --provider stub            # full-pipeline smoke run
node eval/rescore.mjs                   # re-score every stored result under the current rules
node eval/rescore.mjs --task-m          # same, M tier
```

A real experiment (needs API access):

```bash
node run.mjs --provider bailian --task continuation-m.json --repeat 10
```

**If your re-score disagrees with `results-log.md`, that is a bug — please open an issue.**
Attach the `rescore` output and the `specHash` / `judgeHash` from your machine.

## 2. Challenges we specifically want

| Direction | What to actually do |
|---|---|
| **A different model** | The biggest gap. Cross-model coverage is currently qwen (n=10–11) and deepseek (Benxiang arm mid-run; control arms at n=10 / n=7). A third model is valuable — **especially a result where it does not work** |
| **Attack the scorer** | Construct prose that fools `eval/ced.mjs`: a real violation it cannot see, or a non-violation it flags. Add the sample to `eval/fixtures/ced-selftest.json` and open a PR |
| **A different corpus** | The current world is constructed (ground truth by construction). Rebuild against a different world spec and see whether the conclusions depend on this particular corpus |
| **A fourth dialect** | The three existing dialects (CAD drawings, court judgments, project memory) together added 4 lines to the core. **Bring your own domain — if it also needs no core changes, that claim has finally been checked by someone other than us** |
| **A second implementation** | The 68 conformance vectors are data, not code; an adapter of a few dozen lines is enough to self-certify ([entry point](spec/conformance/README.en.md)). **A genuine third-party implementation is the single thing this project wants most** — the two that exist share an author and therefore cannot show that the spec alone is sufficient |
| **Criticise the metric** | W3 scores field-by-field, which charges "clung to a stale value" and "invented something from nothing" the same penalty. Is that granularity defensible? |

## 3. Hard rules

These were paid for. Please respect them:

1. **Never silently overwrite a result file.** If a same-named result exists, error out and use
   `--rep-offset` to continue the numbering. *(Incident 5: an M-tier single run ate the S-tier file
   of the same name; `results/` was not in git at the time, so the overwrite was unrecoverable.)*
2. **Change the scorer and you must re-score.** When scoring logic changes, scores move while the
   spec fingerprint stays put — `judgeHash` exists precisely for this. Run `rescore` before placing
   results from different batches side by side. *(Incident 4)*
3. **Pass the answer key explicitly; never through an environment variable.**
   `scoreW3(result, task)`. A missing argument raises; a missing environment variable quietly falls
   back to a default. *(Incident 6: the scorer graded M-tier answers against the S-tier key and
   marked correct answers wrong.)*
4. **Add the fixture before changing the scorer.** Make the test red in
   `eval/fixtures/ced-selftest.json` first, then make it green. Include both a true-violation sample
   and a false-positive sample.
5. **Do not edit scorer code while an experiment is running.** A running process uses the version it
   loaded at start, so the data it finishes with will not have the semantics you think it does.

## 4. Code style

- Comments explain **why**, not what. Especially where something looks simplifiable but is not —
  write down which hole it fell into.
- Comments and documentation are primarily Chinese. English entry points:
  [README.en.md](README.en.md) · [MANIFESTO.en.md](MANIFESTO.en.md) ·
  [protocol spec](docs/03-protocol-draft-v0.1.en.md) ·
  [conformance suite](spec/conformance/README.en.md).
  **A PR in English is fine** — do not let the language stop you.
- No build step, no dependencies. Native Node ESM; `node xxx.mjs` runs directly.

## 5. When opening an issue

**Reporting a number that does not add up is far more useful than reporting a missing feature.**

Please attach: the command line, `specHash`, `judgeHash`, your Node version, the provider and the
model name. If the scorer misjudged something, quote the offending sentence directly.

---

> We put seven incidents on the front page because, for a benchmark,
> **the honesty of the instrument is the entire asset.**
> Helping us find the eighth is the most valuable thing you can do here.
