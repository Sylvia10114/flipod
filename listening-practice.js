/**
 * Listening Practice Controller
 * Three-round progressive listening training with mock data + SpeechSynthesis TTS.
 */
(function () {
  'use strict';

  /* ── State machine ── */
  var State = {
    INIT: 'init',
    PASS1: 'pass1',
    PASS2: 'pass2',
    PASS3: 'pass3',
    PASS4: 'pass4',
    REVIEW: 'review'
  };

  var transitions = {
    init:   { loaded: 'pass1' },
    pass1:  { next: 'pass2' },
    pass2:  { next: 'pass3' },
    pass3:  { next: 'pass4' },
    pass4:  { next: 'review' },
    review: { exit: null }
  };

  /* ── Helpers ── */
  var CLOSE_SVG = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  var PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  var STORAGE_KEY = 'flipodPracticeState';
  var UNLOCK_COUNT = 5;
  var REFRESH_DELTA = 3;
  var BATCH_SIZE = 2;
  var MAX_PENDING = 6;
  var LEVEL_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  var LEVEL_LABELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  /* ── PRD §8 CEFR adaptation table ──
   * 规则生效在: Pass4 review 数 / Pass3 渐隐密度 /
   * Pass4 replay 次数 / C1+ 邻词共渐隐。
   * A1 → fallback A2；C2 → fallback C1。
   * TTS rate 走 CEFR × Pass 矩阵（见 CEFR_PASS_RATE / getPassRate, 2026-04-17 B28 修正）
   */
  var CEFR_ADAPTATION = {
    A2: { reviewCount: 2, fadeDensity: 5, maxReplay: 2, fadeAdjacent: false },
    B1: { reviewCount: 3, fadeDensity: 3, maxReplay: 1, fadeAdjacent: false },
    B2: { reviewCount: 4, fadeDensity: 2, maxReplay: 0, fadeAdjacent: false },
    C1: { reviewCount: 5, fadeDensity: 2, maxReplay: 0, fadeAdjacent: true }
  };
  function adaptationFor(level) {
    if (!level) return CEFR_ADAPTATION.B1;
    var lv = String(level).toUpperCase();
    if (lv === 'A1' || lv === 'A2') return CEFR_ADAPTATION.A2;
    if (lv === 'B1') return CEFR_ADAPTATION.B1;
    if (lv === 'B2') return CEFR_ADAPTATION.B2;
    return CEFR_ADAPTATION.C1; // C1, C2, anything else
  }
  function getUserAdaptation() {
    // canonical level source: flipodUserProfile.cefrLevel, fallback flipodLevel, fallback B1
    var level = null;
    try {
      var prof = JSON.parse(localStorage.getItem('flipodUserProfile') || '{}');
      level = prof && prof.cefrLevel;
    } catch (e) { /* ignore */ }
    if (!level) level = localStorage.getItem('flipodLevel');
    return adaptationFor(level);
  }

  /* ── CEFR × Pass rate matrix (Task D B28 修正, 2026-04-17) ──
   * Pass 4 一律 ≤ 1.00：盲听阶段不加速，否则干扰理解。
   * A1 独立行（不折叠到 A2），C2 折叠到 C1。
   */
  var CEFR_PASS_RATE = {
    A1: { 1: 0.70, 2: 0.80, 3: 0.90, 4: 0.90 },
    A2: { 1: 0.80, 2: 0.88, 3: 0.96, 4: 1.00 },
    B1: { 1: 0.85, 2: 0.94, 3: 1.00, 4: 1.00 },
    B2: { 1: 0.90, 2: 1.00, 3: 1.00, 4: 1.00 },
    C1: { 1: 1.00, 2: 1.00, 3: 1.00, 4: 1.00 }
  };
  function getPassRate(passNum) {
    var level = String(getUserCefrLevel() || 'B1').toUpperCase();
    if (level === 'C2') level = 'C1';
    var row = CEFR_PASS_RATE[level] || CEFR_PASS_RATE.B1;
    return row[passNum] || 1.0;
  }
  var TOPIC_LABELS = {
    business: 'Business',
    psychology: 'Psychology',
    science: 'Science',
    story: 'Storytelling',
    culture: 'Culture',
    tech: 'Tech',
    society: 'Society',
    general: 'General'
  };
  // B17: category tag is an enum on the practice card. LLM returns it; we
  // fall back to inferring from target word tags.
  var ALLOWED_CATEGORIES = ['business', 'psychology', 'science', 'tech', 'culture', 'general'];
  var CATEGORY_LABELS_ZH = {
    business: '商业', psychology: '心理', science: '科学',
    tech: '科技', culture: '文化', general: '通识'
  };
  function inferCategoryFromWords(words) {
    if (!words || !words.length) return 'general';
    var tagCounts = {};
    words.forEach(function (w) {
      var t = null;
      if (typeof w === 'string') return;
      if (w.tag) t = w.tag;
      else if (w.topic) t = w.topic;
      if (t) tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
    var top = Object.keys(tagCounts).sort(function (a, b) { return tagCounts[b] - tagCounts[a]; })[0];
    return (top && ALLOWED_CATEGORIES.indexOf(top) !== -1) ? top : 'general';
  }
  function resolveCategory(practice) {
    if (practice && ALLOWED_CATEGORIES.indexOf(practice.category) !== -1) return practice.category;
    if (practice && practice.topicKey && ALLOWED_CATEGORIES.indexOf(practice.topicKey) !== -1) return practice.topicKey;
    // practice.target_words can be a plain string[] — fall back to topicKey then 'general'.
    return 'general';
  }
  // B37: normalize MCQ into canonical shape { q, options[4], correct, explanation }.
  // LLM sometimes returns 2/3 options, or the old gist_options_zh shape. Coerce
  // so the renderer always sees exactly 4 items. Options shorter than expected
  // get a disabled placeholder.
  function normalizeMcq(practice) {
    if (!practice) return;
    var mcq = practice.mcq;
    if (!mcq || !Array.isArray(mcq.options)) {
      // Migrate from legacy gist shape.
      if (practice.gist && Array.isArray(practice.gist.options) && practice.gist.options.length >= 2) {
        var legacy = practice.gist.options;
        var correctIdx = legacy.findIndex(function (o) { return o && o.correct; });
        if (correctIdx < 0) correctIdx = 0;
        mcq = {
          q: practice.gist.question || 'What is the main point of this passage?',
          options: legacy.map(function (o) { return o && o.text ? String(o.text) : String(o); }),
          correct: correctIdx,
          explanation: practice.gist.explanation_zh || ''
        };
      } else {
        practice.mcq = null;
        return;
      }
    }
    // Trim or pad to exactly 4 options.
    if (mcq.options.length > 4) mcq.options = mcq.options.slice(0, 4);
    while (mcq.options.length < 4) mcq.options.push('— 无此选项 —');
    if (!Number.isInteger(mcq.correct) || mcq.correct < 0 || mcq.correct > 3) mcq.correct = 0;
    if (!mcq.q) mcq.q = 'What is the main point of this passage?';
    if (!mcq.explanation) mcq.explanation = '';
    practice.mcq = mcq;
  }

  var TEMPLATE_BANK = {
    business: [
      {
        title: function (words) { return 'The Startup That Chased a Better ' + cap(words[0].word); },
        lines: function (words) {
          return [
            pair('A small coffee startup in Seoul set one goal for the year: beat its old ' + words[0].word + '.', '首尔一家小型咖啡创业公司给自己定了一个年度目标：超过旧的 ' + words[0].word + '。'),
            pair('That sounded easy until signs of ' + words[1].word + ' began to spread through the city.', '这听起来并不难，直到城市里开始出现 ' + words[1].word + ' 的迹象。'),
            pair('Office workers brought lunch from home, students skipped iced drinks, and every new expense suddenly felt risky.', '上班族开始自己带午餐，学生不再买冰饮，每一笔新开销突然都显得有风险。'),
            pair('The founder stopped talking about growth and started talking about one number instead: ' + words[2].word + '.', '创始人不再谈增长，而是只盯着一个数字：' + words[2].word + '。'),
            pair('If that number stayed alive, the company could survive the winter and wait for confidence to return.', '如果这个数字还能撑住，公司就能熬过冬天，等消费者信心回来。'),
            pair('By spring, they had not become famous, but they had become disciplined, and that turned out to matter more.', '到了春天，他们并没有爆红，但变得更有纪律，而事实证明这更重要。'),
            pair('Sometimes the companies that last are not the ones that expand fastest, but the ones that learn when to hold still.', '有时候，活得最久的公司并不是扩张最快的，而是最懂得什么时候该稳住的公司。')
          ];
        },
        gist: function (words) {
          return {
            question: 'What is the main point of this passage?',
            options: [
              { text: 'A startup survives a difficult economy by focusing on stability instead of fast growth', correct: true },
              { text: 'A coffee company becomes famous because consumers spend more during a recession', correct: false },
              { text: 'The founder decides that benchmarks and revenue are useless for small businesses', correct: false }
            ],
            explanation_zh: '这段音频的重点是：在经济变差时，这家公司不再追求快速增长，而是先保住关键数字，稳住生存。'
          };
        }
      }
    ],
    psychology: [
      {
        title: function (words) { return 'The First Impression That Would Not Leave'; },
        lines: function (words) {
          return [
            pair('At a design studio in Shanghai, a new manager joined the team and said almost nothing for the first week.', '在上海一家设计工作室，一位新经理加入团队后的第一周几乎什么都没说。'),
            pair('People made quick guesses anyway, because the human brain loves a fast ' + words[0].word + ' shortcut.', '但大家还是很快下了判断，因为人脑天生喜欢这种快速的 ' + words[0].word + ' 捷径。'),
            pair('Some thought she was cold. Others thought she was hiding something. That was their ' + words[1].word + ' speaking before any real evidence appeared.', '有人觉得她很冷淡，有人觉得她在隐瞒什么。这其实是他们的 ' + words[1].word + ' 在证据出现前先发声了。'),
            pair('Then one intern stayed late and saw the manager quietly rewriting a teammate\'s proposal to protect him from a harsh client.', '后来，一位实习生加班时看到这位经理默默重写同事的提案，只是为了帮对方挡住一个苛刻客户。'),
            pair('The story spread, and suddenly the room changed. People who had judged her too quickly began to feel a little embarrassed.', '这个故事传开后，办公室的气氛突然变了。那些过早下判断的人开始有点尴尬。'),
            pair('What shifted them was not more data, but a small moment of ' + words[2].word + '.', '真正让他们改变的，不是更多数据，而是一点点 ' + words[2].word + '。'),
            pair('Once they imagined what pressure she might be carrying, their first impression lost its power.', '一旦他们开始想象她背负的压力，最初的印象就失去了支配力。')
          ];
        },
        gist: function (words) {
          return {
            question: 'What does the passage suggest?',
            options: [
              { text: 'People can revise unfair first impressions when empathy replaces bias', correct: true },
              { text: 'The team dislikes the new manager because she lacks cognitive skill', correct: false },
              { text: 'The intern proves that first impressions are usually accurate', correct: false }
            ],
            explanation_zh: '这段音频想表达的是：最初的偏见会让人误判他人，但一旦产生共情，判断就可能被修正。'
          };
        }
      }
    ],
    science: [
      {
        title: function (words) { return 'The Lab Mistake That Changed the Result'; },
        lines: function (words) {
          return [
            pair('A university lab in Singapore thought it had ruined a week of work when one sample changed color too early.', '新加坡一所大学的实验室本以为毁掉了一周的工作，因为有个样本过早变了颜色。'),
            pair('The team had started with a simple ' + words[0].word + ': heat would make the reaction slower, not faster.', '团队一开始的 ' + words[0].word + ' 很简单：升温会让反应变慢，而不是变快。'),
            pair('But when they looked closer, they found that one tiny ' + words[1].word + ' in the sample was arranged differently than expected.', '但当他们仔细看时，发现样本里有一个微小的 ' + words[1].word + ' 排列方式和预期不同。'),
            pair('That small change let a hidden ' + words[2].word + ' do its job more efficiently.', '这个微小变化让一个隐藏的 ' + words[2].word + ' 发挥了更高效率。'),
            pair('What looked like a failed experiment slowly became the most interesting result in the room.', '起初看起来像失败实验的东西，慢慢变成了实验室里最有趣的结果。'),
            pair('No one celebrated immediately, because good scientists are suspicious of exciting surprises.', '没人立刻庆祝，因为好的科学家会警惕那些过于令人兴奋的意外。'),
            pair('Still, by the end of the month, the mistake had opened a new direction for the whole project.', '但到了月底，这个“错误”已经为整个项目打开了一个新方向。')
          ];
        },
        gist: function (words) {
          return {
            question: 'What is the passage mainly about?',
            options: [
              { text: 'A surprising lab result turns a seeming failure into a new research direction', correct: true },
              { text: 'Researchers prove that every hypothesis about heat is wrong', correct: false },
              { text: 'A molecule is destroyed because the catalyst is removed', correct: false }
            ],
            explanation_zh: '这段音频的重点是：一个看似失败的实验结果，最后反而带来了新的研究方向。'
          };
        }
      }
    ],
    story: [
      {
        title: function (words) { return 'The Letter Hidden in the Old Book'; },
        lines: function (words) {
          return [
            pair('On the last day before a bookstore closed, a university student bought a damaged novel for almost nothing.', '一家书店关门前的最后一天，一名大学生几乎没花多少钱买下了一本破旧小说。'),
            pair('The book itself was ordinary, but its ' + words[0].word + ' changed the moment a folded letter slipped from the middle pages.', '书本身很普通，但当一封折起来的信从中间掉出来时，它的 ' + words[0].word + ' 突然变了。'),
            pair('The letter was unsigned. It described a promise, a missed train, and a return that never happened.', '那封信没有署名，里面写着一个承诺、一趟错过的火车，以及一次从未发生的归来。'),
            pair('The student now faced a ' + words[1].word + ': keep the letter as part of the mystery, or search for the family it belonged to.', '这个学生立刻面对一个 ' + words[1].word + '：把信留作谜团的一部分，还是去寻找它原本属于的那个家庭。'),
            pair('One sentence kept repeating the image of rain against a station window, and it worked like a quiet ' + words[2].word + ' for regret.', '信里有一句话不断提到雨打车站窗户的画面，它像一种安静的 ' + words[2].word + '，指向遗憾。'),
            pair('Weeks later, after many dead ends, the student found the writer\'s granddaughter in another city.', '几周后，经历多次碰壁，这名学生在另一座城市找到了写信人的孙女。'),
            pair('She cried, laughed, and said the letter had been missing longer than she had been alive.', '她一边哭一边笑，说这封信丢失的时间，比她活着的时间还长。')
          ];
        },
        gist: function (words) {
          return {
            question: 'What is the passage mainly explaining?',
            options: [
              { text: 'A student finds a hidden letter and decides to trace its owner', correct: true },
              { text: 'A bookstore owner writes a novel about a rainy train station', correct: false },
              { text: 'The student keeps the letter and never learns anything about it', correct: false }
            ],
            explanation_zh: '这段音频讲的是：学生在旧书里发现信件后，决定寻找它原本的主人，最后真的找到了对方家人。'
          };
        }
      }
    ],
    general: [
      {
        title: function (words) { return 'Three Small Words, One Unexpected Story'; },
        lines: function (words) {
          return [
            pair('A late-night radio host once said that the best stories begin with three ordinary details that should not belong together.', '一位深夜电台主持人曾说，最好的故事都始于三个本不该放在一起的普通细节。'),
            pair('One evening, his three details were ' + words[0].word + ', ' + words[1].word + ', and ' + words[2].word + '.', '一天晚上，他给出的三个细节是：' + words[0].word + '、' + words[1].word + ' 和 ' + words[2].word + '。'),
            pair('Listeners laughed at first, but then one caller explained that the three words described the day she decided to leave her old life.', '听众一开始都笑了，但随后一位来电者解释说，这三个词正好描述了她决定离开旧生活的那一天。'),
            pair('She heard the first word on a station speaker, saw the second one painted on a truck, and kept repeating the third one to calm herself down.', '她在车站广播里听到第一个词，在一辆卡车上看到第二个词，又不断重复第三个词让自己冷静。'),
            pair('None of the words sounded special alone, but together they formed a private map.', '每个词单独看都不特别，但合在一起却像一张私人地图。'),
            pair('Years later, she still remembered them more clearly than the address she moved to.', '多年以后，她对这三个词的记忆，甚至比新搬去的地址还清楚。'),
            pair('Maybe that is why language stays with people: words can become markers for turning points, not just labels for things.', '也许这就是语言会留在人心里的原因：词语不只是事物的标签，也会成为人生转折的标记。')
          ];
        },
        gist: function (words) {
          return {
            question: 'What is the main message of this passage?',
            options: [
              { text: 'Ordinary words can become meaningful when they attach to important life moments', correct: true },
              { text: 'A radio host teaches listeners how to memorize street addresses', correct: false },
              { text: 'The caller forgets the three words soon after moving away', correct: false }
            ],
            explanation_zh: '这段音频的重点是：普通词语一旦和人生的重要时刻连在一起，就会变得特别难忘。'
          };
        }
      }
    ]
  };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function cefrClass(level) {
    return 'lp-cefr-' + (level || 'b1').toLowerCase();
  }

  function pair(en, zh) {
    return { en: en, zh: zh };
  }

  function cap(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function slugify(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function safeJSONParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function normalizeWordEntry(item, idx) {
    var addedAt = item && (item.timestamp || item.added || item.createdAt);
    var time = Date.parse(addedAt);
    return {
      word: String((item && item.word) || '').trim(),
      cefr: String((item && item.cefr) || '').toUpperCase() || 'B1',
      definition_zh: (item && (item.definition_zh || item.contextZh || item.context || '')) || '',
      tag: String((item && item.tag) || 'general').toLowerCase(),
      addedAt: isNaN(time) ? (Date.now() - idx) : time
    };
  }

  function getVocab() {
    var raw = safeJSONParse(localStorage.getItem('flipodVocab') || '[]', []);
    var byWord = {};
    raw.forEach(function (item, idx) {
      var normalized = normalizeWordEntry(item, idx);
      if (!normalized.word) return;
      var key = normalized.word.toLowerCase();
      if (!byWord[key] || normalized.addedAt > byWord[key].addedAt) byWord[key] = normalized;
    });
    return Object.keys(byWord).map(function (key) { return byWord[key]; })
      .sort(function (a, b) { return b.addedAt - a.addedAt; });
  }

  function getPracticeState() {
    var state = safeJSONParse(localStorage.getItem(STORAGE_KEY) || '{}', {});
    return {
      lastGeneratedAt: state.lastGeneratedAt || 0,
      lastVocabCountAtGeneration: state.lastVocabCountAtGeneration || 0,
      pendingPractices: Array.isArray(state.pendingPractices) ? state.pendingPractices : [],
      completedPractices: Array.isArray(state.completedPractices) ? state.completedPractices : [],
      generationVersion: state.generationVersion || 1,
      // B16/B18: generation status is read by _renderSelect to pick the view.
      generating: !!state.generating,
      lastGenerationError: state.lastGenerationError || null
    };
  }

  function savePracticeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updatePracticeBadge(state);
  }

  function updatePracticeBadge(state) {
    var badge = document.getElementById('sp-practice-count');
    if (!badge) return;
    var current = state || getPracticeState();
    badge.textContent = current.pendingPractices.length || '0';
  }

  function clampLevel(level) {
    if (LEVEL_ORDER[level]) return level;
    return 'B1';
  }

  /* ── CEFR overrides (manual fixes for CEFR-J over-grading) ── */
  // Loaded async at init; lookups before load fall back to whatever the caller
  // already knows (e.g. cefr stored on the word). After load, callers can
  // call lookupCefr(rawWord) to apply override-aware lookup.
  function normalizeCefrKey(raw) {
    return String(raw || '').replace(/[^a-zA-Z']/g, '').toLowerCase();
  }
  function lookupCefr(rawWord, fallback) {
    var key = normalizeCefrKey(rawWord);
    if (!key) return fallback;
    var ov = window._cefrOverrides;
    if (ov && Object.prototype.hasOwnProperty.call(ov, key)) return ov[key];
    var map = window._cefrMap;
    if (map && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
    return fallback;
  }
  function loadCefrOverrides() {
    if (window._cefrOverridesLoading) return window._cefrOverridesLoading;
    window._cefrOverridesLoading = fetch('/cefr_overrides.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var raw = (data && data.overrides) || {};
        var out = {};
        Object.keys(raw).forEach(function (k) {
          var key = normalizeCefrKey(k);
          if (key && raw[k]) out[key] = String(raw[k]).toUpperCase();
        });
        window._cefrOverrides = out;
        // also seed window._cefrMap so spread-merge semantics from the brief
        // are preserved (overrides take precedence in lookupCefr above)
        window._cefrMap = window._cefrMap || {};
        Object.assign(window._cefrMap, out);
        return out;
      })
      .catch(function () { window._cefrOverrides = window._cefrOverrides || {}; return window._cefrOverrides; });
    return window._cefrOverridesLoading;
  }

  function derivePracticeLevel(words, userLevel) {
    var sum = 0;
    var count = 0;
    words.forEach(function (w) {
      // Apply override-aware lookup: if the raw word has an override entry,
      // use it; otherwise fall back to the cefr field already on the word.
      var resolved = lookupCefr(w.word, w.cefr);
      var n = LEVEL_ORDER[clampLevel(resolved)];
      if (n) { sum += n; count++; }
    });
    var avg = count ? Math.round(sum / count) : LEVEL_ORDER[clampLevel(userLevel)];
    var bounded = Math.max(1, Math.min(6, avg));
    return LEVEL_LABELS[bounded - 1];
  }

  function lineTargets(text, words) {
    return words.filter(function (w) {
      return new RegExp('\\b' + w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text);
    }).map(function (w) { return w.word; });
  }

  function addTiming(lines, words) {
    var cursor = 0;
    return lines.map(function (line) {
      var duration = Math.max(3.6, Math.min(7.5, line.en.split(/\s+/).length * 0.52));
      var withTiming = {
        en: line.en,
        zh: line.zh,
        target_words: lineTargets(line.en, words),
        start: Number(cursor.toFixed(1)),
        end: Number((cursor + duration).toFixed(1))
      };
      cursor += duration;
      return withTiming;
    });
  }

  function practiceSnapshot(item) {
    return {
      id: item.id,
      title: item.title,
      tag: item.tag,
      cefr: item.cefr,
      target_words: item.target_words.slice(),
      completedAt: Date.now()
    };
  }

  function pickTemplate(tag) {
    var bank = TEMPLATE_BANK[tag] || TEMPLATE_BANK.general;
    return bank[0];
  }

  function buildPractice(words, index, userLevel) {
    var tag = (words[0] && words[0].tag) || 'general';
    var template = pickTemplate(tag);
    var timedLines = addTiming(template.lines(words), words);
    var category = ALLOWED_CATEGORIES.indexOf(tag) !== -1 ? tag : inferCategoryFromWords(words);
    return {
      id: 'lp-' + Date.now() + '-' + index + '-' + slugify(words.map(function (w) { return w.word; }).join('-')),
      title: template.title(words),
      tag: TOPIC_LABELS[tag] || cap(tag),
      category: category,
      cefr: derivePracticeLevel(words, userLevel),
      topicKey: tag,
      target_words: words.map(function (w) { return w.word; }),
      text: timedLines.map(function (line) { return line.en; }).join(' '),
      lines: timedLines,
      vocabulary: words.map(function (w) {
        return {
          word: w.word,
          definition_zh: w.definition_zh || '',
          cefr: clampLevel(w.cefr)
        };
      }),
      gist: template.gist(words),
      generatedAt: Date.now()
    };
  }

  function chooseWordsForPractice(pool, interests) {
    if (pool.length < 3) return null;
    var groups = {};
    pool.forEach(function (item) {
      var key = item.tag || 'general';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    var preferred = Object.keys(groups).sort(function (a, b) {
      var aScore = (interests.indexOf(a) !== -1 ? 100 : 0) + groups[a].length;
      var bScore = (interests.indexOf(b) !== -1 ? 100 : 0) + groups[b].length;
      return bScore - aScore;
    });
    var chosenTag = preferred[0];
    var picked = groups[chosenTag].slice(0, 3);
    if (picked.length < 3) {
      pool.forEach(function (item) {
        if (picked.length >= 3) return;
        if (!picked.some(function (existing) { return existing.word.toLowerCase() === item.word.toLowerCase(); })) {
          picked.push(item);
        }
      });
    }
    return picked.length >= 3 ? picked.slice(0, 3) : null;
  }

  function nextGenerationCandidates(vocab, state) {
    var recent = state.completedPractices.slice(-3).reduce(function (acc, item) {
      (item.target_words || []).forEach(function (word) { acc[word.toLowerCase()] = true; });
      return acc;
    }, {});
    var pending = state.pendingPractices.reduce(function (acc, item) {
      (item.target_words || []).forEach(function (word) { acc[word.toLowerCase()] = true; });
      return acc;
    }, {});
    var filtered = vocab.filter(function (item) {
      var key = item.word.toLowerCase();
      return !recent[key] && !pending[key];
    });
    if (filtered.length >= 3) return filtered;
    var withoutPending = vocab.filter(function (item) { return !pending[item.word.toLowerCase()]; });
    return withoutPending.length >= 3 ? withoutPending : vocab.slice();
  }

  function pruneCompleted(state) {
    if (state.pendingPractices.length <= MAX_PENDING) return;
    state.completedPractices.sort(function (a, b) { return (a.completedAt || 0) - (b.completedAt || 0); });
    while (state.pendingPractices.length > MAX_PENDING && state.completedPractices.length > 0) {
      state.completedPractices.shift();
    }
    if (state.pendingPractices.length > MAX_PENDING) {
      state.pendingPractices = state.pendingPractices.slice(0, MAX_PENDING);
    }
  }

  /* ── Task F · 综合评分 ──
   * PRD §7 选词评分: 新鲜度 60% + 兴趣 tag 30% + 水平差 10% + interest bonus +100
   */
  var CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  function getUserCefrLevel() {
    try {
      var prof = JSON.parse(localStorage.getItem('flipodUserProfile') || '{}');
      if (prof && prof.cefrLevel) return String(prof.cefrLevel).toUpperCase();
    } catch (e) {}
    return String(localStorage.getItem('flipodLevel') || 'B1').toUpperCase();
  }
  function scoreVocabCandidates(vocab, state, interests, userCefr) {
    var pendingSet = {};
    (state.pendingPractices || []).forEach(function (p) {
      (p.target_words || []).forEach(function (w) { pendingSet[String(w).toLowerCase()] = true; });
    });
    var recentSet = {};
    (state.completedPractices || []).slice(-3).forEach(function (p) {
      (p.target_words || []).forEach(function (w) { recentSet[String(w).toLowerCase()] = true; });
    });
    var userIdx = CEFR_ORDER.indexOf(userCefr);
    if (userIdx < 0) userIdx = 2;
    var lowerInterests = (interests || []).map(function (i) { return String(i || '').toLowerCase(); });

    return (vocab || []).map(function (item) {
      var key = String(item.word || '').toLowerCase();
      if (!key) return { item: item, score: -1 };
      if (pendingSet[key] || recentSet[key]) return { item: item, score: -1 };

      var savedAt = item.savedAt || item.timestamp || item.addedAt || Date.now();
      var ageDays = (Date.now() - savedAt) / 86400000;
      var freshness = Math.max(0.3, 1 - ageDays / 14);
      var freshScore = 60 * freshness;

      var tagLower = String(item.tag || '').toLowerCase();
      var tagMatch = tagLower && lowerInterests.indexOf(tagLower) !== -1;
      var interestScore = tagMatch ? 30 : 0;

      var itemIdx = CEFR_ORDER.indexOf(String(item.cefr || '').toUpperCase());
      if (itemIdx < 0) itemIdx = userIdx;
      var diff = Math.abs(itemIdx - userIdx);
      var levelScore = diff === 0 ? 10 : diff === 1 ? 8 : diff === 2 ? 3 : 0;

      var interestBonus = tagMatch ? 100 : 0;

      return { item: item, score: freshScore + interestScore + levelScore + interestBonus };
    }).filter(function (x) { return x.score >= 0; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  /* ── Task F · LLM 调用前端 ── */
  var _genInFlight = false;
  function fetchGeneratedPractice(words, interests, userCefr) {
    return fetch('/api/practice/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_words: words.map(function (w) {
          return { word: w.word, cefr: w.cefr, tag: w.tag, definition_zh: w.definition_zh };
        }),
        interests: interests,
        user_cefr: userCefr
      })
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error('HTTP ' + resp.status);
          err.status = resp.status;
          err.body = body;
          throw err;
        });
      }
      return resp.json();
    }).then(function (json) {
      if (!json || !json.practice) throw new Error('no practice in response');
      return json.practice;
    });
  }

  /**
   * Task F: async batch generator. Tries LLM per slot; falls back to template
   * (`buildPractice`) on failure so the user never sees an empty list.
   * Returns Promise<Array<practice>>.
   */
  function generateBatchAsync(vocab, state, options) {
    options = options || {};
    var interests = safeJSONParse(localStorage.getItem('flipodInterests') || '[]', [])
      .map(function (item) { return String(item || '').toLowerCase(); });
    var userCefr = getUserCefrLevel();
    var userLevelClamped = clampLevel(userCefr);
    var requested = Math.min(options.count || BATCH_SIZE, MAX_PENDING - state.pendingPractices.length);
    if (requested <= 0) return Promise.resolve([]);

    var scored = scoreVocabCandidates(vocab, state, interests, userCefr);
    if (scored.length < 3) return Promise.resolve([]);

    var pool = scored.map(function (s) { return s.item; });
    var batchTrigger = options.trigger || 'unknown';

    function pickNext(localPool) {
      if (localPool.length < 3) return null;
      // Prefer interest-tag match; fall back to top-3.
      var byInterest = localPool.filter(function (i) {
        return i.tag && interests.indexOf(String(i.tag).toLowerCase()) !== -1;
      });
      var picked = (byInterest.length >= 3 ? byInterest : localPool).slice(0, 3);
      return picked.length === 3 ? picked : null;
    }

    track('practice.batch_generated.start', {
      trigger: batchTrigger,
      count_requested: requested,
      target_words: pool.slice(0, requested * 3).map(function (i) { return i.word; })
    });

    var results = [];
    var fallbackCount = 0;
    var totalDuration = 0;

    function step(i) {
      if (i >= requested) return Promise.resolve();
      var words = pickNext(pool);
      if (!words) return Promise.resolve();
      var used = {};
      words.forEach(function (w) { used[String(w.word).toLowerCase()] = true; });
      pool = pool.filter(function (w) { return !used[String(w.word).toLowerCase()]; });

      var startedAt = Date.now();
      return fetchGeneratedPractice(words, interests, userCefr)
        .then(function (practice) {
          totalDuration += Date.now() - startedAt;
          // Stamp generation source if missing.
          if (!practice.generationVersion) practice.generationVersion = 'v3.0.0';
          practice.generatedBy = practice.generatedBy || 'llm';
          results.push(practice);
        })
        .catch(function (err) {
          totalDuration += Date.now() - startedAt;
          fallbackCount += 1;
          console.warn('[practice-gen] LLM failed, falling back to template:', err && err.message);
          track('practice.generation_failed', {
            reason: (err && err.message) || 'unknown',
            retry_count: 0,
            target_words: words.map(function (w) { return w.word; })
          });
          var mock = buildPractice(words, i, userLevelClamped);
          mock.generatedBy = 'template_fallback';
          mock.generationVersion = 'template-v1';
          results.push(mock);
        })
        .then(function () { return step(i + 1); });
    }

    return step(0).then(function () {
      track('practice.batch_generated', {
        count: results.length,
        reason: batchTrigger,
        duration_ms: totalDuration,
        fallback_used: fallbackCount > 0,
        fallback_count: fallbackCount
      });
      return results;
    });
  }

  /**
   * Legacy sync template-only batch (kept for any caller still expecting sync).
   * New code paths should use generateBatchAsync.
   */
  function generateBatch(vocab, state, options) {
    options = options || {};
    var interests = safeJSONParse(localStorage.getItem('flipodInterests') || '[]', []).map(function (item) {
      return String(item || '').toLowerCase();
    });
    var userLevel = clampLevel(localStorage.getItem('flipodLevel') || 'B1');
    var pool = nextGenerationCandidates(vocab, state);
    var batch = [];
    var requested = Math.min(options.count || BATCH_SIZE, MAX_PENDING - state.pendingPractices.length);
    for (var i = 0; i < requested; i++) {
      var words = chooseWordsForPractice(pool, interests);
      if (!words) break;
      var p = buildPractice(words, i, userLevel);
      p.generatedBy = 'template';
      p.generationVersion = 'template-v1';
      batch.push(p);
      var used = {};
      words.forEach(function (item) { used[item.word.toLowerCase()] = true; });
      pool = pool.filter(function (item) { return !used[item.word.toLowerCase()]; });
    }
    return batch;
  }

  function track(name, payload) {
    if (typeof window._track === 'function') {
      try { window._track(name, payload); } catch (e) {}
    }
    try { console.debug('[track]', name, payload); } catch (e) {}
  }

  /** Highlight target words in an English sentence */
  function highlightTargets(text, targets) {
    if (!targets || !targets.length) return text;
    var escaped = targets.map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    var re = new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi');
    return text.replace(re, '<span class="lp-target">$1</span>');
  }

  function esc(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildCaptionHtml(line, mode) {
    if (mode === 'zh') {
      return '<div class="lp-line-zh-only">' + esc(line.zh) + '</div>';
    }

    if (mode === 'en-full') {
      return '<div class="lp-line-en">' + highlightTargets(esc(line.en), line.target_words) + '</div>';
    }

    if (mode === 'en-fade') {
      var adapt = getUserAdaptation();
      var density = adapt.fadeDensity || 3;
      var fadeAdjacent = !!adapt.fadeAdjacent;
      var tokens = line.en.split(/(\s+)/);

      // First pass: figure out which non-target word indexes get masked.
      var nonTargetCount = 0;
      var maskTokenIdx = {};
      tokens.forEach(function (token, idx) {
        if (!token.trim()) return;
        var isTarget = (line.target_words || []).some(function (word) {
          return token.replace(/[^\w'-]/g, '').toLowerCase() === word.toLowerCase();
        });
        if (isTarget) return;
        nonTargetCount += 1;
        if (nonTargetCount % density === 0) {
          maskTokenIdx[idx] = true;
        }
      });
      // C1+ extra: also mask the immediate neighbor word tokens of each mask.
      if (fadeAdjacent) {
        Object.keys(maskTokenIdx).forEach(function (k) {
          var i = parseInt(k, 10);
          // walk left until previous word token
          for (var l = i - 1; l >= 0; l--) {
            if (tokens[l].trim()) { maskTokenIdx[l] = true; break; }
          }
          for (var r = i + 1; r < tokens.length; r++) {
            if (tokens[r].trim()) { maskTokenIdx[r] = true; break; }
          }
        });
      }

      var html = tokens.map(function (token, idx) {
        if (!token.trim()) return token;
        var isTarget = (line.target_words || []).some(function (word) {
          return token.replace(/[^\w'-]/g, '').toLowerCase() === word.toLowerCase();
        });
        if (isTarget) {
          return '<span class="lp-target lp-fade-keep">' + esc(token) + '</span>';
        }
        if (maskTokenIdx[idx]) {
          return '<span class="lp-fade-mask">····</span>';
        }
        return '<span class="lp-fade-soft">' + esc(token) + '</span>';
      }).join('');
      return '<div class="lp-line-en lp-line-en-fade">' + html + '</div>';
    }

    return '<div class="lp-line-en">' + esc(line.en) + '</div>';
  }

  function renderLines(lines, mode, reviewMode) {
    return lines.map(function (line, i) {
      var reviewAttrs = reviewMode ? ' data-action="toggle-line" data-line-idx="' + i + '"' : '';
      var reviewClass = reviewMode ? ' lp-line-review' : '';
      var body = buildCaptionHtml(line, mode);
      if (reviewMode) {
        body = '<div class="lp-line-en">' + esc(line.en) + '</div>' +
          '<div class="lp-line-zh lp-hidden">' + esc(line.zh) + '</div>';
      }
      return '<div class="lp-line' + reviewClass + '" data-line="' + i + '"' + reviewAttrs + '>' + body + '</div>';
    }).join('');
  }

  /* ── TTS / audio playback ── */
  var _audioUrlCache = {};
  var _activeAudio = null;

  /**
   * Speak text via local /api/tts endpoint, returning a Promise that resolves
   * when playback finishes or fails.
   */
  function speakText(text, rate) {
    return new Promise(function (resolve) {
      var resolved = false;
      var requestId = Date.now() + Math.random();

      function done() {
        if (resolved) return;
        resolved = true;
        resolve();
      }

      fetchAudioUrl(text).then(function (audioUrl) {
        if (!audioUrl) { done(); return; }
        if (_activeAudio) {
          _activeAudio.pause();
          _activeAudio.currentTime = 0;
          _activeAudio = null;
        }
        var audio = new Audio(audioUrl);
        audio.preload = 'auto';
        audio.playbackRate = rate || 1.0;
        // Preserve pitch when slowing/speeding (Safari + Chrome).
        try { audio.preservesPitch = true; } catch (e) { /* older browsers */ }
        audio.__lpRequestId = requestId;
        _activeAudio = audio;
        audio.onended = function () {
          if (_activeAudio === audio) _activeAudio = null;
          done();
        };
        audio.onerror = function (ev) {
          console.warn('[LP-TTS] audio error:', ev);
          if (_activeAudio === audio) _activeAudio = null;
          done();
        };
        audio.play().catch(function (err) {
          console.warn('[LP-TTS] play() failed:', err);
          if (_activeAudio === audio) _activeAudio = null;
          done();
        });
      }).catch(function (err) {
        console.warn('[LP-TTS] fetch failed:', err);
        done();
      });
    });
  }

  function fetchAudioUrl(text) {
    if (_audioUrlCache[text]) return Promise.resolve(_audioUrlCache[text]);
    return fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    }).then(function (resp) {
      if (!resp.ok) throw new Error('TTS HTTP ' + resp.status);
      return resp.blob();
    }).then(function (blob) {
      var objectUrl = URL.createObjectURL(blob);
      _audioUrlCache[text] = objectUrl;
      return objectUrl;
    });
  }

  function cancelTTS() {
    if (_activeAudio) {
      _activeAudio.pause();
      _activeAudio.currentTime = 0;
      _activeAudio.onended = null;
      _activeAudio.onerror = null;
      _activeAudio = null;
    }
  }

  function scheduleLineHighlights(lineEls, lines) {
    var startedAt = Date.now();
    var plannedTotal = lines.length ? lines[lines.length - 1].end : 0;
    var timer = setInterval(function () {
      var elapsed = (Date.now() - startedAt) / 1000;
      var modelElapsed = elapsed;
      if (_activeAudio) {
        elapsed = _activeAudio.currentTime || 0;
        if (_activeAudio.duration && isFinite(_activeAudio.duration) && plannedTotal > 0) {
          modelElapsed = elapsed / (_activeAudio.duration / plannedTotal);
        } else {
          modelElapsed = elapsed;
        }
      }
      var activeIndex = -1;
      lineEls.forEach(function (el, idx) {
        var line = lines[idx];
        var isActive = modelElapsed >= line.start && modelElapsed < line.end;
        var isPlayed = modelElapsed >= line.end;
        el.classList.toggle('active', isActive);
        el.classList.toggle('played', isPlayed);
        if (isActive) activeIndex = idx;
      });
      if (activeIndex >= 0 && lineEls[activeIndex]) {
        lineEls[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 180);
    return timer;
  }

  /* ── Controller ── */
  function ListeningPracticeController(overlayEl) {
    this.overlay = overlayEl;
    this.state = State.INIT;
    this.practice = null;      // current practice data
    this.r2Answers = {};       // {blankId: {correct: bool, word: str}}
    this.r3Answers = {};
    this.ttsPlaying = false;
    this.ttsCancelled = false;
    this._boundClick = this._onClick.bind(this);
    this._boundInput = this._onInput.bind(this);
    overlayEl.addEventListener('click', this._boundClick);
    overlayEl.addEventListener('input', this._boundInput);
  }

  /** Pause the main feed audio when entering practice */
  function pauseFeedAudio() {
    if (window.audios && window.audios.length) {
      window.audios.forEach(function (a) { if (a && !a.paused) a.pause(); });
    }
  }

  ListeningPracticeController.prototype.open = function (arg) {
    // Stop feed audio — don't blast two things at once
    pauseFeedAudio();

    var vocab = getVocab();

    this.overlay.innerHTML = '';
    this.overlay.classList.add('open');

    // arg may be: undefined (default flow) | true (forceUnlock debug) | string (practiceId to launch directly)
    var forceUnlock = (arg === true);
    var practiceId = (typeof arg === 'string' && arg) ? arg : null;

    if (forceUnlock || (vocab.length < UNLOCK_COUNT && !practiceId)) {
      this._renderUnlock(forceUnlock ? 2 : vocab.length);
      return;
    }
    var self = this;
    var supplyPromise = this._ensurePracticeSupply(vocab);
    if (practiceId) {
      try { this.startPractice(practiceId); return; }
      catch (e) { /* fall through to select */ }
    }
    this._renderSelect();
    // After async LLM batch completes, re-render select if user is still on it.
    if (supplyPromise && typeof supplyPromise.then === 'function') {
      supplyPromise.then(function (updated) {
        if (updated && self.state === State.INIT && self.overlay.classList.contains('open')) {
          self._renderSelect();
        }
      });
    }
  };

  ListeningPracticeController.prototype.close = function () {
    cancelTTS();
    this.ttsPlaying = false;
    this.ttsCancelled = true;
    this.state = State.INIT;
    this.practice = null;
    this.overlay.classList.remove('open');
    // Close the sidebar too
    var sidebar = document.getElementById('side-panel');
    if (sidebar) sidebar.classList.remove('open');
  };

  ListeningPracticeController.prototype.transition = function (event) {
    var t = transitions[this.state];
    if (!t || !(event in t)) return;
    var next = t[event];
    if (next === null) { this.close(); return; }
    this.state = next;
    this._render();
  };

  ListeningPracticeController.prototype._render = function () {
    switch (this.state) {
      case State.PASS1: this._renderPass('zh', 1, '第 1 遍 · 全中文字幕', '先理解内容大意，降低进入门槛。'); break;
      case State.PASS2: this._renderPass('en-full', 2, '第 2 遍 · 全英文字幕', '让声音和英文文本开始一一对应。'); break;
      case State.PASS3: this._renderPass('en-fade', 3, '第 3 遍 · 渐隐字幕', '保留关键词，逐步把注意力从眼睛移回耳朵。'); break;
      case State.PASS4: this._renderBlindPass(); break;
      case State.REVIEW: this._renderReview(); break;
    }
  };

  /* ── Render: Unlock card ── */
  ListeningPracticeController.prototype._renderUnlock = function (count) {
    var pct = Math.min(100, Math.round((count / UNLOCK_COUNT) * 100));
    var need = UNLOCK_COUNT - count;
    this.overlay.innerHTML =
      '<div class="lp-header">' +
        '<button class="lp-close" data-action="close">' + CLOSE_SVG + '</button>' +
        '<div class="lp-round-label"></div><div class="lp-round-dots"></div>' +
      '</div>' +
      '<div class="lp-body">' +
        '<div class="lp-unlock">' +
          '<div class="lp-unlock-icon">🎧</div>' +
          '<div class="lp-unlock-title">专属听力练习</div>' +
          '<div class="lp-unlock-desc">再学 ' + need + ' 个新词就能解锁</div>' +
          '<div class="lp-unlock-bar-wrap"><div class="lp-unlock-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="lp-unlock-count">' + count + ' / ' + UNLOCK_COUNT + '</div>' +
          '<div class="lp-unlock-hint">在 Feed 里听播客、收藏生词<br>积累到 ' + UNLOCK_COUNT + ' 个词自动解锁</div>' +
          '<button class="lp-unlock-btn" data-action="go-feed">去听播客 →</button>' +
        '</div>' +
      '</div>';
  };

  /* ── Render: Practice selection (B16/B17/B18 state machine) ──
   * States:
   *   ready      — has pending practices, show cards
   *   generating — LLM call in flight, show skeleton
   *   failed     — last call failed AND no pending cards, show retry CTA
   *   empty      — no pending, not generating, no error — show CTA
   */
  function _skeletonCardHtml() {
    return (
      '<div class="lp-card lp-sk-card">' +
        '<div class="sk-line sk-title"></div>' +
        '<div class="sk-line sk-meta"></div>' +
        '<div class="sk-line sk-body"></div>' +
        '<div class="sk-line sk-body"></div>' +
      '</div>'
    );
  }
  ListeningPracticeController.prototype._renderSelect = function () {
    var state = getPracticeState();
    var vocab = getVocab();
    var delta = Math.max(0, vocab.length - state.lastVocabCountAtGeneration);
    var practices = state.pendingPractices || [];
    var isGenerating = !!state.generating;
    var lastErr = state.lastGenerationError;
    var hasPending = practices.length > 0;

    var cardsHtml = practices.map(function (p) {
      var duration = p.lines.length ? Math.round(p.lines[p.lines.length - 1].end) : 0;
      var wordsHtml = p.target_words.map(function (w) {
        return '<span class="lp-card-word">' + esc(String(w)) + '</span>';
      }).join('');
      var cat = resolveCategory(p);
      var catLabel = CATEGORY_LABELS_ZH[cat] || cat;
      var catTagHtml = '<span class="lp-cat-tag lp-cat-' + esc(cat) + '">' + esc(catLabel) + '</span>';
      return '<div class="lp-card" data-action="start" data-id="' + esc(p.id) + '">' +
        '<div class="lp-card-head">' +
          '<div class="lp-card-title">' + esc(p.title || '') + '</div>' +
          catTagHtml +
        '</div>' +
        '<div class="lp-card-meta">' + esc(p.tag || '') + ' · ' + esc(p.cefr || '') + ' · ' + duration + 's</div>' +
        '<div class="lp-card-words">' + wordsHtml + '</div>' +
        '<span class="lp-card-btn">开始练习 →</span>' +
      '</div>';
    }).join('');

    var statusHtml = '';
    if (isGenerating && !hasPending) {
      statusHtml =
        '<div class="lp-select-meta">AI 正在为你生成练习…</div>' +
        '<div class="lp-skeleton-list">' +
          _skeletonCardHtml() + _skeletonCardHtml() +
          '<div class="sk-hint"><span class="sk-spinner"></span>AI 正在为你生成练习...</div>' +
        '</div>';
    } else if (lastErr && !hasPending) {
      var errMsg = (lastErr && lastErr.msg) ? lastErr.msg : '未知错误';
      statusHtml =
        '<div class="lp-gen-failed">' +
          '<div class="lp-gen-failed-icon">⚠️</div>' +
          '<div class="lp-gen-failed-title">AI 生成失败了</div>' +
          '<div class="lp-gen-failed-detail">' + esc(errMsg) + '</div>' +
          '<button class="lp-gen-retry-btn" data-action="generate">重试</button>' +
        '</div>';
    } else if (hasPending) {
      var header = '<div class="lp-select-meta">已为你准备 ' + practices.length + ' 篇练习 · 新增 ' + delta + ' 个词</div>';
      var tailSkeleton = isGenerating ? _skeletonCardHtml() : '';
      var tailToast = (lastErr && !isGenerating) ? '<div class="lp-gen-toast">补给生成失败，可稍后重试</div>' : '';
      statusHtml = header + cardsHtml + tailSkeleton + tailToast;
    } else {
      statusHtml = '<div class="lp-select-empty">当前没有待练内容，先生成一批新的练习。</div>';
    }

    this.overlay.innerHTML =
      '<div class="lp-header">' +
        '<button class="lp-close" data-action="close">' + CLOSE_SVG + '</button>' +
        '<div class="lp-round-label"></div><div class="lp-round-dots"></div>' +
      '</div>' +
      '<div class="lp-body">' +
        '<div class="lp-select-title">🎧 听力练习</div>' +
        '<div class="lp-select-actions">' +
          '<button class="lp-generate-btn" data-action="generate"' + (isGenerating ? ' disabled' : '') + '>' +
            (isGenerating ? '生成中…' : '生成新的练习') +
          '</button>' +
        '</div>' +
        statusHtml +
        '<div class="lp-select-footer">首次解锁自动生成 2 篇；之后可手动生成。若自上次生成后新增至少 3 个词，下次进入会自动补一批。</div>' +
      '</div>';
  };

  /* ── Start practice ── */
  ListeningPracticeController.prototype.startPractice = function (id) {
    var practices = getPracticeState().pendingPractices || [];
    this.practice = practices.find(function (p) { return p.id === id; });
    if (!this.practice) return;
    this.practice._persisted = false;
    this.ttsCancelled = false;
    this.state = State.INIT;
    this.transition('loaded');
  };

  /* ── Pass indicator ── */
  ListeningPracticeController.prototype._roundHeader = function (roundNum, label) {
    var dots = '';
    for (var i = 1; i <= 4; i++) {
      var cls = 'lp-round-dot';
      if (i < roundNum) cls += ' done';
      if (i === roundNum) cls += ' active';
      dots += '<div class="' + cls + '"></div>';
    }
    return '<div class="lp-header">' +
      '<button class="lp-close" data-action="close">' + CLOSE_SVG + '</button>' +
      '<div class="lp-round-label">' + label + '</div>' +
      '<div class="lp-round-dots">' + dots + '</div>' +
    '</div>';
  };

  ListeningPracticeController.prototype._renderPass = function (mode, passNum, title, hint) {
    var p = this.practice;
    var linesHtml = renderLines(p.lines, mode, false);

    this.overlay.innerHTML =
      this._roundHeader(passNum, title) +
      '<div class="lp-body">' +
        '<div class="lp-pass">' +
          '<div class="lp-pass-hero">' +
            '<button class="lp-play-btn" data-action="pass-play">' + PLAY_SVG + '</button>' +
            '<div class="lp-pass-hint">' + hint + '</div>' +
          '</div>' +
          '<div class="lp-subtitles">' + linesHtml + '</div>' +
          '<div class="lp-pass-footer lp-hidden" id="lp-pass-footer">' +
            '<button class="lp-next-btn" data-action="pass-next">继续下一遍 →</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  };

  ListeningPracticeController.prototype._playCurrentPass = function () {
    var self = this;
    var p = this.practice;
    var btn = this.overlay.querySelector('.lp-play-btn');
    if (!btn) return;
    if (this.ttsPlaying) {
      cancelTTS();
      this.ttsPlaying = false;
      this.ttsCancelled = true;
      btn.innerHTML = PLAY_SVG;
      btn.classList.remove('playing');
      var wave = this.overlay.querySelector('#lp-wave');
      if (wave) wave.classList.add('paused');
      return;
    }

    this.ttsPlaying = true;
    this.ttsCancelled = false;
    btn.innerHTML = PAUSE_SVG;
    btn.classList.add('playing');
    var lineEls = this.overlay.querySelectorAll('.lp-line');
    lineEls.forEach(function (el) {
      el.classList.remove('active');
      el.classList.remove('played');
    });
    var wave = this.overlay.querySelector('#lp-wave');
    if (wave) wave.classList.remove('paused');
    var highlightTimer = lineEls.length ? scheduleLineHighlights(lineEls, p.lines) : null;
    var passNum = (this.state === State.PASS1) ? 1
                : (this.state === State.PASS2) ? 2
                : (this.state === State.PASS3) ? 3
                : (this.state === State.PASS4) ? 4 : 1;
    var passRate = getPassRate(passNum);
    track('tts.played', {
      pass: passNum,
      user_cefr: getUserCefrLevel(),
      rate: passRate,
      text_length: p.text.length
    });
    speakText(p.text, passRate).then(function () {
      if (highlightTimer) clearInterval(highlightTimer);
      if (self.ttsCancelled) return;
      self.ttsPlaying = false;
      if (btn.parentNode) { btn.innerHTML = PLAY_SVG; btn.classList.remove('playing'); }
      if (wave) wave.classList.add('paused');
      lineEls.forEach(function (el) {
        el.classList.remove('active');
        el.classList.add('played');
      });
      var footer = document.getElementById('lp-pass-footer');
      if (footer) footer.classList.remove('lp-hidden');
      // Pass 4: refresh replay button state once audio is done.
      if (self.state === State.PASS4) {
        self.blindHasPlayedOnce = true;
        self._updateBlindReplayBtn();
      }
    });
  };

  ListeningPracticeController.prototype._renderBlindPass = function () {
    var waveHtml = '';
    for (var i = 0; i < 8; i++) waveHtml += '<div class="lp-wave-bar"></div>';
    var adapt = getUserAdaptation();
    // Reset replay counter on (re)entering Pass 4.
    this.blindReplayCount = 0;
    this.blindHasPlayedOnce = false;
    var replayBtnHtml = adapt.maxReplay > 0
      ? '<button class="lp-next-btn lp-replay-btn lp-hidden" id="lp-blind-replay-btn" data-action="blind-replay">重听（剩余 ' + adapt.maxReplay + ' 次）</button>'
      : '';
    this.overlay.innerHTML =
      this._roundHeader(4, '第 4 遍 · 无字幕纯听') +
      '<div class="lp-body">' +
        '<div class="lp-r3">' +
          '<div class="lp-r3-blind">' +
            '<div class="lp-r3-hint">最后一遍不看字幕，只用耳朵确认自己是否真的听懂。</div>' +
            '<div class="lp-wave paused" id="lp-wave">' + waveHtml + '</div>' +
            '<button class="lp-play-btn" data-action="pass-play">' + PLAY_SVG + '</button>' +
            '<div class="lp-pass-footer lp-hidden" id="lp-pass-footer">' +
              replayBtnHtml +
              '<button class="lp-next-btn" data-action="pass-next">进入回看与检测 →</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  };

  ListeningPracticeController.prototype._handleBlindReplay = function () {
    var adapt = getUserAdaptation();
    if (adapt.maxReplay <= 0) return;
    if ((this.blindReplayCount || 0) >= adapt.maxReplay) return;
    this.blindReplayCount = (this.blindReplayCount || 0) + 1;
    // Replays restart the audio without showing the next-button until done.
    var btn = this.overlay.querySelector('.lp-play-btn');
    if (btn) { btn.innerHTML = PLAY_SVG; btn.classList.remove('playing'); }
    var footer = document.getElementById('lp-pass-footer');
    if (footer) footer.classList.add('lp-hidden');
    this._playCurrentPass();
  };

  ListeningPracticeController.prototype._updateBlindReplayBtn = function () {
    var adapt = getUserAdaptation();
    var btn = document.getElementById('lp-blind-replay-btn');
    if (!btn) return;
    if (adapt.maxReplay <= 0) { btn.style.display = 'none'; return; }
    var remaining = adapt.maxReplay - (this.blindReplayCount || 0);
    if (remaining <= 0) {
      btn.disabled = true;
      btn.textContent = '已用完';
    } else {
      btn.disabled = false;
      btn.textContent = '重听（剩余 ' + remaining + ' 次）';
    }
    btn.classList.remove('lp-hidden');
  };

  /* B38: merge target_word_contexts + vocab_in_text for the Review page.
   * Target words come first (more detailed definitions), extras after.
   * Dedupe case-insensitively, keeping the first (target) entry.
   */
  function _buildReviewVocabList(practice) {
    var targetCtxs = practice.target_word_contexts || [];
    var byWord = {};
    (practice.vocabulary || []).forEach(function (v) {
      if (v && v.word) byWord[String(v.word).toLowerCase()] = v;
    });
    var targets = targetCtxs.length
      ? targetCtxs.map(function (c) {
          var key = String(c.word || '').toLowerCase();
          var base = byWord[key] || {};
          return {
            word: c.word,
            cefr: c.cefr || base.cefr || '',
            ipa: c.ipa || base.ipa || '',
            definition_zh: c.definition_zh || base.definition_zh || '',
            isTarget: true
          };
        })
      : (practice.vocabulary || []).map(function (v) {
          return {
            word: v.word,
            cefr: v.cefr || '',
            ipa: v.ipa || '',
            definition_zh: v.definition_zh || '',
            isTarget: true
          };
        });
    var extras = (practice.vocab_in_text || []).map(function (v) {
      return {
        word: v.word,
        cefr: v.cefr || '',
        ipa: v.ipa || '',
        definition_zh: v.zh || v.definition_zh || '',
        isTarget: false
      };
    });
    var seen = {};
    var out = [];
    targets.concat(extras).forEach(function (w) {
      if (!w.word) return;
      var k = String(w.word).toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(w);
    });
    return out;
  }

  ListeningPracticeController.prototype._renderReview = function () {
    normalizeMcq(this.practice);
    var mcq = this.practice.mcq;
    var answered = !!this.practice.mcqAnswered;
    // B38: always show all target words + all extras surfaced by the LLM.
    // PRD §8 reviewCount was originally for quiz item count, not vocab cards;
    // capping extras here loses useful content. List is scrollable.
    var vocabList = _buildReviewVocabList(this.practice);
    var targets = vocabList.filter(function (v) { return v.isTarget; });
    var extras = vocabList.filter(function (v) { return !v.isTarget; });
    var vocabShown = targets.concat(extras);
    var vocabHtml = vocabShown.map(function (v) {
      var badge = v.isTarget ? '<span class="lp-vocab-badge">目标词</span>' : '';
      var ipa = v.ipa ? '<span class="lp-vocab-ipa">' + esc(v.ipa) + '</span>' : '';
      return '<div class="lp-vocab-item ' + (v.isTarget ? 'is-target' : 'is-extra') + '">' +
        '<span class="lp-vocab-word">' + esc(v.word) + '</span>' + badge +
        '<span class="lp-vocab-cefr ' + cefrClass(v.cefr) + '">' + esc(v.cefr || '') + '</span>' +
        ipa +
        '<span class="lp-vocab-zh">' + esc(v.definition_zh || '') + '</span>' +
      '</div>';
    }).join('');

    // B37/B40: 4-option MCQ with gating. Render empty string when mcq missing
    // (B37 edge case: LLM completely absent) — renderer falls back to legacy
    // flow of auto-unlocking the finish button.
    var mcqBlockHtml = '';
    if (mcq) {
      var optsHtml = mcq.options.map(function (text, i) {
        var isPlaceholder = text === '— 无此选项 —';
        var disabled = isPlaceholder ? ' disabled aria-disabled="true"' : '';
        var letter = String.fromCharCode(65 + i); // A / B / C / D
        return '<button class="lp-gist-opt lp-mcq-opt' + (isPlaceholder ? ' is-placeholder' : '') +
          '" data-action="gist-answer" data-idx="' + i + '"' + disabled + '>' +
          '<span class="lp-mcq-letter">' + letter + '.</span> ' + esc(String(text || '')) +
        '</button>';
      }).join('');
      mcqBlockHtml =
        '<div class="lp-gist">' +
          '<div class="lp-gist-label">理解检测</div>' +
          '<div class="lp-gist-q">' + esc(mcq.q || '') + '</div>' +
          optsHtml +
          '<div class="mcq-feedback"></div>' +
        '</div>';
    }

    // B41: gate the "返回列表" button on mcqAnswered. If mcq is absent entirely,
    // fall back to the legacy behavior (button enabled immediately).
    var backDisabled = (mcq && !answered) ? ' disabled title="请先选择一个答案"' : '';

    this.overlay.innerHTML =
      '<div class="lp-header">' +
        '<button class="lp-close" data-action="close">' + CLOSE_SVG + '</button>' +
        '<div class="lp-round-label">回看与检测</div>' +
        '<div class="lp-round-dots"><div class="lp-round-dot done"></div><div class="lp-round-dot done"></div><div class="lp-round-dot done"></div><div class="lp-round-dot done"></div></div>' +
      '</div>' +
      '<div class="lp-body">' +
        mcqBlockHtml +
        '<div class="lp-review-block">' +
          '<div class="lp-review-title">回看文本</div>' +
          '<div class="lp-review-sub">点击任意一句，可按需展开中文。</div>' +
          '<div class="lp-subtitles lp-review-lines">' + renderLines(this.practice.lines, 'en-full', true) + '</div>' +
        '</div>' +
        '<div class="lp-vocab-review">' +
          '<div class="lp-vocab-review-title">本次练习词汇</div>' +
          vocabHtml +
        '</div>' +
        '<div class="lp-diff-label">这篇难度对你来说——</div>' +
        '<div class="lp-diff-options">' +
          '<button class="lp-diff-opt" data-action="diff" data-val="easy">太简单</button>' +
          '<button class="lp-diff-opt" data-action="diff" data-val="right">正合适</button>' +
          '<button class="lp-diff-opt" data-action="diff" data-val="hard">有点难</button>' +
        '</div>' +
        '<button class="lp-return-btn p4-back-btn" data-action="finish"' + backDisabled + '>返回列表</button>' +
      '</div>';

    // If user previously answered (state persisted), re-apply feedback UI.
    if (mcq && answered) {
      this._applyMcqFeedback();
    }
  };

  ListeningPracticeController.prototype._handleGistAnswer = function (idx) {
    var mcq = this.practice.mcq;
    if (!mcq) return;
    if (this.practice.mcqAnswered) return; // Lock after first answer.
    // A placeholder option (LLM returned <4) is disabled, but guard anyway.
    if (mcq.options[idx] === '— 无此选项 —') return;
    this.practice.mcqAnswered = true;
    this.practice.mcqSelectedIdx = idx;
    this.practice.mcqCorrect = (idx === mcq.correct);
    // Persist answer state so re-opening the practice remembers it.
    var state = getPracticeState();
    var pendingIdx = (state.pendingPractices || []).findIndex(function (p) { return p && p.id === this.practice.id; }.bind(this));
    if (pendingIdx >= 0) {
      state.pendingPractices[pendingIdx].mcqAnswered = true;
      state.pendingPractices[pendingIdx].mcqSelectedIdx = idx;
      state.pendingPractices[pendingIdx].mcqCorrect = this.practice.mcqCorrect;
      savePracticeState(state);
    }
    this._applyMcqFeedback();
  };

  // B40: render correct/wrong highlight + explanation, unlock finish button.
  ListeningPracticeController.prototype._applyMcqFeedback = function () {
    var mcq = this.practice.mcq;
    if (!mcq) return;
    var selectedIdx = this.practice.mcqSelectedIdx;
    var correctIdx = mcq.correct;
    var isCorrect = !!this.practice.mcqCorrect;

    var opts = this.overlay.querySelectorAll('.lp-mcq-opt');
    opts.forEach(function (el, i) {
      el.classList.add('answered');
      el.classList.remove('opt-correct', 'opt-wrong', 'opt-user');
      if (i === correctIdx) el.classList.add('opt-correct');
      if (i === selectedIdx && !isCorrect) el.classList.add('opt-wrong');
      if (i === selectedIdx) el.classList.add('opt-user');
      el.disabled = true;
    });

    var fb = this.overlay.querySelector('.mcq-feedback');
    if (fb) {
      var letter = String.fromCharCode(65 + correctIdx);
      var explHtml = mcq.explanation
        ? '<div class="fb-exp">' + esc(mcq.explanation) + '</div>'
        : '';
      fb.innerHTML =
        '<div class="fb-header ' + (isCorrect ? 'fb-ok' : 'fb-ng') + '">' +
          (isCorrect ? '✓ 答对了' : '✗ 答错了') +
        '</div>' +
        '<div class="fb-answer">正确答案：<strong>' + letter + '. ' +
          esc(String(mcq.options[correctIdx] || '')) + '</strong></div>' +
        explHtml;
    }
    // B41: unlock the finish button.
    var backBtn = this.overlay.querySelector('.p4-back-btn');
    if (backBtn) {
      backBtn.disabled = false;
      backBtn.removeAttribute('title');
    }
  };

  /**
   * Task F: async supply ensures we go through the LLM path.
   * Single-flight via _genInFlight to avoid Azure spam.
   * Returns Promise<boolean> — true if state was updated.
   */
  ListeningPracticeController.prototype._ensurePracticeSupply = function (vocab) {
    var state = getPracticeState();
    var delta = vocab.length - state.lastVocabCountAtGeneration;
    var shouldGenerateInitial = state.pendingPractices.length === 0 && state.completedPractices.length === 0;
    var shouldAutoRefresh = delta >= REFRESH_DELTA && state.pendingPractices.length < MAX_PENDING;
    if (!shouldGenerateInitial && !shouldAutoRefresh) {
      updatePracticeBadge(state);
      return Promise.resolve(false);
    }
    if (_genInFlight) return Promise.resolve(false);
    _genInFlight = true;
    // B16/B18: set generating flag + clear prior error so the select view
    // renders a skeleton immediately (if the user is already on it).
    state.generating = true;
    state.lastGenerationError = null;
    savePracticeState(state);
    if (this.state === State.INIT && this.overlay && !this.overlay.classList.contains('lp-hidden')) {
      this._renderSelect();
    }
    var self = this;
    return generateBatchAsync(vocab, state, {
      count: BATCH_SIZE,
      trigger: shouldGenerateInitial ? 'unlock' : 'refresh'
    }).then(function (batch) {
      _genInFlight = false;
      state = getPracticeState();
      state.generating = false;
      if (!batch.length) {
        savePracticeState(state);
        updatePracticeBadge(state);
        if (self.state === State.INIT) self._renderSelect();
        return false;
      }
      state.pendingPractices = state.pendingPractices.concat(batch).slice(0, MAX_PENDING);
      state.lastGeneratedAt = Date.now();
      state.lastVocabCountAtGeneration = vocab.length;
      // Persist the prompt version that produced this batch.
      var v = batch.find(function (p) { return p && p.generationVersion; });
      if (v) state.generationVersion = v.generationVersion;
      pruneCompleted(state);
      savePracticeState(state);
      if (self.state === State.INIT) self._renderSelect();
      if (typeof window._refreshPracticeView === 'function') {
        try { window._refreshPracticeView(); } catch (e) {}
      }
      return true;
    }).catch(function (err) {
      _genInFlight = false;
      console.warn('[practice-supply] generation failed:', err);
      state = getPracticeState();
      state.generating = false;
      state.lastGenerationError = { msg: (err && err.message) || String(err || 'unknown'), ts: Date.now() };
      savePracticeState(state);
      if (self.state === State.INIT) self._renderSelect();
      return false;
    });
  };

  ListeningPracticeController.prototype._refreshSupplyFromVocab = function (vocab) {
    return this._ensurePracticeSupply(vocab || getVocab());
  };

  ListeningPracticeController.prototype._generateMore = function () {
    var self = this;
    var vocab = getVocab();
    var state = getPracticeState();
    if (state.pendingPractices.length >= MAX_PENDING) {
      this._renderSelect();
      return Promise.resolve();
    }
    if (_genInFlight) { this._renderSelect(); return Promise.resolve(); }
    _genInFlight = true;
    // B16/B18: reflect generating state immediately.
    state.generating = true;
    state.lastGenerationError = null;
    savePracticeState(state);
    self._renderSelect();
    return generateBatchAsync(vocab, state, { count: BATCH_SIZE, trigger: 'manual_more' })
      .then(function (batch) {
        _genInFlight = false;
        state = getPracticeState();
        state.generating = false;
        if (!batch.length) {
          // Treat empty batch as failed for UX clarity (nothing to show
          // otherwise means AI silently did nothing).
          state.lastGenerationError = { msg: 'AI 没有返回任何练习', ts: Date.now() };
          savePracticeState(state);
          self._renderSelect();
          return;
        }
        state.pendingPractices = state.pendingPractices.concat(batch).slice(0, MAX_PENDING);
        state.lastGeneratedAt = Date.now();
        state.lastVocabCountAtGeneration = vocab.length;
        var v = batch.find(function (p) { return p && p.generationVersion; });
        if (v) state.generationVersion = v.generationVersion;
        savePracticeState(state);
        self._renderSelect();
      })
      .catch(function (err) {
        _genInFlight = false;
        console.warn('[generateMore] failed:', err);
        state = getPracticeState();
        state.generating = false;
        state.lastGenerationError = { msg: (err && err.message) || String(err || 'unknown'), ts: Date.now() };
        savePracticeState(state);
        self._renderSelect();
      });
  };

  ListeningPracticeController.prototype._persistCompletion = function () {
    if (!this.practice || this.practice._persisted) return;
    var state = getPracticeState();
    state.pendingPractices = state.pendingPractices.filter(function (item) { return item.id !== this.practice.id; }.bind(this));
    state.completedPractices.push(practiceSnapshot(this.practice));
    this.practice._persisted = true;
    savePracticeState(state);
  };

  /* ── Event delegation ── */
  ListeningPracticeController.prototype._onClick = function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;

    switch (action) {
      case 'close':
      case 'go-feed':
        this.close();
        break;
      case 'start':
        this.startPractice(target.dataset.id);
        break;
      case 'generate':
        this._generateMore();
        break;
      case 'pass-play':
        this._playCurrentPass();
        break;
      case 'blind-replay':
        this._handleBlindReplay();
        break;
      case 'pass-next':
        this.transition('next');
        break;
      case 'gist-answer':
        this._handleGistAnswer(parseInt(target.dataset.idx, 10));
        break;
      case 'toggle-line':
        var zh = target.querySelector('.lp-line-zh');
        if (zh) zh.classList.toggle('lp-hidden');
        break;
      case 'diff':
        // Visual feedback for difficulty selection
        this.overlay.querySelectorAll('.lp-diff-opt').forEach(function (btn) {
          btn.classList.toggle('selected', btn === target);
        });
        break;
      case 'finish':
      case 'return':
        this._persistCompletion();
        this.close();
        break;
    }
  };

  ListeningPracticeController.prototype._onInput = function (e) {
    return e;
  };

  /* ── Init & expose ── */
  function init() {
    var overlay = document.getElementById('lp-overlay');
    if (!overlay) return;
    // Fire-and-forget: load CEFR overrides so future lookups are correct.
    // Practice generation happens on demand, by then overrides are loaded.
    loadCefrOverrides();
    var ctrl = new ListeningPracticeController(overlay);
    updatePracticeBadge();

    // Intercept the sidebar 🎧 button
    var menuBtn = document.querySelector('.sp-menu-item[data-panel="practice-panel"]');
    if (menuBtn) {
      // Clone to remove old listeners
      var newBtn = menuBtn.cloneNode(true);
      menuBtn.parentNode.replaceChild(newBtn, menuBtn);
      newBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        ctrl.open();
      });
    }

    // Also handle Enter key in cloze inputs
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') ctrl.close();
    });

    window._listeningPractice = ctrl;
  }

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
