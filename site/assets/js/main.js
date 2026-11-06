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
        if (hit) { location.href = hit.getAttribute('href'); }
        else if (/^https?:\/\//.test(q)) location.href = q;
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
      pop.innerHTML = hits.map((h) => `<a href="${esc(h.url)}">${esc(h.name)}<span style="color:var(--ink-soft);font-size:12px"> · ${esc(h.cat)}</span></a>`).join('');
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

  window.AIH = { $, $$, getData, esc, timeAgo, fmt };
})();
