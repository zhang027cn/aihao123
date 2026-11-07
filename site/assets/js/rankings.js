// 排行榜页：GitHub 榜单分组 + HF 模型/Space + HN
(function () {
  const { $, getData, esc, safeUrl, fmt } = window.AIH;

  function render() {
    const tabs = $('#rank-tabs');
    const pane = $('#rank-pane');
    if (!tabs || !pane) return;
    const data = window.__RANK_DATA__;
    if (!data) { pane.innerHTML = '<div class="empty">数据加载失败</div>'; return; }

    const groups = data.github || [];
    const tabDefs = [
      ...groups.map((g) => ({ id: 'gh:' + g.id, label: g.label, type: 'gh', g })),
      { id: 'models', label: 'HF 爆款模型', type: 'models' },
      { id: 'spaces', label: 'HF 爆款 Space', type: 'spaces' },
      { id: 'hn', label: 'HN 本周热帖', type: 'hn' },
    ];

    tabs.innerHTML = tabDefs.map((t, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-id="${esc(t.id)}">${esc(t.label)}</button>`).join('');

    function row(i, title, sub, val, url, extra) {
      const no = i + 1;
      return `<div class="rank-row">
        <span class="rank-no ${no <= 3 ? 'top' + no : ''}">${no}</span>
        <div class="rank-main">
          <a class="t" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(title)}</a>
          ${sub ? `<span class="d">${esc(sub)}</span>` : ''}
        </div>
        <div class="rank-val">
          <span class="n">${esc(val)}</span>
          ${extra ? `<span class="l">${esc(extra)}</span>` : ''}
        </div>
      </div>`;
    }

    function show(id) {
      const def = tabDefs.find((t) => t.id === id);
      let html = '';
      if (def.type === 'gh') {
        html = (def.g.items || []).map((r, i) =>
          row(i, r.name, r.description || r.fullName, fmt(r.stars) + ' ★', r.url, (r.license || '开源') + (r.archived ? ' · 已归档' : ''))).join('');
      } else if (def.type === 'models') {
        html = (data.hfModels || []).map((r, i) =>
          row(i, r.name, r.pipelineTag || 'model', fmt(r.downloads) + ' 下载', r.url, '热力 ' + esc(r.trendingScore ?? '-')));
      } else if (def.type === 'spaces') {
        html = (data.hfSpaces || []).map((r, i) =>
          row(i, r.name, 'Space · ' + esc(r.sdk || ''), fmt(r.likes) + ' ♥', r.url, '热力 ' + esc(r.trendingScore ?? '-')));
      } else {
        html = (data.hn || []).map((r, i) =>
          row(i, r.title, 'Hacker News', esc(r.points || 0) + ' ▲', r.url, esc(r.comments || 0) + ' 评论'));
      }
      pane.innerHTML = html || '<div class="empty">暂无数据</div>';
    }

    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      tabs.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      show(b.dataset.id);
    });
    show(tabDefs[0].id);
  }

  async function init() {
    const data = await getData('rankings', null);
    window.__RANK_DATA__ = data;
    render();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
