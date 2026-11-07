// 零依赖本地静态服务器：预览 site/ 并把 data/ 挂到 /data/
// 仅绑定 127.0.0.1（本地预览用途，不暴露公网）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const DATA = join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4173);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 确保解析出的路径仍在 base 目录内，防路径穿越
function resolveWithin(base, rel) {
  const full = normalize(join(base, rel));
  const b = normalize(base);
  if (full !== b && !full.startsWith(b + sep)) return null;
  return full;
}

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const clean = normalize(path).replace(/^(\.\.[/\\])+/, '');
    let base = SITE;
    let rel = clean;
    // /data/* 挂载到仓库 data/
    if (clean.startsWith('/data/')) {
      base = DATA;
      rel = clean.slice('/data/'.length);
    }
    const file = resolveWithin(base, rel);
    if (!file) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403 Forbidden');
    }
    let target = file;
    try {
      const st = await stat(target);
      if (st.isDirectory()) target = join(target, 'index.html');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 ' + e.message);
  }
}).listen(PORT, HOST, () => {
  console.log(`AI Hao123 预览: http://${HOST}:${PORT}`);
});
