// 资讯 AI 摘要生成器（薄壳）—— 真正逻辑在 scripts/lib/enrich.mjs。
// 主流程已改为 fetch.mjs 抓取后同进程生成摘要（抓取即摘要）；
// 本脚本保留为「手动补跑 / --all 强写 / CI 步骤兜底」入口，与 fetch 共用同一缓存与逻辑。
//
// 用法：
//   SENSENOVA_KEY=sk-xxx node scripts/summarize.mjs            # 补缺摘要条目
//   SENSENOVA_KEY=sk-xxx node scripts/summarize.mjs --all      # 强制重写全部
//   SENSENOVA_KEY=sk-xxx node scripts/summarize.mjs --limit 10
//   node scripts/summarize.mjs                                  # 无 key：仅规则补分类/标签
//
// 依赖 fetch.mjs 已生成 data/news.json（含 summary 字段）。

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichNews } from './lib/enrich.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS = join(ROOT, 'data', 'news.json');
const META = join(ROOT, 'data', 'meta.json');
const KEY = process.env.SENSENOVA_KEY || '';

const FORCE = process.argv.includes('--all');
const LIMIT_N = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

async function writeDiag(diag) {
  try {
    let meta = {};
    try { meta = JSON.parse(await readFile(META, 'utf8')); } catch {}
    meta.summarize = { ...diag, at: new Date().toISOString() };
    await writeFile(META, JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) { console.error('写 meta 诊断失败:', e.message); }
}

async function main() {
  let news = [];
  try {
    news = JSON.parse(await readFile(NEWS, 'utf8'));
  } catch {
    console.log('⚠ data/news.json 不存在，请先运行 node scripts/fetch.mjs');
    return;
  }

  const s = await enrichNews(news, { key: KEY, limit: LIMIT_N, force: FORCE });
  await writeFile(NEWS, JSON.stringify(news, null, 2), 'utf8');
  const withTags = news.filter((n) => Array.isArray(n.tags) && n.tags.length).length;

  await writeDiag({
    ...s,
    mode: FORCE ? 'force' : 'incremental',
    reason: s.key ? (s.generated === 0 && s.todo > 0 ? '全部生成失败（检查商汤配额/响应）' : '') : 'SENSENOVA_KEY 未配置（GitHub Secrets 缺失或未注入）',
  });
  console.log(`✔ 共 ${s.total} 条 | 缓存命中 ${s.cacheHit} | 种子 ${s.seeded} | 生成 ${s.generated} | 失败 ${s.failed} | 含 aiSummary ${s.withAi}/${s.total}(${s.aiRate}%) | 标签 ${withTags}/${s.total}`);
}

main().catch(async (e) => {
  console.error('✘ summarize.mjs 异常:', e.message);
  try {
    let meta = {};
    try { meta = JSON.parse(await readFile(META, 'utf8')); } catch {}
    meta.summarize = { key: !!process.env.SENSENOVA_KEY, fatal: String(e.message || e).slice(0, 200), at: new Date().toISOString() };
    await writeFile(META, JSON.stringify(meta, null, 2), 'utf8');
  } catch {}
  process.exit(1);
});
