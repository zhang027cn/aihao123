// 资讯 AI 摘要生成器 —— 调用商汤 SenseNova（sensenova-6.8-flash-lite）
// 为 data/news.json 的每条资讯生成 aiSummary（一句话中文总结）与 category（分类标签）。
//
// 设计原则：
//   - 零 npm 依赖，用 Node >= 20 自带 fetch。
//   - 只处理「还没生成过 aiSummary」的条目（按 id 缓存），未变化的条目不重复扣费。
//   - 并发受限（默认 4），单条失败不影响整体，失败条目保留原 summary 并标记。
//   - 无 key 时跳过（不报错），纯静态降级。
//
// 用法：
//   SENSENOVA_KEY=sk-xxx node scripts/summarize.mjs            # 处理全部缺摘要的条目
//   SENSENOVA_KEY=sk-xxx node scripts/summarize.mjs --all     # 强制重写全部
//   SENSENOVA_KEY=sk-xxx node scripts/summarize.mjs --limit 10
//
// 依赖 fetch.mjs 已生成 data/news.json（含 summary 字段）。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS = join(ROOT, 'data', 'news.json');
const KEY = process.env.SENSENOVA_KEY || '';
const URL = 'https://token.sensenova.cn/v1/chat/completions';
const MODEL = 'sensenova-6.8-flash-lite';

const FORCE = process.argv.includes('--all');
const LIMIT_N = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();
const CONCURRENCY = Number(process.env.SUMMARIZE_CONCURRENCY || 2);
const MAX_TOKENS = Number(process.env.SUMMARIZE_MAX_TOKENS || 160);

// 分类规则：标题/摘要命中关键词 → 标签。首个命中优先。
const CATEGORY_RULES = [
  ['大模型', ['gpt', 'llm', 'claude', 'gemini', 'deepseek', 'qwen', '千问', '通义', '大模型', 'foundation model', 'frontier model', 'reasoning model', '多模态']],
  ['智能体', ['agent', '智能体', 'autonomous', 'mcp', 'tool use', '多智能体', 'orchestration', 'agentic']],
  ['开源', ['open source', 'open-source', '开源', 'weights', 'hugging face', 'hf', 'github', 'llama', 'mistral', 'release']],
  ['芯片算力', ['chip', 'gpu', 'nvidia', 'amd', 'tpu', '半导体', '芯片', '算力', 'datacenter', 'data center', 'cerebras', 'grok', 'h200', 'b200', 'inference']],
  ['政策监管', ['regulation', 'regulatory', 'law', 'policy', 'ban', '欧盟', 'ai act', 'copyright', 'lawsuit', 'compliance', '安全']],
  ['应用落地', ['enterprise', 'business', 'deploy', 'adoption', 'product', 'industry', 'customer', 'revenue', '应用', '落地', '企业', 'saas', 'copilot', 'coding', 'developer']],
  ['研究论文', ['paper', 'research', 'study', 'arxiv', 'benchmark', '论文', '研究', 'dataset', 'evaluation', 'leaderboard']],
];
const DEFAULT_CAT = '行业动态';

function classify(text) {
  const s = String(text || '').toLowerCase();
  for (const [cat, words] of CATEGORY_RULES) {
    if (words.some((w) => s.includes(w))) return cat;
  }
  return DEFAULT_CAT;
}

function cleanSummary(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

async function chat(system, user) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.6,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        // 限流/服务端错误：退避重试
        lastErr = new Error(`HTTP ${res.status}（第 ${attempt + 1} 次）`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 160)}`);
      }
      const d = await res.json();
      const content = (d.choices?.[0]?.message?.content || '').trim();
      if (!content) {
        // 6.8 Flash Lite 预览版偶发空响应，退避重试
        lastErr = new Error('空响应（第 ' + (attempt + 1) + ' 次）');
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      return content;
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

const SYSTEM = `你是中文科技资讯编辑，擅长把英文/中文 AI 新闻压缩成一句话中文总结。
规则：
1. 输出 ONLY 一句中文（40 字以内），直接给出，不要标题、不要引号、不要 "总结：" 前缀。
2. 保留关键信息：谁、做了什么、有何意义/影响。
3. 不臆造原文没有的事实。`;

async function summarizeItem(item) {
  const title = String(item.title || '').trim();
  const summary = cleanSummary(item.summary);
  const prompt = `标题：${title}\n摘要：${summary || '（无摘要）'}\n\n请用一句中文总结这条 AI 资讯。`;

  // 分类用规则生成（零成本、稳定），避免让 LLM 承担分类不确定性
  item.category = classify(title + ' ' + summary);
  try {
    const ai = await chat(SYSTEM, prompt);
    const cleaned = ai.replace(/["'`]/g, '').trim();
    if (cleaned.length >= 6) {
      item.aiSummary = cleaned.slice(0, 80);
      item.summaryStatus = 'ai';
    } else {
      throw new Error('内容过短');
    }
  } catch (e) {
    item.summaryStatus = 'fallback'; // 降级：保留原 summary
    item.summaryError = String(e.message || e).slice(0, 80);
    if (item.aiSummary) delete item.aiSummary;
  }
  return item;
}

async function main() {
  if (!KEY) {
    console.log('⚠ 未设置 SENSENOVA_KEY，跳过 AI 摘要（纯静态降级）');
    return;
  }
  let news = [];
  try {
    news = JSON.parse(await readFile(NEWS, 'utf8'));
  } catch {
    console.log('⚠ data/news.json 不存在，请先运行 node scripts/fetch.mjs');
    return;
  }
  const todo = news.filter((n) => FORCE || !n.aiSummary);
  console.log(`📰 共 ${news.length} 条，需生成摘要 ${todo.length} 条${FORCE ? '（--all 强制重写）' : ''}`);

  let done = 0;
  let ok = 0;
  let fail = 0;
  const targets = todo.slice(0, LIMIT_N);
  const queue = [...targets];

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        await summarizeItem(item);
        ok++;
      } catch (e) {
        fail++;
        console.error(`  ✘ ${String(item.title).slice(0, 40)}: ${e.message}`);
      }
      done++;
      if (done % 10 === 0) console.log(`  … ${done}/${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length || 1) }, worker));

  await writeFile(NEWS, JSON.stringify(news, null, 2), 'utf8');
  const withAi = news.filter((n) => n.aiSummary).length;
  console.log(`✔ 完成：新增/更新摘要 ${ok} 条，失败 ${fail} 条，当前含 aiSummary ${withAi}/${news.length} 条`);
}

main().catch((e) => {
  console.error('✘ summarize.mjs 异常:', e.message);
  process.exit(1);
});
