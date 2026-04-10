# PRD：内容个性化与冷库策略（v0.6）

**作者**：Sylvia + Claude
**日期**：2026-04-08
**前置文档**：PRD-listening-demo-v0.5.md、AGENT-podcast-processor.md
**状态**：待 Sylvia 审查

---

## 1. 背景与问题

当前 demo 存在三个结构性问题：

1. **兴趣选择形同虚设**：Onboarding 让用户选兴趣，但前端 `clips.forEach()` 全量渲染，所有人看到同样的 15 个 clip。用户选了 science 和 tech，刷到的第一条可能是 business。
2. **内容分布严重倾斜**：8 个兴趣标签，business 有 5 个 clip，culture 和 society 各 0 个。用户选了 culture 等于选了个空。
3. **内容总量不足**：15 个 clip 刷完就没了，离"无限流"体验差距太大。

---

## 2. 改动清单

### 2.1 Onboarding：强制选 3 个兴趣

**现状**：用户选至少 2 个兴趣即可开始。

**改为**：强制选恰好 3 个兴趣。

理由：
- 3 个兴趣 × 5 个冷库 clip = 15 个，首屏体验有保障
- 比"至少 2 个"更可预测，简化冷库备货逻辑
- 比"3-5 个"更约束，避免用户全选导致个性化失效

前端改动点：
- `startBtn` 的启用条件从 `selectedTags.size >= 2` 改为 `selectedTags.size === 3`
- 按钮文案可以加提示："选择 3 个你感兴趣的领域"
- 选满 3 个后继续点击其他标签时，先取消最早选的一个（或直接禁止多选）

### 2.2 前端过滤逻辑

**现状**：`clips.forEach()` 遍历 data.json 所有 clip，全量渲染。

**改为**：读取 localStorage 中的 `listenLeapInterests`，只渲染 tag 匹配的 clip。

逻辑伪代码：
```
interests = JSON.parse(localStorage.getItem('listenLeapInterests'))
filteredClips = clips.filter(clip => interests.includes(clip.tag.toLowerCase()))
filteredClips.forEach(clip => renderScreen(clip))
```

注意事项：
- tag 匹配需要大小写统一（data.json 里是 "Business"，localStorage 里是 "business"）
- 如果过滤后 clip 数为 0（极端情况），fallback 到全量展示
- 过滤发生在 `buildScreens()` 阶段，不影响已有的播放逻辑

### 2.3 冷库策略：8 兴趣 × 5 clip

**目标**：为每个兴趣标签预备至少 5 个 clip 作为冷启动库存。

当前库存盘点：

| 兴趣标签 | 现有 clip 数 | 需补充 | iTunes 搜索关键词建议 |
|---|---|---|---|
| science | 2 | 3 | 按 iTunes 热度取 top |
| business | 5 | 0 | — |
| psychology | 2 | 3 | 按 iTunes 热度取 top |
| story | 3（含原 Storytelling） | 2 | 按 iTunes 热度取 top |
| history | 1 | 4 | 按 iTunes 热度取 top |
| culture | 0 | 5 | 按 iTunes 热度取 top |
| tech | 2 | 3 | 按 iTunes 热度取 top |
| society | 0 | 5 | 按 iTunes 热度取 top |

*Storytelling（clip 9, 14）已合并到 story 标签下。关键词策略：直接用标签名搜 iTunes，按评分/评论数排序，不预判子话题。

**总计需新增约 25 个 clip。** 按当前 agent 性能（5 clip / 10 分钟），约需 50 分钟。

### 2.4 推荐流排序逻辑

不做机械轮转（ABCABC 太容易被感知到规律）。目标是有节奏感但不可预测，类似抖音的推荐手感。

规则：
1. **主兴趣沉浸 + 切换**：允许同一兴趣连续出现 2 条（制造沉浸感），然后切换到另一个兴趣。模式类似 AABCBBAC，而不是严格 ABCABC。
2. **同兴趣内随机**：同一兴趣的 clip 随机排列，每次刷新不同。
3. **探索性插入**：每 6-8 条中插入 1 条用户未选择的兴趣（D 或 E），用来做兴趣探索。如果用户没有跳过，说明这个方向可以扩展推荐范围。探索内容从其他 5 个非选择兴趣中随机挑选。
4. **热库追加**：processor agent 新产出的 clip 进入对应兴趣的队列，参与上述排序逻辑（不是简单追加到末尾）。

前端实现思路：构建一个 playlist 数组，按上述规则从各兴趣的 clip 池中抽取排列，一次性生成完整播放序列。

### 2.5 删除结束页面

当前的结束浮层（"今天的内容听完了" + 收听时长 + 重新播放按钮）是素材不足的临时设计，直接删除。

刷完最后一条后什么都不弹，停在最后一条即可。用户想回刷就往上滑，想退出就退出。等冷库和热库内容充足后，用户刷不完，"结束"这个状态自然不存在。

前端改动：删除 `#end-overlay` 相关的 HTML、CSS 和 JS（`showEndScreen()`、`endReplay` 事件监听）。

### 2.5 data.json tag 标准化

现有 tag 值不统一（"Business" vs "Storytelling"），需要标准化为 8 个固定值：

```
science, business, psychology, story, history, culture, tech, society
```

全部小写，与 onboarding 的 `data-tag` 值一致。现有 data.json 需要一次性迁移。

---

## 3. 从 websearch skill 借鉴的设计思路

审阅了 websearch 项目的 web-material-recommender skill，以下几个模式值得借鉴：

### 3.1 分层源优先级（Source Tier Policy）

websearch 把内容源分为 A-primary、A-fallback、B-tier 三层，检索时按优先级逐层填充。

**借鉴到 podcast agent**：
- A-primary：已验证出过高质量 clip 的播客 feed（如 Planet Money、Radiolab）
- A-fallback：iTunes 搜索排名靠前但未验证的 feed
- B-tier：用户手动指定的 feed URL

优先从 A-primary 取材，不够时降级。这需要维护一个已验证 feed 的白名单，可以在 agent 每次成功产出后自动更新。

### 3.2 Motivation-first 检索策略

websearch 把用户动机作为主要检索信号（权重 0.8），兴趣只是次要修饰（权重 0.2）。

**对我们的启发**：当前 agent 是纯 keyword 搜索，没有区分用户为什么学英语和对什么感兴趣。短期不需要做这个区分（demo 只有兴趣维度），但长期如果加入动机维度（如"职场英语"vs"旅行英语"），应该动机优先。

### 3.3 去重与标准化

websearch 做了 canonical URL normalization + 去重。对应到我们：
- **feed URL 去重**：iTunes 搜索同一关键词可能返回同一播客，用 feed URL 去重
- **episode 去重**：同一 episode 可能从不同 feed 出现，用 episode guid 或 audio URL 去重
- **clip 语义去重**：不同 episode 可能讲类似内容，长期需要语义去重（短期暂不做）

### 3.4 Partial Success 策略

websearch 允许部分成功（目标 4 个，拿到 2-3 个也算成功）。

**借鉴**：agent 设定每个兴趣 5 个 clip 的目标，但如果某次只产出 3 个，不应该标记为失败。记录 partial_success，后续再补。

### 3.5 Failure Telemetry

websearch 记录每次失败的 `host + round + reason`。

**借鉴到 agent 日志**：agent 每次失败应记录 `feed_url + step + reason`，方便后续分析哪些 feed 经常出问题（如音频下载超时、Whisper 转录质量差）。

---

## 4. 不做的事（明确排除）

- 不做 CEFR 水平过滤（用户选了等级但暂不用于内容筛选，留给 v0.7）
- 不做实时个性化推荐算法（冷库 + 简单过滤够用）
- 不做用户行为反馈闭环（收藏/点赞影响推荐，留给后期）
- 不改变 data.json 的整体结构（只标准化 tag 值）

---

## 5. 实施顺序

| 优先级 | 任务 | 依赖 | 预估耗时 |
|---|---|---|---|
| P0 | data.json tag 标准化 | 无 | 10 分钟 |
| P0 | 前端过滤逻辑 | tag 标准化完成 | 30 分钟 |
| P0 | Onboarding 改为强制 3 个 | 无 | 15 分钟 |
| P1 | 补充冷库 clip（25 个） | agent 稳定运行 | 50 分钟 agent 时间 |
| P1 | 推荐流排序逻辑（轮转） | 过滤逻辑完成 | 30 分钟 |
| P2 | agent 加去重逻辑 | 无 | 30 分钟 |
| P2 | agent 加 feed 白名单 | 去重完成 | 20 分钟 |

---

## 6. 验收标准

- [ ] 用户选择 3 个兴趣后，只看到对应 tag 的 clip
- [ ] 每个兴趣至少 5 个 clip 可用
- [ ] 相邻 clip 的兴趣标签不重复（轮转生效）
- [ ] data.json 所有 tag 值为 8 个标准值之一
- [ ] 选不满 3 个时无法进入主界面
