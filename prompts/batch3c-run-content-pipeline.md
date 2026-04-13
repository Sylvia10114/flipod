# Batch 3C: 跑内容 Pipeline 扩充 Clip 库

## 背景

目前 demo 只有 23 个 clip，用户很快会刷完。需要用 `scripts/podcast_agent.py` 生成更多内容。

## 前置条件

- 需要 Azure OpenAI API key（环境变量 `AZURE_OPENAI_API_KEY` 或在脚本中配置）
- 需要 ffmpeg: `/opt/homebrew/bin/ffmpeg`
- Python 3.9（macOS 系统自带）
- 所有 HTTP 请求用 curl subprocess（不能用 urllib，SSL 问题）

## 执行步骤

### Step 1: 检查环境

```bash
# 确认 ffmpeg
/opt/homebrew/bin/ffmpeg -version

# 确认 API key
echo $AZURE_OPENAI_API_KEY

# 确认脚本可运行
cd /path/to/listen\ demo
python3 scripts/podcast_agent.py --help
```

### Step 2: 按话题批量生成

目标：每个话题跑 5 个新 clip，总计 30 个新 clip。

```bash
# Psychology（已有最多，跑少一点）
python3 scripts/podcast_agent.py \
  --keywords "psychology,behavioral science" \
  --target-clips 5 \
  --start-id 24 \
  --output-dir ./output/coldstore_psychology

# History
python3 scripts/podcast_agent.py \
  --keywords "history,historical stories" \
  --target-clips 5 \
  --start-id 29 \
  --output-dir ./output/coldstore_history

# Science
python3 scripts/podcast_agent.py \
  --keywords "science explained,scientific discovery" \
  --target-clips 5 \
  --start-id 34 \
  --output-dir ./output/coldstore_science

# Technology
python3 scripts/podcast_agent.py \
  --keywords "technology,AI,startup" \
  --target-clips 5 \
  --start-id 39 \
  --output-dir ./output/coldstore_tech

# Society & Culture
python3 scripts/podcast_agent.py \
  --keywords "society,culture,social issues" \
  --target-clips 5 \
  --start-id 44 \
  --output-dir ./output/coldstore_society

# Business
python3 scripts/podcast_agent.py \
  --keywords "business,economics,money" \
  --target-clips 5 \
  --start-id 49 \
  --output-dir ./output/coldstore_business
```

### Step 3: 合并到主 data.json

每个 coldstore 目录会生成 `new_clips.json`。需要：

1. 读取所有 `new_clips.json`
2. 验证每个 clip（`validate_all_clips()` 或手动检查）
3. 合并到主 `data.json`
4. 复制音频文件到 `clips/` 目录
5. 更新 clip 编号确保不冲突

**注意：不要直接覆盖 data.json，先写到 `data_merged.json` 让用户确认。**

### Step 4: 验证

```bash
# 检查总 clip 数
python3 -c "import json; d=json.load(open('data_merged.json')); print(f'Total clips: {len(d)}')"

# 启动本地 dev server 预览
node scripts/dev_server.js
```

## 预计耗时

每个话题 5 个 clip，每个 clip 需要：下载音频(~30s) + Whisper转录(~60s) + GPT翻译+CEFR(~30s) + 切片(~10s) ≈ 2分钟

6 个话题 × 5 个 clip × 2 分钟 ≈ **60 分钟**（考虑失败重试，预计 1-2 小时）
