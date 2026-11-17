// 公开站点的额度：未登录按 IP 计，登录后按账号计，额度更高。每天北京时间 0 点重置。
// 用量存在哪里见 counter.js；“这是谁”见 identity.js。
const counter = require('./counter');
const { who } = require('./identity');

const QUOTAS = {
  // 录音：每次取一张语音令牌可以录约 8 分钟
  'speech-token': { anon: 5, user: 25, unit: '段录音（每段约 8 分钟）' },
  // AI 逐句精读：按句子数计
  'ai-judge': { anon: 600, user: 5000, unit: '句 AI 精读' },
  // AI 终审点评：按次数计
  'ai-review': { anon: 3, user: 30, unit: '次最终结果' },
};
// 全站每天的总上限，防止被人换着 IP 刷
const SITE_DAILY = { 'speech-token': 3000, 'ai-judge': 200000, 'ai-review': 2000 };

const envName = (name) => name.toUpperCase().replace(/-/g, '_');
const envNumber = (key) => (Number(process.env[key]) > 0 ? Number(process.env[key]) : 0);

function beijingDay() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function limitFor(name, isUser) {
  return envNumber(`QUOTA_${envName(name)}_${isUser ? 'USER' : 'ANON'}`) || QUOTAS[name][isUser ? 'user' : 'anon'];
}
function siteCapFor(name) { return envNumber(`SITE_DAILY_${envName(name)}`) || SITE_DAILY[name]; }
const personKey = (name, key) => `${name}|${key}`;
const siteKey = (name) => `${name}|site`;

/** 读当前用量，不扣额度 */
async function quotaReport(request) {
  const { user, key } = who(request);
  const day = beijingDay();
  const out = {};
  await Promise.all(Object.keys(QUOTAS).map(async (name) => {
    out[name] = { used: await counter.get(day, personKey(name, key)), limit: limitFor(name, !!user), unit: QUOTAS[name].unit };
  }));
  return { user, quota: out, resetsAt: '北京时间每天 0 点' };
}

/**
 * 扣额度。amount 为本次消耗量（如句子数）。返回 null 表示放行，否则返回要直接回给浏览器的 429 响应。
 */
async function guard(request, name, amount = 1) {
  const { user, key } = who(request);
  const day = beijingDay();
  const limit = limitFor(name, !!user);
  if (!(await counter.add(day, personKey(name, key), amount, limit))) {
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
  if (!(await counter.add(day, siteKey(name), amount, siteCapFor(name)))) {
    await counter.sub(day, personKey(name, key), amount);
    return { status: 429, jsonBody: { code: 'site_quota', error: '今天全站额度用完了，明天再来' } };
  }
  return null;
}

/** 调用失败时把额度退回去 */
async function refund(request, name, amount = 1) {
  const { key } = who(request);
  const day = beijingDay();
  await Promise.all([counter.sub(day, personKey(name, key), amount), counter.sub(day, siteKey(name), amount)]);
}

module.exports = { guard, refund, quotaReport, QUOTAS };
