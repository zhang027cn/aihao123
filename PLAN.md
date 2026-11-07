# AI 导航站「AI Hao123」项目开发计划

> 仓库：`zhang027cn/aihao123` ｜ 站点定位：**只做 AI**，不涉及任何其它领域
> 版本：v1.0 ｜ 制定日期：2026-11-06 ｜ 当前阶段：M0（首版 MVP）

---

## 1. 项目定位

做一个像 hao123 那样「一屏看全、点了就走」的中文导航站，但**内容范围严格限定在 AI 领域**：

| 板块 | 解决什么问题 | 数据来源 |
|---|---|---|
| **AI 导航** | 去哪儿用？国内外 AI 服务/模型/工具/社区的直达入口 | 人工精选（`config/directory.json`） |
| **AI 资讯** | 今天 AI 圈发生了什么？多源聚合去重，中英文对照 | 14 个 RSS 源 + Hacker News Algolia API |
| **排行榜** | 什么东西最火？可量化、可复算、每天更新的榜单 | GitHub / Hugging Face 公开 API |
| **MCP & SKILL 目录** | 有什么能直接拿来用的？只收**公开免费、开源**的项目 | MCP 官方 Registry + GitHub 搜索 |

**非目标（明确不做）**：科技新闻、数码、编程教程、非 AI 工具、需要登录才能访问的闭源资源推荐位、付费广告位。

---

## 2. 技术选型与理由

**方案：纯静态站点 + Node 数据管线 + GitHub Actions 定时更新（零依赖、零服务器）**

| 决策 | 选择 | 理由 |
|---|---|---|
| 前端 | 原生 HTML/CSS/JS（无框架） | 导航站本质是链接列表，无需框架；首屏 <50KB，Lighthouse 友好，SEO 直出 |
| 构建 | **无构建步骤** | 少一层依赖就少一处故障点；Pages 直接托管 `site/` |
| 数据管线 | Node 22 原生 `fetch`，**零 npm 依赖** | CI 里 `npm install` 都不需要；RSS 解析器自研（`scripts/lib/rss.mjs`） |
| 数据存储 | 抓取结果落盘为 `data/*.json` 并提交入库 | JSON 即"数据库"，可 diff、可回滚、可人工修正 |
| 更新调度 | GitHub Actions cron（每 4 小时） | 完全免费（Public 仓库），无需自建服务器 |
| 部署 | GitHub Actions → GitHub Pages | 免费、HTTPS、自动发布 |
| 推送 | SSH key（已验证身份 `zhang027cn`）+ 每次改动自动 push | 见 §8 |

---

## 3. 目录结构

```
aihao123/
├── PLAN.md                 # 本文档：开发计划
├── README.md               # 使用与二次开发说明
├── package.json            # scripts 入口（无第三方依赖）
├── config/
│   ├── directory.json       # ① 人工精选的导航分类与链接（核心资产）
│   └── sources.json         # ② RSS 源、GitHub 查询、榜单定义
├── data/                   # ③ 管线自动抓取的 JSON（定时更新，勿手改）
│   ├── news.json  mcp.json  skills.json
│   ├── ranking-github.json  ranking-models.json  ranking-spaces.json
│   ├── ranking-hn.json  ranking-keywords.json  meta.json
├── scripts/
│   ├── fetch.mjs           # 数据管线主入口
│   ├── serve.mjs           # 本地预览服务器（零依赖）
│   └── lib/{http.mjs, rss.mjs, util.mjs}
├── site/                   # ④ 站点根（GitHub Pages 托管目录）
│   ├── index.html  news.html  rankings.html  mcp.html  skills.html  about.html
│   └── assets/{css/site.css, js/*.js}
├── .github/workflows/
│   ├── update-data.yml     # 每 4 小时抓数据 → 自动 commit & push
│   └── deploy.yml          # push 后自动构建发布到 Pages
└── docs/                   # 数据字典、抓取规则
```

**关键分层原则**：`config/`（人工维护）与 `data/`（机器生成）严格分离。机器永远不写 `config/`，人尽量不碰 `data/`——需要人工修正时改抓取规则，而不是改结果。

---

## 4. 数据源清单（2026-11-06 已实测连通性）

### 4.1 AI 资讯 RSS（可用 ✅ / 受限 ⚠️ / 不可用 ❌）

| 源 | 语言 | 状态 | 备注 |
|---|---|---|---|
| OpenAI News | EN | ✅ | 官方 |
| Hugging Face Blog | EN | ✅ | 官方 |
| Google AI Blog | EN | ✅ | 官方 |
| Hacker News (Algolia API) | EN | ✅ | 关键词过滤 AI 相关 |
| TechCrunch AI | EN | ✅ | |
| The Verge AI | EN | ✅ | |
| Ars Technica AI | EN | ✅ | |
| MIT Tech Review | EN | ✅ | |
| Simon Willison's Weblog | EN | ✅ | LLM 工程实践高质量源 |
| The Decoder | EN | ✅ | |
| Import AI | EN | ✅ | |
| Last Week in AI | EN | ✅ | |
| Interconnects | EN | ✅ | |
| 36Kr | 中文 | ✅ | 需 AI 关键词过滤 |
| 少数派 | 中文 | ✅ | 需 AI 关键词过滤 |
| 量子位 | 中文 | ⚠️ | 403，带浏览器 UA 重试，失败则降级 |
| 机器之心 | 中文 | ❌ | RSS 302 到营销页，二期接其网页版/备用源 |

> 策略：**每个源独立降级**——单源失败不影响整批，`meta.json` 记录各源最后成功时间，页面上展示数据新鲜度。

### 4.2 排行榜数据源

| 榜单 | 来源 | 关键字段 |
|---|---|---|
| GitHub AI 开源热榜 | `api.github.com/search/repositories?q=topic:...` | stars、pushed_at、license |
| Hugging Face 爆款模型 | `/api/models?sort=trendingScore` | trendingScore、downloads、likes |
| Hugging Face 爆款 Space | `/api/spaces?sort=trendingScore` | trendingScore、likes |
| HN AI 热帖 | `hn.algolia.com` 搜索 API | points、comments |
| MCP 热度榜 | GitHub `topic:mcp` + 官方 Registry | stars、license |
| AI 热词榜 | HN/资讯标题词频 | 自研分词统计 |

### 4.3 MCP / SKILL 数据源

| 源 | 用途 | 状态 |
|---|---|---|
| `registry.modelcontextprotocol.io/v0/servers` | MCP 官方 Registry，游标分页（`limit=50` + `metadata.nextCursor`） | ✅ |
| GitHub `topic:mcp` / `awesome-mcp-servers` | 仓库型 MCP，补 stars/license | ✅ |
| GitHub `anthropics/skills` 仓库树 | 官方 SKILL 定义（`**\/SKILL.md`，当前 20 个） | ✅ |
| GitHub `topic:claude-skills`、`awesome-claude-skills` | 社区 SKILL / SKILL 合集 | ✅ |
| Awesome 列表仓库 | 人工核对补充 | ✅ |

**收录硬规则**：必须 `license` 字段为 OSI 认可（MIT/Apache-2.0/BSD/ISC/MPL/Unlicense…）**或**明确官方开源仓库；免费使用；非 archived；有可访问的仓库/官网。不满足 → 不收录（宁缺毋滥）。

---

## 5. 排行榜算法定义（"有趣"的关键）

榜单必须**可解释、可复算**，每张榜单页面上直接展示公式：

1. **开源 AI 热力榜**：`热度 = stars / (1 + days_since_push)` —— 兼顾存量与活跃度，防止"老项目吃老本"。
2. **星标增速榜（黑马榜）**：对比 7 天前快照，`增速 = (stars_now - stars_7d) / 7`，快照存 `data/snapshots/`。**M2 里程碑启用**（需要先积累一周历史数据）。
3. **Hugging Face 爆款榜**：直接用官方 `trendingScore`，标注模型类型与下载量。
4. **MCP 热度榜**：按 stars 排序 + `license` 徽章 + 部署方式（stdio / streamable-http）。
5. **AI 热词榜（趣味）**：抓取近 7 天 HN/资讯标题，去停用词后做词频统计，输出 Top 30 关键词及环比变化（📈/📉）。
6. **霸榜开发者榜（趣味）**：统计榜单仓库的 `owner` 出现次数，看"谁在刷屏"。

---

## 6. 里程碑

| 里程碑 | 内容 | 交付标准 | 状态 |
|---|---|---|---|
| **M0 首版 MVP** | 6 个页面 + 13 条导航分类 + 抓取脚本 + 2 个 Actions | 本地可预览、能推送 GitHub、数据能自动更新 | ✅ 本轮 |
| **M1 数据可信** | 4 小时定时抓取 + 数据新鲜度展示 + 失败告警徽章 | 连续 7 天 `meta.json` 无失败源 | ⬜ |
| **M2 榜单进阶** | 星标 7 天增速快照、霸榜开发者榜、热词环比 | 快照数据满 7 天自动启用 | ⬜ |
| **M3 体验** | 全站搜索（Ctrl+K 唤起）、按分类筛选、暗色模式、PWA 离线 | Lighthouse ≥ 95 | ⬜ |
| **M4 社区化** | `config/directory.json` 收 PR，提交模板 + CI 自动校验死链 | 接受第一个外部 PR | ⬜ |
| **M5 进阶** | 中文资讯源补全（机器之心/量子位稳定化）、RSS 全文抓取、月度榜单快照归档 | 中文源 ≥ 5 个稳定 | ⬜ |

---

## 7. 质量保障

- **链接健康**：`scripts/check-links.mjs`（M1）每日巡检导航链接，死链自动开 Issue。
- **数据校验**：抓取后对 JSON 做 schema 校验，不合法条目丢弃并在 `meta.json` 计数。
- **单源隔离**：任何源抛错都 `try/catch` 记录，绝不阻塞其他源。
- **页面容错**：`data/*.json` 加载失败时显示占位态与"数据更新时间"，导航核心内容（人工精选链接）内联在页面配置中，**不依赖网络**。
- **可访问性**：语义化标签、`lang="zh-CN"`、对比度 ≥ 4.5:1、键盘可导航。

---

## 8. Git / GitHub 工作流（每次改完就推）

1. **身份已验证**：本机 SSH key 对应 GitHub 账号 `zhang027cn`（`ssh -T git@github.com` 返回 `Hi zhang027cn!`）。
2. **本地仓库**：已 `git init`（分支 `main`），身份 `zhang027cn <zhang027cn@users.noreply.github.com>`。
3. **推送方式**：`git push` 走 SSH（`git@github.com:zhang027cn/aihao123.git`），无需额外 Token。
4. **自动推送纪律**：
   - 每轮改动结束 → `git add -A && git commit -m "..." && git push`；
   - `update-data.yml` 抓完数据后**自动 commit + push**（`[skip ci]` 避免循环触发）；
   - `deploy.yml` 监听 `site/**` 变更发布到 Pages；
   - 提交信息约定：`feat: | fix: | data: | docs: | chore:` + 中文摘要。
5. **建库**：GitHub REST API 创建仓库需要 Personal Access Token，当前环境没有该 Token → 由你提供 Token（建议 `repo` + `workflow` 权限的 Fine-grained PAT）或在 GitHub 网页手动建空仓库（名称 `aihao123`，Public），我随后即可完成首次推送。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| RSS 源 403/429/改版 | 资讯缺源 | UA 伪装 + 指数退避重试 + 单源降级 + meta 记录 |
| GitHub 未认证 API 仅 60 次/小时、Search 10 次/分钟 | 抓取配额 | Actions 里注入 `GITHUB_TOKEN`（自带 1000 次/小时）；Search 串行 + 间隔 |
| MCP Registry schema 变更 | 目录解析失败 | 解析失败保留上一次成功数据，`meta.json` 标红 |
| 中文源反爬 | 中文资讯偏少 | 二期接网页版抓取或换源，页面始终标注数据源数量 |
| 站点内容同质化 | 无留存 | 榜单公式差异化 + 热词/霸榜等趣味榜单 + 人工精选导航 |

---

## 10. 后续（二期以后）路线

- 关键词订阅与 RSS 输出（让别人订阅我们的榜单）
- MCP/SKILL 一键复制安装命令（`npx`/`claude` 命令直出）
- 榜单历史曲线（SVG 静态图，纯前端）
- 多语言（中/英）
- Chrome 新标签页扩展，把导航做进浏览器

## 11. 国内镜像部署（阿里云）

GitHub Pages 国内访问不稳定，镜像方案见 `deploy/README.md`。要点：

- **抓数据必须在 GitHub Actions**（国内直连 HF/Google/Reddit 受限），服务器只做静态托管。
- 推荐**方式 A：服务器定时 `git pull` + 组装**（`deploy/sync-from-github.sh`，crontab 每 10 分钟）。
- 备选方式 B：Actions 用 SSH 密钥 rsync 推送（`deploy-aliyun.yml`）；方式 C：OSS+CDN；方式 D：Docker。
- 服务器需装 nginx（`deploy/nginx-aihao123.conf`），域名须 ICP 备案，HTTPS 用 certbot。
- 已提供 `deploy/` 下全部脚本与配置，含 Dockerfile。

---

## 附：常用命令

```bash
node scripts/fetch.mjs            # 抓取全部数据
node scripts/fetch.mjs news mcp   # 只抓指定数据集
node scripts/serve.mjs            # 本地预览 http://localhost:4173
git add -A && git commit -m "feat: xxx" && git push   # 每次改动后推送
```
