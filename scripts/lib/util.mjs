// 通用工具：文件读写、去重、日期、许可证白名单
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function dedupeBy(items, keyFn = (x) => x.id) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function normText(s = '') {
  return s
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
    .trim();
}

// OSI 认可的宽松许可证（含常见宽松 + GPL 家族）
const OSI = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0',
  'Unlicense', 'CC0-1.0', 'GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'LGPL-3.0',
  'EPL-2.0', 'Python-2.0', 'WTFPL', '0BSD', 'MIT-0', 'PostgreSQL', 'Zlib', 'BSD-4-Clause',
]);
export function isOsiLicense(license) {
  const spdx = license?.spdx_id || license?.key || license;
  return typeof spdx === 'string' && OSI.has(spdx);
}

export function daysSince(dateStr) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return 999;
  return Math.max(0, (Date.now() - t) / 86400000);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
