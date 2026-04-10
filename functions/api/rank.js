/**
 * Cloudflare Pages Function — AI Feed Ranking
 * POST /api/rank
 *
 * 接收用户画像 + 行为数据，调 Azure GPT 返回排好序的 feed + 每条推荐理由。
 *
 * 环境变量（在 Cloudflare Dashboard 设置）:
 *   AZURE_API_KEY — Azure OpenAI API key
 */

const AZURE_ENDPOINT = "https://us-east-02-gpt-01.openai.azure.com";
const GPT_DEPLOYMENT = "gpt-5.4-global-01";
const GPT_API_VERSION = "2024-10-21";

// clip 元数据（轻量版，只传排序需要的信息，不传 lines/words）
// 这个列表从 data.json 提取，部署时可以自动生成
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

function buildPrompt(userProfile, clipMeta) {
  const availableClips = clipMeta
    .filter(c => !(userProfile.listened || []).includes(c.id))
    .map(c => `  [${c.id}] "${c.title}" | ${c.tag} | ${c.source} | ${c.duration}s | ${c.difficulty}`)
    .join("\n");

  return `You are the recommendation engine for an AI-native English listening app. Your job is to rank podcast clips for this specific user.

USER PROFILE:
- CEFR level: ${userProfile.level || "B1"}
- Interests: ${(userProfile.interests || []).join(", ") || "not specified"}
- Clips already listened: ${(userProfile.listened || []).length} clips
- Clips skipped: ${JSON.stringify(userProfile.skipped || [])}
- Words clicked (looked up): ${JSON.stringify(userProfile.vocab_clicked || [])}
- Session duration so far: ${userProfile.session_duration || 0}s

AVAILABLE CLIPS:
${availableClips}

RANKING RULES:
1. Prioritize clips matching user interests, but mix in 1-2 clips from other topics every 5 clips to expand their horizons.
2. Match difficulty to CEFR level: A1-A2 → easy, B1 → easy/medium, B2 → medium/hard, C1-C2 → hard.
3. If user skipped clips of a certain topic, reduce that topic's priority.
4. If user clicked many words, they might be struggling — lean toward easier clips.
5. Vary sources — don't serve 3 clips from the same podcast in a row.
6. Keep the first 1-2 clips engaging and accessible to hook the user.

Return a JSON array of objects, each with:
- "id": clip id (number)
- "reason": one sentence in Chinese explaining why this clip is recommended for this user (keep it natural and concise, like "难度适中，换个科学话题放松一下")

Return ONLY the JSON array, no markdown, no explanation. Order from most recommended to least.`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const userProfile = await request.json();
    const prompt = buildPrompt(userProfile, CLIP_META);

    const apiUrl = `${AZURE_ENDPOINT}/openai/deployments/${GPT_DEPLOYMENT}/chat/completions?api-version=${GPT_API_VERSION}`;

    const apiKey = env.AZURE_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "AZURE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gptResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 2000,
        temperature: 0.7,
      }),
    });

    if (!gptResponse.ok) {
      const errText = await gptResponse.text();
      return new Response(
        JSON.stringify({ error: "GPT API error", status: gptResponse.status, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gptData = await gptResponse.json();
    const content = gptData.choices?.[0]?.message?.content || "[]";

    // Parse the JSON from GPT response
    let feed;
    try {
      feed = JSON.parse(content);
    } catch {
      // If GPT returned markdown-wrapped JSON, try to extract it
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      feed = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    return new Response(
      JSON.stringify({ feed, clip_count: CLIP_META.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
