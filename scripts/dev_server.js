/**
 * Local dev server — static files with Range support + /api/rank proxy to Azure GPT.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 8080;
// Accept both AZURE_* and AZURE_OPENAI_* naming (existing scripts vary).
const AZURE_ENDPOINT = (process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT
  || 'https://us-east-02-gpt-01.openai.azure.com').replace(/\/$/, '');
const AZURE_API_KEY = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
const GPT_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.GPT_DEPLOYMENT || 'gpt-5.4-global-01';
const GPT_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || process.env.GPT_API_VERSION || '2024-10-21';

const CLIP_META = [
  { id: 0, title: "穿着巧克力衬衫的70岁老人", tag: "business", source: "Planet Money", duration: 85, difficulty: "easy" },
  { id: 1, title: "她用鼻子诊断了一种病", tag: "science", source: "TED Talks Daily", duration: 72, difficulty: "easy" },
  { id: 2, title: "第一支烟和最后一支烟", tag: "story", source: "The Moth", duration: 76, difficulty: "easy" },
  { id: 3, title: "被债务淹没的体面人生", tag: "psychology", source: "Hidden Brain", duration: 89, difficulty: "medium" },
  { id: 4, title: "他咬了一口，吐了出来", tag: "science", source: "Planet Money", duration: 90, difficulty: "easy" },
  { id: 5, title: "1928年奥运会，女性第一次站上跑道", tag: "history", source: "NPR", duration: 64, difficulty: "easy" },
  { id: 6, title: "波本酒局内幕", tag: "business", source: "Freakonomics Radio", duration: 81, difficulty: "easy" },
  { id: 7, title: "11岁那年的嫉妒", tag: "story", source: "This American Life", duration: 96, difficulty: "easy" },
  { id: 8, title: "波本为何非等不可？", tag: "business", source: "Freakonomics Radio", duration: 93, difficulty: "medium" },
  { id: 9, title: "内容到底怎样才能真正带来收入？", tag: "business", source: "Business Storytelling", duration: 89, difficulty: "easy" },
  { id: 10, title: "AI写内容为什么总像废话？", tag: "tech", source: "Business Storytelling", duration: 115, difficulty: "medium" },
  { id: 11, title: "100年前的怀表变成今天的美国制造腕表", tag: "business", source: "Business Storytelling", duration: 87, difficulty: "medium" },
  { id: 12, title: "没人要的老怀表，为什么成了他们的宝藏？", tag: "story", source: "Business Storytelling", duration: 106, difficulty: "easy" },
  { id: 13, title: "一个新SDK，为什么让他觉得工作方式被彻底改变？", tag: "tech", source: "Startup Stories", duration: 91, difficulty: "medium" },
  { id: 14, title: "检察官为什么和黑帮头目一起吃早餐？", tag: "history", source: "History That Doesn't Suck", duration: 101, difficulty: "hard" },
  { id: 15, title: "新抗生素上市了，公司却还是失败了？", tag: "story", source: "BBC Discovery", duration: 54, difficulty: "medium" },
  { id: 16, title: "美军'靴子落地'伊朗？", tag: "society", source: "Stuff They Don't Want You To Know", duration: 95, difficulty: "medium" },
  { id: 17, title: "你最爱的怪物，竟引出炼金术真相？", tag: "culture", source: "Stuff They Don't Want You To Know", duration: 96, difficulty: "medium" },
  { id: 18, title: "大型强子对撞机，真的把铅变成了金？", tag: "science", source: "Stuff They Don't Want You To Know", duration: 85, difficulty: "medium" },
  { id: 19, title: "一口气听懂本周最重要的AI大新闻", tag: "tech", source: "The AI Podcast", duration: 73, difficulty: "medium" },
  { id: 20, title: "Google这次开源，为什么可能改变AI格局？", tag: "tech", source: "The AI Podcast", duration: 102, difficulty: "hard" },
  { id: 21, title: "强到不能公开？这个AI先被拿去找漏洞", tag: "tech", source: "The AI Podcast", duration: 65, difficulty: "medium" },
];

function buildPrompt(userProfile) {
  const available = CLIP_META
    .filter(c => !(userProfile.listened || []).includes(c.id))
    .map(c => `  [${c.id}] "${c.title}" | ${c.tag} | ${c.source} | ${c.duration}s | ${c.difficulty}`)
    .join('\n');

  return `You are the recommendation engine for an AI-native English listening app. Your job is to rank podcast clips for this specific user.

USER PROFILE:
- CEFR level: ${userProfile.level || 'B1'}
- Interests: ${(userProfile.interests || []).join(', ') || 'not specified'}
- Clips already listened: ${(userProfile.listened || []).length} clips
- Clips skipped: ${JSON.stringify(userProfile.skipped || [])}
- Words clicked (looked up): ${JSON.stringify(userProfile.vocab_clicked || [])}
- Session duration so far: ${userProfile.session_duration || 0}s

AVAILABLE CLIPS:
${available}

RANKING RULES:
1. Prioritize clips matching user interests, but mix in 1-2 clips from other topics every 5 clips.
2. Match difficulty to CEFR level: A1-A2 → easy, B1 → easy/medium, B2 → medium/hard, C1-C2 → hard.
3. If user skipped clips of a certain topic, reduce that topic's priority.
4. If user clicked many words, they might be struggling — lean toward easier clips.
5. Vary sources — don't serve 3 clips from the same podcast in a row.
6. Keep the first 1-2 clips engaging and accessible.

Return a JSON array of objects, each with:
- "id": clip id (number)
- "reason": one sentence in Chinese explaining why (concise, like "难度适中，换个科学话题放松一下")

Return ONLY the JSON array, no markdown, no explanation. Order from most recommended to least.`;
}

function handleRankApi(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let userProfile;
    try {
      userProfile = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    if (!AZURE_API_KEY) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'AZURE_API_KEY not set — AI ranking disabled' }));
      return;
    }

    const prompt = buildPrompt(userProfile);
    const gptBody = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 2000,
      temperature: 0.7,
    });

    const apiUrl = new url.URL(
      `/openai/deployments/${GPT_DEPLOYMENT}/chat/completions?api-version=${GPT_API_VERSION}`,
      AZURE_ENDPOINT
    );

    const gptReq = https.request({
      hostname: apiUrl.hostname,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_API_KEY,
        'Content-Length': Buffer.byteLength(gptBody),
      },
    }, gptRes => {
      let data = '';
      gptRes.on('data', chunk => { data += chunk; });
      gptRes.on('end', () => {
        const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
        if (gptRes.statusCode !== 200) {
          res.writeHead(502, corsHeaders);
          res.end(JSON.stringify({ error: 'GPT API error', status: gptRes.statusCode, detail: data }));
          return;
        }
        try {
          const gptData = JSON.parse(data);
          let content = gptData.choices?.[0]?.message?.content || '[]';
          let feed;
          try {
            feed = JSON.parse(content);
          } catch {
            const m = content.match(/\[[\s\S]*\]/);
            feed = m ? JSON.parse(m[0]) : [];
          }
          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify({ feed, clip_count: CLIP_META.length }));
        } catch (e) {
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    });

    gptReq.on('error', e => {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    });

    gptReq.write(gptBody);
    gptReq.end();
  });
}

/* ═══════════════════════════════════════════
 * Task F: AI 短文生成 pipeline
 * POST /api/practice/generate
 * Body: { target_words: [{word, cefr, tag?}...], interests: [...], user_cefr: 'B1' }
 * Returns: practice JSON conforming to listening-practice.js shape, OR 4xx/5xx.
 * ═══════════════════════════════════════════ */

const PRACTICE_PROMPT_VERSION = 'v3.1.0';
const PRACTICE_GEN_TIMEOUT_MS = 30000;
const PRACTICE_ALLOWED_CATEGORIES = ['business', 'psychology', 'science', 'tech', 'culture', 'general'];
const PRACTICE_CEFR_RANKS = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };
const PRACTICE_MAX_RETRIES = 2;

function buildPracticePrompt({ words, interests, userCefr, topicHint, retryHint }) {
  const wordList = words.map(w => w.word).join(', ');
  const retrySuffix = retryHint
    ? `\n\nPrevious attempt failed validation: ${retryHint}. Fix these specifically on this attempt.`
    : '';
  return `You are generating a short English listening-practice passage for a CEFR ${userCefr} learner.
Target vocabulary (the learner has saved these, must be used in the passage): ${wordList}
Learner interests: ${(interests || []).join(', ') || 'general'}
Optional topic focus: ${topicHint || 'choose based on target words and interests'}

Passage requirements:
1. Natural 80-150 words, 6-8 sentences. Podcast-host tone — contractions, hedges, small asides. NOT textbook English.
2. MUST use every target word naturally: ${wordList}. Each appears exactly once.
3. Non-target vocabulary stays within CEFR ${userCefr} or easier (~85% A1-B1, at most 15% at user level).
4. No idioms above B2 unless a target word is itself an idiom.
5. One-sentence Chinese gist (15-25 characters).
6. Line-by-line Chinese translation aligned to each sentence.

MCQ requirements (tests passage comprehension):
7. Write ONE multiple-choice question in English about the MAIN POINT of the passage.
8. Provide EXACTLY 4 options in English, each 8-15 words, plausibly related to the topic so distractors are not obviously wrong.
9. Exactly ONE option is correct. Record its index (0-3) in the "correct" field.
10. Write a 15-40 character Chinese explanation of WHY the correct option is right (reference specific evidence from the passage). Must be written in Chinese characters.

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
}${retrySuffix}`;
}

function validatePractice(json, expected) {
  const errs = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['root not object'] };
  if (!Array.isArray(json.lines)) errs.push('lines missing or not array');
  let fullText = '';
  if (Array.isArray(json.lines)) {
    fullText = json.lines.map(l => (l && l.en) || '').join(' ');
    const wordCount = fullText.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 60 || wordCount > 180) errs.push(`word count ${wordCount} out of 60-180`);
    if (json.lines.length < 5 || json.lines.length > 10) errs.push(`line count ${json.lines.length} out of 5-10`);
    json.lines.forEach((l, i) => {
      if (!l || typeof l !== 'object' || !l.en || !l.zh) errs.push(`line ${i} missing en or zh`);
    });
  }
  // Target words must each appear (substring; word-boundary regex when alphanumeric)
  const lowerText = fullText.toLowerCase();
  (expected.target_words || []).forEach(w => {
    const clean = String(w || '').toLowerCase().replace(/[^a-z']/g, '');
    if (!clean) return;
    const re = new RegExp('\\b' + clean.replace(/'/g, "\\'?") + '\\b');
    if (!re.test(lowerText)) errs.push(`target word "${w}" not found in text`);
  });
  // Gist length
  if (json.gist_zh) {
    const gl = String(json.gist_zh).length;
    if (gl < 10 || gl > 30) errs.push(`gist_zh length ${gl} out of 10-30`);
  } else {
    errs.push('gist_zh missing');
  }
  // Code-level terminal-punctuation check (CLAUDE.md: do NOT ask LLM to self-validate)
  if (Array.isArray(json.lines) && json.lines.length) {
    const lastLine = json.lines[json.lines.length - 1];
    const lastEn = (lastLine && lastLine.en && String(lastLine.en).trim()) || '';
    if (!/[.!?"'\u201d\u2019]\s*$/.test(lastEn)) {
      errs.push('last line does not end with terminal punctuation');
    }
  }

  // === v3.1.0 additions ===

  // category: must be one of the allowed enum
  if (!json.category || !PRACTICE_ALLOWED_CATEGORIES.includes(json.category)) {
    errs.push(`category "${json.category}" not in allowed set (${PRACTICE_ALLOWED_CATEGORIES.join('|')})`);
  }

  // mcq: 4 options, correct index 0-3, explanation 15-40 chars Chinese
  if (!json.mcq || typeof json.mcq !== 'object') {
    errs.push('mcq missing');
  } else {
    if (!json.mcq.q || typeof json.mcq.q !== 'string' || !json.mcq.q.trim()) {
      errs.push('mcq.q missing');
    }
    if (!Array.isArray(json.mcq.options) || json.mcq.options.length !== 4) {
      errs.push(`mcq.options must have exactly 4 items, got ${Array.isArray(json.mcq.options) ? json.mcq.options.length : 'non-array'}`);
    } else {
      json.mcq.options.forEach((o, i) => {
        if (!o || typeof o !== 'string' || o.trim().length < 10) {
          errs.push(`mcq.options[${i}] too short or empty`);
        }
      });
    }
    if (!Number.isInteger(json.mcq.correct) || json.mcq.correct < 0 || json.mcq.correct > 3) {
      errs.push(`mcq.correct must be int 0-3, got ${json.mcq.correct}`);
    }
    const expLen = (json.mcq.explanation && String(json.mcq.explanation).length) || 0;
    if (!json.mcq.explanation || expLen < 10 || expLen > 60) {
      errs.push(`mcq.explanation length ${expLen} out of 10-60`);
    }
  }

  // target_word_contexts: each item needs cefr + ipa (B38 review page reads these)
  (json.target_word_contexts || []).forEach((t, i) => {
    if (!t || typeof t !== 'object') { errs.push(`target_word_contexts[${i}] not object`); return; }
    if (!t.cefr || !Object.prototype.hasOwnProperty.call(PRACTICE_CEFR_RANKS, t.cefr)) {
      errs.push(`target_word_contexts[${i}].cefr "${t.cefr}" invalid`);
    }
    if (!t.ipa || typeof t.ipa !== 'string' || !t.ipa.trim()) {
      errs.push(`target_word_contexts[${i}].ipa missing`);
    }
  });

  // vocab_in_text: must be array (can be empty); each entry must be >= user cefr and not a target word
  if (!Array.isArray(json.vocab_in_text)) {
    errs.push('vocab_in_text must be an array (can be empty)');
  } else {
    const userRank = PRACTICE_CEFR_RANKS[String(expected.user_cefr || 'B1').toUpperCase()];
    const userRankSafe = Number.isInteger(userRank) ? userRank : 2;
    const targetSet = new Set((expected.target_words || []).map(w => String(w || '').toLowerCase()));
    json.vocab_in_text.forEach((v, i) => {
      if (!v || typeof v !== 'object') { errs.push(`vocab_in_text[${i}] not object`); return; }
      if (!v.word || !v.cefr || !v.zh) {
        errs.push(`vocab_in_text[${i}] missing required field (word/cefr/zh)`);
        return;
      }
      const vrank = PRACTICE_CEFR_RANKS[v.cefr];
      if (!Number.isInteger(vrank) || vrank < userRankSafe) {
        errs.push(`vocab_in_text[${i}] "${v.word}" cefr ${v.cefr} < user ${expected.user_cefr}`);
      }
      if (targetSet.has(String(v.word).toLowerCase())) {
        errs.push(`vocab_in_text[${i}] "${v.word}" is a target word, should not be here`);
      }
    });
  }

  return { ok: errs.length === 0, errors: errs };
}

function logPracticeGen(entry) {
  try {
    const dir = path.join(process.cwd(), 'output', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const file = path.join(dir, `practice-gen-${ymd}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.warn('[practice-gen] log write failed:', e.message);
  }
}

function callAzureChat(prompt, { maxTokens = 1500, temperature = 0.7, jsonMode = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!AZURE_API_KEY) { reject(new Error('AZURE_API_KEY not set')); return; }
    const apiUrl = new url.URL(
      `/openai/deployments/${GPT_DEPLOYMENT}/chat/completions?api-version=${GPT_API_VERSION}`,
      AZURE_ENDPOINT
    );
    const body = {
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: maxTokens,
      temperature
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const bodyStr = JSON.stringify(body);

    let timer = null;
    const req = https.request({
      hostname: apiUrl.hostname,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_API_KEY,
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, resp => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        clearTimeout(timer);
        if (resp.statusCode !== 200) {
          reject(new Error(`Azure ${resp.statusCode}: ${String(data).slice(0, 200)}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
          const usage = parsed.usage || null;
          if (!content) { reject(new Error('Azure response missing content')); return; }
          resolve({ content, usage });
        } catch (e) {
          reject(new Error('Azure response parse failed: ' + e.message));
        }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    timer = setTimeout(() => {
      req.destroy(new Error(`timeout after ${PRACTICE_GEN_TIMEOUT_MS}ms`));
    }, PRACTICE_GEN_TIMEOUT_MS);
    req.write(bodyStr);
    req.end();
  });
}

function parseLLMJson(content) {
  // First try direct parse
  try { return JSON.parse(content); } catch (e) {}
  // Strip markdown fences
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(stripped); } catch (e) {}
  // Extract first {...} block
  const m = content.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  throw new Error('LLM response not valid JSON');
}

function buildPracticeFromLLM(json, expected) {
  // Map LLM JSON → frontend practice shape (same as buildPractice in listening-practice.js).
  const lines = (json.lines || []).map((l, i) => ({
    en: String(l.en || '').trim(),
    zh: String(l.zh || '').trim(),
    target_words: [], // filled below
    start: 0,
    end: 0
  }));
  // Re-time using ~0.52s per English word per line (matches addTiming heuristic on frontend).
  let cursor = 0;
  lines.forEach(line => {
    const wc = line.en.split(/\s+/).filter(Boolean).length;
    const dur = Math.max(3.6, Math.min(7.5, wc * 0.52));
    line.start = Number(cursor.toFixed(1));
    line.end = Number((cursor + dur).toFixed(1));
    cursor += dur;
    line.target_words = (expected.target_words || []).filter(w => {
      const clean = String(w || '').toLowerCase().replace(/[^a-z']/g, '');
      const re = new RegExp('\\b' + clean.replace(/'/g, "\\'?") + '\\b');
      return re.test(line.en.toLowerCase());
    });
  });
  const text = lines.map(l => l.en).join(' ');

  // Vocabulary array for review screen (target words w/ cefr + ipa from LLM)
  const ctxs = Array.isArray(json.target_word_contexts) ? json.target_word_contexts : [];
  const ctxByWord = {};
  ctxs.forEach(c => { if (c && c.word) ctxByWord[String(c.word).toLowerCase()] = c; });
  const vocabulary = (expected.target_word_objs || []).map(w => {
    const ctx = ctxByWord[String(w.word).toLowerCase()] || {};
    return {
      word: w.word,
      definition_zh: ctx.definition_zh || w.definition_zh || '',
      cefr: ctx.cefr || w.cefr || 'B1',
      ipa: ctx.ipa || ''
    };
  });

  // MCQ (v3.1.0): fixed 4-option structure with correct-index + explanation.
  // Preserve correct-index even after shuffle so the frontend can score.
  const rawMcq = (json.mcq && typeof json.mcq === 'object') ? json.mcq : null;
  let mcqQ = rawMcq && rawMcq.q ? String(rawMcq.q) : 'What is the main point of this passage?';
  let mcqOptions = (rawMcq && Array.isArray(rawMcq.options)) ? rawMcq.options.slice(0, 4).map(String) : [];
  let mcqCorrect = (rawMcq && Number.isInteger(rawMcq.correct)) ? rawMcq.correct : 0;
  let mcqExplanation = (rawMcq && rawMcq.explanation) ? String(rawMcq.explanation) : '';

  // Shuffle options while tracking which index is correct.
  const indexed = mcqOptions.map((text, i) => ({ text, origIdx: i }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  const shuffledOptions = indexed.map(x => x.text);
  const newCorrectIdx = indexed.findIndex(x => x.origIdx === mcqCorrect);

  // Frontend `gist.options` compat: each option object carries `correct` bool.
  const gistOptionsCompat = shuffledOptions.map((t, i) => ({
    text: t,
    correct: i === newCorrectIdx
  }));

  // vocab_in_text passthrough (B38) — array of { word, cefr, zh, ipa, sentence_index }
  const vocabInText = Array.isArray(json.vocab_in_text) ? json.vocab_in_text.map(v => ({
    word: String(v.word || ''),
    cefr: String(v.cefr || ''),
    zh: String(v.zh || ''),
    ipa: String(v.ipa || ''),
    sentence_index: Number.isInteger(v.sentence_index) ? v.sentence_index : null
  })) : [];

  // Category (v3.1.0) with frontend fallback.
  let category = PRACTICE_ALLOWED_CATEGORIES.includes(json.category) ? json.category : null;
  if (!category) {
    const tagCounts = {};
    (expected.target_word_objs || []).forEach(w => {
      if (w.tag) tagCounts[w.tag] = (tagCounts[w.tag] || 0) + 1;
    });
    const top = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
    category = (top && PRACTICE_ALLOWED_CATEGORIES.includes(top[0])) ? top[0] : 'general';
  }

  const tag = (expected.target_word_objs || []).reduce((acc, w) => acc || w.tag, '') || category;
  return {
    id: 'lp-llm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    title: json.title || (json.topic_en ? json.topic_en.slice(0, 24) : '专属训练'),
    tag: tag,
    category: category,
    cefr: expected.user_cefr || 'B1',
    topicKey: tag,
    target_words: (expected.target_words || []).slice(),
    text: text,
    lines: lines,
    vocabulary: vocabulary,
    // New: preserve target_word_contexts verbatim so the Review page (B38) can read cefr+ipa.
    target_word_contexts: ctxs.map(c => ({
      word: String((c && c.word) || ''),
      sentence_index: Number.isInteger(c && c.sentence_index) ? c.sentence_index : null,
      definition_zh: String((c && c.definition_zh) || ''),
      cefr: String((c && c.cefr) || ''),
      ipa: String((c && c.ipa) || '')
    })),
    vocab_in_text: vocabInText,
    // Canonical MCQ object (v3.1.0) — frontend reads this.
    mcq: {
      q: mcqQ,
      options: shuffledOptions,
      correct: newCorrectIdx >= 0 ? newCorrectIdx : 0,
      explanation: mcqExplanation
    },
    // Legacy shape kept for any code still reading `gist.options`.
    gist: {
      question: mcqQ,
      options: gistOptionsCompat,
      explanation_zh: mcqExplanation || json.gist_zh || ''
    },
    generatedAt: Date.now(),
    generatedBy: 'llm',
    generationVersion: PRACTICE_PROMPT_VERSION
  };
}

async function generatePracticeWithValidation({ words, interests, userCefr, topicHint, expected }) {
  // Calls the LLM up to PRACTICE_MAX_RETRIES+1 times. On validation failure
  // (or parse/transport failure), feed back the first few errors as a hint to
  // the next attempt's prompt. Returns { ok, parsed?, attempts[], totalDurationMs, lastUsage, fatalError? }.
  const attempts = [];
  let lastErrors = [];
  let totalDurationMs = 0;
  let lastUsage = null;
  let parsed = null;
  for (let i = 0; i <= PRACTICE_MAX_RETRIES; i++) {
    const retryHint = lastErrors.length ? lastErrors.slice(0, 3).join('; ') : null;
    const prompt = buildPracticePrompt({ words, interests, userCefr, topicHint, retryHint });
    const startedAt = Date.now();
    let content = null;
    let usage = null;
    let transportError = null;
    let validation = null;
    let attemptParsed = null;
    try {
      const r = await callAzureChat(prompt, { maxTokens: 1800, temperature: 0.7 });
      content = r.content;
      usage = r.usage;
      lastUsage = usage || lastUsage;
    } catch (e) {
      transportError = e.message;
    }
    const durationMs = Date.now() - startedAt;
    totalDurationMs += durationMs;

    if (!transportError) {
      try { attemptParsed = parseLLMJson(content); }
      catch (e) { transportError = 'parse_failed: ' + e.message; }
    }
    if (!transportError) {
      validation = validatePractice(attemptParsed, expected);
    }

    attempts.push({
      attempt: i + 1,
      durationMs,
      usage,
      transportError,
      validation,
      hintFromPrev: retryHint
    });

    if (transportError) {
      lastErrors = [transportError];
      if (i === PRACTICE_MAX_RETRIES) {
        return { ok: false, fatalError: transportError, attempts, totalDurationMs, lastUsage };
      }
      continue;
    }
    if (validation.ok) {
      parsed = attemptParsed;
      return { ok: true, parsed, attempts, totalDurationMs, lastUsage };
    }
    lastErrors = validation.errors || [];
    console.warn(`[practice-gen] attempt ${i + 1} validation failed:`, lastErrors.slice(0, 3));
  }
  return { ok: false, attempts, totalDurationMs, lastUsage, lastErrors };
}

function handlePracticeGenerateApi(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    let payload;
    try { payload = JSON.parse(body || '{}'); }
    catch { res.writeHead(400, corsHeaders); res.end(JSON.stringify({ error: 'Invalid JSON' })); return; }

    const targetWordObjs = Array.isArray(payload.target_words)
      ? payload.target_words.map(w => typeof w === 'string' ? { word: w } : w).filter(w => w && w.word)
      : [];
    const interests = Array.isArray(payload.interests) ? payload.interests : [];
    const userCefr = String(payload.user_cefr || 'B1').toUpperCase();
    const topicHint = payload.topic_hint || null;

    if (targetWordObjs.length < 1) {
      res.writeHead(400, corsHeaders); res.end(JSON.stringify({ error: 'target_words required' })); return;
    }
    if (!AZURE_API_KEY) {
      res.writeHead(503, corsHeaders); res.end(JSON.stringify({ error: 'AZURE_API_KEY not set — generation disabled' })); return;
    }

    const targetWords = targetWordObjs.map(w => w.word);
    const expected = {
      target_words: targetWords,
      target_word_objs: targetWordObjs,
      user_cefr: userCefr
    };

    const result = await generatePracticeWithValidation({
      words: targetWordObjs,
      interests,
      userCefr,
      topicHint,
      expected
    });

    const lastAttempt = result.attempts[result.attempts.length - 1] || null;
    const finalValidation = lastAttempt && lastAttempt.validation
      ? lastAttempt.validation
      : { ok: false, errors: [result.fatalError || 'unknown_failure'] };
    const practice = result.ok ? buildPracticeFromLLM(result.parsed, expected) : null;

    logPracticeGen({
      ts: new Date().toISOString(),
      target_words: targetWords,
      interests,
      user_cefr: userCefr,
      prompt_version: PRACTICE_PROMPT_VERSION,
      llm_duration_ms: result.totalDurationMs,
      llm_tokens: result.lastUsage
        ? { in: result.lastUsage.prompt_tokens, out: result.lastUsage.completion_tokens }
        : null,
      validation_attempts: result.attempts.length,
      validation_result: result.ok ? 'ok' : 'failed_after_retries',
      final_category: practice ? practice.category : null,
      final_vocab_in_text_count: practice ? (practice.vocab_in_text || []).length : null,
      attempt_errors: result.attempts.map(a => ({
        attempt: a.attempt,
        transportError: a.transportError,
        validationErrors: a.validation ? a.validation.errors : null,
        hintFromPrev: a.hintFromPrev
      })),
      responseRaw: result.parsed || null
    });

    if (!result.ok) {
      if (result.fatalError && !lastAttempt.validation) {
        res.writeHead(503, corsHeaders);
        res.end(JSON.stringify({ error: 'LLM call failed', detail: result.fatalError, attempts: result.attempts.length }));
        return;
      }
      res.writeHead(422, corsHeaders);
      res.end(JSON.stringify({
        error: 'validation failed after retries',
        errors: finalValidation.errors,
        attempts: result.attempts.length
      }));
      return;
    }

    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({
      practice,
      meta: {
        promptVersion: PRACTICE_PROMPT_VERSION,
        durationMs: result.totalDurationMs,
        usage: result.lastUsage,
        attempts: result.attempts.length
      }
    }));
  });
}

function handleTtsApi(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const text = String(payload.text || '').trim();
    const voice = String(payload.voice || 'en-US-AvaMultilingualNeural').trim();
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'text is required' }));
      return;
    }

    const py = spawn('python3', [path.join(process.cwd(), 'scripts', 'tts_edge.py'), voice], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    py.stderr.on('data', chunk => { stderr += chunk.toString(); });
    py.on('error', err => {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message }));
    });
    py.on('close', code => {
      if (code !== 0 && !res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: stderr || `tts exited with ${code}` }));
      }
    });

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    py.stdout.pipe(res);
    py.stdin.end(text);
  });
}

const MIME = {
  html: 'text/html', css: 'text/css', js: 'application/javascript',
  json: 'application/json', mp3: 'audio/mpeg', png: 'image/png',
  jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon',
};

function serveStatic(req, res) {
  const u = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(process.cwd(), u);
  const ext = path.extname(f).slice(1);
  const mt = MIME[ext] || 'application/octet-stream';

  fs.stat(f, (e, st) => {
    if (e) { res.writeHead(404); res.end('Not found'); return; }
    const h = { 'Content-Type': mt, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1]), end = m[2] ? parseInt(m[2]) : st.size - 1, len = end - start + 1;
        h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        h['Content-Length'] = len;
        res.writeHead(206, h);
        fs.createReadStream(f, { start, end }).pipe(res);
      } else { res.writeHead(416); res.end(); }
    } else {
      h['Content-Length'] = st.size;
      res.writeHead(200, h);
      fs.createReadStream(f).pipe(res);
    }
  });
}

http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API routes
  if (req.url === '/api/rank' && req.method === 'POST') {
    handleRankApi(req, res);
    return;
  }
  if (req.url === '/api/tts' && req.method === 'POST') {
    handleTtsApi(req, res);
    return;
  }
  if (req.url === '/api/practice/generate' && req.method === 'POST') {
    handlePracticeGenerateApi(req, res);
    return;
  }

  // Static files
  serveStatic(req, res);
}).listen(PORT, () => console.log(`Dev server on ${PORT} with Range + /api/rank + /api/tts`));
