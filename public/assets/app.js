// 检测台：录音转写（Azure 对话转写，自动分人）→ 实时打分（词库 + AI 边录边逐句精读）→ 最终结果（AI 终审）
(function () {
  'use strict';
  const F = window.Feihua, S = window.Store, Sh = window.Share, Site = window.Site;
  const $ = (id) => document.getElementById(id);
  const esc = F.esc;
  const params = new URLSearchParams(location.search);
  const recordingDebug = params.get('debug') === 'recording';
  const recordingDebugKey = 'feihua.recording-debug.v1';
  let recordingSteps = [];

  function traceRecording(step) {
    if (!recordingDebug) return;
    recordingSteps.push(new Date().toLocaleTimeString() + ' ' + step);
    recordingSteps = recordingSteps.slice(-16);
    const trace = recordingSteps.join('\n');
    try { localStorage.setItem(recordingDebugKey, trace); } catch {}
    $('recording-debug-log').textContent = trace;
  }

  // ---------- 状态 ----------
  const st = {
    id: null,            // 历史记录 id，第一次保存时生成
    at: Date.now(),      // 会议开始时间
    demo: false,         // 示例会议（带演示用 AI 数据，不保存）
    ai: new Map(),       // 句子 key -> { w, tag, why }
    review: null,        // AI 终审结果
    reviewFor: null,     // 终审对应的文字，文字变了终审就作废
    finalPct: null,
    duration: 0,         // 累计录音秒数
    status: { speech: false, ai: false, user: null, quota: null },
    savedText: null,
  };
  // 点了停止、最终结果还没出完。iPhone 上浏览器偶尔在停止录音的瞬间把整页重载，
  // 这个标记跟着“当前这场会”一起存下来，重载后接着把最终结果出完
  let pendingFinal = false;
  function clearPending() { if (!pendingFinal) return; pendingFinal = false; if (st.id) S.setCurrent(st.id); }
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  // 手机停录时关掉 AudioWorklet 音频上下文，容易把标签页卡死/崩掉；改用 ScriptProcessor 取音
  const AVOID_AUDIO_WORKLET = IS_IOS || IS_ANDROID;
  let result = null;     // 最近一次 analyze 的结果
  let livePartial = '', partialSpeaker = null;

  // ---------- 设置 ----------
  let settings = S.settings();
  function applySettings() {
    F.buildLex(S.parseCustom(settings.custom), S.parseIgnore(settings.ignore));
    $('set-custom').value = settings.custom; $('set-ignore').value = settings.ignore; $('set-auto').checked = !!settings.autoJudge;
  }
  $('btn-set-save').addEventListener('click', () => {
    settings = { ...settings, custom: $('set-custom').value, ignore: $('set-ignore').value, autoJudge: $('set-auto').checked };
    S.saveSettings(settings); applySettings(); render(); Site.toast('设置已保存');
  });

  // ---------- 接口 ----------
  async function api(path, body) {
    const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `服务器返回 ${res.status}`);
      err.code = data.code; err.status = res.status; err.loggedIn = data.loggedIn;
      throw err;
    }
    return data;
  }
  function quotaHint(err) {
    if (err && err.code === 'quota' && !err.loggedIn) return err.message + '。<button class="btn small" data-login>登录</button>';
    return esc(err && err.message || '出错了');
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-login]')) Site.openLogin(); });

  let statusTimer;
  function refreshStatus(delay = 0, then) {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(async () => {
      try { st.status = await api('/api/status'); } catch { st.status = { speech: false, ai: false, user: null, quota: null, offline: true }; }
      renderQuota();
      if (then) then();
    }, delay);
  }
  function renderQuota() {
    const s = st.status, q = s.quota;
    if (s.offline) { $('quota').textContent = '暂时连不上服务器，录音和 AI 用不了，粘贴文字仍可按词库打分。'; return; }
    if (!q) { $('quota').textContent = ''; return; }
    const left = (k) => Math.max(0, q[k].limit - q[k].used);
    $('quota').innerHTML = `今天还剩：录音 <b>${left('speech-token')}</b> 段（每段约 8 分钟）· AI 精读 <b>${left('ai-judge')}</b> 句 · 最终结果 <b>${left('ai-review')}</b> 次` +
      (s.user ? '' : '。<button class="btn small quiet" data-login>登录后额度更高</button>');
    if (!s.speech) $('partial').textContent = '录音服务还没配置，可以先粘贴文字。';
    $('btn-ai').hidden = !s.ai;
  }

  // ---------- 渲染 ----------
  function tailText() {
    if (!livePartial) return '';
    const v = $('input').value;
    const name = partialSpeaker && nameMap[partialSpeaker];
    if (name && name !== lastSpk) return (v ? '\n' : '') + name + '：' + livePartial;
    return (lastSpk || !v ? '' : '') + livePartial;
  }
  let rs; function renderSoon() { clearTimeout(rs); rs = setTimeout(render, 120); }

  function render() {
    const text = $('input').value;
    result = F.analyze(text, st.ai, tailText());
    const r = result;
    $('charcount').textContent = r.total ? `有效字数 ${r.total}` : '';

    // 实时
    const lv = F.LEVELS[Math.max(0, F.levelOf(r.livePct))];
    $('pct').innerHTML = (r.total ? Math.round(r.livePct) : 0) + '<small>%</small>';
    $('grade').textContent = r.total ? lv.name : '等待开口';
    $('needle').style.left = Math.min(100, r.total ? r.livePct : 0) + '%';
    $('roast').textContent = r.total ? lv.roasts[r.total % lv.roasts.length] : '开始录音或粘贴一段会议纪要，看看这场会有多少水分。';
    const cov = r.coverage;
    const mins = r.total / 220;
    $('source').textContent = r.total
      ? [cov.judged >= cov.total ? `AI 已精读全部 ${cov.total} 句` : cov.judged ? `AI 已精读 ${cov.judged}/${cov.total} 句，其余按词库估算` : '按词库估算，AI 精读后会更准',
         `${mins < 1 ? '不到 1 分钟' : '约 ' + Math.round(mins) + ' 分钟'}的发言，砍掉废话能省 ${fmtMin(mins * r.livePct / 100)}`].join(' · ')
      : '';

    // 最终：文字变了就作废
    const fresh = st.review && st.reviewFor === text;
    $('final-out').hidden = !fresh; $('final-empty').hidden = !!fresh;
    if (fresh) renderFinal();
    $('btn-ai').textContent = fresh ? '重新出最终结果' : '出最终结果';

    $('annot').innerHTML = F.annotate(r, 'ai') || '<span class="empty">转写的文字和标注会出现在这里。</span>';
    updateDock();
  }
  // 手机底部：录音时显示实时分；AI 出结果时提示进度；出了最终结果就显示最终分，点一下跳过去
  function updateDock() {
    const r = result, fin = st.review && st.reviewFor === $('input').value && st.finalPct != null;
    const pct = fin ? st.finalPct : r.total ? Math.round(r.livePct) : 0;
    $('dock-pct').textContent = pct + '%';
    $('dock-grade').textContent = finalizing ? 'AI 出结果中…' : fin ? '最终结果 ›' : r.total ? F.LEVELS[Math.max(0, F.levelOf(pct))].name.split(' · ')[0] : '等待开口';
    $('dock-dot').className = 'lv-dot' + (r.total ? ' lv' + (Math.max(0, F.levelOf(pct)) + 1) : '');
    const link = $('dock-score');
    link.href = fin || finalizing ? '#final-panel' : '#live';
    link.setAttribute('aria-label', fin || finalizing ? '查看最终结果' : '查看实时得分');
  }
  function fmtMin(m) { return m < 1 ? Math.round(m * 60) + ' 秒' : m.toFixed(1) + ' 分钟'; }

  // 最终分 = 说话的水分 60% + 会开得有没有用（会议体检）40%；旧记录没有体检时只看说话的水分
  function computeFinal() {
    const r = result, rv = st.review;
    if (!rv) return null;
    const byAi = r.aiPct != null && r.coverage.judged >= r.coverage.total * 0.8;
    const talk = byAi ? 0.2 * r.rulePct + 0.8 * r.aiPct : 0.4 * r.rulePct + 0.6 * (Number(rv.score) || 0);
    const meet = F.checkupWaste(rv.checkup);
    const how = byAi ? 'AI 逐句精读为主' : 'AI 通读打分为主';
    return {
      pct: Math.round(meet == null ? talk : 0.6 * talk + 0.4 * meet),
      note: meet == null ? `说话的水分（${how}）` : `说话的水分占 60%（${how}），会议体检占 40%`,
    };
  }

  function renderFinal() {
    const r = result, rv = st.review;
    const fin = computeFinal(), pct = st.finalPct = fin.pct;
    const lv = F.LEVELS[Math.max(0, F.levelOf(pct))];
    $('final-pct').innerHTML = pct + '<small>%</small>';
    $('final-grade').textContent = lv.name;
    $('final-note').textContent = fin.note;
    $('r-checkup').innerHTML = F.checkupHTML(rv.checkup);
    $('r-checkup-box').hidden = !rv.checkup;
    $('r-title').textContent = rv.title || '';
    $('r-oneliner').textContent = rv.one_liner || rv.verdict || '';
    $('r-roast').textContent = rv.roast || '';
    const li = (a) => (Array.isArray(a) && a.length ? '<ul>' + a.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<div class="empty">没有</div>');
    $('r-takeaways').innerHTML = li(rv.takeaways);
    $('r-todos').innerHTML = Array.isArray(rv.todos) && rv.todos.length
      ? '<table><thead><tr><th>负责人</th><th>事项</th><th>时间</th></tr></thead><tbody>' + rv.todos.map((t) => `<tr><td>${esc(t.who || '未指定')}</td><td>${esc(t.what || '')}</td><td>${esc(t.when || '未定')}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="empty">这场会没有产生任何待办。</div>';
    $('r-worst-box').hidden = !rv.worst_quote; $('r-worst').textContent = rv.worst_quote ? '“' + rv.worst_quote + '”' : '';
    const award = (label, o) => (o && o.name ? `<div class="award"><div class="label">${label}</div><b>${esc(o.name)}</b><span class="hint">${esc(o.reason || '')}</span></div>` : '');
    $('r-awards').innerHTML = award('废话之王', rv.king) + award('干货担当', rv.mvp);
    $('r-awards').hidden = !(rv.king || rv.mvp);

    const sp = r.speakers;
    $('speakers').innerHTML = sp.length
      ? '<table><thead><tr><th>发言人</th><th style="text-align:right">浓度</th><th></th><th style="text-align:right">干货句</th></tr></thead><tbody>' +
        sp.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${Math.round(s.livePct)}%</td><td style="width:38%"><div class="minibar"><i style="width:${Math.min(100, s.livePct)}%"></i></div></td><td class="num">${s.good}/${s.n}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="empty">用“名字：内容”的格式，或者录音自动分人，就能按人统计。</div>';
    const top = Object.entries(r.wc).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $('topwords').innerHTML = top.length ? top.map(([w, c]) => `<span class="chip">${esc(w)}<b>×${c}</b></span>`).join('') : '<span class="empty">没有命中词库的黑话</span>';
  }

  // ---------- AI 逐句精读 ----------
  const inflight = new Set(), failed = new Set();
  let judging = null;
  function pendingSentences() {
    const seen = new Set(), out = [];
    for (const s of result.sentences) {
      if (s.isTail || !s.len || st.ai.has(s.key) || inflight.has(s.key) || failed.has(s.key) || seen.has(s.key)) continue;
      seen.add(s.key); out.push(s);
    }
    return out;
  }
  /** 把还没判断的句子交给 AI；all=true 时一直判到全部读完 */
  function judge(all) {
    if (judging) return judging.then(() => (all ? judge(true) : undefined));
    judging = (async () => {
      try {
        while (true) {
          render();
          const todo = pendingSentences();
          if (!todo.length) return;
          const batch = todo.slice(0, 30);
          const first = result.sentences.indexOf(batch[0]);
          const context = result.sentences.slice(Math.max(0, first - 6), first).map((s) => (s.speaker ? s.speaker + '：' : '') + s.text);
          batch.forEach((s) => inflight.add(s.key));
          if (all) progress(`AI 正在逐句精读…（已读 ${result.coverage.judged}/${result.coverage.total} 句）`);
          try {
            const data = await api('/api/ai-judge', { context, sentences: batch.map((s) => ({ s: s.speaker || '', t: s.text })) });
            for (const x of data.results || []) { const s = batch[x.i]; if (s) st.ai.set(s.key, { w: x.w, tag: x.tag, why: x.why }); }
            for (const s of batch) if (!st.ai.has(s.key)) failed.add(s.key);
          } catch (err) {
            batch.forEach((s) => failed.add(s.key));
            throw err;
          } finally { batch.forEach((s) => inflight.delete(s.key)); }
          refreshStatus(800);
          if (!all) return;
        }
      } finally { judging = null; render(); }
    })();
    return judging;
  }
  function progress(msg) { $('ai-progress').hidden = !msg; $('ai-progress').innerHTML = msg || ''; }

  // ---------- 最终结果 ----------
  let finalizing = false;
  async function finalize({ automatic = false } = {}) {
    if (finalizing) return;
    const text = $('input').value.trim();
    const goFinal = () => {
      if (automatic && (IS_IOS || IS_ANDROID)) return;
      $('final-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    };
    if (text.length < 20) {
      progress(text ? '内容太短（不到 20 个字），多录几句再来。' : '没有录到文字，出不了最终结果。如果录音时一直没出字，检查一下浏览器的麦克风权限。');
      Site.toast(text ? '内容太短，出不了最终结果' : '没有录到文字'); goFinal(); clearPending(); return;
    }
    if (!st.status.ai) { progress('AI 还没配置，只能看实时得分。'); clearPending(); return; }
    const quota = st.status.quota?.['ai-review'];
    if (automatic && quota && quota.used >= quota.limit) {
      const loggedIn = !!st.status.user;
      const message = loggedIn ? '今天的最终报告额度已用完，明天 0 点重置' : '今天的游客报告额度已用完，登录后可以继续生成';
      traceRecording('最终报告额度已用完，跳过自动生成');
      progress(quotaHint({ code: 'quota', loggedIn, message }));
      Site.toast(message);
      clearPending();
      return;
    }
    finalizing = true; $('btn-ai').disabled = true; st.demo = false; 
    failed.clear(); updateDock(); goFinal();
    try {
      await judge(true);
      progress('AI 正在写最终点评…');
      const judged = result.sentences.filter((s) => s.ai);
      const worst = judged.slice().sort((a, b) => b.ai.w - a.ai.w).slice(0, 5).map((s) => ({ s: s.speaker || '', t: s.text, why: s.ai.why }));
      traceRecording('发送最终报告请求');
      const rv = await api('/api/ai-review', { text: $('input').value, rulePct: result.rulePct, aiPct: result.aiPct, tags: result.tags, worst });
      traceRecording('收到最终报告');
      st.review = rv; st.reviewFor = $('input').value;
      if (rv.title && !$('title').value.trim()) $('title').value = rv.title;
      progress('');
      finalizing = false;
      $('restore-note').hidden = true;
      render();
      save(true);
      goFinal();
    } catch (err) {
      traceRecording('生成报告失败');
      progress(quotaHint(err));
      Site.toast('最终结果没出来，原因写在「最终」里');
    } finally { finalizing = false; $('btn-ai').disabled = false; clearPending(); updateDock(); refreshStatus(500); }
  }
  $('btn-ai').addEventListener('click', () => { st.review = null; finalize(); });
  $('btn-restore-final').addEventListener('click', () => { $('restore-note').hidden = true; st.review = null; finalize(); });

  // ---------- 保存 ----------
  function defaultTitle() { return '会议 ' + Sh.fmtDate(st.at).slice(5); }
  function save(silent) {
    if (st.demo) { if (!silent) Site.toast('示例会议不用保存，录一场自己的吧'); return; }
    const text = $('input').value;
    if (!text.trim()) { if (!silent) Site.toast('还没有内容'); return; }
    st.id ||= S.newId();
    const keys = new Set(result.sentences.map((s) => s.key));
    const ai = new Map([...st.ai].filter(([k]) => keys.has(k)));
    const fresh = st.review && st.reviewFor === text;
    const rec = {
      id: st.id, at: st.at, updated: Date.now(), title: $('title').value.trim() || (fresh && st.review.title) || defaultTitle(),
      duration: Math.round(st.duration + (recState === 'listening' && timer ? (Date.now() - recStart) / 1000 : 0)), text, rulePct: result.rulePct, aiPct: result.aiPct,
      pct: fresh && st.finalPct != null ? st.finalPct : Math.round(result.livePct), final: !!fresh,
      review: fresh ? st.review : null, ai: S.packAi(ai),
      topWords: Object.entries(result.wc).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
    const ok = S.save(rec);
    if (ok) S.setCurrent(st.id, pendingFinal ? { pendingFinal: true } : null);
    st.savedText = text;
    $('saved-at').textContent = ok ? `已保存 ${Sh.fmtDate(Date.now()).slice(11)}` : '浏览器存储不可用，没能保存';
    if (!silent) Site.toast(ok ? '已保存到历史记录' : '没能保存：浏览器存储不可用');
  }
  $('btn-save').addEventListener('click', () => save(false));

  // ---------- 分享和导出 ----------
  function recForExport() {
    const fresh = st.review && st.reviewFor === $('input').value;
    return { at: st.at, duration: st.duration, title: $('title').value.trim() || defaultTitle(), text: $('input').value, review: fresh ? st.review : null, pct: fresh ? st.finalPct : result.livePct };
  }
  $('btn-card').addEventListener('click', async () => {
    const rec = recForExport(), rv = rec.review || {};
    $('btn-card').disabled = true;
    try {
      const how = await Sh.shareCard({
        title: rec.title, at: rec.at, duration: rec.duration, pct: rec.pct, rulePct: result.rulePct, aiPct: result.aiPct,
        oneLiner: rv.one_liner, king: rv.king, mvp: rv.mvp, checkup: rv.checkup, judged: result.coverage.judged,
        topWords: Object.entries(result.wc).sort((a, b) => b[1] - a[1]).slice(0, 6),
      });
      if (how === 'downloaded') Site.toast('化验单图片已下载');
    } catch { Site.toast('生成图片失败，再试一次'); } finally { $('btn-card').disabled = false; }
  });
  $('btn-md').addEventListener('click', () => { Sh.exportMarkdown(recForExport(), result); Site.toast('纪要已导出为 Markdown'); });
  $('btn-copy').addEventListener('click', () => {
    const rec = recForExport(), rv = rec.review || {};
    const lv = F.LEVELS[Math.max(0, F.levelOf(rec.pct))];
    const ck = rv.checkup ? '体检：' + F.CHECKUP.filter(([k]) => rv.checkup[k]).map(([k]) => `${k} ${rv.checkup[k].score}/5`).join('，') + '。' : '';
    const msg = `【会议废话化验单】${rec.title}：废话浓度 ${Math.round(rec.pct)}%，${lv.name}。${ck}${rv.king && rv.king.name ? '废话之王：' + rv.king.name + '。' : ''}${rv.one_liner || ''}`;
    const done = () => Site.toast('已复制');
    try { navigator.clipboard.writeText(msg).then(done, () => Site.toast(msg, 6000)); } catch { Site.toast(msg, 6000); }
  });

  // ---------- 文本框和样例 ----------
  let typing;
  $('input').addEventListener('input', () => {
    if (st.demo) { st.demo = false;  }
    clearTimeout(typing); typing = setTimeout(render, 200);
  });
  function reset(text, opts = {}) {
    if (recState !== 'idle') stopRec();
    st.id = null; st.at = Date.now(); st.ai = opts.ai || new Map(); st.review = opts.review || null; st.reviewFor = opts.review ? text : null;
    st.duration = opts.duration || 0; st.demo = !!opts.demo; st.savedText = null;
    failed.clear(); lastSpk = null; for (const k in nameMap) delete nameMap[k];
    $('names').hidden = true; $('names').querySelectorAll('label').forEach((l) => l.remove());
    $('title').value = opts.title || ''; $('saved-at').textContent = '';
    $('input').value = text; $('restore-note').hidden = true;
    pendingFinal = false; S.setCurrent(null);
    showClock(st.duration);
    render();
  }
  $('btn-clear').addEventListener('click', () => { reset(''); $('input').focus(); });
  $('btn-new').addEventListener('click', () => {
    if ($('input').value.trim() && !st.demo && st.savedText !== $('input').value) save(true);
    const url = new URL(location.href);
    if (url.searchParams.has('open')) {
      url.searchParams.delete('open');
      history.replaceState(history.state, '', url);
    }
    reset(''); Site.toast('开始新的一场'); $('input').focus();
  });

  // ---------- 录音（Azure 对话转写，自动分人） ----------
  let recog = null, recState = 'idle', recStart = 0, timer = null, refreshTimer = null, judgeTimer = null, lastSpk = null, stopping = false;
  let tokenCache = null;
  const nameMap = {};
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fmtClock = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  function showClock(sec) { $('rec-time').textContent = $('dock-time').textContent = fmtClock(sec); }

  function nameOf(id) {
    const m = /(\d+)$/.exec(id || '');
    if (!m) return null; // Unknown：还没认出来，接在上一位后面
    if (!nameMap[id]) {
      nameMap[id] = '发言人' + m[1];
      $('names').hidden = false;
      const lab = document.createElement('label');
      const inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 10; inp.id = 'name-' + id.replace(/\W/g, ''); inp.value = nameMap[id];
      lab.htmlFor = inp.id; lab.append('#' + m[1] + ' ', inp);
      inp.addEventListener('change', () => {
        const old = nameMap[id], neu = inp.value.trim().replace(/[：:\n|]/g, '') || old;
        if (neu === old) return;
        $('input').value = $('input').value.replace(new RegExp('^' + reEsc(old) + '：', 'gm'), neu + '：');
        for (const [k, v] of [...st.ai]) if (k.startsWith(old + '|')) { st.ai.delete(k); st.ai.set(neu + k.slice(old.length), v); }
        if (lastSpk === old) lastSpk = neu;
        nameMap[id] = neu; inp.value = neu; render();
      });
      $('names').append(lab);
    }
    return nameMap[id];
  }
  function appendText(t, speakerId) {
    t = t.trim(); if (!t) return;
    if (!/[。！？!?；;，,…]$/.test(t)) t += '。';
    const ta = $('input'); let v = ta.value;
    const name = nameOf(speakerId) || lastSpk || '发言人?';
    if (name !== lastSpk) { v = v.replace(/\s+$/, ''); v += (v ? '\n' : '') + name + '：'; lastSpk = name; }
    ta.value = v + t; livePartial = ''; ta.scrollTop = ta.scrollHeight; render();
    autosave();
  }
  // 边录边存：最多每 5 秒存一次，页面被系统重载也丢不了多少
  let autoTimer = null;
  function autosave() {
    if (autoTimer || st.demo) return;
    autoTimer = setTimeout(() => { autoTimer = null; if ($('input').value !== st.savedText) save(true); }, 5000);
  }
  // 录音时保持屏幕常亮：手机一锁屏，浏览器就会掐掉麦克风
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
    } catch { wakeLock = null; }
  }
  function setRecUI(state, msg) {
    const was = recState; recState = state;
    const label = state === 'starting' ? '正在连接…' : state === 'listening' ? '停止录音' : state === 'finishing' ? '收尾中…' : '开始录音';
    for (const [b, l] of [['btn-rec', 'rec-label'], ['dock-rec', 'dock-rec-label']]) { $(b).setAttribute('aria-pressed', state === 'idle' ? 'false' : 'true'); $(l).textContent = label; }
    $('rec-state').textContent = state === 'listening' ? '录音中，边说边打分' : state === 'idle' ? (result && result.total ? '已停止' : '还没开始录音') : '…';
    document.documentElement.classList.toggle('recording', state !== 'idle');
    keepAwake(state === 'listening');
    if (state === 'listening' && !timer) {
      recStart = Date.now();
      timer = setInterval(() => showClock(st.duration + (Date.now() - recStart) / 1000), 500);
      if (settings.autoJudge && st.status.ai) judgeTimer = setInterval(() => { judge(false).catch((e) => progress(quotaHint(e))); }, 6000);
    }
    if (state === 'idle') {
      if (timer) { st.duration += (Date.now() - recStart) / 1000; }
      clearInterval(timer); timer = null; clearTimeout(refreshTimer); refreshTimer = null; clearInterval(judgeTimer); judgeTimer = null;
      $('partial').classList.remove('live'); livePartial = ''; render();
      $('partial').textContent = msg || '录音已停止。';
      if (was === 'listening' || was === 'finishing') {
        clearTimeout(autoTimer); autoTimer = null;
        save(true);
        traceRecording('停录收尾完成');
        if (msg && $('input').value.trim()) $('partial').textContent = msg + ' 录到的文字已保存，可以接着录，或者点「出最终结果」。';
        // 错开一拍再终审：停录瞬间主线程还在拆音频管线，立刻大渲染 + 打 API 在安卓上容易卡死
        if (!msg && settings.autoJudge && st.status.ai) setTimeout(() => {
          traceRecording('开始生成报告');
          finalize({ automatic: true });
        }, 300);
      }
    }
  }
  async function fetchToken(force) {
    if (!force && tokenCache && Date.now() - tokenCache.at < 8 * 60 * 1000) return tokenCache;
    const d = await api('/api/speech-token');
    tokenCache = { token: d.token, region: d.region, at: Date.now() };
    refreshStatus(300);
    return tokenCache;
  }
  async function startRec() {
    setRecUI('starting');
    try {
      if (!window.SpeechSDK) throw new Error('语音组件还没加载完，等两秒再点');
      const { token, region } = await fetchToken(false);
      const sdk = window.SpeechSDK;
      const cfg = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      cfg.speechRecognitionLanguage = 'zh-CN';
      cfg.setProperty(sdk.PropertyId.SpeechServiceResponse_DiarizeIntermediateResults, 'true');
      const audio = sdk.AudioConfig.fromDefaultMicrophoneInput();
      // 手机上不用 AudioWorklet，改用老的 ScriptProcessor 取音：
      // 停止录音时 SDK 会关掉带 AudioWorklet 的音频上下文，iOS 会重载整页，安卓常卡死直至标签页崩溃
      if (AVOID_AUDIO_WORKLET) { try { audio.setProperty('MICROPHONE-WorkletSourceUrl', 'ignore'); } catch {} }
      recog = new sdk.ConversationTranscriber(cfg, audio);
      recog.transcribing = (_, e) => {
        livePartial = e.result.text || ''; partialSpeaker = e.result.speakerId || null;
        $('partial').textContent = '正在听：' + livePartial; $('partial').classList.add('live');
        renderSoon();
      };
      recog.transcribed = (_, e) => { if (e.result.reason === sdk.ResultReason.RecognizedSpeech) appendText(e.result.text, e.result.speakerId); };
      recog.canceled = (_, e) => { stopRec(e.reason === sdk.CancellationReason.Error ? '语音服务断开了：' + (e.errorDetails || '未知错误') : ''); };
      recog.sessionStopped = () => stopRec();
      // 令牌 10 分钟过期：按手上这张令牌的年龄算，满 8 分钟就续一张（开录时用的可能是几分钟前取的令牌）
      const renew = () => {
        refreshTimer = setTimeout(async () => {
          try { if (recog) { recog.authorizationToken = (await fetchToken(true)).token; renew(); } }
          catch (e) { stopRec(e.code === 'quota' ? '今天的录音额度用完了，已停止。' + (e.loggedIn ? '' : '登录后额度更高。') : '续期失败，录音已停止。'); }
        }, Math.max(15000, tokenCache.at + 8 * 60 * 1000 - Date.now()));
      };
      renew();
      await new Promise((ok, fail) => recog.startTranscribingAsync(ok, fail));
      setRecUI('listening');
      traceRecording('录音已开始');
      $('partial').textContent = '开始说吧，我在听。';
    } catch (err) {
      const m = String(err && (err.message || err));
      if (recog) { try { recog.close(); } catch {} recog = null; }
      if (err && err.code === 'quota') { setRecUI('idle', ' '); $('partial').innerHTML = quotaHint(err); return; }
      setRecUI('idle', '开不了录音：' + (/Permission|NotAllowed|denied/i.test(m) ? '没有麦克风权限，请在浏览器地址栏左侧允许麦克风。' : m));
    }
  }
  function stopRec(msg) {
    if (!recog || stopping) { if (!recog && recState !== 'idle') setRecUI('idle', msg); return; }
    stopping = true; setRecUI('finishing');
    const r = recog;
    // 先停转写，再异步 close：同步 close + 立刻 render/finalize 会堵死安卓 Chrome 主线程
    const done = (step) => {
      traceRecording(step);
      recog = null; stopping = false;
      setTimeout(() => {
        traceRecording('调用 SDK 关闭');
        try {
          r.close(() => traceRecording('SDK 关闭完成'), () => traceRecording('SDK 关闭失败'));
        } catch { traceRecording('SDK 关闭抛出错误'); }
        traceRecording('SDK 关闭调用返回');
        setTimeout(() => setRecUI('idle', msg), AVOID_AUDIO_WORKLET ? 120 : 0);
      }, 0);
    };
    traceRecording('调用 SDK 停止转写');
    r.stopTranscribingAsync(() => done('SDK 停止转写成功'), () => done('SDK 停止转写失败'));
  }
  function toggleRec() {
    if (recState === 'listening') {
      traceRecording('点击停止录音');
      // 先存一份并记下“要出最终结果”，万一停止的瞬间页面被重载，回来能接着出
      pendingFinal = !!(settings.autoJudge && st.status.ai);
      save(true);
      stopRec(); return;
    }
    if (recState !== 'idle') return;
    if (st.demo) reset('');
    lastSpk = null;
    recordingSteps = [];
    traceRecording('点击开始录音');
    startRec();
  }
  $('btn-rec').addEventListener('click', toggleRec);
  $('dock-rec').addEventListener('click', toggleRec); // 手机底部那颗
  window.addEventListener('beforeunload', (e) => { if (recState !== 'idle') { e.preventDefault(); e.returnValue = ''; } });
  // 切到别的 App、锁屏、关页面之前立刻存一份；回到页面时重新保持常亮
  const flush = () => { if (recState !== 'idle' && $('input').value !== st.savedText) save(true); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else if (recState === 'listening') keepAwake(true); });
  window.addEventListener('pagehide', () => {
    if (recordingSteps.length) traceRecording('页面离开');
    flush();
  });

  // ---------- 启动 ----------
  applySettings();
  if (recordingDebug) {
    $('recording-debug').hidden = false;
    try { recordingSteps = (localStorage.getItem(recordingDebugKey) || '').split('\n').filter(Boolean); } catch {}
    const navigation = performance.getEntriesByType('navigation')[0];
    traceRecording('页面启动（' + (navigation?.type || 'unknown') + '）');
  }
  const openId = params.get('open');
  const rec = openId && S.get(openId);
  // 没指定打开哪场时，恢复刚才那场会（页面被手机重载、误触下拉刷新都不怕）
  const lastInfo = !rec ? S.currentInfo() : null;
  const last = lastInfo && S.get(lastInfo.id);
  const resume = !!(last && lastInfo.pendingFinal && !last.final); // 停止录音时页面被重载了，接着出最终结果
  function openRecord(r) {
    reset(r.text, { title: r.title, ai: S.unpackAi(r.ai), review: r.review, duration: r.duration });
    st.id = r.id; st.at = r.at; st.savedText = r.text;
    S.setCurrent(r.id);
  }
  if (rec) {
    openRecord(rec);
    $('saved-at').textContent = '来自历史记录';
  } else if (last) {
    openRecord(last);
    // 说清楚是哪一场：开始时间 + 录了多久，免得以为是以前的旧会
    const dur = last.duration ? (last.duration < 60 ? Math.round(last.duration) + ' 秒' : Sh.fmtDur(last.duration)) : '';
    $('saved-at').textContent = '接着上次';
    const which = `这是你 ${Sh.fmtDate(last.at).slice(11, 16)} 开始的那场会${dur ? `（录了 ${dur}）` : ''}`;
    $('restore-text').textContent = resume
      ? `${which}。本场文字已恢复，正在接着出最终结果…`
      : `${which}，页面重新打开后接着显示在这里。` + (last.final ? '' : '还没出最终结果，');
    $('btn-restore-final').hidden = !!last.final || resume;
    $('restore-note').hidden = false;
  } else {
    reset(''); // 不再放示例会议，打开就是空白的一场
  }
  // openRecord 已经把标记清掉了：只自动续一次，万一出结果时又被重载，就不会反复重试
  refreshStatus(0, resume ? async () => {
    if (st.status.ai && settings.autoJudge) {
      traceRecording('恢复生成报告');
      await finalize({ automatic: true });
    }
    if (st.id === last.id && !$('restore-note').hidden) {
      $('restore-text').textContent = $('restore-text').textContent.replace('正在接着出最终结果…', '最终报告尚未生成。');
      $('btn-restore-final').hidden = !st.status.ai;
    }
  } : null);
})();
