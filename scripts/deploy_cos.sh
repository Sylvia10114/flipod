#!/bin/bash
# ── Flipod COS 部署脚本 ──
# 用法:
#   1. 先安装 coscmd:  pip3 install coscmd
#   2. 填写下面的 SECRET_ID 和 SECRET_KEY
#   3. 运行: bash deploy_cos.sh

SECRET_ID="${COS_SECRET_ID:?请设置环境变量 COS_SECRET_ID}"
SECRET_KEY="${COS_SECRET_KEY:?请设置环境变量 COS_SECRET_KEY}"
BUCKET="listendemo-1407168198"
REGION="ap-beijing"

# 项目目录 (脚本所在目录)
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Flipod COS 部署 ==="

# 1. 配置 coscmd
echo "[1/3] 配置 coscmd..."
coscmd config \
  -a "$SECRET_ID" \
  -s "$SECRET_KEY" \
  -b "$BUCKET" \
  -r "$REGION"

# 2. 上传音频文件 (设置缓存头，CDN 友好)
echo "[2/3] 上传音频文件..."
for f in "$DIR"/clip*.mp3; do
  fname=$(basename "$f")
  echo "  上传 $fname ..."
  coscmd upload \
    -H '{"Cache-Control":"public, max-age=31536000","Content-Type":"audio/mpeg"}' \
    "$f" "/$fname"
done

# 3. 上传网页文件
echo "[3/3] 上传网页文件..."
coscmd upload \
  -H '{"Cache-Control":"no-cache","Content-Type":"text/html; charset=utf-8"}' \
  "$DIR/index.html" /index.html

coscmd upload \
  -H '{"Cache-Control":"no-cache","Content-Type":"application/json; charset=utf-8"}' \
  "$DIR/data.json" /data.json

echo ""
echo "=== 部署完成 ==="
echo ""
echo "访问地址:"
echo "  https://${BUCKET}.cos.${REGION}.myqcloud.com/index.html"
echo ""
echo "如果开启了静态网站托管，还可以用:"
echo "  https://${BUCKET}.cos-website.${REGION}.myqcloud.com"
echo ""
echo "别忘了在 COS 控制台开启「静态网站」功能（基础配置 → 静态网站）"
