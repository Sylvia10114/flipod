# Batch 1: UI 修复（直接改 index.html）

你需要对 `index.html` 做以下 4 个修改。每改一个就验证没有破坏现有功能。

## 1A. 去掉顶部 feed status 文字

找到 feed status bar 区域（显示"这几条已经替你排好了"/"AI 正在为你排列内容..."等文字的元素），把它的默认状态设为 **隐藏**（`display:none` 或 `opacity:0`）。不要删除代码，只是不显示。

原因：这行文字暴露了"内容是有限的、被排过的"，破坏了无限流的产品心智。

## 1B. 去掉底部状态栏的「第n/n句」和「n/22」

找到底部状态栏中的 `.sentence-indicator`（显示"第 2 / 15 句"）和 clip counter（显示"1/22"），把它们都隐藏。

原因：
- "第n/n句"让用户觉得在做练习题，Feed 应该是轻松消费场景
- "1/22"暴露了总量有限，破坏无限流心智
- 底部太拥挤

注意：只在 Feed 主播放器中隐藏。Practice 模式中的句子指示器保留。

## 1C. AI 推荐理由从隐藏的 ? 按钮改为直接显示

现在右上角有一个 `.help-btn`（? 按钮），点击弹出 `.ai-reason-tooltip`。问题是按钮颜色太淡（`--text-3` = 30% 透明度），用户根本看不到。

改法：
1. 隐藏 `.help-btn`（`display:none`）
2. 把 `buildAiReason()` 的结果直接显示在 clip 顶部信息区域（标题下方、source 行的位置附近），作为一行小字
3. 样式：`font-size: 12px; color: var(--text-3); margin-top: 4px;`
4. 内容就用现有的 `buildAiReason()` 函数返回值，它已经根据用户兴趣和 clip tag 生成了推荐理由

## 1D. Feed 功能卡片降低触发门槛，首次访问可见

现在功能卡片的触发条件对新用户太高：
- Review Card 需要词汇收藏满 3 天
- Recommendation Card 需要 10 个 like 中某 tag > 60%
- Progress Card 每 5 个 clip 才出现

改法：
1. **Progress Card**：从每 5 个 clip 改为每 **3** 个 clip 后出现
2. **Review Card**：保持现有逻辑，但如果没有可复习的词，在同一位置插入一张"引导卡"：
   - 标题："Quick Review"
   - 内容："听到不认识的词？点击它收藏，过几天我会帮你复习"
   - 样式复用 `.review-card`，但内容更简洁
3. **Recommendation Card**：从需要 10 个 like 降低到 **3 个 like**，占比阈值从 60% 降到 **50%**

## 验证清单

改完后验证：
- [ ] 音频播放/暂停正常
- [ ] 进度条拖拽正常
- [ ] 字幕同步和 karaoke 高亮正常
- [ ] 点词 popup 正常
- [ ] 收藏/爱心按钮正常
- [ ] 侧滑面板开关正常
- [ ] Practice 模式中句子指示器仍然存在
- [ ] 功能卡片在前 5 个 clip 内可见
- [ ] AI 推荐理由在每个 clip 顶部可见
