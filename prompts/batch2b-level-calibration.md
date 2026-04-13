# Batch 2B: CEFR Level 自动校准 Demo

## 背景

用户在 Onboarding 时自选 CEFR 等级（A1-A2 / B1 / B2 / C1-C2），但自评往往不准。需要根据用户行为数据自动建议调整。

## 需求

在 `index.html` 中实现一个 level 校准系统，全部前端逻辑，存 localStorage。

### 数据采集

监听以下信号，记录到 `flipodLevelSignals`（localStorage，JSON object）：

```json
{
  "clipsPlayed": 12,
  "wordsLookedUp": 45,
  "uniqueWordsLookedUp": 32,
  "wordsByLevel": { "B1": 8, "B2": 15, "C1": 7, "C2": 2 },
  "practiceHardRate": 0.35,
  "avgWordsPerClip": 3.75,
  "lastCalibration": 1712900000000
}
```

- `wordsLookedUp`: 每次点词 popup 时 +1
- `wordsByLevel`: 按查过的词的 CEFR 等级分桶计数
- `practiceHardRate`: Practice Step 2 中标记 "hard" 的句子比例
- `avgWordsPerClip`: wordsLookedUp / clipsPlayed

### 校准规则

在用户听完第 10 个 clip 后触发首次校准检查，之后每 10 个 clip 检查一次。

**建议升级**（当前是 B1，建议调到 B2）：
- `avgWordsPerClip < 1.5`（几乎不查词）
- 且 `practiceHardRate < 0.2`（精听时很少标记难句）
- 且 `wordsByLevel` 中 B2+ 词汇占查词总量 < 30%

**建议降级**（当前是 B2，建议调到 B1）：
- `avgWordsPerClip > 5`（频繁查词）
- 且 `practiceHardRate > 0.6`（大部分句子都觉得难）
- 且 `wordsByLevel` 中 C1+ 词汇占查词总量 > 50%

**保持不变**：不满足以上条件时不提示。

### UI 提示

触发校准时，在 Feed 底部弹一个非侵入式 toast（和 bookmark toast 类似），停留 5 秒或用户点击后消失：

- 升级建议：`"你的表现超过了 B1 水平，要升级到 B2 吗？"` + [升级] [暂不]
- 降级建议：`"当前内容似乎有点难，要调整到 B1 吗？"` + [调整] [保持]

用户选择后：
- 更新 `flipodLevel`
- 记录 `lastCalibration` 时间戳
- 如果升级/降级了，触发 rank API 重新排序（如果 rank API 可用）

### 注意事项
- 同一方向的建议最多提示一次，用户拒绝后不再提示同方向
- 存 `flipodLevelCalibration` 记录：`{ suggestedUp: bool, suggestedDown: bool, dismissed: bool }`
- 不要在 Practice 进行中弹出，只在 Feed 浏览时弹出
