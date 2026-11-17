// POST /api/ai-judge —— AI 逐句精读：判断每句话有没有信息量
// 请求：{ context: ["前文若干句"], sentences: [{ i, s: "发言人", t: "内容" }] }，最多 30 句
// 返回：{ results: [{ i, w: 0-100 废话程度, tag, why }] }
const { app } = require('@azure/functions');
const { chatJSON } = require('../lib/llm');
const { guard, refund } = require('../lib/guard');

const MAX_SENTENCES = 30;
const TAGS = ['干货', '决策', '待办', '提问', '客套', '黑话', '空话', '复读', '跑题', '口水'];

const SYSTEM = `你是“会议废话浓度检测器”的 AI 鉴定员，逐句判断会议发言有没有信息量。
输入是 JSON：{"context": [前文几句，只帮你理解上下文，不用判断], "sentences": [{"i": 编号, "s": "发言人", "t": "这句话"}]}。
对 sentences 里的每一句给出：
- "w"：0 到 100 的整数，废话程度。0 = 有具体事实、数字、结论、决定、分工、时间点，或者是推动问题的好问题；100 = 纯客套、空话、黑话堆砌、重复前面说过的意思、或者没有任何新信息。
- "tag"：从这些里选一个：干货、决策、待办、提问、客套、黑话、空话、复读、跑题、口水。
- "why"：不超过 16 个字的一句短评，一针见血，可以毒舌；干货也可以夸一句。
判断要点：
- 语音转写可能有错别字、缺标点，按意思判断，别因为错字扣分。
- 黑话本身不等于废话：“下周三前拉通法务，把合同条款对齐”有具体时间和事，算干货。
- “好的”“对对对”“嗯”这类附和，打口水，w 在 60 到 80 之间。
- 和 context 或前面句子意思重复的，打复读，w 不低于 80。
只输出 JSON：{"results": [{"i": 0, "w": 35, "tag": "干货", "why": "..."}]}，每一句都要有，顺序和输入一致。`;

app.http('ai-judge', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai-judge',
  handler: async (request, context) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: '请求格式不对' } }; }
    const sentences = (Array.isArray(body.sentences) ? body.sentences : []).slice(0, MAX_SENTENCES)
      .map((x, i) => ({ i, s: String(x.s || '').slice(0, 20), t: String(x.t || '').slice(0, 300) }))
      .filter((x) => x.t.trim());
    if (!sentences.length) return { status: 400, jsonBody: { error: '没有要判断的句子' } };
    const ctx = (Array.isArray(body.context) ? body.context : []).slice(-8).map((x) => String(x).slice(0, 200));

    const blocked = guard(request, 'ai-judge', sentences.length);
    if (blocked) return blocked;
    try {
      const out = await chatJSON(SYSTEM, JSON.stringify({ context: ctx, sentences }), { maxTokens: 60 * sentences.length + 200, temperature: 0.3, timeoutMs: 40000, log: (m) => context.log(m) });
      const byI = new Map();
      for (const r of Array.isArray(out.results) ? out.results : []) {
        const i = Number(r.i);
        if (!Number.isInteger(i) || i < 0 || i >= sentences.length) continue;
        const w = Math.max(0, Math.min(100, Math.round(Number(r.w))));
        if (!Number.isFinite(w)) continue;
        byI.set(i, { i, w, tag: TAGS.includes(r.tag) ? r.tag : (w >= 50 ? '空话' : '干货'), why: String(r.why || '').slice(0, 24) });
      }
      return { jsonBody: { results: [...byI.values()] } };
    } catch (err) {
      refund(request, 'ai-judge', sentences.length);
      return { status: err.status || 502, jsonBody: { error: err.message || 'AI 出错了' } };
    }
  },
});
