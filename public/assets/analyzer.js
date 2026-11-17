// 废话分析引擎：规则词库打分 + 叠加 AI 逐句判断。浏览器全局 Feihua，不依赖任何库。
(function () {
'use strict';
const words = (s, w, c) => s.trim().split(/\s+/).map(k => ({k: k.toLowerCase(), w: k, s: w, c}));
const RAW = [
  ...words(`赋能 抓手 闭环 颗粒度 拉通 对齐 底层逻辑 顶层设计 打法 链路 全链路 沉淀 心智 组合拳 触达 赛道 生态 矩阵 方法论 痛点 引爆 势能 倒逼 反哺 穿透 串联 卡位 护城河 飞轮 中台 私域 一盘棋 打通 维度 降维打击 体系化 结构化 价值链 范式 发力 聚焦 协同 联动 对标 拆解 复盘 共建 共创 赛马 心智占领 认知升级 深度融合 生态化 场景化 精细化 差异化 闭环思维 用户思维 第一性原理 长期主义 抓大放小 owner sync align push 拉齐 补位 兜底 背锅 揪头发 照镜子 闻味道 拧毛巾`, 2, '互联网黑话'),
  ...words(`我简单说两句 我简单说几句 简单说两句 我补充一点 我补充两句 我就说三点 我说三点 首先感谢 百忙之中 大家都知道 众所周知 我再强调一下 我重复一下 会后再对一下 下来再讨论 后面再看 我们后面再说 大家还有没有什么问题 有没有什么问题 今天就先这样 我就不多说了 长话短说 抛砖引玉 我先抛个砖 我先说两句 不展开了 大家辛苦了 这个事情很重要 意义重大`, 3, '客套开场'),
  ...words(`就是说 怎么说呢 我觉得吧 换句话说 说白了 某种程度上 总的来说 一定程度上 基本上 其实 那个 对吧 是吧 然后呢 嗯 呃 这块 这一块 这边的话 的话呢`, 1, '口水词'),
  ...words(`高度重视 积极推进 进一步加强 持续优化 全面提升 稳步推进 有序推进 抓紧推进 研究研究 原则上 视情况而定 酌情 统筹兼顾 务必 切实 狠抓 进一步 想办法 尽快 尽量 争取 尽可能 再看看 再研究 再讨论 形成合力 久久为功 提质增效 降本增效`, 2, '空头承诺'),
];

const CONCRETE = /\d|[零一二两三四五六七八九十百]+\s*(个|天|号|日|点|周|月|%|人|版|期)|周[一二三四五六日天]|星期|今天|明天|后天|下周|本周|月底|截止|负责|ddl|deadline|上线|接口|文档|版本|预算|报价|合同|bug|测试|@/i;
const LEVELS = [
  {max:15, name:'纯净水 · 干货会议', roasts:['这场会信息密度感人，建议录下来当新人培训教材。','几乎没有废话，参会者可以准时下班了。','说的都是人话，罕见，值得发朋友圈。']},
  {max:35, name:'淡茶 · 尚可入口', roasts:['有点客套，但主线还在，属于正常人类会议。','废话含量适中，像一杯泡了三次的茶。','干货是有的，就是得在寒暄里淘一淘。']},
  {max:55, name:'浓汤 · 需要过滤', roasts:['一半时间在说话，一半时间在说“说话”。','建议下次会前先写好议程，会议时长能减半。','汤很浓，但捞不到几块肉。']},
  {max:75, name:'黑话高汤 · 熬足八小时', roasts:['抓手已找到，闭环已形成，就是没人知道下一步干什么。','这场会把颗粒度对齐得很好，可惜对齐的是空气。','PPT 生成器听了都说专业。']},
  {max:101, name:'废话原浆 · 建议取消此会', roasts:['检测到高浓度废话，建议立即开窗通风，并把会议改成邮件。','这场会唯一的产出是下一场会。','如果废话能发电，这场会能点亮半个园区。']},
];
const SAMPLES = [
`王总：我简单说两句啊。首先感谢大家百忙之中抽出时间来参加这个会。这个项目呢，我们要高度重视，要从底层逻辑出发，找准抓手，形成闭环。
李经理：对，我补充一点。我觉得吧，我们需要和业务方拉通对齐一下，把颗粒度再细化一下，打出一套组合拳。
小陈：登录页改版下周三上线，我负责前端，目前还差两个接口，后端周一给到。
王总：嗯，这个我再强调一下，要形成闭环，要形成闭环。我们要沉淀方法论，赋能业务，提升用户心智。
李经理：原则上同意，具体的我们会后再对一下。
小陈：那接口文档谁来出？需要今天确定一个负责人。
王总：这个问题我们下来再讨论。大家还有没有什么问题？没有的话今天就先这样。`,
`主持人：今天三个议题，每个 10 分钟。
小林：第一，支付页报错率上周是 2.3%，主要是第三方超时，我周四前加重试，测试完周五上线。
阿杰：第二，618 活动预算批了 15 万，投放计划我明天下班前发群里。
小林：第三，客服反馈的退款慢，原因是人工审核，下周一我和财务对一下能不能 200 元以下自动退。
主持人：好，三件事负责人和时间都清楚了，散会。`,
`张总监：大家辛苦了。那个，我先抛个砖。我们今年的打法，说白了，就是要聚焦，要在赛道里卡位，构建护城河，形成飞轮。
赵经理：对，我觉得吧，其实本质上就是要有用户思维，要长期主义，要第一性原理。
张总监：对对对，就是说我们要拉通各个中台，打通全链路，深度融合，形成合力。
赵经理：然后呢，这块我们要持续优化，全面提升，进一步加强协同联动。
张总监：嗯，形成合力，形成合力。这个事情很重要，意义重大，大家务必高度重视。
赵经理：那具体的我们后面再看，再研究研究。
张总监：好，我就不多说了，大家还有没有什么问题？今天就先这样。`
];

// 示例会议的 AI 精读结果和终审（离线演示用，不调用接口）
const SAMPLE_DEMO = {
  judge: {
    '我简单说两句啊。': [92, '客套', '说两句的人从不只说两句'],
    '首先感谢大家百忙之中抽出时间来参加这个会。': [95, '客套', '开场三连谢，信息量为零'],
    '这个项目呢，我们要高度重视，要从底层逻辑出发，找准抓手，形成闭环。': [90, '黑话', '黑话全家桶，没一个实词'],
    '对，我补充一点。': [85, '口水', '补充了个寂寞'],
    '我觉得吧，我们需要和业务方拉通对齐一下，把颗粒度再细化一下，打出一套组合拳。': [88, '黑话', '拉通对齐了，具体对啥？'],
    '登录页改版下周三上线，我负责前端，目前还差两个接口，后端周一给到。': [5, '干货', '全场唯一的人话'],
    '嗯，这个我再强调一下，要形成闭环，要形成闭环。': [97, '复读', '闭环说三遍就闭上了？'],
    '我们要沉淀方法论，赋能业务，提升用户心智。': [90, '黑话', 'PPT 标题朗读'],
    '原则上同意，具体的我们会后再对一下。': [80, '空话', '原则上同意=没同意'],
    '那接口文档谁来出？': [12, '提问', '问到点子上了'],
    '需要今天确定一个负责人。': [15, '待办', '想推进，没人接'],
    '这个问题我们下来再讨论。': [93, '空话', '经典踢皮球'],
    '大家还有没有什么问题？': [70, '客套', '问了，但不想听'],
    '没有的话今天就先这样。': [65, '口水', '终于说了句真心话'],
  },
  review: {
    title: '闭环形成了，人没对齐',
    score: 79,
    verdict: '黑话高汤',
    takeaways: ['登录页改版下周三上线，小陈负责前端', '还差两个接口，后端周一给到'],
    todos: [{ who: '小陈', what: '登录页改版前端开发并上线', when: '下周三' }, { who: '后端（未指定）', what: '交付剩余两个接口', when: '周一' }, { who: '未指定', what: '出接口文档', when: '未定' }],
    worst_quote: '嗯，这个我再强调一下，要形成闭环，要形成闭环。',
    king: { name: '王总', reason: '闭环说了三遍，圈都画圆了' },
    mvp: { name: '小陈', reason: '一句话交代清楚时间人事' },
    roast: '这场会一共 14 句话，干货 3 句，全出自小陈一个人。王总开场“我简单说两句”，然后说了六句；“形成闭环”出现三次，翻译成人话就是“我也不知道下一步干啥，但听起来很专业”。李经理负责把颗粒度细化、把组合拳打出来，可惜拳头打在了空气上。全场最关键的问题“接口文档谁来出”被一句“下来再讨论”轻轻送走，这个闭环，确实闭得很严实，严实到连责任都出不来。',
    one_liner: '开了一场会，确认了三件事：闭环、闭环、和闭环。',
  },
};

const TAGS_GOOD = ['干货', '决策', '待办', '提问'];
const TAG_INFO = {
  干货: '有具体事实、数字或结论', 决策: '拍板定了事', 待办: '落到人和时间', 提问: '推动问题的好问题',
  客套: '寒暄感谢开场白', 黑话: '术语堆砌没实词', 空话: '说了等于没说', 复读: '重复前面的意思', 跑题: '和议题无关', 口水: '嗯啊对对对',
};

let LEX = [];
let IGNORE = new Set();
function buildLex(custom = [], ignore = []) {
  const seen = new Map();
  for (const x of RAW) { const p = seen.get(x.k); if (!p || p.s < x.s) seen.set(x.k, x); }
  for (const c of custom) {
    const k = String(c.w || '').trim().toLowerCase();
    if (k) seen.set(k, { k, w: c.w.trim(), s: Math.max(0.5, Math.min(5, Number(c.s) || 2)), c: '自定义' });
  }
  IGNORE = new Set(ignore.map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  for (const k of IGNORE) seen.delete(k);
  LEX = [...seen.values()].sort((a, b) => b.k.length - a.k.length);
}
buildLex();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s).replace(/[\s，,。.！!？?；;、：:“”"'‘’（）()…—\-~～]/g, '');
const bigrams = (s) => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const keyOf = (speaker, text) => (speaker || '') + '|' + norm(text);
const levelOf = (pct) => LEVELS.findIndex((l) => pct < l.max);

function parse(text) {
  const out = []; let speaker = null;
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*([^：:\s]{1,12})\s*[：:]\s*(.*)$/);
    let body = line, prefix = '';
    if (m && !/^[\d.]+$/.test(m[1])) { speaker = m[1]; prefix = line.slice(0, line.length - m[2].length); body = m[2]; }
    const parts = body.match(/[^。！？!?；;\n]+[。！？!?；;]*|[。！？!?；;]+/g) || [];
    out.push({ speaker, prefix, parts });
  }
  return out;
}

function scoreSentence(s, history) {
  const lower = s.toLowerCase();
  const taken = new Uint8Array(lower.length); const hits = [];
  for (const lx of LEX) {
    let i = lower.indexOf(lx.k);
    while (i >= 0) {
      let free = true; for (let j = i; j < i + lx.k.length; j++) if (taken[j]) { free = false; break; }
      if (free) { for (let j = i; j < i + lx.k.length; j++) taken[j] = 1; hits.push({ start: i, end: i + lx.k.length, lx }); }
      i = lower.indexOf(lx.k, i + 1);
    }
  }
  let score = hits.reduce((a, h) => a + h.lx.s, 0);
  let dup = false;
  const clauses = s.split(/[，,、。！？!?；;]/).map(norm).filter((c) => c.length >= 3);
  if (new Set(clauses).size < clauses.length) dup = true;
  const n = norm(s), bg = bigrams(n);
  if (n.length >= 5) for (const h of history) if (jaccard(bg, h) >= 0.6) { dup = true; break; }
  if (n.length >= 5) history.push(bg);
  if (dup) score += 3;
  const concrete = CONCRETE.test(s);
  if (concrete) score -= 2.5;
  if (!concrete && hits.length && n.length > 25) score += 1;
  score = Math.max(0, score);
  return { score, hits: hits.sort((a, b) => a.start - b.start), dup, len: n.length, intensity: Math.min(1, score / 5) };
}

/**
 * 分析一段会议文字。ai 是 Map(key -> {w, tag, why})，有 AI 判断的句子以 AI 为准。
 * tail 是还在说、没定稿的半句话，只参与实时分数，不进 AI。
 */
function analyze(text, ai, tail) {
  ai = ai || new Map();
  const full = tail ? text + tail : text;
  const lines = parse(full), history = [], sentences = [];
  const tailStart = text.length;
  let pos = 0;
  for (const ln of lines) {
    pos += ln.prefix.length;
    ln.idx = [];
    for (const p of ln.parts) {
      const r = scoreSentence(p, history);
      const key = keyOf(ln.speaker, p);
      const isTail = !!tail && pos + p.length > tailStart;
      const a = isTail ? null : ai.get(key) || null;
      const live = a ? Math.max(a.w / 100, r.dup ? r.intensity : 0) : r.intensity;
      ln.idx.push(sentences.length);
      sentences.push({ key, speaker: ln.speaker, text: p, ...r, ai: a, live, isTail });
      pos += p.length;
    }
    pos += 1; // 换行
  }
  let total = 0, wRule = 0, wLive = 0, wAi = 0, aiLen = 0, judged = 0, judgeable = 0, buzz = 0, dupCount = 0;
  const cat = {}, wc = {}, spk = {}, tags = {};
  for (const s of sentences) {
    total += s.len; wRule += s.len * s.intensity; wLive += s.len * s.live;
    if (s.dup) dupCount++;
    for (const h of s.hits) { buzz++; cat[h.lx.c] = (cat[h.lx.c] || 0) + 1; wc[h.lx.w] = (wc[h.lx.w] || 0) + 1; }
    if (!s.isTail && s.len > 0) judgeable++;
    if (s.ai) { judged++; aiLen += s.len; wAi += s.len * s.ai.w / 100; tags[s.ai.tag] = (tags[s.ai.tag] || 0) + 1; }
    if (s.speaker) {
      const o = spk[s.speaker] ||= { name: s.speaker, len: 0, rule: 0, live: 0, good: 0, n: 0 };
      o.len += s.len; o.rule += s.len * s.intensity; o.live += s.len * s.live; o.n++;
      if (s.ai && TAGS_GOOD.includes(s.ai.tag)) o.good++;
    }
  }
  const pct = (x, d) => (d ? Math.round((x / d) * 1000) / 10 : 0);
  const speakers = Object.values(spk).filter((o) => o.len > 0)
    .map((o) => ({ name: o.name, len: o.len, n: o.n, good: o.good, rulePct: pct(o.rule, o.len), livePct: pct(o.live, o.len) }))
    .sort((a, b) => b.livePct - a.livePct);
  return {
    text, total, sentences, lines,
    rulePct: pct(wRule, total), livePct: pct(wLive, total), aiPct: aiLen ? pct(wAi, aiLen) : null,
    coverage: { judged, total: judgeable }, buzz, cat, wc, tags, dupCount, speakers,
  };
}

function annotate(result, view) {
  let html = '';
  for (const ln of result.lines) {
    let h = esc(ln.prefix);
    for (const i of ln.idx) {
      const s = result.sentences[i];
      let inner = '', last = 0;
      for (const hit of s.hits) { inner += esc(s.text.slice(last, hit.start)) + '<mark title="' + esc(hit.lx.c) + '">' + esc(s.text.slice(hit.start, hit.end)) + '</mark>'; last = hit.end; }
      inner += esc(s.text.slice(last));
      if (s.isTail) { h += '<span class="live-tail">' + inner + '</span>'; continue; }
      let cls = '', why = '';
      if (view === 'ai' && s.ai) {
        cls = s.ai.w >= 70 ? 's-heavy' : s.ai.w >= 40 ? 's-light' : TAGS_GOOD.includes(s.ai.tag) ? 's-good' : '';
        if (s.ai.tag === '复读') cls = 's-dup';
        why = '<span class="why" title="' + esc(TAG_INFO[s.ai.tag] || '') + '"><b>' + esc(s.ai.tag) + '</b>' + esc(s.ai.why || '') + '</span>';
      } else {
        cls = s.dup ? 's-dup' : s.score >= 4 ? 's-heavy' : s.score >= 2 ? 's-light' : '';
      }
      h += (cls ? '<span class="' + cls + '">' + inner + '</span>' : inner) + why;
    }
    html += h + '\n';
  }
  return html.replace(/\n+$/, '');
}

function demoAi() {
  const m = new Map();
  for (const [t, [w, tag, why]] of Object.entries(SAMPLE_DEMO.judge)) m.set(t, { w, tag, why });
  return m;
}
/** 示例会议：把演示用的 AI 判断按句子文本对上 key */
function demoFor(text) {
  const r = analyze(text), d = demoAi(), m = new Map();
  for (const s of r.sentences) { const x = d.get(s.text.trim()); if (x) m.set(s.key, x); }
  return m;
}

window.Feihua = { LEVELS, SAMPLES, SAMPLE_DEMO, TAG_INFO, TAGS_GOOD, analyze, annotate, levelOf, keyOf, esc, buildLex, demoFor };
})();
