# 国内阿里云镜像部署方案

## 为什么需要镜像

GitHub Pages 在国内访问不稳定/慢。你的站点是**纯静态站点**（`site/` + `data/`），
没有后端依赖，所以镜像部署 = 把这套静态文件放到国内服务器 + 定时同步数据。

## 推荐架构（Nginx + 定时同步）

```
GitHub Actions (每4h抓数据, 推送到 main)
        │
        ▼
GitHub 仓库 main 分支 (data/*.json 最新)
        │  git pull (服务器侧 crontab, 每10分钟)
        ▼
阿里云 ECS  /var/www/aihao123/
        │  nginx 静态服务 + gzip + 缓存头
        ▼
https://your-domain.com  (已备案域名, HTTP/2, HTTPS)
```

## 方案对比

| 方案 | 数据同步方式 | 优点 | 缺点 | 适用 |
|---|---|---|---|---|
| **A. 服务器主动拉取**（推荐） | 服务器 `git pull` + 拷贝 | 无需 GitHub 出站密钥，最简单可靠 | 服务器需可访问 GitHub（一般可以，慢但可用） | 大多数场景 |
| **B. GitHub 推送** | Actions 用 SSH 密钥 rsync 到服务器 | 数据到达最及时，无 git 历史占用 | 需要把服务器私钥放进仓库 Secret | 想实时同步 |
| **C. OSS 对象存储 + CDN** | Actions 上传 OSS | 静态资源性能最好，可上 CDN 全国加速 | 需要 OSS 桶 + AccessKey + 费用 | 访问量大 |
| **D. Docker 单容器** | 同 A/B，镜像内置 nginx+site | 环境完全一致，迁移方便 | 服务器要装 Docker | 想容器化 |

> **关键点**：抓数据必须在 GitHub Actions 做（国内直连 Hugging Face/Google/Reddit 等源会受限），
> 服务器**只做静态托管**，不要在国内服务器上跑 `fetch.mjs`。

## 服务器准备（一次性）

1. 阿里云 ECS 一台（2C2G 足够），系统 Ubuntu 22.04 / Debian 12，放行 80/443。
2. 域名已 **ICP 备案**（国内服务器强制要求；未备案域名只能走 IP+非标端口，或换香港/新加坡轻量）。
3. 安装：

```bash
sudo apt update
sudo apt install -y nginx git rsync
sudo mkdir -p /var/www/aihao123 /opt/aihao123
```

4. 克隆仓库：

```bash
sudo git clone https://github.com/zhang027cn/aihao123.git /opt/aihao123
sudo chown -R $USER:$USER /opt/aihao123 /var/www/aihao123
```

## 方式 A：服务器定时拉取（推荐）

把 `scripts/deploy/sync-from-github.sh` 拷贝到服务器：

```bash
sudo cp deploy/sync-from-github.sh /usr/local/bin/aihao-sync
sudo chmod +x /usr/local/bin/aihao-sync
```

添加到 crontab（每 10 分钟）：

```bash
crontab -e
# 添加：
*/10 * * * * /usr/local/bin/aihao-sync >> /var/log/aihao-sync.log 2>&1
```

首次手动执行：`aihao-sync`。

## 方式 B：GitHub 主动推送

在仓库 Settings → Secrets 添加：
- `ALIYUN_HOST`、`ALIYUN_USER`、`ALIYUN_SSH_KEY`（服务器私钥）、`ALIYUN_PATH`（如 `/var/www/aihao123`）

然后手动运行 `.github/workflows/deploy-aliyun.yml` 工作流（`workflow_dispatch`）。
该工作流在数据更新后自动同步静态文件到服务器。

## Nginx 配置

把 `scripts/deploy/nginx-aihao123.conf` 放到服务器 `/etc/nginx/sites-available/`，
替换 `server_name` 为你的域名，然后：

```bash
sudo ln -s /etc/nginx/sites-available/aihao123 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS 建议用 certbot（Let's Encrypt 免费证书）：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

> 国内申请 Let's Encrypt 一般可正常签发；如遇 80 端口 ACME 校验受限，可用 `--webroot` 或 DNS 校验。

## 验证

```bash
curl -s http://your-domain.com | head -20
curl -s http://your-domain.com/data/meta.json   # 看 generatedAt 是否为最近 4 小时内
```
