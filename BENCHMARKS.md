# Narrator model benchmark snapshot

**Export generated:** 29 August 2026.

This is a static export from the maintainer's private, local evaluation project. The evaluator, its source code, and its result database are not published with First Person Tales. The methodology and known limitations are documented here so the numbers can be interpreted without access to that project.

Model availability, provider behavior, latency, and prices can change. All requests represented in this snapshot were made through Venice.

## Main technical leaderboard

This table reproduces the evaluator's main cross-run leaderboard: the latest completed benchmark result for each provider/model pair at the time of export. It measures instruction following and scenario logic, not literary quality.

The states mean:

- `Completed` — the model completed the full comparable workload used for its displayed Score.
- `Unavailable` — the model did not produce a complete comparable run. This includes models that were genuinely unavailable and models manually excluded because responses took impractically long, including excessive reasoning.
- `Stopped by screening` — progressive screening automatically removed the model after too many technical failures put it below the stage cutoff.

Scores are intentionally omitted for `Unavailable` and `Stopped by screening` entries because their partial workloads are not comparable with completed runs.

| Model | State | Deterministic Score | Cost | Average response time | Reasoning tokens |
|---|---|---:|---:|---:|---:|
| `inkling` | Completed | 93.3% (277/297) | $0.4090 | 10,605 ms | — |
| `kimi-k3` | Completed | 89.9% (267/297) | $0.6720 | 12,681 ms | 14,657 |
| `zai-org-glm-5-2` | Completed | 88.2% (262/297) | $0.1554 | 10,117 ms | — |
| `aion-labs-aion-3-0` | Completed | 87.5% (260/297) | $0.2676 | 10,476 ms | 9,678 |
| `venice-uncensored-role-play` | Completed | 86.2% (256/297) | $0.0582 | 4,345 ms | — |
| `deepseek-v4-pro-0813` | Completed | 86.2% (256/297) | $0.1797 | 5,061 ms | 12,668 |
| `qwen3-6-35b-a3b` | Completed | 85.9% (255/297) | $0.1119 | 14,613 ms | — |
| `z-ai-glm-5-3` | Completed | 85.9% (255/297) | $0.3085 | 19,031 ms | 36,444 |
| `minimax-m3-preview` | Completed | 85.2% (253/297) | $0.0400 | 6,071 ms | — |
| `kimi-k2-5` | Completed | 84.5% (251/297) | $0.2370 | 10,879 ms | 48,483 |
| `z-ai-glm-5-3-flash` | Completed | 82.5% (245/297) | $0.0176 | 3,507 ms | 1,987 |
| `deepseek-v4-flash-0731` | Completed | 81.8% (243/297) | $0.0138 | 13,359 ms | 2,938 |
| `venice-uncensored-1-2` | Completed | 81.1% (241/297) | $0.0220 | 3,191 ms | — |
| `deepseek-v4-flash-0731-fast` | Completed | 80.1% (238/297) | $0.0379 | 11,855 ms | 6,000 |
| `kimi-k2-6` | Unavailable | — | $0.0052 | 113,139 ms | — |
| `xiaomi-mimo-v2-5` | Unavailable | — | $0.0104 | 54,024 ms | — |
| `qwen-3-8-max` | Unavailable | — | $0.1046 | 33,051 ms | 18,468 |
| `qwen-3-8-2-4t-a95b` | Unavailable | — | $0.2286 | 13,063 ms | 19,225 |
| `seed-2-1-turbo` | Unavailable | — | $0.1026 | 31,723 ms | 24,033 |
| `e2ee-qwen3-6-27b` | Unavailable | — | $0.1069 | 24,598 ms | — |
| `zai-org-glm-5` | Unavailable | — | $0.0094 | 65,894 ms | — |
| `e2ee-glm-5-1` | Stopped by screening | — | $0.0607 | 14,085 ms | — |
| `gemma-4-uncensored` | Stopped by screening | — | $0.0061 | 4,349 ms | — |
| `aion-labs-aion-3-0-mini` | Stopped by screening | — | $0.0256 | 17,681 ms | 6,025 |
| `olafangensan-glm-4.7-flash-heretic` | Stopped by screening | — | $0.0113 | 20,579 ms | — |
| `zai-org-glm-4.7-flash` | Unavailable | — | $0.0075 | 45,376 ms | — |
| `qwen-3-8-27b` | Unavailable | — | $0.0523 | 73,450 ms | — |
| `zai-org-glm-4.7` | Unavailable | — | $0.0000 | — | — |

Cost is the measured API cost of the specific run represented by that row, not a current price quote. Screened and unavailable models may show a partial cost. Average response time includes provider and network conditions during the run. Reasoning tokens appear only when reported by the provider.

## Experimental prose cross-judge results

These experiments asked language models to score other language models blindly on prose quality, atmosphere, character voice, and suitability as a continuation. Each criterion uses a 1–5 scale.

These results are reference information only. LLM judgments can reflect the judges' own stylistic biases and may not match what a human player finds interesting, natural, or respectful of player agency. The samples are small, and only the three named finalists were compared within each experiment. Results from the two experiments are not combined.

### Comparison A: GLM 5.3 Flash, Aion 3.0, and DeepSeek V4 Flash

**Run date:** 29 August 2026. **Status:** completed.

Eight complete scenario/repetition cohorts were available. Three judge models evaluated each cohort, producing 24 successful blind comparisons. One cohort was skipped because one benchmark response was empty.

| Model | Prose | Atmosphere | Character voice | Continuation | Overall | Best-answer votes |
|---|---:|---:|---:|---:|---:|---:|
| `z-ai-glm-5-3-flash` | 4.58 | 4.54 | 4.17 | 4.33 | 4.41 | 14 |
| `aion-labs-aion-3-0` | 4.42 | 4.67 | 3.96 | 4.42 | 4.36 | 10 |
| `deepseek-v4-flash-0731` | 3.54 | 3.50 | 3.38 | 3.38 | 3.45 | 0 |

### Comparison B: Kimi K3, Aion 3.0, and Inkling

**Started:** 21 August 2026. **Last retry and closure:** 29 August 2026. **Status:** partial; the batch ended as `failed`.

This older experiment planned nine blind comparisons over three representative scenarios. Seven comparisons produced usable scores; two remained unsuccessful after retry. The averages and votes below therefore describe only those seven successful comparisons and carry more uncertainty than Comparison A.

| Model | Prose | Atmosphere | Character voice | Continuation | Overall | Best-answer votes |
|---|---:|---:|---:|---:|---:|---:|
| `kimi-k3` | 4.14 | 4.14 | 3.71 | 3.86 | 3.96 | 4 |
| `aion-labs-aion-3-0` | 4.14 | 4.43 | 3.71 | 4.29 | 4.14 | 2 |
| `inkling` | 3.71 | 4.14 | 3.29 | 2.86 | 3.50 | 1 |

## Technical methodology

The private evaluator used frozen suite v2.0. It contains 12 cases:

- three progressive-screening cases for response contract, player agency, and summary behavior;
- seven core cases for time continuity, state extraction and application, NPC knowledge, branch overrides, and multi-turn consequences;
- two utility cases for improving a player turn and preparing an image prompt.

One core case has three turns, so one repetition makes 14 model requests. Each repetition contains 99 deterministic pass/fail criteria. A completed three-repetition result therefore contains 42 requests and 297 checks. Deterministic Score is the percentage of those checks that passed; it does not grade whether the prose is enjoyable.

Progressive screening evaluates inexpensive early cases first. Models below the stage cutoff are stopped before the remaining paid requests. Complete finalists and later focused runs use the same deterministic criteria.

### Alignment with the current First Person Tales build

The suite was audited against the current TypeScript application on 29 August 2026. Its central narrator rules remain close: third-person narration, the 1000–1600-character target, header and footer contracts, explicit time skips, OOC handling, player-agency limits, NPC knowledge, dialogue attribution, and metric measurements.

> **Development note:** The suite differs slightly from the version currently used by First Person Tales because the game and the evaluator were developed in parallel. As First Person Tales approaches completion, the private evaluator will be synchronized with the current test suite and the relevant models will be reevaluated.

## Maintainer's play-testing observations

These are subjective observations from actual use, kept separate from both the deterministic table and the LLM cross-judge experiments.

- `aion-labs-aion-3-0` has been the most interesting narrator overall and remains the default. Some responses exceed the requested length.
- `inkling` is interesting and fast, but it acts for the player character too often.
- `deepseek-v4-flash-0731` often answers like a task-solving agent, producing prose that feels dry and short on ideas.
- `z-ai-glm-5-3-flash` has not been manually play-tested. Its strong showing in Comparison A is encouraging but remains only LLM-generated reference evidence; its separate technical Score is lower than Aion 3.0's.
- `z-ai-glm-5-3` spends too much time reasoning for this use case. In its measured technical run it averaged 19.0 seconds per response and reported 36,444 reasoning tokens in total.
