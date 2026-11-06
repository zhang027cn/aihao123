// 零依赖 RSS / Atom 解析器。容忍不规范的 XML（CDATA、实体、命名空间），
// 只关心 <item>/<entry> 块与常见字段，失败返回 []。
import { getText } from './http.mjs';

function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(s = '') {
  return decodeEntities(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi');
  return xml.match(re) || [];
}

function grab(block, ...names) {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${name}>`, 'i');
    const m = block.match(re);
    if (m) return stripTags(m[0]);
  }
  return '';
}

function grabAttr(block, name, attr) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>`, 'i');
  const m = block.match(re);
  if (m) {
    const am = m[0].match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
    if (am) return am[1];
  }
  return '';
}

function extractLink(block) {
  // Atom: <link href="..."/>；RSS: <link>...</link>
  const href = grabAttr(block, 'link', 'href');
  if (href) return decodeEntities(href);
  const body = grab(block, 'link');
  if (body) return decodeEntities(body);
  return '';
}

function parseDate(block) {
  const s = grab(block, 'pubDate', 'published', 'updated', 'dc:date');
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseFeedXml(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const items = [...matchBlocks(xml, 'item'), ...matchBlocks(xml, 'entry')];
  const out = [];
  for (const block of items) {
    const title = grab(block, 'title');
    const link = extractLink(block);
    if (!title || !link) continue;
    const summary = grab(block, 'description', 'summary', 'content', 'content:encoded');
    const published = parseDate(block);
    out.push({
      title,
      link,
      summary: summary.slice(0, 300),
      published,
      id: grab(block, 'guid', 'id') || link,
    });
  }
  return out;
}

export async function fetchFeed(url) {
  const xml = await getText(url, { timeoutMs: 12000, retries: 1 });
  return parseFeedXml(xml);
}
