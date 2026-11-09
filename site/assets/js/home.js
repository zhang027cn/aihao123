// 首页：目录 + 资讯 + 榜单 + MCP/SKILL 精选
(function () {
  const { $, getData, esc, safeUrl, timeAgo, fmt } = window.AIH;

  function renderDir() {
    const dir = window.__DIRECTORY__;
    const root = $('#category-grid');
    if (!dir || !root) return;
    root.innerHTML = dir.categories.map((c) => `
      <section class="cat-card ${c.id === 'mcp' ? 'wide' : ''}" id="cat-${esc(c.id)}">
        <h3 class="cat-title"><span class="icon">${esc(c.icon)}</span>${esc(c.title)}</h3>
        <div class="cat-links">
          ${c.links.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener"><span class="dot"></span>${esc(l.name)}</a>`).join('')}
        </div>
      </section>`).join('');
  }

  const tagBadges = (tags) => Array.isArray(tags)
    ? tags.slice(0, 3).map((t) => `<span class="badge tag">#${esc(t)}</span>`).join('')
    : '';

  function renderNews(items) {
    const root = $('#home-news');
    if (!root || !items?.length) return;
    const top = items.slice(0, 8);
    root.innerHTML = top.map((n) => `
      <li>
        <a class="t" href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <p class="ai-summary" data-summary-for="${esc(n.id || '')}">${n.aiSummary ? '🤖 ' + esc(n.aiSummary) : '<span class="sum-placeholder">…</span>'}</p>
        <div class="news-meta">
          ${tagBadges(n.tags)}
          <span class="badge src">${esc(n.source)}</span>
          <span class="badge ${n.lang === 'zh' ? 'zh' : 'en'}">${n.lang === 'zh' ? '中文' : 'EN'}</span>
          ${n.points ? `<span class="badge hot">▲ ${esc(n.points)}</span>` : ''}
          <span>${timeAgo(n.published)}</span>
        </div>
      </li>`).join('');
    // 懒加载摘要：无 aiSummary 的条目调 /api/summary 按需生成
    requestSummary(top);
  }

  const summaryQueue = new Set();
  async function requestSummary(items) {
    for (const n of items) {
      if (!n.aiSummary && n.id && !summaryQueue.has(n.id)) {
        summaryQueue.add(n.id);
        fetch(`/api/summary?id=${encodeURIComponent(n.id)}&title=${encodeURIComponent(n.title || '')}&summary=${encodeURIComponent(n.summary || '')}`)
          .then((r) => (r.ok ? r.json() : { ok: false }))
          .catch(() => ({ ok: false }))
          .then((d) => {
            summaryQueue.delete(n.id);
            const el = document.querySelector(`[data-summary-for="${CSS.escape(n.id)}"]`);
            if (el) {
              el.textContent = d.ok && d.aiSummary ? '🤖 ' + d.aiSummary : '';
            }
          });
      }
    }
  }

  function renderRankings(rank) {
    const root = $('#home-rank');
    if (!root || !rank) return;
    const groups = rank.github.slice(0, 2);
    const tabs = [{ id: 'gh', label: 'GitHub AI 热力榜' }, { id: 'models', label: 'HF 爆款模型' }, { id: 'hn', label: 'HN 热帖' }];
    root.innerHTML = `
      <div class="tabs">${tabs.map((t, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-t="${t.id}">${t.label}</button>`).join('')}</div>
      <div class="card" id="rank-pane"></div>`;
    const pane = $('#rank-pane');
    function show(t) {
      let html = '';
      if (t === 'gh') {
        const g = groups[0];
        html = (g?.items || []).slice(0, 8).map((r, i) => rankRow(i, r.name, r.fullName, `${fmt(r.stars)} ★ · ${esc(r.license || '开源')}`, r.url)).join('');
      } else if (t === 'models') {
        html = (rank.hfModels || []).slice(0, 8).map((r, i) => rankRow(i, r.name, r.pipelineTag || 'model', `${fmt(r.downloads)} 下载 · 热力 ${esc(r.trendingScore)}`, r.url)).join('');
      } else {
        html = (rank.hn || []).slice(0, 8).map((r, i) => rankRow(i, r.title, '', `${esc(r.points)} ▲`, r.url)).join('');
      }
      pane.innerHTML = html || emptyBox('暂无数据');
    }
    root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      show(b.dataset.t);
    }));
    show('gh');
  }

  function rankRow(i, t, sub, val, url) {
    const no = i + 1;
    const cls = no <= 3 ? `top${no}` : '';
    return `<div class="rank-row">
      <span class="rank-no ${cls}">${no}</span>
      <div class="rank-main">
        <a class="t" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(t)}</a>
        ${sub ? `<span class="d">${esc(sub)}</span>` : ''}
      </div>
      <div class="rank-val"><span class="n">${esc(val)}</span></div>
    </div>`;
  }
  function emptyBox(msg) { return `<div class="empty">${esc(msg)}</div>`; }

  async function init() {
    renderDir();
    const hero = $('#hero-search');
    if (hero) {
      const go = $('#hero-go');
      const jump = () => {
        const q = hero.value.trim();
        if (/^https?:\/\//.test(q)) location.href = q;
        else if (q) location.href = 'https://www.bing.com/search?q=' + encodeURIComponent(q + ' AI');
      };
      hero.addEventListener('keydown', (e) => { if (e.key === 'Enter') jump(); });
      if (go) go.addEventListener('click', jump);
      // 首页隐藏了 header 搜索，Ctrl+K 快捷键改绑 hero 搜索框
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); hero.focus(); hero.select(); }
      });
    }
    const [news, rank, mcp, skills] = await Promise.all([
      getData('news', []),
      getData('rankings', null),
      getData('mcp', []),
      getData('skills', []),
    ]);
    renderNews(news);
    renderRankings(rank);
    const stats = $('#stats');
    if (stats) {
      const dirCount = (window.__DIRECTORY__?.categories || []).reduce((a, c) => a + c.links.length, 0);
      const cards = [
        { num: dirCount, label: '📁 导航站点', href: '#dir-section' },
        { num: news?.length || 0, label: '📰 每日资讯', href: 'news.html' },
        { num: mcp?.length || 0, label: '🧩 MCP 服务器', href: 'mcp.html' },
        { num: skills?.length || 0, label: '🛠 SKILL 技能', href: 'skills.html' },
      ];
      stats.innerHTML = cards.map((c) => `
        <a class="stat-pill" href="${c.href}">
          <span class="stat-num">${fmt(c.num)}</span>
          <span class="stat-label">${c.label}</span>
        </a>`).join('');
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
