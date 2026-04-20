# Claude Code 任务书 · Flipod Priming v4 屏开发

> 这是 PM 交付给工程 agent 的实现规格。视觉稿在 `design/priming-v4-ui.svg`，那是 ground truth。本文档定交互、架构、禁区。

---

## 第一步

**先用 `Read` 读 `design/priming-v4-ui.svg`。所有字号、颜色、间距、布局都以这张 SVG 为准。** 再读本文档的架构和交互规格。

---

## 产品 Context（不要发明事实）

Flipod 是基于真实播客（纯听）+ AI 生成兴趣向播客（练习）的英语听力学习产品。**Flipod 是教练，不是"工具 + 素材"的组合。** 反馈是产品的一部分，不是外挂。

本次范围：**只做纯听 tab 的 priming 屏**（+ 必要的 clip mock + settings）。练习 tab 不在本次范围。

### 两条红线（反馈/交互形态）

- **不过时**：不做雷达图、打卡日历、周报式进度、等级解锁、徽章系统、连续天数这些 2015 教育产品老套路
- **不高高在上**：不做 "great job" / "你真棒" / "你进步了" 这种评价式口吻

### 词表

CEFR-J + Octanove C1/C2（~8650 词，CC BY-SA 4.0）。本次 mock 数据使用 A1/A2/B1/B1+/B2/C1/C2 标记。

---

## 核心架构

**Priming 是 feed 的内容单元，不是一个独立的屏。** 打开 app 直接就是 priming，上滑 = 下一条 priming，点倒计时环 = 进入这条的 clip。整个产品是 priming+clip 的**竖滑无限流**。

三屏：

1. **Priming 屏（首屏 / home）** — 竖滑分页，每页一条 priming
2. **Clip 屏（mock）** — 极简 player：标题 / 来源 / 假字幕 / 假进度条 / 播放按钮；本次仅作为 priming 的 destination，不要做深交互
3. **Settings 屏** — 一个开关"默认显示 priming"

### 绝对不要做

- 不做 feed list 列表屏
- 不做"跳过本条 priming"按钮（点倒计时环等价于跳过）
- 不做 slide dots / 页数指示器（竖滑流没有 dots 的共享心智）
- 不做关键词点击展开 / 例句 / 词根 / 发音
- 不做 priming 屏内的收藏（收藏留给 clip 内）
- 不暴露"一共几条 / 今天几条 / 还剩几条"

---

## Priming 屏交互

### 三层信息（字面用下面的 mock，视觉以 SVG 为准）

1. **Meta 行**（顶部弱色）：`${source} · ${cefr} · ${formatDuration(durationSec)}`
2. **Summary**（中文主旨一句，≤ 16 字单行）：**是"听力锚"不是"钩子"**——给用户听的时候一个结构/方向，不剧透结论
3. **Keywords 区**（视觉主体，vertical center）：
   - 每个词：EN（44px 600） + ZH（14px 400）紧贴下方
   - 2-3 词用标准布局；4-5 词切 dense（EN 缩到 32px，行间距压缩）

### 倒计时

- **长度按关键词数**：≤ 2 词 → 3s / 3 词 → 4s / 4-5 词 → 5s
- rAF-based（`requestAnimationFrame`），暂停 = 不 advance `lastTick`
- 倒计时到 0 自动进 clip
- 点倒计时环（任意剩余时间） = 立刻进 clip
- 每次换条（上下滑）倒计时重置为新条的 full duration

### 长按暂停（TikTok / Reels / 小红书共享心智）

- 长按屏幕任意处 ≥ 160ms → 倒计时暂停，hold-tip 从 "长按任意处暂停" 切到 "松开继续"，倒计时环 stroke 变灰
- 松开 → 倒计时继续，`lastTick = performance.now()` 避免 dt 跳变
- **Tail-click 保护**：用户松开长按时浏览器会触发 click → 可能误跳 clip。加 `window._suppressClickUntil = Date.now() + 250`，click handler 检查后丢弃
- 按钮和倒计时环本身不触发长按：`target.closest('button, .countdown-ring')` 排除

### 竖向 swipe 换条

- 上滑 = 下一条 / 下滑 = 上一条
- 触发阈值：`|dy| > min(90, containerHeight * 0.18)` 或速度 > 0.35 px/ms
- 边界阻尼：第一条向下拉 / 最后一条向上拉，dy 乘 0.35 形成橡皮筋
- 若水平 gesture 占优（`|dx| > 1.2 * |dy|`），中止 swipe，让长按走它的路径
- 换条后调 `startCountdownFor(newIdx)` 重置倒计时

---

## Data Mock

```js
const PRIMING_DATA = [
  {
    id: 'ep-001',
    title: 'The economy under rate pressure',
    source: 'Planet Money',
    cefr: 'B1',
    durationSec: 90,
    summary: '加息为什么没带来衰退：三个支撑点',
    words: [
      { en: 'resilience', zh: '韧性' },
      { en: 'monetary',   zh: '货币的' },
      { en: 'hike',       zh: '加息' },
    ],
  },
  {
    id: 'ep-002',
    title: 'How Patagonia almost pivoted everything',
    source: 'How I Built This',
    cefr: 'B1',
    durationSec: 75,
    summary: '一个险些改头换面的户外品牌故事',
    words: [
      { en: 'entrepreneur', zh: '创业者' },
      { en: 'pivot',        zh: '转型' },
    ],
  },
  {
    id: 'ep-003',
    title: 'The cognitive pattern behind resilience',
    source: 'Hidden Brain',
    cefr: 'B1+',
    durationSec: 100,
    summary: '韧性强的人脑内发生了什么',
    words: [
      { en: 'cognitive',  zh: '认知的' },
      { en: 'adapt',      zh: '适应' },
      { en: 'resilience', zh: '韧性' },
      { en: 'pattern',    zh: '模式' },
    ],
  },
  {
    id: 'ep-004',
    title: 'What is quantum entanglement, really?',
    source: 'Radiolab',
    cefr: 'C1',
    durationSec: 120,
    summary: '两个粒子如何跨越距离感应彼此',
    words: [
      { en: 'quantum',       zh: '量子' },
      { en: 'entangle',      zh: '纠缠' },
      { en: 'observation',   zh: '观察' },
      { en: 'measurement',   zh: '测量' },
      { en: 'superposition', zh: '叠加' },
    ],
  },
];

const STREAM_LENGTH = 24;
function getClipAt(streamIdx){
  const n = PRIMING_DATA.length;
  return PRIMING_DATA[((streamIdx % n) + n) % n];
}
function formatDuration(sec){
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s === 0 ? `${m}min` : `${m}:${String(s).padStart(2,'0')}`;
}
function countdownSecForWordCount(n){
  if (n <= 2) return 3;
  if (n === 3) return 4;
  return 5;
}
```

---

## Visual 规格（以 SVG 为准，这里只是数字索引）

- Canvas: 390 × 844（phone frame），但需要响应式容器
- 背景：`#0B0D12` + 顶部 radial glow `#9BA7E8 @ 11% → 0%`
- 文字色阶：
  - 关键词 EN `#F0EEF2` 44px 600 letter-spacing -0.6px
  - 关键词 ZH `#9A97A3` 14px 400 letter-spacing 0.3px
  - Summary `#B8B5C0` 15px 400
  - Meta `#7A7885` 11px letter-spacing 0.6px
  - Hint `#4A4955` 11px
  - Hold-tip `#6A6875` 11px
- Accent `#9BA7E8`（倒计时环 active arc、倒计时环 paused 变灰）
- 关键词之间纵向 gap ~95-110px（视觉呼吸）
- 倒计时环 54×54，stroke-width 3，底环 `#1E2029`

---

## Settings

单开关："**默认显示 priming**"（默认 ON）。

- label-note: "Priming 是 clip 前的轻脚手架。关掉后首屏直接是 clip，上滑换下一条。新用户默认开启。"
- settings-note: "这是原型演示。切换后回首屏，从第一条重新开始。"

切换逻辑：

- **ON**：home = priming 屏，上滑换 priming，点 ring 进 clip，clip 的 back 按钮回到对应条的 priming
- **OFF**：home = clip 屏的 player，上滑 = 下一条 clip 的 player，没有 priming 参与；player 的 back 按钮隐藏（已经是 home）
- 开关变化在用户从 settings 返回时应用（调 `bootHome()` 重置 stream 到 0）

---

## 交付

- **文件**：`demo/priming-v4.html` — 单文件、无构建、无外部依赖、双击浏览器打开即可
- **右侧 legend 区**（不在 phone frame 内）：列出交互清单，方便 PM 审稿。至少包括：核心架构、Priming 交互 4 条、三层信息、定位锁"轻预热"、Settings、键盘映射
- **键盘映射**（桌面调试）：
  - `↑` / `↓` 换条（在 priming 或 player-as-home 模式下）
  - `space` 按住 = 长按暂停
  - `esc` 返回（在 settings / player）

---

## 验收 Checklist

- [ ] 打开 app 直接是 priming（不是 splash、不是 list）
- [ ] 上滑换下一条 priming，倒计时重置
- [ ] 下滑回上一条，第一条向下拉有橡皮筋
- [ ] 点倒计时环立刻进 clip
- [ ] 倒计时到 0 自动进 clip
- [ ] 长按屏幕任意处暂停（hold-tip 切换、环变灰），松开继续，**不触发 tail click**
- [ ] 关键词 2/3/4/5 词都正确显示（4-5 词自动 dense）
- [ ] Summary 单行不换行（≤ 16 字 mock 数据）
- [ ] Settings 开关 OFF → 首屏变 player → player 上滑换下一条
- [ ] 开关 ON 时 player 有 back，OFF 时 back 隐藏
- [ ] 不暴露数量，不显示 dots / skip-once / feed list
- [ ] 色值、字号、间距和 SVG 对齐
- [ ] 桌面浏览器 + iOS Safari 都能跑（响应式）

---

## 禁区 Recap

不做 2015 教育套路（打卡、徽章、连续天数、等级）、不做 great-job 文案、不做关键词点击展开、不做 priming 内收藏、不做 feed list 屏、不做 dots、不做 skip-once 按钮、不暴露"一共 N 条"。
