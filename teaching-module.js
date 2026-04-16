/**
 * Flipod Teaching Module v1
 *
 * 独立模块，通过 3 个 hook 接入主流程：
 *   1. onWordTap(word, cefr, lineIndex, timestamp)  — 听中行为采集
 *   2. onClipEnd(clipIndex)                          — 触发教学流
 *   3. onTeachingDismiss(clipIndex)                  — 教学结束，恢复 Feed 流
 *
 * 依赖：
 *   - clips[]         全局 clip 数据（含 teaching 字段）
 *   - audios[]        全局音频对象
 *   - currentIdx      当前 clip 索引
 *   - flipodLevel     localStorage 中的用户 CEFR 等级
 */

const TeachingModule = (() => {

  // ═══════════════════════════════════════════
  // 状态
  // ═══════════════════════════════════════════

  // 当前 clip 的听中行为缓冲区
  let clipBehavior = {
    clipIndex: -1,
    clicked_words: [],   // { word, cefr, lineIndex, timestamp }
    saved_words: [],     // { word, cefr, lineIndex, timestamp }
    replays: []          // { timestamp, position }
  };

  // 教学流状态
  let teachingState = {
    active: false,
    phase: null,         // 'gist' | 'vocab' | 'exercise' | 'summary'
    clipIndex: -1,
    selectedWords: [],   // Phase 2 选出的教学词
    gistResult: null,    // 'correct' | 'wrong' | 'skipped'
    exerciseResult: null
  };

  // 用户连续跳过计数
  let consecutiveSkips = 0;

  // ═══════════════════════════════════════════
  // Hook 1: 听中行为采集
  // ═══════════════════════════════════════════

  function onWordTap(word, cefr, lineIndex, timestamp) {
    // 如果换了 clip，重置缓冲区
    if (clipBehavior.clipIndex !== currentIdx) {
      clipBehavior = {
        clipIndex: currentIdx,
        clicked_words: [],
        saved_words: [],
        replays: []
      };
    }
    // 去重
    if (!clipBehavior.clicked_words.find(w => w.word === word)) {
      clipBehavior.clicked_words.push({ word, cefr, lineIndex, timestamp });
    }
  }

  function onWordSave(word, cefr, lineIndex) {
    if (clipBehavior.clipIndex !== currentIdx) return;
    if (!clipBehavior.saved_words.find(w => w.word === word)) {
      clipBehavior.saved_words.push({ word, cefr, lineIndex, timestamp: Date.now() });
    }
  }

  function onReplay(position) {
    if (clipBehavior.clipIndex !== currentIdx) return;
    clipBehavior.replays.push({ timestamp: Date.now(), position });
  }

  // ═══════════════════════════════════════════
  // Hook 2: clip 播完 → 触发教学
  // ═══════════════════════════════════════════

  function onClipEnd(clipIndex) {
    const clip = clips[clipIndex];
    if (!clip || !clip.teaching) {
      // 没有教学数据，走原逻辑
      return false; // 返回 false 表示不拦截
    }

    // 连续跳过 3 次 → 折叠教学，只显示 mini 入口
    if (consecutiveSkips >= 3) {
      showMiniEntry(clipIndex);
      return true;
    }

    teachingState = {
      active: true,
      phase: 'gist',
      clipIndex,
      selectedWords: [],
      gistResult: null,
      exerciseResult: null
    };

    showGist(clipIndex);
    return true; // 返回 true 表示拦截了 auto-advance
  }

  // ═══════════════════════════════════════════
  // Phase 1: Gist 题
  // ═══════════════════════════════════════════

  function showGist(clipIndex) {
    const clip = clips[clipIndex];
    const teaching = clip.teaching;
    const userLevel = getUserLevel();

    // 选择对应难度的 Gist 变体
    let gist = teaching.gist;
    if (gist.difficulty_variants && gist.difficulty_variants[userLevel]) {
      gist = { ...gist, ...gist.difficulty_variants[userLevel] };
    }

    const container = createTeachingCard(clipIndex);
    container.innerHTML = `
      <div class="teaching-phase teaching-gist">
        <div class="teaching-header">
          <span class="teaching-phase-label">理解检测</span>
          <button class="teaching-skip" data-action="skip-gist">跳过</button>
        </div>
        <p class="teaching-question">${gist.question}</p>
        <div class="teaching-options">
          ${gist.options.map((opt, i) => `
            <button class="teaching-option" data-index="${i}" data-correct="${opt.correct}">
              ${opt.text}
            </button>
          `).join('')}
        </div>
        <div class="teaching-feedback" style="display:none"></div>
      </div>
    `;

    // 事件绑定
    container.querySelectorAll('.teaching-option').forEach(btn => {
      btn.addEventListener('click', () => handleGistAnswer(btn, gist, clipIndex));
    });

    container.querySelector('[data-action="skip-gist"]').addEventListener('click', () => {
      teachingState.gistResult = 'skipped';
      consecutiveSkips++;
      showVocab(clipIndex);
    });

    insertTeachingCard(container, clipIndex);
  }

  function handleGistAnswer(btn, gist, clipIndex) {
    const isCorrect = btn.dataset.correct === 'true';
    const container = btn.closest('.teaching-gist');
    const feedback = container.querySelector('.teaching-feedback');

    // 禁用所有选项
    container.querySelectorAll('.teaching-option').forEach(b => {
      b.disabled = true;
      if (b.dataset.correct === 'true') b.classList.add('correct');
    });

    if (isCorrect) {
      btn.classList.add('correct');
      teachingState.gistResult = 'correct';
      consecutiveSkips = 0;
      feedback.innerHTML = `
        <div class="feedback-correct">
          <span>✓</span>
          <p>${gist.correct_insight || ''}</p>
        </div>
      `;
      feedback.style.display = 'block';

      // 1.5 秒后进入 Phase 2
      setTimeout(() => showVocab(clipIndex), 1500);

    } else {
      btn.classList.add('wrong');
      teachingState.gistResult = 'wrong';
      feedback.innerHTML = `
        <div class="feedback-wrong">
          <p>${gist.focus_hint ? gist.focus_hint.text : '再听一遍试试'}</p>
          ${gist.focus_hint ? `
            <button class="teaching-relisten" data-time="${gist.focus_hint.timestamp}">
              ▶ 重听这一段
            </button>
          ` : ''}
        </div>
      `;
      feedback.style.display = 'block';

      // 重听按钮
      const relistenBtn = feedback.querySelector('.teaching-relisten');
      if (relistenBtn) {
        relistenBtn.addEventListener('click', () => {
          const audio = audios[clipIndex];
          if (audio) {
            audio.currentTime = parseFloat(relistenBtn.dataset.time);
            audio.play().catch(() => {});
          }
        });
      }

      // 允许重新作答（重新启用除已选错的选项）
      setTimeout(() => {
        container.querySelectorAll('.teaching-option').forEach(b => {
          if (b !== btn) b.disabled = false;
        });
      }, 500);
    }
  }

  // ═══════════════════════════════════════════
  // Phase 2: 词汇卡片（行为优先 + 算法补齐）
  // ═══════════════════════════════════════════

  function showVocab(clipIndex) {
    teachingState.phase = 'vocab';
    const clip = clips[clipIndex];
    const teaching = clip.teaching;
    const userLevel = getUserLevel();

    // 选词：行为优先 + 算法补齐
    const selectedWords = selectTeachingWords(teaching.word_pool, userLevel);
    teachingState.selectedWords = selectedWords;

    const container = getTeachingCard(clipIndex);
    if (!container) return;

    const vocabHTML = selectedWords.map(w => `
      <div class="teaching-word-card">
        <div class="word-header">
          <span class="word-text">${w.word}</span>
          <span class="word-cefr cefr-${w.cefr.toLowerCase()}">${w.cefr}</span>
          ${w.fromBehavior ? '<span class="word-behavior-tag">🔖 你查过这个词</span>' : ''}
        </div>
        <p class="word-context">"…${w.context_en}…"</p>
        <p class="word-context-zh">${w.context_zh}</p>
        <p class="word-definition">${w.definition_zh}</p>
        ${w.alreadySaved
          ? '<span class="word-saved">已收藏 ✓</span>'
          : `<button class="word-save-btn" data-word="${w.word}">加入生词本</button>`
        }
      </div>
    `).join('');

    const phaseHTML = `
      <div class="teaching-phase teaching-vocab">
        <div class="teaching-header">
          <span class="teaching-phase-label">本段词汇</span>
          <button class="teaching-skip" data-action="skip-vocab">跳过</button>
        </div>
        ${vocabHTML}
        <button class="teaching-cta" data-action="start-exercise">练习这些词汇 →</button>
      </div>
    `;

    // 追加到已有教学卡片
    container.insertAdjacentHTML('beforeend', phaseHTML);

    // 事件
    container.querySelectorAll('.word-save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const word = btn.dataset.word;
        saveToVocab(word, selectedWords.find(w => w.word === word));
        btn.textContent = '已收藏 ✓';
        btn.disabled = true;
      });
    });

    container.querySelector('[data-action="skip-vocab"]').addEventListener('click', () => {
      consecutiveSkips++;
      finishTeaching(clipIndex);
    });

    container.querySelector('[data-action="start-exercise"]').addEventListener('click', () => {
      consecutiveSkips = 0;
      showExercise(clipIndex);
    });
  }

  function selectTeachingWords(wordPool, userLevel) {
    const MAX_WORDS = 3;
    const targetLevel = getTargetLevel(userLevel); // i+1
    const result = [];
    const savedWords = getSavedVocab();

    // 第 1 步：收藏词（最高优先）
    for (const w of clipBehavior.saved_words) {
      if (result.length >= MAX_WORDS) break;
      const poolEntry = findInPool(wordPool, w.word);
      if (poolEntry) {
        result.push({ ...poolEntry, fromBehavior: true, alreadySaved: true });
      } else {
        // 用户收藏了但词池里没有（可能是 A1 词），依然尊重
        result.push({
          word: w.word,
          cefr: w.cefr,
          line_index: w.lineIndex,
          context_en: getContextFromClip(w.lineIndex),
          context_zh: '',
          definition_zh: '（释义待补）',
          fromBehavior: true,
          alreadySaved: true
        });
      }
    }

    // 第 2 步：点击词（次优先，过滤掉离 i+1 太远的）
    for (const w of clipBehavior.clicked_words) {
      if (result.length >= MAX_WORDS) break;
      if (result.find(r => r.word === w.word)) continue; // 去重
      const poolEntry = findInPool(wordPool, w.word);
      if (poolEntry) {
        result.push({
          ...poolEntry,
          fromBehavior: true,
          alreadySaved: savedWords.includes(w.word)
        });
      }
    }

    // 第 3 步：算法补齐（从 targetLevel 池中取）
    if (result.length < MAX_WORDS && wordPool[targetLevel]) {
      for (const entry of wordPool[targetLevel]) {
        if (result.length >= MAX_WORDS) break;
        if (result.find(r => r.word === entry.word)) continue;
        result.push({
          ...entry,
          fromBehavior: false,
          alreadySaved: savedWords.includes(entry.word)
        });
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════
  // Phase 3: 练习（填空 / 听写）
  // ═══════════════════════════════════════════

  function showExercise(clipIndex) {
    teachingState.phase = 'exercise';
    const clip = clips[clipIndex];
    const teaching = clip.teaching;
    const selectedWordNames = teachingState.selectedWords.map(w => w.word);

    // 匹配最接近的预生成练习套
    const exerciseSet = matchExerciseSet(teaching.exercises.fill_blank.sets, selectedWordNames);

    if (!exerciseSet) {
      // 没有匹配的练习，跳到总结
      showSummary(clipIndex);
      return;
    }

    const container = getTeachingCard(clipIndex);
    if (!container) return;

    let currentItem = 0;
    let correctCount = 0;

    const exerciseHTML = `
      <div class="teaching-phase teaching-exercise">
        <div class="teaching-header">
          <span class="teaching-phase-label">词汇填空</span>
          <span class="exercise-progress">${currentItem + 1}/${exerciseSet.items.length}</span>
        </div>
        <div class="word-bank">
          ${exerciseSet.word_bank.map(w => `
            <button class="bank-word" data-word="${w}">${w}</button>
          `).join('')}
        </div>
        <div class="exercise-sentence">
          <p>${exerciseSet.items[0].sentence}</p>
        </div>
        <div class="exercise-feedback" style="display:none"></div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', exerciseHTML);

    const exerciseEl = container.querySelector('.teaching-exercise');

    exerciseEl.querySelectorAll('.bank-word').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = exerciseSet.items[currentItem];
        const isCorrect = btn.dataset.word === item.answer;
        const feedbackEl = exerciseEl.querySelector('.exercise-feedback');

        if (isCorrect) {
          correctCount++;
          feedbackEl.innerHTML = '<span class="correct">✓</span>';
          feedbackEl.style.display = 'block';

          // 下一题或完成
          setTimeout(() => {
            currentItem++;
            if (currentItem < exerciseSet.items.length) {
              exerciseEl.querySelector('.exercise-sentence p').textContent =
                exerciseSet.items[currentItem].sentence;
              exerciseEl.querySelector('.exercise-progress').textContent =
                `${currentItem + 1}/${exerciseSet.items.length}`;
              feedbackEl.style.display = 'none';
              // 重置所有词按钮为可点击状态
              exerciseEl.querySelectorAll('.bank-word').forEach(b => {
                b.classList.remove('used');
                b.classList.remove('wrong-shake');
              });
            } else {
              teachingState.exerciseResult = { correct: correctCount, total: exerciseSet.items.length };
              showSummary(clipIndex);
            }
          }, 800);
        } else {
          feedbackEl.innerHTML = '<span class="wrong">✗ 再试一次</span>';
          feedbackEl.style.display = 'block';
          btn.classList.add('wrong-shake');
          setTimeout(() => btn.classList.remove('wrong-shake'), 500);
        }
      });
    });
  }

  function matchExerciseSet(sets, selectedWords) {
    if (!sets || sets.length === 0) return null;

    let bestMatch = null;
    let bestScore = -1;

    for (const set of sets) {
      const overlap = set.target_words.filter(w => selectedWords.includes(w)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestMatch = set;
      }
    }

    return bestMatch;
  }

  // ═══════════════════════════════════════════
  // Phase 4: 总结
  // ═══════════════════════════════════════════

  function showSummary(clipIndex) {
    teachingState.phase = 'summary';
    const container = getTeachingCard(clipIndex);
    if (!container) return;

    const clip = clips[clipIndex];
    const teaching = clip.teaching;
    const words = teachingState.selectedWords;
    const gist = teachingState.gistResult;
    const exercise = teachingState.exerciseResult;
    const behaviorCount = words.filter(w => w.fromBehavior).length;

    let statsHTML = '';
    if (gist && gist !== 'skipped') {
      statsHTML += `<p>理解题：${gist === 'correct' ? '✓ 答对' : '第二次答对'}</p>`;
    }
    if (words.length > 0) {
      statsHTML += `<p>新词 ${words.length} 个${behaviorCount > 0 ? `（其中 ${behaviorCount} 个来自你的查词记录）` : ''}</p>`;
    }
    if (exercise) {
      statsHTML += `<p>填空：${exercise.correct}/${exercise.total} 正确</p>`;
    }

    // 难度反馈
    const reflectionHTML = `
      <div class="teaching-reflection">
        <p class="reflection-prompt">这段内容对你来说？</p>
        <div class="difficulty-feedback">
          <button class="reflection-option" data-difficulty="easy">太简单</button>
          <button class="reflection-option" data-difficulty="ok">正合适</button>
          <button class="reflection-option" data-difficulty="hard">有点难</button>
        </div>
      </div>
    `;

    const summaryHTML = `
      <div class="teaching-phase teaching-summary">
        <div class="teaching-header">
          <span class="teaching-phase-label">本次学习</span>
        </div>
        <div class="summary-stats">${statsHTML}</div>
        <div class="summary-words">
          ${words.map(w => `
            <span class="summary-word cefr-${w.cefr.toLowerCase()}">${w.word} (${w.cefr})</span>
          `).join('')}
          <button class="save-all-btn">全部加入生词本</button>
        </div>
        ${reflectionHTML}
        <button class="teaching-next" data-action="next-clip">下一个 clip →</button>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', summaryHTML);

    // 事件
    container.querySelector('.save-all-btn')?.addEventListener('click', () => {
      words.forEach(w => saveToVocab(w.word, w));
      container.querySelector('.save-all-btn').textContent = '已全部收藏 ✓';
    });

    container.querySelectorAll('.reflection-option').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.reflection-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        logDifficultyFeedback(clipIndex, btn.dataset.difficulty);
      });
    });

    container.querySelector('[data-action="next-clip"]').addEventListener('click', () => {
      finishTeaching(clipIndex);
    });

    // 持久化教学记录
    logTeachingResult(clipIndex);
  }

  // ═══════════════════════════════════════════
  // Mini 入口（连续跳过 3 次后的折叠态）
  // ═══════════════════════════════════════════

  function showMiniEntry(clipIndex) {
    const container = createTeachingCard(clipIndex);
    container.innerHTML = `
      <div class="teaching-mini">
        <button class="mini-entry-btn" data-action="expand-teaching">学一下？</button>
      </div>
    `;

    container.querySelector('[data-action="expand-teaching"]').addEventListener('click', () => {
      consecutiveSkips = 0;
      container.remove();
      onClipEnd(clipIndex);
    });

    insertTeachingCard(container, clipIndex);
  }

  // ═══════════════════════════════════════════
  // Hook 3: 教学结束
  // ═══════════════════════════════════════════

  function finishTeaching(clipIndex) {
    teachingState.active = false;
    teachingState.phase = null;

    // 移除教学卡片
    const card = getTeachingCard(clipIndex);
    if (card) {
      card.classList.add('teaching-exit');
      setTimeout(() => card.remove(), 300);
    }

    // 重置行为缓冲区
    clipBehavior = { clipIndex: -1, clicked_words: [], saved_words: [], replays: [] };

    // 通知主流程恢复 auto-advance
    if (typeof onTeachingDismiss === 'function') {
      onTeachingDismiss(clipIndex);
    }
  }

  // ═══════════════════════════════════════════
  // DOM 工具
  // ═══════════════════════════════════════════

  function createTeachingCard(clipIndex) {
    const card = document.createElement('div');
    card.className = 'teaching-card';
    card.dataset.teachClip = clipIndex;
    return card;
  }

  function insertTeachingCard(card, clipIndex) {
    // 插入到当前 clip screen 的后面
    const clipScreen = document.querySelector(`.content-screen[data-idx="${clipIndex}"]`);
    if (clipScreen && clipScreen.nextElementSibling) {
      clipScreen.parentNode.insertBefore(card, clipScreen.nextElementSibling);
    } else if (clipScreen) {
      clipScreen.parentNode.appendChild(card);
    }
    // 滚动到教学卡片
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  function getTeachingCard(clipIndex) {
    return document.querySelector(`.teaching-card[data-teach-clip="${clipIndex}"]`);
  }

  // ═══════════════════════════════════════════
  // 数据工具
  // ═══════════════════════════════════════════

  function getUserLevel() {
    // 优先用持续校准值，fallback 到 onboarding 选择
    const calibrated = localStorage.getItem('flipodUserCEFR');
    if (calibrated) {
      // "B1.3" → "B1"
      return calibrated.replace(/\.\d+$/, '');
    }
    return localStorage.getItem('flipodLevel') || 'B1';
  }

  function getTargetLevel(level) {
    // i+1 映射
    const ladder = { 'A1': 'A2', 'A2': 'B1', 'B1': 'B2', 'B2': 'C1', 'C1': 'C2', 'C2': 'C2' };
    return ladder[level] || 'B2';
  }

  function findInPool(wordPool, word) {
    for (const level of Object.values(wordPool)) {
      const found = level.find(entry => entry.word.toLowerCase() === word.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  function getContextFromClip(lineIndex) {
    const clip = clips[teachingState.clipIndex];
    if (clip && clip.lines[lineIndex]) {
      return clip.lines[lineIndex].en;
    }
    return '';
  }

  function getSavedVocab() {
    try {
      const vocab = JSON.parse(localStorage.getItem('flipodVocab') || '[]');
      return vocab.map(v => v.word);
    } catch { return []; }
  }

  function saveToVocab(word, entry) {
    try {
      const vocab = JSON.parse(localStorage.getItem('flipodVocab') || '[]');
      if (!vocab.find(v => v.word === word)) {
        vocab.push({
          word,
          cefr: entry?.cefr || '',
          context: entry?.context_en || '',
          timestamp: Date.now()
        });
        localStorage.setItem('flipodVocab', JSON.stringify(vocab));
      }
    } catch {}
  }

  function logTeachingResult(clipIndex) {
    try {
      const log = JSON.parse(localStorage.getItem('flipodTeachingLog') || '{}');
      const clipId = clips[clipIndex]?.id || `clip_${clipIndex}`;
      log[clipId] = {
        timestamp: Date.now(),
        gist_result: teachingState.gistResult,
        words_shown: teachingState.selectedWords.map(w => ({
          word: w.word,
          cefr: w.cefr,
          fromBehavior: w.fromBehavior
        })),
        exercise_result: teachingState.exerciseResult,
        behavior: {
          words_clicked: clipBehavior.clicked_words.length,
          words_saved: clipBehavior.saved_words.length,
          replays: clipBehavior.replays.length
        }
      };
      localStorage.setItem('flipodTeachingLog', JSON.stringify(log));
    } catch {}
  }

  function logDifficultyFeedback(clipIndex, difficulty) {
    try {
      const log = JSON.parse(localStorage.getItem('flipodTeachingLog') || '{}');
      const clipId = clips[clipIndex]?.id || `clip_${clipIndex}`;
      if (log[clipId]) {
        log[clipId].difficulty_feedback = difficulty; // 'easy' | 'ok' | 'hard'
        localStorage.setItem('flipodTeachingLog', JSON.stringify(log));
      }
      // 用于 CEFR 校准：太简单 → 上调，有点难 → 下调
      if (difficulty === 'easy') adjustCEFR(0.3);
      if (difficulty === 'hard') adjustCEFR(-0.3);
    } catch {}
  }

  function adjustCEFR(delta) {
    try {
      const current = cefrToNum(getUserLevel());
      const newVal = Math.max(1, Math.min(6, current + delta));
      localStorage.setItem('flipodUserCEFR', numToCefr(newVal));
    } catch {}
  }

  // ═══════════════════════════════════════════
  // 用户水平持续校准
  // ═══════════════════════════════════════════

  function updateCEFREstimate() {
    try {
      const log = JSON.parse(localStorage.getItem('flipodTeachingLog') || '{}');
      const entries = Object.values(log).sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);

      if (entries.length < 3) return; // 数据不够，不校准

      // Gist 正确率
      const gistEntries = entries.filter(e => e.gist_result && e.gist_result !== 'skipped');
      const gistCorrectRate = gistEntries.length > 0
        ? gistEntries.filter(e => e.gist_result === 'correct').length / gistEntries.length
        : 0.5;

      // 点词行为的平均 CEFR
      const allClickedCEFR = entries
        .flatMap(e => (e.behavior?.clicked_words_detail || []).map(w => cefrToNum(w.cefr)))
        .filter(n => n > 0);

      const currentEstimate = parseFloat(localStorage.getItem('flipodUserCEFR')?.replace(/[A-C]/g, '') || '0')
        || cefrToNum(localStorage.getItem('flipodLevel') || 'B1');

      let adjustment = 0;
      if (gistCorrectRate > 0.8) adjustment += 0.2;   // 太简单，上调
      if (gistCorrectRate < 0.4) adjustment -= 0.3;   // 太难，快速下调

      const newEstimate = Math.max(1, Math.min(6, currentEstimate + adjustment));
      localStorage.setItem('flipodUserCEFR', numToCefr(newEstimate));
    } catch {}
  }

  function cefrToNum(level) {
    const map = { 'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 };
    return map[level] || 3;
  }

  function numToCefr(num) {
    if (num <= 1.5) return 'A1';
    if (num <= 2.5) return 'A2';
    if (num <= 3.5) return 'B1';
    if (num <= 4.5) return 'B2';
    if (num <= 5.5) return 'C1';
    return 'C2';
  }

  // ═══════════════════════════════════════════
  // 公开 API
  // ═══════════════════════════════════════════

  return {
    onWordTap,
    onWordSave,
    onReplay,
    onClipEnd,
    finishTeaching,
    updateCEFREstimate,

    // 状态查询（供主流程判断）
    isActive: () => teachingState.active,
    getPhase: () => teachingState.phase,
    getClipBehavior: () => ({ ...clipBehavior })
  };

})();
