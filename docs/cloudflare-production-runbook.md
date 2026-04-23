# Flipod Cloudflare HTTPS Runbook

目标：把当前 `functions/` + 静态内容目录部署到 Cloudflare Pages，让移动端未来只需要把 `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_CONTENT_BASE_URL` 切到正式 HTTPS 域名，例如：

- `https://api.flipod.your-domain.com`

这份 runbook 只做最小改动拿到 HTTPS，不改现有 API 路径，也不迁移框架。

## 当前部署模型

- Pages 发布目录：`.cf-pages-dist/`
  - 由 `scripts/prepare_pages_dist.sh` 生成
  - 只包含：
    - `data.json`
    - `clip-manifest.json`
    - `clips/`
    - `functions/`
- API：Cloudflare Pages Functions
  - 发布时目录：`.cf-pages-dist/functions/`
  - 源码目录：`functions/`
  - 例如：
    - `/api/session`
    - `/api/auth/*`
    - `/api/profile`
    - `/api/bookmarks`
    - `/api/vocab`
    - `/api/practice`
    - `/api/practice/generate`
    - `/api/rank`
    - `/api/tts`
- 数据库：Cloudflare D1
  - schema 文件：`db/schema.sql`
  - binding 名称：`DB`

## 生产 URL 方案

推荐把同一个 Pages 项目同时承载静态内容和 API：

- `https://api.flipod.your-domain.com/data.json`
- `https://api.flipod.your-domain.com/clip-manifest.json`
- `https://api.flipod.your-domain.com/clips/clip1.mp3`
- `https://api.flipod.your-domain.com/api/health`
- `https://api.flipod.your-domain.com/api/profile`

这样 RN 未来只需要改一处：

- `EXPO_PUBLIC_API_BASE_URL=https://api.flipod.your-domain.com`
- `EXPO_PUBLIC_CONTENT_BASE_URL=https://api.flipod.your-domain.com`

## 0. 预检查

先确认已经登录 Cloudflare：

```bash
npx wrangler@latest whoami
```

如果要走 API Token 而不是浏览器登录，至少准备：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 1. 创建 Pages 项目

如果项目还不存在：

```bash
npx wrangler@latest pages project create flipod
```

建议项目名继续用：

- `flipod`

### Direct Upload tradeoff

这套 runbook 走的是：

- `wrangler pages deploy .cf-pages-dist --project-name flipod`

也就是 **Direct Upload**。

这里要单独记住一个 tradeoff：

- 不要把这条链路理解成“后面可以无缝切回 Git integration”
- 如果未来一定要改成 Git integration，建议把它视为一次单独迁移，而不是期待当前 Direct Upload 项目原地切换

所以这份 runbook 的前提是：

- production 继续走 Direct Upload
- deploy source of truth 是当前仓库 + `.cf-pages-dist`

## 2. 创建并绑定 D1

创建 production D1：

```bash
npx wrangler@latest d1 create flipod-db
```

创建后，Cloudflare 会返回真实 `database_id`。把它填进根目录 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "flipod-db"
database_id = "REPLACE_WITH_REAL_D1_DATABASE_ID"
preview_database_id = "DB"
```

说明：

- 当前仓库里的 `database_id = "local-flipod-db"` 只是本地 / Miniflare 占位值。
- production 部署前，必须替换成 Cloudflare 返回的真实 D1 database id。

## 3. 初始化 remote D1 schema

这次后端 schema 来源是：

- `db/schema.sql`

初始化 / 更新 production D1：

```bash
npm run db:init:remote
```

等价命令：

```bash
npx wrangler@latest d1 execute flipod-db --remote --file=./db/schema.sql
```

这一步应该在首次 production deploy 前执行一次；后续 schema 有更新时也重复执行。

## 4. 配置 production secrets / vars

### 必需 secrets

这些必须在 Cloudflare Pages 的 `Settings -> Variables and Secrets` 中配置为生产环境可用：

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `SMS_ACCESS_KEY_ID`
- `SMS_ACCESS_KEY_SECRET`
- `SMS_SIGN_NAME`
- `SMS_TEMPLATE_CODE`

### 必需 non-secret vars

- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION`
- `APPLE_AUDIENCE`
- `SMS_DELIVERY_ENABLED`
- `SMS_REGION`
- `VERIFICATION_CODE_TTL_SECONDS`
- `VERIFICATION_CODE_RESEND_LOCK_SECONDS`
- `VERIFICATION_CODE_DAILY_LIMIT`
- `ELEVENLABS_VOICE_ID`
- `ELEVENLABS_MODEL_ID`
- `AUTH_DEBUG_SMS_CODE`

### non-secret vars 的唯一维护位置

production 的 non-secret vars 只建议维护在一个地方：

- 根目录 [wrangler.toml](/Users/nathanshan/Desktop/flipod_jp_sync/wrangler.toml)

也就是说，这份 runbook 里把 `wrangler.toml` 视为 non-secret vars 的 **source of truth**。

建议做法：

- secrets：在 Cloudflare Dashboard / `wrangler pages secret put` 维护
- non-secret vars：只在 `wrangler.toml` 维护

不要同时在多个地方复制同一组 non-secret vars，否则后续很容易出现：

- 本地 `wrangler.toml`
- Cloudflare Dashboard vars
- 文档示例

三边不一致的问题。

### 推荐 production 值

- `AZURE_OPENAI_DEPLOYMENT=gpt-5-chat-global-01`
- `AZURE_OPENAI_API_VERSION=2025-01-01-preview`
- `APPLE_AUDIENCE=com.flipod.mobile`
- `SMS_DELIVERY_ENABLED=true`
- `SMS_REGION=cn-hangzhou`
- `VERIFICATION_CODE_TTL_SECONDS=300`
- `VERIFICATION_CODE_RESEND_LOCK_SECONDS=60`
- `VERIFICATION_CODE_DAILY_LIMIT=20`
- `ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM`
- `ELEVENLABS_MODEL_ID=eleven_multilingual_v2`
- `AUTH_DEBUG_SMS_CODE=0`

### production 禁止项

下面这些不要在 production 打开：

- `AUTH_DEBUG_SMS_CODE=1`
- `SMS_DELIVERY_ENABLED=false`
- `SMS_TEST_PHONE_NUMBERS` 非空

`SMS_TEST_CODE` 即使保留默认值也不会生效，只要：

- `AUTH_DEBUG_SMS_CODE=0`
- `SMS_DELIVERY_ENABLED=true`
- `SMS_TEST_PHONE_NUMBERS=` 空

### secret 配置命令示例

```bash
npx wrangler@latest pages secret put AZURE_OPENAI_API_KEY --project-name flipod
npx wrangler@latest pages secret put ELEVENLABS_API_KEY --project-name flipod
npx wrangler@latest pages secret put SMS_ACCESS_KEY_ID --project-name flipod
npx wrangler@latest pages secret put SMS_ACCESS_KEY_SECRET --project-name flipod
npx wrangler@latest pages secret put SMS_SIGN_NAME --project-name flipod
npx wrangler@latest pages secret put SMS_TEMPLATE_CODE --project-name flipod
```

## 5. 准备 Pages 发布目录

先生成专用发布目录：

```bash
npm run prepare:pages-dist
```

这会生成：

- `.cf-pages-dist/data.json`
- `.cf-pages-dist/clip-manifest.json`
- `.cf-pages-dist/clips/`
- `.cf-pages-dist/functions/`

不会把整个仓库根目录直接发到 Pages。

## 6. 部署到 Cloudflare Pages

从仓库根目录执行：

```bash
npm run deploy:pages
```

等价命令：

```bash
npx wrangler@latest pages deploy .cf-pages-dist --project-name flipod
```

这会把：

- `.cf-pages-dist` 中的静态内容
- `.cf-pages-dist/functions/` 下的 Pages Functions

一起部署到同一个 Pages 项目。

## 7. 绑定自定义 HTTPS 域名

在 Cloudflare Dashboard：

- `Workers & Pages`
- 选择 `flipod`
- `Custom domains`
- `Set up a custom domain`

建议绑定：

- `api.flipod.your-domain.com`

绑定完成并生效后，Pages 会自动签发 HTTPS 证书。

## 8. Smoke tests

### 一键脚本

```bash
bash ./scripts/smoke_api.sh https://api.flipod.your-domain.com
```

如果要顺手校验内容数量：

```bash
bash ./scripts/smoke_api.sh https://api.flipod.your-domain.com 176
```

### 最短手工命令

健康检查：

```bash
curl -sS https://api.flipod.your-domain.com/api/health
```

未登录鉴权检查：

```bash
curl -i https://api.flipod.your-domain.com/api/auth/me
```

session 检查：

```bash
curl -sS -X POST https://api.flipod.your-domain.com/api/session \
  -H 'Content-Type: application/json' \
  --data '{"deviceId":"smoke-test-device"}'
```

内容翻译检查：

```bash
curl -sS -X POST https://api.flipod.your-domain.com/api/content/translations \
  -H 'Content-Type: application/json' \
  --data '{"locale":"english","items":[{"contentKey":"health-check","contentHash":"health-check","title":"Hello","lines":[{"en":"Hello","zh":"你好"}],"questions":[]}]}' 
```

TTS 检查：

```bash
curl -sS -D - -o /tmp/flipod-tts.mp3 \
  "https://api.flipod.your-domain.com/api/tts?text=Hello%20world"
```

静态资源检查：

```bash
curl -sS https://api.flipod.your-domain.com/data.json | python3 -m json.tool >/dev/null
curl -sS https://api.flipod.your-domain.com/clip-manifest.json | python3 -m json.tool >/dev/null
curl -sS -D - -o /tmp/flipod-sample.mp3 https://api.flipod.your-domain.com/clips/clip1.mp3
```

## 9. iOS / RN 切换方式

当 HTTPS 域名确认稳定后，RN 只需要切换：

- `EXPO_PUBLIC_API_BASE_URL=https://api.flipod.your-domain.com`
- `EXPO_PUBLIC_CONTENT_BASE_URL=https://api.flipod.your-domain.com`

不需要改现有业务接口 contract。

后续 iOS 还可以把针对裸 IP HTTP 的 ATS 放行删掉。

## 10. 注意事项 / 剩余风险

- `wrangler.toml` 里的 `database_id` 如果没替换成真实 D1 id，production deploy 虽然可能通过构建，但运行时不会连到正确 D1。
- Cloudflare Pages secret/var 改动后，最好重新部署一次，避免新旧运行时配置不一致。
- `.cf-pages-dist/` 是构建产物，不是手工编辑目录；任何内容变更都应该先改源文件，再重新跑 `npm run prepare:pages-dist` / `npm run deploy:pages`
- 这套后端依赖：
  - Azure OpenAI
  - 阿里云短信
  - ElevenLabs
  其中任一 secret 缺失，都可能导致对应路由返回 5xx。
- 本 runbook 目标是最小改动拿到 HTTPS；它不改变当前 API 返回结构，也不引入新基础设施。
