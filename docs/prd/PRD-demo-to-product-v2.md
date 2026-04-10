# PRD v2: Flipod → 成品体验（参考 Flipod）

## ⚠️ 铁律：不要破坏现有功能

以下模块已经可以正常工作，**禁止修改其核心逻辑**（可以移动 DOM 位置，但不能改内部 JS）：
- 音频播放/暂停（`playClip`、`tryPlay`、`stopAll`）
- 进度条拖拽和点击 seek（`.progress-wrap` 相关所有事件）
- 前进/后退 5 秒（`.rewind-btn`、`.forward-btn`）
- 字幕同步和 karaoke 高亮（`updateSubtitle`、`renderWords`、`findLineAtTime`）
- 音频资源管理（`releaseAudio`、`restoreAudio`、`releasedAudios`）
- 播放速度切换和持久化
- 遮罩模式（mask toggle）
- IntersectionObserver 自动播放逻辑
- 音频 src 选择逻辑（`clip.cdnAudio || clip.audio`）
- CEFR 词汇颜色高亮（已实现）
- 点词 popup（点词暂停音频，关闭恢复，调用 dictionaryapi.dev API）（已实现）
- 右侧 side-actions（爱心/收藏按钮动画）

**测试标准**：每完成一个模块后，必须验证以上所有功能仍然正常。如果任何已有功能失效，立即回滚该模块改动并修复。

---

## 一、整体架构：顶栏 + 侧滑面板（非 Tab Bar）

### 导航方式
不使用底部 Tab Bar。使用顶栏汉堡菜单 [≡] + 从左侧滑出的面板。

### 顶栏
- 替换现有 `.menu-btn` 为顶栏
- 左：汉堡菜单图标 [≡]，点击打开侧滑面板
- 右：头像占位圆（用昵称首字，无昵称时用默认图标）

### 侧滑面板
- DOM 结构放在 body 末尾，`z-index: 150`
- 点击 [≡] → 面板从左侧滑出（`translateX(-100%) → 0`），遮罩淡入
- 点击遮罩或面板内 X 按钮 → 面板收回
- 打开/关闭面板不影响音频播放状态

### 面板内容（主页面）
```
[用户头像+昵称]
─────────────
📚 我的收藏          >
📝 词汇本            >
⚙️ 设置              >
─────────────
[学习偏好卡片]
  CEFR: B1
  兴趣: science, business...
```

### 面板子页面切换
- 点击"我的收藏" → 面板内内容 `translateX` 切到收藏列表子页面，顶部显示 ← 返回
- 点击"词汇本" → 同理切到词汇本子页面
- 子页面间用水平滑动过渡，不是新开页面

### 面板样式
```css
width: 80vw (max 320px)
background: var(--bg-glass)
backdrop-filter: blur(20px)
```

---

## 二、侧滑面板 — 收藏子页面

### 数据来源
localStorage `flipodBookmarks`（JSON 数组，每条：`{clipId, hookTitle, source, domain, tags[], timestamp}`）

### 列表项
每个收藏的 clip 显示为一个卡片：
```
┌──────────────────────────────────┐
│  穿着巧克力衬衫的70岁老人          │
│  Planet Money · business          │
│  收藏于 2026-04-09               │
└──────────────────────────────────┘
```
- 背景：`var(--bg-card)`
- 圆角：12px
- 点击卡片 → 关闭面板 → 滚动到对应 clip → 开始播放

### 空状态
居中显示：`还没有收藏内容` + 副文本 `听到喜欢的片段，点击 🔖 收藏`

---

## 三、侧滑面板 — 词汇本子页面

### 数据来源
localStorage `flipodVocab`（JSON 数组，每条：`{word, cefr, phonetic, context, contextZh, timestamp}`）

### 顶部统计卡
```
┌─────────────────────────────┐
│  已收藏 12 个单词              │
│  A1-A2: 3  B1: 4  B2: 3     │
│  C1: 1  C2: 1                │
└─────────────────────────────┘
```
- CEFR 各等级数字用对应颜色（`var(--cefr-b1)` 等）
- 背景：`var(--bg-card)`

### 词汇列表
每个词一行：
```
samurai          C2
/ˈsæmə,raɪ/  n.
语境：The samurai Hasakura...
```
- 点击词条 → 弹出 popup（复用点词 popup 组件）

### 空状态
居中显示：`暂无单词` + 副文本 `听播客时点击单词，按 ☆ 收藏到这里`

---

## 四、主题系统（CSS 变量）

### 原则
用 CSS 变量实现深色/浅色切换。所有颜色引用 `var(--xxx)`，不硬编码。

### 深色（默认，`:root`）
```css
--bg-primary: #0a0a0a
--bg-card: rgba(255,255,255,0.06)
--bg-glass: rgba(30,30,30,0.95)
--border: rgba(255,255,255,0.08)
--text-1: rgba(255,255,255,0.9)
--text-2: rgba(255,255,255,0.7)
--text-3: rgba(255,255,255,0.4)
--text-4: rgba(255,255,255,0.25)
--accent: #667eea
--heart: #ff4466
--bookmark: #ffc34d
--shadow: none
--cefr-a: rgba(255,255,255,0.95)
--cefr-b1: #7ec8e3
--cefr-b2: #f0c27a
--cefr-c1: #e8836b
--cefr-c2: #c97bdb
```

### 浅色（`[data-theme="light"]`）
```css
--bg-primary: #F2F2F7
--bg-card: #FFFFFF
--bg-glass: rgba(255,255,255,0.85)
--border: rgba(0,0,0,0.06)
--text-1: rgba(0,0,0,0.85)
--text-2: rgba(0,0,0,0.6)
--text-3: rgba(0,0,0,0.4)
--text-4: rgba(0,0,0,0.25)
--accent: #667eea
--heart: #ff3b30
--bookmark: #ff9500
--shadow: 0 1px 3px rgba(0,0,0,0.08)
--cefr-a: rgba(0,0,0,0.8)
--cefr-b1: #2196F3
--cefr-b2: #E6A817
--cefr-c1: #D4553A
--cefr-c2: #9C5DB5
```

### 切换逻辑
- 存 localStorage `flipodTheme`（值 `"dark"` 或 `"light"`）
- 切换入口在侧滑面板"设置"中
- 页面加载时读取并应用

---

## 五、Onboarding（2 屏，非 3 屏）

### 现状
原有 2 屏：CEFR 等级 → 兴趣标签。之前 PRD v1 增加了 Screen 0（昵称/性别/年龄），**现在删除 Screen 0，回到 2 屏**。

### Screen 1 — CEFR 等级选择
- 圆点导航：2 个点，第 1 个亮
- 标题：`你现在听英语播客的感受？`
- 四个选项（ob-card 单选）：
  - "基本听不懂，偶尔抓到几个词" → A1-A2
  - "能听懂大意，细节经常漏" → B1
  - "大部分能跟上，复杂话题偶尔吃力" → B2
  - "基本无障碍，想挑战更难的" → C1-C2
- 底部小字：`不确定也没关系，AI 会根据你的表现自动调整`
- 存 localStorage `flipodLevel`

### Screen 2 — 兴趣标签选择
- 圆点导航：2 个点，第 2 个亮
- 底部小字：`随便选几个就行，AI 会从你的行为中学习`
- 原有的标签选择逻辑不变
- 存 localStorage `flipodInterests`

### 过渡屏
Screen 2 点击"开始探索"后：
1. 页面内容替换为：`正在为你准备内容...` + 3 个 loading dots
2. **不显示 "Hi {昵称}"**（因为不再采集昵称）
3. 停留 1.5-2 秒后，overlay fade out
4. 进入主 feed

### 需要删除的东西
- Screen 0（昵称/性别/年龄）的 HTML 和相关 JS
- `flipodName`、`flipodGender`、`flipodAge` 相关逻辑
- 圆点导航从 3 个改回 2 个
- 过渡屏中 "Hi {昵称}" 相关文案

---

## 六、CEFR 词汇颜色高亮（已实现，仅记录规则）

### 当前状态
已在 `renderWords()` 中实现。每个 `<span class="w">` 带 `data-cefr` 属性，`.spoken` 状态下按 CEFR 等级着色。

### 颜色映射
使用 CSS 变量（`var(--cefr-b1)` 等），支持主题切换。

### 专有名词过滤规则
满足以下任一条件的词，不参与 CEFR 着色（强制白色）：
1. 首字母大写 **且** 不是句子第一个词
2. 纯数字或包含数字
3. CEFR 标为 C2 **且** 首字母大写（大概率未识别的专有名词）

---

## 七、点词交互 Popup（已实现，仅记录规范）

### 当前状态
已实现。调用 `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` 获取音标、词性、英文释义。

### 交互流程
1. 点击 `<span class="w">` → 音频暂停 → 被点击词高亮
2. Popup 弹出，显示：单词 + 发音🔊 + 音标 + 词性+释义 + ✓认识 + ☆收藏
3. 关闭 popup → 恢复播放

### 数据存储
- 收藏词 → localStorage `flipodVocab`
- 认识词 → localStorage `flipodKnownWords`
- API 结果缓存到内存 Map

### ⚠️ 铁律
**绝对不要用 `line.zh`（句子中文翻译）来填充 popup。Popup 必须显示该单词自身的释义。**

---

## 八、Feed 功能卡片（新增，核心差异点）

功能卡片使用 `.screen` 容器（全屏，scroll-snap），在 clip 之间动态插入。用户可以像刷 clip 一样刷过这些卡片。

### 8.1 复习卡（Review Card）

**触发条件**：每 3-5 个 clip 后插入一张

**数据来源**：`flipodVocab` 中收藏时间 ≥ 3 天的词

**卡片内容**：
- 展示一个待复习的词
- "再听一遍" → 播放该词所在句子的音频片段
- "记得" → 更新下次复习时间（当前间隔 × 2，初始间隔 3 天）
- "忘了" → 重置为明天

**间隔重复数据**：存 localStorage `flipodReview`，每条：`{word, nextReview, interval}`

**边界情况**：无可复习的词时不插入

### 8.2 进度卡（Progress Card）

**触发条件**：每 5 个 clip 后插入一张

**卡片内容**：
- Session 内统计：已听 clip 数、累计时长（秒→分钟）、新词数（点过 popup 的词去重）
- CEFR 进度条：各等级占比用对应颜色

### 8.3 推荐调整卡（Recommendation Card）

**触发条件**：最近 10 个 like/bookmark 中同一 tag 占比 > 60%

**卡片内容**：
- 提示用户：检测到你对 {tag} 类内容特别感兴趣
- "好的" → `flipodPreferences` 中该 tag 权重 +1
- "保持现状" → 不操作

**限制**：同一 session 内最多出现 1 次

### 8.4 刷完总结卡（End Summary Card）

**触发条件**：feed 最后一个 clip 之后

**卡片内容**：
- 复用进度卡设计
- 文案改为 `今天的内容听完了`
- 展示本次 session 统计（clip 数、时长、新词数）
- "再刷一轮" → 滚动回第一个 clip

---

## 九、爱心 & 书签语义化

### 爱心（❤️）= 喜欢这类内容
- 点击后存入 localStorage `flipodLikes`：`{clipId, tags[], timestamp}`
- 用于触发推荐调整卡（见 8.3）
- 页面刷新后从 localStorage 恢复点亮状态

### 书签（🔖）= 收藏片段
- 点击后存入 localStorage `flipodBookmarks`：`{clipId, hookTitle, source, domain, tags[], timestamp}`
- 可在侧滑面板"我的收藏"子页面查看
- 取消收藏时从数组中移除
- 页面刷新后恢复状态

---

## 十、不做的事情

- ❌ 底部 Tab Bar（用侧滑面板替代）
- ❌ Screen 0 个人信息采集（昵称/性别/年龄）
- ❌ 用户注册/登录（全用 localStorage）
- ❌ 后端 API
- ❌ 推荐算法（保持现有 interest-based 前端排序）
- ❌ 播客自动爬取（需要后端 + agent，另期安排）
- ❌ 分享功能
- ❌ AI 跟读/打分
- ❌ PDF 导出 / 下载 / 离线

---

## 执行顺序（严格按此顺序，每步完成后验证已有功能）

### Step 1：主题系统 + 顶栏 + 侧滑面板
- 添加 CSS 变量定义（深色/浅色）
- 现有硬编码颜色迁移到 CSS 变量
- 替换现有 `.menu-btn` 为顶栏汉堡菜单
- 新增侧滑面板 DOM + 滑动动画
- 实现面板子页面切换（收藏列表、词汇本）
- 验证：面板开关不影响播放、收藏/词汇数据正确显示

### Step 2：Onboarding 改版
- 删除 Screen 0（昵称/性别/年龄）HTML 和 JS
- 圆点导航 3 → 2
- 更新 Screen 1 文案和选项
- 更新过渡屏（删除 "Hi {昵称}"，只保留 loading）
- 调整屏数逻辑
- 验证：2 屏 OB → 过渡 → 进入 feed 流程完整

### Step 3：Feed 功能卡片
- 实现 Review Card（间隔重复逻辑 + localStorage 读写）
- 实现 Progress Card（session 统计）
- 实现 Recommendation Card（tag 占比计算 + 偏好存储）
- 实现 End Summary Card
- 卡片动态插入到 clip 之间
- 验证：卡片触发条件正确、按钮交互正常、不影响 clip 播放

### Step 4：爱心/书签语义化
- 更新 localStorage 数据结构
- 页面刷新后恢复点亮状态
- 验证：持久化正常、侧滑面板收藏列表同步

### Step 5：全流程验证
- 铁律清单逐项测试
- Onboarding 2 屏 + 过渡 → 进入 feed
- 侧滑面板开关不影响播放
- 收藏/词汇本数据正确显示
- 功能卡片按钮交互正常
- 深色/浅色切换正常
- localStorage 持久化 + 刷新恢复
- safe-area-inset 适配（刘海屏）

---

## 技术约束

- 全部改动在 index.html 单文件内完成
- data.json 结构不变
- 所有用户数据存 localStorage，key 统一 `flipod` 前缀
- 音频走 `clip.cdnAudio || clip.audio`
- 音频资源管理已实现，不要改动
- 参考 CLAUDE.md 中的踩坑记录

## localStorage key 汇总

| Key | 类型 | 用途 |
|-----|------|------|
| `flipodLevel` | string | CEFR 等级 |
| `flipodInterests` | JSON array | 兴趣标签 |
| `flipodSpeed` | string | 播放速度 |
| `flipodTheme` | string | 主题（dark/light） |
| `flipodLikes` | JSON array | 爱心记录 {clipId, tags[], timestamp} |
| `flipodBookmarks` | JSON array | 收藏记录 {clipId, hookTitle, source, domain, tags[], timestamp} |
| `flipodVocab` | JSON array | 收藏词汇 {word, cefr, phonetic, context, contextZh, timestamp} |
| `flipodKnownWords` | JSON array | 标记为"认识"的词 |
| `flipodReview` | JSON array | 间隔重复数据 {word, nextReview, interval} |
| `flipodPreferences` | JSON object | 推荐偏好权重 {tag: weight} |
