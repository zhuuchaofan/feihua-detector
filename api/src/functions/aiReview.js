// POST /api/ai-review —— 把会议文字交给大模型（DeepSeek、通义千问或 Azure OpenAI），返回 AI 判定的废话浓度、结论、待办和点评。
const { app } = require('@azure/functions');

const MAX_CHARS = 20000;

const SYSTEM = `你是“会议废话浓度检测器”的首席化验师，说话犀利幽默但不刻薄到人身攻击。
你会收到一段会议转写（可能带“发言人：内容”格式，可能有错别字和缺标点）。发言人可能是自动分辨的“发言人1、发言人2”，偶尔会把两个人认成一个或把一句话归错人，请结合语气和内容理解。还会附上规则引擎算出的废话浓度供参考。
请判断这场会到底有多少信息量，只输出 JSON，字段如下：
{
  "score": 0-100 的整数，AI 判定的废话浓度，
  "verdict": "一句话评级，10 字以内",
  "takeaways": ["真正有用的结论，最多 5 条，没有就给空数组"],
  "todos": [{"who": "负责人，不明确写“未指定”", "what": "要做的事", "when": "时间，不明确写“未定”"}],
  "worst_quote": "全场最空洞的一句原话",
  "roast": "80 到 150 字的毒舌点评，要具体引用会上的内容"
}`;

// 两种接法，优先用通用的 OpenAI 兼容接口（DeepSeek、通义千问等），没配再看 Azure OpenAI
//   LLM_BASE_URL  如 https://api.deepseek.com 或 https://dashscope.aliyuncs.com/compatible-mode/v1
//   LLM_API_KEY   对应平台的 API Key
//   LLM_MODEL     如 deepseek-chat 或 qwen-plus
function providerConfig() {
  const base = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
  if (base && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    return {
      url: `${base}/chat/completions`,
      headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      model: process.env.LLM_MODEL,
      extra: { temperature: 0.8, max_tokens: 1500 },
    };
  }
  const endpoint = (process.env.AOAI_ENDPOINT || '').replace(/\/+$/, '');
  if (endpoint && process.env.AOAI_KEY && process.env.AOAI_DEPLOYMENT) {
    // Azure v1 接口；gpt-5 系列是推理模型，用 max_completion_tokens，不支持 temperature
    return {
      url: `${endpoint}/openai/v1/chat/completions`,
      headers: { 'api-key': process.env.AOAI_KEY },
      model: process.env.AOAI_DEPLOYMENT,
      extra: { reasoning_effort: process.env.AOAI_REASONING_EFFORT || 'low', max_completion_tokens: 4000 },
    };
  }
  return null;
}

app.http('ai-review', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai-review',
  handler: async (request, context) => {
    const cfg = providerConfig();
    if (!cfg) {
      return { status: 501, jsonBody: { error: 'AI 终审还没配置：在网站设置里填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或 Azure OpenAI 的 AOAI_* 设置' } };
    }
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: '请求格式不对' } }; }
    const text = String(body.text || '').trim();
    if (text.length < 20) return { status: 400, jsonBody: { error: '内容太短，多录几句再来' } };
    const clipped = text.slice(0, MAX_CHARS);
    const rulePct = Number(body.rulePct);

    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { ...cfg.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `规则引擎废话浓度：${isFinite(rulePct) ? rulePct + '%' : '未知'}\n${text.length > MAX_CHARS ? '（内容过长，只截取了前 ' + MAX_CHARS + ' 字）\n' : ''}会议内容：\n${clipped}` },
          ],
          response_format: { type: 'json_object' },
          ...cfg.extra,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        context.log(`LLM ${res.status}: ${detail.slice(0, 500)}`);
        return { status: 502, jsonBody: { error: `AI 服务返回 ${res.status}，检查模型名和密钥` } };
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      let review;
      try { review = JSON.parse(content); } catch { return { status: 502, jsonBody: { error: 'AI 返回的不是合法 JSON，再试一次' } }; }
      return { jsonBody: review };
    } catch (err) {
      context.log(`LLM error: ${err.message}`);
      return { status: 502, jsonBody: { error: '连不上 AI 服务' } };
    }
  },
});
