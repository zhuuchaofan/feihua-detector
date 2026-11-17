// POST /api/ai-review —— AI 终审：读完整场会，给出会议体检（推进/解决/清楚/进度）、标题、结论、待办、废话之王和毒舌点评
// 请求：{ text, rulePct, aiPct, tags: { 干货: 3, 客套: 5 ... }, worst: [{ s, t, why }] }
const { app } = require('@azure/functions');
const { chatJSON } = require('../lib/llm');
const { guard, refund } = require('../lib/guard');

const MAX_CHARS = 20000;
const CHECKUP_KEYS = ['推进', '解决', '清楚', '进度'];

// 会议体检只留四项、分数夹到 1-5 的整数、理由截短；模型漏了某项就去掉，前端按缺项处理
function cleanCheckup(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const k of CHECKUP_KEYS) {
    const v = c[k];
    const n = Math.round(Number(v && typeof v === 'object' ? v.score : v));
    if (!Number.isFinite(n)) continue;
    out[k] = { score: Math.min(5, Math.max(1, n)), why: String((v && v.why) || '').trim().slice(0, 40) };
  }
  return Object.keys(out).length ? out : null;
}

const SYSTEM = `你是“会议废话浓度检测器”的首席化验师，也是一个毒舌脱口秀演员。你刚听完一场会，要出一份化验结论。
你会收到会议转写（“发言人：内容”格式，发言人可能是机器自动分的“发言人1、发言人2”，偶尔归错人；转写可能有错别字），以及前面逐句精读的统计。
你不只看黑话，更要看这场会有没有用。先做“会议体检”，四项各打 1-5 分（5 很好，4 不错，3 一般，2 较差，1 很差）：
- 推进：会议有没有让工作往下走——定了结论、做了决定、下一步明确。光“对齐”“统一认识”不算推进。
- 解决：会上冒出来的问题有没有解决，或者至少当场定了谁、什么时候解决。“下来再讨论”“会后再对”不算解决。
- 清楚：发言清不清楚、直不直接，有没有说到具体的事、数字、人和时间。绕圈子、堆术语、车轱辘话扣分。
- 进度：从会上听到的工作进展正不正常——有没有延期、卡住、没人负责、互相推的事。会上完全没提进度就给 3 分，并在理由里说“没提进度”。
每项的理由 25 字以内，尽量引用原话或点名具体的事。
整体废话浓度（score）既看话里有多少水，也看这场会有没有推进工作、解决问题：客客气气但啥也没推进的会，同样很水。
点评（roast）的要求：
- 脱口秀吐槽风，至少逐字引用 3 处原话并当场拆穿，其中至少一处用“翻译成人话就是：……”的句式。
- 点出谁在注水、谁在干活；可以用夸张比喻和算账（比如“这句话 30 个字，信息量为零”）。
- 说到这场会到底推进了没有、问题解决了没有。
- 结尾给一句扎心但实用的建议。
- 狠狠嘲讽说法、开会方式和黑话，但不攻击人格、外貌、性别、年龄、地域等身份特征，不说脏话。
- 如果这场会确实很高效，就反向吐槽“这么高效的会，让其他会议怎么活”。
只输出 JSON，字段如下：
{
  "checkup": {
    "推进": {"score": 1-5 的整数, "why": "理由"},
    "解决": {"score": 1-5 的整数, "why": "理由"},
    "清楚": {"score": 1-5 的整数, "why": "理由"},
    "进度": {"score": 1-5 的整数, "why": "理由"}
  },
  "title": "给这场会起个带讽刺的标题，16 字以内",
  "score": 0-100 的整数，你判定的整体废话浓度,
  "verdict": "10 字以内的评级",
  "takeaways": ["真正有用的结论，最多 5 条，没有就给空数组"],
  "todos": [{"who": "负责人，不明确写“未指定”", "what": "要做的事", "when": "时间，不明确写“未定”"}],
  "worst_quote": "全场最空洞的一句原话",
  "king": {"name": "废话之王的发言人名", "reason": "20 字以内的颁奖词"},
  "mvp": {"name": "干货担当的发言人名", "reason": "20 字以内的颁奖词"},
  "roast": "200 到 300 字的毒舌点评",
  "one_liner": "一句适合发朋友圈的吐槽，30 字以内"
}
只有一个发言人或分不出人时，king 和 mvp 填 null。`;

app.http('ai-review', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai-review',
  handler: async (request, context) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: '请求格式不对' } }; }
    const text = String(body.text || '').trim();
    if (text.length < 20) return { status: 400, jsonBody: { error: '内容太短，多录几句再来' } };
    const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) + '%' : '未知');
    const tags = body.tags && typeof body.tags === 'object'
      ? Object.entries(body.tags).slice(0, 12).map(([k, v]) => `${String(k).slice(0, 4)} ${Number(v) || 0} 句`).join('，') : '';
    const worst = (Array.isArray(body.worst) ? body.worst : []).slice(0, 5)
      .map((x) => `- ${String(x.s || '').slice(0, 12)}：“${String(x.t || '').slice(0, 120)}”（${String(x.why || '').slice(0, 24)}）`).join('\n');

    const blocked = await guard(request, 'ai-review');
    if (blocked) return blocked;
    const user = [
      `规则词库算的废话浓度：${num(body.rulePct)}`,
      `AI 逐句精读算的废话浓度：${num(body.aiPct)}`,
      tags ? `逐句标签统计：${tags}` : '',
      worst ? `逐句精读里最水的几句：\n${worst}` : '',
      text.length > MAX_CHARS ? `（内容过长，只给你前 ${MAX_CHARS} 字）` : '',
      `会议内容：\n${text.slice(0, MAX_CHARS)}`,
    ].filter(Boolean).join('\n');
    try {
      const review = await chatJSON(SYSTEM, user, { maxTokens: 1800, temperature: 1.0, timeoutMs: 40000, log: (m) => context.log(m) });
      review.checkup = cleanCheckup(review.checkup);
      return { jsonBody: review };
    } catch (err) {
      await refund(request, 'ai-review');
      return { status: err.status || 502, jsonBody: { error: err.message || 'AI 出错了' } };
    }
  },
});
