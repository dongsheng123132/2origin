# To the ConStory-Bench team · Email draft

**Target**: Junjie Li (lij850601@gmail.com), Xinrui Guo (xingu@microsoft.com), Yuhao Wu (wu_yuhao@mymail.sutd.edu.sg), Roy Ka-Wei Lee, Hongzhi Li, Yutao Xie — *Lost in Stories: Consistency Bugs in Long Story Generation by LLMs* (arXiv 2603.05890)
**Subject**: `Adopting your consistency metric, sharing our results, and an arXiv endorsement request`
**Status**: draft, not sent

---

Dear ConStory-Bench authors,

Your finding that multi-step agent systems score *worse* on consistency than strong base models changed how we designed our project. We had assumed structured state management would obviously help; your data says that assumption has to be earned. We wrote a kill criterion into our benchmark: if the structured approach didn't beat a naive-truncation baseline at small scale, we would stop and fix the architecture rather than scale up.

Since then we have results we'd like to share, a metric question, an arXiv endorsement request, and an offer.

**Our results (ShadowBench-W, M-level: 50-chapter ≈95K-character baseline, 5-chapter continuation).** On deepseek-v4-flash, 10 rounds per arm, our Origin IR state layer reaches **100.0% state-writeback accuracy (zero variance)** versus 56.3% for bare tail-truncation and 70.0% for a vector-RAG baseline (permutation test, 20,000 rounds, p < 0.0001). On W1 consistency-error density (EPC, adopting your framing), A3 scores 0.84 vs A0's 2.16. The preprint will be on arXiv shortly.

**Metric question.** We would like to adopt your consistency-error definition exactly (normalization window, 19-subtype weighting, inter-annotator resolution) rather than publish a near-miss variant that fragments comparison. Is the full specification in the paper, or is there a released evaluation script?

**arXiv endorsement request.** Our first arXiv submission will be the ShadowBench-W preprint (category cs.CL, author He Fangsheng / hfshfg). As first-time submitters we need an endorsement from an established author in the domain. If you're willing, we'll send the endorsement request link when we submit — it takes one click on your side. (If you'd prefer not to, no pressure at all.)

**Offer.** Our corpus construction is unusual and may be useful to you: we author a structured world specification first (characters, locations, rules, timeline, planted plot threads, each state change bound to an originating event), then generate prose *from* that specification. Ground truth exists by construction rather than by post-hoc annotation, and deliberately planted contradictions give computable precision/recall for bug detection. We release corpus and world specification under CC0. If a million-word extension is of interest, we'd rather build it to your specification than beside it.

Best regards,
He Fangsheng — hfshfg (Independent Researcher)
Project: 本象协议 / Origin IR — long-form state consistency
（联系方式：hefangsheng@gmail.com / blog.hequbing.com）
