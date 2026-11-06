// 校验：config/directory.json 结构与 data/*.json 基本 schema
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, exists } from './lib/util.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
let errs = 0;
const bad = (m) => { errs++; console.error('✘ ' + m); };

const dir = await readJson(join(ROOT, 'config/directory.json'));
if (!dir?.categories?.length) bad('config/directory.json: 缺少 categories');
else {
  const seen = new Set(); // 跨分类允许重复（同一工具可出现在多个分类）
  const withinCat = new Set();
  for (const c of dir.categories) {
    if (!c.id || !c.title) bad(`分类 ${c.title}: 缺 id/title`);
    if (!c.links?.length) bad(`分类 ${c.title}: 无链接`);
    for (const l of c.links) {
      if (!l.name) bad(`分类 ${c.title}: 链接缺 name`);
      if (!/^https:\/\//.test(l.url || '')) bad(`分类 ${c.title} / ${l.name}: 链接非 https`);
      const catKey = c.id + '|' + l.name + l.url;
      if (withinCat.has(catKey)) bad(`分类 ${c.title} 内重复链接: ${l.name}`);
      withinCat.add(catKey);
      seen.add(l.name + l.url);
    }
  }
  console.log(`✔ directory.json: ${dir.categories.length} 个分类, ${seen.size} 个唯一链接`);
}

for (const f of ['news', 'rankings', 'mcp', 'skills']) {
  if (!(await exists(join(ROOT, `data/${f}.json`)))) {
    console.log(`… data/${f}.json 尚未生成（运行 node scripts/fetch.mjs）`);
    continue;
  }
  const d = await readJson(join(ROOT, `data/${f}.json`));
  if (!d) bad(`data/${f}.json: 解析失败`);
  else console.log(`✔ data/${f}.json: ${Array.isArray(d) ? d.length : Object.keys(d).length} 个顶层条目`);
}

if (errs) { console.error(`✘ 共 ${errs} 个问题`); process.exit(1); }
console.log('✔ 全部校验通过');
