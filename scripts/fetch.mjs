// 数据管线主入口。零依赖（Node >= 20 自带 fetch）。
// 用法：
//   node scripts/fetch.mjs            抓取全部数据集
//   node scripts/fetch.mjs news       只抓资讯
//   node scripts/fetch.mjs rankings   只抓榜单
//   node scripts/fetch.mjs mcp skills 只抓目录
//
// 设计原则：
//   - 每个数据源独立 try/catch，单源失败绝不影响其它源。
//   - 结果写入 data/*.json，同时记录 meta.json（各源状态 + 时间戳）。
//   - GitHub 未认证限额低（核心 60/h、搜索 10/min），CI 里注入 GITHUB_TOKEN 自动获得 1000/h。

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, getText } from './lib/http.mjs';
import { fetchFeed } from './lib/rss.mjs';
import { writeJson, readJson, dedupeBy, normText, isOsiLicense, daysSince, sanitizeUrl } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const sources = await readJson(join(ROOT, 'config/sources.json'), {});
const featuredTools = await readJson(join(ROOT, 'config/featured-tools.json'), { mcp: [], skills: [] });

const token = process.env.GITHUB_TOKEN || '';
const ghHeaders = token ? { Authorization: `Bearer ${token}` } : {};

const meta = {
  generatedAt: new Date().toISOString(),
  datasets: {},
};
let failures = 0;

function record(dataset, source, ok, detail = {}) {
  meta.datasets[dataset] ??= {};
  meta.datasets[dataset][source] = { ok, at: new Date().toISOString(), ...detail };
  if (!ok) failures++;
}

// 把人工精选的特色条目（config/featured-tools.json）合并进抓取结果。
// 已收录的按 name 匹配并增强 intro/useCases/howTo/install；未收录的作为新条目追加。
function mergeFeatured(kind, items, limit) {
  const feats = (featuredTools[kind] || []).slice(0, limit || 60);
  const map = new Map(items.map((x) => [String(x.name).toLowerCase(), x]));
  const featsToAdd = [];
  for (const f of feats) {
    const key = String(f.name).toLowerCase();
    const exist = map.get(key);
    if (exist) {
      exist.intro = f.intro;
      exist.useCases = f.useCases;
      exist.howTo = f.howTo;
      exist.install = f.install;
      exist.featured = true;
      exist.official = f.official ?? exist.official;
    } else {
      featsToAdd.push({
        id: `featured:${key}`,
        name: f.name,
        url: sanitizeUrl(f.url) || '#',
        description: f.intro,
        intro: f.intro,
        useCases: f.useCases,
        howTo: f.howTo,
        install: f.install,
        featured: true,
        official: !!f.official,
        openSource: true,
        stars: 0,
        license: '',
        source: 'featured',
      });
    }
  }
  // 特色条目置顶：已收录的排前，新追加的紧随其后
  const featuredExist = items.filter((x) => x.featured);
  const normal = items.filter((x) => !x.featured);
  return [...featuredExist, ...featsToAdd, ...normal].slice(0, limit || 60);
}

// ---------- 资讯 ----------
async function fetchNews() {
  const cfg = sources.news || {};
  const out = [];
  const cutoff = Date.now() - (cfg.maxAgeDays || 25) * 86400000;

  for (const feed of cfg.feeds || []) {
    try {
      const items = await fetchFeed(feed.url);
      let n = 0;
      for (const it of items) {
        const link = sanitizeUrl(it.link);
        if (!link) continue; // 丢弃非 http/https 链接
        if (!it.published || Date.parse(it.published) < cutoff) continue;
        if (feed.filter && !new RegExp(feed.filter, 'i').test(it.title)) continue;
        out.push({
          title: it.title,
          link,
          summary: it.summary,
          published: it.published,
          source: feed.name,
          sourceId: feed.id,
          lang: feed.lang,
          id: `${feed.id}:${normText(it.title).slice(0, 80)}`,
        });
        n++;
      }
      record('news', feed.id, true, { items: n });
    } catch (e) {
      record('news', feed.id, false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  // Hacker News 热帖（AI 相关）
  if (cfg.hn?.enabled) {
    const hn = cfg.hn;
    try {
      const since = Math.floor((Date.now() - hn.maxAgeDays * 86400000) / 1000);
      let hnItems = [];
      for (const q of hn.queries) {
        const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=30&numericFilters=points>${hn.minPoints},created_at_i>${since}`;
        const d = await getJson(url, { timeoutMs: 12000 });
        for (const h of d.hits || []) {
          const link = sanitizeUrl(h.url) || `https://news.ycombinator.com/item?id=${h.objectID}`;
          hnItems.push({
            title: h.title,
            link,
            published: h.created_at,
            points: h.points,
            comments: h.num_comments,
            source: 'Hacker News',
            sourceId: 'hn',
            lang: 'en',
            id: `hn:${h.objectID}`,
          });
        }
      }
      hnItems.sort((a, b) => (b.points || 0) - (a.points || 0));
      out.push(...hnItems.slice(0, hn.maxItems));
      record('news', 'hn', true, { items: Math.min(hnItems.length, hn.maxItems) });
    } catch (e) {
      record('news', 'hn', false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  out.sort((a, b) => Date.parse(b.published || 0) - Date.parse(a.published || 0));
  const deduped = dedupeBy(out, (x) => normText(x.title).slice(0, 120));
  return deduped.slice(0, cfg.maxItems || 120);
}

// ---------- GitHub 榜单/目录通用 ----------
async function ghSearch(query, sort, limit) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort || 'stars'}&order=desc&per_page=${Math.min(limit, 50)}`;
  const d = await getJson(url, { headers: ghHeaders, timeoutMs: 15000 });
  return (d.items || []).map((i) => ({
    id: i.full_name,
    name: i.name,
    fullName: i.full_name,
    url: sanitizeUrl(i.html_url) || `https://github.com/${i.full_name}`,
    description: (i.description || '').slice(0, 240),
    stars: i.stargazers_count,
    forks: i.forks_count,
    license: (i.license || {}).spdx_id || '',
    openSource: isOsiLicense(i.license),
    pushedAt: i.pushed_at,
    archived: i.archived,
    topics: (i.topics || []).slice(0, 8),
    heat: Math.round(i.stargazers_count / (1 + daysSince(i.pushed_at))),
  }));
}

async function fetchRankings() {
  const cfg = sources.rankings || {};
  const out = { github: [], hfModels: [], hfSpaces: [], hn: [], cnModels: [], hotTopics: [], newRising: [], agents: [] };

  for (const q of cfg.github || []) {
    try {
      const items = await ghSearch(q.query, q.sort, q.limit);
      out.github.push({ id: q.id, label: q.label, items });
      record('rankings', `gh:${q.id}`, true, { items: items.length });
    } catch (e) {
      record('rankings', `gh:${q.id}`, false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  try {
    const d = await getJson(`https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${cfg.hfModels?.limit || 20}`, { timeoutMs: 15000 });
    out.hfModels = d.map((m) => ({
      id: m.id,
      name: m.id,
      url: `https://huggingface.co/${m.id}`,
      downloads: m.downloads,
      likes: m.likes,
      trendingScore: m.trendingScore,
      pipelineTag: (m.pipeline_tag || ''),
      tags: (m.tags || []).filter((t) => t.startsWith('license:') || t.startsWith('base_model')).slice(0, 4),
    }));
    record('rankings', 'hf-models', true, { items: out.hfModels.length });
  } catch (e) {
    record('rankings', 'hf-models', false, { error: String(e.message || e).slice(0, 120) });
  }

  try {
    const d = await getJson(`https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=${cfg.hfSpaces?.limit || 20}`, { timeoutMs: 15000 });
    out.hfSpaces = d.map((s) => ({
      id: s.id,
      name: s.id,
      url: `https://huggingface.co/spaces/${s.id}`,
      likes: s.likes,
      trendingScore: s.trendingScore,
      sdk: s.sdk,
    }));
    record('rankings', 'hf-spaces', true, { items: out.hfSpaces.length });
  } catch (e) {
    record('rankings', 'hf-spaces', false, { error: String(e.message || e).slice(0, 120) });
  }

  try {
    const since = Math.floor((Date.now() - 7 * 86400000) / 1000);
    let all = [];
    for (const q of cfg.hn?.queries || []) {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=30&numericFilters=points>${cfg.hn.minPoints},created_at_i>${since}`;
      const d = await getJson(url, { timeoutMs: 12000 });
      all.push(...(d.hits || []));
    }
    all.sort((a, b) => (b.points || 0) - (a.points || 0));
    out.hn = dedupeBy(all, (h) => h.objectID).slice(0, cfg.hn?.limit || 20).map((h) => ({
      id: h.objectID,
      title: h.title,
      url: sanitizeUrl(h.url) || `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points,
      comments: h.num_comments,
      published: h.created_at,
      source: 'Hacker News',
    }));
    record('rankings', 'hn', true, { items: out.hn.length });
  } catch (e) {
    record('rankings', 'hn', false, { error: String(e.message || e).slice(0, 120) });
  }

  // ---------- 特色榜单（本站原创） ----------
  const feat = cfg.featured || {};
  const news = await readJson(join(DATA, 'news.json'), []);

  // 方案1 国产大模型热度榜：聚合各 org 星标 + 资讯提及
  if (feat.cnModels) {
    try {
      const orgs = feat.cnModels.orgs || [];
      // GitHub org -> 中文品牌名/关键词（用于展示 + 资讯提及匹配）
      const brand = {
        'deepseek-ai': 'DeepSeek', 'QwenLM': 'Qwen', 'THUDM': '智谱', 'zhipuai': '智谱', 'MoonshotAI': 'Kimi',
        'MiniMax-AI': 'MiniMax', '01-ai': '零一万物', 'stepfun-ai': '阶跃星辰', 'internlm': 'InternLM',
        'Tencent': '腾讯', 'baidu': '百度', 'aliyun': '阿里',
      };
      const rows = [];
      for (const org of orgs) {
        try {
          const d = await getJson(`https://api.github.com/orgs/${org}/repos?sort=stars&per_page=20`, { headers: ghHeaders, timeoutMs: 12000 });
          const totalStars = (d || []).reduce((n, r) => n + (r.stargazers_count || 0), 0);
          const top = (d || []).sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))[0];
          if (!top) continue;
          const name = brand[org] || top.name || org;
          const keywords = [name.toLowerCase(), org.toLowerCase(), brand[org]?.toLowerCase()].filter(Boolean);
          const mention = news.filter((n) => {
            const text = (n.title + ' ' + (n.aiSummary || n.summary || '')).toLowerCase();
            return keywords.some((k) => text.includes(k));
          }).length;
          const heat = Math.round(Math.log(1 + totalStars) * 10 + mention * 4);
          rows.push({
            id: `cn:${org}`,
            name,
            org,
            url: sanitizeUrl(top.html_url) || `https://github.com/${org}`,
            description: (top.description || '').slice(0, 180),
            stars: totalStars,
            mentions: mention,
            heat,
            cn: true,
          });
        } catch { /* 单个 org 失败跳过 */ }
      }
      rows.sort((a, b) => b.heat - a.heat);
      out.cnModels = rows.slice(0, feat.cnModels.limit || 15);
      record('rankings', 'featured:cn-models', true, { items: out.cnModels.length });
    } catch (e) {
      record('rankings', 'featured:cn-models', false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  // 方案4 AI 话题热议榜：聚合资讯 tags 为话题（排除分类兜底标签）
  if (feat.hotTopics) {
    try {
      const CAT = new Set(['大模型', '智能体', '开源', '芯片算力', '政策监管', '应用落地', '研究论文', '行业动态']);
      const topic = new Map();
      for (const n of news) {
        const tags = Array.isArray(n.tags) ? n.tags : [n.category || 'AI'].filter(Boolean);
        for (const t of tags) {
          if (CAT.has(t)) continue; // 分类兜底不算话题
          const cur = topic.get(t) || { tag: t, count: 0, sources: new Set() };
          cur.count++;
          cur.sources.add(n.source);
          topic.set(t, cur);
        }
      }
      out.hotTopics = [...topic.values()]
        .map((t) => ({ tag: t.tag, count: t.count, sourceCount: t.sources.size }))
        .sort((a, b) => b.count - a.count || b.sourceCount - a.sourceCount)
        .slice(0, feat.hotTopics.maxItems || 15);
      record('rankings', 'featured:hot-topics', true, { items: out.hotTopics.length });
    } catch (e) {
      record('rankings', 'featured:hot-topics', false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  // 方案6 AI 开源新锐榜：近期新项目 + star 增速
  if (feat.newRising) {
    try {
      const items = await ghSearch(feat.newRising.query, 'stars', feat.newRising.limit);
      out.newRising = items.map((r) => ({
        ...r,
        heat: Math.round(r.stars / Math.max(1, Math.pow(daysSince(r.pushedAt) + 1, 1.2))),
      })).sort((a, b) => b.heat - a.heat);
      record('rankings', 'featured:new-rising', true, { items: out.newRising.length });
    } catch (e) {
      record('rankings', 'featured:new-rising', false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  // 方案7 AI 智能体赛道榜：固定知名框架仓库（星标）+ 资讯提及
  if (feat.agents) {
    try {
      const repos = feat.agents.repos || [];
      const rows = [];
      for (const full of repos) {
        try {
          const r = await getJson(`https://api.github.com/repos/${full}`, { headers: ghHeaders, timeoutMs: 12000 });
          if (!r?.full_name) continue;
          const name = r.name || full;
          const mention = news.filter((n) => (n.title + ' ' + (n.aiSummary || n.summary || '')).toLowerCase().includes(name.toLowerCase())).length;
          rows.push({
            id: r.full_name,
            name: r.full_name,
            url: sanitizeUrl(r.html_url) || `https://github.com/${r.full_name}`,
            description: (r.description || '').slice(0, 180),
            stars: r.stargazers_count,
            forks: r.forks_count,
            license: (r.license || {}).spdx_id || '',
            pushedAt: r.pushed_at,
            mentions: mention,
            heat: Math.round(r.stargazers_count / (1 + daysSince(r.pushed_at)) + mention * 5),
          });
        } catch { /* 单个仓库失败跳过 */ }
      }
      rows.sort((a, b) => b.heat - a.heat);
      out.agents = rows.slice(0, feat.agents.limit || 15);
      record('rankings', 'featured:agents', true, { items: out.agents.length });
    } catch (e) {
      record('rankings', 'featured:agents', false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  return out;
}

// ---------- MCP 目录 ----------
// 优先级：GitHub 开源仓库（有 license/stars 硬校验）在前，官方 Registry 填剩余名额。
async function fetchMcp() {
  const cfg = sources.mcp || {};
  const github = [];
  const registry = [];

  for (const q of cfg.github || []) {
    try {
      const items = await ghSearch(q.query, q.sort, q.limit);
      const mapped = items.filter((i) => i.openSource && !i.archived).map((i) => ({
        ...i,
        source: 'github',
        official: false,
        deploy: i.topics.some((t) => t.includes('sse')) ? 'sse' : i.topics.some((t) => t.includes('http')) ? 'streamable-http' : 'stdio',
      }));
      github.push(...mapped);
      record('mcp', `gh:${q.id}`, true, { items: mapped.length });
    } catch (e) {
      record('mcp', `gh:${q.id}`, false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  if (cfg.registry?.enabled) {
    try {
      let cursor = null;
      let pages = 0;
      while (pages < (cfg.registry.maxPages || 4)) {
        const url = `${cfg.registry.baseUrl}?limit=${cfg.registry.pageSize || 50}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const d = await getJson(url, { timeoutMs: 20000 });
        for (const s of d.servers || []) {
          const server = s.server || s;
          const first = server.remotes?.[0];
          const remote = first?.url || '';
          const registryUrl = sanitizeUrl(server.repository) || sanitizeUrl(server.homepage) || sanitizeUrl(remote);
          registry.push({
            id: server.name,
            name: server.title || server.name,
            slug: server.name,
            description: (server.description || '').slice(0, 240),
            url: registryUrl,
            deploy: (first?.type || '').includes('streamable-http') ? 'streamable-http' : (first?.type || '').includes('sse') ? 'sse' : 'stdio',
            source: 'official-registry',
            official: true,
            openSource: true,
            stars: 0,
            license: '',
            version: server.version || '',
          });
        }
        cursor = d.metadata?.nextCursor;
        pages++;
        if (!cursor) break;
      }
      record('mcp', 'official-registry', true, { items: registry.length });
    } catch (e) {
      record('mcp', 'official-registry', false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  const limit = cfg.maxItems || 60;
  const deduped = dedupeBy([...github, ...registry], (x) => normText(x.name));
  // GitHub 条目保持 stars 排序优先占位；Registry 补足
  const ghPart = deduped.filter((x) => x.source === 'github').slice(0, limit);
  const regPart = deduped.filter((x) => x.source !== 'github').slice(0, Math.max(0, limit - ghPart.length));
  // 合并人工精选特色 MCP（简介/场景/方法），已收录增强、未收录追加，特色置顶
  return mergeFeatured('mcp', [...ghPart, ...regPart], limit);
}

// ---------- SKILL 目录 ----------
async function fetchSkills() {
  const cfg = sources.skills || {};
  const out = [];

  // Anthropic 官方 skills 仓库：直接取仓库树里的 SKILL.md
  try {
    const tree = await getJson('https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1', { headers: ghHeaders, timeoutMs: 20000 });
    const skillPaths = (tree.tree || []).filter((t) => t.path.endsWith('SKILL.md'));
    const repo = await getJson('https://api.github.com/repos/anthropics/skills', { headers: ghHeaders, timeoutMs: 15000 });
    for (const p of skillPaths) {
      const dir = p.path.split('/').slice(0, -1).join('/');
      const name = dir.split('/').pop() || dir;
      out.push({
        id: `anthropics:${dir}`,
        name,
        description: 'Anthropic 官方技能（Skills）',
        url: `https://github.com/anthropics/skills/tree/main/${dir}`,
        source: 'anthropics/skills',
        official: true,
        openSource: true,
        stars: repo.stargazers_count,
        license: (repo.license || {}).spdx_id || '',
        path: dir,
      });
    }
    record('skills', 'anthropics-official', true, { items: out.length });
  } catch (e) {
    record('skills', 'anthropics-official', false, { error: String(e.message || e).slice(0, 120) });
  }

  for (const q of cfg.github || []) {
    try {
      const items = await ghSearch(q.query, q.sort, q.limit);
      const mapped = items.filter((i) => i.openSource && !i.archived).map((i) => ({
        ...i,
        source: 'github',
        official: false,
      }));
      out.push(...mapped);
      record('skills', `gh:${q.id}`, true, { items: mapped.length });
    } catch (e) {
      record('skills', `gh:${q.id}`, false, { error: String(e.message || e).slice(0, 120) });
    }
  }

  const merged = dedupeBy(out, (x) => normText(x.name)).slice(0, cfg.maxItems || 60);
  // 合并人工精选特色 SKILL（简介/场景/方法），特色置顶
  return mergeFeatured('skills', merged, cfg.maxItems || 60);
}

// ---------- 主流程 ----------
const datasets = process.argv.slice(2);
const all = datasets.length === 0;
const jobs = [];
if (all || datasets.includes('news')) jobs.push(['news', fetchNews]);
if (all || datasets.includes('rankings')) jobs.push(['rankings', fetchRankings]);
if (all || datasets.includes('mcp')) jobs.push(['mcp', fetchMcp]);
if (all || datasets.includes('skills')) jobs.push(['skills', fetchSkills]);

// 合并回上次生成的 AI 摘要/分类（按 id 匹配），避免 fetch 重建后丢失 LLM 结果。
async function mergeNewsEnrichment(prev, next) {
  const map = new Map((prev || []).map((n) => [n.id, n]));
  let restored = 0;
  for (const n of next) {
    const p = map.get(n.id);
    if (p?.aiSummary) {
      n.aiSummary = p.aiSummary;
      n.category = p.category;
      n.summaryStatus = p.summaryStatus || 'ai';
      restored++;
    }
    // 分类/关键词标签是零成本规则产物，只要有就复用（即使无 aiSummary）
    if (p?.category && !n.category) n.category = p.category;
    if (Array.isArray(p?.tags) && p.tags.length) n.tags = p.tags;
  }
  return restored;
}

// 方案B：合并服务器懒加载回写的摘要（enrich.json，服务器权威副本）
// 来源 https://aihao123.zgc.pub/data/enrich.json（pm2 服务原子写入的 web root 副本）。
// 只做「缺失补齐」：news.json 已有 aiSummary 的不覆盖（本地 CI 生成优先），防止互相踢。
async function mergeServerEnrich(next) {
  const ENRICH_URL = process.env.ENRICH_URL || 'https://aihao123.zgc.pub/data/enrich.json';
  try {
    const enrich = await getJson(ENRICH_URL, { timeoutMs: 10000 });
    if (!enrich || typeof enrich !== 'object') return 0;
    let merged = 0;
    for (const n of next) {
      const e = enrich[n.id];
      if (e?.aiSummary && !n.aiSummary) {
        n.aiSummary = e.aiSummary;
        n.summaryStatus = 'lazy';
        merged++;
      }
    }
    record('news', '_enrich', true, { source: 'server-lazy', items: Object.keys(enrich).length, merged });
    return merged;
  } catch (e) {
    // 服务器 enrich 还不存在/暂时拉不到都不影响主流程
    record('news', '_enrich', false, { error: String(e.message || e).slice(0, 120) });
    return 0;
  }
}

await mkdir(DATA, { recursive: true });
for (const [name, fn] of jobs) {
  try {
    const data = await fn();
    if (name === 'news') {
      const prev = await readJson(join(DATA, 'news.json'), []);
      const restored = await mergeNewsEnrichment(prev, data);
      meta.datasets.news = meta.datasets.news || {};
      meta.datasets.news._aiRestored = restored;
      console.log(`   ↺ 复用既有 AI 摘要 ${restored} 条`);
      const lazyMerged = await mergeServerEnrich(data);
      if (lazyMerged) console.log(`   ↺ 拉回服务器懒加载摘要 ${lazyMerged} 条`);
    }
    await writeJson(join(DATA, `${name}.json`), data);
    meta.datasets[name] ??= {};
    meta.datasets[name]._total = Array.isArray(data) ? data.length : Object.values(data).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
    console.log(`✔ ${name}: ${meta.datasets[name]._total} 条`);
  } catch (e) {
    record(name, '_fatal', false, { error: String(e.message || e).slice(0, 160) });
    console.error(`✘ ${name}: ${e.message}`);
  }
}

await writeJson(join(DATA, 'meta.json'), { ...meta, failures });
console.log(failures === 0 ? '✔ 全部源成功' : `⚠ ${failures} 个源失败（已记录于 data/meta.json）`);
