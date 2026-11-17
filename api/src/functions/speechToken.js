// GET /api/speech-token —— 用后端保存的 Azure 语音密钥换一个 10 分钟有效的临时令牌，浏览器只拿令牌，拿不到密钥。
const { app } = require('@azure/functions');
const { guard, refund } = require('../lib/guard');

function tokenUrl(region) {
  const host = region.startsWith('china') ? 'api.cognitive.azure.cn' : 'api.cognitive.microsoft.com';
  return `https://${region}.${host}/sts/v1.0/issueToken`;
}

app.http('speech-token', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'speech-token',
  handler: async (request, context) => {
    const key = process.env.SPEECH_KEY;
    const region = (process.env.SPEECH_REGION || '').trim();
    if (!key || !region) return { status: 500, jsonBody: { error: '服务器还没配置语音服务' } };
    const blocked = guard(request, 'speech-token');
    if (blocked) return blocked;
    // 每次都换一张新令牌，不在服务器上缓存：以前多人共用一张缓存 8 分钟的令牌，
    // 浏览器续期时可能拿到快过期的旧令牌，长会议录到 10 来分钟就会断线
    try {
      const res = await fetch(tokenUrl(region), { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' } });
      if (!res.ok) {
        refund(request, 'speech-token');
        context.log(`issueToken failed: ${res.status}`);
        return { status: 502, jsonBody: { error: `语音服务拒绝了请求（${res.status}）` } };
      }
      const token = await res.text();
      return { jsonBody: { token, region }, headers: { 'Cache-Control': 'no-store' } };
    } catch (err) {
      refund(request, 'speech-token');
      context.log(`issueToken error: ${err.message}`);
      return { status: 502, jsonBody: { error: '连不上 Azure 语音服务' } };
    }
  },
});
