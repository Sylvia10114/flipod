# Premium Redesign — Design Spec (Updated 2026-04-10)

Screenshots: `OoJgY.png` (Splash), `6v4it.png` (Player Normal), `7KDpf.png` (Re-rank), `XoeDa.png` (Loading), `MnCzB.png` (Fallback)

## Design Tokens (CSS Custom Properties)

```css
:root {
  /* Premium palette */
  --bg-primary: #0C0C0E;
  --bg-secondary: #16161A;
  --accent: #8B9CF7;              /* muted lavender */
  --border: rgba(255,255,255,0.05);

  /* Text hierarchy */
  --text-1: rgba(255,255,255,0.87);
  --text-2: rgba(255,255,255,0.55);
  --text-3: rgba(255,255,255,0.30);
  --text-4: rgba(255,255,255,0.15);

  /* Subtitle */
  --word-spoken: rgba(255,255,255,0.93);
  --word-dim: rgba(255,255,255,0.20);

  /* CEFR levels (subtitle word colors only) */
  --cefr-b1: #7AAFC4;
  --cefr-b2: #C4A96E;
  --cefr-c1: #C47A6E;

  /* Word popup */
  --p-popup-bg: rgba(28,28,34,0.95);
  --p-popup-border: rgba(255,255,255,0.07);

  /* Progress bar */
  --prog-fill: #8B9CF7;           /* accent */
}
```

## Font

- Family: `Inter` (Google Fonts CDN)
- Weights used: 400 (normal), 500 (medium), 600 (semibold), 700 (bold)
- Fallback: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

## Screen Size

- 390 x 844 (iPhone 14/15 logical)

---

## Screen 1: Splash — Curated Entry

Flex center layout on `--bg-primary` background.

| Element | Position | Style |
|---------|----------|-------|
| Ambient line | center x, top 21% | 80x1, `--accent` at 15% opacity |
| Title "先听这一条" | center | 28px medium, `--text-1` |
| Subtitle "我挑了几段适合现在开始的内容" | below title, 10px gap | 14px normal, `--text-3` |
| Divider | center, 48px below subtitle | 40x1, `--border` |
| "Tap to begin" | absolute, bottom 80px | 13px normal, `--text-4`, pulse animation |

---

## Screen 2: Player — Immersive Feed

Absolute positioned layout on `--bg-primary`.

### Top Bar

- **Menu** (left:20px): 32x32, CSS pseudo-elements — two horizontal lines (16x1.5 and 12x1.5), `--text-3`, rounded 1px
- **"?" help icon** (right:20px): 32x32, circle (20x20, 1.5px stroke `--text-3`) with "?" text (12px semibold `--text-3`) centered. Clicking opens AI reason tooltip/panel.

### Content Meta (center, top offset ~100px)

Vertical layout, gap 8, center-aligned.

- Hint: state-dependent text (see "Feed States" section) — 11px, letter-spacing 0.5, center
- Title: clip title — 16px medium (500), `--text-1`, center
- Source row: horizontal, gap 8
  - Podcast name — 12px, `--text-3`
  - "·" — 12px, `--text-4`
  - Category tag — 11px, `--accent` at 70% opacity (no background, no pill)

### Subtitle Area (left:32, right:32, top:33%)

Vertical layout, gap 16, center-aligned, max-width 326px.

- **English subtitle** — 22px, font-weight 400, line-height 1.5, `--word-spoken`, center
  - Word-level karaoke: unspoken words use `--word-dim`, spoken words use `--word-spoken`
  - CEFR B1/B2/C1/C2 spoken words: **bold 700** + tinted with CEFR color
  - Words are tappable (opens word popup)
- **Chinese translation row** — flex row with toggle:
  - Chinese text — 14px, line-height 1.4, `--text-3`, center
  - **Toggle button** (circled A icon, 28x28) — default: text hidden (masked), click to reveal/hide
  - Masked state: `color:transparent; background:var(--mask-bg); border-radius:4px`
- ~~Next sentence preview~~ **REMOVED** — too crowded, no longer displayed

### Side Actions (right:12px, vertical center ~y:520)

Vertical layout, gap 24, 28px wide. Positioned **below subtitle area**, with clear visual separation from content.

- Heart icon — 20x20, `--text-3` (filled red `#ff4466` when liked)
- Bookmark icon — 20x20, `--text-3` (filled gold `#ffc34d` when bookmarked)

### Bottom Controls (full width, bottom:0)

Vertical layout, gap 20, padding: 0 32px 20px 32px, center-aligned.

#### Progress Row
Horizontal, gap 8, full width.
- Current time — 11px, `--text-4`
- Progress bar — flex:1, 2px height, `--text-4` bg, rounded 1px
  - Fill — `--accent`, rounded 1px
- Duration — 11px, `--text-4`

#### Controls Row
Horizontal, gap 40, center.
- Skip back (rewind icon) — 22x22, `--text-2`
- Play button — 56x56 circle, `--accent` bg
  - Pause/Play icon — 24x24, `--bg-primary` color
- Skip forward (forward icon) — 22x22, `--text-2`

#### Status Bar (bottom-most)
Horizontal, space-between, padding 0 20px.
- Left: eye toggle (16x16 `--text-3`) + "1.0x" speed label (12px `--text-3`), gap 8
- Right: clip indicator "N / total" (12px, `--text-3`)

### Word Popup (width:270) — ⚠️ STRICT IMPLEMENTATION REQUIREMENTS

**位置：固定在屏幕下半部分，不跟随单词位置。** Popup 始终出现在 `position:absolute; bottom:220px; left:50%; transform:translateX(-50%);` 的固定位置，居中显示。**不要**让 popup 跟随被点击的单词位置出现。

Floating overlay, glass morphism. Vertical layout, padding 20px 24px.
- Background: `--p-popup-bg`, backdrop-filter blur(20px)
- Border: 1px `--p-popup-border`, radius 16px
- Shadow: 0 8px 40px rgba(0,0,0,0.4)

| Row | Content | Style |
|-----|---------|-------|
| Word + POS | "cortisol" + "n." | 20px bold `--text-1` + 11px `--accent`, gap 10 |
| Phonetic | /ˈkɔːrtɪzɒl/ | 12px `--text-3` |
| Definition | 中文释义 | 13px `--text-2`, line-height 1.5, wraps |
| Divider | — | 1px `--border`, full width |
| Actions | "认识" / "☆ 收藏" | 13px, space-between |

**⚠️ CEFR badge 已移除** — popup 中不要显示 CEFR 等级标签。

**⚠️ 收藏按钮的星星必须是空心（outline）：**
- **默认状态（未收藏）**：星星图标为 **outline/空心**（SVG stroke only, no fill），颜色 `--text-3`。"收藏" 文字也用 `--text-3`。
- **已收藏状态**：星星变为 **filled/实心**，颜色变为 `--accent`。"收藏" 文字也变为 `--accent`。
- 点击时必须有明显的视觉反馈：空心→实心，颜色从灰到紫。

```html
<!-- 默认状态：outline star -->
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>

<!-- 已收藏状态：filled star -->
<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>
```

**"认识" 按钮**：颜色 `--text-3`，点击后该单词从 popup 消失（不加入收藏）。

---

## AI Reason — "?" Icon Interaction

The AI reason is **NOT displayed inline** on the player. Instead:

- A **"?" icon** in the top-right corner indicates AI reasoning is available
- Tapping the "?" opens a **tooltip/panel** showing why this clip was recommended
- Content: e.g. "你对科学话题感兴趣，这个关于睡眠的片段难度适中"
- The tooltip should be dismissible (tap outside or tap ? again)

### Implementation Suggestion

```html
<button class="help-btn" id="help-${idx}">
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="12" y="16" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">?</text>
  </svg>
</button>
```

Tooltip panel (hidden by default):
```css
.ai-reason-tooltip {
  position: absolute;
  top: 96px; right: 20px;
  width: 240px;
  padding: 12px 16px;
  background: var(--p-popup-bg);
  border: 1px solid var(--p-popup-border);
  border-radius: 12px;
  backdrop-filter: blur(20px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}
.ai-reason-tooltip.show {
  opacity: 1;
  pointer-events: auto;
}
```

---

## Feed States

Screenshots: `6v4it.png` (Normal), `7KDpf.png` (Re-rank), `XoeDa.png` (Loading), `MnCzB.png` (Fallback)

### State Flow
```
用户进入 feed
  → [Loading] "AI 正在为你排列内容..."
  → [Normal] "已根据你的偏好排列" + ? icon active
  → 听了 N 个 clip 后
  → [Re-rank] "刚刚根据你的表现重新调整了顺序"（3秒后回到 Normal）
  → 如果 API 挂了
  → [Fallback] "这几条已经替你排好了"，? icon hidden
```

### Hint Text (top, above title)

| State | Content | Color |
|-------|---------|-------|
| Normal | 已根据你的偏好排列 | `rgba(255,255,255,0.15)` |
| Re-rank | 刚刚根据你的表现重新调整了顺序 | `rgba(255,255,255,0.40)` — 临时高亮 |
| Loading | AI 正在为你排列内容... | `rgba(255,255,255,0.30)` |
| Fallback | 这几条已经替你排好了 | `rgba(255,255,255,0.15)` |

All: 11px, Inter, letter-spacing 0.5px, center.

### "?" Icon Visibility by State
- Normal: visible (tap to see AI reason)
- Re-rank: visible (reason text updates per clip)
- Loading: visible but disabled (no data yet)
- Fallback: hidden (API failed, no reason available)

### Loading State Specifics

- Title, source row, subtitle area, mask overlay: all hidden
- 3 loading dots centered in subtitle area: 6px diameter, gap 8px, `rgba(255,255,255,0.20)`
- Play button disabled: bg `rgba(255,255,255,0.10)`, icon `rgba(255,255,255,0.20)`
- Progress bar and other controls remain visible but inert

### Fallback State Specifics

- Identical to Normal except: ? icon hidden, hint text uses original "这几条已经替你排好了"
- All other functionality works normally

---

## Icon Library

All icons use inline SVG (from Material/custom). Key icons:
- `heart`, `bookmark`, `skip-back`, `skip-forward`, `pause`, `play`, `star`
- Chinese translation toggle: circled "A" (SVG circle + text)
- Mask toggle: eye open/closed
- AI reason: circled "?" (SVG circle + text)

---

## ⚠️ 设计对齐检查清单（Code 必须严格遵守）

以下是设计图与代码实现之间容易出现偏差的地方。**每一条都必须按照设计图执行，不可自行发挥：**

| # | 要求 | ❌ 常见错误 | ✅ 正确实现 |
|---|------|-----------|-----------|
| 1 | Word popup 位置 | 跟随点击的单词位置出现 | **固定在屏幕下半部居中**，不跟随单词 |
| 2 | 收藏星星图标 | 实心填充星星 ★ | **空心描边星星 ☆**（默认态），点击后变实心 |
| 3 | 收藏按钮颜色 | 默认就是 accent 紫色 | **默认 --text-3（灰色）**，收藏后才变 accent |
| 4 | CEFR badge | popup 里显示 C1/B2 标签 | **已移除**，popup 中不显示 CEFR |
| 5 | 下一句预览 | 显示 "If you can control..." | **已移除**，不显示下一句 |
| 6 | 中文遮挡按钮 | 在中文字幕旁边显示 A 按钮 | **移到左下角状态栏**，和眼睛图标放一起 |
| 7 | Side actions 位置 | 和字幕平齐 (y≈340) | **在字幕下方** (y≈520)，远离主内容区 |

---

## Implementation Notes (2026-04-10)

1. **Word popup 位置** — `position:absolute; bottom:220px; left:50%; transform:translateX(-50%);` 固定居中，**绝对不要**跟随被点击单词的位置
2. **收藏按钮** — 默认空心星 (stroke only, fill:none)，颜色 --text-3；收藏后实心星 (fill:currentColor)，颜色 --accent。必须有明显视觉反馈
3. **AI reason** — accessed via "?" icon, NOT displayed inline. Tooltip with `.ai-reason-tooltip.show` toggle
4. **Next sentence preview** — REMOVED from UI for cleaner look
5. **Side actions** — positioned lower (y:520), away from subtitle area for visual breathing room
6. **Hint text** — single element, swap `textContent` and color class per state
7. **Re-rank highlight** — apply `.hint-highlight` class (40% white), auto-remove after 3s with `setTimeout`
8. **Loading state** — show `.loading-dots`, hide subtitle/meta, disable play button via `.disabled` class
9. **Fallback** — triggered when API call fails; hide `.help-btn`, revert hint text
10. **Chinese subtitle toggle** — moved to bottom-left bar, same style as mask-toggle (34x34 circle)
11. **Word cache** — popup 查词结果缓存在内存 `wordCache` Map 中，避免重复请求
12. **Progress time labels** — 动态更新，格式 `m:ss`，通过 `fmtTime()` helper
