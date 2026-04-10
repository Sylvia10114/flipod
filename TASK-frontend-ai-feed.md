# TASK: 前端接入 AI Feed Ranking

## 背景

后端已就绪：`functions/api/rank.js` 提供 `POST /api/rank` 接口，接收用户画像，返回 AI 排好序的 clip 列表 + 每条推荐理由。本地测试脚本 `test_rank_api.py` 已验证通过。

前端已有的基础设施（不需要新建）：
- `.ai-reason` CSS 类已定义（line 222-236），当前 `display: none`
- `buildAiReason()` 函数（line 2279-2292）已存在，当前用硬编码模板
- 每个 clip 卡片已渲染 `<div class="ai-reason">` 元素（line 2313）
- 前端已有基于 interest 的 tag 排序逻辑（line 2220-2268）

## 要改什么

### 改动 1：页面加载时调 /api/rank 获取 AI 排序

**位置**：替换现有的前端排序逻辑（约 line 2210-2268 的 `matchedClips` / `otherClips` / `shuffle` / `interleave` 那段）

**逻辑**：
1. Onboarding 完成后（或已有 localStorage 数据直接进入 feed 时），收集用户画像：
   ```js
   const profile = {
     level: localStorage.getItem('listenLeapLevel') || 'B1',
     interests: JSON.parse(localStorage.getItem('listenLeapInterests') || '[]'),
     listened: [],   // 初始为空，后续 re-rank 时填充
     skipped: [],
     vocab_clicked: [],
     session_duration: 0
   };
   ```
2. 调用 `/api/rank`：
   ```js
   const res = await fetch('/api/rank', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(profile)
   });
   const { feed } = await res.json();
   // feed = [{ id: 13, reason: "..." }, { id: 1, reason: "..." }, ...]
   ```
3. 用 `feed` 的 id 顺序重排 `clips` 数组，并把 `reason` 存到每个 clip 对象上：
   ```js
   const clipMap = {};
   originalClips.forEach((c, i) => clipMap[i] = c);
   clips = feed.map(item => {
     const c = clipMap[item.id];
     c._aiReason = item.reason;  // 挂载 AI reason
     return c;
   });
   ```
4. **Fallback**：如果 `/api/rank` 调用失败（超时、网络错误），静默回退到现有的前端排序逻辑。不要让 AI 排序的失败阻断用户体验。

### 改动 2：显示 AI 推荐理由

**位置**：修改 `buildAiReason()` 函数（line 2279-2292）和 `.ai-reason` CSS（line 222-223）

**逻辑**：
1. `buildAiReason` 改为读取 `clip._aiReason`：
   ```js
   function buildAiReason(clip, idx) {
     if (clip._aiReason) return clip._aiReason;
     // fallback: 保留原有模板逻辑
     ...
   }
   ```
2. `.ai-reason` 的 `display: none` 改为 `display: block`

**视觉设计（给 Pencil 画原型用）**：

```
┌─────────────────────────────────┐
│                                 │
│  ┌─ .top-info ───────────────┐  │
│  │  这几条已经替你排好了       │  │  ← .top-info-hint (11px, --text-4)
│  │                           │  │
│  │  穿着巧克力衬衫的70岁老人   │  │  ← .hook-title (16px, --text-1, font-weight:500)
│  │                           │  │
│  │  Planet Money · business   │  │  ← .source-tag (12px, --text-3)
│  │                           │  │
│  │  ┌─ .ai-reason ────────┐  │  │
│  │  │ WHY THIS NOW        │  │  │  ← .reason-kicker (10px, --text-4, uppercase, letter-spacing 0.08em)
│  │  │ 你对商业话题感兴趣，  │  │  │  ← reason 正文 (继承 .ai-reason 样式)
│  │  │ 先从这个轻松的故事    │  │  │
│  │  │ 进入状态             │  │  │
│  │  └────────────────────┘  │  │
│  └───────────────────────────┘  │
│                                 │
│   [字幕区域]                     │
│                                 │
│   [播放控制]                     │
│                                 │
│               ❤️                │  ← side-actions
│               🔖                │
│                                 │
└─────────────────────────────────┘
```

**`.ai-reason` 样式调整**：
```css
.ai-reason {
  display: block;           /* 从 none 改为 block */
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-3);     /* 低调，不抢 hook-title 的注意力 */
  max-width: 260px;
  text-align: center;
}
```

重点：reason 文字要**低调**。它不是标题，不是 CTA，而是一个"系统在为你做决策"的轻量信号。颜色用 `--text-3`（30% 白/40% 黑），字号 12px，不加粗。用户扫一眼知道"哦系统帮我选的"就够了，不需要细读。

### 改动 3：Session 中途 Re-rank

**触发条件**：用户听完第 5 个 clip 时

**逻辑**：
1. 在 clip 播放完成的回调里计数。当已完成 5 个 clip 时：
   ```js
   const profile = {
     level: localStorage.getItem('listenLeapLevel') || 'B1',
     interests: JSON.parse(localStorage.getItem('listenLeapInterests') || '[]'),
     listened: getListenedClipIds(),    // 已听完的 clip id 列表
     skipped: getSkippedClipIds(),      // 听了不到 30% 就划走的 clip id 列表
     vocab_clicked: getClickedWords(),  // 本次 session 点过的词
     session_duration: getSessionDuration()
   };
   ```
2. 调用 `/api/rank`，用返回的排序**替换尚未听过的 clip 的顺序**
3. 已经加载到 DOM 里的（当前和前面的）不动，只重排后面的
4. 不加 loading 状态——re-rank 在后台静默完成
5. 同样有 fallback：失败就保持原序

**判断"跳过"的标准**：用户在一个 clip 上停留不到总时长的 30% 就滑到下一个 = skipped

### 改动 4：顶部提示语更新

当前 `.top-info-hint` 的文案是固定的"这几条已经替你排好了"。

改为：
- 初始加载（第一次排序）：`AI 正在为你排列内容...`（调 API 时显示），完成后变成 `已根据你的偏好排列`
- Re-rank 后：`刚刚根据你的表现重新调整了顺序`（显示 3 秒后淡回 `已根据你的偏好排列`）
- Fallback（API 失败）：保持原来的 `这几条已经替你排好了`

这个提示语是让用户**感知到 AI 在工作**的最关键信号。

## 铁律：不要动这些东西

以下模块已经正常工作，**禁止修改其核心逻辑**（完整列表见 PRD-demo-to-product-v2.md 顶部）：
- 音频播放/暂停
- 进度条拖拽和 seek
- 字幕同步和 karaoke 高亮
- 音频资源管理
- 播放速度切换
- 遮罩模式
- IntersectionObserver 自动播放
- CEFR 词汇颜色高亮
- 点词 popup
- 右侧 side-actions

## 验证清单

1. **AI 排序生效**：不同 CEFR level + interest 组合看到不同的 clip 顺序
2. **Reason 显示**：每个 clip 卡片上能看到中文推荐理由，样式低调不突兀
3. **Fallback 正常**：断网或 API 报错时，feed 仍然能正常加载（用原有排序）
4. **Re-rank 静默**：听完 5 个 clip 后，后面的 clip 顺序悄悄更新，无 loading 闪烁
5. **铁律清单全通过**：播放、seek、字幕、点词、收藏全部正常
6. **顶部提示语**：能看到 `已根据你的偏好排列`，re-rank 后能看到临时提示

## 技术约束

- 所有改动在 index.html 单文件内
- data.json 不改
- 新增的 localStorage key 统一 `listenLeap` 前缀
- `/api/rank` 在本地开发时可能跨域，需要 Function 返回 CORS headers（已在 rank.js 中处理）
- 如果本地没有跑 wrangler，可以临时把 API URL 改成一个 mock（返回固定 JSON），先调通前端逻辑

## 参考文件

- `functions/api/rank.js` — 后端接口，看 POST body 格式和返回格式
- `PRD-demo-to-product-v2.md` — 铁律清单、现有功能说明
- `CLAUDE.md` — 环境踩坑记录
