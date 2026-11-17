// 分享图和导出：把一场会画成一张竖版“化验单”PNG，或导出 Markdown 纪要
(function () {
  const F = window.Feihua;
  const W = 1080, H = 1440;
  const LV_COLORS = ['#2F9E6B', '#8DB83A', '#E2B11E', '#E5782D', '#D23F3F'];

  function fmtDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDur(sec) {
    if (!sec) return '';
    const m = Math.round(sec / 60);
    return m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
  }

  // 中文按字折行，英文单词尽量不拆
  function wrap(ctx, text, maxW, maxLines) {
    const tokens = String(text).match(/[A-Za-z0-9%.\-]+|\s+|./gu) || [];
    const lines = []; let cur = '';
    for (const t of tokens) {
      // 句号逗号这类标点不放到行首，宁可让上一行稍微超出一点
      if (ctx.measureText(cur + t).width > maxW && cur && !/^[，。！？、；：”’）》」』…,.!?;:)]$/.test(t)) { lines.push(cur); cur = t.trimStart(); if (lines.length === maxLines) break; }
      else cur += t;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length === maxLines && tokens.join('').length > lines.join('').length + 1) {
      let last = lines[maxLines - 1];
      while (ctx.measureText(last + '…').width > maxW && last) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    return lines;
  }

  async function ensureFonts() {
    if (!document.fonts) return;
    try {
      await Promise.race([
        Promise.all(['40px "ZCOOL QingKe HuangYou"', '700 40px "JetBrains Mono"']
          .map((f) => document.fonts.load(f, '会议废话浓度化验单0123456789%'))),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {}
  }

  /**
   * data: { title, at, duration, pct, rulePct, aiPct, oneLiner, king, mvp, checkup, topWords: [[w, n]], sentences, judged }
   */
  async function drawCard(data) {
    await ensureFonts();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const ink = '#18212C', muted = '#5A6676', line = '#CDD4DD', paper = '#EEF1F5';
    const display = '"ZCOOL QingKe HuangYou","PingFang SC","Microsoft YaHei",sans-serif';
    const body = 'system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
    const mono = '"JetBrains Mono",Menlo,Consolas,monospace';
    const lv = Math.max(0, F.levelOf(data.pct));
    const L = 80, R = W - 80;

    g.fillStyle = paper; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFFFFF'; g.fillRect(40, 40, W - 80, H - 80);
    g.strokeStyle = ink; g.lineWidth = 4; g.strokeRect(40, 40, W - 80, H - 80);

    // 抬头
    g.fillStyle = ink; g.textBaseline = 'alphabetic';
    g.font = `64px ${display}`; g.fillText('会议废话化验单', L, 150);
    g.font = `26px ${mono}`; g.fillStyle = muted; g.textAlign = 'right';
    g.fillText('NO. ' + String(data.at).slice(-6), R, 120);
    g.fillText(fmtDate(data.at), R, 156); g.textAlign = 'left';
    g.fillStyle = ink; g.fillRect(L, 186, R - L, 3);

    // 样本信息
    g.font = `30px ${body}`; g.fillStyle = muted;
    g.fillText('样本', L, 246);
    g.fillStyle = ink; g.font = `700 34px ${body}`;
    g.fillText(wrap(g, data.title || '未命名会议', R - L - 100, 1)[0], L + 90, 246);
    g.font = `26px ${body}`; g.fillStyle = muted;
    const meta = [data.duration ? '时长 ' + fmtDur(data.duration) : '', data.judged ? `AI 精读 ${data.judged} 句` : ''].filter(Boolean).join('　·　');
    if (meta) g.fillText(meta, L + 90, 290);

    // 大数字
    g.fillStyle = ink; g.font = `700 230px ${mono}`;
    const num = String(Math.round(data.pct));
    g.fillText(num, L - 8, 540);
    const nw = g.measureText(num).width;
    g.font = `700 90px ${mono}`; g.fillText('%', L + nw, 540);
    g.font = `30px ${body}`; g.fillStyle = muted; g.fillText('废话浓度', L + nw + 110, 430);
    g.fillStyle = LV_COLORS[lv]; g.font = `56px ${display}`;
    const gradeName = F.LEVELS[lv].name.split(' · ');
    g.fillText(gradeName[0], L + nw + 110, 500);
    g.font = `30px ${body}`; g.fillStyle = muted; if (gradeName[1]) g.fillText(gradeName[1], L + nw + 110, 545);

    // 量表
    const by = 600, bw = (R - L) / 5;
    LV_COLORS.forEach((col, i) => { g.fillStyle = col; g.fillRect(L + i * bw, by, bw, 26); });
    const nx = L + Math.min(100, data.pct) / 100 * (R - L);
    g.fillStyle = ink; g.beginPath(); g.moveTo(nx - 16, by - 26); g.lineTo(nx + 16, by - 26); g.lineTo(nx, by - 2); g.closePath(); g.fill();
    g.font = `22px ${body}`; g.fillStyle = muted; g.textAlign = 'center';
    ['纯净水', '淡茶', '浓汤', '黑话高汤', '废话原浆'].forEach((t, i) => g.fillText(t, L + bw * i + bw / 2, by + 62));
    g.textAlign = 'left';

    // 一句话
    let y = 740;
    g.fillStyle = ink; g.fillRect(L, y - 44, 6, 140);
    g.font = `700 40px ${body}`;
    for (const ln of wrap(g, data.oneLiner || F.LEVELS[lv].roasts[0], R - L - 40, 3)) { g.fillText(ln, L + 30, y); y += 56; }

    y = Math.max(y + 40, 930);
    g.fillStyle = line; g.fillRect(L, y - 40, R - L, 2);

    // 会议体检：四格，每格“问题 + 分数 + 五个圆点”
    const ck = data.checkup ? F.CHECKUP.filter(([k]) => data.checkup[k]) : [];
    if (ck.length) {
      const cw = (R - L) / ck.length;
      ck.forEach(([k, q], i) => {
        const n = Math.min(5, Math.max(1, Math.round(Number(data.checkup[k].score) || 1)));
        const col = n >= 4 ? '#2F9E6B' : n === 3 ? '#E2B11E' : '#D23F3F';
        const x = L + i * cw;
        g.font = `24px ${body}`; g.fillStyle = muted; g.fillText(q, x, y);
        g.font = `700 52px ${mono}`; g.fillStyle = col; g.fillText(String(n), x, y + 66);
        g.font = `24px ${mono}`; g.fillStyle = muted; g.fillText('/5', x + 34, y + 66);
        for (let j = 0; j < 5; j++) {
          g.beginPath(); g.arc(x + 9 + j * 26, y + 100, 9, 0, Math.PI * 2);
          g.fillStyle = j < n ? col : '#FFFFFF'; g.fill(); g.strokeStyle = col; g.lineWidth = 2.5; g.stroke();
        }
      });
      y += 170;
    }

    // 颁奖
    const award = (label, o, x) => {
      if (!o || !o.name) return;
      g.font = `24px ${body}`; g.fillStyle = muted; g.fillText(label, x, y);
      g.font = `700 38px ${body}`; g.fillStyle = ink; g.fillText(o.name, x, y + 52);
      g.font = `24px ${body}`; g.fillStyle = muted;
      wrap(g, o.reason || '', (R - L) / 2 - 30, 2).forEach((ln, i) => g.fillText(ln, x, y + 94 + i * 34));
    };
    if (data.king || data.mvp) { award('废话之王', data.king, L); award('干货担当', data.mvp, L + (R - L) / 2); y += 190; }

    // 高频黑话（放不下就不画，别压到页脚）
    if (data.topWords && data.topWords.length && y + 80 < H - 190) {
      g.font = `24px ${body}`; g.fillStyle = muted; g.fillText('高频黑话', L, y); y += 26;
      let x = L; g.font = `28px ${body}`;
      for (const [w, n] of data.topWords.slice(0, 6)) {
        const t = `${w} ×${n}`, tw = g.measureText(t).width + 36;
        if (x + tw > R) break;
        g.strokeStyle = ink; g.lineWidth = 2; g.beginPath();
        if (g.roundRect) g.roundRect(x, y, tw, 52, 26); else g.rect(x, y, tw, 52);
        g.stroke(); g.fillStyle = ink; g.fillText(t, x + 18, y + 36); x += tw + 14;
      }
      y += 90;
    }

    // 页脚
    g.fillStyle = ink; g.fillRect(L, H - 170, R - L, 3);
    g.font = `26px ${body}`; g.fillStyle = muted;
    const parts = [`规则 ${Math.round(data.rulePct)}%`, data.aiPct != null ? `AI ${Math.round(data.aiPct)}%` : ''].filter(Boolean).join('　');
    g.fillText(parts, L, H - 116);
    g.textAlign = 'right'; g.fillStyle = ink; g.font = `30px ${display}`;
    g.fillText('会议废话浓度检测器', R, H - 116);
    g.font = `22px ${mono}`; g.fillStyle = muted; g.fillText(location.host, R, H - 80);
    g.textAlign = 'left';
    return c;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function shareCard(data) {
    const canvas = await drawCard(data);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const name = `废话化验单-${fmtDate(data.at).replace(/[ :]/g, '-')}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer:coarse)').matches) {
      try { await navigator.share({ files: [file], title: '会议废话化验单' }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    }
    download(blob, name);
    return 'downloaded';
  }

  function markdown(rec, analysis) {
    const r = rec.review || {};
    const out = [`# ${r.title || rec.title || '会议纪要'}`, '',
      `- 时间：${fmtDate(rec.at)}${rec.duration ? `（录音 ${fmtDur(rec.duration)}）` : ''}`,
      `- 废话浓度：${Math.round(rec.pct)}%（规则 ${Math.round(analysis.rulePct)}%${analysis.aiPct != null ? `，AI 逐句 ${Math.round(analysis.aiPct)}%` : ''}）`,
      `- 评级：${F.LEVELS[Math.max(0, F.levelOf(rec.pct))].name}`, ''];
    if (r.takeaways && r.takeaways.length) out.push('## 有用的结论', '', ...r.takeaways.map((t) => `- ${t}`), '');
    if (r.todos && r.todos.length) {
      out.push('## 待办', '', '| 负责人 | 事项 | 时间 |', '| --- | --- | --- |');
      for (const t of r.todos) out.push(`| ${t.who || '未指定'} | ${String(t.what || '').replace(/\|/g, '/')} | ${t.when || '未定'} |`);
      out.push('');
    }
    if (r.checkup) {
      out.push('## 会议体检', '', '| 项目 | 得分 | 理由 |', '| --- | --- | --- |');
      for (const [k, q] of F.CHECKUP) if (r.checkup[k]) out.push(`| ${q} | ${r.checkup[k].score}/5 | ${String(r.checkup[k].why || '').replace(/\|/g, '/')} |`);
      out.push('');
    }
    if (r.roast) out.push('## AI 点评', '', `> ${r.roast}`, '');
    if (analysis.speakers.length) {
      out.push('## 发言人', '', '| 发言人 | 废话浓度 | 字数 |', '| --- | --- | --- |');
      for (const s of analysis.speakers) out.push(`| ${s.name} | ${Math.round(s.livePct)}% | ${s.len} |`);
      out.push('');
    }
    out.push('## 原文', '', rec.text, '');
    return out.join('\n');
  }

  function exportMarkdown(rec, analysis) {
    const blob = new Blob([markdown(rec, analysis)], { type: 'text/markdown;charset=utf-8' });
    download(blob, `${(rec.review && rec.review.title) || rec.title || '会议纪要'}-${fmtDate(rec.at).slice(0, 10)}.md`.replace(/[\\/:*?"<>|]/g, '_'));
  }

  window.Share = { drawCard, shareCard, exportMarkdown, markdown, fmtDate, fmtDur };
})();
