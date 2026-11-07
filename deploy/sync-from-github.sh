#!/usr/bin/env bash
# AI Hao123 阿里云镜像同步（方式 A）
# 由 crontab 每 10 分钟调用，或手动执行。
# 逻辑：git pull 拉取 main（含 Actions 最新 data/*.json），组装到 nginx 根目录。
set -euo pipefail

REPO=/opt/aihao123
WEB=/var/www/aihao123
LOG=/var/log/aihao-sync.log

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

cd "$REPO"

if ! git pull --ff-only origin main >/dev/null 2>&1; then
  log "git pull 失败（网络受限？），跳过本次"
  exit 0
fi

# 内联导航目录（若 config/directory.json 有变）
if [ -f scripts/build.mjs ]; then
  node scripts/build.mjs >> "$LOG" 2>&1 || log "build.mjs 失败，继续用已有文件"
fi

mkdir -p "$WEB/data"
rsync -a --delete "$REPO/site/" "$WEB/"
rsync -a --delete "$REPO/data/" "$WEB/data/"

log "同步完成 $(date -u +%FT%T)"
