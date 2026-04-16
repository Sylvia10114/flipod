/**
 * Flipod Teaching Module v3
 *
 * Phase state machine: idle → 1-question → 2-vocab → 3-match → 4-summary
 * Integrates into existing index.html via minimal hooks.
 *
 * Dependencies (global): clips[], audios[], currentIdx
 */

const CEFR_NUM = { A1:1, A2:2, B1:3, B2:4, C1:5, C2:6 };

// Mini dictionary for common B1-C1 words (demo use)
const WORD_DEFS = {
  // Economics / Finance
  benchmark:'基准；参照标准', recession:'经济衰退', inflation:'通货膨胀',
  deficit:'赤字；逆差', surplus:'盈余；顺差', tariff:'关税', subsidy:'补贴',
  equity:'股权；权益', dividend:'股息', mortgage:'抵押贷款', portfolio:'投资组合',
  monetary:'货币的', fiscal:'财政的', commodity:'大宗商品', revenue:'收入；税收',
  bond:'债券', yield:'收益率', leverage:'杠杆', liquidity:'流动性',
  // Technology
  algorithm:'算法', infrastructure:'基础设施', bandwidth:'带宽',
  encryption:'加密', protocol:'协议', autonomous:'自主的', proprietary:'专有的',
  latency:'延迟', scalable:'可扩展的', deployment:'部署', vulnerability:'漏洞',
  // Science
  hypothesis:'假设', empirical:'实证的', synthesis:'综合；合成',
  catalyst:'催化剂', phenomenon:'现象', spectrum:'光谱；范围',
  // General B1-B2
  significant:'重要的；显著的', substantial:'大量的；实质性的',
  crucial:'至关重要的', ultimately:'最终地', meanwhile:'与此同时',
  anticipate:'预期', reluctant:'不情愿的', overwhelming:'压倒性的',
  controversial:'有争议的', inevitable:'不可避免的', profound:'深刻的',
  sustainable:'可持续的', initiative:'倡议；主动性', perspective:'视角',
  implications:'影响；含义', unprecedented:'史无前例的', comprehensive:'全面的',
  constraint:'约束；限制', incentive:'激励', undermine:'削弱',
  accelerate:'加速', deteriorate:'恶化', fluctuate:'波动',
  resilient:'有韧性的', volatile:'易变的；不稳定的',
  accumulate:'积累', aggregate:'总计的', alleviate:'缓解',
  consolidate:'巩固', compensate:'补偿', complement:'补充',
  compromise:'妥协', coincide:'巧合；同时发生', constitute:'构成',
  contemplate:'沉思', controversy:'争论', correspond:'对应',
  curb:'抑制', denounce:'谴责', depict:'描绘',
  diploma:'文凭', disclose:'披露', discrimination:'歧视',
  elaborate:'详细阐述', eligible:'有资格的', embrace:'拥抱；接受',
  enforce:'执行', equivalent:'等价的', erosion:'侵蚀',
  advocate:'倡导', comply:'遵守', confine:'限制',
  consensus:'共识', demographic:'人口统计的', disrupt:'颠覆',
  envision:'展望', exploit:'利用；剥削', facilitate:'促进',
  // History / Culture
  expedition:'远征', colonial:'殖民的', segregation:'种族隔离',
  liberation:'解放', sovereignty:'主权', heritage:'遗产',
  persecution:'迫害', commemorate:'纪念', propaganda:'宣传',
  congressional:'国会的', medal:'奖章；勋章', veteran:'退伍军人',
  honor:'荣誉；荣耀', combat:'战斗', distinguished:'杰出的',
  squadron:'中队', escort:'护送', bomber:'轰炸机', fighter:'战斗机',
  aerial:'空中的', mission:'任务；使命', bravery:'英勇',
  // Military / Geopolitics
  ceasefire:'停火', sanctions:'制裁', deterrent:'威慑',
  strategic:'战略的', surveillance:'监视', reconnaissance:'侦察',
  convoy:'护航船队', blockade:'封锁', insurgent:'叛乱分子',
  // Bookstore / Publishing
  particular:'特定的；特别的', literally:'字面上地；确实',
  assortment:'各类；混合', shelf:'书架', slim:'微薄的；纤细的',
  margin:'利润率；边距', inventory:'库存', wholesale:'批发',
  retail:'零售', publisher:'出版社', distributor:'分销商',
  genre:'类型；体裁', memoir:'回忆录', curate:'策划；精选',
  browse:'浏览', recommend:'推荐', manuscript:'手稿',
  // Economics / Fed
  optimistic:'乐观的', anticipate:'预期', resilient:'有韧性的',
  forecast:'预测', indicator:'指标', downturn:'低迷；衰退',
  stimulus:'刺激', tighten:'收紧', normalize:'正常化',
  trajectory:'轨迹', consecutive:'连续的', moderate:'温和的',
  projection:'预测；预计', stance:'立场', uncertainty:'不确定性',
  // General useful words
  found:'创立；建立', managed:'设法做到', struggle:'挣扎',
  establish:'建立', decade:'十年', era:'时代', prominent:'突出的',
  accomplish:'完成', overcome:'克服', transform:'转变',
  recognition:'认可', legacy:'遗产', sacrifice:'牺牲',
  contribute:'贡献', significant:'重要的；显著的',
  // Demo clip 1: Tuskegee Airmen
  eventually:'最终；终于', president:'总统', spirit:'精神',
  wisdom:'智慧', nation:'国家；民族', medal:'奖章；勋章',
  human:'人类的', bush:'灌木（此处指布什总统）',
  // Demo clip 2: Fed rate hike
  federal:'联邦的', reserve:'储备；准备金', basis:'基础；基点',
  percentage:'百分比；百分率', deal:'交易；大量',
  completely:'完全地', rear:'后方的', mirror:'镜子',
  economic:'经济的', swift:'迅速的', lift:'提升；振奋',
  quite:'相当；十分', dangerously:'危险地', importantly:'重要地',
  economy:'经济', dependent:'依赖的', elusive:'难以捉摸的',
  growth:'增长', moderate:'温和的；适度的', modest:'适度的；谦虚的',
  data:'数据', market:'市场', moving:'变动的；感人的',
  // Demo clip 3: Independent bookstore
  whenever:'每当；无论何时', particular:'特定的；特别的',
  suspect:'怀疑；猜想', display:'展示；陈列',
  literally:'字面上地；确实', independent:'独立的',
  novel:'小说', quirky:'古怪的；有趣的', personality:'个性',
  ecosystem:'生态系统', primarily:'主要地', buyer:'买家；采购员',
  commercial:'商业的', fate:'命运', financial:'金融的；财务的',
  space:'空间', chain:'连锁店', specific:'具体的；特定的',
  basically:'基本上', decides:'决定', explains:'解释',
  popular:'受欢迎的', mainly:'主要地', whole:'整个的',
  running:'经营；运营', country:'国家',
};

class TeachingController {
  constructor(panelEl, clipData, onFinish, tappedWords) {
    this.root = panelEl;
    this.clip = clipData;
    this.onFinish = onFinish;
    this.tappedWords = tappedWords || new Set();
    this.state = {
      phase: 'idle',
      gistCorrect: null,       // true / false / null (skipped)
      gistExplanation: '',
      vocabWords: [],           // [{word, cefr, cefrNum, lineIndex, def}]
      pinnedWords: new Set(),
      matchedPairs: new Set(),
      matchAttempts: 0,
      difficulty: 'right',
      selectedMatchItem: null,
    };

    this.root.addEventListener('click', e => this.onClick(e));
  }

  // ── Phase transitions ──

  enter(phase) {
    this.state.phase = phase;
    if (phase === '2-vocab' && this.state.vocabWords.length === 0) {
      this.selectVocabWords();
    }
    if (phase === '2-vocab' && this.state.vocabWords.length === 0) {
      phase = '4-summary';
      this.state.phase = phase;
    }
    this.render();
    this.root.scrollTop = 0;
  }

  // ── Click delegation ──

  onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    switch (action) {
      case 'gist-answer':    this.handleGistAnswer(el); break;
      case 'gist-continue':  this.enter('2-vocab'); break;
      case 'skip-phase-1':   this.enter('2-vocab'); break;
      case 'skip-all':       this.handleSkipAll(); break;
      case 'pin-vocab':      this.handlePinVocab(el); break;
      case 'start-match':    this.enter('3-match'); break;
      case 'skip-phase-2':   this.enter('3-match'); break;
      case 'match-tap':      this.handleMatchTap(el); break;
      case 'skip-phase-3':   this.enter('4-summary'); break;
      case 'diff-select':    this.handleDiffSelect(el); break;
      case 'save-all-vocab': this.handleSaveAll(el); break;
      case 'next-clip':      this.handleNextClip(); break;
    }
  }

  // ── Rendering ──

  render() {
    let html = this.renderMiniPlayer();

    // Phase-done bars for completed phases
    const p = this.state.phase;
    if (['2-vocab','3-match','4-summary'].includes(p)) {
      const label = this.state.gistCorrect === true ? '已答对'
                  : this.state.gistCorrect === false ? '已回答' : '已跳过';
      html += `<div class="phase-done"><span class="check">✓</span><span>理解 · ${label}</span></div>`;
    }
    if (['3-match','4-summary'].includes(p)) {
      html += `<div class="phase-done"><span class="check">✓</span><span>词汇 · ${this.state.vocabWords.length} 个重点词</span></div>`;
    }
    if (p === '4-summary') {
      html += `<div class="phase-done"><span class="check">✓</span><span>配对 · ${this.state.matchedPairs.size}/${this.state.vocabWords.length} 完成</span></div>`;
    }

    // Current phase
    switch (p) {
      case '1-question': html += this.renderPhase1(); break;
      case '2-vocab':    html += this.renderPhase2(); break;
      case '3-match':    html += this.renderPhase3(); break;
      case '4-summary':  html += this.renderPhase4(); break;
    }

    this.root.innerHTML = html;

    // Post-render init
    if (p === '2-vocab') this.initCarousel();
    if (p === '3-match') this.initMatchLines();
    if (p === '4-summary') this.initDiffRadios();
  }

  renderMiniPlayer() {
    const c = this.clip;
    const title = c.title || '';
    const source = c.source?.podcast || c.source || '';
    return `
      <div class="tp-mini-player">
        <div class="tp-mini-player__icon">✓</div>
        <div class="tp-mini-player__text">
          <div class="tp-mini-player__title">${this.esc(title)}</div>
          <div class="tp-mini-player__meta">${this.esc(source)} · 已听完</div>
        </div>
      </div>`;
  }

  // ── Phase 1: Gist ──

  renderPhase1() {
    const q = this.clip.questions?.[0];
    if (!q) {
      // No question, skip to phase 2
      setTimeout(() => this.enter('2-vocab'), 0);
      return '';
    }

    const optionsHTML = q.options.map((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      const text = opt.replace(/^[A-D]\.\s*/, '');
      const isCorrect = q.answer === letter;
      return `
        <button class="gist-option" data-action="gist-answer" data-option="${letter}" data-correct="${isCorrect}">
          <span class="option-letter">${letter}</span>
          <span class="option-text">${this.esc(text)}</span>
        </button>`;
    }).join('');

    return `
      <section class="tp-phase">
        <div class="tp-phase-head">
          <span class="tp-phase-dot"></span>
          <h3>理解</h3>
          <button class="tp-phase-skip" data-action="skip-phase-1">跳过</button>
          <button class="tp-phase-skip" data-action="skip-all" style="margin-left:4px;color:var(--text-4)">跳过全部</button>
        </div>
        <p class="gist-question">${this.esc(q.question)}</p>
        <div class="gist-options">${optionsHTML}</div>
      </section>`;
  }

  handleGistAnswer(el) {
    if (this.state.gistCorrect !== null) return;
    const isCorrect = el.dataset.correct === 'true';
    const q = this.clip.questions[0];

    this.root.querySelectorAll('.gist-option').forEach(btn => {
      btn.classList.add('is-disabled');
      if (btn.dataset.correct === 'true') btn.classList.add('is-correct');
    });

    if (isCorrect) {
      el.classList.add('is-correct');
      this.state.gistCorrect = true;
      this.state.gistExplanation = q.explanation_zh || '';

      const fb = document.createElement('div');
      fb.className = 'gist-feedback';
      fb.innerHTML = `<span class="fb-check">✓</span><span>${this.esc(q.explanation_zh || '回答正确')}</span>`;
      el.closest('.tp-phase').appendChild(fb);
      setTimeout(() => this.enter('2-vocab'), 1500);

    } else {
      el.classList.add('is-wrong');
      this.state.gistCorrect = false;

      const fb = document.createElement('div');
      fb.className = 'gist-feedback';
      fb.innerHTML = `
        <span class="fb-check" style="color:#f87171">✗</span>
        <div>
          <span>${this.esc(q.explanation_zh || '')}</span>
          <button class="gist-continue" data-action="gist-continue">继续 →</button>
        </div>`;
      el.closest('.tp-phase').appendChild(fb);
    }
  }

  // ── Phase 2: Vocab ──

  selectVocabWords() {
    const userLevel = localStorage.getItem('flipodLevel') || 'B1';
    const userNum = CEFR_NUM[userLevel] || 3;
    const MAX_WORDS = 3;

    const knownWords = new Set();
    try {
      const kw = JSON.parse(localStorage.getItem('flipodKnownWords') || '[]');
      kw.forEach(w => knownWords.add(w.toLowerCase()));
    } catch {}

    // Build index of all eligible words in this clip
    const clipWordMap = new Map();
    for (let li = 0; li < this.clip.lines.length; li++) {
      const line = this.clip.lines[li];
      for (const w of (line.words || [])) {
        const cefr = w.cefr;
        if (!cefr || cefr === 'PN' || cefr === 'A1') continue;
        const num = CEFR_NUM[cefr];
        if (!num) continue;
        const lower = w.word.toLowerCase();
        if (knownWords.has(lower) || clipWordMap.has(lower)) continue;
        const def = WORD_DEFS[lower];
        if (!def) continue;
        clipWordMap.set(lower, { word: w.word, cefr, cefrNum: num, lineIndex: li, def });
      }
    }

    const selected = [];
    const usedWords = new Set();

    // Priority 1: words from user's vocab book that appear in this clip
    try {
      const savedVocab = JSON.parse(localStorage.getItem('flipodVocab') || '[]');
      for (const v of savedVocab) {
        if (selected.length >= MAX_WORDS) break;
        const lower = v.word?.toLowerCase();
        if (!lower || usedWords.has(lower)) continue;
        const clipWord = clipWordMap.get(lower);
        if (clipWord) {
          clipWord.behaviorTag = '你收藏了这个词';
          selected.push(clipWord);
          usedWords.add(lower);
        }
      }
    } catch {}

    // Priority 2: words user tapped during listening (within ±1 CEFR level)
    for (const tapped of this.tappedWords) {
      if (selected.length >= MAX_WORDS) break;
      const lower = tapped.toLowerCase();
      if (usedWords.has(lower)) continue;
      const clipWord = clipWordMap.get(lower);
      if (!clipWord) continue;
      if (Math.abs(clipWord.cefrNum - userNum) <= 1) {
        clipWord.behaviorTag = '你查过这个词';
        selected.push(clipWord);
        usedWords.add(lower);
      }
    }

    // Priority 3: algorithm fill — target user level + 1
    const targetNum = userNum + 1;
    const remaining = [...clipWordMap.values()]
      .filter(w => !usedWords.has(w.word.toLowerCase()))
      .sort((a, b) => {
        const da = Math.abs(a.cefrNum - targetNum);
        const db = Math.abs(b.cefrNum - targetNum);
        if (da !== db) return da - db;
        return b.cefrNum - a.cefrNum;
      });

    for (const w of remaining) {
      if (selected.length >= MAX_WORDS) break;
      selected.push(w);
      usedWords.add(w.word.toLowerCase());
    }

    this.state.vocabWords = selected;
  }

  extractDef(word, lineIndex) {
    // Should not reach here if WORD_DEFS is comprehensive enough.
    // Last resort: return word itself to signal missing entry (never "查看释义")
    console.warn(`WORD_DEFS missing: "${word.toLowerCase()}"`);
    return word;
  }

  renderPhase2() {
    const words = this.state.vocabWords;
    if (words.length === 0) return '';

    const cardsHTML = words.map((w, i) => {
      const cefrClass = `cefr-${w.cefr.toLowerCase()}`;
      const context = this.clip.lines[w.lineIndex]?.en || '';
      const isSaved = this.state.pinnedWords.has(w.word.toLowerCase());
      return `
        <div class="vocab-card" data-index="${i}">
          <div class="vocab-card__top">
            <span class="vocab-word">${this.esc(w.word)}</span>
            <span class="cefr-pill ${cefrClass}">${w.cefr}</span>
          </div>
          ${w.behaviorTag ? `<span class="vocab-behavior-tag">${this.esc(w.behaviorTag)}</span>` : ''}
          <p class="vocab-zh">${this.esc(w.def)}</p>
          <div class="vocab-example">
            <div class="example-bar"></div>
            <div>
              <div class="example-label">语境</div>
              <p class="example-text"><em>${this.esc(context)}</em></p>
            </div>
          </div>
          <button class="vocab-save ${isSaved ? 'is-saved' : ''}" data-action="pin-vocab" data-word="${this.esc(w.word)}">
            ${isSaved ? '✓ 已加入' : '+ 加入生词本'}
          </button>
        </div>`;
    }).join('');

    const dotsHTML = words.map((_, i) =>
      `<span class="dot ${i === 0 ? 'is-active' : ''}"></span>`
    ).join('');

    return `
      <section class="tp-phase">
        <div class="tp-phase-head">
          <span class="tp-phase-dot"></span>
          <h3>这段里的重点词</h3>
          <button class="tp-phase-skip" data-action="skip-phase-2">跳过</button>
        </div>
        <div class="vocab-carousel">${cardsHTML}</div>
        <div class="vocab-dots">${dotsHTML}</div>
        <button class="tp-cta tp-cta--secondary" data-action="start-match">练习一下 →</button>
      </section>`;
  }

  initCarousel() {
    const carousel = this.root.querySelector('.vocab-carousel');
    const dots = this.root.querySelectorAll('.vocab-dots .dot');
    if (!carousel || dots.length === 0) return;
    carousel.addEventListener('scroll', () => {
      const scrollLeft = carousel.scrollLeft;
      const cardWidth = carousel.querySelector('.vocab-card')?.offsetWidth || 1;
      const idx = Math.round(scrollLeft / (cardWidth + 12));
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    });
  }

  handlePinVocab(el) {
    const word = el.dataset.word;
    if (!word) return;
    this.state.pinnedWords.add(word.toLowerCase());
    el.textContent = '✓ 已加入';
    el.classList.add('is-saved');

    // Save to localStorage
    try {
      const vocab = JSON.parse(localStorage.getItem('flipodVocab') || '[]');
      if (!vocab.find(v => v.word === word.toLowerCase())) {
        const wData = this.state.vocabWords.find(w => w.word.toLowerCase() === word.toLowerCase());
        vocab.push({ word: word.toLowerCase(), cefr: wData?.cefr || '', context: '', timestamp: Date.now() });
        localStorage.setItem('flipodVocab', JSON.stringify(vocab));
      }
    } catch {}
  }

  // ── Phase 3: Match ──

  renderPhase3() {
    const words = this.state.vocabWords;
    if (words.length === 0) {
      setTimeout(() => this.enter('4-summary'), 0);
      return '';
    }

    // Shuffle zh column
    const zhItems = [...words].sort(() => Math.random() - 0.5);

    const enHTML = words.map(w => {
      const matched = this.state.matchedPairs.has(w.word.toLowerCase());
      return `<li class="match-item ${matched ? 'is-matched' : ''}" data-action="match-tap" data-id="${this.esc(w.word.toLowerCase())}" data-side="en" role="button" tabindex="0">${this.esc(w.word)}</li>`;
    }).join('');

    const zhHTML = zhItems.map(w => {
      const matched = this.state.matchedPairs.has(w.word.toLowerCase());
      const shortDef = (WORD_DEFS[w.word.toLowerCase()] || w.def || '').split('；')[0].split('；')[0];
      return `<li class="match-item ${matched ? 'is-matched is-correct' : ''}" data-action="match-tap" data-id="${this.esc(w.word.toLowerCase())}" data-side="zh" role="button" tabindex="0">${this.esc(shortDef)}${matched ? ' <span class="check">✓</span>' : ''}</li>`;
    }).join('');

    return `
      <section class="tp-phase">
        <div class="tp-phase-head">
          <span class="tp-phase-dot"></span>
          <h3>连线配对</h3>
          <button class="tp-phase-skip" data-action="skip-phase-3">跳过</button>
        </div>
        <div class="match-hint"><hr><span>试试把英文词和中文释义配对</span><hr></div>
        <div class="match-board">
          <ul class="match-col match-col--en">${enHTML}</ul>
          <ul class="match-col match-col--zh">${zhHTML}</ul>
        </div>
        <p class="match-progress">${this.state.matchedPairs.size} / ${words.length} 已配对</p>
      </section>`;
  }

  handleMatchTap(el) {
    if (el.classList.contains('is-matched')) return;

    // TTS for English words
    if (el.dataset.side === 'en' && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(el.textContent.trim());
      u.lang = 'en-US';
      u.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }

    const sel = this.state.selectedMatchItem;
    if (!sel) {
      // First selection
      this.state.selectedMatchItem = el;
      el.classList.add('is-selected');
      return;
    }

    if (sel === el) {
      // Deselect
      el.classList.remove('is-selected');
      this.state.selectedMatchItem = null;
      return;
    }

    // Same side? Switch selection
    if (sel.dataset.side === el.dataset.side) {
      sel.classList.remove('is-selected');
      el.classList.add('is-selected');
      this.state.selectedMatchItem = el;
      return;
    }

    // Different sides - check match
    const correct = sel.dataset.id === el.dataset.id;
    sel.classList.remove('is-selected');
    this.state.selectedMatchItem = null;
    this.state.matchAttempts++;

    if (correct) {
      sel.classList.add('is-matched');
      el.classList.add('is-matched', 'is-correct');
      el.innerHTML = el.textContent.trim() + ' <span class="check">✓</span>';
      this.state.matchedPairs.add(sel.dataset.id);

      // Draw line
      this.drawMatchLine(sel, el);

      // Update progress
      const prog = this.root.querySelector('.match-progress');
      if (prog) prog.textContent = `${this.state.matchedPairs.size} / ${this.state.vocabWords.length} 已配对`;

      // All done?
      if (this.state.matchedPairs.size === this.state.vocabWords.length) {
        setTimeout(() => this.enter('4-summary'), 800);
      }
    } else {
      // Wrong - shake
      [sel, el].forEach(item => {
        item.classList.add('is-wrong');
        setTimeout(() => item.classList.remove('is-wrong'), 500);
      });
    }
  }

  initMatchLines() {
    // Re-draw lines for already matched pairs (after re-render)
    // Not needed on first render since no pairs are matched yet
  }

  drawMatchLine(a, b) {
    const svg = this.root.querySelector('.match-lines');
    if (!svg) return;
    const board = this.root.querySelector('.match-board');
    if (!board) return;
    const bRect = board.getBoundingClientRect();
    const aRect = a.getBoundingClientRect();
    const bR = b.getBoundingClientRect();

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const x1 = aRect.right - bRect.left;
    const y1 = aRect.top + aRect.height / 2 - bRect.top;
    const x2 = bR.left - bRect.left;
    const y2 = bR.top + bR.height / 2 - bRect.top;
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    svg.appendChild(line);
  }

  // ── Phase 4: Summary ──

  renderPhase4() {
    const words = this.state.vocabWords;
    const gistLabel = this.state.gistCorrect === true ? '✓'
                    : this.state.gistCorrect === false ? '✗' : '—';
    const gistClass = this.state.gistCorrect === true ? 'n--success' : 'n--accent';

    const pillsHTML = words.map(w => {
      const dotClass = w.cefr.toLowerCase();
      return `<li><span class="cefr-dot ${dotClass}"></span>${this.esc(w.word)}</li>`;
    }).join('');

    const pinnedCount = this.state.pinnedWords.size;

    return `
      <section class="tp-phase">
        <div class="tp-phase-head">
          <span class="tp-phase-dot"></span>
          <h3>本次学习</h3>
        </div>

        <div class="stats-grid">
          <div class="tp-stat"><span class="n n--accent">${words.length}</span><span class="lab">新词汇</span></div>
          <div class="tp-stat"><span class="n ${gistClass}">${gistLabel}</span><span class="lab">理解</span></div>
          <div class="tp-stat"><span class="n n--accent">${this.state.matchedPairs.size}/${words.length}</span><span class="lab">配对</span></div>
        </div>

        <div class="vocab-book">
          <h4>词汇</h4>
          <ul class="vocab-pills">${pillsHTML}</ul>
          <button class="tp-link-btn ${pinnedCount === words.length ? 'is-done' : ''}" data-action="save-all-vocab">
            ${pinnedCount === words.length ? '✓ 已全部加入' : '全部加入生词本 →'}
          </button>
        </div>

        <fieldset class="tp-difficulty">
          <legend>这段内容对你来说？</legend>
          <div class="tp-diff-row">
            <label class="tp-diff-option" data-action="diff-select" data-value="easy">
              <input type="radio" name="diff" value="easy">太简单
            </label>
            <label class="tp-diff-option is-checked" data-action="diff-select" data-value="right">
              <input type="radio" name="diff" value="right" checked>正合适
            </label>
            <label class="tp-diff-option" data-action="diff-select" data-value="hard">
              <input type="radio" name="diff" value="hard">有点难
            </label>
          </div>
        </fieldset>

        <button class="tp-cta tp-cta--primary" data-action="next-clip">下一个 →</button>
      </section>`;
  }

  initDiffRadios() {
    // The is-checked class is toggled by handleDiffSelect
  }

  handleDiffSelect(el) {
    const value = el.dataset.value;
    if (!value) return;
    this.state.difficulty = value;

    // Toggle is-checked (no :has() needed)
    this.root.querySelectorAll('.tp-diff-option').forEach(opt => {
      opt.classList.toggle('is-checked', opt.dataset.value === value);
      const radio = opt.querySelector('input');
      if (radio) radio.checked = opt.dataset.value === value;
    });
  }

  handleSaveAll(el) {
    this.state.vocabWords.forEach(w => {
      this.state.pinnedWords.add(w.word.toLowerCase());
      try {
        const vocab = JSON.parse(localStorage.getItem('flipodVocab') || '[]');
        if (!vocab.find(v => v.word === w.word.toLowerCase())) {
          vocab.push({ word: w.word.toLowerCase(), cefr: w.cefr, context: '', timestamp: Date.now() });
          localStorage.setItem('flipodVocab', JSON.stringify(vocab));
        }
      } catch {}
    });
    el.textContent = '✓ 已全部加入';
    el.classList.add('is-done');
  }

  handleNextClip() {
    // Save difficulty feedback → adjust CEFR
    const diff = this.state.difficulty;
    try {
      const currentCEFR = parseFloat(localStorage.getItem('flipodUserCEFR') || '') || CEFR_NUM[localStorage.getItem('flipodLevel') || 'B1'] || 3;
      let adj = 0;
      if (diff === 'easy') adj = 0.3;
      if (diff === 'hard') adj = -0.3;
      const newVal = Math.max(1, Math.min(6, currentCEFR + adj));
      const levels = ['A1','A2','B1','B2','C1','C2'];
      const levelStr = levels[Math.min(Math.round(newVal) - 1, 5)];
      localStorage.setItem('flipodUserCEFR', levelStr);
    } catch {}

    // Log teaching result
    try {
      const log = JSON.parse(localStorage.getItem('flipodTeachingLog') || '{}');
      const clipId = this.clip.id || `clip_${window.currentIdx}`;
      log[clipId] = {
        timestamp: Date.now(),
        gist_result: this.state.gistCorrect,
        vocab_count: this.state.vocabWords.length,
        pinned: [...this.state.pinnedWords],
        match_score: `${this.state.matchedPairs.size}/${this.state.vocabWords.length}`,
        difficulty: this.state.difficulty,
      };
      localStorage.setItem('flipodTeachingLog', JSON.stringify(log));
    } catch {}

    // Reset skip counter
    localStorage.setItem('flipodConsecutiveSkips', '0');

    // Exit
    this.root.classList.add('is-exiting');
    setTimeout(() => {
      if (this.onFinish) this.onFinish();
    }, 250);
  }

  handleSkipAll() {
    // Track consecutive skips
    let skips = parseInt(localStorage.getItem('flipodConsecutiveSkips') || '0');
    skips++;
    localStorage.setItem('flipodConsecutiveSkips', String(skips));

    this.root.classList.add('is-exiting');
    setTimeout(() => {
      if (this.onFinish) this.onFinish();
    }, 250);
  }

  destroy() {
    this.root.innerHTML = '';
    this.root.classList.remove('is-visible', 'is-exiting');
  }

  // ── Utility ──

  esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// Expose globally for index.html integration
window.TeachingController = TeachingController;
