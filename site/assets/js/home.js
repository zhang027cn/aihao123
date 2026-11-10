// 首页：目录 + 资讯 + 榜单 + MCP/SKILL 精选
(function () {
  const { $, getData, esc, safeUrl, timeAgo, fmt } = window.AIH;

  // 方案 A：左侧分类导航 + 右侧当前分类链接网格（目录区高度从 ~2500px 降到一屏内）
  function renderDir() {
    const dir = window.__DIRECTORY__;
    const root = $('#category-grid');
    if (!dir || !root) return;
    const cats = dir.categories;

    const railHtml = cats.map((c, i) => `
      <button type="button" class="dir-cat${i === 0 ? ' active' : ''}" data-i="${i}" aria-pressed="${i === 0}">
        <span class="icon">${esc(c.icon)}</span>
        <span class="name">${esc(c.title)}</span>
        <span class="cnt">${c.links.length}</span>
      </button>`).join('');

    root.innerHTML = `
      <nav class="dir-rail" aria-label="导航分类">${railHtml}</nav>
      <div class="dir-panel" id="dir-panel"></div>`;

    // 12 个面板全部渲染进 DOM（116 个 <a> 都在 HTML 中，SEO 无损），仅用 .show 切换可见性
    const panel = $('#dir-panel');
    panel.innerHTML = cats.map((c, i) => `
      <div class="dir-panel-body${i === 0 ? ' show' : ''}" data-i="${i}" role="tabpanel">
        <div class="dir-panel-head">
          <span class="icon">${esc(c.icon)}</span>
          <h3>${esc(c.title)}</h3>
          <span class="cnt">${c.links.length} 个站点</span>
        </div>
        <div class="dir-links">
          ${c.links.map((l) => `
            <a class="dir-link" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">
              <span class="name">${esc(l.name)}</span>
              ${l.desc ? `<span class="desc">${esc(l.desc)}</span>` : ''}
              <span class="go">↗</span>
            </a>`).join('')}
        </div>
      </div>`).join('');

    function show(i) {
      root.querySelectorAll('.dir-cat').forEach((b, bi) => {
        b.classList.toggle('active', bi === i);
        b.setAttribute('aria-pressed', bi === i);
      });
      panel.querySelectorAll('.dir-panel-body').forEach((p) => {
        p.classList.toggle('show', Number(p.dataset.i) === i);
      });
    }
    root.querySelector('.dir-rail').addEventListener('click', (e) => {
      const b = e.target.closest('.dir-cat');
      if (b) show(Number(b.dataset.i));
    });
  }

  const tagBadges = (tags) => Array.isArray(tags)
    ? tags.slice(0, 2).map((t) => `<span class="badge tag">#${esc(t)}</span>`).join('')
    : '';

  // 资讯分类 tab 布局（与右栏榜单一致）：首 tab「最新」，其余为高频分类
  const NEWS_TABS = ['最新', '大模型', '智能体', '芯片算力', '政策监管'];

  function newsItemHtml(n) {
    return `
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
      </li>`;
  }

  function renderNews(all) {
    const root = $('#home-news');
    if (!root || !all?.length) return;
    // tabs 放卡片外（与榜单栏同构），卡片内渲染当前 tab 列表
    root.innerHTML = `
      <div class="tabs">${NEWS_TABS.map((t, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="card"><ul class="news-list" id="home-news-list"><li><div class="empty">暂无资讯</div></li></ul></div>`;

    const list = $('#home-news-list');
    const getItems = (tab) => {
      const pool = tab === '最新'
        ? [...all].sort((a, b) => (b.published || '').localeCompare(a.published || ''))
        : all.filter((n) => n.category === tab);
      // 6 条与右栏 12 行榜单高度配平
      return pool.slice(0, 6);
    };
    function show(tab) {
      const top = getItems(tab);
      list.innerHTML = top.length ? top.map(newsItemHtml).join('')
        : '<li><div class="empty">该分类暂无资讯</div></li>';
      // 懒加载摘要：无 aiSummary 的条目调 /api/summary 按需生成
      requestSummary(top);
    }
    root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      show(b.dataset.t);
    }));
    show('最新');
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
        html = (g?.items || []).slice(0, 12).map((r, i) => rankRow(i, r.name, r.fullName, `${fmt(r.stars)} ★ · ${esc(r.license || '开源')}`, r.url)).join('');
      } else if (t === 'models') {
        html = (rank.hfModels || []).slice(0, 12).map((r, i) => rankRow(i, r.name, r.pipelineTag || 'model', `${fmt(r.downloads)} 下载 · 热力 ${esc(r.trendingScore)}`, r.url)).join('');
      } else {
        html = (rank.hn || []).slice(0, 12).map((r, i) => rankRow(i, r.title, '', `${esc(r.points)} ▲`, r.url)).join('');
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
