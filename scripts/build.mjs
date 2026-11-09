// 把 config/directory.json（人工维护）内联为 site/assets/js/directory-data.js。
// 导航目录是 SEO 核心内容，必须直接进 HTML，不能依赖运行时网络加载。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = await readFile(join(ROOT, 'config/directory.json'), 'utf8');
const dir = JSON.parse(src);
const out = `// 由 config/directory.json 自动生成（node scripts/build.mjs），请勿手改
window.__DIRECTORY__ = ${JSON.stringify(dir)};\n`;
const file = join(ROOT, 'site/assets/js/directory-data.js');
await mkdir(dirname(file), { recursive: true });
await writeFile(file, out, 'utf8');
const n = dir.categories.reduce((a, c) => a + c.links.length, 0);
console.log(`✔ 内联目录: ${dir.categories.length} 个分类 / ${n} 个链接 -> site/assets/js/directory-data.js`);

// ---- SEO 产物：sitemap.xml + robots.txt（每次 build 自动更新） ----
// 主域（canonical 目标）：阿里云镜像。GitHub Pages 为镜像，靠 <link rel="canonical"> 收敛。
const SEO_BASE = (process.env.SEO_BASE_URL || 'https://aihao123.zgc.pub').replace(/\/$/, '');
const PAGES = [
  { path: '', prio: '1.0', freq: 'daily' },
  { path: 'news.html', prio: '0.9', freq: 'hourly' },
  { path: 'rankings.html', prio: '0.9', freq: 'daily' },
  { path: 'mcp.html', prio: '0.9', freq: 'daily' },
  { path: 'skills.html', prio: '0.9', freq: 'daily' },
  { path: 'about.html', prio: '0.5', freq: 'monthly' },
];
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url>
    <loc>${SEO_BASE}/${p.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.prio}</priority>
  </url>`).join('\n')}
</urlset>
`;
await writeFile(join(ROOT, 'site/sitemap.xml'), sitemap, 'utf8');
const robots = `User-agent: *
Allow: /
Disallow: /api/

# 站点地图
Sitemap: ${SEO_BASE}/sitemap.xml
`;
await writeFile(join(ROOT, 'site/robots.txt'), robots, 'utf8');
console.log(`✔ SEO: sitemap.xml + robots.txt（主域 ${SEO_BASE}）`);

// ---- SEO: 把真实数据注入 4 个列表页的静态 JSON-LD ----
// 搜索引擎爬虫多不执行 JS，动态列表对它是空白；这里在构建期把真实条目
// 写进 <script id="ld-data">，保证抓取时能看到完整内容。
const DOMAIN = SEO_BASE;
async function readData(name) {
  try { return JSON.parse(await readFile(join(ROOT, 'data', `${name}.json`), 'utf8')); } catch { return null; }
}
async function injectLd(pageFile, schema) {
  const file = join(ROOT, 'site', pageFile);
  let html = await readFile(file, 'utf8');
  const block = `  <script type="application/ld+json" id="ld-data">\n${JSON.stringify(schema, null, 1)}\n  </script>`;
  html = html.replace(/[ \t]*<script type="application\/ld\+json" id="ld-data">[\s\S]*?<\/script>/, block);
  await writeFile(file, html, 'utf8');
}

// 资讯页：ItemList + NewsArticle/Article
const news = (await readData('news')) || [];
await injectLd('news.html', {
  '@context': 'https://schema.org', '@type': 'ItemList', name: 'AI 资讯', url: `${DOMAIN}/news.html`,
  numberOfItems: news.length,
  itemListElement: news.slice(0, 50).map((n, i) => ({
    '@type': 'ListItem', position: i + 1,
    item: { '@type': 'NewsArticle', headline: String(n.title || '').slice(0, 110),
      url: n.link, datePublished: n.published, inLanguage: n.lang === 'zh' ? 'zh-CN' : 'en',
      articleSection: n.category || 'AI',
      description: String(n.aiSummary || n.summary || '').replace(/<[^>]+>/g, ' ').slice(0, 160),
      publisher: { '@type': 'Organization', name: n.source } },
  })),
});
console.log(`✔ SEO ld-data: news.html (${news.length} 条资讯注入前 50)`);

// 排行榜页：ItemList（国产大模型热度榜）
const rank = (await readData('rankings')) || {};
const cn = rank.cnModels || [];
await injectLd('rankings.html', {
  '@context': 'https://schema.org', '@type': 'ItemList', name: 'AI 排行榜 · 国产大模型热度榜',
  url: `${DOMAIN}/rankings.html`, numberOfItems: cn.length,
  itemListElement: cn.map((r, i) => ({ '@type': 'ListItem', position: i + 1,
    item: { '@type': 'SoftwareApplication', name: r.name, url: r.url,
      description: (r.description || '').slice(0, 160),
      applicationCategory: 'DeveloperApplication', operatingSystem: 'Cross-platform' } })),
});
console.log(`✔ SEO ld-data: rankings.html (国产榜 ${cn.length} 条)`);

// MCP 页：CollectionPage + ItemList
const mcp = (await readData('mcp')) || [];
await injectLd('mcp.html', {
  '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'MCP 目录',
  url: `${DOMAIN}/mcp.html`, inLanguage: 'zh-CN',
  mainEntity: { '@type': 'ItemList', numberOfItems: mcp.length,
    itemListElement: mcp.slice(0, 60).map((x, i) => ({ '@type': 'ListItem', position: i + 1,
      item: { '@type': 'SoftwareApplication', name: x.name, url: x.url,
        description: String(x.intro || x.description || '').replace(/<[^>]+>/g, ' ').slice(0, 180),
        applicationCategory: 'DeveloperApplication', keywords: (x.useCases || []).join(',').slice(0, 200) || undefined,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } } })) },
});
console.log(`✔ SEO ld-data: mcp.html (${mcp.length} 条)`);

// SKILL 页：CollectionPage + ItemList
const skill = (await readData('skills')) || [];
await injectLd('skills.html', {
  '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'SKILL 目录',
  url: `${DOMAIN}/skills.html`, inLanguage: 'zh-CN',
  mainEntity: { '@type': 'ItemList', numberOfItems: skill.length,
    itemListElement: skill.slice(0, 60).map((x, i) => ({ '@type': 'ListItem', position: i + 1,
      item: { '@type': 'SoftwareApplication', name: x.name, url: x.url,
        description: String(x.intro || x.description || '').replace(/<[^>]+>/g, ' ').slice(0, 180),
        applicationCategory: 'DeveloperApplication', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } } })) },
});
console.log(`✔ SEO ld-data: skills.html (${skill.length} 条)`);
