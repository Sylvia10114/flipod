# Batch 3A-v2: 产品全路径手机 UI 模拟图

## 背景

Flipod 是一个 AI-native 英语听力 app，有 Feed（泛听）和 Practice（精听）两个核心模式。需要一份完整的 UI 模拟图，把产品中用户能看到的**每一个页面**都画出来，像真实的手机截屏一样。

目的：给研发和设计对齐用，也用于自己梳理产品完整度。

## 需求

创建一个单文件 HTML（React + Tailwind），展示 Flipod 所有页面的手机模拟图。

### 整体布局

- 页面是一个横向可滚动的画布，每个手机屏幕并排排列
- 按产品路径分组，每组有一个标题
- 屏幕之间用箭头连接，标注用户操作（"点击收藏"、"上滑"等）
- 每个手机框固定为 375×812px（iPhone 尺寸），带圆角边框和顶部状态栏
- 深色背景画布，手机框内用 Flipod 的实际配色（`#0C0C0E` 深色主题）

### 需要画的每一屏（共约 18-20 屏）

#### 组1: Onboarding（3屏）
```
[Screen 1] CEFR 等级选择
- 顶部: 2个圆点导航，第1个亮
- 标题: "你现在听英语播客的感受？"
- 4个选项卡片（单选）:
  "基本听不懂，偶尔抓到几个词" 
  "能听懂大意，细节经常漏" ← 选中态（accent边框）
  "大部分能跟上，复杂话题偶尔吃力"
  "基本无障碍，想挑战更难的"
- 底部小字: "不确定也没关系，AI 会根据你的表现自动调整"

[Screen 2] 兴趣标签选择
- 顶部: 2个圆点，第2个亮
- 标题: "你对哪些话题感兴趣？"
- 标签云: psychology, science, history, business, technology, culture, society, health...
- 已选3个高亮（accent背景）
- 底部按钮: "开始探索"
- 小字: "随便选几个就行，AI 会从你的行为中学习"

[Screen 3] Loading 过渡
- 居中: "正在为你准备内容..."
- 3个loading dots动画（用CSS画）
```

#### 组2: Feed 主体验（5屏）
```
[Screen 4] Feed - 正常播放状态
- 顶部: 左侧汉堡菜单 ≡
- clip信息区: 
  标题 "被债务淹没的体面人生"（16px白色）
  来源 "Hidden Brain · psychology"（12px灰色）
  AI推荐理由 "你对 psychology 类内容感兴趣"（12px，--text-3色）
- 字幕区: 
  大字英文，当前词高亮（accent色），已播放词白色，未播放词灰色
  B2词用 --cefr-b2 色，C1词用 --cefr-c1 色
- 中文翻译区: 灰色遮罩块（未点开状态）
- 右侧: 爱心♡ + 书签🔖
- 底部控制区:
  进度条（带句子分界竖线）
  ↺ 后退 | ▶ 播放 | ↻ 前进
  眼睛图标 | Ⓐ CEFR | 1.0x 速度

[Screen 5] Feed - 点词 Popup
- 和Screen 4一样，但某个词被点击
- 底部弹出popup:
  "couple" /ˈkʌp.əl/
  noun · two people who are married or in a romantic relationship
  [✓ 认识] [☆ 收藏]

[Screen 6] Feed - 中文翻译展开
- 和Screen 4一样，但遮罩区被点开
- 显示中文翻译文字

[Screen 7] Feed - Progress Card（功能卡片）
- 全屏卡片，和clip一样占满屏幕
- 标题: "📊 你的进度"
- 内容:
  已听 5 段
  累计 6 分钟
  查了 8 个新词
  CEFR 分布条（彩色横条：B1蓝、B2金、C1红）
- 底部: 继续下滑

[Screen 8] Feed - Review Card（功能卡片）
- 全屏卡片
- 标题: "🔄 Quick Review"
- 单词: "cortisol" (大字)
- CEFR标签: C1
- 出现在: "The stress hormone cortisol can affect..."
- [▶ 再听一遍] 按钮
- 底部两个按钮: [记得] [忘了]
```

#### 组3: 侧边栏（4屏）
```
[Screen 9] 侧边栏 - 主菜单
- 左侧滑出面板（宽80vw），右侧有半透明遮罩
- 用户头像圆 + "B1"等级标签
- 菜单项:
  📚 我的收藏 >
  🎧 听力练习 >
  📝 词汇本 >
  ⚙️ 设置 >
- 底部: 学习偏好卡片（CEFR: B1, 兴趣: psychology, science...）

[Screen 10] 侧边栏 - 我的收藏
- 顶部: ← 返回 + "我的收藏"
- 收藏列表:
  ┌ 被债务淹没的体面人生 ┐
  │ Hidden Brain · psychology │
  │ 收藏于 2026-04-09        │
  └──────────────────────┘
  （多个类似卡片）

[Screen 11] 侧边栏 - 词汇本
- 顶部: ← 返回 + "词汇本"
- 统计卡: "已收藏 12 个单词" + CEFR分布（B1:4 B2:3 C1:3 C2:2）
- 词汇列表:
  cortisol     C1
  /ˈkɔːtɪzɒl/ n.
  语境: The stress hormone cortisol...

[Screen 12] 侧边栏 - 听力练习（Practice入口）
- 顶部: ← 返回 + "听力练习"
- "你收藏的" 区域:
  ┌ 被债务淹没的体面人生 ┐
  │ Hidden Brain · 1:29  │
  │ [未练习] 标签(accent色)│
  └──────────────────────┘
- "AI 推荐练习" 区域:
  ┌ 童年记忆的可塑性      ┐
  │ Radiolab · 1:15      │
  │ 包含你查过的 cortisol  │
  └──────────────────────┘
```

#### 组4: Practice 流程（6屏）
```
[Screen 13] Practice Step 1 - 盲听
- 顶部: 4个步骤圆点，第1个亮
- 提示: "先听一遍，看能抓住多少"
- 中间: 音频波形动画（几条竖线高低变化）
- 播放控制: ▶ 按钮
- 底部（音频播完后出现）:
  [大部分听懂了] [有些没听清]

[Screen 14] Practice Step 2 - 逐句精听
- 顶部: 4个步骤圆点，第2个亮
- 当前句（大字居中）:
  "The lovely couple with a nice house"
  （B2词着色，可点击查词）
- 中文翻译（遮罩态）
- 进度: "第 3 / 15 句"
- 底部两个按钮: [✓ 容易] [✗ 困难]

[Screen 15] Practice Step 3 - 难句闪卡（正面）
- 顶部: 4个步骤圆点，第3个亮
- 闪卡正面:
  ▶ 播放按钮
  "unexpectedly find themselves drowning in debt"
  难词 "drowning" 高亮
- 卡片计数: "1 / 3"
- 提示: "点击翻面"

[Screen 16] Practice Step 3 - 难句闪卡（背面）
- 闪卡背面:
  中文: "出乎意料地发现自己深陷债务"
  难词释义: drowning /ˈdraʊnɪŋ/ B2
  "to be covered with too much of something"
- 底部: [搞懂了] [还不清楚]

[Screen 17] Practice Step 4 - 复听
- 顶部: 4个步骤圆点，第4个亮
- 完整播放带字幕（和Feed类似）
- 之前查过的词: 词下方有小圆点标记
- 进度条上: 之前标记难的句子位置有accent色标记

[Screen 18] Practice - 练完总结
- 居中统计:
  "这段练完了"
  查了 4 个词
  精听了 15 句
  3 句觉得难
- 两个按钮: [回到 Feed] [再练一段]
```

### 视觉规范

**手机框**:
- 圆角: 40px
- 边框: 2px solid rgba(255,255,255,0.1)
- 顶部状态栏: 时间 + wifi + 电量（简笔画就行）
- 内部背景: #0C0C0E

**颜色直接用 Flipod 的配色**:
- 主背景: #0C0C0E
- accent: #8B9CF7
- 文字主色: rgba(255,255,255,0.87)
- 文字次色: rgba(255,255,255,0.55)
- 文字三色: rgba(255,255,255,0.30)
- CEFR B1: #7AAFC4, B2: #C4A96E, C1: #C47A6E, C2: #c97bdb
- 爱心: #ff4466, 书签: #ffc34d

**连接箭头**:
- 组内屏幕之间用细线箭头连接
- 箭头上标注用户操作文字（12px灰色）
- 有分支的地方（比如Step1的两个选项）画分叉

**画布**:
- 深灰背景 #1a1a1a
- 每组有标题（如 "Onboarding"、"Feed"、"Practice"）
- 支持鼠标拖拽平移 + 滚轮缩放

### 输出

单个 HTML 文件，保存到 `design/product-ui-screens.html`

**重要**：每个手机屏幕里的内容要尽量接近真实 UI，不是线框图。用实际的文字、实际的颜色、实际的布局。目标是看这份图就知道产品每个页面长什么样。
