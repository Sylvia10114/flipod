# Claude Code Brief · Task F · Prompt + 响应体修订（B17 / B37 / B38 / B40）

> 2026-04-17 · Jamesvd · Task F 合并后 Round 1 QA 发现 4 条问题都是 LLM 响应体缺字段 / 字段不稳定导致——不是前端 bug，是 prompt 要改。本 brief 修订 `server/practice-generator.js` 的 Prompt 模板、响应 schema、校验函数，让新字段稳定落地。前端消费逻辑写在 `CC-BRIEF-addendum-round-1-fixes.md`。

---

## 4 条 bug 对照

| Bug | 现象 | 根因 | 修法 |
|-----|------|------|------|
| B17 | 练习卡片无 category tag | 响应缺 `category` 字段 | 加 `category` 字段，枚举值 |
| B37 | MCQ 选项数 2/3/4 不稳定 | `gist_options_zh` 是 3 选项、题干是 gist 而非 MCQ | 重构为 `mcq {q, options[4], correct, explanation}` |
| B38 | Review 页只有 target words | 响应只有 `target_word_contexts` | 增加 `vocab_in_text[]` 字段 |
| B40 | MCQ 错选无解释 | `mcq.explanation` 没有 | 包含在 B37 的 mcq 结构里 |

---

## 新版响应 Schema（`v3.1.0`）

```json
{
  "title": "6-12 character Chinese title",
  "topic_en": "3-5 word English topic label",
  "category": "business | psychology | science | tech | culture | general",

  "lines": [
    { "en": "sentence 1", "zh": "中文翻译 1" },
    { "en": "sentence 2", "zh": "中文翻译 2" }
  ],

  "gist_zh": "15-25 character Chinese summary",

  "mcq": {
    "q": "What is the main point of this passage?",
    "options": [
      "Option A (English, 8-15 words)",
      "Option B",
      "Option C",
      "Option D"
    ],
    "correct": 0,
    "explanation": "15-40 个中文字，为什么这个答案对"
  },

  "target_word_contexts": [
    {
      "word": "target1",
      "sentence_index": 0,
      "definition_zh": "中文定义",
      "cefr": "B2",
      "ipa": "/ˈtɑːrgɪt/"
    }
  ],

  "vocab_in_text": [
    {
      "word": "monetary",
      "cefr": "B2",
      "zh": "货币的",
      "ipa": "/ˈmʌnɪteri/",
      "sentence_index": 2
    }
  ]
}
```

**关键变化 vs 旧版 `v3.0.0`**：

1. 新增 `category`（枚举）
2. `gist_options_zh` **删除**，并入 `mcq`
3. 新增 `mcq` 对象（题干固定英文、4 选项、`correct` 是 index、必带 `explanation`）
4. 新增 `vocab_in_text`——过滤条件见下
5. `target_word_contexts` 每项补 `cefr` + `ipa`（Review 页 B38 要用）

---

## 新版 Prompt（`PROMPT_VERSION = 'v3.1.0'`）

替换 `server/practice-generator.js` 里的 `PRACTICE_PROMPT` 模板：

```js
const PROMPT_VERSION = 'v3.1.0';

const PRACTICE_PROMPT = ({ words, interests, userCefr, topicHint }) => `
You are generating a short English listening-practice passage for a CEFR ${userCefr} learner.
Target vocabulary (the learner has saved these, must be used in the passage): ${words.map(w => w.word).join(', ')}
Learner interests: ${interests.join(', ') || 'general'}
Optional topic focus: ${topicHint || 'choose based on target words and interests'}

Passage requirements:
1. Natural 80-150 words, 6-8 sentences. Podcast-host tone — contractions, hedges, small asides. NOT textbook English.
2. MUST use every target word naturally: ${words.map(w => w.word).join(', ')}. Each appears exactly once.
3. Non-target vocabulary stays within CEFR ${userCefr} or easier (~85% A1-B1, at most 15% at user level).
4. No idioms above B2 unless a target word is itself an idiom.
5. One-sentence Chinese gist (15-25 characters).
6. Line-by-line Chinese translation aligned to each sentence.

MCQ requirements (tests passage comprehension):
7. Write ONE multiple-choice question in English about the MAIN POINT of the passage.
8. Provide EXACTLY 4 options in English, each 8-15 words, plausibly related to the topic so distractors are not obviously wrong.
9. Exactly ONE option is correct. Record its index (0-3) in the "correct" field.
10. Write a 15-40 character Chinese explanation of WHY the correct option is right (reference specific evidence from the passage).

Category classification:
11. Classify the passage into EXACTLY ONE of: business, psychology, science, tech, culture, general.
12. If the passage fits multiple, pick the most dominant. Only use "general" when none fit.

Additional vocabulary extraction:
13. After writing the passage, scan it and list every word whose CEFR level is >= ${userCefr}, excluding target words themselves. Deduplicate.
14. For each such word, return { word, cefr, zh, ipa, sentence_index }. Use the sentence_index that matches the first sentence where the word appears (0-indexed).
15. Also return cefr + ipa for each target word in target_word_contexts.

Return STRICT JSON, no markdown, no prose outside JSON. Schema:
{
  "title": "<6-12 Chinese chars>",
  "topic_en": "<3-5 English words>",
  "category": "<one of: business|psychology|science|tech|culture|general>",
  "lines": [ { "en": "...", "zh": "..." } ],
  "gist_zh": "<15-25 Chinese chars>",
  "mcq": {
    "q": "<English question>",
    "options": ["<A>", "<B>", "<C>", "<D>"],
    "correct": <0|1|2|3>,
    "explanation": "<15-40 Chinese chars>"
  },
  "target_word_contexts": [
    { "word": "<en>", "sentence_index": <int>, "definition_zh": "<zh>", "cefr": "<A1-C2>", "ipa": "<ipa>" }
  ],
  "vocab_in_text": [
    { "word": "<en>", "cefr": "<A1-C2>", "zh": "<zh>", "ipa": "<ipa>", "sentence_index": <int> }
  ]
}
`.trim();
```

**CLAUDE.md 踩坑提示**：
- **不要在 prompt 里加自检约束**（"自评 completeness high"之类）——LLM 对 word-level 边界盲视，自评无效。完整性校验放校验函数 code-level
- Azure GPT-5.4 用 `max_completion_tokens` 不是 `max_tokens`（已在 F 原 brief 里修过，这里复用）
- JSON 响应用 `response_format: { type: 'json_object' }` 强制

---

## 校验函数更新

`validatePractice(json, expected)` 扩展：

```js
const ALLOWED_CATEGORIES = ['business', 'psychology', 'science', 'tech', 'culture', 'general'];
const CEFR_RANKS = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

function validatePractice(json, expected) {
  const errs = [];

  // === 旧校验（保留） ===
  if (!json.lines || !Array.isArray(json.lines)) errs.push('lines missing');
  if (json.lines) {
    const wc = json.lines.map(l => l.en).join(' ').split(/\s+/).length;
    if (wc < 60 || wc > 180) errs.push(`word count ${wc} out of 60-180`);
    if (json.lines.length < 5 || json.lines.length > 10) errs.push(`line count ${json.lines.length} out of 5-10`);
  }
  const fullText = (json.lines || []).map(l => l.en).join(' ').toLowerCase();
  expected.target_words.forEach(w => {
    const re = new RegExp(`\\b${w.toLowerCase().replace(/[^a-z]/g, '')}\\b`);
    if (!re.test(fullText)) errs.push(`target word "${w}" not found in text`);
  });
  (json.lines || []).forEach((l, i) => {
    if (!l.en || !l.zh) errs.push(`line ${i} missing en or zh`);
  });
  if (json.gist_zh && (json.gist_zh.length < 10 || json.gist_zh.length > 30)) {
    errs.push(`gist_zh length ${json.gist_zh.length} out of 10-30`);
  }
  const lastLine = json.lines && json.lines[json.lines.length - 1];
  if (lastLine && !/[.!?"']\s*$/.test(lastLine.en.trim())) {
    errs.push('last line does not end with terminal punctuation');
  }

  // === 新校验 ===

  // category
  if (!json.category || !ALLOWED_CATEGORIES.includes(json.category)) {
    errs.push(`category "${json.category}" not in allowed set`);
  }

  // mcq
  if (!json.mcq || typeof json.mcq !== 'object') {
    errs.push('mcq missing');
  } else {
    if (!json.mcq.q || typeof json.mcq.q !== 'string') errs.push('mcq.q missing');
    if (!Array.isArray(json.mcq.options) || json.mcq.options.length !== 4) {
      errs.push(`mcq.options must have exactly 4 items, got ${json.mcq.options && json.mcq.options.length}`);
    } else {
      json.mcq.options.forEach((o, i) => {
        if (!o || typeof o !== 'string' || o.length < 10) errs.push(`mcq.options[${i}] too short or empty`);
      });
    }
    if (!Number.isInteger(json.mcq.correct) || json.mcq.correct < 0 || json.mcq.correct > 3) {
      errs.push(`mcq.correct must be int 0-3, got ${json.mcq.correct}`);
    }
    if (!json.mcq.explanation || json.mcq.explanation.length < 10 || json.mcq.explanation.length > 60) {
      errs.push(`mcq.explanation length ${json.mcq.explanation && json.mcq.explanation.length} out of 10-60`);
    }
  }

  // target_word_contexts 每项必须有 cefr + ipa（B38 前端会读）
  (json.target_word_contexts || []).forEach((t, i) => {
    if (!t.cefr || !CEFR_RANKS.hasOwnProperty(t.cefr)) errs.push(`target_word_contexts[${i}].cefr invalid`);
    if (!t.ipa) errs.push(`target_word_contexts[${i}].ipa missing`);
  });

  // vocab_in_text 新字段校验（允许为空数组，但不允许缺失）
  if (!Array.isArray(json.vocab_in_text)) {
    errs.push('vocab_in_text must be an array (can be empty)');
  } else {
    const userRank = CEFR_RANKS[expected.user_cefr] ?? 2;
    const targetWords = new Set(expected.target_words.map(w => w.toLowerCase()));
    json.vocab_in_text.forEach((v, i) => {
      if (!v.word || !v.cefr || !v.zh) {
        errs.push(`vocab_in_text[${i}] missing required field`);
        return;
      }
      // 等级必须 >= 用户等级
      const vrank = CEFR_RANKS[v.cefr];
      if (vrank === undefined || vrank < userRank) {
        errs.push(`vocab_in_text[${i}] "${v.word}" cefr ${v.cefr} < user ${expected.user_cefr}`);
      }
      // 不能是 target word
      if (targetWords.has(v.word.toLowerCase())) {
        errs.push(`vocab_in_text[${i}] "${v.word}" is a target word, should not be here`);
      }
    });
  }

  return { ok: errs.length === 0, errors: errs };
}
```

**调用点**：`expected` 传参里要带 `user_cefr`，以前只传 `target_words`。改 generator 路由里的调用。

---

## `/api/practice/generate` 入参变化

**无需变化**——现有入参 `{ target_words, interests, user_cefr }` 已经够了。`user_cefr` 往下透给 prompt 模板和校验函数即可。

---

## 重试策略

校验失败时 LLM retry 一次。retry 的 prompt 里**加一行错误摘要**，让 LLM 明确知道上次错在哪：

```js
async function generateWithValidation(opts, maxRetries = 2) {
  let lastErrors = [];
  for (let i = 0; i <= maxRetries; i++) {
    const hint = lastErrors.length
      ? `\n\nPrevious attempt failed validation with errors: ${lastErrors.slice(0, 3).join('; ')}. Fix these specifically.`
      : '';
    const prompt = PRACTICE_PROMPT(opts) + hint;
    const json = await callLLM(prompt);
    const { ok, errors } = validatePractice(json, {
      target_words: opts.words.map(w => w.word),
      user_cefr: opts.userCefr,
    });
    if (ok) return json;
    lastErrors = errors;
    console.warn(`[practice-gen] validation failed attempt ${i + 1}:`, errors);
  }
  throw new Error('validation failed after retries: ' + lastErrors.join('; '));
}
```

前端兜底（`CC-BRIEF-addendum-round-1-fixes.md` B16 / B17）保留——LLM 失败时退到 TEMPLATE_BANK mock。

---

## 日志 schema 变更

`output/logs/practice-gen-YYYYMMDD.jsonl` 每行追加字段：

```json
{
  "ts": "2026-04-17T10:32:00Z",
  "target_words": ["..."],
  "user_cefr": "B1",
  "prompt_version": "v3.1.0",
  "llm_duration_ms": 8421,
  "llm_tokens": { "in": 612, "out": 890 },
  "validation_attempts": 1,
  "validation_result": "ok",   // or "failed_after_retries"
  "final_category": "business",
  "final_vocab_in_text_count": 4
}
```

`validation_attempts` 和 `prompt_version` 是新增——方便后续 grep 出"哪些批次跑的是 v3.1.0，多少次 retry 才过"。

---

## 校验（手测）

**单次请求**：

```bash
curl -X POST http://localhost:8080/api/practice/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "target_words": [
      { "word": "monetary", "cefr": "B2", "tag": "business" },
      { "word": "resilience", "cefr": "B2", "tag": "psychology" },
      { "word": "yield", "cefr": "B1", "tag": "business" }
    ],
    "interests": ["business", "psychology"],
    "user_cefr": "B1"
  }' | jq .
```

**验收矩阵**：

- [ ] 响应有 `category`，值在 ALLOWED_CATEGORIES 里
- [ ] `mcq.options` 长度严格 = 4
- [ ] `mcq.correct` 是 0-3 整数
- [ ] `mcq.explanation` 中文 15-40 字
- [ ] `vocab_in_text` 是数组（可空，但通常有 2-6 项）
- [ ] `vocab_in_text` 里每个词 CEFR 都 ≥ 用户等级
- [ ] `vocab_in_text` 里没有 target words
- [ ] `target_word_contexts` 每项有 `cefr` 和 `ipa`
- [ ] 3 次连续生成同一组词，category 稳定，mcq 难度相近
- [ ] 断网 → 前端退到 mock 不崩
- [ ] `practice-gen-*.jsonl` 日志里 `prompt_version = "v3.1.0"` 且 `validation_result = "ok"`

---

## 兼容性

**v3.0.0 遗留数据**：已经写进 `flipodPracticeState.pendingPractices` 的旧格式数据**不删除**。前端消费逻辑（B17 / B37 / B38 / B40）必须能处理两种格式：

```js
// B17 兜底（CC-BRIEF-addendum-round-1-fixes.md 里有 inferCategoryFromWords）
// B37 兜底（normalizeMcq 从 gist_options_zh 迁移）
// B38 兜底（vocab_in_text 不存在就只显示 target words）
// B40 兜底（explanation 不存在就不显示 .fb-exp）
```

旧数据在用户跑完一次就会自然置换为新格式（因为 completed 之后 pending 会继续补给）。不需要单独写迁移脚本。

---

## 非目标

- **不做多题 MCQ**——v3 每段一道题就够
- **不做题型多样化**（填空、排序、听写）——P1 再考虑
- **不做难度动态调节**（根据答题正确率调整）——P1
- **不做 vocab_in_text 的 IPA 自动抓取**——让 LLM 给，给不准也就算了，review 页能用即可
- **不做 prompt A/B**——上一版就讨论过，P1
- **不改已经合并的选词评分**（`scoreVocabCandidates`）——它不受 prompt 变更影响

---

## 问题升级

- `mcq.options` 4 项稳定不了（反复 3 项） → 把要求移到 prompt 最上方重复两遍 + 提高 validation retry 到 3 次
- `vocab_in_text` 持续空数组（LLM 懒得扫描） → 改 prompt 用"First list all words, then check CEFR, then filter"的 chain-of-thought 式指令
- category 始终输出"general" → LLM 分类能力不够，考虑用更便宜的模型做分类（分两阶段调用）或者前端根据 target_word.tag 推断（已在 B17 兜底里）
- `explanation` 被翻成英文 → prompt 强调"in Chinese characters"并给个好例子

---

## 交付

- 1 个 PR `fix/round-1-taskf-prompt`
- 改动文件：`server/practice-generator.js`（prompt 常量 + validate 函数）、`PROMPT_VERSION` 常量从 `v3.0.0` → `v3.1.0`
- PR 描述贴手测 curl 的 jq 输出截图（展开完整响应）
- 跑 3 组不同 CEFR + 不同 tag 组合各 3 次共 9 次生成，全部 validation ok 才合并

---

## 合并顺序

1. **先合本 brief 的 PR**（响应新字段就位）
2. 再合 `CC-BRIEF-addendum-round-1-fixes.md` 的 PR（前端消费新字段）
3. 最后合 `CC-BRIEF-TaskD-rate-injection-correction.md`（独立，顺序无关）

3 个都合完跑 Round 2 QA，没有 regression 即打包推 GitHub → AI 算法团队 RN 重写 → TestFlight。
