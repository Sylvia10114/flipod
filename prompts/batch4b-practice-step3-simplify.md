# Batch 4B: Practice Step 3 闪卡 — 去掉逐词 CEFR，只展示难词释义

## 问题描述

Step 3 难句闪卡的背面（翻面后）底部显示了句中每个非 A 级词的 CEFR 标注：
"I (A1) · mean (A1) · I (A1) · guess (B1) · you (A1) · could (A2)..."

这没有意义：
1. 大部分词是 A1/A2，用户都认识，标注是噪音
2. CEFR 标注不一定准确
3. 用户看到一堆 "(A1)" 什么信息也没获得

## 修改方案

在 `renderStep3()` 函数（约第 4812 行）中，修改闪卡背面的渲染逻辑。

### 当前代码（约第 4861-4867 行）

```javascript
card.innerHTML = `
  <div class="pr-flash-label">难句 ${flashIdx + 1} / ${prHardSentences.length}</div>
  <div class="pr-flash-en">${line.en}</div>
  <div class="pr-flash-divider"></div>
  <div class="pr-flash-zh">${line.zh || ''}</div>
  ${line.words ? `<div class="pr-flash-phonetic">${line.words.filter(w => w.cefr && w.cefr !== 'A').map(w => w.word + ' (' + w.cefr + ')').join(' · ')}</div>` : ''}
`;
```

### 改为

```javascript
// 只提取 B2 及以上的难词（这些才是用户可能不认识的）
const hardWords = (line.words || []).filter(w => {
  const cefr = (w.cefr || '').toUpperCase();
  return cefr === 'B2' || cefr === 'C1' || cefr === 'C2';
});
// 去重（同一个词可能出现多次）
const seen = new Set();
const uniqueHardWords = hardWords.filter(w => {
  const lower = w.word.toLowerCase();
  if (seen.has(lower)) return false;
  seen.add(lower);
  return true;
});

// 构建难词展示 HTML
let hardWordsHtml = '';
if (uniqueHardWords.length > 0) {
  hardWordsHtml = `<div class="pr-flash-hardwords">
    ${uniqueHardWords.map(w => `<span class="pr-flash-hw" data-word="${w.word}">
      <span class="hw-word">${w.word}</span>
      <span class="hw-level" style="color:var(--cefr-${w.cefr.toLowerCase()})">${w.cefr}</span>
    </span>`).join('')}
  </div>`;
}

card.innerHTML = `
  <div class="pr-flash-label">难句 ${flashIdx + 1} / ${prHardSentences.length}</div>
  <div class="pr-flash-en">${line.en}</div>
  <div class="pr-flash-divider"></div>
  <div class="pr-flash-zh">${line.zh || ''}</div>
  ${hardWordsHtml}
`;
```

### 新增 CSS

```css
.pr-flash-hardwords{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  justify-content:center;
  margin-top:16px;
}
.pr-flash-hw{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:4px 10px;
  background:var(--bg-card);
  border-radius:8px;
  border:1px solid var(--border);
  cursor:pointer;
}
.hw-word{
  font-size:13px;
  color:var(--text-1);
  font-weight:500;
}
.hw-level{
  font-size:11px;
  font-weight:600;
}
```

### 难词可点击查释义

闪卡背面渲染完成后，给 `.pr-flash-hw` 元素添加点击事件，复用 `showWordPopup()` 弹出词义：

```javascript
card.querySelectorAll('.pr-flash-hw').forEach(hw => {
  hw.addEventListener('click', (e) => {
    e.stopPropagation(); // 不要再次翻面
    // 创建一个临时的 .w 元素来复用 showWordPopup
    const tempSpan = document.createElement('span');
    tempSpan.className = 'w';
    tempSpan.textContent = hw.dataset.word;
    tempSpan.dataset.cefr = hw.querySelector('.hw-level').textContent;
    document.body.appendChild(tempSpan);
    showWordPopup(tempSpan);
    tempSpan.remove();
  });
});
```

### 边界情况

- 如果一句话没有 B2+ 的词（可能句子难是因为语速快或连读），则 `hardWordsHtml` 为空，不显示词标注区域。这是正确的——不是每句难句都因为生词难。
- 删除原来的 `.pr-flash-phonetic` CSS 样式（如果有的话），不再使用。

## 验证

- [ ] 闪卡背面不再显示逐词 CEFR 列表
- [ ] 只展示 B2/C1/C2 级别的词，用对应颜色
- [ ] 没有 B2+ 词的闪卡背面只显示英文 + 中文翻译，没有词标注区
- [ ] 点击难词标签可弹出释义 popup
- [ ] 闪卡正面不受影响
- [ ] "搞懂了"/"还是不太清楚"按钮正常工作
