// 历史记录：列表、趋势、单场详情
(function () {
  'use strict';
  const F = window.Feihua, S = window.Store, Sh = window.Share, Site = window.Site;
  const $ = (id) => document.getElementById(id);
  const esc = F.esc;
  const COLORS = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)', 'var(--g5)'];
  const lvIdx = (p) => Math.max(0, F.levelOf(p));

  function metaLine(r) {
    const parts = [Sh.fmtDate(r.at)];
    if (r.duration) parts.push('录音 ' + Sh.fmtDur(r.duration));
    parts.push(r.final ? '最终结果' : '实时估算');
    if (r.review && r.review.king && r.review.king.name) parts.push('废话之王：' + r.review.king.name);
    return parts.join(' · ');
  }

  function renderTrend(all) {
    const pts = all.slice(0, 20).reverse();
    $('trend-panel').hidden = pts.length < 2;
    if (pts.length < 2) return;
    const W = 720, H = 180, L = 34, R = 10, T = 12, B = 24;
    const bw = (W - L - R) / pts.length;
    const y = (v) => T + (H - T - B) * (1 - v / 100);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最近 ${pts.length} 场会的废话浓度">`;
    for (const v of [0, 25, 50, 75, 100]) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    pts.forEach((r, i) => {
      const x = L + i * bw + bw * 0.18, w = bw * 0.64, top = y(r.pct);
      svg += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${(y(0) - top).toFixed(1)}" rx="2" fill="${COLORS[lvIdx(r.pct)]}"><title>${esc(r.title)}：${Math.round(r.pct)}%</title></rect>`;
    });
    const d = new Date(pts[0].at), e = new Date(pts[pts.length - 1].at);
    svg += `<text x="${L}" y="${H - 6}">${d.getMonth() + 1}/${d.getDate()}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${e.getMonth() + 1}/${e.getDate()}</text></svg>`;
    $('trend').innerHTML = svg;
    const avg = (a) => a.reduce((s, r) => s + r.pct, 0) / a.length;
    const recent = all.slice(0, 5), prev = all.slice(5, 10);
    let note = `最近 ${recent.length} 场平均 ${Math.round(avg(recent))}%`;
    if (prev.length >= 3) { const dlt = Math.round(avg(recent) - avg(prev)); note += dlt > 0 ? `，比之前水了 ${dlt} 个点` : dlt < 0 ? `，比之前干了 ${-dlt} 个点` : '，和之前持平'; }
    $('trend-note').textContent = note;
  }

  function renderList() {
    const all = S.list();
    const q = $('q').value.trim().toLowerCase();
    const items = q ? all.filter((r) => (r.title + '\n' + r.text).toLowerCase().includes(q)) : all;
    renderTrend(all);
    if (!all.length) {
      $('list').innerHTML = `<div class="stack" style="gap:10px;padding:18px 4px"><div class="empty">还没有记录。录一场会，或者粘贴纪要后点「保存到历史」，就会出现在这里。</div><div class="row"><a class="btn primary small" href="/app">开始检测</a><a class="btn small" href="/app?sample=0">先看示例</a></div></div>`;
      return;
    }
    if (!items.length) { $('list').innerHTML = '<div class="empty" style="padding:18px 4px">没有找到匹配的记录。</div>'; return; }
    $('list').innerHTML = items.map((r) => `
      <div class="item" data-id="${esc(r.id)}">
        <a class="score" href="#r-${esc(r.id)}" aria-label="查看 ${esc(r.title)}"><span class="lv-dot" style="background:${COLORS[lvIdx(r.pct)]}"></span>${Math.round(r.pct)}</a>
        <a href="#r-${esc(r.id)}" style="color:inherit;text-decoration:none;min-width:0"><div class="t">${esc(r.title)}</div><div class="m">${esc(metaLine(r))}</div></a>
        <div class="acts"><a class="btn small quiet" href="/app?open=${encodeURIComponent(r.id)}">打开</a><span data-del></span></div>
      </div>`).join('');
    $('list').querySelectorAll('[data-del]').forEach((slot) => delButton(slot, slot.closest('.item').dataset.id, renderList));
  }

  // 删除要点两次：第一次变成“确认删除 / 取消”
  function delButton(slot, id, after) {
    const draw = (confirming) => {
      slot.innerHTML = confirming
        ? '<span class="confirm"><button class="btn small" data-yes style="border-color:var(--g5);color:var(--g5)">确认删除</button><button class="btn small quiet" data-no>取消</button></span>'
        : '<button class="btn small quiet" data-ask>删除</button>';
      const b = (sel) => slot.querySelector(sel);
      if (confirming) {
        b('[data-yes]').onclick = () => { S.remove(id); Site.toast('已删除'); after(); };
        b('[data-no]').onclick = () => draw(false);
        b('[data-yes]').focus();
      } else b('[data-ask]').onclick = () => draw(true);
    };
    draw(false);
  }

  function renderDetail(id) {
    const r = S.get(id);
    if (!r) { location.hash = ''; return; }
    const a = F.analyze(r.text, S.unpackAi(r.ai));
    const rv = r.review || {};
    const lv = F.LEVELS[lvIdx(r.pct)];
    const li = (x) => (Array.isArray(x) && x.length ? '<ul>' + x.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '<div class="empty">没有</div>');
    const todos = Array.isArray(rv.todos) && rv.todos.length
      ? '<table><thead><tr><th>负责人</th><th>事项</th><th>时间</th></tr></thead><tbody>' + rv.todos.map((t) => `<tr><td>${esc(t.who || '未指定')}</td><td>${esc(t.what || '')}</td><td>${esc(t.when || '未定')}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="empty">没有待办</div>';
    $('detail').innerHTML = `
      <div class="row spread"><a href="#" class="btn small quiet">← 返回列表</a><div class="row">
        <a class="btn small" href="/app?open=${encodeURIComponent(r.id)}">在检测台打开</a>
        <button class="btn small primary" id="d-card">生成分享图</button>
        <button class="btn small" id="d-md">导出纪要</button>
        <span id="d-del"></span></div></div>
      <div class="label">${esc(Sh.fmtDate(r.at))}${r.duration ? ' · 录音 ' + esc(Sh.fmtDur(r.duration)) : ''} · ${r.final ? '最终结果' : '实时估算（没出最终结果）'}</div>
      <div class="detail-top">
        <div class="big"><div class="pct">${Math.round(r.pct)}<small>%</small></div><div class="grade">${esc(lv.name)}</div></div>
        <div><h2 class="review-title">${esc(rv.title || r.title)}</h2>${rv.one_liner ? `<p style="margin:4px 0 0;font-weight:700">${esc(rv.one_liner)}</p>` : ''}</div>
      </div>
      ${rv.checkup ? `<div><div class="label" style="margin-bottom:8px">会议体检</div>${F.checkupHTML(rv.checkup)}</div>` : ''}
      ${rv.roast ? `<p class="roast">${esc(rv.roast)}</p>` : ''}
      ${r.review ? `<div class="grid2"><div><div class="label">有用的结论</div>${li(rv.takeaways)}</div><div><div class="label">待办</div>${todos}</div></div>` : ''}
      <div class="label">逐句标注</div>
      <div class="annot">${F.annotate(a, 'ai')}</div>`;
    delButton($('d-del'), r.id, () => { location.hash = ''; });
    $('d-md').onclick = () => { Sh.exportMarkdown(r, a); Site.toast('纪要已导出为 Markdown'); };
    $('d-card').onclick = async () => {
      try {
        const how = await Sh.shareCard({ title: r.title, at: r.at, duration: r.duration, pct: r.pct, rulePct: a.rulePct, aiPct: a.aiPct, oneLiner: rv.one_liner, king: rv.king, mvp: rv.mvp, checkup: rv.checkup, judged: a.coverage.judged, topWords: r.topWords });
        if (how === 'downloaded') Site.toast('化验单图片已下载');
      } catch { Site.toast('生成图片失败，再试一次'); }
    };
  }

  function route() {
    const m = location.hash.match(/^#r-([\w-]+)$/);
    const detail = !!m;
    $('detail').hidden = !detail; $('list-panel').hidden = detail;
    $('q').parentElement.hidden = detail;
    $('page-title').textContent = detail ? '会议详情' : '历史记录';
    if (detail) { $('trend-panel').hidden = true; renderDetail(m[1]); window.scrollTo(0, 0); }
    else renderList();
  }
  $('q').addEventListener('input', renderList);
  window.addEventListener('hashchange', route);
  route();
})();
