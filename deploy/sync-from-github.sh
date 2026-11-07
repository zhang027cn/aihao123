#!/usr/bin/env bash
# 阿里云镜像服务器数据同步脚本（方式 A：服务器主动拉取）
# 用法：aihao-sync  —— 由 crontab 每 10 分钟调用，或手动执行
#
# 逻辑：git pull 拉取 main 分支（含 Actions 最新抓取的 data/*.json），
#       再把 site/ 与 data/ 组装到 nginx 根目录。
set -euo pipefail

REPO=/opt/aihao123            # 仓库克隆位置
WEB=/var/www/aihao123         # nginx 站点根目录
LOG=/var/log/aihao-sync.log

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

cd "$REPO"

# 拉取更新
if ! git pull --ff-only origin main >/dev/null 2>&1; then
  log "git pull 失败（网络受限？），跳过本次"
  exit 0
fi

# 内联导航目录（若 config/directory.json 有变）
node scripts/build.mjs >> "$LOG" 2>&1 || log "build.mjs 失败，继续用已有文件"

# 组装站点根目录：site/ 的页面 + data/ 的 JSON
rsync -a --delete "$REPO/site/" "$WEB/"
mkdir -p "$WEB/data"
rsync -a --delete "$REPO/data/" "$WEB/data/"

log "同步完成 $(date -u +%FT%T)"
