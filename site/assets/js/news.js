// 资讯页：懒加载列表 + 来源/语言/分类/搜索过滤 + 按需 AI 摘要
(function () {
  const { $, getData, esc, safeUrl, timeAgo } = window.AIH;
  const state = { items: [], lang: 'all', src: 'all', cat: 'all', q: '', visible: 0 };
  const PAGE = 30;          // 每次渲染条数（懒加载）
  const catBadge = (cat) => cat ? `<span class="badge cat">${esc(cat)}</span>` : '';
  const tagBadges = (tags) => Array.isArray(tags)
    ? tags.slice(0, 3).map((t) => `<span class="badge tag">#${esc(t)}</span>`).join('')
    : '';

  function filtered() {
    return state.items.filter((n) => {
      if (state.lang !== 'all' && n.lang !== state.lang) return false;
      if (state.src !== 'all' && n.source !== state.src) return false;
      if (state.cat !== 'all' && n.category !== state.cat) return false;
      if (state.q && !(n.title + ' ' + (n.aiSummary || n.summary || '')).toLowerCase().includes(state.q)) return false;
      return true;
    });
  }

  function itemHtml(n) {
    return `
      <li data-id="${esc(n.id || '')}">
        <div class="news-head">
          <a class="t" href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">${esc(n.title)}</a>
          ${catBadge(n.category)}
        </div>
        <p class="ai-summary" data-summary-for="${esc(n.id || '')}">${n.aiSummary ? '🤖 ' + esc(n.aiSummary) : '<span class="sum-placeholder">…</span>'}</p>
        <div class="news-meta">
          ${tagBadges(n.tags)}
          <span class="badge src">${esc(n.source)}</span>
          <span class="badge ${n.lang === 'zh' ? 'zh' : 'en'}">${n.lang === 'zh' ? '中文' : 'EN'}</span>
          ${n.points ? `<span class="badge hot">▲ ${esc(n.points)}</span>` : ''}
          <span>${timeAgo(n.published)}</span>
        </div>
      </li>`;
  }

  function render() {
    const root = $('#news-list');
    if (!root) return;
    const items = filtered();
    state.visible = Math.min(items.length, PAGE);
    const slice = items.slice(0, state.visible);
    root.innerHTML = slice.map(itemHtml).join('');
    $('#news-count').textContent = `${items.length} 条`;
    const more = $('#news-load-more');
    if (more) more.classList.toggle('hidden', !(items.length > state.visible));
    requestSummary(slice);
    observeSentinel();
  }

  function appendMore() {
    const root = $('#news-list');
    if (!root) return;
    const items = filtered();
    const next = items.slice(state.visible, state.visible + PAGE);
    state.visible += next.length;
    const tmp = document.createElement('div');
    tmp.innerHTML = next.map(itemHtml).join('');
    while (tmp.firstChild) root.appendChild(tmp.firstChild);
    $('#news-count').textContent = `${items.length} 条`;
    const more = $('#news-load-more');
    if (more) more.classList.toggle('hidden', !(items.length > state.visible));
    requestSummary(next);
  }

  // 按需摘要：可见条目若无 aiSummary，调后端生成（懒加载）
  const summaryQueue = new Set();
  let fetching = false;
  async function requestSummary(items) {
    for (const n of items) {
      if (!n.aiSummary && n.id && !summaryQueue.has(n.id)) {
        summaryQueue.add(n.id);
        const p = fetch(`/api/summary?id=${encodeURIComponent(n.id)}&title=${encodeURIComponent(n.title || '')}&summary=${encodeURIComponent(n.summary || '')}`)
          .then((r) => (r.ok ? r.json() : { ok: false }))
          .catch(() => ({ ok: false }))
          .then((d) => {
            summaryQueue.delete(n.id);
            if (d.ok && d.aiSummary) {
              const el = document.querySelector(`[data-summary-for="${CSS.escape(n.id)}"]`);
              if (el) { el.textContent = '🤖 ' + d.aiSummary; }
            } else {
              const el = document.querySelector(`[data-summary-for="${CSS.escape(n.id)}"]`);
              if (el) { el.textContent = ''; }
            }
          });
        if (!fetching) { fetching = true; p.finally(() => { fetching = false; }); }
      }
    }
  }

  let observer = null;
  function observeSentinel() {
    const sentinel = $('#news-sentinel');
    if (!sentinel || observer) return;
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) appendMore();
    }, { rootMargin: '300px' });
    observer.observe(sentinel);
  }

  function initFilters() {
    const langBar = $('#lang-filter');
    const srcSel = $('#src-filter');
    const catSel = $('#cat-filter');
    const q = $('#news-search');

    if (langBar) langBar.addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      langBar.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.lang = b.dataset.lang;
      render();
    });

    if (srcSel) {
      const srcs = [...new Set(state.items.map((n) => n.source))].sort();
      srcSel.innerHTML = `<option value="all">全部来源</option>` + srcs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      srcSel.addEventListener('change', () => { state.src = srcSel.value; render(); });
    }

    if (catSel) {
      const present = new Set(state.items.map((n) => n.category).filter(Boolean));
      const opts = ['大模型', '智能体', '开源', '芯片算力', '政策监管', '应用落地', '研究论文', '行业动态'].filter((c) => present.has(c));
      catSel.innerHTML = `<option value="all">全部分类</option>` + opts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      catSel.addEventListener('change', () => { state.cat = catSel.value; render(); });
    }

    if (q) q.addEventListener('input', () => { state.q = q.value.trim().toLowerCase(); render(); });
  }

  async function init() {
    state.items = await getData('news', []);
    initFilters();
    render();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
