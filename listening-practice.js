/**
 * Listening Practice Controller
 * Three-round progressive listening training with mock data + SpeechSynthesis TTS.
 */
(function () {
  'use strict';

  /* ── State machine ── */
  var State = {
    INIT: 'init',
    R1_PLAY: 'r1_play',
    R1_QUIZ: 'r1_quiz',
    R2_PLAY: 'r2_play',
    R2_RESULT: 'r2_result',
    R3_PLAY: 'r3_play',
    R3_QUIZ: 'r3_quiz',
    COMPLETE: 'complete'
  };

  var transitions = {
    init:       { loaded: 'r1_play' },
    r1_play:    { ended: 'r1_quiz' },
    r1_quiz:    { done: 'r2_play', skip: 'r2_play' },
    r2_play:    { ended: 'r2_result' },
    r2_result:  { next: 'r3_play', skip: 'complete' },
    r3_play:    { ended: 'r3_quiz' },
    r3_quiz:    { done: 'complete' },
    complete:   { restart: 'r1_play', exit: null }
  };

  /* ── Helpers ── */
  var CLOSE_SVG = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  var PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function cefrClass(level) {
    return 'lp-cefr-' + (level || 'b1').toLowerCase();
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

  /** Replace target words with input blanks, returning {html, blanks:[{word, id}]} */
  function clozeInputs(text, targets) {
    var blanks = [];
    var result = text;
    targets.forEach(function (w) {
      var re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      result = result.replace(re, function (match) {
        var id = 'lp-blank-' + blanks.length;
        blanks.push({ word: match, id: id });
        return '<input type="text" class="lp-cloze-input" id="' + id +
          '" data-answer="' + match.toLowerCase() +
          '" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="______">' +
          '<button class="lp-r2-submit lp-hidden" data-action="check-blank" data-blank-id="' + id + '">OK</button>';
      });
    });
    return { html: result, blanks: blanks };
  }

  /** Build cloze dropdown quiz for Round 3 */
  function clozeDropdowns(text, targets, extraWords) {
    var allWords = targets.concat(extraWords || []);
    // shuffle options
    var options = allWords.slice().sort(function () { return Math.random() - 0.5; });
    var optionsHtml = '<option value="">---</option>' +
      options.map(function (w) { return '<option value="' + w.toLowerCase() + '">' + w + '</option>'; }).join('');

    var blanks = [];
    var result = text;
    // Replace all target words + extra words
    allWords.forEach(function (w) {
      var re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      result = result.replace(re, function (match) {
        var id = 'lp-sel-' + blanks.length;
        blanks.push({ word: match, id: id });
        return '<select class="lp-cloze-select" id="' + id + '" data-answer="' + match.toLowerCase() + '">' + optionsHtml + '</select>';
      });
    });
    return { html: result, blanks: blanks };
  }

  /* ── TTS ── */
  var _voicesReady = false;
  var _voicesPromise = new Promise(function (resolve) {
    var voices = speechSynthesis.getVoices();
    if (voices && voices.length) { _voicesReady = true; resolve(voices); return; }
    speechSynthesis.addEventListener('voiceschanged', function onVoices() {
      speechSynthesis.removeEventListener('voiceschanged', onVoices);
      _voicesReady = true;
      resolve(speechSynthesis.getVoices());
    });
    // Fallback: if voiceschanged never fires, resolve after 2s anyway
    setTimeout(function () { if (!_voicesReady) { _voicesReady = true; resolve([]); } }, 2000);
  });

  function _pickVoice(voices) {
    // Prefer a natural-sounding en-US voice
    var preferred = ['Samantha', 'Karen', 'Daniel', 'Google US English', 'Google UK English Female'];
    for (var i = 0; i < preferred.length; i++) {
      for (var j = 0; j < voices.length; j++) {
        if (voices[j].name.indexOf(preferred[i]) !== -1 && voices[j].lang.indexOf('en') === 0) return voices[j];
      }
    }
    // Fallback: any English voice
    for (var k = 0; k < voices.length; k++) {
      if (voices[k].lang.indexOf('en') === 0) return voices[k];
    }
    return null;
  }

  /**
   * Speak text via SpeechSynthesis.
   * CRITICAL: speechSynthesis.speak() MUST run in the synchronous call stack
   * of a user gesture (click/tap). Wrapping it in .then() or await breaks
   * Chrome's autoplay policy and the utterance silently fails.
   */
  function speakText(text, rate) {
    // Get voices synchronously — they're already loaded by the time user clicks play
    var voices = speechSynthesis.getVoices();
    var voice = _pickVoice(voices);

    return new Promise(function (resolve) {
      var utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'en-US';
      utt.rate = rate || 1.0;
      if (voice) utt.voice = voice;

      var resolved = false;
      function done() {
        if (!resolved) {
          resolved = true;
          clearInterval(resumeInterval);
          clearTimeout(fallbackTimer);
          resolve();
        }
      }

      utt.onend = done;
      utt.onerror = function (ev) {
        console.warn('[LP-TTS] error:', ev.error);
        done();
      };

      // Safety timeout based on word count
      var wordCount = text.split(/\s+/).length;
      var estimatedMs = Math.max(4000, wordCount * 700);
      var fallbackTimer = setTimeout(done, estimatedMs);

      // Chrome bug: long utterances auto-pause
      var resumeInterval = setInterval(function () {
        if (resolved) { clearInterval(resumeInterval); return; }
        if (speechSynthesis.paused) speechSynthesis.resume();
      }, 3000);

      // MUST be synchronous — no .then(), no await, no setTimeout before this
      speechSynthesis.speak(utt);
    });
  }

  function cancelTTS() {
    speechSynthesis.cancel();
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

  ListeningPracticeController.prototype.open = function (forceUnlock) {
    // Stop feed audio — don't blast two things at once
    pauseFeedAudio();

    var vocab = [];
    try { vocab = JSON.parse(localStorage.getItem('flipodVocab')) || []; } catch (e) { /* */ }

    // Auto-inject mock vocab if insufficient (demo)
    if (vocab.length < 5 && window.LP_MOCK) {
      vocab = window.LP_MOCK.initMockVocab();
    }

    this.overlay.innerHTML = '';
    this.overlay.classList.add('open');

    // forceUnlock param lets us preview the unlock page (debug)
    if (forceUnlock || vocab.length < 5) {
      this._renderUnlock(forceUnlock ? 2 : vocab.length);
    } else {
      this._renderSelect();
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
      case State.R1_PLAY: this._renderRound1(); break;
      case State.R1_QUIZ: this._renderGist(); break;
      case State.R2_PLAY: this._renderRound2(); break;
      case State.R2_RESULT: this._renderRound2Result(); break;
      case State.R3_PLAY: this._renderRound3(); break;
      case State.R3_QUIZ: this._renderRound3Quiz(); break;
      case State.COMPLETE: this._renderComplete(); break;
    }
  };

  /* ── Render: Unlock card ── */
  ListeningPracticeController.prototype._renderUnlock = function (count) {
    var pct = Math.min(100, Math.round((count / 5) * 100));
    var need = 5 - count;
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
          '<div class="lp-unlock-count">' + count + ' / 5</div>' +
          '<div class="lp-unlock-hint">在 Feed 里听播客、收藏生词<br>积累到 5 个词自动解锁</div>' +
          '<button class="lp-unlock-btn" data-action="go-feed">去听播客 →</button>' +
        '</div>' +
      '</div>';
  };

  /* ── Render: Practice selection ── */
  ListeningPracticeController.prototype._renderSelect = function () {
    var practices = (window.LP_MOCK && window.LP_MOCK.MOCK_PRACTICES) || [];
    var cardsHtml = practices.map(function (p) {
      var duration = p.lines.length ? Math.round(p.lines[p.lines.length - 1].end) : 0;
      var wordsHtml = p.target_words.map(function (w) {
        return '<span class="lp-card-word">' + w + '</span>';
      }).join('');
      return '<div class="lp-card" data-action="start" data-id="' + p.id + '">' +
        '<div class="lp-card-title">' + p.title + '</div>' +
        '<div class="lp-card-meta">' + p.tag + ' · ' + p.cefr + ' · ' + duration + 's</div>' +
        '<div class="lp-card-words">' + wordsHtml + '</div>' +
        '<span class="lp-card-btn">开始练习 →</span>' +
      '</div>';
    }).join('');

    this.overlay.innerHTML =
      '<div class="lp-header">' +
        '<button class="lp-close" data-action="close">' + CLOSE_SVG + '</button>' +
        '<div class="lp-round-label"></div><div class="lp-round-dots"></div>' +
      '</div>' +
      '<div class="lp-body">' +
        '<div class="lp-select-title">🎧 听力练习</div>' +
        cardsHtml +
        '<div class="lp-select-footer">练习材料基于你的生词本 AI 生成，每次内容不同</div>' +
      '</div>';
  };

  /* ── Start practice ── */
  ListeningPracticeController.prototype.startPractice = function (id) {
    var practices = (window.LP_MOCK && window.LP_MOCK.MOCK_PRACTICES) || [];
    this.practice = practices.find(function (p) { return p.id === id; });
    if (!this.practice) return;
    this.r2Answers = {};
    this.r3Answers = {};
    this.ttsCancelled = false;
    this.state = State.INIT;
    this.transition('loaded');
  };

  /* ── Round indicator ── */
  ListeningPracticeController.prototype._roundHeader = function (roundNum, label) {
    var dots = '';
    for (var i = 1; i <= 3; i++) {
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

  /* ── Round 1: Full subtitle listen ── */
  ListeningPracticeController.prototype._renderRound1 = function () {
    var p = this.practice;
    var linesHtml = p.lines.map(function (line, i) {
      var en = highlightTargets(line.en, line.target_words);
      return '<div class="lp-line" data-line="' + i + '">' +
        '<div class="lp-line-en">' + en + '</div>' +
        '<div class="lp-line-zh">' + line.zh + '</div>' +
      '</div>';
    }).join('');

    this.overlay.innerHTML =
      this._roundHeader(1, 'ROUND 1 · 全字幕听') +
      '<div class="lp-body">' +
        '<div class="lp-r1">' +
          '<div class="lp-r1-play-area">' +
            '<button class="lp-play-btn" data-action="r1-play">' + PLAY_SVG + '</button>' +
            '<div class="lp-r1-hint">点击播放，跟着字幕听</div>' +
          '</div>' +
          '<div class="lp-subtitles" id="lp-subtitles">' + linesHtml + '</div>' +
        '</div>' +
      '</div>';
  };

  ListeningPracticeController.prototype._playRound1 = function () {
    var self = this;
    var p = this.practice;
    var btn = this.overlay.querySelector('.lp-play-btn');
    if (this.ttsPlaying) {
      cancelTTS();
      this.ttsPlaying = false;
      this.ttsCancelled = true;
      btn.innerHTML = PLAY_SVG;
      btn.classList.remove('playing');
      return;
    }

    this.ttsPlaying = true;
    this.ttsCancelled = false;
    btn.innerHTML = PAUSE_SVG;
    btn.classList.add('playing');
    var lineEls = this.overlay.querySelectorAll('.lp-line');

    // Queue ALL utterances synchronously in the user-gesture stack.
    // Chrome requires the first speak() to be in a gesture handler;
    // subsequent speak() calls are fine as long as they are queued
    // before the queue drains (i.e. called synchronously in a batch).
    var voices = speechSynthesis.getVoices();
    var voice = _pickVoice(voices);
    var currentLine = -1;

    function highlightLine(idx) {
      lineEls.forEach(function (el, j) {
        el.classList.toggle('active', j === idx);
        if (j < idx) el.classList.add('played');
      });
      if (lineEls[idx]) lineEls[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    p.lines.forEach(function (line, i) {
      var utt = new SpeechSynthesisUtterance(line.en);
      utt.lang = 'en-US';
      utt.rate = 1.0;
      if (voice) utt.voice = voice;

      utt.onstart = function () {
        if (self.ttsCancelled) return;
        currentLine = i;
        highlightLine(i);
      };

      utt.onend = function () {
        if (self.ttsCancelled) return;
        // Mark current line as played
        if (lineEls[i]) { lineEls[i].classList.remove('active'); lineEls[i].classList.add('played'); }
        // If last line, transition
        if (i === p.lines.length - 1) {
          self.ttsPlaying = false;
          if (btn.parentNode) { btn.innerHTML = PLAY_SVG; btn.classList.remove('playing'); }
          if (self.state === State.R1_PLAY) {
            self.transition('ended');
          }
        }
      };

      utt.onerror = utt.onend; // don't hang on error

      speechSynthesis.speak(utt);
    });

    // Chrome long-utterance auto-pause workaround
    var resumeInterval = setInterval(function () {
      if (!self.ttsPlaying) { clearInterval(resumeInterval); return; }
      if (speechSynthesis.paused) speechSynthesis.resume();
    }, 3000);
  };

  /* ── Gist quiz ── */
  ListeningPracticeController.prototype._renderGist = function () {
    var g = this.practice.gist;
    var optsHtml = g.options.map(function (o, i) {
      return '<button class="lp-gist-opt" data-action="gist-answer" data-idx="' + i + '">' + o.text + '</button>';
    }).join('');

    // Keep subtitles visible, append gist below
    var body = this.overlay.querySelector('.lp-body');
    if (!body) return;
    // Mark all lines as played
    body.querySelectorAll('.lp-line').forEach(function (el) {
      el.classList.remove('active');
      el.classList.add('played');
    });
    // Hide play area
    var playArea = body.querySelector('.lp-r1-play-area');
    if (playArea) playArea.classList.add('lp-hidden');

    var gistDiv = el('div', 'lp-gist');
    gistDiv.innerHTML =
      '<div class="lp-gist-label">理解检测</div>' +
      '<div class="lp-gist-q">' + g.question + '</div>' +
      optsHtml;
    body.appendChild(gistDiv);
    gistDiv.scrollIntoView({ behavior: 'smooth' });
  };

  ListeningPracticeController.prototype._handleGistAnswer = function (idx) {
    var g = this.practice.gist;
    var opts = this.overlay.querySelectorAll('.lp-gist-opt');
    var selected = g.options[idx];
    opts.forEach(function (el, i) {
      el.classList.add('answered');
      if (g.options[i].correct) el.classList.add('correct');
      else if (i === idx && !selected.correct) el.classList.add('wrong');
      else el.classList.add('dimmed');
    });

    var gist = this.overlay.querySelector('.lp-gist');
    // Explanation
    var expl = el('div', 'lp-gist-explain', g.explanation_zh);
    gist.appendChild(expl);
    // Next button
    var nextBtn = el('button', 'lp-gist-next', '继续 →');
    nextBtn.setAttribute('data-action', 'gist-next');
    gist.appendChild(nextBtn);
  };

  /* ── Round 2: Cloze listen ── */
  ListeningPracticeController.prototype._renderRound2 = function () {
    var p = this.practice;
    var self = this;
    this.r2Answers = {};
    this._r2AllBlanks = [];

    var linesHtml = p.lines.map(function (line, i) {
      var hasTargets = line.target_words && line.target_words.length > 0;
      var enContent;
      if (hasTargets) {
        var cloze = clozeInputs(line.en, line.target_words);
        enContent = cloze.html;
        cloze.blanks.forEach(function (b) { b.lineIdx = i; });
        self._r2AllBlanks = self._r2AllBlanks.concat(cloze.blanks);
      } else {
        enContent = line.en;
      }
      return '<div class="lp-r2-line" data-line="' + i + '">' +
        '<div class="lp-r2-line-en">' + enContent + '</div>' +
        '<div class="lp-r2-line-zh">' + line.zh + '</div>' +
      '</div>';
    }).join('');

    this.overlay.innerHTML =
      this._roundHeader(2, 'ROUND 2 · 挖空听') +
      '<div class="lp-body">' +
        '<div class="lp-r2">' +
          '<div class="lp-r2-hint">点击每行旁的 ▶ 听发音，填写空缺的词</div>' +
          '<div class="lp-r2-lines" id="lp-r2-lines">' + linesHtml + '</div>' +
        '</div>' +
      '</div>';

    // Add per-line play buttons (each click is a user gesture → TTS works)
    var lineEls = this.overlay.querySelectorAll('.lp-r2-line');
    var self = this;
    lineEls.forEach(function (lineEl, i) {
      var playBtn = el('button', 'lp-r2-line-play', '▶');
      playBtn.setAttribute('data-action', 'r2-line-play');
      playBtn.setAttribute('data-line-idx', i);
      lineEl.insertBefore(playBtn, lineEl.firstChild);
    });

    // Show submit buttons for lines that have blanks
    this.overlay.querySelectorAll('.lp-r2-submit').forEach(function (btn) {
      btn.classList.remove('lp-hidden');
    });
  };

  ListeningPracticeController.prototype._playR2Line = function (lineIdx) {
    var p = this.practice;
    if (lineIdx < 0 || lineIdx >= p.lines.length) return;
    var lineEl = this.overlay.querySelectorAll('.lp-r2-line')[lineIdx];
    if (!lineEl) return;

    // Highlight active line
    this.overlay.querySelectorAll('.lp-r2-line').forEach(function (el, j) {
      el.classList.toggle('active', j === lineIdx);
    });

    // Speak this line — synchronous in user-gesture stack
    var voices = speechSynthesis.getVoices();
    var voice = _pickVoice(voices);
    var utt = new SpeechSynthesisUtterance(p.lines[lineIdx].en);
    utt.lang = 'en-US';
    utt.rate = 1.0;
    if (voice) utt.voice = voice;

    var self = this;
    utt.onend = function () {
      lineEl.classList.remove('active');
      lineEl.classList.add('played');
      // Focus first unfilled input in this line
      var firstInput = lineEl.querySelector('.lp-cloze-input:not(.correct):not(.wrong)');
      if (firstInput) firstInput.focus();
    };
    utt.onerror = utt.onend;

    speechSynthesis.cancel(); // clear any leftover queue
    speechSynthesis.speak(utt);
  };

  ListeningPracticeController.prototype._checkBlank = function (blankId) {
    var input = document.getElementById(blankId);
    if (!input || input.classList.contains('correct') || input.classList.contains('wrong')) return;
    var answer = input.dataset.answer;
    var userVal = input.value.trim().toLowerCase();
    if (!userVal) return; // ignore empty submissions
    var correct = userVal === answer;

    input.classList.add(correct ? 'correct' : 'wrong');
    this.r2Answers[blankId] = { correct: correct, word: answer, userAnswer: userVal };

    // Hide corresponding submit button
    var sibling = input.nextElementSibling;
    while (sibling) {
      if (sibling.classList.contains('lp-r2-submit') && sibling.dataset.blankId === blankId) {
        sibling.classList.add('lp-hidden');
        break;
      }
      sibling = sibling.nextElementSibling;
    }

    if (!correct) {
      // Show correct answer right after the input
      var span = el('span', 'lp-cloze-answer', answer);
      input.parentNode.insertBefore(span, input.nextElementSibling);
    }

    // Check if all blanks are now filled
    this._checkR2Complete();
  };

  ListeningPracticeController.prototype._checkR2Complete = function () {
    var allFilled = this._r2AllBlanks.every(function (b) { return b.id in this.r2Answers; }.bind(this));
    if (allFilled) {
      // Show "view results" button
      var body = this.overlay.querySelector('.lp-r2');
      if (body && !body.querySelector('.lp-r2-done-btn')) {
        var doneBtn = el('button', 'lp-r2-done-btn', '查看结果 →');
        doneBtn.setAttribute('data-action', 'r2-all-done');
        body.appendChild(doneBtn);
        doneBtn.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  /* ── Round 2 Result ── */
  ListeningPracticeController.prototype._renderRound2Result = function () {
    var blanks = this._r2AllBlanks || [];
    var correct = 0;
    var detailHtml = '';
    var self = this;
    blanks.forEach(function (b) {
      var ans = self.r2Answers[b.id];
      var ok = ans && ans.correct;
      if (ok) correct++;
      detailHtml += '<div class="lp-r2-detail-item">' +
        '<span class="lp-r2-detail-word">' + b.word + '</span>' +
        '<span class="lp-r2-detail-icon">' + (ok ? '✅' : '❌') + '</span>' +
      '</div>';
    });

    this.overlay.innerHTML =
      this._roundHeader(2, 'ROUND 2 · 结果') +
      '<div class="lp-body">' +
        '<div class="lp-r2-result">' +
          '<div class="lp-r2-score">' + correct + '/' + blanks.length + '</div>' +
          '<div class="lp-r2-score-label">填词正确</div>' +
          '<div class="lp-r2-detail">' + detailHtml + '</div>' +
          '<button class="lp-r2-continue" data-action="r2-continue">继续 →</button>' +
        '</div>' +
      '</div>';
  };

  /* ── Round 3: Blind listen ── */
  ListeningPracticeController.prototype._renderRound3 = function () {
    var waveHtml = '';
    for (var i = 0; i < 8; i++) waveHtml += '<div class="lp-wave-bar"></div>';

    this.overlay.innerHTML =
      this._roundHeader(3, 'ROUND 3 · 盲听') +
      '<div class="lp-body">' +
        '<div class="lp-r3">' +
          '<div class="lp-r3-blind">' +
            '<div class="lp-r3-hint">试试不看字幕，你能听懂多少？</div>' +
            '<div class="lp-wave" id="lp-wave">' + waveHtml + '</div>' +
            '<button class="lp-play-btn" data-action="r3-play">' + PLAY_SVG + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  };

  ListeningPracticeController.prototype._playRound3 = function () {
    var self = this;
    var p = this.practice;
    var btn = this.overlay.querySelector('[data-action="r3-play"]');
    var wave = document.getElementById('lp-wave');

    if (this.ttsPlaying) {
      cancelTTS();
      this.ttsPlaying = false;
      this.ttsCancelled = true;
      btn.innerHTML = PLAY_SVG;
      btn.classList.remove('playing');
      if (wave) wave.classList.add('paused');
      return;
    }

    this.ttsPlaying = true;
    this.ttsCancelled = false;
    btn.innerHTML = PAUSE_SVG;
    btn.classList.add('playing');
    if (wave) wave.classList.remove('paused');

    // Queue all utterances synchronously (same user-gesture pattern as R1)
    var voices = speechSynthesis.getVoices();
    var voice = _pickVoice(voices);

    p.lines.forEach(function (line, i) {
      var utt = new SpeechSynthesisUtterance(line.en);
      utt.lang = 'en-US';
      utt.rate = 1.0;
      if (voice) utt.voice = voice;

      utt.onend = function () {
        if (self.ttsCancelled) return;
        if (i === p.lines.length - 1) {
          self.ttsPlaying = false;
          if (btn.parentNode) { btn.innerHTML = PLAY_SVG; btn.classList.remove('playing'); }
          if (wave) wave.classList.add('paused');
          if (self.state === State.R3_PLAY) {
            self.transition('ended');
          }
        }
      };
      utt.onerror = utt.onend;

      speechSynthesis.speak(utt);
    });

    var resumeInterval = setInterval(function () {
      if (!self.ttsPlaying) { clearInterval(resumeInterval); return; }
      if (speechSynthesis.paused) speechSynthesis.resume();
    }, 3000);
  };

  /* ── Round 3 Quiz (Cloze dropdown) ── */
  ListeningPracticeController.prototype._renderRound3Quiz = function () {
    var p = this.practice;
    this.r3Answers = {};

    // Pick extra words from the actual text (non-target, 5+ letters, not common)
    var common = ['which','their','about','would','there','these','other','could','after',
      'where','every','should','between','through','people','because','before','during','while'];
    var targetSet = {};
    p.target_words.forEach(function (w) { targetSet[w.toLowerCase()] = true; });
    var textWords = p.text.match(/[a-zA-Z]+/g) || [];
    var candidates = [];
    var seen = {};
    textWords.forEach(function (w) {
      var lw = w.toLowerCase();
      if (lw.length >= 5 && !targetSet[lw] && !seen[lw] && common.indexOf(lw) === -1) {
        seen[lw] = true;
        candidates.push(w);
      }
    });
    var extra = candidates.sort(function () { return Math.random() - 0.5; }).slice(0, 2);

    var cloze = clozeDropdowns(p.text, p.target_words, extra);
    this._r3AllBlanks = cloze.blanks;

    this.overlay.innerHTML =
      this._roundHeader(3, 'ROUND 3 · 完形填空') +
      '<div class="lp-body">' +
        '<div class="lp-r3-quiz">' +
          '<div class="lp-r3-quiz-title">选择正确的词填空</div>' +
          '<div class="lp-r3-text">' + cloze.html + '</div>' +
          '<button class="lp-r3-submit" data-action="r3-submit">提交</button>' +
        '</div>' +
      '</div>';
  };

  ListeningPracticeController.prototype._submitRound3 = function () {
    var blanks = this._r3AllBlanks || [];
    var self = this;
    blanks.forEach(function (b) {
      var sel = document.getElementById(b.id);
      if (!sel) return;
      var userVal = sel.value;
      var correct = userVal === b.word.toLowerCase();
      self.r3Answers[b.id] = { correct: correct, word: b.word };
      sel.classList.add(correct ? 'correct' : 'wrong');
      sel.disabled = true;
    });
    // Replace submit button with next
    var submitBtn = this.overlay.querySelector('[data-action="r3-submit"]');
    if (submitBtn) {
      submitBtn.textContent = '查看总结 →';
      submitBtn.setAttribute('data-action', 'r3-done');
    }
  };

  /* ── Complete ── */
  ListeningPracticeController.prototype._renderComplete = function () {
    var p = this.practice;
    var vocabHtml = p.vocabulary.map(function (v) {
      return '<div class="lp-vocab-item">' +
        '<span class="lp-vocab-word">' + v.word + '</span>' +
        '<span class="lp-vocab-cefr ' + cefrClass(v.cefr) + '">' + v.cefr + '</span>' +
        '<span class="lp-vocab-zh">' + v.definition_zh + '</span>' +
      '</div>';
    }).join('');

    // Calc R2 + R3 scores
    var r2Total = (this._r2AllBlanks || []).length;
    var r2Correct = 0;
    var self = this;
    (this._r2AllBlanks || []).forEach(function (b) {
      if (self.r2Answers[b.id] && self.r2Answers[b.id].correct) r2Correct++;
    });
    var r3Total = (this._r3AllBlanks || []).length;
    var r3Correct = 0;
    (this._r3AllBlanks || []).forEach(function (b) {
      if (self.r3Answers[b.id] && self.r3Answers[b.id].correct) r3Correct++;
    });

    this.overlay.innerHTML =
      this._roundHeader(3, '练习完成') +
      '<div class="lp-body">' +
        '<div class="lp-complete">' +
          '<div class="lp-complete-icon">🎉</div>' +
          '<div class="lp-complete-title">练习完成！</div>' +
          '<div class="lp-complete-sub">填词 ' + r2Correct + '/' + r2Total + ' · 完形 ' + r3Correct + '/' + r3Total + '</div>' +
          '<div class="lp-diff-label">这篇难度对你来说——</div>' +
          '<div class="lp-diff-options">' +
            '<button class="lp-diff-opt" data-action="diff" data-val="easy">太简单</button>' +
            '<button class="lp-diff-opt" data-action="diff" data-val="right">正合适</button>' +
            '<button class="lp-diff-opt" data-action="diff" data-val="hard">有点难</button>' +
          '</div>' +
          '<div class="lp-vocab-review">' +
            '<div class="lp-vocab-review-title">本次练习词汇</div>' +
            vocabHtml +
          '</div>' +
          '<button class="lp-return-btn" data-action="return">返回 Feed</button>' +
        '</div>' +
      '</div>';
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
      case 'r1-play':
        this._playRound1();
        break;
      case 'gist-answer':
        this._handleGistAnswer(parseInt(target.dataset.idx, 10));
        break;
      case 'gist-next':
        this.transition('done');
        break;
      case 'r2-line-play':
        this._playR2Line(parseInt(target.dataset.lineIdx, 10));
        break;
      case 'check-blank':
        this._checkBlank(target.dataset.blankId);
        break;
      case 'r2-all-done':
        this.transition('ended');
        break;
      case 'r2-continue':
        this.transition('next');
        break;
      case 'r3-play':
        this._playRound3();
        break;
      case 'r3-submit':
        this._submitRound3();
        break;
      case 'r3-done':
        this.transition('done');
        break;
      case 'diff':
        // Visual feedback for difficulty selection
        this.overlay.querySelectorAll('.lp-diff-opt').forEach(function (btn) {
          btn.classList.toggle('selected', btn === target);
        });
        break;
      case 'return':
        this.close();
        break;
    }
  };

  ListeningPracticeController.prototype._onInput = function (e) {
    var input = e.target;
    if (!input.classList.contains('lp-cloze-input')) return;
    // Show/hide submit button based on whether input has value
    var submitBtn = input.nextElementSibling;
    if (submitBtn && submitBtn.classList.contains('lp-r2-submit')) {
      submitBtn.classList.toggle('lp-hidden', !input.value.trim());
    }
  };

  /* ── Init & expose ── */
  function init() {
    var overlay = document.getElementById('lp-overlay');
    if (!overlay) return;
    var ctrl = new ListeningPracticeController(overlay);

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
      if (e.key === 'Enter' && e.target.classList.contains('lp-cloze-input')) {
        e.preventDefault();
        ctrl._checkBlank(e.target.id);
      }
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
