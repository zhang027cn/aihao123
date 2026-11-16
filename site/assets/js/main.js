// 共享：数据加载、搜索、头部行为、工具函数
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  async function getData(name, fallback = null) {
    try {
      const res = await fetch(`data/${name}.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      console.warn(`加载 data/${name}.json 失败`, e);
      return fallback;
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 只允许 http/https 绝对 URL，阻止 javascript:/data:/vbscript: 等协议注入
  function safeUrl(u) {
    const s = String(u ?? '').trim();
    return /^https?:\/\//i.test(s) ? s : '#';
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
    return new Date(iso).toLocaleDateString('zh-CN');
  }
  function fmt(n) {
    if (n == null) return '-';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  // ---- 懒加载摘要：严格串行队列（同时最多 1 个请求，绝不并发）----
  // 首页/资讯页共用；429/网络失败退避重试，最终失败保留占位不清空。
  const _sumQ = { items: [], done: new Set(), active: false };
  function _sumApply(id, text) {
    document.querySelectorAll('[data-summary-for="' + CSS.escape(id) + '"]').forEach((el) => {
      // 只更新文本节点，保留刷新按钮与结构（旧实现 textContent 会连按钮一起清掉）
      const ph = el.querySelector('.sum-placeholder');
      if (ph) ph.remove();
      let first = el.firstChild;
      if (first && first.nodeType === 3) { first.nodeValue = text; return; }
      if (first && first.nodeType !== 3) first.remove();  // 防御：首个子节点非文本则移除
      el.insertBefore(document.createTextNode(text), el.firstChild);
    });
  }
  function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  async function _sumFetchOne(n) {
    // 主域同源直调；GitHub Pages 等镜像跨域调主域 API（服务器白名单 + CORS 反射）
    const API = (location.hostname === 'aihao123.zgc.pub') ? '' : 'https://aihao123.zgc.pub';
    const url = `${API}/api/summary?id=${encodeURIComponent(n.id)}&title=${encodeURIComponent(n.title || '')}&summary=${encodeURIComponent(n.summary || '')}` + (n.force ? '&force=1' : '');
    try {
      const res = await fetch(url);
      if (res.status === 429) { await _sleep(2500); return; }   // 限流：退避后放弃（刷新按钮可再点）
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (d.ok && d.aiSummary) {
        n.aiSummary = d.aiSummary;                 // 同步数据源，切 tab/重渲染不回退旧文案
        _sumApply(n.id, '🤖 ' + d.aiSummary);
      }
      // 失败（无 key/负缓存/空）：保留原占位或旧文案，不清空
    } catch (e) {
      // 网络失败同样保留原文案
    } finally {
      if (n.btn) {
        n.btn.disabled = false;
        n.btn.classList.remove('spin');
        n.btn.title = '重新生成 AI 摘要';
      }
    }
  }

  // 公共出队：严格串行消费队列
  async function _drain() {
    if (_sumQ.active) return;
    _sumQ.active = true;
    try {
      while (_sumQ.items.length) {
        const n = _sumQ.items.shift();
        await _sumFetchOne(n);   // 串行：上一条完成才发下一条
      }
    } finally {
      _sumQ.active = false;
    }
  }
  async function requestSummary(list) {
    for (const n of list) {
      if (n.aiSummary || !n.id || _sumQ.done.has(n.id)) continue;
      _sumQ.done.add(n.id);
      _sumQ.items.push(n);
    }
    return _drain();
  }

  // ---- 重新生成按钮（↻）：委托处理，跳过缓存 force=1 ----
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.sum-refresh');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.refreshId || '';
    if (!id || !/^.{1,100}$/.test(id)) return;
    btn.disabled = true;
    btn.classList.add('spin');
    btn.title = '生成中…';
    _sumQ.done.delete(id);                       // 允许重新入队
    const item = {
      id,
      title: btn.dataset.t || '',
      summary: btn.dataset.s || '',
      aiSummary: undefined,                      // 无 aiSummary → 必入队
      force: true,
      btn,
    };
    _sumQ.items.push(item);
    _drain();   // 复位由 _sumFetchOne 的 finally 负责（drain 已激活时立即返回也安全）
  });

  // 头部搜索：跨目录与资讯检索
  function initSearch() {
    const wrap = $('.header-search');
    if (!wrap) return;
    const input = $('input', wrap);
    const pop = $('.search-pop', wrap);
    if (!input || !pop) return;
    let all = [];
    const dir = window.__DIRECTORY__;
    if (dir) for (const c of dir.categories) for (const l of c.links) all.push({ name: l.name, url: l.url, cat: c.title });

    input.addEventListener('focus', () => input.value && render(input.value));
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (!q) return;
        const hit = pop.querySelector('a');
        if (hit) { location.href = safeUrl(hit.getAttribute('href')); }
        else if (/^https?:\/\//i.test(q)) location.href = q;
        else location.href = 'https://www.bing.com/search?q=' + encodeURIComponent(q + ' AI');
      }
      if (e.key === 'Escape') pop.classList.remove('show');
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) pop.classList.remove('show'); });

    function render(q) {
      q = q.trim().toLowerCase();
      if (!q) { pop.classList.remove('show'); return; }
      const hits = all.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 12);
      if (!hits.length) { pop.classList.remove('show'); return; }
      pop.innerHTML = hits.map((h) => `<a href="${esc(safeUrl(h.url))}">${esc(h.name)}<span class="pop-cat"> · ${esc(h.cat)}</span></a>`).join('');
      pop.classList.add('show');
    }
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.focus(); input.select(); }
    });
  }

  function initBackTop() {
    const btn = document.createElement('button');
    btn.className = 'back-top';
    btn.textContent = '↑';
    btn.setAttribute('aria-label', '回到顶部');
    document.body.appendChild(btn);
    const toggle = () => btn.classList.toggle('show', window.scrollY > 500);
    window.addEventListener('scroll', toggle, { passive: true });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSearch();
    initBackTop();
  });

  window.AIH = { $, $$, getData, esc, safeUrl, timeAgo, fmt, requestSummary };
})();
