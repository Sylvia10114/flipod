# Flipod v3 · QA Report · Round 1

> 2026-04-17 · Jamesvd + Claude Cowork
> Scope: v3 MVP 端到端首轮视觉 + 交互 QA
> 环境: dev server (localhost:8080) + cloudflared tunnel (quick tunnel, http2)
> Mock 用户: B1 · interests=[business, psychology, science] · 8 词 vocab · 无 practice state
> **修复决策: Pencil 视觉不精修 (UI 质量已达标); ENV-only bug 记入 handoff backup; 只修产品/数据/教学逻辑层的 9 条**

---

## Executive Summary

**v3 MVP 骨架已经成型、大方向对。** 纯听 Tab、四遍训练流、Review 页的信息结构和认知科学基础都站得住, Priming (Task G) 的视觉实现甚至超预期。44 个 observation 去重后 **43 bug** (B31 撤回)。按"是否会在 TF RN 版复现"和"是否影响功能"双维度切片:

- **🔨 打包前必修 · 9 条**: 产品/数据/教学逻辑 bug, Code 可做, 不需 Pencil
- **🔒 Handoff backup: ENV-only · 7 条**: 测试环境特有 (tunnel / web DOM 残留), RN 重写不会复现, TF 上如出现再处理
- **🎨 Handoff backup: Visual polish · 14 条**: 纯 UI 优化点, 已决定 skip, 作为 RN 团队设计参考
- **❓ 待下轮验证 · 4 条**

---

## 1 · 本轮 QA 环境

| 项 | 值 |
|---|---|
| Dev server | `bash scripts/serve.sh`, node on :8080, 含 `/api/rank` + `/api/tts` |
| Tunnel | `cloudflared --protocol http2`, quick tunnel |
| Tunnel URL | `https://proud-area-ordered-door.trycloudflare.com` (每次新建) |
| 前端实际路径 | `/data.json` (200) / `/listening-practice.js` (200) |
| 数据集 | data.json 含 76 clips, `hasPriming: true` |
| 浏览器 | Chrome, DevTools mobile emulation 430×932 |
| Mock 用户 | B1, interests=[business, psychology, science], 8 词 vocab |

---

## 2 · 🔨 打包前必修 · 9 条 (Code 本轮动)

这 9 条是**产品/数据/教学逻辑层**的 bug, 在 TF RN 版上也会复现, 必须在打包前修掉。全部由 Claude Code 执行, 不需要 Pencil 精修视觉。

### P0 · 2 条

| ID | 标题 | Fix 要点 |
|---|---|---|
| **B36** | priming 把 A2 词当高难词 (`couple A2` 进了 Pass 2/3 加粗 + Review) | 改 `generate_priming` 过滤条件为 `cefr NOT IN {A1, A2}` 或 `cefr >= user_level + 1` (取更严格) |
| **B41** | Review MCQ 可跳过 ("返回列表"无阻止) | 未答 MCQ 时 "返回列表" 置灰; 或允许跳过但不 mark "已完成" |

### P1 教学逻辑 · 7 条

| ID | 标题 | Fix 要点 |
|---|---|---|
| **B11** | priming 选词精度 (`scroll` B1 日常词也进了 priming) | 同 B36, 一次改 generate_priming |
| **B16** | 3 收藏 → 只生成 2 practice, 第 3 条去哪了无反馈 | 查 logs + 补 practice 状态机 `pending / generating / failed / ready` |
| **B17** | 练习卡片 meta 都是 `general · B1` (无具体 topic) | Task F prompt 加 `category` 字段; 前端读 category 替换 fallback |
| **B18** | 练习 Tab 缺 generating / locked 三态反馈 | 加极简 skeleton + "AI 正在给你生成..." 文字 |
| **B33** | 点 priming 单词无反应 (Pass 2/3 看三遍还不会时无救生阀) | 极简 tooltip 弹词典条目 (`financial /fɪˈnænʃ(ə)l/ 财务的`) |
| **B37** | MCQ 只有 3 选项 (标准 4选1, 3选1 盲猜正确率 33%) | Task F prompt 改为 4 个选项 + 1 正确 + 3 似是而非 distractor |
| **B38** | Review "本次练习词汇" 只列 priming 3 词 (和 priming zone 完全重复) | 改 Review 逻辑: 列 clip 里**所有** `cefr >= user_level` 的词 |

### 工作分发

- **Code 开发单一份**: `prompts for Claude/CC-BRIEF-addendum-round-1-fixes.md`
- **Brief 修订 3 份** (Jamesvd 写):
  - `CC-BRIEF-TaskD-rate-injection-correction.md` → 修 B28 (见 §3)
  - `CC-BRIEF-TaskF-prompt-amendments.md` → 修 B17/B37/B38
  - (Task G 选词条件直接在 Round-1-fixes 里覆盖)

---

## 3 · 🔒 Handoff Backup: ENV-only · 7 条 (不修, 记档)

这些 bug **只在当前 web dev + cloudflared tunnel 环境下出现**, AI 算法团队用 RN 重写时不会 carry over。打包前不处理, 但必须写进 handoff readme 的 "Known Issues - Environment Specific" 段, TF 上如果仍然出现再重新 triage。

| ID | Bug | 为什么 TF 上不会出现 | 但 spec 必须写清 |
|---|---|---|---|
| **B1** | 前端残留请求 `/output/data.json` 返回 404 | RN 数据层会全重写, 不会复刻 web 的硬编码路径 | — |
| **B2** | `/clips/*.mp3` 530 偶发 + 文件命名 `clip_001.mp3` vs `clip1.mp3` 双方案 | tunnel flaky, CDN 上不发生; 命名要算法团队统一 (建议 `clip_NNN.mp3`) | 命名方案统一写 spec |
| **B3** | `/api/rank` 返回 HTTP 530 | tunnel 或 handler 问题, RN 重写 endpoint | 同 B28 如果是 handler 问题, spec 要讲 |
| **B4** | 纯听 Tab 左上角孤立短横线 (无 label 无功能) | web DOM/CSS 残留, RN View 重搭不会有 | — |
| **B9** | Cloudflared tunnel 稳定性偶发断 | 纯 dev 工具 | — |
| **B28** | Pass 1 audio 速率 1.0x 而非 0.85x (CEFR rate 注入未生效) | brief 里 rate 注入路径写错了, RN 如照 spec 正确实现则不复现 | **⚠️ spec 必须写对 TTS rate 路径** (见 §3.1) |
| **B29** | `/api/practice/generate` 从未被调用 (练习走 mock) | web demo 未接通, RN 如照 spec 实现则走真生成 | **⚠️ spec 必须讲清 endpoint 调用时机** (见 §3.2) |

### 3.1 · B28 特别注记: TTS Rate 注入 (写进 Task D feature-spec)

**错误路径** (web demo 现用, 不生效):
```js
audio.playbackRate = 0.85  // 练习 Tab 根本没有 <audio> 元素
```

**正确路径** (feature-spec 必须写):
```js
// 方案 A: Web Speech API (最简单)
const utterance = new SpeechSynthesisUtterance(text);
utterance.rate = cefrRate;  // 0.85 (B1 Pass 1) ~ 1.00 (Pass 3+)
speechSynthesis.speak(utterance);

// 方案 B: /api/tts 后端 TTS (质量更高)
fetch('/api/tts', {
  method: 'POST',
  body: JSON.stringify({ text, voice: 'alloy', speed: cefrRate })  // OpenAI/Azure TTS 支持 speed 参数
})

// RN 上用 react-native-tts 或 Expo TTS, 都支持 rate 参数
```

**CEFR Rate 映射表** (不变):
| Level | Pass 1 | Pass 2 | Pass 3 | Pass 4 |
|---|---|---|---|---|
| A1 | 0.70 | 0.80 | 0.90 | 0.90 |
| A2 | 0.80 | 0.88 | 0.96 | 1.00 |
| B1 | 0.85 | 0.94 | 1.00 | 1.00 |
| B2 | 0.90 | 1.00 | 1.00 | 1.00 |
| C1+ | 1.00 | 1.00 | 1.00 | 1.00 |

### 3.2 · B29 特别注记: Task F Endpoint 调用 (写进 Task F feature-spec)

**触发时机**:
用户 bookmark 一条 clip → 后端 debounce 3s → POST `/api/practice/generate`

**Request body**:
```json
{
  "clip_id": "clip_042",
  "user_level": "B1",
  "user_interests": ["business","psychology","science"],
  "user_vocab_seen": ["framework","resilience",...]  
}
```

**Response shape** (LLM 必须按此返回):
```json
{
  "title": "心理与金钱",
  "category": "psychology",       
  "cefr": "B1",
  "passages": [
    {"en": "So today, I wanna...", "zh": "今天我想..."},
    ...
  ],
  "mcq": {
    "q": "What is the main point of this passage?",
    "options": ["...", "...", "...", "..."],   
    "correct": 2,
    "explanation": "因为文章主要在讨论财务压力与心理平衡..."
  },
  "vocab": [
    {"word": "financial", "cefr": "B1", "zh": "财务的", "ipa": "/fɪˈnænʃ(ə)l/"},
    ...   
  ],
  "version": "v3.0.0"
}
```

---

## 4 · 🎨 Handoff Backup: Visual Polish · 14 条 (不修, 给 RN 团队作设计参考)

决定 skip Pencil 精修。以下 14 条记入 handoff readme 的 "Design Polish Opportunities" 段, RN 团队设计阶段可参考 (不强制)。

| ID | 标题 | 属性 |
|---|---|---|
| B5 | 纯听 Tab 首屏 "Tap to begin" 距 headline 300px+ 空白 | 布局 |
| B12 | Like/bookmark icon 垂直堆右侧中段, 大拇指够不到 | 布局/人机 |
| B13 | 字幕下方灰色 placeholder 条 与 priming zone 同色易误读 | 颜色 |
| B15 | 👁️ eye icon 未激活态无 tooltip/label | 交互 |
| B19 | 练习卡片信息过单薄 (无时长/重点词数/Pass 进度) | 信息密度 |
| B20 | 练习 Tab 首次进入缺 onboarding hint | 文案 |
| B24 | 练习态无 audio 进度 / duration | 信息 |
| B25 | Pass 指示语位置在播放按钮下方小字 | 布局 |
| B26 | Pass 四圆点进度对比度低 | 颜色 |
| B27 | Pass 1/2 未激活句灰度不够淡 | 颜色 |
| B34 | Pass 页面无速率指示 (用户感知不到"渐进") | 信息 |
| B39 | "回看文本" tap 展开中文无视觉 affordance | 交互 |
| B40 | MCQ 无解析 (答对/错都没反馈) | 教学逻辑 (部分, 本轮归视觉 polish) |
| B42 | 难度 chip (太简单/正合适/有点难) 无选中态反馈 | 交互 |

---

## 5 · ❓ 待下轮验证 · 4 条

| ID | 问题 | 在 Round 2 QA 验 |
|---|---|---|
| B32 | Pass 2 紫色加粗的 3 词是"生词提示"设计还是 karaoke bug? | 开发代码确认 + Round 2 跑一遍看同一组词是否每次都相同 |
| B43 | Review "回看文本"句数是否和 Pass 2/3 一致? | Round 2 scroll 到底看完整 |
| Q1 | 切回纯听 Tab 后, 上下滑动能刷新下一条 clip 吗? | Round 2 手势验证 |
| Q2 | 完成一个练习后, 练习 Tab 卡片有无"已完成"态? | Round 2 完整走完一次 |
| Q3 | 选"有点难"难度反馈后, 下次生成是否降级? | Round 2 + 数据观察 |

---

## 6 · ✅ Green List · 本轮已验证可用 (14 项, 作为回归锚点)

1. Dev server + tunnel 链路
2. `/data.json` 76 clips 加载 (`hasPriming: true`)
3. Tab 切换 (纯听 ↔ 练习) 下划线 + 状态保持
4. Clip card 基础渲染: title / source / transcript / karaoke / 进度条 / 播放控件
5. Priming zone 渲染 + 内容 (🎯 icon + 3 词 + 英中对译, display: block visible)
6. 四遍训练状态机: Pass 1→2→3→4 页面切换, 进度圆点更新
7. Pass 1 全中字幕 (英文 audio + 中文字幕, 当前句高亮)
8. Pass 2 全英字幕 + 生词加粗
9. Pass 3 渐隐字幕 (功能词 fade, 内容词保留, priming 词穿透)
10. Pass 4 盲听 + 声波动画
11. Review 页四闭环: MCQ + 回看文本 + 本次词汇 + 难度反馈
12. 回看文本 tap 句子展开中文 (交互 work, affordance 差 = B39)
13. 练习内容根据用户兴趣生成 (psychology → "心理与金钱") - **走 mock, 非真 AI**
14. CEFR 标签展示 (带 `B1` / `A2` tag) - 展示 work, 选词逻辑错 = B36

---

## 7 · 基线截图集 · 8 张

编号对应本轮 QA 跑位, 作为 v3 首轮视觉基线, 用于 Round 2+ 回归对比。

| # | 场景 | ⭐ 关键发现 |
|---|---|---|
| 01 | 纯听 Tab · 首屏 (Tap to begin 态) | B4 短线, B5 间距 |
| 02 | 纯听 Tab · 播放中 · Priming zone 可见 | ⭐ B11 选词, B12 icon 位置, B13 placeholder 色 |
| 03 | 练习 Tab · ready 态 (2 张卡) | B16 3→2, B17 general tag, B18 无三态 |
| 04 | 练习 · Pass 1 全中 | ⭐ B28 rate 未生效 |
| 05 | 练习 · Pass 2 全英 | B32 生词加粗待验 |
| 06 | 练习 · Pass 3 渐隐 | ⭐ B33 单词点击无反应 |
| 07 | 练习 · Pass 4 盲听 | (无新 bug, 最干净) |
| 08 | 练习 · Review 页 | ⭐ B36 couple A2, B37 3选1, B38, B39, B40, B41 |

---

## 8 · 下一步流水线

```
本轮 QA ✅
  ↓
📄 3 份 brief 分发给 Claude Code
  - CC-BRIEF-addendum-round-1-fixes.md          (9 条必修 bug)
  - CC-BRIEF-TaskD-rate-injection-correction.md (仅 spec 层, 不动 web demo 代码)
  - CC-BRIEF-TaskF-prompt-amendments.md         (改 prompt + 修 B17/B37/B38)
  ↓
Code 本地跑完 → tunnel 起 → Round 2 QA
  ↓
Round 2 清零 (9 必修全过 + 4 待验证无惊喜) 
  ↓
打包 Direction A: 独立 repo + feature-spec 文件夹
  - /features/priming/        含 Task G + B36 修正说明
  - /features/four-pass/      含 Task D + TTS rate 正确写法 (§3.1)
  - /features/practice-gen/   含 Task F + endpoint 调用时机 (§3.2)
  - /features/cefr-tagging/   含 Task C
  - /docs/FLIPOD-PRD.md
  - /docs/QA-report-v3-round-N.md 含 §3 §4 backup
  - /README.md
  ↓
Push GitHub (新 repo)
  ↓
AI 算法团队读 spec → RN 重写 → 打包 TestFlight
  ↓
TF 上做 Round N+1 QA (真 iOS 设备, 非 Chrome emulation)
  ↓
ENV-only bug 在 TF 上如复现则重新 triage
Polish bug 是否上 Round N+2 由 AI 团队 + 我商定
```

---

## 附录 A · 路径与环境速查

```
Dev server log:   /tmp/flipod-dev-server.log
Tunnel log:       /tmp/flipod-tunnel.log
Dev server PID:   用 lsof -i:8080 查
Cloudflared bin:  /opt/homebrew/bin/cloudflared
ffmpeg:           /opt/homebrew/bin/ffmpeg
Clips 目录:        output/clips/ (clip_001.mp3 式) + clips/ (clip1.mp3 式 - 待统一)
数据文件:          output/data.json (前端实际读 /data.json)
CEFR 表:          CEFR-J + Octanove C1/C2 (~8650 词, CC BY-SA 4.0)
Python SSL 踩坑:   macOS 3.9 SSL 失败, 所有 HTTP 走 curl subprocess
Azure 环境变量:    AZURE_API_KEY, AZURE_ENDPOINT (或 AZURE_OPENAI_* 变体)
```

## 附录 B · Mock 用户注入脚本 (Round 2+ 复用)

```js
localStorage.setItem('flipodLevel', 'B1');
localStorage.setItem('flipodInterests', JSON.stringify(['business','psychology','science']));
localStorage.setItem('onboardingDone', 'true');
localStorage.setItem('flipodTheme', 'light');
localStorage.setItem('flipodLeftHand', 'false');
localStorage.setItem('flipodSpeed', '1.0');
localStorage.setItem('flipodVocab', JSON.stringify([
  {word:'nevertheless', cefr:'B2', addedAt:Date.now()-86400000*3},
  {word:'whenever',     cefr:'B1', addedAt:Date.now()-86400000*5},
  {word:'framework',    cefr:'B2', addedAt:Date.now()-86400000*1},
  {word:'resilience',   cefr:'C1', addedAt:Date.now()-86400000*2},
  {word:'mitigate',     cefr:'C1', addedAt:Date.now()-86400000*7},
  {word:'cognitive',    cefr:'B2', addedAt:Date.now()-86400000*4},
  {word:'ambiguous',    cefr:'C1', addedAt:Date.now()-86400000*1},
  {word:'hypothesis',   cefr:'B2', addedAt:Date.now()-86400000*6},
]));
localStorage.setItem('flipodLikedClips', '[]');
localStorage.setItem('flipodListenedClips', '[]');
localStorage.setItem('flipodBookmarks', '[]');
localStorage.removeItem('flipodPracticeState');
location.reload();
```
