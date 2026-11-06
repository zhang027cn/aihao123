# AI Hao123

> 只做 AI 的中文导航站：AI 工具导航 + 每日 AI 资讯聚合 + 可复算的开源排行榜 + 公开免费的 MCP / SKILL 目录。

## 功能

| 板块 | 说明 |
|---|---|
| 🗂 **AI 导航** | 13 个人工精选分类、约 120 个 AI 站点直达入口（对话 / 编程 / 图像 / 视频 / 音频 / 智能体 / 搜索 / 模型算力 / 办公学习 / 资讯 / 社区 / MCP） |
| 📰 **AI 资讯** | 15+ 公开源（OpenAI、Hugging Face、Google AI、TechCrunch、The Verge、Ars、量子位、36Kr、少数派…）+ Hacker News，自动聚合去重 |
| 🔥 **排行榜** | GitHub AI 热力榜（⭐÷(1+距提交天数)）、HF 爆款模型 / Space、HN 热帖，算法可复算 |
| 🧩 **MCP 目录** | MCP 官方 Registry + GitHub 开源仓库，含许可证与部署方式 |
| 🛠 **SKILL 目录** | Anthropic 官方 skills + GitHub 开源技能仓库合集 |

**收录硬规则**：MCP / SKILL 只收**公开免费、开源**（OSI 认可许可证、未归档），宁缺毋滥。

## 技术栈

纯静态站点 + Node 数据管线（**零 npm 依赖**）+ GitHub Actions 定时更新 + GitHub Pages 托管。

## 本地运行

```bash
node scripts/fetch.mjs        # 抓取全部数据（资讯/榜单/MCP/SKILL）到 data/
node scripts/build.mjs        # 把 config/directory.json 内联为前端 JS
node scripts/serve.mjs        # 预览 http://localhost:4173
node scripts/check.mjs        # 校验目录与数据 schema
```

## 目录结构

```
config/          人工维护：directory.json（导航目录）、sources.json（数据源）
data/            机器生成：news/rankings/mcp/skills/meta.json
scripts/         fetch.mjs 数据管线 · build.mjs 内联目录 · serve.mjs 预览 · check.mjs 校验
site/            GitHub Pages 站点根（纯静态 HTML/CSS/JS）
```

## 数据更新

`.github/workflows/update-data.yml` 每 4 小时运行 `fetch.mjs` 并自动 commit + push（`[skip ci]` 避免循环触发）。

## 部署

推送到 `main` 分支后 `.github/workflows/deploy.yml` 自动构建并发布到 GitHub Pages。

## 版权与免责

资讯仅保留标题、摘要与原文链接，版权归原媒体所有；本站不存储任何模型权重或版权内容。
[MIT License](LICENSE)。
