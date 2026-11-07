#!/usr/bin/env bash
# AI Hao123 阿里云镜像同步（方式 A，v2）
# crontab 每 10 分钟调用。国内服务器直连 github.com 不稳定，
# 改用 codeload.github.com 下载 tarball（已验证国内可达，0.7s）。
# 流程：下载 main 分支 tarball -> 解包 -> build 内联目录 -> rsync 到 nginx 根。
set -euo pipefail

REPO=/opt/aihao123
WEB=/var/www/aihao123
LOG=/var/log/aihao-sync.log
GIT_REPO="zhang027cn/aihao123"
TARBALL_URL="https://codeload.github.com/${GIT_REPO}/tar.gz/refs/heads/main"
STAMP=/opt/aihao123/.last-sync
STAGE=/opt/aihao123-stage

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

mkdir -p "$STAGE"
cd "$STAGE"

# 下载最新 tarball
if ! curl -sL --max-time 60 -o latest.tgz "$TARBALL_URL"; then
  log "tarball 下载失败（网络受限？），跳过本次"
  exit 0
fi

# 解包（覆盖旧内容）
rm -rf src && mkdir src && tar xzf latest.tgz -C src --strip-components=1

# 校验：必须有 site/ 与 scripts/build.mjs
[ -d src/site ] && [ -f src/scripts/build.mjs ] || { log "解包校验失败，跳过"; exit 0; }

# 内联导航目录
node src/scripts/build.mjs >> "$LOG" 2>&1 || log "build.mjs 失败，继续用已有文件"

# 同步到 nginx 根（site + data）
mkdir -p "$WEB/data"
rsync -a --delete "$STAGE/src/site/" "$WEB/"
rsync -a --delete "$STAGE/src/data/" "$WEB/data/"

# 记录成功时间
date -u +%FT%T > "$STAMP"
log "同步完成 $(date -u +%FT%T)"
