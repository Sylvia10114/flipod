# PRD：播放协调系统（Progress Bar / Audio / Subtitle Coordination）

**作者**：Sylvia + Claude
**日期**：2026-04-08
**前置文档**：index.html（当前实现）
**状态**：待 Sylvia 审查

---

## 1. 问题

当前进度条可以视觉上拖动，但实际行为有问题：拖动后音频位置不跟随（或跟随不稳定），字幕也不更新到正确位置。三个系统（进度条、音频轨道、字幕）没有形成可靠的联动关系。

**根因分析**：

1. **seekTo 函数本身是对的**——它计算百分比、设置 `audio.currentTime`、更新 fill 宽度、调用 `updateSubtitle()`。代码逻辑没有明显 bug。
2. **真正的问题是 touch 事件和 audio 状态的竞争**：touchmove 期间连续调用 seekTo → 连续设置 audio.currentTime → audio 的 timeupdate 事件也在触发 updateSubtitle → 两个 updateSubtitle 调用可能用不同的 currentTime，导致字幕闪烁或回跳。
3. **进度条的 transition 动画干扰拖拽**：非拖拽状态下 fill 有 `transition: width 0.25s linear`，拖拽时虽然加了 `.dragging` 类移除 transition，但 touchstart 时机可能来不及。
4. **lastRenderedLine 缓存在 seek 时没有强制失效**：seek 到新位置后，如果新位置恰好在同一行范围内，`lineIdx !== lastRenderedLine[idx]` 为 false，字幕不会重新渲染——用户以为 seek 没生效。

这些不是单个 bug，而是缺少一个统一的状态管理模型。

---

## 2. 设计原则

**单一真相源（Single Source of Truth）**：`audio.currentTime` 是唯一的时间真相源。进度条位置和字幕内容都从它派生，不独立维护状态。

**事件流向**：

```
用户拖拽进度条 → 设置 audio.currentTime → audio timeupdate 事件 → 更新进度条 + 更新字幕
用户点击进度条 → 设置 audio.currentTime → audio timeupdate 事件 → 更新进度条 + 更新字幕
正常播放       → audio timeupdate 事件 → 更新进度条 + 更新字幕
```

所有路径最终都通过 `audio timeupdate → 统一更新函数` 这条路走。没有任何路径绕过 audio.currentTime 直接更新 UI。

---

## 3. 改动方案

### 3.1 重构 seekTo：只改 audio.currentTime，不直接改 UI

```javascript
function seekTo(idx, clientX) {
  const bar = document.querySelector(`#progwrap-${idx} .progress-bar`);
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const audio = audios[idx];
  const dur = getClipDuration(idx);

  // 唯一操作：设置 audio 时间
  audio.currentTime = pct * dur;

  // 强制失效字幕缓存，确保下次 updateSubtitle 重新渲染
  delete lastRenderedLine[idx];
}
```

关键变化：seekTo 不再直接更新 `fill.style.width`。fill 宽度由 updateSubtitle 统一更新。这消除了"seekTo 设了一个宽度，timeupdate 又设了另一个宽度"的竞争。

### 3.2 拖拽期间的特殊处理

拖拽（touchmove）期间，用户手指在快速移动，每帧都调 seekTo 会导致 audio.currentTime 抖动。解决方案：

```javascript
let dragPendingTime = null;  // 拖拽期间暂存目标时间

wrap.addEventListener('touchstart', (e) => {
  if (idx !== currentIdx) return;
  progDragging = true;
  fill.classList.add('dragging');  // 移除 CSS transition

  // 拖拽开始时暂停 audio（避免播放位置和拖拽位置打架）
  if (isPlaying) audio.pause();

  handleDrag(idx, e.touches[0].clientX);
}, { passive: true });

wrap.addEventListener('touchmove', (e) => {
  if (!progDragging) return;
  handleDrag(idx, e.touches[0].clientX);
}, { passive: true });

wrap.addEventListener('touchend', () => {
  if (!progDragging) return;
  progDragging = false;
  fill.classList.remove('dragging');

  // 拖拽结束：应用最终时间
  if (dragPendingTime !== null) {
    audios[idx].currentTime = dragPendingTime;
    dragPendingTime = null;
  }

  // 强制失效缓存 + 立即更新字幕
  delete lastRenderedLine[idx];
  updateSubtitle(idx);

  // 恢复播放
  if (isPlaying) audios[idx].play().catch(handlePlayError);
});

function handleDrag(idx, clientX) {
  const bar = document.querySelector(`#progwrap-${idx} .progress-bar`);
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const dur = getClipDuration(idx);

  dragPendingTime = pct * dur;

  // 拖拽期间：只更新视觉（fill 宽度），不设 audio.currentTime
  const fill = document.querySelector(`#prog-${idx}`);
  if (fill) fill.style.width = (pct * 100) + '%';

  // 拖拽期间：预览字幕（根据 pendingTime 找对应行并显示）
  previewSubtitleAt(idx, dragPendingTime);
}
```

### 3.3 拖拽期间的字幕预览

拖拽时用户应该能看到对应位置的字幕（类似视频 scrubbing 的体验）：

```javascript
function previewSubtitleAt(idx, time) {
  const clip = clips[idx];
  let lineIdx = -1;
  for (let i = 0; i < clip.lines.length; i++) {
    if (time >= clip.lines[i].start && time < clip.lines[i].end) {
      lineIdx = i;
      break;
    }
  }
  if (lineIdx === -1 && time > 0 && clip.lines.length) {
    const last = clip.lines[clip.lines.length - 1];
    if (time >= last.start) lineIdx = clip.lines.length - 1;
  }

  if (lineIdx >= 0 && lineIdx !== lastRenderedLine[idx]) {
    lastRenderedLine[idx] = lineIdx;
    const line = clip.lines[lineIdx];
    const enEl = document.getElementById('en-' + idx);
    const zhEl = document.getElementById('zh-' + idx);
    // 拖拽期间不做 fade 动画（太慢），直接替换
    renderWords(enEl, line);
    zhEl.textContent = line.zh;
  }
}
```

### 3.4 统一的 duration 获取

当前代码在多处各自计算 duration，逻辑不一致。统一为一个函数：

```javascript
function getClipDuration(idx) {
  const audio = audios[idx];
  const clip = clips[idx];
  // 优先用 audio.duration（最准确）
  if (audio.duration && isFinite(audio.duration)) return audio.duration;
  // fallback：用最后一行的 end 时间
  if (clip.lines.length > 0) return clip.lines[clip.lines.length - 1].end;
  // 兜底
  return 30;
}
```

所有用到 duration 的地方都调这个函数，不再各自写 fallback 逻辑。

### 3.5 updateSubtitle 简化

updateSubtitle 保持现有逻辑，但明确职责：

```javascript
function updateSubtitle(idx) {
  const audio = audios[idx];
  const clip = clips[idx];
  const t = audio.currentTime;

  // 1. 找当前行
  let lineIdx = findLineAtTime(clip, t);

  // 2. 渲染字幕（仅在行变化时更新 DOM）
  if (lineIdx >= 0 && lineIdx !== lastRenderedLine[idx]) {
    lastRenderedLine[idx] = lineIdx;
    renderLine(idx, lineIdx);
  }

  // 3. 词级高亮（每帧更新）
  if (lineIdx >= 0) updateWordHighlight(idx, t);

  // 4. 更新进度条（非拖拽状态下）
  if (!progDragging) {
    const dur = getClipDuration(idx);
    const fill = document.getElementById('prog-' + idx);
    if (fill) fill.style.width = Math.min(100, (t / dur) * 100) + '%';
  }
}
```

抽出 `findLineAtTime()` 和 `renderLine()` 两个纯函数，方便复用（拖拽预览也要用 findLineAtTime）。

---

## 4. 状态管理总结

系统中只有以下几个状态变量：

| 变量 | 类型 | 说明 |
|---|---|---|
| `audio.currentTime` | 真相源 | 播放位置。所有 UI 从它派生。 |
| `isPlaying` | 全局 | 是否在播放。控制 play/pause 图标。 |
| `currentIdx` | 全局 | 当前显示的 clip 索引。 |
| `progDragging` | 全局 | 是否正在拖拽进度条。拖拽期间暂停 audio，只更新视觉。 |
| `dragPendingTime` | 临时 | 拖拽期间暂存的目标时间。touchend 时应用到 audio.currentTime。 |
| `lastRenderedLine[idx]` | 缓存 | 上次渲染的行号。优化 DOM 更新频率。seek 时手动失效。 |

没有其他隐藏状态。特别是：进度条的 fill 宽度不是状态，它是 audio.currentTime 的视觉投影。

---

## 5. 边界情况处理

| 情况 | 预期行为 |
|---|---|
| seek 到两行之间的空隙 | 保持上一行字幕显示，不要清空 |
| seek 到 clip 开头之前（t < lines[0].start） | 显示第一行字幕，词级高亮全部置灰 |
| seek 到 clip 末尾之后 | 显示最后一行字幕 |
| 快速连续 seek（双击进度条） | 每次 seek 都强制失效缓存，以最后一次为准 |
| 播放速度改变后 seek | 不影响。播放速度只影响 audio.playbackRate，不影响 currentTime 的含义 |
| 拖拽中手指移出进度条区域 | touchmove 继续跟踪（浏览器默认行为），touchend 时应用最终位置 |
| audio 还没加载完（duration 未知）| 用 fallback duration（最后一行 end 时间），seek 位置可能有轻微偏差，加载完成后自动校正 |

---

## 6. 不做的事

- 不做进度条上的时间标签显示（如 "0:45 / 1:30"）——当前极简设计不需要
- 不做缩略图预览（视频 scrubbing 才需要）
- 不做双指缩放进度条（过度设计）
- 不做 keyboard shortcut（移动端为主，暂不考虑）

---

## 7. 验收标准

- [ ] 点击进度条任意位置 → 音频跳到对应时间 → 字幕立即更新为对应行
- [ ] 拖拽进度条 → 字幕实时预览对应行 → 松手后音频从松手位置开始播放
- [ ] 拖拽期间进度条跟手，无延迟或回弹
- [ ] 正常播放时，进度条平滑前进，字幕按行切换
- [ ] 从头到尾播放一个 clip，进度条从 0% 走到 100%，字幕逐行显示，无跳帧或重复
- [ ] 播放中 seek 到之前的位置，音频和字幕都正确回退
- [ ] 切换 clip 后，新 clip 的进度条从 0% 开始，字幕显示第一行
