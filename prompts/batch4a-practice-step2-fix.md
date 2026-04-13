# Batch 4A: Practice Step 2 逐句精听 — 渲染修复 + 遮罩翻转

## 问题描述

Practice 模式的 Step 2（逐句精听）有三个问题：

### Bug 1: 英文句子不折行，词之间没有空格
截图表现为 "vithabunchofReese'speanutbuttercupsalloverit..." 这样的文字全挤在一行。

**原因分析**：
`renderStep2()` 中调用了 `renderWords(enEl, line)` 来渲染英文。`renderWords` 函数（约第 3619 行）在第 3642 行用 `wordsWithPunct.join(' ')` 拼接，理论上有空格。但 `.pr-sent-en` 的 CSS（第 1391 行）设了 `display:flex; align-items:center; justify-content:center;`，flex 布局可能会把 inline 的空格吃掉。

**修复方法**：
- `.pr-sent-en` 改为 `display:block; text-align:center;` 或者 `display:flex; flex-wrap:wrap; justify-content:center; gap:0;`
- 确保 `renderWords` 输出的 `<span>` 之间的空格被保留
- 测试长句子能正确折行，不超出屏幕宽度
- 加 CSS `word-break: break-word;` 作为兜底

### Bug 2: 遮罩逻辑是反的
**当前行为**：显示英文，遮住中文。用户需要点击灰色遮罩才能看到中文翻译。
**正确行为**：显示中文，遮住英文。用户听音频 → 看中文确认理解 → 如果没听懂，点击遮罩看英文原文。

**原因**：这是听力训练，不是阅读理解。用户应该用耳朵理解英文，中文是辅助确认工具，英文是最后兜底。

**修改 `renderStep2()` 函数（约第 4706 行）**：

1. 把 HTML 模板中 `pr-sent-en` 和 `pr-sent-zh` 的位置和默认状态对调：
   - 中文翻译（`pr-sent-zh`）：默认可见，放在上方，字号 16px，颜色 `--text-2`
   - 英文原文（`pr-sent-en`）：默认遮罩态，放在下方。用户点击遮罩可展开看英文

2. 遮罩样式改为作用在英文区域：
   - 给 `pr-sent-en` 加一个 `.masked-en` class，默认添加
   - `.masked-en` 的样式：`color:transparent; background:var(--mask-bg); border-radius:8px; user-select:none; padding:8px 16px;`
   - 点击 `.masked-en` 区域 → 移除 `.masked-en` class，显示英文词级渲染

3. 中文不再需要 `hidden-zh` class 和点击切换逻辑

4. 点词交互：只在英文展开后才能点击单词查释义（遮罩态下不可点）

**最终 Step 2 的用户流程**：
```
播放句子音频
  ↓
显示中文翻译（帮助确认理解）
英文区域是灰色遮罩
  ↓
用户如果听懂了 → 直接点"没问题"
用户如果没听懂 → 点击灰色遮罩 → 展开英文 → 可以点词查释义
  ↓
点"没问题"或"有难度" → 下一句
```

### CSS 修改

```css
/* 修改 .pr-sent-en（约第 1391 行）*/
.pr-sent-en{
  font-size:18px;
  line-height:1.6;
  color:var(--text-1);
  margin-bottom:16px;
  min-height:40px;
  text-align:center;
  word-break:break-word;
  /* 去掉 display:flex */
}
.pr-sent-en.masked-en{
  color:transparent;
  background:var(--mask-bg);
  border-radius:8px;
  user-select:none;
  padding:8px 16px;
  cursor:pointer;
  min-height:48px;
}
.pr-sent-en.masked-en .w{
  color:transparent !important;
  pointer-events:none;
}

/* 修改 .pr-sent-zh（约第 1397 行）*/
.pr-sent-zh{
  font-size:16px;
  color:var(--text-2);
  margin-bottom:16px;
  text-align:center;
  line-height:1.5;
  /* 去掉 cursor:pointer; 不再需要点击切换 */
}
/* 删除 .pr-sent-zh.hidden-zh 样式（约第 1400 行）*/
```

## 验证

- [ ] 长句子在 Step 2 中正确折行，不超出屏幕
- [ ] 词之间有正常空格
- [ ] 进入 Step 2 后：中文可见，英文被遮罩
- [ ] 点击英文遮罩区域后：英文展开，可点词查释义
- [ ] 不影响 Feed 主播放器的 renderWords 行为
- [ ] 不影响 Step 4 复听的字幕显示
- [ ] Practice Step 1 盲听不受影响
