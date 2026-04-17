# Claude Code Brief · Task F · AI 短文生成 Pipeline

> 2026-04-17 · Jamesvd · v3 demo 的最后一公里。C/D/E 把骨架跑通了，但练习 Tab 里的"AI 生成短文"目前是 `TEMPLATE_BANK` mock——同样的词永远生成同样的内容，"AI 个性化"是假的。F 把它替换成真实 LLM 生成链路。

---

## 背景

**当前状态**（E 跑完之后）：
- 用户收藏 5 个词 → 解锁 → 切练习 Tab → 看到"生成中" → 20 秒后看到 2 段 pending
- 但这 2 段的内容是 `listening-practice.js` 第 79 行 `TEMPLATE_BANK` 预写的模板，`pickTemplate(tag)` 永远返回 `bank[0]`
- `buildPractice(words, index, userLevel)` 只是把目标词塞进模板占位符，没有真的 LLM 调用

**PRD 第七章要求的真实流程**：
1. 综合评分（生词本新鲜度 60% + 兴趣 tag 30% + 水平差 10%，interest bonus +100）挑出 3 个目标词
2. 基于目标词 + 用户兴趣 + CEFR 档位生成 Prompt
3. 调 LLM 拿回短文（6-8 行，80-150 词）+ Gist 题 + 翻译 + 生词定义
4. 校验（CEFR 覆盖率、长度、目标词是否都用到、翻译对齐）
5. 通过校验后入 `flipodPracticeState.pendingPractices`

F 把 3-5 步写成真的。

---

## 交付物

1. **后端新端点** `POST /api/practice/generate`（Node.js / 现有服务里加）——接收词+兴趣+CEFR，返回完整 practice JSON
2. **前端改造** `listening-practice.js` 的 `generateBatch` → 调用端点，删掉 `TEMPLATE_BANK` 对真实生成的依赖（mock 保留作为网络失败降级）
3. **Prompt 模板** 以常量形式放在后端，版本号写进 `generationVersion` 字段
4. **校验函数** `validatePractice(json)` 在后端入库前跑一次，失败返回具体错误让前端可 retry
5. **生成日志** `output/logs/practice-gen-YYYYMMDD.jsonl`——每次生成写一行 `{ ts, userId?, targetWords, prompt, responseRaw, validationResult, durationMs }`，用于事后调 Prompt
6. **测试** 至少跑通 3 组不同 CEFR + 不同兴趣 + 不同词的生成，贴在 PR 描述里

---

## 综合评分算法（PRD 第七章 §选词评分）

在后端或前端都可以，建议放前端（能拿到完整 vocab + state），生成端点只接收最终 3 个目标词：

```js
// listening-practice.js 新增
function scoreVocabCandidates(vocab, state, interests, userCefr) {
  const pending = new Set((state.pendingPractices || []).flatMap(p => p.target_words || []));
  const recent = new Set(
    (state.completedPractices || []).slice(-3).flatMap(p => p.target_words || [])
  );
  const cefrOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const userIdx = cefrOrder.indexOf(userCefr) >= 0 ? cefrOrder.indexOf(userCefr) : 2;

  return vocab.map(item => {
    const key = item.word.toLowerCase();
    if (pending.has(key) || recent.has(key)) return { item, score: -1 };

    const ageDays = (Date.now() - (item.savedAt || Date.now())) / 86400000;
    const freshness = Math.max(0.3, 1 - ageDays / 14);  // 14 天外降到 0.3
    const freshScore = 60 * freshness;

    const interestScore = interests.includes(item.tag) ? 30 : 0;

    const itemIdx = cefrOrder.indexOf(item.cefr) >= 0 ? cefrOrder.indexOf(item.cefr) : userIdx;
    const diff = Math.abs(itemIdx - userIdx);
    const levelScore = diff === 0 ? 10 : diff === 1 ? 8 : diff === 2 ? 3 : 0;

    const interestBonus = interests.includes(item.tag) ? 100 : 0;  // 兜底加成

    return { item, score: freshScore + interestScore + levelScore + interestBonus };
  }).filter(x => x.score >= 0).sort((a, b) => b.score - a.score);
}
```

**选词**：`scoreVocabCandidates(...).slice(0, 3).map(x => x.item)`——取 top 3。

---

## Prompt 模板

后端常量，版本化：

```js
// server/practice-generator.js
const PROMPT_VERSION = 'v3.0.0';

const PRACTICE_PROMPT = ({ words, interests, userCefr, topicHint }) => `
You are generating a short English listening-practice passage for a CEFR ${userCefr} learner.
Their saved vocabulary of interest: ${words.map(w => w.word).join(', ')}
Their topic interests: ${interests.join(', ') || 'general'}
Optional topic focus: ${topicHint || 'choose based on target words and interests'}

Requirements:
1. Write a natural 80-150 word passage, 6-8 sentences. It should sound like a real podcast host speaking — contractions, hedges, small asides. NOT textbook English.
2. MUST use all of these target words naturally: ${words.map(w => w.word).join(', ')}. Each target word should appear exactly once.
3. The non-target vocabulary must stay within CEFR ${userCefr} or easier (roughly 85% A1-B1 words, at most 15% at user's own level).
4. No idioms above B2 unless they are the target word.
5. Write a 1-sentence Chinese summary (gist) that captures the main point in 15-25 Chinese characters.
6. Write a line-by-line Chinese translation aligned to each sentence.

Return STRICT JSON, no markdown, no prose outside JSON:
{
  "title": "6-12 character Chinese title",
  "topic_en": "3-5 word English topic label",
  "lines": [
    { "en": "sentence 1", "zh": "中文翻译 1" },
    { "en": "sentence 2", "zh": "中文翻译 2" }
  ],
  "gist_zh": "15-25 character Chinese summary",
  "gist_options_zh": ["正确选项", "干扰项1", "干扰项2"],
  "target_word_contexts": [
    { "word": "target1", "sentence_index": 0, "definition_zh": "中文定义" }
  ]
}
`.trim();
```

**关键约束**：
- 目标词 definition 让 LLM 在上下文里生成，比静态词典贴切
- `gist_options_zh` 三选一，`options[0]` 正确，`options[1-2]` 干扰——Pass 4 Review 用
- 行对齐用 JSON 嵌套结构，**不要按行数文本对齐**（CLAUDE.md 踩坑：按行对齐会错位）
- **不要在 prompt 里做末尾完整性自检**（CLAUDE.md Patch D 失败教训：LLM 对 word-level 边界盲视）——完整性校验放校验函数里 code-level 做

---

## LLM 调用

**CLAUDE.md 强约束**：
- Python 3.9 SSL 不通 → 如果后端是 Python 必须 curl subprocess
- 如果后端是 Node.js 直接用 fetch/axios 都可以
- Azure GPT 用 `max_completion_tokens` 不是 `max_tokens`（400 报错踩过）

**建议**：Node.js 端点里直接 fetch Azure API：

```js
// server/practice-generator.js
async function callLLM(prompt, maxRetries = 2) {
  const url = `${process.env.AZURE_ENDPOINT}/openai/deployments/gpt-5.4/chat/completions?api-version=2024-08-01-preview`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.AZURE_API_KEY,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          max_completion_tokens: 1200,   // 不是 max_tokens
          temperature: 0.7,
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) throw new Error(`LLM ${resp.status}`);
      const data = await resp.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}
```

**超时**：设 30s 总超时；超时返回 503 让前端退到 mock。

---

## 校验函数

入库前必过，失败抛 400 让前端 retry（最多 1 次）：

```js
function validatePractice(json, expected) {
  const errs = [];
  if (!json.lines || !Array.isArray(json.lines)) errs.push('lines missing');
  if (json.lines) {
    const wordCount = json.lines.map(l => l.en).join(' ').split(/\s+/).length;
    if (wordCount < 60 || wordCount > 180) errs.push(`word count ${wordCount} out of 60-180`);
    if (json.lines.length < 5 || json.lines.length > 10) errs.push(`line count ${json.lines.length} out of 5-10`);
  }
  // 目标词必须每个都在文本里出现
  const fullText = json.lines.map(l => l.en).join(' ').toLowerCase();
  expected.target_words.forEach(w => {
    const re = new RegExp(`\\b${w.toLowerCase().replace(/[^a-z]/g, '')}\\b`);
    if (!re.test(fullText)) errs.push(`target word "${w}" not found in text`);
  });
  // 翻译对齐
  json.lines.forEach((l, i) => {
    if (!l.en || !l.zh) errs.push(`line ${i} missing en or zh`);
  });
  // Gist 长度
  if (json.gist_zh && (json.gist_zh.length < 10 || json.gist_zh.length > 30)) {
    errs.push(`gist_zh length ${json.gist_zh.length} out of 10-30`);
  }
  // 末尾完整性 code-level 检查（不靠 LLM 自评）
  const lastLine = json.lines[json.lines.length - 1];
  if (lastLine && !/[.!?"']\s*$/.test(lastLine.en.trim())) {
    errs.push('last line does not end with terminal punctuation');
  }
  return { ok: errs.length === 0, errors: errs };
}
```

**CEFR 覆盖率检查**（可选，如果 `cefr_wordlist.json` + `cefr_overrides.json` 在后端能 load）：
```js
// 非目标词里 CEFR 超过 userCefr + 1 级的比例不能超过 10%
```

---

## 前端改造

`listening-practice.js` 的 `generateBatch` 改成异步调端点：

```js
// 现状
function generateBatch(vocab, state, options) {
  // ...
  var batch = [];
  for (var i = 0; i < requested; i++) {
    batch.push(buildPractice(words, i, userLevel));  // 模板构建
  }
  return batch;
}

// 改为
async function generateBatch(vocab, state, options) {
  options = options || {};
  var requested = Math.min(options.count || BATCH_SIZE, MAX_PENDING - state.pendingPractices.length);
  if (requested <= 0) return [];

  var interests = JSON.parse(localStorage.getItem('flipodInterests') || '[]');
  var userCefr = getUserCefrLevel();

  var scored = scoreVocabCandidates(vocab, state, interests, userCefr);
  if (scored.length < 3) return [];

  var batch = [];
  for (var i = 0; i < requested; i++) {
    var words = scored.slice(i * 3, i * 3 + 3).map(x => x.item);
    if (words.length < 3) break;
    try {
      var practice = await fetchGeneratedPractice(words, interests, userCefr);
      batch.push(practice);
    } catch (e) {
      console.warn('[practice-gen] LLM failed, falling back to template', e);
      batch.push(buildPractice(words, i, userCefr));  // mock 兜底
      track('practice.generation_failed', { reason: e.message, retry_count: 1 });
    }
  }
  return batch;
}

async function fetchGeneratedPractice(words, interests, userCefr) {
  var resp = await fetch('/api/practice/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_words: words,
      interests: interests,
      user_cefr: userCefr,
    }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.json();
}
```

**注意**：`buildPractice` 别删——做失败兜底用。只是 `pickTemplate` 不再是主路径。`TEMPLATE_BANK` 留着当 fallback 内容。

**上层 await 链**：`refreshGeneration` / `triggerInitialGeneration` 原来是同步，现在要 async；确认整条调用链（Tab 切换入口、解锁触发、自动补给）都加 `await` 或 `.then`。

---

## 埋点（对齐 PRD 第十七章）

- 生成开始：`practice.batch_generated.start { trigger, count_requested, target_words[] }`
- 生成结束：`practice.batch_generated { count, reason(unlock/refresh), duration_ms, llm_tokens, fallback_used?(bool) }`
- 生成失败：`practice.generation_failed { reason, retry_count }`

---

## 校验清单

- [ ] `POST /api/practice/generate` 用 curl 手测三组不同 CEFR 输入，返回合法 JSON
- [ ] 目标词 "whenever" + 兴趣 "business" + B1 用户 → 生成的文本确实谈 business，whenever 在文本里恰好用 1 次
- [ ] 校验函数在 LLM 返回缺字段时能准确指出缺什么
- [ ] 前端网络断开，`fetchGeneratedPractice` 失败，`buildPractice` 兜底生效，用户看到的是 mock 内容但 UI 不崩
- [ ] `output/logs/practice-gen-*.jsonl` 每次生成一条，schema 正确
- [ ] 端到端：新用户收藏 5 个词 → 切练习 Tab → 20 秒内看到 2 段真实 AI 生成内容（不是 TEMPLATE_BANK）
- [ ] 同样 5 个词，连续生成两次，两次内容**不同**（随机性证明 LLM 真在跑）
- [ ] `generationVersion` 字段写进 `flipodPracticeState`，值 = `PROMPT_VERSION`

---

## 非目标

- **不做 TTS 预生成**——TTS 仍然在 Pass 1 进入时按需生成（PRD 第七章音频层）。F 只管文本生成
- **不做 Prompt A/B 测试框架**——先跑通一个版本，A/B 放 P1
- **不做跨用户 practice 复用**——P2 的事
- **不改 `data.json` 的 clip 数据**——generation 只写 `flipodPracticeState`
- **不做 Azure 备用模型**——一个 deployment 够用，失败走 mock 兜底

---

## 环境变量要求

`.env.local` 或部署环境里要有：
- `AZURE_ENDPOINT`（现在用 Whisper/GPT 的同一个）
- `AZURE_API_KEY`
- `AZURE_DEPLOYMENT_CHAT=gpt-5.4`

如果已经有 `podcast_agent.py` 在用，直接复用 credentials，不要重新配。

---

## 问题升级

- LLM 调用延迟 > 30 秒稳定复现 → 不 retry，记录后 fallback；评估是否要开流式响应
- 校验失败率 > 30% → 停 PR review，Prompt 需要调，跟 Jamesvd 过一遍 bad case
- 目标词"必须恰好出现 1 次"在某些高频功能词（`even`、`just`）下强制不成立 → 改为"至少出现 1 次"，PR 备注说明
- Azure quota 告急 → 前端加客户端限流（每分钟最多 2 次生成）
- PRD 第七章的"interest tag bonus +100"在实测里让选词永远偏一个 tag → 降到 +50 或做 tag 轮换，PR 备注说明

---

## 和前面任务的关系

- F 不依赖 C（C 的 override 让 CEFR 档位更准，F 的选词评分会自动吃到更准的档位，但没 C 也能跑）
- F 不依赖 D（D 是训练中的行为差异，F 是生成前的内容差异）
- **F 依赖 E**（E 建了 `generateBatch` 的调用上下文——三态入口、解锁触发、Tab 切换）。所以合并顺序 E → F。C/D 可以穿插。

合并完 F 之后，v3 demo 主干全部完工。下一步进 P1 校准精调。
