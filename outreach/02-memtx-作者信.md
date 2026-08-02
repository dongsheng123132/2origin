# To the MemTX authors · Email draft

**Target**: authors of *MemTX: Transactional Belief Commit for Stateful Agent Memory* (arXiv 2607.23929, v2 2026-07-28)
**Subject**: `MemTX as a protocol layer — an engineering attempt, and two questions`
**Status**: draft, not sent

---

Dear MemTX authors,

I read MemTX closely while drafting an open protocol called **Benxiang** (本象, "origin-image"), and I want to flag an unusual degree of convergence: I had independently specified a write-back model with staged transactions, validate-then-commit, per-record evidence and provenance, and explicit assertions the validator must re-check. Your paper formalizes what I had only sketched — snapshot isolation and typed cascading repair in particular are things my draft lacked.

Two questions I'd genuinely like your view on:

1. **Does the transactional model survive contact with non-factual domains?** My first target is long-form fiction: a million-word novel where character state, timeline and unresolved plot threads must stay consistent across hundreds of chapters. Belief revision there has a wrinkle — retracting a fact may require *rewriting prose*, not just repairing downstream records. Did you consider domains where the cascade crosses into unstructured content?

2. **Is there a validation gap we should be measuring?** We're designing a write-side benchmark, because every mainstream memory benchmark (LoCoMo, LongMemEval, LifeBench) evaluates read-side QA only — none tests whether the agent's *state after writing* is correct. We plan a metric for exactly that: field-level accuracy of the system's world state against ground truth, plus evidence-traceability rate. If MemTX has an internal evaluation for commit correctness, we'd rather adopt your definition than invent a competing one.

To be clear about where we stand: Benxiang is currently a specification draft with no running implementation. I'm not announcing a product — I'm trying to build the engineering artifact your protocol implies, and would rather do it in dialogue than in parallel. Any correction of my reading of your paper is welcome, and MemTX will be cited as prior art regardless.

Best regards,
（署名与联系方式待填）
