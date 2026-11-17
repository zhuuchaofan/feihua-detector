// 公共：顶栏、登录状态、提示条
(function () {
  const here = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  const links = [['/', '首页'], ['/app', '开始检测'], ['/history', '历史记录']];
  const head = document.getElementById('site-head');
  if (head) {
    head.className = 'site-head gutter';
    head.innerHTML = `<div class="wrap">
      <a class="brand" href="/"><img src="/assets/favicon.svg" alt="">废话浓度检测器</a>
      <nav class="nav" aria-label="主导航">${links.map(([h, t]) => `<a href="${h}"${here === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
      <div class="auth" id="auth"></div>
    </div>`;
  }

  const back = encodeURIComponent(location.pathname + location.search);
  const loginMenu = `<p>登录后每天的录音和 AI 额度更高</p>
    <a href="/.auth/login/aad?post_login_redirect_uri=${back}">用微软账号登录</a>
    <a href="/.auth/login/github?post_login_redirect_uri=${back}">用 GitHub 登录</a>`;

  // 当前登录用户：Static Web Apps 内置登录的 /.auth/me；本地开发没有这个接口时当作未登录
  const me = fetch('/.auth/me', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.clientPrincipal) || null)
    .catch(() => null);

  function renderAuth(user) {
    const box = document.getElementById('auth');
    if (!box) return;
    if (user) {
      box.innerHTML = `<span class="who" title="${esc(user.userDetails || '')}">${esc(user.userDetails || '已登录')}</span>
        <a class="btn small quiet" href="/.auth/logout?post_logout_redirect_uri=${back}">退出</a>`;
    } else {
      box.innerHTML = `<button class="btn small" id="btn-login" aria-expanded="false" aria-haspopup="true">登录</button><div class="menu" id="login-menu" hidden>${loginMenu}</div>`;
      const btn = document.getElementById('btn-login'), menu = document.getElementById('login-menu');
      btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
      document.addEventListener('click', (e) => { if (!menu.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    }
  }
  me.then(renderAuth);

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  let toastTimer;
  function toast(msg, ms = 2400) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  window.Site = { me, esc, toast, loginMenu, openLogin() { const b = document.getElementById('btn-login'); if (b) { b.click(); b.scrollIntoView({ block: 'nearest' }); } } };
})();
