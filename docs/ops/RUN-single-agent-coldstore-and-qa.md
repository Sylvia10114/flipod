# 单 agent 补库 + QA 运行入口

目标：先补冷库，再用 QA agent 做 `pass / review / reject`。

## 1. 先补最缺主题

当前 `data.json` 库存：

- `business`: 5
- `story`: 3
- `science`: 2
- `tech`: 2
- `psychology`: 1
- `history`: 1
- `culture`: 0
- `society`: 0

优先顺序：

1. `culture`
2. `society`
3. `psychology`
4. `history`

## 2. 运行 processor

### culture

```bash
python3 podcast_agent.py \
  --keywords "culture" \
  --clips-per-episode 3 \
  --target-clips 5 \
  --start-id 100 \
  --output-dir ./output/coldstore_culture
```

### society

```bash
python3 podcast_agent.py \
  --keywords "society" \
  --clips-per-episode 3 \
  --target-clips 5 \
  --start-id 200 \
  --output-dir ./output/coldstore_society
```

## 3. 运行 QA agent

### culture QA

```bash
python3 eval_agent.py \
  --input ./output/coldstore_culture/new_clips.json
```

### society QA

```bash
python3 eval_agent.py \
  --input ./output/coldstore_society/new_clips.json
```

如需开启 LLM 辅助评分：

```bash
python3 eval_agent.py \
  --input ./output/coldstore_culture/new_clips.json \
  --use-llm
```

## 4. 产物

每个批次目录会得到：

- `new_clips.json`: processor 原始产物
- `eval_results.json`: QA 结果
- `approved_clips.json`: 仅保留 `pass` 的 clips

## 5. 现在的策略

- 不先做 supervisor / discovery / publishing 多 agent
- 先用现有 `podcast_agent.py` 扩冷库
- QA 独立跑，先做质量关卡
- 等 `culture / society` 能稳定出片，再拆更多 agent
