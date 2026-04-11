/**
 * Local dev server — static files with Range support + /api/rank proxy to Azure GPT.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8080;
const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT || 'https://us-east-02-gpt-01.openai.azure.com';
const AZURE_API_KEY = process.env.AZURE_API_KEY;
const GPT_DEPLOYMENT = 'gpt-5.4-global-01';
const GPT_API_VERSION = '2024-10-21';

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

  // Static files
  serveStatic(req, res);
}).listen(PORT, () => console.log(`Dev server on ${PORT} with Range + /api/rank`));
