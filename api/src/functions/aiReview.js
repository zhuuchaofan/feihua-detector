// POST /api/ai-review —— 把会议文字交给大模型（DeepSeek、通义千问或 Azure OpenAI），
// 返回 AI 判定的废话浓度、逐句信息量判定、结论、待办和毒舌点评。
const { app } = require('@azure/functions');

const MAX_CHARS = 20000;
const MAX_LINES = 200;      // 逐句判定最多送这么多句，太多会超过 SWA 托管函数 45 秒的时限
const TIMEOUT_MS = 40000;   // 比 45 秒早一点放弃，给前端一个能看懂的报错

const SYSTEM = `你是“会议废话浓度检测器”的首席化验师，嘴毒、反应快、懂职场黑话，像脱口秀演员一样拆穿空话，但只骂“话”不骂“人”。
你会收到一段会议转写，每句前面有编号，如“[3] 王总：……”。转写可能有错别字、缺标点；发言人可能是自动分辨的“发言人1、发言人2”，偶尔会认错人，请结合语气和内容理解。还会附上规则引擎算出的废话浓度供参考，你不必附和它。

任务一：逐句判信息量。每一句都要判，按编号顺序，不能漏也不能多：
  2 = 干货：带来了新事实、决定、数字、时间、负责人、具体问题或可执行的方案
  1 = 掺水：有一点内容，但被套话包裹、重复了别人已说过的、或说得过于笼统
  0 = 纯废话：客套寒暄、表态口号、黑话空转、复读、无主语的“要重视”“要推进”
任务二：给整场会打分并点评。

只输出 JSON，字段如下：
{
  "score": 0-100 的整数，废话浓度（大致等于 0 分句和 1 分句的水分所占篇幅比例），
  "verdict": "一句话评级，10 字以内，要损",
  "lines": [按编号顺序，每句一个整数 0/1/2，长度必须等于句子总数],
  "callouts": [{"i": 句子编号, "why": "这句为什么是废话或为什么是干货，15 字以内，要毒"}]，挑最典型的 3 到 8 句，废话和干货都可以,
  "takeaways": ["真正有用的结论，最多 5 条，没有就给空数组"],
  "todos": [{"who": "负责人，不明确写“未指定”", "what": "要做的事", "when": "时间，不明确写“未定”"}],
  "worst_quote": "全场最空洞的一句原话",
  "roast": "毒舌点评，200 到 300 字"
}

roast 的要求：脱口秀吐槽风，至少逐字引用 3 处原话并当场拆穿，其中至少一处用“翻译成人话就是：……”的句式；点出谁在注水、谁在干活；结尾给一句扎心但实用的建议。可以狠狠嘲讽说法、开会方式和黑话，不攻击人格、外貌、性别、年龄、地域等身份特征，不说脏话。`;

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
      extra: { temperature: 1.0, max_tokens: 4000 },
    };
  }
  const endpoint = (process.env.AOAI_ENDPOINT || '').replace(/\/+$/, '');
  if (endpoint && process.env.AOAI_KEY && process.env.AOAI_DEPLOYMENT) {
    // Azure v1 接口；gpt-5 系列是推理模型，用 max_completion_tokens，不支持 temperature
    return {
      url: `${endpoint}/openai/v1/chat/completions`,
      headers: { 'api-key': process.env.AOAI_KEY },
      model: process.env.AOAI_DEPLOYMENT,
      extra: { reasoning_effort: process.env.AOAI_REASONING_EFFORT || 'low', max_completion_tokens: 8000 },
    };
  }
  return null;
}

// 前端送来的句子列表 → 带编号的转写；没送句子就用原文
function buildTranscript(body, text) {
  const raw = Array.isArray(body.sentences) ? body.sentences : [];
  const sents = [];
  let chars = 0;
  for (const s of raw) {
    if (sents.length >= MAX_LINES) break;
    const t = String((s && s.t) || '').trim();
    if (!t) continue;
    const who = String((s && s.who) || '').trim().slice(0, 20);
    const line = `[${sents.length}] ${who ? who + '：' : ''}${t}`;
    if (chars + line.length > MAX_CHARS) break;
    chars += line.length + 1;
    sents.push({ i: Number.isInteger(s.i) ? s.i : sents.length, line });
  }
  if (!sents.length) {
    const clipped = text.slice(0, MAX_CHARS);
    return { transcript: clipped, ids: [], truncated: text.length > MAX_CHARS };
  }
  return {
    transcript: sents.map(s => s.line).join('\n'),
    ids: sents.map(s => s.i),
    truncated: sents.length < raw.length,
  };
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
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
    const rulePct = Number(body.rulePct);
    const { transcript, ids, truncated } = buildTranscript(body, text);

    const user = [
      `规则引擎废话浓度：${isFinite(rulePct) ? rulePct + '%' : '未知'}`,
      ids.length ? `句子总数：${ids.length}（lines 数组长度必须是 ${ids.length}）` : '这段没有编号，lines 给空数组即可。',
      truncated ? '（内容过长，只送来了前面一部分）' : '',
      '会议内容：',
      transcript,
    ].filter(Boolean).join('\n');

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        signal: ac.signal,
        headers: { ...cfg.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
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

      // 逐句判定：按位置对回前端的句子编号，只收 0/1/2
      const lines = [];
      if (Array.isArray(review.lines)) {
        review.lines.slice(0, ids.length).forEach((v, k) => {
          const n = clampInt(v, 0, 2);
          if (n !== null) lines.push({ i: ids[k], v: n });
        });
      }
      const callouts = [];
      if (Array.isArray(review.callouts)) {
        for (const c of review.callouts.slice(0, 12)) {
          const k = Number(c && c.i);
          if (!Number.isInteger(k) || k < 0 || k >= ids.length) continue;
          callouts.push({ i: ids[k], why: String(c.why || '').slice(0, 40) });
        }
      }
      review.lines = lines;
      review.callouts = callouts;
      review.linesComplete = ids.length > 0 && lines.length === ids.length;
      review.linesTruncated = truncated;
      return { jsonBody: review };
    } catch (err) {
      if (err.name === 'AbortError') {
        context.log('LLM timeout');
        return { status: 504, jsonBody: { error: 'AI 想太久了（超过 40 秒），会议太长的话可以分段再试' } };
      }
      context.log(`LLM error: ${err.message}`);
      return { status: 502, jsonBody: { error: '连不上 AI 服务' } };
    } finally {
      clearTimeout(timer);
    }
  },
});
