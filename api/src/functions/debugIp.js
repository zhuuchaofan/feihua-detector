// 临时：看 Azure 网关实际给了哪些 IP 相关的请求头，测完就删
const { app } = require('@azure/functions');
app.http('debug-ip', {
  methods: ['GET'], authLevel: 'anonymous', route: 'debug-ip',
  handler: async (request) => {
    const out = {};
    for (const [k, v] of request.headers) if (/ip|forward|client|azure|real|via|x-ms-original|x-arr/i.test(k) && k !== 'x-ms-client-principal') out[k] = v;
    return { headers: { 'Cache-Control': 'no-store' }, jsonBody: out };
  },
});
