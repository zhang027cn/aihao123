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

// ---------- 资讯 ----------
async function fetchNews() {
  const cfg = sources.news || {};
  const out = [];
  const cutoff = Date.now() - (cfg.maxAgeDays || 10) * 86400000;

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
  const out = { github: [], hfModels: [], hfSpaces: [], hn: [] };

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
  return [...ghPart, ...regPart];
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

  return dedupeBy(out, (x) => normText(x.name)).slice(0, cfg.maxItems || 60);
}

// ---------- 主流程 ----------
const datasets = process.argv.slice(2);
const all = datasets.length === 0;
const jobs = [];
if (all || datasets.includes('news')) jobs.push(['news', fetchNews]);
if (all || datasets.includes('rankings')) jobs.push(['rankings', fetchRankings]);
if (all || datasets.includes('mcp')) jobs.push(['mcp', fetchMcp]);
if (all || datasets.includes('skills')) jobs.push(['skills', fetchSkills]);

await mkdir(DATA, { recursive: true });
for (const [name, fn] of jobs) {
  try {
    const data = await fn();
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
