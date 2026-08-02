# To the ConStory-Bench team · Email draft

**Target**: Junjie Li, Xinrui Guo, Yuhao Wu, Roy Ka-Wei Lee, Hongzhi Li, Yutao Xie — *Lost in Stories: Consistency Bugs in Long Story Generation by LLMs* (arXiv 2603.05890)
**Subject**: `Adopting your consistency metric at 1M-word scale — a question and an offer`
**Status**: draft, not sent

---

Dear ConStory-Bench authors,

Your finding that multi-step agent systems score *worse* on consistency than strong base models changed how we're designing our project. We had assumed structured state management would obviously help; your data says that assumption has to be earned. We've since written a kill criterion into our benchmark: if our structured approach doesn't beat a naive-truncation baseline at small scale, we stop and fix the architecture rather than scaling up.

**One question.** The abstract page doesn't give the precise definition of your consistency-error metric (normalization window, how the 19 subtypes are weighted, and how inter-annotator disagreement is resolved). We would like to adopt your definition exactly rather than publish a near-miss variant that fragments comparison. Is the full specification in the paper, or is there a released evaluation script?

**One offer.** We're building a long-form consistency testbed and the corpus construction is unusual in a way that may be useful to you: instead of annotating an existing novel, we author a structured world specification first (characters, locations, rules, timeline, planted plot threads, each state change bound to an originating event), then generate prose *from* that specification. Ground truth therefore exists by construction rather than by post-hoc annotation, and deliberately planted contradictions give computable precision/recall for bug detection.

We intend to release the corpus and world specification under CC0, scaling from 30k to 1M words — well beyond the 8k–10k range we understand ConStory-Bench currently covers. If a million-word extension is of interest to your group, we'd rather build it to your specification than beside it. If you'd prefer we stay out of that space, tell us and we will.

Full disclosure: our project is a specification draft with no running code yet, so this is an offer of future data and labor, not a finished result.

Best regards,
（署名与联系方式待填）
