# Claude Code 任务：听力练习独立模块（AI 生成 + TTS + 三轮递进）

> **一句话**：在侧边菜单的 🎧 听力练习入口后面，搭建一个基于 AI 生成内容 + TTS 的三轮递进听力训练模块。用 mock 数据跑通全流程，不依赖真实 API。

---

## 0 · 背景

Flipod 有两条产品线：Feed 内嵌教学（轻）和听力练习（重）。Feed 教学已经在 `teaching-module.js` 里实现了 Phase 1-4。现在要做的是第二条线——**听力练习独立模块**。

它和 Feed 教学的核心区别：Feed 教学用的是真人播客音频 + 轻量配对练习；听力练习用的是 **AI 从零生成的短文 + TTS 音频 + 三轮递进训练**。两者共享用户画像（CEFR + 生词本），但 UI、状态机、数据流完全独立。

**产品 PRD**：`docs/prd/FLIPOD-PRD.md` 第七章「听力练习（侧边菜单独立模块）」是需求源。

---

## 1 · 必须先读的文件

1. **`docs/prd/FLIPOD-PRD.md`** — 第七章是本任务的产品需求，第十一章是设计系统
2. **`index.html`** — 现有主界面，理解侧边菜单结构和 practice-overlay 的位置
3. **`teaching-module.js`** — 参考已有的 Phase 状态机模式和 CSS 命名习惯

---

## 2 · 解锁条件

听力练习不是默认可用的。**生词本 ≥ 5 个词才解锁。**

### 未解锁态

侧边菜单的 🎧 听力练习条目仍然可见，但加 `.locked` 样式（opacity 降低）。点击后不进入练习，而是显示引导卡片：

```
┌──────────────────────────────┐
│  🎧 专属听力练习              │
│                              │
│  再学 X 个新词就能解锁        │
│  ████████░░░░  3/5           │
│                              │
│  在 Feed 里听播客、收藏生词   │
│  积累到 5 个词自动解锁        │
│                              │
│  [去听播客 →]                │
└──────────────────────────────┘
```

进度条用 `flipodVocab` 的 length 驱动。「去听播客 →」关闭菜单回到 Feed。

### 已解锁态

正常进入练习列表 / 直接开始练习。

---

## 3 · Mock 数据

### 3.1 Mock 生词本（写入 localStorage）

在模块初始化时，如果 `flipodVocab` 为空或不足 5 个，注入 mock 数据（仅 demo 期间）：

```javascript
const MOCK_VOCAB = [
  // business 话题
  { word: "benchmark", cefr: "B2", definition_zh: "基准；参照标准", tag: "business", added: "2026-04-15" },
  { word: "recession", cefr: "B2", definition_zh: "经济衰退", tag: "business", added: "2026-04-15" },
  { word: "inflation", cefr: "B2", definition_zh: "通货膨胀", tag: "business", added: "2026-04-14" },
  { word: "debt", cefr: "B2", definition_zh: "债务，欠款", tag: "business", added: "2026-04-14" },
  { word: "revenue", cefr: "B2", definition_zh: "收入，营收", tag: "business", added: "2026-04-13" },
  { word: "portfolio", cefr: "C1", definition_zh: "投资组合；作品集", tag: "business", added: "2026-04-13" },
  { word: "dividend", cefr: "C1", definition_zh: "股息，红利", tag: "business", added: "2026-04-12" },
  // psychology 话题
  { word: "cognitive", cefr: "B2", definition_zh: "认知的", tag: "psychology", added: "2026-04-15" },
  { word: "bias", cefr: "B2", definition_zh: "偏见，偏差", tag: "psychology", added: "2026-04-14" },
  { word: "empathy", cefr: "B2", definition_zh: "共情，同理心", tag: "psychology", added: "2026-04-14" },
  { word: "resilience", cefr: "C1", definition_zh: "韧性，恢复力", tag: "psychology", added: "2026-04-13" },
  { word: "stimulus", cefr: "C1", definition_zh: "刺激；激励", tag: "psychology", added: "2026-04-12" },
  // science 话题
  { word: "hypothesis", cefr: "B2", definition_zh: "假说，假设", tag: "science", added: "2026-04-15" },
  { word: "molecule", cefr: "B2", definition_zh: "分子", tag: "science", added: "2026-04-14" },
  { word: "catalyst", cefr: "C1", definition_zh: "催化剂；促进因素", tag: "science", added: "2026-04-13" },
  { word: "synthesize", cefr: "C1", definition_zh: "合成；综合", tag: "science", added: "2026-04-12" },
  // story 话题
  { word: "narrative", cefr: "B2", definition_zh: "叙事，叙述", tag: "story", added: "2026-04-15" },
  { word: "protagonist", cefr: "C1", definition_zh: "主角，主人公", tag: "story", added: "2026-04-14" },
  { word: "dilemma", cefr: "B2", definition_zh: "困境，两难", tag: "story", added: "2026-04-13" },
  { word: "metaphor", cefr: "C1", definition_zh: "隐喻，比喻", tag: "story", added: "2026-04-12" },
];
```

### 3.2 Mock 生成层输出（2 篇练习材料）

不调真实 GPT API，直接 mock 生成结果。准备 2 篇不同话题的 mock：

```javascript
const MOCK_PRACTICES = [
  {
    id: "practice_b1_business_001",
    title: "The Hidden Cost of Low Interest Rates",
    tag: "business",
    cefr: "B1",
    target_words: ["benchmark", "recession", "inflation"],
    text: "When central banks set their benchmark interest rate very low, borrowing money becomes cheap. Many people think this is always good news. But economists warn that keeping rates low for too long can lead to inflation. Prices start rising faster than wages, and ordinary people find it harder to afford basic goods. During the last recession, governments around the world cut rates to help the economy recover. While this prevented a deeper crisis, it also created new problems. Asset prices climbed rapidly, and the gap between rich and poor grew wider. The challenge for policymakers is finding the right balance — low enough to encourage growth, but not so low that it fuels instability.",
    lines: [
      { en: "When central banks set their benchmark interest rate very low, borrowing money becomes cheap.", zh: "当央行将基准利率设定得很低时，借钱就变得便宜了。", target_words: ["benchmark"], start: 0, end: 5.2 },
      { en: "Many people think this is always good news.", zh: "很多人认为这总是好消息。", target_words: [], start: 5.2, end: 7.8 },
      { en: "But economists warn that keeping rates low for too long can lead to inflation.", zh: "但经济学家警告说，利率过低维持太久会导致通货膨胀。", target_words: ["inflation"], start: 7.8, end: 12.4 },
      { en: "Prices start rising faster than wages, and ordinary people find it harder to afford basic goods.", zh: "物价上涨速度超过工资增长，普通人越来越难以负担基本商品。", target_words: [], start: 12.4, end: 17.6 },
      { en: "During the last recession, governments around the world cut rates to help the economy recover.", zh: "在上一次经济衰退期间，世界各国政府纷纷降息以帮助经济复苏。", target_words: ["recession"], start: 17.6, end: 22.8 },
      { en: "While this prevented a deeper crisis, it also created new problems.", zh: "虽然这避免了更严重的危机，但也带来了新问题。", target_words: [], start: 22.8, end: 26.0 },
      { en: "Asset prices climbed rapidly, and the gap between rich and poor grew wider.", zh: "资产价格迅速攀升，贫富差距进一步扩大。", target_words: [], start: 26.0, end: 30.2 },
      { en: "The challenge for policymakers is finding the right balance — low enough to encourage growth, but not so low that it fuels instability.", zh: "决策者面临的挑战是找到恰当的平衡——既要足够低以促进增长，又不能低到助长不稳定。", target_words: [], start: 30.2, end: 37.0 }
    ],
    vocabulary: [
      { word: "benchmark", definition_zh: "基准；参照标准", cefr: "B2" },
      { word: "recession", definition_zh: "经济衰退", cefr: "B2" },
      { word: "inflation", definition_zh: "通货膨胀", cefr: "B2" }
    ],
    // Round 1 结束后的主旨题
    gist: {
      question: "What is the main point of this passage?",
      options: [
        { text: "Low interest rates always help the economy grow", correct: false },
        { text: "Low interest rates can help recovery but also cause new problems like inflation", correct: true },
        { text: "Governments should never lower interest rates", correct: false }
      ],
      explanation_zh: "文章的核心观点是低利率是双刃剑——既能帮助经济复苏，也会带来通胀和贫富差距等新问题。"
    }
  },
  {
    id: "practice_b1_psychology_001",
    title: "Why We Trust First Impressions",
    tag: "psychology",
    cefr: "B1",
    target_words: ["cognitive", "bias", "empathy"],
    text: "Our brains make quick judgments about people within seconds of meeting them. This cognitive shortcut helped our ancestors survive in dangerous environments. But in modern life, these snap decisions often lead to bias. We might judge someone as untrustworthy simply because they remind us of someone we disliked in the past. Researchers have found that people who practice empathy — the ability to understand others' feelings — are better at overcoming these automatic judgments. They take time to look beyond surface-level impressions and consider the full picture. The good news is that awareness of our own biases is the first step toward making fairer decisions.",
    lines: [
      { en: "Our brains make quick judgments about people within seconds of meeting them.", zh: "我们的大脑在见到一个人的几秒钟内就会做出快速判断。", target_words: [], start: 0, end: 4.5 },
      { en: "This cognitive shortcut helped our ancestors survive in dangerous environments.", zh: "这种认知捷径帮助我们的祖先在危险的环境中生存下来。", target_words: ["cognitive"], start: 4.5, end: 8.8 },
      { en: "But in modern life, these snap decisions often lead to bias.", zh: "但在现代生活中，这些草率的决定往往会导致偏见。", target_words: ["bias"], start: 8.8, end: 12.4 },
      { en: "We might judge someone as untrustworthy simply because they remind us of someone we disliked in the past.", zh: "我们可能仅仅因为某人让我们想起过去不喜欢的人，就判定他不可信。", target_words: [], start: 12.4, end: 18.2 },
      { en: "Researchers have found that people who practice empathy — the ability to understand others' feelings — are better at overcoming these automatic judgments.", zh: "研究人员发现，那些练习共情——即理解他人感受的能力——的人更擅长克服这些自动判断。", target_words: ["empathy"], start: 18.2, end: 25.6 },
      { en: "They take time to look beyond surface-level impressions and consider the full picture.", zh: "他们会花时间看到表面印象之外的东西，考虑全貌。", target_words: [], start: 25.6, end: 30.0 },
      { en: "The good news is that awareness of our own biases is the first step toward making fairer decisions.", zh: "好消息是，意识到自己的偏见是做出更公正决定的第一步。", target_words: ["bias"], start: 30.0, end: 35.5 }
    ],
    vocabulary: [
      { word: "cognitive", definition_zh: "认知的", cefr: "B2" },
      { word: "bias", definition_zh: "偏见，偏差", cefr: "B2" },
      { word: "empathy", definition_zh: "共情，同理心", cefr: "B2" }
    ],
    gist: {
      question: "What does the passage suggest about first impressions?",
      options: [
        { text: "First impressions are always accurate and should be trusted", correct: false },
        { text: "Quick judgments can be biased, but empathy and awareness can help us overcome them", correct: true },
        { text: "Scientists have found no way to improve our judgment of others", correct: false }
      ],
      explanation_zh: "文章的核心是：第一印象是进化遗留的认知捷径，容易带来偏见，但通过共情和自我觉察可以克服。"
    }
  }
];
```

### 3.3 Mock TTS（用 SpeechSynthesis API）

不调外部 TTS API。用浏览器内置的 `SpeechSynthesis API` 模拟 TTS 播放：

```javascript
function speakText(text, rate = 1.0) {
  return new Promise((resolve) => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-US';
    utt.rate = rate;
    utt.onend = resolve;
    speechSynthesis.speak(utt);
  });
}
```

词级时间戳：mock 数据里的 `lines[].start` / `lines[].end` 已经预设好了。逐句播放时用 `utt.onboundary` 事件做近似的词高亮（不需要精确到词级，句级同步即可）。

---

## 4 · 功能规格

### 4.1 入口

侧边菜单 🎧 听力练习。点击后：

- 如果 `flipodVocab.length < 5` → 显示解锁引导卡片（见 §2）
- 如果已解锁 → 显示练习选择页，展示可用的练习材料（从 mock 数据加载）

### 4.2 练习选择页

列出可用的练习材料卡片：

```
┌──────────────────────────────┐
│  🎧 听力练习                  │
│                              │
│  ┌────────────────────────┐  │
│  │ The Hidden Cost of Low │  │
│  │ Interest Rates          │  │
│  │ business · B1 · 37s    │  │
│  │ benchmark recession    │  │
│  │ inflation              │  │
│  │         [开始练习 →]    │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ Why We Trust First     │  │
│  │ Impressions             │  │
│  │ psychology · B1 · 35s  │  │
│  │ cognitive bias empathy │  │
│  │         [开始练习 →]    │  │
│  └────────────────────────┘  │
│                              │
│  底部：练习材料基于你的生词本  │
│  AI 生成，每次内容不同        │
└──────────────────────────────┘
```

每张卡片显示：标题、话题 tag、CEFR 等级、预估时长、目标词汇胶囊。

### 4.3 三轮递进练习 UI

点击「开始练习」后进入全屏练习页（覆盖 Feed，类似现有的 `practice-overlay`）。

顶部：进度条（3 个圆点，指示当前 Round）+ 关闭按钮。

#### Round 1 — 全字幕听

- 中央大播放按钮（点击开始 TTS 朗读全文）
- 字幕区域：逐句显示英文 + 中文翻译
- 当前正在朗读的句子高亮，目标词用 accent 色标注
- 朗读完毕后底部滑入主旨题卡片（3 选项，与 Feed 教学的 Gist 题交互一致）
- 答题/跳过后进入 Round 2

#### Round 2 — 挖空听

- 同一段内容重新朗读
- 字幕中目标词变成输入框 `[_______]`
- TTS 逐句朗读，朗读到含目标词的句子时暂停，等用户填写
- 用户输入后即时判断（忽略大小写）：正确 → 绿色 ✓，错误 → 红色显示正确答案
- 全部填完后显示成绩卡片：`2/3 正确` + 每个词的对错详情
- 点「继续」进入 Round 3

#### Round 3 — 盲听

- 无字幕，纯音频播放（TTS 朗读全文）
- 只显示播放控制（播放/暂停 + 进度）和一句提示："试试不看字幕，你能听懂多少？"
- 朗读完毕后出完形填空：全文文本显示，但目标词 + 额外 2-3 个词变成下拉选择框
- 用户选完后即时反馈
- 最后：难度反馈（太简单/正合适/有点难）+ 词汇回顾 + 返回按钮

### 4.4 状态机

```javascript
const PracticeState = {
  INIT: 'init',
  ROUND1_PLAY: 'r1_play',
  ROUND1_QUIZ: 'r1_quiz',
  ROUND2_PLAY: 'r2_play',
  ROUND2_RESULT: 'r2_result',
  ROUND3_PLAY: 'r3_play',
  ROUND3_QUIZ: 'r3_quiz',
  COMPLETE: 'complete'
};

const transitions = {
  init:       { loaded: 'r1_play' },
  r1_play:    { ended: 'r1_quiz' },
  r1_quiz:    { done: 'r2_play', skip: 'r2_play' },
  r2_play:    { ended: 'r2_result' },
  r2_result:  { next: 'r3_play', skip: 'complete' },
  r3_play:    { ended: 'r3_quiz' },
  r3_quiz:    { done: 'complete' },
  complete:   { restart: 'r1_play', exit: null }
};
```

---

## 5 · 实现约束

### 必须做

- 全部 vanilla JS，不引入框架
- 视觉风格与现有 `index.html` 一致（用已有的 CSS 变量 `--bg-primary`, `--accent`, `--text-1` 等）
- Round 2 的填词交互必须真实可用（input 框、即时判断、视觉反馈）
- TTS 用 `SpeechSynthesis API`，逐句朗读，句间有自然间隔
- 状态机严格按 transitions 走，每个状态转移都有对应的 UI 变化
- 解锁引导页的进度条从 `flipodVocab` 实时计算
- 关闭/退出时清理 TTS（`speechSynthesis.cancel()`）

### 不能做

- ❌ 不调真实 GPT / TTS API（全用 mock + SpeechSynthesis）
- ❌ 不改 `data.json` 的 schema
- ❌ 不破坏现有 Feed 播放、教学模块、菜单等功能
- ❌ 不引入 icon font
- ❌ 不用 `:has()` 选择器（兼容性不够）

### 文件结构

```
新建：
  listening-practice.js    — ES module，导出 ListeningPracticeController
  styles/listening-practice.css  — 专用样式（不影响现有样式）
  mock/practice-data.js    — mock 生词本 + mock 练习材料

改动：
  index.html — 最小改动：
    1. <head> 加 CSS link
    2. </body> 前加 JS script
    3. 侧边菜单的听力练习按钮绑定 click handler
    4. 在 body 内添加 practice 页面容器
```

---

## 6 · 搭建顺序

按这个顺序做，每步测试：

1. **Mock 数据** — 创建 `mock/practice-data.js`，注入 mock 生词本到 localStorage
2. **解锁引导页** — 侧边菜单点击 → 判断词汇量 → 显示引导卡片或练习列表
3. **练习选择页** — 从 mock 加载材料卡片，点击开始
4. **Round 1 全字幕听** — TTS 逐句朗读 + 字幕同步高亮 + 目标词标注
5. **Round 1 主旨题** — 朗读完弹出 Gist 题，复用已有的 Gist 交互模式
6. **Round 2 挖空听** — 字幕挖空 + TTS 逐句播放暂停 + 填词判断
7. **Round 3 盲听** — 纯音频 + 完形填空
8. **Complete 总结** — 难度反馈 + 词汇回顾
9. **串联** — 状态机完整流转 + 进度指示器
10. **集成** — 绑定侧边菜单入口 + 关闭清理

---

## 7 · 验收标准

- [ ] 侧边菜单点 🎧 → 词汇 < 5 时看到解锁引导（进度条正确）
- [ ] 词汇 ≥ 5 时看到 2 张练习材料卡片
- [ ] 点「开始练习」→ 进入全屏练习页，顶部 3 个进度圆点
- [ ] Round 1：点播放 → TTS 逐句朗读，当前句高亮，目标词紫色
- [ ] Round 1：朗读完 → 主旨题滑入，选项点击有颜色反馈
- [ ] Round 1 → Round 2：进度圆点更新
- [ ] Round 2：目标词变成输入框，TTS 播到目标句时暂停等输入
- [ ] Round 2：输入正确 → 绿色，输入错误 → 红色 + 显示正确答案
- [ ] Round 2 → Round 3：显示成绩
- [ ] Round 3：无字幕，纯 TTS 播放
- [ ] Round 3：播完出完形填空，下拉选择 + 即时反馈
- [ ] Complete：统计 + 难度反馈 + 词汇回顾 + 返回按钮
- [ ] 点返回 → 回到 Feed，TTS 停止
- [ ] 暗色/亮色主题下样式正常
- [ ] Console 无 JS 错误
