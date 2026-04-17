# Claude Code Brief · Ops · 本地 dev server + cloudflared tunnel

> 2026-04-17 · Jamesvd · 桌面 Cowork Claude 要做 v3 MVP 端到端视觉 QA，但它在沙盒里够不到我 Mac 的 localhost。需要你起 dev server + cloudflared tunnel，把 public URL 给我（我再转给它）。

---

## 任务

启动 Flipod dev server（`bash scripts/serve.sh`，监听 8080）→ 用 cloudflared 建 tunnel → 回报 public URL。

---

## 步骤

**1. 先检查 Azure 环境变量**

```bash
env | grep -i azure
```

必须有 `AZURE_API_KEY` 和 `AZURE_ENDPOINT`（或对应的 `AZURE_OPENAI_*` 变体，`scripts/dev_server.js` 两种都认）。如果没有，**停下来告诉我**，别硬起——否则练习 Tab 的 AI 生成 + TTS 都会 500，QA 验不到 F 的效果。

如果有，继续。

**2. 后台启动 dev server**

```bash
cd "/Users/lishuyi/Documents/Obsidian Vault/efforts/visionflow/projects/listen demo"
nohup bash scripts/serve.sh > /tmp/flipod-dev-server.log 2>&1 &
echo "server pid=$!"
sleep 2
cat /tmp/flipod-dev-server.log
```

确认日志里有 `Dev server on 8080 with Range + /api/rank + /api/tts`。如果端口被占了（`EADDRINUSE`），先 `lsof -ti:8080 | xargs kill -9` 再重起。

**3. 起 cloudflared tunnel**

**CLAUDE.md 约束**：cloudflared 在 `/opt/homebrew/bin/cloudflared`（不在 PATH），QUIC 协议可能被防火墙挡，**必须加 `--protocol http2`**。

```bash
nohup /opt/homebrew/bin/cloudflared tunnel --url http://localhost:8080 --protocol http2 > /tmp/flipod-tunnel.log 2>&1 &
echo "tunnel pid=$!"
sleep 5
cat /tmp/flipod-tunnel.log
```

从 log 里抓 `https://xxx-xxx-xxx.trycloudflare.com` 形式的 URL。

**4. 回报**

把这些告诉我：

- public tunnel URL（`https://...trycloudflare.com`）
- dev server pid（方便我让你关）
- tunnel pid
- 快速自检：`curl -s -o /dev/null -w "%{http_code}\n" <tunnel_url>/index.html` 返回 200

---

## 完成后的收尾

我 QA 完会告诉你"可以关了"，你届时：

```bash
kill <server_pid> <tunnel_pid> 2>/dev/null
rm -f /tmp/flipod-dev-server.log /tmp/flipod-tunnel.log
```

---

## 注意

- 不要改代码，这是纯运维任务
- Azure 环境变量不要硬编码进脚本，用户 shell 里有就用，没有就停下问
- tunnel URL 每次起都是新的，别假设上次的还能用
