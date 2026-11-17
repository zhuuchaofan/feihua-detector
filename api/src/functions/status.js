// GET /api/status —— 告诉前端哪些功能可用、当前是谁、今天还剩多少额度（不暴露任何密钥）
const { app } = require('@azure/functions');
const { providerConfig } = require('../lib/llm');
const { quotaReport } = require('../lib/guard');

app.http('status', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status',
  handler: async (request) => ({
    headers: { 'Cache-Control': 'no-store' },
    jsonBody: {
      speech: Boolean(process.env.SPEECH_KEY && process.env.SPEECH_REGION),
      ai: Boolean(providerConfig()),
      ...quotaReport(request),
    },
  }),
});
