// 资讯页：全量列表 + 来源/语言/搜索过滤
(function () {
  const { $, getData, esc, timeAgo } = window.AIH;
  const state = { items: [], lang: 'all', src: 'all', q: '' };

  function render() {
    const root = $('#news-list');
    if (!root) return;
    const items = state.items.filter((n) => {
      if (state.lang !== 'all' && n.lang !== state.lang) return false;
      if (state.src !== 'all' && n.source !== state.src) return false;
      if (state.q && !(n.title + ' ' + n.summary).toLowerCase().includes(state.q)) return false;
      return true;
    });
    root.innerHTML = items.length ? items.map((n) => `
      <li>
        <a class="t" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="news-meta">
          <span class="badge src">${esc(n.source)}</span>
          <span class="badge ${n.lang === 'zh' ? 'zh' : 'en'}">${n.lang === 'zh' ? '中文' : 'EN'}</span>
          ${n.points ? `<span class="badge hot">▲ ${n.points}</span>` : ''}
          <span>${timeAgo(n.published)}</span>
        </div>
      </li>`).join('') : `<div class="empty">没有匹配的资讯</div>`;
    $('#news-count').textContent = `${items.length} 条`;
  }

  function initFilters() {
    const langBar = $('#lang-filter');
    const srcSel = $('#src-filter');
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
    if (q) q.addEventListener('input', () => { state.q = q.value.trim().toLowerCase(); render(); });
  }

  async function init() {
    state.items = await getData('news', []);
    initFilters();
    render();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
