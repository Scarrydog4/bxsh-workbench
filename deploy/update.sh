#!/bin/bash
# 更新已经上传的版本 → 备份 → 重新构建 → 补表结构 → 重启。
set -euo pipefail
cd "$(dirname "$0")/.."
cd deploy
./backup.sh
docker compose build app tools
docker compose --profile tools run --rm tools db:migrate
docker compose up -d
echo "更新完成"
