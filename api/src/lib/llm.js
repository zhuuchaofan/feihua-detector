// 大模型调用：优先 OpenAI 兼容接口（DeepSeek、通义千问等），没配再用 Azure OpenAI
//   LLM_BASE_URL  如 https://api.deepseek.com
//   LLM_API_KEY   对应平台的 API Key
//   LLM_MODEL     如 deepseek-chat
function providerConfig() {
  const base = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
  if (base && process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    return { kind: 'openai-compatible', url: `${base}/chat/completions`, headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` }, model: process.env.LLM_MODEL };
  }
  const endpoint = (process.env.AOAI_ENDPOINT || '').replace(/\/+$/, '');
  if (endpoint && process.env.AOAI_KEY && process.env.AOAI_DEPLOYMENT) {
    return { kind: 'azure', url: `${endpoint}/openai/v1/chat/completions`, headers: { 'api-key': process.env.AOAI_KEY }, model: process.env.AOAI_DEPLOYMENT };
  }
  return null;
}

class LlmError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function parseJson(content) {
  const s = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  throw new LlmError('AI 返回的不是合法 JSON，再试一次', 502);
}

async function chatJSON(system, user, { maxTokens = 1500, temperature = 0.8, timeoutMs = 40000 /* SWA 托管函数 45 秒超时，提前放弃给前端能看懂的报错 */, log = () => {} } = {}) {
  const cfg = providerConfig();
  if (!cfg) throw new LlmError('AI 还没配置', 501);
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
  };
  if (cfg.kind === 'azure') { // gpt-5 系列是推理模型：用 max_completion_tokens，不支持 temperature
    body.reasoning_effort = process.env.AOAI_REASONING_EFFORT || 'low';
    body.max_completion_tokens = maxTokens * 3;
  } else {
    body.temperature = temperature;
    body.max_tokens = maxTokens;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (err) {
    log(`LLM fetch error: ${err.message}`);
    throw new LlmError(err.name === 'AbortError' ? 'AI 想太久了，再试一次' : '连不上 AI 服务', 502);
  } finally { clearTimeout(t); }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    log(`LLM ${res.status}: ${detail.slice(0, 500)}`);
    if (res.status === 402) throw new LlmError('AI 账户余额不足，请站长充值', 502);
    if (res.status === 429) throw new LlmError('AI 服务太忙，稍后再试', 503);
    throw new LlmError(`AI 服务返回 ${res.status}`, 502);
  }
  const data = await res.json();
  return parseJson(data.choices?.[0]?.message?.content);
}

module.exports = { chatJSON, providerConfig, LlmError };
