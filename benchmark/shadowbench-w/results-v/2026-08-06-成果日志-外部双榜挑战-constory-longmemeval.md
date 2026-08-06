# 成果日志：外部双榜挑战（2026-08-06）

> 挑战原则：只用最便宜的 deepseek-v4-flash 生成（虾盘云 api.u-claw.org.cn/v1），
> 判分用 qwen-plus / deepseek-v4-flash（便宜档）。所有数字可复现（命令见下文）。

## 1. ConStory-Bench（ACL 2026，《Lost in Stories》，arXiv 2603.05890）

- 仓库：Picrew/ConStory-Bench；数据：jayden8888/ConStory-Bench prompts.parquet（2000 条）
- 样本：id 0-120 子集，两批（0-60 试点 + 60-120 本轮）
- **n=112 合并 CED = 0.227**（106 条有效，avg 5,476 词/篇）
  - 旧批 0-60：CED 0.254（52 条）※ 早期试点记录 0.52 为部分数据口径，已用官方 metrics 重算
  - 新批 60-120：CED 0.201（54 条）
  - 细分（合并）：character 0.034 / factual 0.121 / narrative 0 / timeline 0.086 / world 0
  - 任务分布：completion 39 / expansion 32 / continuation 29 / generation 12
- 官方榜参考（leaderboard-data.js，judge 配置未知）：GPT-5-Reasoning 0.113 / Gemini-2.5-Pro
  0.305 / Claude-Sonnet-4.5 0.520 / GLM-4.6 0.528 / DeepSeek-V3.2-Exp 0.541
- **定位（judge 口径差异 caveat 必带）**：0.227 压过官方榜全部模型，仅次于 GPT-5-Reasoning(0.113)
- 产物：data/stories/deepseek-v4-flash_60-120.parquet（60 条，984KB）；
  evaluations/judge_deepseek-v4-flash_0_end_20260806_110733.csv（60 条判分）；
  evaluations/merged_n112_final.csv（合并 112 条）

## 2. LongMemEval（ICLR 2025，arXiv 2410.10813）

- 仓库：xiaowu0162/LongMemEval（克隆于 C:\Users\ZhuanZ\longmem-eval，已修两个坑：
  model2maxlength 加 deepseek-v4-flash=131072；tokenizer 走 tiktoken o200k 免 transformers）
- 数据：HF xiaowu0162/longmemeval-cleaned（oracle 15MB / s_cleaned 277MB）
- **oracle 档全量 500 题 Accuracy = 0.9155**（qwen-plus 判分）
  - single-session-assistant 1.000 (56) / single-session-user 0.985 (67) /
    knowledge-update 0.936 (78) / temporal-reasoning 0.917 (133) /
    multi-session 0.872 (133) / single-session-preference 0.733 (30)
  - 30 条空答案（max_tokens=500 被推理吃光）→ max_tokens=2000 补跑修好 21 条，剩 9 条空（1.8%）
- 官方论文对照（Table 2，oracle 档 QA accuracy）：GPT-4o 无 CoN 0.870 / GPT-4o+CoN 0.924 /
  Llama-3.1-70B 0.744 / Llama-3.1-8B 0.710 / Phi-3.5-Mini 0.660
- **定位（判分器差异 caveat 必带）**：0.9155 压过论文全部无 CoN 模型（含 GPT-4o 0.870），
  仅低于 GPT-4o+Chain-of-Note（0.924）0.85pt
- **S 档抽测 20 题**（115k tokens 历史，orig-session 全喂）：产物 20 条有答案；
  prompt tokens 2,302,850（≈115k/题，与官方口径一致）
  - **qwen-plus 判分 Accuracy = 0.85**（17/20；multi-session 2/5 0.4，其余类型全 1.0）
  - 官方 S 档对照（Table 2，QA accuracy）：GPT-4o 0.606 / Llama-3.1-70B 0.334 /
    GPT-4o 无 CoN（oracle 档）0.870 —— S 档抽测 0.85 与官方 oracle 档 GPT-4o 相当（0.85 vs 0.870），
    高于官方 S 档 GPT-4o 0.606，**% Drop 优于官方口径**（官方 oracle→S 掉 0.26，我们 oracle→S 掉 0.066）
  - ⚠️ **判分器教训：deepseek-v4-flash 判同题 Accuracy 0.0（20 全判 no），不可用作 LongMemEval 判分器**
    （qwen-plus 同题 0.85）——判分一律用 qwen-plus
  - ⚠️ 修 `run-eval.sh` API key 写死 `***` bug（`$KEY` 变量定义后未使用，导致 401 无限重试，产物恒 0B）
- 产物：outputs/hyp_oracle_500.jsonl（497 条）+ 补跑合并；outputs/s_subset20*.jsonl；
  判分结果 `.eval-results-qwen-plus`（0.85）与 `.eval-results-deepseek-v4-flash`（0.0，作废）

## 3. 成本（估算）

- ConStory 60 条生成 + judge：约 ¥10-20
- LongMemEval oracle 500 题生成（~2.5M tokens）+ 补跑 30 条 + 判分 500：约 ¥8-15
- S 版 20 题（2.3M prompt tokens）：约 ¥5
- 合计约 ¥25-40（deepseek-v4-flash + qwen-plus 最便宜档）

## 4. 下一步

- [x] S 版判分完成 → **0.85（qwen-plus）**，对照官方 S 档（GPT-4o 0.606 / Llama-70B 0.334）见上文
- [ ] ConStory 全量 2000 条（约 3.5 天 + ¥300-500）——待用户拍板
- [ ] 成绩贴官方 issue（ConStory issue #1 已有 n=52 评论，更新 n=112）
- [ ] LongMemEval 官方是否接受外部提交（看 repo 的 CONTRIBUTING/issue 惯例）
- [ ] S 档 20 题抽测样本量小（multi-session 只有 5 题）——若正式引用，宜补到 n≥30 或说明抽测性质
