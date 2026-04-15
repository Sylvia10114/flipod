# Flipod — Developer Handoff Package

## Contents

```
flipod-handoff/
├── HANDOFF.md              ← this file
├── overview/               ← full screen map PNG
├── screens/                ← individual screen PNGs (2x retina)
│   ├── EBpxt.png           s1  CEFR 选择
│   ├── bjijz.png           s2  兴趣标签
│   ├── 22r74.png           s3  Loading
│   ├── DTeAl.png           s4  Feed 播放
│   ├── sZMtk.png           s5  点词 Popup
│   ├── wdvzR.png           s6  翻译展开
│   ├── DFBBs.png           s7  Progress Card
│   ├── ePRwZ.png           s8  Review Card
│   ├── aGXCd.png           s9  主菜单（侧边栏）
│   ├── PoP7A.png           s10 我的收藏
│   ├── kxlWe.png           s11 词汇本
│   ├── HEKeh.png           s12 听力练习
│   ├── 9KhnX.png           s13 Step 1 盲听
│   ├── XdQwW.png           s14 Step 2 精听
│   ├── zu8zO.png           s15 Step 3 闪卡正
│   ├── b4Pf3.png           s16 Step 3 闪卡背
│   ├── STM9t.png           s17 Step 4 复听
│   ├── n2PVE.png           s18 练完总结
│   └── hbFgB.png           Deep Listen Quiz
└── code/
    ├── design-tokens.css    CSS custom properties
    ├── tailwind.config.ts   Tailwind theme extension
    └── components/
        ├── PlayerLayout.tsx  Master 3-zone layout
        ├── StepDots.tsx      Practice step indicator
        ├── PlayButton.tsx    Play/pause toggle
        ├── ProgressBar.tsx   Audio progress bar
        ├── ActionButton.tsx  Full-width CTA button
        └── FlashCard.tsx     Vocabulary flashcard

---

## Screen Dimensions

- **Device target**: iPhone 14/15 (375×812 logical points)
- **Exports**: @2x retina (750×1624 px)

---

## Layout System — Master Player Frame

All Player & Practice screens share a **3-zone vertical layout**:

```
┌──────────────────────┐
│   Status Bar  ~37px  │  (system)
├──────────────────────┤
│   Header     120px   │  dots / title / source
├──────────────────────┤
│                      │
│   Content    flex-1   │  subtitles / waveform / card
│              ~475px  │
│                      │
├──────────────────────┤
│   Controls   180px   │  buttons / progress / play
└──────────────────────┘
     px = 20 each side
```

**Key alignment rules**:
- Header bottom is at the same Y on every screen
- Controls top is at the same Y on every screen
- Body horizontal padding = 20px (content width = 335px)

---

## Color System

| Token              | Hex          | Usage                      |
|--------------------|--------------|----------------------------|
| `--bg-app`         | `#0C0C0E`    | App background             |
| `--accent-feed`    | `#8B9CF7`    | Feed player accent         |
| `--accent-practice`| `#A855F7`    | Practice flow accent       |
| `--text-1`         | `#FFFFFFDE`  | Primary text (87%)         |
| `--text-2`         | `#FFFFFF8C`  | Secondary text (55%)       |
| `--text-3`         | `#FFFFFF4D`  | Tertiary/caption (30%)     |
| `--accent-success` | `#22C55E`    | Success / easy             |
| `--accent-error`   | `#EF4444`    | Error / hard               |
| `--accent-gold`    | `#C4A96E`    | CEFR level tags            |

Full token list → `code/design-tokens.css`

---

## Typography

| Role         | Family     | Size | Weight | Color      |
|-------------|------------|------|--------|------------|
| Eng subtitle | Inter      | 22px | 400    | `--text-2` |
| Zh subtitle  | Inter      | 14px | 400    | `--text-3` |
| Title        | Inter      | 16px | 500    | `--text-1` |
| Source label  | Inter      | 12px | 400    | `--text-3` |
| Hint text    | Inter      | 15px | 400    | `--text-2` |
| Button       | Inter      | 14px | 500    | varies     |
| Time / code  | Geist Mono | 10-11px | 400-600 | `--text-3` |
| Stat number  | Geist Mono | 28px | 700    | accent     |

---

## Icon System

- **Library**: [Lucide](https://lucide.dev) (`lucide-react`)
- **Sizes**: 16px (caption), 20px (standard), 22px (controls)

| Icon          | Usage                    |
|---------------|--------------------------|
| `menu`        | Hamburger menu (top-left)|
| `heart`       | Favorite                 |
| `bookmark`    | Bookmark / save          |
| `play`        | Play audio               |
| `pause`       | Pause audio              |
| `rotate-ccw`  | Rewind                   |
| `rotate-cw`   | Fast-forward             |
| `eye`         | CEFR visibility toggle   |
| `volume-2`    | Pronunciation speaker    |

---

## User Flow

### Onboarding (s1 → s3)
```
CEFR 选择 → 兴趣标签 → Loading → Feed
```

### Feed (s4 → s8)
```
Feed 播放 ↔ 点词 Popup ↔ 翻译展开
     ↕            ↕
Progress Card  Review Card
```

### Sidebar (s9 → s12)
```
主菜单 → 我的收藏 / 词汇本 / 听力练习
```

### Practice (s13 → s18)
```
Step 1 盲听 → Step 2 精听 → Step 3 闪卡 → Step 4 复听 → 练完总结
```

---

## Component Specs

### PlayButton
- Circle: 52px diameter (feed) / 48px (practice) / 64px (blind listen)
- Fill: `--accent-feed` or `--accent-practice`
- Icon: play/pause, colored `--bg-app`

### ProgressBar
- Track: 3-4px height, `--bg-surface-3`
- Fill: accent color
- Thumb: 12px white circle at current position
- Time labels: Geist Mono 10-11px `--text-3`

### ActionButton
- Full-width, corner-radius 10px, padding 12px vertical
- Primary: accent fill + white text
- Secondary: transparent + subtle border + muted text

### FlashCard
- Corner-radius 16px, `--bg-surface-1` fill
- Padding 20px vertical, 16px horizontal
- Front/back content centered vertically

### StepDots
- 4 circles, 8px diameter, gap 8px
- Active: accent color, inactive: `--text-4`
```
