# Pencil Agent 提示词 — 补全缺失的设计画板

以下画板在 design-spec.md 中没有视觉规格。逐条复制到 Pencil Agent 执行。

所有画板统一使用 design-spec.md 中定义的 Design Tokens（颜色、字体、间距）。屏幕尺寸 390x844（iPhone 14/15）。

---

## 一、Onboarding Screen 1 — CEFR 等级选择

新建画板 "OB1 — CEFR Level"，390x844，背景渐变 `linear-gradient(180deg, #0C0C0E 0%, #16161A 100%)`。

布局从上往下：

1. 圆点导航：顶部居中，距顶 60px。2 个小圆点，间距 8px。第 1 个点 8x8 填充 `#8B9CF7`（accent），第 2 个点 8x8 填充 `rgba(255,255,255,0.15)`

2. 标题：距圆点下方 40px，居中。文字"你现在听英语播客的感受？"，18px，font-weight 600，颜色 `rgba(255,255,255,0.87)`

3. 四个选项卡片：距标题下方 32px，左右边距 24px，纵向排列，间距 12px。每个卡片：
   - 圆角 12px，背景 `rgba(255,255,255,0.05)`，边框 1px `rgba(255,255,255,0.05)`
   - 内边距 16px 20px
   - 文字 15px，font-weight 400，颜色 `rgba(255,255,255,0.70)`
   - 选中状态：背景 `rgba(139,156,247,0.12)`，边框 1px `#8B9CF7`，文字颜色 `rgba(255,255,255,0.87)`
   - 四个选项分别是：
     - "基本听不懂，偶尔抓到几个词"
     - "能听懂大意，细节经常漏"
     - "大部分能跟上，复杂话题偶尔吃力"
     - "基本无障碍，想挑战更难的"

4. 底部小字：距最后一个卡片下方 24px，居中。"不确定也没关系，AI 会根据你的表现自动调整"，12px，颜色 `rgba(255,255,255,0.30)`

5. "下一步"按钮：距底部 60px，居中，宽度 calc(100% - 48px)，高度 48px，圆角 24px，背景 `#8B9CF7`，文字"下一步" 16px font-weight 600 颜色 `#0C0C0E`

画两个版本：默认状态（无选中）和选中第二项"能听懂大意"的状态。

---

## 二、Onboarding Screen 2 — 兴趣标签选择

新建画板 "OB2 — Interests"，390x844，同样背景渐变。

布局从上往下：

1. 圆点导航：同 Screen 1，但第 2 个点亮（accent），第 1 个点暗

2. 标题："你对哪类内容感兴趣？"，18px，font-weight 600，颜色 `rgba(255,255,255,0.87)`，居中

3. 标签网格：距标题下方 32px，居中对齐，flex-wrap，gap 10px。标签列表：
   - Science, Business, Tech, Psychology, History, Culture, Society, Story
   - 每个标签：圆角 20px，padding 8px 18px，背景 `rgba(255,255,255,0.05)`，边框 1px `rgba(255,255,255,0.05)`
   - 文字 14px，颜色 `rgba(255,255,255,0.55)`
   - 选中状态：背景 `rgba(139,156,247,0.12)`，边框 `#8B9CF7`，文字 `rgba(255,255,255,0.87)`
   - 每个标签前面可加一个小 emoji：🔬 Science, 💼 Business, 💻 Tech, 🧠 Psychology, 📜 History, 🎭 Culture, 🌍 Society, 📖 Story

4. 底部小字："随便选几个就行，AI 会从你的行为中学习"，12px，`rgba(255,255,255,0.30)`

5. "开始探索"按钮：同 Screen 1 的按钮样式，文字改为"开始探索"

画一个已选中 Science、Tech、Business 三个标签的状态。

---

## 三、Onboarding 过渡屏

新建画板 "OB — Transition"，390x844，背景 `#0C0C0E`。

居中布局：

1. 文字"正在为你准备内容..."，16px，font-weight 500，颜色 `rgba(255,255,255,0.55)`，居中

2. 距文字下方 16px，3 个 loading dots 水平排列，间距 8px，每个 6x6 圆形，颜色 `rgba(255,255,255,0.20)`。加 pulse 动画注释（"三个点依次闪烁，间隔 0.2s"）

无按钮，无其他元素。极简。

---

## 四、侧滑面板 — 主页面

新建画板 "Panel — Main"，320x844（面板宽度 80vw，max 320px），背景 `rgba(30,30,34,0.95)` + backdrop-filter blur 注释。

布局从上往下，padding 24px：

1. 顶部用户区：
   - 头像占位圆 48x48，背景 `rgba(255,255,255,0.10)`，居中一个"S"字母（代表用户名首字），16px font-weight 600 `rgba(255,255,255,0.55)`
   - 无昵称文字（不采集昵称）

2. 分隔线：距头像下方 20px，1px `rgba(255,255,255,0.05)`，全宽

3. 菜单项：纵向排列，间距 0。每项高度 52px，横向 flex，左侧 emoji + 14px 文字 `rgba(255,255,255,0.70)`，右侧 ">" 箭头 `rgba(255,255,255,0.30)`
   - 📚 我的收藏
   - 📝 词汇本
   - ⚙️ 设置

4. 分隔线

5. 学习偏好卡片：圆角 12px，背景 `rgba(255,255,255,0.05)`，padding 16px
   - "CEFR: B1" — 13px，`rgba(255,255,255,0.55)`
   - "兴趣: Science, Business, Tech" — 13px，`rgba(255,255,255,0.40)`

6. 底部留白

右侧加一个半透明遮罩层示意（rgba(0,0,0,0.5)，表示面板后面的 feed 被遮住）。

---

## 五、侧滑面板 — 收藏子页面

新建画板 "Panel — Bookmarks"，320x844，同样背景。

1. 顶部：← 返回箭头（20x20，`rgba(255,255,255,0.55)`）+ "我的收藏" 16px font-weight 600 `rgba(255,255,255,0.87)`

2. 收藏列表：距顶部 20px，纵向排列，间距 12px，padding 0 16px。每个卡片：
   - 圆角 12px，背景 `rgba(255,255,255,0.05)`，padding 14px 16px
   - 第一行：clip 标题，14px font-weight 500，`rgba(255,255,255,0.87)`
   - 第二行：播客名 + " · " + tag，12px，`rgba(255,255,255,0.40)`
   - 第三行：收藏于 2026-04-10，11px，`rgba(255,255,255,0.25)`

示例数据 3 张卡片：
   - "穿着巧克力衬衫的70岁老人" / Planet Money · business / 收藏于 2026-04-09
   - "她用鼻子诊断了一种病" / TED Talks Daily · science / 收藏于 2026-04-10
   - "波本酒局内幕" / Freakonomics Radio · business / 收藏于 2026-04-10

---

## 六、侧滑面板 — 词汇本子页面

新建画板 "Panel — Vocab"，320x844，同样背景。

1. 顶部：← + "词汇本"（同收藏子页面）

2. 统计卡：圆角 12px，背景 `rgba(255,255,255,0.05)`，padding 16px，居中。
   - "已收藏 28 个单词"，16px font-weight 600，`rgba(255,255,255,0.87)`
   - 进度条：距文字下方 12px，高度 4px，圆角 2px，总宽度 100%。分段填充：
     - A1-A2 段：宽度占比按数量，颜色 `rgba(255,255,255,0.87)`（--cefr-a）
     - B1 段：颜色 `#7AAFC4`
     - B2 段：颜色 `#C4A96E`
     - C1 段：颜色 `#C47A6E`
     - C2 段：颜色 `#c97bdb`
   - 进度条下方数字：水平排列，间距等分。"11" (白) "7" (蓝) "5" (黄) "3" (橙) "2" (紫)，每个数字用对应 CEFR 颜色，11px

3. 词汇列表：距统计卡下方 16px，每条间距 0，分隔线 1px `rgba(255,255,255,0.05)`。每条：
   - 第一行：单词（15px bold `rgba(255,255,255,0.87)`）+ CEFR badge（圆角 4px，padding 2px 6px，背景用 CEFR 对应颜色 20% 透明度，文字用 CEFR 颜色，10px font-weight 600）+ 音标（12px `rgba(255,255,255,0.40)`）
   - 第二行：上下文句子，13px `rgba(255,255,255,0.40)`，最多一行，超出省略号

示例 4 条：
   - samurai [B2] /ˈsæmə.raɪ/ — "The samurai set out on a journey..."
   - resilience [C1] /rɪˈzɪl.i.əns/ — "Building resilience in uncertain..."
   - cognitive [B2] /ˈkɒɡ.nɪ.tɪv/ — "The cognitive load of switching..."
   - eloquent [C1] /ˈel.ə.kwənt/ — "She was an eloquent speaker..."

---

## 七、复习卡（Review Card）

新建画板 "Feed Card — Review"，390x844，背景 `#0C0C0E`。

居中布局，所有内容在屏幕中央纵向排列：

1. 图标：刷新/循环图标，32x32，stroke `rgba(255,255,255,0.30)`，居中

2. 标签："QUICK REVIEW"，10px，letter-spacing 0.1em，全大写，`rgba(255,255,255,0.30)`，居中

3. 单词："samurai"，28px，font-weight 700，`rgba(255,255,255,0.87)`，居中

4. 音标 + 释义："/ˈsæmə.raɪ/  n. 武士"，13px，`rgba(255,255,255,0.55)`，居中

5. 上下文提示："3 天前在这个片段里听到："，12px，`rgba(255,255,255,0.30)`，居中，距上方 24px

6. 引用句："\"The samurai Hasekura set out on a journey across the ocean\""，15px italic，`rgba(255,255,255,0.55)`，居中，最大宽度 280px

7. "再听一遍这个句子"按钮：距引用下方 24px，宽度 280px，高度 48px，圆角 24px，背景 `#8B9CF7`，文字"▷ 再听一遍这个句子" 14px font-weight 600 颜色 `#0C0C0E`

8. 底部两个按钮：水平排列，间距 12px，距"再听"按钮下方 16px
   - "记得 ✓"：宽度 134px，高度 44px，圆角 12px，背景 `rgba(255,255,255,0.05)`，边框 1px `rgba(255,255,255,0.08)`，文字 14px `rgba(255,255,255,0.70)`
   - "忘了 ×"：同样样式

---

## 八、进度卡（Progress Card）

新建画板 "Feed Card — Progress"，390x844，背景 `#0C0C0E`。

居中布局：

1. 图标：趋势/图表图标，32x32，stroke `rgba(255,255,255,0.30)`

2. 标签："TODAY'S PROGRESS"，10px，letter-spacing 0.1em，全大写，`rgba(255,255,255,0.30)`

3. 大数字："5 个片段"，36px font-weight 700 `rgba(255,255,255,0.87)` + "个片段" 16px `rgba(255,255,255,0.55)`

4. 副标题："已收听"，13px `rgba(255,255,255,0.30)`

5. 统计行："8 分钟 · 12 新词"，14px `rgba(255,255,255,0.55)`。"12 新词"部分颜色用 `#8B9CF7`（accent），距大数字下方 8px

6. CEFR 进度条：宽度 280px，高度 6px，圆角 3px，距统计行下方 20px。分段和颜色同词汇本里的进度条。下方标注 "A1/A2"（左）"B1"（中偏左）"B2+40%"（右），用对应颜色，10px

7. "继续刷 →"按钮：距进度条下方 32px，宽度 280px，高度 48px，圆角 24px，背景 `#8B9CF7`，文字 14px font-weight 600 颜色 `#0C0C0E`

---

## 九、推荐调整卡（Recommendation Card）

新建画板 "Feed Card — Recommendation"，390x844，背景 `#0C0C0E`。

居中布局：

1. 图标：设置/齿轮图标，32x32，stroke `rgba(255,255,255,0.30)`

2. 标签："WE NOTICED"，10px，letter-spacing 0.1em，全大写，`rgba(255,255,255,0.30)`

3. 提示文字："你最近收藏了很多\n科技类内容"，18px font-weight 600，`rgba(255,255,255,0.87)`，居中，行高 1.4

4. 标签展示：距提示文字下方 20px，水平排列，间距 8px，居中。展示用户偏好相关的 topic 标签：
   - 选中态标签（如 "🔬 Science"）：圆角 20px，padding 8px 16px，边框 1px `#8B9CF7`，背景 `rgba(139,156,247,0.12)`，文字 13px `rgba(255,255,255,0.87)`
   - 普通标签（如 "💼 Business"、"🧠 Psychology"、"🎭 Culture"）：同样形状但边框 `rgba(255,255,255,0.08)`，背景 `rgba(255,255,255,0.05)`，文字 `rgba(255,255,255,0.55)`

5. 问题："要多推一些科技内容吗？"，13px，`rgba(255,255,255,0.40)`，距标签下方 20px

6. 两个按钮：水平排列，间距 12px
   - "好的 👍"：宽度 140px，高度 44px，圆角 12px，背景 `#8B9CF7`，文字 14px font-weight 600 颜色 `#0C0C0E`
   - "保持现状"：同尺寸，背景 `rgba(255,255,255,0.05)`，边框 1px `rgba(255,255,255,0.08)`，文字 `rgba(255,255,255,0.70)`

---

## 十、刷完总结卡（End Summary Card）

复制 "Feed Card — Progress" 画板，命名为 "Feed Card — End Summary"。

修改：
- 标签改为 "SESSION COMPLETE"
- 大数字上方加一行："今天的内容听完了"，16px font-weight 500，`rgba(255,255,255,0.55)`
- 按钮文字改为 "再刷一轮 ↻"
- 其他数据和样式不变
