// GET /api/speech-token —— 用后端保存的 Azure 语音密钥换一个 10 分钟有效的临时令牌，浏览器只拿令牌，拿不到密钥。
const { app } = require('@azure/functions');

let cache = { token: null, expires: 0 };

function tokenUrl(region) {
  // 世纪互联（中国区）区域名以 china 开头，域名是 azure.cn
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
    if (!key || !region) {
      return { status: 500, jsonBody: { error: '服务器还没配置 SPEECH_KEY 和 SPEECH_REGION' } };
    }
    const now = Date.now();
    if (cache.token && cache.expires > now) {
      return { jsonBody: { token: cache.token, region }, headers: { 'Cache-Control': 'no-store' } };
    }
    try {
      const res = await fetch(tokenUrl(region), {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
      });
      if (!res.ok) {
        context.log(`issueToken failed: ${res.status}`);
        return { status: 502, jsonBody: { error: `语音服务拒绝了请求（${res.status}），检查密钥和区域是否匹配` } };
      }
      const token = await res.text();
      cache = { token, expires: now + 8 * 60 * 1000 }; // 令牌 10 分钟有效，提前 2 分钟换新
      return { jsonBody: { token, region }, headers: { 'Cache-Control': 'no-store' } };
    } catch (err) {
      context.log(`issueToken error: ${err.message}`);
      return { status: 502, jsonBody: { error: '连不上 Azure 语音服务' } };
    }
  },
});
