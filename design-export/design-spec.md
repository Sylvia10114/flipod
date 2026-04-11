# Flipod Premium — Complete Design Spec (2026-04-10)

## Screenshot Index

### Core Screens
| File | Screen |
|------|--------|
| `OoJgY.png` | Splash — Curated Entry |
| `6v4it.png` | Player — Normal |
| `7KDpf.png` | Player — After Re-rank |
| `XoeDa.png` | Player — Feed Loading |
| `MnCzB.png` | Player — Fallback (No AI) |

### V2 Interaction Cards
| File | Screen |
|------|--------|
| `cBQGc.png` | Clip Recap — Folded |
| `8AVgg.png` | Clip Recap — Expanded |
| `xUiUQ.png` | Fill Blank — Default |
| `iMo7P.png` | Fill Blank — Correct |
| `duKAC.png` | Fill Blank — Wrong |
| `0xRkn.png` | Player V2 — Sentence Nav |
| `az4Ki.png` | Relisten — Default |
| `jNOpf.png` | Relisten — Revealed |

---

## Design Tokens

```css
:root {
  --bg-primary: #0C0C0E;
  --bg-secondary: #16161A;
  --accent: #8B9CF7;
  --border: rgba(255,255,255,0.05);

  --text-1: rgba(255,255,255,0.87);
  --text-2: rgba(255,255,255,0.55);
  --text-3: rgba(255,255,255,0.30);
  --text-4: rgba(255,255,255,0.15);

  --word-spoken: rgba(255,255,255,0.93);
  --word-dim: rgba(255,255,255,0.20);

  --cefr-b1: #7AAFC4;
  --cefr-b2: #C4A96E;
  --cefr-c1: #C47A6E;

  --p-popup-bg: rgba(28,28,34,0.95);
  --p-popup-border: rgba(255,255,255,0.07);
}
```

Font: `Inter`, weights 400/500/600/700. Screen: 390x844 (iPhone 14/15).

---

## Splash — Curated Entry

| Element | Style |
|---------|-------|
| Ambient line | 80x1, `--accent` 15% opacity, center, top 21% |
| Title "先听这一条" | 28px medium, `--text-1`, center |
| Subtitle "我挑了几段适合现在开始的内容" | 14px, `--text-3`, center |
| Divider | 40x1, `--border`, center |
| "Tap to begin" | 13px, `--text-4`, bottom 80px, pulse animation |

---

## Player — Immersive Feed

### Top Bar
- **Menu** (left:20): 2 horizontal lines (16x1.5 + 12x1.5), `--text-3`
- **"?" icon** (right:20): 20px circle (1.5px stroke `--text-3`) + "?" text (12px semibold `--text-3`). Tap → AI reason tooltip

### Content Meta (center, y:100)
- Hint text — 11px, letter-spacing 0.5, state-dependent (see Feed States)
- Title — 16px medium, `--text-1`, center
- Source row — podcast name 12px `--text-3` · tag 11px `--accent` 70%

### Subtitle Area (x:32, width:326)
- English — 22px, line-height 1.5, `--word-spoken`, center, wraps
- Chinese — 14px, `--text-3`, center. Default masked with overlay
- ~~Next sentence~~ **REMOVED**

### Side Actions (x:350, y:520)
Heart + bookmark icons, 20x20, `--text-3`, gap 24. **Positioned below subtitle area.**

### Bottom Controls
- Progress bar: 2px, `--text-4` bg, `--accent` fill
- Controls: skip-back / play(56px circle `--accent`) / skip-forward
- Status bar: eye toggle + "1.0x" (left) | "N / total" (right)

### Word Popup (width:270) — ⚠️ STRICT

**位置：固定屏幕下半部居中。不跟随单词位置。**
`position:absolute; bottom:220px; left:50%; transform:translateX(-50%);`

| Row | Style |
|-----|-------|
| Word + POS | 20px bold `--text-1` + 11px `--accent`, gap 10 |
| Phonetic | 12px `--text-3` |
| Definition | 13px `--text-2`, line-height 1.5, wraps |
| Divider | 1px `--border` |
| Actions | "认识" `--text-3` / "☆ 收藏" `--text-3` |

**⚠️ 收藏星星：默认空心 outline (stroke only, no fill)，颜色 `--text-3`。收藏后变实心 fill，颜色 `--accent`。**

**⚠️ 已移除 CEFR badge。**

---

## Feed States

```
进入 → [Loading] "AI 正在为你排列内容..."
     → [Normal] "已根据你的偏好排列"
     → 听 N clip → [Re-rank] "刚刚根据你的表现重新调整了顺序"（3秒后回 Normal）
     → API 失败 → [Fallback] "这几条已经替你排好了"，? icon 隐藏
```

| State | Hint Text | Hint Color |
|-------|-----------|------------|
| Normal | 已根据你的偏好排列 | `rgba(255,255,255,0.15)` |
| Re-rank | 刚刚根据你的表现重新调整了顺序 | `rgba(255,255,255,0.40)` |
| Loading | AI 正在为你排列内容... | `rgba(255,255,255,0.30)` |
| Fallback | 这几条已经替你排好了 | `rgba(255,255,255,0.15)` |

---

## V2 Interaction Cards

所有卡片嵌在 feed 流中，上下滑动切换，不是弹窗。可上滑跳过。

### Clip Recap（每 1-2 clip 后插入）

**折叠态** (~120px content, 居中):
- "刚才这段" — 10px, letterSpacing 2, `rgba(255,255,255,0.30)`
- 主信息行 — "遇到 **3** 个新词"(数字 accent bold) · "听了 1:24" — 14px `--text-2`
- "↓ 查看词卡" — 12px, `rgba(255,255,255,0.25)`

**展开态** (~360px, 词卡列表):
- 每张词卡: 圆角 12px, bg `rgba(255,255,255,0.05)`, padding 14px 16px
  - 单词 16px bold + 词性 11px accent
  - 原句 13px `--text-3`, 目标词 accent 高亮
  - 中文释义 12px `rgba(255,255,255,0.30)`
  - 右上角小喇叭 16x16
- 底部 "继续听下一段 →" 14px `--text-2`

### Fill-in-the-Blank（每 3-4 clip 后插入）

**默认态**:
- "刚才听到的" — 10px, letterSpacing 2, `rgba(255,255,255,0.30)`
- 句子 18px medium, `rgba(255,255,255,0.70)`, blank 用 `____` + 2px dashed accent underline
- 3 选项: 圆角 20px pill, bg `rgba(255,255,255,0.05)`, border `rgba(255,255,255,0.08)`, text 15px
- "凭印象选，不用纠结" — 12px `rgba(255,255,255,0.20)`

**答对**: 正确选项 bg `rgba(139,156,247,0.15)` border `--accent`, "✓ 没错" accent. 1.5s 自动滑走。

**答错**: 错误选项 bg `rgba(255,68,102,0.10)` border `rgba(255,68,102,0.30)`. 正确答案填入 blank. "是 cortisol" `--text-3`. 1.5s 自动滑走。

### Player V2 — Sentence Nav

基于 Player 布局，增加：
- **句子跳转控制**: skip-back/skip-forward 改为句级跳转（跳到上/下一句）
- **进度条句子标记**: 每个句子边界有 1x6px 竖线 `rgba(255,255,255,0.15)`，当前句段 accent 填充
- **句子指示器**: "第 3 / 8 句" 11px `--text-3`
- **中文遮挡右移**: 中文行右侧 eye-off 图标 16x16，点击切换遮挡/显示

### Relisten — 重听原声卡（间隔 >4h 回到 app 时）

核心差异化：**听真实播客语境回忆词义**，不是看图选义。

**默认态**:
- "RELISTEN" — 10px, letterSpacing 2, `--text-3`
- 音频波形 — 30 根竖线 (2px wide, gap 4, 随机 8-36px height), 已播放 accent / 未播放 `rgba(255,255,255,0.15)`
- 小播放按钮 36x36 + 时间
- 英文原句 15px `--text-2`, 目标词用 `____` 代替
- "这个词是什么？" 13px `--text-3`
- "显示答案" 按钮: 200x44, 圆角 22px, bg `rgba(255,255,255,0.05)` border `rgba(255,255,255,0.08)`

**显示答案后**:
- `____` 替换为单词 (accent bold)
- 音标 + 中文释义
- 两个按钮: "记住了 ✓" (accent border + accent bg 12%) / "没印象 ×" (neutral)
- "来自 Planet Money · 3 天前听过" 11px `rgba(255,255,255,0.20)`

---

## Player — Sentence Nav (升级版)

| File | Screen |
|------|--------|
| `6aSa5.png` | Player — Sentence Nav |

基于 Player — Immersive Feed 升级：

- **进度条句子标记**: 每个句子边界有 1x6px 竖线 `rgba(255,255,255,0.15)`，当前句段 accent 填充，已播放段 `#FFFFFF33`
- **跳转控制**: skip-back / skip-forward 改为句级跳转
- **句子指示器**: 控制区下方 "第 3 / 8 句" 11px `--text-3`
- **状态栏**: 底部保留 eye toggle + speed + clip counter

---

## Player — Handedness (惯用手对比)

| File | Screen |
|------|--------|
| `67oxf.png` | Player — Left/Right Hand Mode |

800x844 对比画板，两个 390px 半屏并排：

| 模式 | Side Actions 位置 | 标签 |
|------|------------------|------|
| 左手模式 | 左侧 (x:12) | "左手模式" |
| 右手模式（默认） | 右侧 (x:350) | "右手模式（默认）" |

其他布局水平镜像，字幕区和底部控制区不变。

---

## Panel — Practice（听力练习入口）

| File | Screen |
|------|--------|
| `omsje.png` | Panel — Practice（有收藏） |
| `Rto84.png` | Panel — Practice（空状态） |

320x844 侧边栏面板。

### 有收藏状态
- 标题: "听力练习" 20px bold
- 副标题: "精听练习：对一段内容反复听、逐句听、搞懂每个词" 13px muted
- **"你收藏的"** 区域:
  - clip 卡片: 圆角 12px, bg `rgba(255,255,255,0.05)`, padding 14-16px
  - 标题 14px + 来源 12px muted + 时长
  - 状态 badge: "未练习" (accent bg 12%, accent text) / "已练习 · 查了 3 个词" (muted)
- **"AI 推荐练习"** 区域:
  - 推荐卡片 + 难度标签 (B1/B2/C1)
  - 推荐理由: "包含你上次查过的 cortisol" 11px muted

### 空状态
- 居中 bookmark icon (40x40, `--text-4`)
- "在 Feed 里收藏感兴趣的片段，它们会出现在这里等你精听" 14px `--text-3`
- 下方仍显示 AI 推荐卡片

---

## Feed — Bookmark Toast

| File | Screen |
|------|--------|
| `lvbsM.png` | Feed — Bookmark Toast |

基于 Player 布局，增加收藏引导提示：
- bookmark icon 变为 filled/active 状态
- 底部 toast (y:~750):
  - 圆角 pill (cornerRadius 20, bg `rgba(255,255,255,0.10)`, border `rgba(255,255,255,0.08)`)
  - ~340x44px, 居中
  - "已收藏 · 可以在侧边栏「听力练习」里精听这段" 13px `--text-2`
  - 左侧小箭头指向菜单方向

---

## Practice 流程（4 步）

所有 Practice 步骤共享：顶部 STEP N 标签 (10px accent, letterSpacing 2) + 右上角关闭按钮 (32px circle, `rgba(255,255,255,0.08)`)

### Step 1：盲听

| File | Screen |
|------|--------|
| `DIYJ5.png` | Practice — Blind Listen (Playing) |
| `fA1zU.png` | Practice — Blind Listen (Finished) |

**播放中**:
- 居中提示: "先听一遍，看能抓住多少" 16px medium `--text-1`
- 副提示: "不看字幕，专注听" 13px `--text-3`
- 音频波形: 30 根竖线 (3px wide, gap 4, 随机 10-44px height), 已播放 accent / 未播放 `rgba(255,255,255,0.15)`
- 时间显示: 左右两侧 12px `--text-3`
- 播放按钮: 64x64 circle accent, pause icon
- clip 信息: 标题 14px `--text-2` + 来源 12px `--text-3`

**播放结束**:
- 提示变为: "听完了，感觉怎么样？" 16px medium
- 波形全部 accent (已播完)
- 重听按钮 (rotate-ccw icon + "重听")
- 两个选择按钮:
  - "大部分听懂了": accent fill, 52px height, cornerRadius 26
  - "有些没听清": outline style, `rgba(255,255,255,0.04)` bg

### Step 2：逐句精听

| File | Screen |
|------|--------|
| `FdJmH.png` | Practice — Sentence Listen |

- 顶部: STEP 2 + "第 3 / 8 句" + close
- 提示: "逐句精听，不懂的查" 13px `--text-3`
- 句子进度条: 8 段 (28x3px rectangles), 已完成 accent / 待完成 `rgba(255,255,255,0.08)`
- **句子区域** (padding 32px horizontal):
  - 之前的句子: 15px `--text-4` (已过暗淡)
  - 当前句子: 20px medium `--word-spoken` (高亮)
  - 中文翻译: 14px `--text-3`
- 重听按钮: rotate-ccw icon + "重听这句" `--text-2`
- 两个操作按钮:
  - "有难度" (× icon, outline): 标记进 Step 3
  - "没问题" (✓ icon, accent fill): 跳到下一句

### Step 3：难句闪卡

| File | Screen |
|------|--------|
| `5Ikgf.png` | Practice — Flashcard Front |
| `qktIe.png` | Practice — Flashcard Back |

**正面**:
- 顶部: STEP 3 + "1 / 3" + close
- 卡片 (cornerRadius 20, bg `rgba(255,255,255,0.03)`, border `rgba(255,255,255,0.05)`):
  - 播放按钮 (40x40 accent circle) + "播放这句"
  - 英文句子 18px medium `--text-1`
  - 关键词提示: "exposure — 点击翻面查看释义" accent
- 底部: "↓ 下滑翻面" hint `--text-4`

**背面**:
- 卡片内容:
  - 英文原句 16px `--text-2`
  - 分隔线
  - 中文翻译 14px `--text-3`
  - 分隔线
  - 单词: 18px bold `--text-1` + 词性 12px accent
  - 音标: 12px `--text-3`
  - 释义: 13px `--text-2`
- 两个操作按钮:
  - "还是不太清楚" (× icon, outline): 排到最后再出现
  - "搞懂了" (✓ icon, accent fill): 卡片消失

### Step 4：复听 + 总结

| File | Screen |
|------|--------|
| `1S22l.png` | Practice — Review Summary |

- 完成图标: 64x64 circle (accent 10% bg) + check icon accent
- "这段练完了" 22px semibold `--text-1`
- clip 标题 14px `--text-3`
- 统计卡片 (cornerRadius 16, bg `rgba(255,255,255,0.03)`):
  - 三列: 查了词 / 精听句 / 难句卡
  - 数字 28px bold accent + 标签 12px `--text-3`
- 步骤进度: 4 个 check circle (accent) + 连接线, 标签: 盲听 → 精听 → 闪卡 → 复听
- 两个操作按钮:
  - "再练一段" (accent fill)
  - "回到 Feed" (outline)

---

## ⚠️ 设计对齐检查清单

| # | 要求 | ❌ 常见错误 | ✅ 正确实现 |
|---|------|-----------|-----------|
| 1 | Word popup 位置 | 跟随点击的单词出现 | **固定屏幕下半部居中** |
| 2 | 收藏星星 | 实心 ★ | **空心 ☆**，收藏后变实心 |
| 3 | 收藏按钮颜色 | 默认 accent | **默认 --text-3**，收藏后 accent |
| 4 | CEFR badge | popup 里显示 | **已移除** |
| 5 | 下一句预览 | 显示 | **已移除** |
| 6 | 中文遮挡按钮 | 字幕旁边 | **左下角状态栏** |
| 7 | Side actions 位置 | 和字幕平齐 | **字幕下方 y:520** |
| 8 | Feed cards | 弹窗/浮层 | **feed 流中的卡片**，可上滑跳过 |
| 9 | Fill Blank 自动跳转 | 停留等用户操作 | **1.5s 后自动滑走** |
| 10 | Relisten 波形 | 静态装饰 | **可播放**，已播放段 accent |
