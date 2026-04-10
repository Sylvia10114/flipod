# Pencil Agent 提示词 — AI Feed Ranking UI 改动

以下是分步骤的 Pencil Agent 提示词，直接复制粘贴到 Agent 面板执行。

---

## Prompt 1: 在 Player 画板上加 AI Reason 区域

在 "Player — Immersive Feed" 画板里，找到 hook title（"Why We Sleep Badly"）和 source tag（"Huberman Lab · Neuroscience"）之间的区域。

在 source tag 下方加一个新的文字区域：
- 第一行小标签文字："WHY THIS NOW"，字号 10px，字母间距 0.08em，全大写，颜色 rgba(255,255,255,0.15)
- 第二行正文："你对科学话题感兴趣，这个关于睡眠的片段难度适中"，字号 12px，行高 1.5，颜色 rgba(255,255,255,0.30)，最大宽度 260px，居中对齐
- 整个区域距离 source tag 上方 6px
- 不要加背景色、边框或卡片容器，它应该是纯文字，非常低调

---

## Prompt 2: 修改顶部提示语

在同一个 Player 画板里，找到 hook title 上方的小提示文字（如果有 "这几条已经替你排好了" 之类的文案）。

把它改为："已根据你的偏好排列"
- 字号 11px，颜色 rgba(255,255,255,0.15)，letter-spacing 0.5px
- 居中

---

## Prompt 3: 新建 Re-rank 提示状态画板

复制 "Player — Immersive Feed" 画板，命名为 "Player — After Re-rank"。

在新画板中：
- 顶部提示语改为 "刚刚根据你的表现重新调整了顺序"
- 提示语颜色从 rgba(255,255,255,0.15) 提升到 rgba(255,255,255,0.40)，表示临时高亮状态
- hook title 换一个内容："Google这次开源，为什么可能改变AI格局？"
- source tag 换为："The AI Podcast · tech"
- AI reason 换为："你刚听完几个商业话题，换个 tech 内容调节一下节奏"
- 其他元素不变

---

## Prompt 4: 新建 Loading 状态画板

复制 "Player — Immersive Feed" 画板，命名为 "Player — Feed Loading"。

在新画板中：
- 顶部提示语改为 "AI 正在为你排列内容..."
- 提示语颜色用 rgba(255,255,255,0.30)
- 字幕区域清空，放三个 loading dots（三个小圆点，间距 8px，直径 6px，颜色 rgba(255,255,255,0.20)）居中
- AI reason 区域不显示（因为还没拿到数据）
- 播放按钮置灰（disabled 状态）

---

## Prompt 5: 新建 Fallback 状态画板

复制 "Player — Immersive Feed" 画板，命名为 "Player — Fallback (No AI)"。

在新画板中：
- 顶部提示语保持 "这几条已经替你排好了"
- AI reason 区域隐藏（不显示）
- 其他一切和正常 Player 一样

这个画板表示：API 调用失败时的降级体验。用户看不到 AI reason，但其他功能完全正常。

---

## 设计要点说明（给设计决策做参考）

### AI Reason 的视觉权重
- 必须低于 hook title 和 source tag
- 它是一个"系统在工作"的轻量信号，不是 CTA
- 用户应该是扫一眼就过，不需要停下来细读
- 颜色用 --text-3（30% 白色），比 source tag 的 --text-3 一致或更淡

### "WHY THIS NOW" 标签
- 全大写英文，不是中文，和整体 UI 的英文学习氛围一致
- 是一个固定标签，所有 clip 都一样
- 作用是告诉用户"下面这行字是 AI 的解释"

### 状态流转
```
用户进入 feed
  → [Loading] AI 正在为你排列内容...
  → [Normal] 已根据你的偏好排列 + AI reason 显示
  → 听了 5 个 clip
  → [Re-rank] 刚刚根据你的表现重新调整了顺序（3秒后回到 Normal）
  → 如果 API 挂了
  → [Fallback] 这几条已经替你排好了，无 AI reason
```
