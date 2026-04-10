# TASK: AI Feed Ranking — 最小化实现 AI Native 推荐层

## 目标

给现有的 Listen Leap 产品加一个 AI 推荐层：用户画像 + 行为数据 → 调 LLM → 返回排好序的 feed + 每条推荐理由。

这是让产品从"静态 demo"变成"AI Native 产品原型"的最小关键步骤。

## 要做两件事

### 第一件：后端 — Cloudflare Pages Function

在 `functions/api/rank.js` 创建一个 serverless function，部署后自动变成 `POST /api/rank`。

**已有参考代码**：`functions/api/rank.js` 已经写好了，可以直接用或在此基础上改。

#### 输入（POST body）
```json
{
  "level": "B1",
  "interests": ["tech", "science"],
  "listened": [0, 1, 2],
  "skipped": [6],
  "vocab_clicked": ["retired", "debt"],
  "session_duration": 300
}
```

#### 输出
```json
{
  "feed": [
    { "id": 13, "reason": "你对tech感兴趣，这个关于SDK的片段难度适中" },
    { "id": 1, "reason": "换个科学话题，节奏轻松适合现在的状态" },
    ...
  ],
  "clip_count": 22
}
```

#### 技术细节
- Azure GPT endpoint: `https://us-east-02-gpt-01.openai.azure.com`
- API key: 通过环境变量 `AZURE_API_KEY` 配置（部署时放 Cloudflare 环境变量）
- Deployment: `gpt-5.4-global-01`
- API version: `2024-10-21`
- **用 `max_completion_tokens` 而不是 `max_tokens`**（GPT-5.4 要求，否则 400 报错）
- CORS: 允许 `*`，因为前端和 Function 同域但开发时需要跨域

#### Clip 元数据
从 `data.json` 提取 22 个 clip 的轻量元数据（id、title、tag、source、duration、大致难度），硬编码在 Function 里或从 KV 读取。元数据结构见已写好的 `functions/api/rank.js`。

#### Prompt 设计要点
- 传入用户画像（level、interests、listened、skipped、vocab_clicked、session_duration）
- 传入可选 clip 列表（排除已听过的）
- 排序规则：兴趣优先但要混入其他话题、难度匹配 CEFR、跳过的话题降权、点词多说明在挣扎要降低难度、不要连续推同一播客
- 输出 JSON 数组，每条带 id 和中文 reason
- reason 要简短自然，像"难度适中，换个科学话题放松一下"，不要像机器说明书

### 第二件：本地测试脚本

在 `test_rank_api.py` 创建一个 Python 脚本，可以从命令行测试排序逻辑。

**已有参考代码**：`test_rank_api.py` 已经写好了。

#### 用法
```bash
python3 test_rank_api.py --level B1 --interests tech science
python3 test_rank_api.py --level B2 --interests business story --listened 0 1 2 --skipped 6 8 --vocab retired debt
```

#### 技术约束
- **所有 HTTP 请求用 curl subprocess**（macOS 系统 Python 3.9 的 SSL 有问题，urllib 会超时，见 CLAUDE.md）
- 输出格式：先打印用户画像，再打印排好序的 feed（编号 + tag + 标题 + reason）

## 验证标准

1. **本地测试通过**：用至少两个不同画像跑 `test_rank_api.py`，确认：
   - GPT 返回了有效 JSON
   - 排序与用户兴趣相关（tech 用户应该先看到 tech clip）
   - reason 是中文，简短自然
   - 已听过的 clip 不出现在结果里
   - skipped 话题的 clip 排名靠后

2. **对比测试**：用同一组 clip，分别传 B1 和 C1 画像，确认 C1 用户被推了更多 hard 难度的 clip

3. **Function 可部署**：`functions/api/rank.js` 符合 Cloudflare Pages Functions 的文件约定，部署后能通过 `POST /api/rank` 访问

## 不要做的事

- ❌ 不要改 index.html（前端接入是下一步）
- ❌ 不要改 data.json
- ❌ 不要部署到 Cloudflare（部署由人工操作）
- ❌ 不要写单元测试框架，`test_rank_api.py` 就是测试

## 参考文件

- `CLAUDE.md` — 环境踩坑记录，特别注意 SSL 和 curl 相关
- `podcast_agent.py` — Azure GPT 调用方式的参考（第 372-400 行）
- `data.json` — clip 完整数据（22 个 clip）
- `functions/api/rank.js` — 已写好的参考实现
- `test_rank_api.py` — 已写好的参考实现
