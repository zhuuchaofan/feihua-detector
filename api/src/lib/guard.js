// 公开站点的额度：未登录按 IP 计，登录后按账号计，额度更高。每天北京时间 0 点重置。
// 计数存在内存里，按实例生效：函数实例重启会清零，用来挡住普通滥用足够了。
const QUOTAS = {
  // 录音：每次取一张语音令牌可以录约 8 分钟
  'speech-token': { anon: 5, user: 25, unit: '段录音（每段约 8 分钟）' },
  // AI 逐句精读：按句子数计
  'ai-judge': { anon: 600, user: 5000, unit: '句 AI 精读' },
  // AI 终审点评：按次数计
  'ai-review': { anon: 3, user: 30, unit: '次最终结果' },
};
const SITE_DAILY = { 'speech-token': 3000, 'ai-judge': 200000, 'ai-review': 2000 };

const usage = { day: '', counts: new Map(), site: {} };

function beijingDay() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function roll() {
  const d = beijingDay();
  if (usage.day !== d) { usage.day = d; usage.counts = new Map(); usage.site = {}; }
}

function clientIp(request) {
  const raw = (request.headers.get('x-forwarded-for') || request.headers.get('x-client-ip') || '').split(',')[0].trim();
  return (raw.match(/:/g) || []).length === 1 ? raw.split(':')[0] : (raw || 'unknown');
}

// Static Web Apps 内置登录会把用户信息放在这个请求头里（base64 JSON），只有经过 SWA 网关的请求才会带上
function principal(request) {
  const h = request.headers.get('x-ms-client-principal');
  if (!h) return null;
  try {
    const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    if (!p || !p.userId) return null;
    return { id: p.userId, name: p.userDetails || '', provider: p.identityProvider || '' };
  } catch { return null; }
}

function limitFor(name, isUser) {
  const q = QUOTAS[name];
  const env = process.env[`QUOTA_${name.toUpperCase().replace(/-/g, '_')}_${isUser ? 'USER' : 'ANON'}`];
  return Number(env) > 0 ? Number(env) : (isUser ? q.user : q.anon);
}

function who(request) {
  const user = principal(request);
  return { user, key: user ? `u:${user.provider}:${user.id}` : `ip:${clientIp(request)}` };
}

/** 读当前用量，不扣额度 */
function quotaReport(request) {
  roll();
  const { user, key } = who(request);
  const out = {};
  for (const name of Object.keys(QUOTAS)) {
    out[name] = { used: usage.counts.get(`${name}|${key}`) || 0, limit: limitFor(name, !!user), unit: QUOTAS[name].unit };
  }
  return { user, quota: out, resetsAt: '北京时间每天 0 点' };
}

/**
 * 扣额度。amount 为本次消耗量（如句子数）。返回 null 表示放行，否则返回要直接回给浏览器的 429 响应。
 */
function guard(request, name, amount = 1) {
  roll();
  const { user, key } = who(request);
  const limit = limitFor(name, !!user);
  const k = `${name}|${key}`;
  const used = usage.counts.get(k) || 0;
  if (used + amount > limit) {
    return {
      status: 429,
      jsonBody: {
        code: 'quota',
        loggedIn: !!user,
        error: user
          ? `今天的额度用完了（${limit} ${QUOTAS[name].unit}），明天 0 点重置`
          : `未登录每天只有 ${limit} ${QUOTAS[name].unit}，已经用完了。登录后额度更高`,
      },
    };
  }
  const siteCap = Number(process.env[`SITE_DAILY_${name.toUpperCase().replace(/-/g, '_')}`]) || SITE_DAILY[name];
  if ((usage.site[name] || 0) + amount > siteCap) {
    return { status: 429, jsonBody: { code: 'site_quota', error: '今天全站额度用完了，明天再来' } };
  }
  usage.counts.set(k, used + amount);
  usage.site[name] = (usage.site[name] || 0) + amount;
  return null;
}

/** 调用失败时把额度退回去 */
function refund(request, name, amount = 1) {
  const { key } = who(request);
  const k = `${name}|${key}`;
  usage.counts.set(k, Math.max(0, (usage.counts.get(k) || 0) - amount));
  usage.site[name] = Math.max(0, (usage.site[name] || 0) - amount);
}

module.exports = { guard, refund, quotaReport, principal, QUOTAS };
