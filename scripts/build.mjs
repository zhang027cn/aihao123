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
