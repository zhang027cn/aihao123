// 摘要懒加载服务 —— 阿里云服务器上的 node 进程（pm2 托管）
// 前端滚动到某条资讯时调用 GET /api/summary?id=xxx&title=...&summary=...
// 服务端按需调用商汤 SenseNova 生成摘要，磁盘缓存结果（同一 id 不重复扣费）。
//
// 安全：
//   - 商汤 key 只存在服务器环境变量 SENSENOVA_KEY（/etc/aihao-summary.env，0600），
//     绝不下发到前端。
//   - 入参只接受 id（短字符串）+ title/summary（文本），长度严格限制，防滥用。
//   - 并发受限（默认 2），磁盘缓存目录权限 0700。
//   - 无 key 或调用失败返回 {ok:false}，前端优雅降级显示原摘要。
//
// 启动：
//   SENSENOVA_KEY=sk-xxx node scripts/summary-server.mjs   # 端口默认 8790
// pm2:  pm2 start scripts/summary-server.mjs --name aihao-summary

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.summary-cache');
const PORT = Number(process.env.SUMMARY_PORT || 8790);
const HOST = '127.0.0.1'; // 只本地，经 nginx 反代暴露
const KEY = process.env.SENSENOVA_KEY || '';
const API_URL = 'https://token.sensenova.cn/v1/chat/completions';
const MODEL = 'sensenova-6.8-flash-lite';
const CONCURRENCY = Number(process.env.SUMMARY_CONCURRENCY || 2);
const MAX_TOKENS = 160;
const TTL_MS = 30 * 86400000; // 缓存 30 天

let active = 0;
const queue = [];

const SYSTEM = `你是中文科技资讯编辑，擅长把英文/中文 AI 新闻压缩成一句中文总结。
规则：
1. 输出 ONLY 一句中文（40 字以内），直接给出，不要标题、不要引号、不要 "总结：" 前缀。
2. 保留关键信息：谁、做了什么、有何意义/影响。
3. 不臆造原文没有的事实。`;

function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9:_\-]/g, '').slice(0, 100);
}
function hashKey(id) {
  return createHash('sha256').update(id).digest('hex').slice(0, 32);
}
function cacheFile(id) {
  return join(CACHE_DIR, hashKey(id) + '.json');
}
function cleanText(s, max) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function chat(prompt) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.6,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const c = (d.choices?.[0]?.message?.content || '').trim();
      if (!c) {
        lastErr = new Error('空响应');
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      return c.replace(/["'`]/g, '').trim().slice(0, 80);
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// 并发调度：同一时刻最多 CONCURRENCY 个生成任务
function schedule(fn) {
  return new Promise((resolve, reject) => {
    const job = async () => {
      try { resolve(await fn()); } catch (e) { reject(e); }
    };
    if (active < CONCURRENCY) {
      active++;
      job().finally(() => {
        active--;
        const next = queue.shift();
        if (next) { active++; next().finally(() => { active--; }); }
      });
    } else {
      queue.push(job);
    }
  });
}

async function getOrGenerate(id, title, summary) {
  const f = cacheFile(id);
  try {
    const st = await access(f);
    const cached = JSON.parse(await readFile(f, 'utf8'));
    if (cached && cached.aiSummary && Date.now() - cached.at < TTL_MS) return cached.aiSummary;
  } catch { /* cache miss */ }

  const prompt = `标题：${title}\n摘要：${summary || '（无摘要）'}\n\n请用一句中文总结这条 AI 资讯。`;
  const ai = await chat(prompt);
  try {
    await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
    await writeFile(f, JSON.stringify({ id, aiSummary: ai, at: Date.now() }), 'utf8');
  } catch { /* 缓存失败不影响返回 */ }
  return ai;
}

async function handler(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://aihao123.zgc.pub',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'OPTIONS') return send(204, {});
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (u.pathname !== '/api/summary' || req.method !== 'GET') return send(404, { ok: false, error: 'not found' });

  const id = safeId(u.searchParams.get('id'));
  const title = cleanText(u.searchParams.get('title'), 200);
  if (!id || !title) return send(400, { ok: false, error: 'missing id/title' });

  if (!KEY) return send(200, { ok: false, error: 'no-key', note: 'SENSENOVA_KEY 未配置' });

  try {
    const ai = await schedule(() => getOrGenerate(id, title, cleanText(u.searchParams.get('summary'), 300)));
    send(200, { ok: true, aiSummary: ai });
  } catch (e) {
    send(200, { ok: false, error: String(e.message || e).slice(0, 120) });
  }
}

createServer(handler).listen(PORT, HOST, () => {
  console.log(`AI Hao123 摘要服务: http://${HOST}:${PORT} (key=${KEY ? '已配置' : '未配置'})`);
});
