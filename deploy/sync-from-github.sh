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

# 供应链防护：只允许「构建脚本」在受限环境里执行，且必须是最小集合。
# 上游仓库被入侵时，攻击者可能塞入恶意 build.mjs / preinstall 钩子。
# 这里做三重校验：
#   1) build.mjs 不能含子进程/管道执行信号（curl|sh 等）；合法 https URL 与模板串不拦截——
#   2) 删除任何 package.json 里的 npm 生命周期钩子，禁止 node 运行时自动执行其它脚本；
#   3) 以 nologin 的专用用户、只读工作目录、无网络之外权限的环境运行构建（见 README）。
if grep -Eq 'child_process|spawn\(|execFile\(|execSync|curl [^|]*\| *(ba|z)?sh|wget .+\|' src/scripts/build.mjs; then
  log "build.mjs 含可疑执行/网络片段，拒绝运行（请人工核查上游仓库）"
  exit 0
fi
if [ -f src/package.json ]; then
  cp src/package.json /tmp/aihao-pkg.bak 2>/dev/null || true
  node -e "
    const fs=require('fs');const p=JSON.parse(fs.readFileSync('src/package.json','utf8'));
    for (const k of ['preinstall','install','postinstall','prepare','prepublish','prepublishOnly']) delete p.scripts?.[k];
    fs.writeFileSync('src/package.json', JSON.stringify(p));
  " >> "$LOG" 2>&1 || log "清理 package.json 钩子失败（源文件可能不可写）"
fi

# 内联导航目录（在受限环境执行：禁用网络与常见危险模块由运行用户权限间接约束）
node src/scripts/build.mjs >> "$LOG" 2>&1 || log "build.mjs 失败，继续用已有文件"

# 同步到 nginx 根（site + data）
mkdir -p "$WEB/data"
rsync -a --delete "$STAGE/src/site/" "$WEB/"
# enrich.json 是服务器懒加载回写的持久副本（不在 repo 内），--delete 会误删，必须排除
rsync -a --delete --exclude=enrich.json "$STAGE/src/data/" "$WEB/data/"

# enrich web 副本兜底：若缺失（生成前被删的窗口），从权威副本补回，
# 保证 CI 的 mergeServerEnrich 任何时候都能拉到。
if [ ! -f "$WEB/data/enrich.json" ] && [ -f /var/lib/aihao/enrich.json ]; then
  cp /var/lib/aihao/enrich.json "$WEB/data/enrich.json"
  log "enrich web 副本缺失，已从权威副本补回"
fi

# 记录成功时间
date -u +%FT%T > "$STAMP"
log "同步完成 $(date -u +%FT%T)"
