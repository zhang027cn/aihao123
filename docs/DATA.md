# 数据字典

机器生成于 `data/`，由 `scripts/fetch.mjs` 定时刷新。勿手改。

| 文件 | 结构 | 说明 |
|---|---|---|
| `news.json` | `[{title,link,summary,published,source,sourceId,lang,id,points?,comments?}]` | 聚合去重后的 AI 资讯，按时间倒序，上限 120 条 |
| `rankings.json` | `{github:[{id,label,items:[Repo]}], hfModels:[Model], hfSpaces:[Space], hn:[HNItem]}` | 分组榜单 |
| `mcp.json` | `[{name,description,url,deploy,source,official,openSource,stars?,license?}]` | 公开免费开源的 MCP |
| `skills.json` | 同 mcp（`path?` 官方技能路径） | 公开免费开源的 SKILL |
| `meta.json` | `{generatedAt,datasets:{...},failures}` | 各源抓取状态与失败计数 |

## 字段要点

- `Repo`: `{fullName,url,description,stars,forks,license,openSource,pushedAt,archived,topics,heat}`
  - `heat = stars / (1 + daysSince(pushed_at))` —— 热力值，用于排序
- `Model`: `{id,name,url,downloads,likes,trendingScore,pipelineTag,tags}`
- `Space`: `{id,name,url,likes,trendingScore,sdk}`
- `deploy`: `stdio | sse | streamable-http`（MCP 连接方式）
- `official`: 是否来自官方 Registry / 官方仓库
