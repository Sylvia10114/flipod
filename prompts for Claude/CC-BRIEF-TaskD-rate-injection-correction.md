# Claude Code Brief · Task D · Rate 注入修正（B28）

> 2026-04-17 · Jamesvd · Task D 合并后 Round 1 QA 复查，CEFR 适配表里"TTS rate"这一栏**没真的生效**——Pass 1 B1 应该 0.85x 实际听起来是 1.0x。根因是原 brief 里给的实现路径（`audio.playbackRate`）在 v3 代码里**不存在可作用的 `<audio>` 元素**。这份 brief 修正 B28。

---

## 背景与复盘

原 Task D brief（`CC-BRIEF-task-DE-adaptation-and-ui.md` 第 50-64 行）写的是：

```js
// 在 _renderPass 创建 <audio> 之后
audio.playbackRate = userAdapt.rate;
audio.preservesPitch = true;
```

QA 期间在 DevTools Console 跑了：

```js
document.querySelectorAll('audio, video')   // → []
```

**练习 Tab 的四关训练全程没有 `<audio>` 元素**。TTS 走的是两条路径：

1. **浏览器 Web Speech API**（`speechSynthesis.speak(new SpeechSynthesisUtterance(text))`）——零网络延迟，走系统 TTS
2. **后端 `/api/tts` 端点**——返回 MP3 流，前端可以 `new Audio(blobURL)` 或用 `fetch` 后 `decodeAudioData` + WebAudio 播放

两条路径在 v3 代码里具体走哪一条取决于 `listening-practice.js` 的实际实现——brief 作者当时默认假设是 `<audio>` 元素，错了。

**结果**：`audio.playbackRate = userAdapt.rate` 这行代码根本没跑过，或者作用在了不播音频的 `<audio>`（比如 header 里那个 mute 的元素）上，rate 相当于没注入。

---

## 正确的 Rate 注入路径

先用 Read tool 看 `listening-practice.js` 的 TTS 实现，确认走的是哪条。然后按下面对应的方案改。

### 方案 A · Web Speech API (speechSynthesis)

如果代码里有 `new SpeechSynthesisUtterance(...)` 或 `speechSynthesis.speak(...)`：

```js
// speakText 或等价函数
function speakText(text, opts = {}) {
  const adapt = clampLevel(getUserCefrLevel());
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = opts.rateOverride || adapt.rate;  // ← 这里注入
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  // 如果需要指定 voice：
  const voices = speechSynthesis.getVoices();
  const en = voices.find(v => v.lang.startsWith('en-') && v.name.includes('Samantha'))
          || voices.find(v => v.lang.startsWith('en-'));
  if (en) utterance.voice = en;
  speechSynthesis.cancel();  // 打断前一句
  speechSynthesis.speak(utterance);
  return utterance;
}
```

**Web Speech `rate` 值域**：`0.1 - 10`，`1.0` = normal。浏览器端实现品质差异较大：
- macOS Safari / Chrome 用系统 voices → 大概在 0.7-1.5 范围效果自然
- 低于 0.7 会出现"拖长音"，CEFR 适配表里 A1 的 0.70 可能听起来有些不自然——可接受，因为这是 A1 学习者需要的速度

**CLAUDE.md 踩坑提示**：Web Speech API 在 iOS Safari 上**首次调用必须在用户手势里触发**（click/tap），否则静默失败。Pass 1 入场如果是自动开播，需要在"开始训练"按钮点击时 prime 一次（`speechSynthesis.speak(new SpeechSynthesisUtterance(''))` 喂个空串），后续播放才能跑。

### 方案 B · `/api/tts` 端点

如果代码里是 `fetch('/api/tts', ...)` 然后 `new Audio(...)` 或 `decodeAudioData`：

**B.1 服务端支持 speed 参数**（OpenAI TTS `tts-1-hd` 支持 `speed: 0.25 - 4.0`）：

```js
// 前端
async function ttsFetch(text, opts = {}) {
  const adapt = clampLevel(getUserCefrLevel());
  const rate = opts.rateOverride || adapt.rate;
  const resp = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: opts.voice || 'alloy',
      speed: rate,                // ← 这里注入
      cache_key: `${text}|${opts.voice || 'alloy'}|${rate}`,  // 缓存键带 rate
    }),
  });
  if (!resp.ok) throw new Error('tts ' + resp.status);
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}
```

**服务端**（`server/dev_server.js` 的 `/api/tts`）：

```js
// 收到 speed 参数后透传给 OpenAI
const body = {
  model: 'tts-1-hd',
  input: text,
  voice: voice,
  speed: Number(speed) || 1.0,  // 范围裁剪
};
// ... fetch Azure OpenAI TTS endpoint
```

**缓存键必须包含 rate**——否则 B1 生成的 0.94x 文件会被 C1 用户当作 1.0x 读走。

**B.2 服务端不支持 speed，前端 `<audio>` 变速**（兜底）：

```js
async function playTts(text, opts = {}) {
  const adapt = clampLevel(getUserCefrLevel());
  const url = await ttsFetch(text, opts);  // 服务端 1.0x
  const audio = new Audio(url);
  audio.playbackRate = opts.rateOverride || adapt.rate;
  audio.preservesPitch = true;  // 变速不变调
  await audio.play();
  return audio;
}
```

**preservesPitch**（Safari/Chrome 通用）必须开，否则 0.85x 听起来像慢慢说的大叔，不是标准朗读。

### 方案 C · WebAudio（`decodeAudioData`）

如果代码用 WebAudio `AudioBufferSourceNode`：

```js
source.playbackRate.value = adapt.rate;
// WebAudio 没有 preservesPitch——变速会同时变调
// 如果要保持音调，需要用 SoundTouch / RubberBand.js 这类库
```

**不推荐方案 C**——WebAudio 变速会改音调，对语言学习者不友好。若当前代码走这条，建议改为方案 B.2（用 `<audio>` 配合 `preservesPitch`）。

---

## 每 Pass 的 rate 来源

PRD 里 rate 是"用户档位 × Pass 档位"的组合。CEFR 适配表给的是一个 **baseline**（大致是 Pass 1 的速度），Pass 2/3/4 需要在此基础上递增。

### CEFR × Pass 速率矩阵（新）

| Level | Pass 1 | Pass 2 | Pass 3 | Pass 4 |
|-------|--------|--------|--------|--------|
| A1    | 0.70   | 0.80   | 0.90   | 0.90   |
| A2    | 0.80   | 0.88   | 0.96   | 1.00   |
| B1    | 0.85   | 0.94   | 1.00   | 1.00   |
| B2    | 0.90   | 1.00   | 1.00   | 1.00   |
| C1+   | 1.00   | 1.00   | 1.00   | 1.00   |

（Pass 4 不超过 1.00，因为 Pass 4 是盲听 + MCQ，速度太快会干扰理解。PRD 第八章里 C1 的 1.05 是 Pass 1 的 baseline，后续 Pass 不应该再超，否则学习曲线不对。）

### 实现

```js
const CEFR_PASS_RATE = {
  A1: { 1: 0.70, 2: 0.80, 3: 0.90, 4: 0.90 },
  A2: { 1: 0.80, 2: 0.88, 3: 0.96, 4: 1.00 },
  B1: { 1: 0.85, 2: 0.94, 3: 1.00, 4: 1.00 },
  B2: { 1: 0.90, 2: 1.00, 3: 1.00, 4: 1.00 },
  C1: { 1: 1.00, 2: 1.00, 3: 1.00, 4: 1.00 },
};

function getPassRate(passNum) {
  const level = String(getUserCefrLevel() || 'B1').toUpperCase();
  const row = CEFR_PASS_RATE[level] || CEFR_PASS_RATE.B1;
  return row[passNum] || 1.0;
}
```

**注**：把 `CEFR_ADAPTATION.rate` 这一列从原来的 Task D 表里**删掉**，替换为调用 `getPassRate(passNum)`——原来 `CEFR_ADAPTATION` 只是一个单数字 rate，现在升级为 pass-aware 矩阵。其他字段（`reviewCount` / `fadeDensity` / `maxReplay`）保留。

### 在 `_renderPass` 里使用

```js
function _renderPass(passNum, practice) {
  const rate = getPassRate(passNum);
  // ... 渲染 UI ...
  playTts(currentSentence, { rateOverride: rate });
  // 或 speakText(currentSentence, { rateOverride: rate })
}
```

---

## 校验（必跑）

**手测脚本**（DevTools Console）：

```js
// 强制切 A2，进 Pass 1
localStorage.setItem('flipodLevel', 'A2');
location.reload();
// 进练习 Tab → 开始任意练习 → Pass 1
// 肉眼/肉耳听：明显比 B1 Pass 1 慢（0.80 vs 0.85，差别小但能听出）
```

**可见性埋点**——在 speakText / playTts 里 `console.log('[tts]', { pass, level, rate, text })` 临时加，看控制台是否每次播放都打印对应 rate；QA 通过后移掉 console.log 但保留 track 埋点：

```js
track('tts.played', { pass: passNum, user_cefr: level, rate, text_length: text.length });
```

### 验收矩阵

| 场景 | 预期 rate | 预期现象 |
|------|---------|--------|
| A1 用户 Pass 1 | 0.70 | 明显慢，几乎一个词一个词 |
| B1 用户 Pass 1 | 0.85 | 慢但自然 |
| B1 用户 Pass 2 | 0.94 | 接近正常 |
| B1 用户 Pass 3 | 1.00 | 正常语速 |
| C1 用户 Pass 1 | 1.00 | 正常语速 |
| B1 用户切 A1 | 0.70 | 重新开 Pass 1 后立刻变慢 |

console 的 track 日志应该和矩阵完全对上。

---

## 边界与注意

- **preservesPitch** 必开（方案 B.2 和方案 A 不涉及此属性——Web Speech 自带 pitch 独立控制）
- **缓存键必须带 rate**（方案 B.1）——否则不同用户互相污染缓存
- **A1/A2 的 0.70 / 0.80 在某些 voice 下会有嘶嘶底噪**——可接受，或给 A1 用户单独挑 voice（P2 再做）
- **iOS Safari 首次播放必须在用户手势里**（方案 A）——在"开始训练"按钮点击时 prime 一次
- **Pass 4 一律 ≤ 1.00**——即使 C1 用户，盲听速度别再加速
- **不要在 CSS transition 里做 rate 渐变**——rate 是音频属性不是 CSS 属性

---

## 非目标

- 不改 TTS 模型选择（`tts-1-hd` / `alloy` 保持）
- 不做用户手动微调 rate 的 UI（P2）
- 不做 rate × Pass 的插值（硬表查找即可，不需要线性插值）
- 不做缓存清理——旧的 1.0x 缓存放那儿没关系，只要新键不冲突
- 不动 CEFR 适配表的其他三列（`reviewCount` / `fadeDensity` / `maxReplay`）

---

## 交付

- 1 个 PR `fix/task-d-rate-injection`
- PR 描述贴 5 条验收矩阵的手测截图 / audio 录制（截短 5 秒）
- 修改 `CC-BRIEF-task-DE-adaptation-and-ui.md` 第 50-64 行——或者在文件末尾加一个 "## 2026-04-17 Correction" 段落指向本 brief，避免下次再有人照老 brief 实现

---

## 问题升级

- 方案 B.1 启用后发现 Azure TTS 不认 `speed` 参数 → 退到方案 B.2（前端 `<audio>.playbackRate` + `preservesPitch`），同时删掉缓存键里的 rate 部分（因为服务端生成的是 1.0x 通用音频）
- 方案 A 在 iOS Safari 上反复失败 → 用户代理检查，iOS 一律走方案 B.2
- C1 用户觉得 1.00 太慢 → P2 加个 "1.25x" 用户手动挡（不在 v3 scope）
- A1 用户的 0.70 听感差 → 提高到 0.75，改矩阵，PR 备注

---

## 和其他 round-1 修复的关系

本 brief 独立 PR，与 `CC-BRIEF-addendum-round-1-fixes.md` 的 9 条无依赖。建议合并顺序：

1. `fix/round-1-taskf-prompt`（Task F 响应字段扩展）
2. `fix/round-1-product-bugs`（消费新字段 + UI 修复）
3. `fix/task-d-rate-injection`（本 brief）

3 个 PR 合并完跑 Round 2 QA。
