// MCP / SKILL 目录页共用：网格渲染 + 关键词搜索 + 官方/开源过滤
(function () {
  const { $, getData, esc, safeUrl, fmt } = window.AIH;
  const kind = document.body.dataset.kind || 'mcp';
  const state = { items: [], q: '', official: 'all' };

  function render() {
    const grid = $('#tool-grid');
    if (!grid) return;
    const items = state.items.filter((x) => {
      if (state.official !== 'all' && (state.official === 'official') !== !!x.official) return false;
      if (state.q && !(x.name + ' ' + (x.description || '')).toLowerCase().includes(state.q)) return false;
      return true;
    });
    grid.innerHTML = items.length ? items.map((x) => {
      const u = safeUrl(x.url);
      const nameHtml = u
        ? `<a class="name" href="${esc(u)}" target="_blank" rel="noopener">${esc(x.name)}</a>`
        : `<span class="name">${esc(x.name)}</span>`;
      return `
      <article class="card tool-card">
        <div class="head">
          ${nameHtml}
          ${x.official ? '<span class="badge off">官方</span>' : '<span class="badge oss">开源</span>'}
          ${x.license ? `<span class="badge src">${esc(x.license)}</span>` : ''}
        </div>
        <div class="desc">${esc(x.description || '暂无描述')}</div>
        <div class="foot">
          ${x.stars ? `<span class="star">★ ${esc(fmt(x.stars))}</span>` : ''}
          ${x.deploy ? `<span>部署: ${esc(x.deploy)}</span>` : ''}
          ${x.pushedAt ? `<span>更新: ${esc(new Date(x.pushedAt).toLocaleDateString('zh-CN'))}</span>` : ''}
        </div>
      </article>`;
    }).join('') : '<div class="empty">没有匹配的条目</div>';
    $('#tool-count').textContent = `${items.length} 个`;
  }

  function initFilters() {
    const q = $('#tool-search');
    const bar = $('#official-filter');
    if (q) q.addEventListener('input', () => { state.q = q.value.trim().toLowerCase(); render(); });
    if (bar) bar.addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      bar.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.official = b.dataset.v;
      render();
    });
  }

  async function init() {
    state.items = await getData(kind, []);
    initFilters();
    render();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
