# Batch 4C: Practice 总结页 — 从空洞统计改为行动面板

## 问题描述

当前练完总结只显示三个数字：查了词 / 精听句数 / 难句。
"查了 3 个词"——哪 3 个词？"6 个难句"——哪 6 个？然后呢？

总结页应该是一个**学完之后的行动面板**，不是一面镜子照一下就走了。

## 修改方案

修改 `showSummary()` 函数（约第 4964 行）。

### 需要的数据

在 Practice 流程中需要额外收集以下数据（修改现有变量或新增）：

**1. 查过的词列表**（目前只有计数 `prWordsLooked`，没有记录具体哪些词）

在 `startPractice()` 初始化时（约第 4614 行附近），新增：
```javascript
let prLookedWordsList = []; // 记录查过的词: [{word, cefr, sentence}]
```

在 Step 2 的词点击事件中（约第 4737 行），除了 `prWordsLooked++`，还要记录：
```javascript
prLookedWordsList.push({
  word: w.textContent.replace(/[^a-zA-Z'-]/g, ''),
  cefr: w.dataset.cefr || '',
  sentenceIdx: prSentCurrent,
  sentence: lines[prSentCurrent].en
});
```
去重（同一个词只记一次）：在 push 前检查 `prLookedWordsList.some(x => x.word.toLowerCase() === word.toLowerCase())`

**2. 难句列表**（目前 `prHardSentences` 只存了 index）

难句数据已经够了，可以通过 index 反查 `prClip.lines[idx]` 获取完整内容。

### 新的总结页 HTML

```javascript
function showSummary() {
  const sentTotal = prClip.lines.length;
  prStepLabel.textContent = '练习完成';

  // 去重查词列表
  const uniqueWords = [];
  const seenWords = new Set();
  prLookedWordsList.forEach(w => {
    const lower = w.word.toLowerCase();
    if (!seenWords.has(lower)) {
      seenWords.add(lower);
      uniqueWords.push(w);
    }
  });

  // 去重难句 index
  const uniqueHardIdxs = [...new Set(prHardSentences)];

  // 构建查词区域
  let wordsHtml = '';
  if (uniqueWords.length > 0) {
    wordsHtml = `
      <div class="prs-section">
        <div class="prs-section-title">查了 ${uniqueWords.length} 个词</div>
        ${uniqueWords.map(w => `
          <div class="prs-word-item" data-word="${w.word}">
            <span class="prs-word-text">${w.word}</span>
            ${w.cefr ? `<span class="prs-word-cefr" style="color:var(--cefr-${w.cefr.toLowerCase()})">${w.cefr}</span>` : ''}
            <span class="prs-word-add" data-word="${w.word}" data-cefr="${w.cefr}">+ 词汇本</span>
          </div>
        `).join('')}
      </div>`;
  }

  // 构建难句区域
  let hardHtml = '';
  if (uniqueHardIdxs.length > 0) {
    hardHtml = `
      <div class="prs-section">
        <div class="prs-section-title">${uniqueHardIdxs.length} 个难句</div>
        ${uniqueHardIdxs.map(idx => {
          const line = prClip.lines[idx];
          // 截断过长的句子
          const display = line.en.length > 50 ? line.en.slice(0, 50) + '...' : line.en;
          return `
            <div class="prs-hard-item" data-line-start="${line.start}" data-line-end="${line.end}">
              <span class="prs-hard-play">▶</span>
              <span class="prs-hard-text">${display}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  prBody.innerHTML = `
    <div class="pr-summary">
      <div class="pr-summary-title">这段练完了</div>
      ${wordsHtml}
      ${hardHtml}
      <div class="pr-summary-actions">
        <button class="pr-summary-btn" id="pr-back-feed">回到 Feed</button>
        <button class="pr-summary-btn primary" id="pr-again">再练一段</button>
      </div>
    </div>`;

  // 保存练习数据（保持不变）
  const pd = getPracticeData();
  const key = getClipKeyByClip(prClip);
  pd[key] = { done: true, words: prWordsLooked, hard: prHardSentences.length, ts: Date.now() };
  savePracticeData(pd);
  recordPracticeHardRate(prHardSentences.length, prClip.lines.length);

  // === 交互绑定 ===

  // 查词项点击 → 弹出释义 popup
  prBody.querySelectorAll('.prs-word-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('prs-word-add')) return; // 不触发 popup
      const tempSpan = document.createElement('span');
      tempSpan.className = 'w';
      tempSpan.textContent = item.dataset.word;
      document.body.appendChild(tempSpan);
      showWordPopup(tempSpan);
      tempSpan.remove();
    });
  });

  // "+词汇本"按钮
  prBody.querySelectorAll('.prs-word-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const word = btn.dataset.word;
      const cefr = btn.dataset.cefr;
      // 检查是否已在词汇本
      let vocab = [];
      try { vocab = JSON.parse(localStorage.getItem('flipodVocab') || '[]'); } catch {}
      if (vocab.some(v => v.word.toLowerCase() === word.toLowerCase())) {
        btn.textContent = '✓ 已收藏';
        btn.style.color = 'var(--accent)';
        return;
      }
      // 添加到词汇本
      vocab.push({
        word: word,
        cefr: cefr,
        phonetic: '',
        context: '',
        contextZh: '',
        timestamp: Date.now()
      });
      localStorage.setItem('flipodVocab', JSON.stringify(vocab));
      btn.textContent = '✓ 已收藏';
      btn.style.color = 'var(--accent)';
    });
  });

  // 难句项点击 → 播放该句音频
  prBody.querySelectorAll('.prs-hard-item').forEach(item => {
    item.addEventListener('click', () => {
      const start = parseFloat(item.dataset.lineStart);
      const end = parseFloat(item.dataset.lineEnd);
      prAudio.currentTime = start;
      prAudio.play().catch(() => {});
      prAudio.ontimeupdate = () => {
        if (prAudio.currentTime >= end) {
          prAudio.pause();
          prAudio.ontimeupdate = null;
        }
      };
    });
  });

  // 回到 Feed / 再练一段（保持不变）
  document.getElementById('pr-back-feed').addEventListener('click', closePractice);
  document.getElementById('pr-again').addEventListener('click', () => {
    closePractice();
    setTimeout(() => {
      if (window._slidePanel) window._slidePanel.open();
      setTimeout(() => {
        document.getElementById('practice-panel').classList.add('open');
        renderPracticeList();
      }, 350);
    }, 400);
  });
}
```

### 新增 CSS

```css
/* Practice Summary — 行动面板样式 */
.prs-section{
  width:100%;
  margin-bottom:20px;
  text-align:left;
}
.prs-section-title{
  font-size:13px;
  color:var(--text-3);
  margin-bottom:8px;
  font-weight:500;
}

/* 查词列表 */
.prs-word-item{
  display:flex;
  align-items:center;
  gap:8px;
  padding:10px 12px;
  background:var(--bg-card);
  border-radius:10px;
  margin-bottom:6px;
  cursor:pointer;
  transition:background 0.15s;
}
.prs-word-item:active{ background:var(--accent-bg); }
.prs-word-text{
  font-size:15px;
  color:var(--text-1);
  font-weight:500;
  flex:1;
}
.prs-word-cefr{
  font-size:11px;
  font-weight:600;
}
.prs-word-add{
  font-size:12px;
  color:var(--accent);
  cursor:pointer;
  white-space:nowrap;
}

/* 难句列表 */
.prs-hard-item{
  display:flex;
  align-items:center;
  gap:8px;
  padding:10px 12px;
  background:var(--bg-card);
  border-radius:10px;
  margin-bottom:6px;
  cursor:pointer;
  transition:background 0.15s;
}
.prs-hard-item:active{ background:var(--accent-bg); }
.prs-hard-play{
  font-size:12px;
  color:var(--accent);
  flex-shrink:0;
}
.prs-hard-text{
  font-size:13px;
  color:var(--text-2);
  line-height:1.4;
  flex:1;
}

/* 调整总结页整体布局 */
.pr-summary{
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:0 16px;
  max-height:70vh;
  overflow-y:auto;
}
.pr-summary-title{
  font-size:20px;
  font-weight:600;
  color:var(--text-1);
  margin-bottom:24px;
}
/* 删除原来的 .pr-summary-stats 和 .pr-summary-stat 样式（不再使用） */
```

## 验证

- [ ] 总结页列出了具体查过的每个词（去重）
- [ ] 每个词旁边有 CEFR 标签和"+ 词汇本"按钮
- [ ] 点击词可弹出释义 popup
- [ ] 点击"+ 词汇本"后按钮变为"✓ 已收藏"
- [ ] 总结页列出了每个难句的英文（截断到 50 字符）
- [ ] 点击难句可播放该句音频
- [ ] 音频播放到句子结束时自动停止
- [ ] "回到 Feed"和"再练一段"按钮正常工作
- [ ] 总结页在内容多时可滚动（overflow-y:auto）
- [ ] 如果没有查词和没有难句，总结页只显示标题和两个按钮
