# RN UI I18n SOP

## 1. 目标

客户端多语言只负责 **UI 多语言**。  
内容多语言由服务端/内容管线负责生成，客户端不参与翻译业务内容。

## 2. 职责边界

### 属于 UI 多语言

这些文案必须进入本地 UI 配置表 `mobile/src/i18n/ui-copy.json`：

- 页面标题、副标题、按钮文案
- Toast、弹窗、错误提示、占位文案
- Onboarding、登录、Feed、菜单、账号、练习流程中的交互引导语
- 本地卡片标签，如 `Quick Review`、`Today's Progress`
- 母语选择器本身

### 不属于 UI 多语言

这些属于内容层，客户端只展示，不在客户端做翻译：

- `clip.title`
- `clip.lines[].en / zh`
- `clip.info_takeaway`
- `clip.questions`
- 词义、例句、翻译等服务端返回字段
- 动态生成的播客内容元数据

一句话判断：

- 这段文字是产品壳层/交互层固定文案：放进 UI i18n
- 这段文字来自 clip、词典、模型生成、服务端内容：归内容多语言

## 3. 单一数据源

- UI 文案单一数据源：`mobile/src/i18n/ui-copy.json`
- 客户端运行时入口：`mobile/src/i18n/index.tsx`
- `Profile.nativeLanguage` 是 UI 语言切换的唯一用户态来源

禁止：

- 在页面组件里直接新增硬编码用户文案
- 在多个文件维护不同版本的翻译表

## 4. 支持语种

- English
- Simplified Chinese
- Traditional Chinese
- Japanese
- Korean
- Spanish
- French
- Brazilian Portuguese
- Italian
- German

## 5. 开发 SOP

### Step 1

先判断文案归属。

- UI 固定文案：进入 `ui-copy.json`
- 内容字段：不要塞进客户端翻译表

### Step 2

先补英文基线，再补其他语种。

- 英文是语义基线
- 所有其他 locale 必须覆盖相同 key
- 占位符必须与英文完全一致

### Step 3

页面接入时只通过 `createUiI18n()` / `useUiI18n()` 读取文案。

- App 根层用 `UiI18nProvider`
- 需要临时切换母语的场景（如 onboarding）可以创建局部 i18n 实例

### Step 4

每次新增/修改 UI 文案都必须先跑完整性校验：

```bash
cd /Users/nathanshan/Desktop/flipod_jp_sync/mobile
npm run i18n:check
```

### Step 5

发版前或批量补翻译后，必须跑 LLM 语义校验：

```bash
cd /Users/nathanshan/Desktop/flipod_jp_sync/mobile
npm run i18n:llm
```

输出报告：

- `mobile/output/i18n-llm-report.json`

### Step 6

修复报告中的 `warn` / `error` 后，再跑一次：

- `npm run i18n:check`
- `npx tsc --noEmit`

## 6. Harness 约束

### 本地完整性校验

`mobile/scripts/check-ui-i18n.mjs` 会校验：

- locale 是否完整
- key 是否完整
- value 是否为空
- placeholder 是否与英文一致

### LLM 正确性校验

`mobile/scripts/validate_ui_i18n_llm.py` 会按 locale 对比英文基线，重点检查：

- 是否误译
- 是否遗漏语气
- 是否保留了英文未翻译
- 是否有 UI 场景不自然表达
- 是否存在 placeholder 风险

## 7. TDD 约束

新增 UI 文案时按这个顺序：

1. 先新增英文 key
2. 先跑 `npm run i18n:check`，确认会失败
3. 补齐所有 locale
4. 再跑 `npm run i18n:check` 直到通过
5. 再接入组件
6. 最后跑 `npx tsc --noEmit`

## 8. 当前迁移策略

本次先接入高优先级入口：

- App 级 toast / loading / calibration
- Onboarding
- Login
- Feed loading overlay
- Feed review/progress cards

剩余页面继续按同一机制迁移，不允许回退到硬编码文案。
