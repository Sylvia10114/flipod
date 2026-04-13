# Batch 2A: Practice 侧边栏 AI 推荐逻辑

## 背景

侧边栏的 Practice 面板（`#practice-panel`）目前只展示用户收藏的 clip。PRD 要求分两个区域：
1. "你收藏的" — 已实现
2. "AI 推荐练习" — 未实现

## 需求

在 `renderPracticeList()` 函数中（约第 4269 行），在收藏列表下方增加一个"AI 推荐练习"区域。

### 推荐逻辑（前端实现，不需要后端）

从 `clips` 数组中选出 3-5 个推荐 clip，规则如下：

1. **排除已收藏的** — 已经在收藏列表里的不重复推荐
2. **排除已练习过的** — `flipodPracticeData` 中 `done: true` 的跳过
3. **优先匹配用户兴趣** — `flipodInterests` 中的 tag 匹配 clip.tag
4. **优先包含用户查过的词** — 遍历 `flipodVocab` 中的词，检查哪些 clip 的 `lines[].words[]` 包含这些词，优先推荐包含已查词汇的 clip（自然复习）
5. **CEFR 匹配** — 用户 level 是 B1 就优先推 B1-B2 内容（通过 clip 中 B2+ 词汇占比粗略判断难度）

### 推荐理由

每个推荐 clip 下面显示一行推荐理由（12px, `--text-3`），例如：
- "包含你查过的 cortisol、dopamine"
- "适合你当前 B1 水平"
- "你可能对 psychology 类内容感兴趣"

理由生成逻辑：
- 如果是因为包含已查词汇 → 显示前 2 个匹配词
- 如果是因为兴趣匹配 → 显示匹配的 tag
- 其他情况 → "难度适合你现在的水平"

### UI

```
── 你收藏的 ──
[现有收藏列表]

── AI 推荐练习 ──
┌──────────────────────────────────┐
│  被债务淹没的体面人生               │
│  Hidden Brain · psychology · 1:29 │
│  包含你查过的 cortisol              │
└──────────────────────────────────┘
[更多推荐卡片...]
```

卡片样式复用 `.pr-list-item`。点击卡片 → 进入 Practice Step 1（和收藏 clip 的行为一致）。

### 空状态

如果推荐算法选不出任何 clip（比如所有 clip 都已练习过），显示：
"所有内容都练过了，新内容正在路上"

## 参考代码位置

- `renderPracticeList()`: 约第 4269 行
- `flipodVocab` 读取: 搜索 `flipodVocab`
- `flipodPracticeData` 读取: 搜索 `flipodPracticeData`
- `flipodInterests` 读取: 搜索 `flipodInterests`
- `flipodLevel` 读取: 搜索 `flipodLevel`
