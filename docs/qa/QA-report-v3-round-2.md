# Flipod v3 · QA Report · Round 2

> 2026-04-17 · Jamesvd + Claude Cowork
> Scope: Round 1 九条必修 + TaskD CEFR×Pass 矩阵 + 回归锚点
> 结论: **9/9 通过 + TaskD 100% 对齐 brief spec · 打包推 GitHub（Direction A）**

---

## Executive Summary

Round 1 的 9 条打包前必修 bug 全部在代码层修复并验证通过。新增的 TaskD 20 格 CEFR×Pass 速率矩阵已完整实装并与 brief spec 100% 对齐。Round 2 过程中发现并修复了一个更底层的阻塞 bug (feed DEV 过滤残留)，不属于原 9 条但直接决定产品能否正常使用。

**本轮新增发现**:

| # | 类型 | 状态 |
|---|------|------|
| 1 | feed 被 DEV 期硬过滤限制成 3 条 (index.html:3058) | ✅ 本轮修复 |
| 2 | rank API 3s 超时在 tunnel 场景会被砍 (index.html:3153) | ✅ 本轮修复 (放宽到 15s) |
| 3 | priming schema 新版 `{word, zh, cefr}` 缺 IPA 字段 → tooltip 少一行音标 | 🟡 minor gap · 非 blocker · 留给 RN 重写 |

**推 GitHub 决策**: 现状即可推。IPA gap 不影响核心体验（原 B33 是"根本不弹"，现在弹出且有 word/CEFR/zh 三要素），RN 团队可在重写时一并补齐 (CMU dict + LLM fallback)。

---

## 1 · 环境

| 项 | 值 |
|---|---|
| Dev server | `bash scripts/serve.sh`, node on :8080 |
| 访问方式 | 切换到 localhost 直连 (tunnel 的 3s rank API 超时会让 feed 退化到 fallback，虽不影响 clip 数量，但验证不纯净) |
| 数据集 | `data.json`: 76 clips, 62 with priming |
| Mock 用户 | B1, interests=[business, psychology, science], 8 词 vocab |
| 验证方式 | 代码级静态审查 (priming.py / listening-practice.js / dev_server.js / index.html) + data.json 全量扫描 |

---

## 2 · 9/9 必修 bug · 验证通过

### P0 (2)

**B36 / B11 · Priming 选词难度反了**

- 修复点: `priming.py` 选词阈值 `cefr >= user_level + 1`，硬拒 A1/A2
- 数据层验证: `data.json` 全量 170 个 priming 词，CEFR 分布 **B2: 125 / C1: 28 / C2: 17**，**0 条违规**
- 采样 8 个 clip 的 priming 列表全部 ≥ B2：
  - clip[1] 她用鼻子诊断一种病: `dominant (C1), sensitive (B2), scent (B2)`
  - clip[2] 第一支烟和最后一支烟: `huddle (C2), flick (C1)`
  - clip[7] 11 岁那年的嫉妒: `flit (C2), merit (C2), stepfather (B2)`
- Round 1 的 `scroll` (A2) 彻底消失

**B41 · Pass 4 MCQ 未答就可返回列表**

- 修复点: `listening-practice.js:1412` `backDisabled = (mcq && !answered) ? ' disabled title="请先选择一个答案"' : ''`
- mcq 存在且未答时，返回列表按钮为灰态不可点
- 回退路径保留: mcq 字段整体缺失时，按钮恢复可点（兼容 legacy clip）

### P1 (7)

**B16 · 练习 Tab 生成状态无 UI**

- 修复点: `listening-practice.js:1063-1130` 四状态机 `ready / generating / failed / empty`
- FAILED 分支 (line 1116-1124): ⚠️ icon + 错误详情 + 重试按钮，从 `state.lastGenerationError` 读取
- 重试按钮 `data-action="generate"` 走 `_handleGenerate` 重新触发 `/api/practice`

**B17 · 练习卡片缺 category tag**

- 修复点: 服务端 `dev_server.js:266` `PRACTICE_ALLOWED_CATEGORIES` 枚举校验 (business|psychology|science|tech|culture|general)
- 前端 `listening-practice.js:1096` `.lp-cat-tag.lp-cat-{cat}` 右上角渲染
- LLM 漏返 category 时，`resolveCategory` 从 target word tag 推断 fallback

**B18 · 生成中无 skeleton**

- 修复点: `listening-practice.js:1070 _skeletonCardHtml()` + `.sk-spinner` 旋转
- `isGenerating && !hasPending` 时渲染 2 张骨架 + "AI 正在为你生成练习..." 提示
- `isGenerating && hasPending` 时在列表末尾追加 1 张骨架 (tail skeleton)

**B33 · Priming 词点击无反馈**

- 修复点: `index.html:6160` 委托 click handler → `showTooltip()` (line 6100)
- Tooltip 渲染: word + CEFR 徽章 + 中译 + 收藏按钮
- ⚠️ Minor gap: 新 schema 无 IPA 字段，tooltip 少音标行。原 bug 是"根本不弹"，现在弹出且有三要素，RN 重写时补

**B37 · Pass 4 MCQ 选项数不固定**

- 修复点: `dev_server.js:277` 硬校验 `options.length !== 4` 直接报错
- retry-with-hint 机制: 校验失败时把错误信息回传 LLM 重试
- 前端 `listening-practice.js:1367-1504` 固定渲染 4 个 option button

**B38 · Review 遗漏短文里其他高级词**

- 修复点: 服务端 `dev_server.js:307` 新增 `vocab_in_text` 数组 (word/cefr/zh/ipa/sentence_index)，校验每条 ≥ 用户 CEFR 且不与 target_words 重复
- 前端 `listening-practice.js:1344` Review 页把 `target_word_contexts` 和 `vocab_in_text` 合并后统一渲染

**B40 · MCQ 错选无解释**

- 修复点: `dev_server.js:289` `mcq.explanation` 必需字段，长度 10-60 汉字
- 前端 `_applyMcqFeedback` 错选后读取 `practice.mcq.explanation` 展示

---

## 3 · TaskD · CEFR×Pass 速率矩阵

`listening-practice.js:74-86` 实装的 20 格矩阵，与 brief spec 逐格对齐：

| CEFR \ Pass | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| A1 | 0.70 | 0.80 | 0.90 | 0.90 |
| A2 | 0.80 | 0.88 | 0.96 | 1.00 |
| B1 | 0.85 | 0.94 | 1.00 | 1.00 |
| B2 | 0.90 | 1.00 | 1.00 | 1.00 |
| C1 | 1.00 | 1.00 | 1.00 | 1.00 |
| C2 | → 折叠到 C1 | | | |

- `audio.playbackRate = getPassRate(passNum)` · `audio.preservesPitch = true` (`listening-practice.js:872-874`)
- 埋点 `track('tts.played', { passNum, passRate, cefr, clipId })` (`listening-practice.js:1230-1231`)
- Pass 4 约束: 所有 CEFR 档在 Pass 4 均 ≤ 1.00，盲听阶段不加速

---

## 4 · Round 2 本轮额外修复

### 4.1 Feed DEV 残留（blocker · 已修）

`index.html:3057-3058` 教学模块调试期残留代码:

```js
// DEV: 只保留有 questions 的 clip，取前 3 个用于教学测试
clips = clips.filter(c => c.questions && c.questions.length > 0).slice(0, 3);
```

在 v3 架构下 `questions` 字段已废弃 (练习按需生成)，且 `slice(0, 3)` 把 feed 砍成 3 条。症状: 打开 feed 永远只看到 3 条 clip 且都没有 priming (撞上 clip[0] 跳过 + 2 条无 priming 的巧合)。

修复后: `console.log('Feed clips:', clips.length)` 输出 76。

### 4.2 Rank API 超时（minor · 已修）

`index.html:3153` 从 3s 放宽到 15s:

```js
const timeout = setTimeout(() => controller.abort(), 15000);
```

Tunnel + Azure GPT 排序在 3s 内经常 abort，feed 会退化到 `fallback` 状态（不影响 clip 数量，但排序未经个性化）。15s 对本地和 tunnel 场景都够用。

---

## 5 · 待补 (非 blocker · RN 重写时处理)

| # | 项 | 处理建议 |
|---|---|---|
| 1 | priming schema 补 IPA | `priming.py` 加 CMU dict + LLM fallback，schema → `{word, zh, cefr, ipa}` |
| 2 | B33 tooltip IPA 行在新 schema 上永远空 | 依赖 (1)，先 schema 后前端 |
| 3 | 4 条 Round 1 ❓ 待验证项 | TF 内测期间收集真实用户行为数据 |
| 4 | 14 条 visual polish (Round 1 handoff backup) | RN 团队设计阶段参考 |

---

## 6 · Sign-off

- 代码层 9/9 必修 bug + TaskD 矩阵 + 2 条本轮发现 blocker 全部修复
- data.json 层 priming 选词验证 170/170 通过
- 仅剩 1 个 minor gap (IPA)，不阻塞打包

**推 GitHub Direction A**: 独立仓 `flipod.git` + docs/ 下 feature-specs (prd / brief / handoff / qa) → AI 算法团队接手 RN 重写 → TestFlight 内测。
