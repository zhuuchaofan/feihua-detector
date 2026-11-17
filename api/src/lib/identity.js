// 认出“这是谁”：登录用户按账号，未登录按 IP。额度就是按这里给出的 key 计的。

// 客户端 IP。Static Web Apps 网关不会清掉浏览器自己填的请求头：X-Client-IP、X-Azure-ClientIP 都能伪造，
// X-Forwarded-For 里浏览器填的内容也会原样留在最前面。网关会在 X-Forwarded-For 末尾追加两项：
//   "<浏览器自己填的…>, <真实来源 IP:端口>, <Azure 内部一跳:端口>"
// 所以只认倒数第二项（2026-11 在预览环境实测过）。
function stripPort(ip) {
  if (/^\[.+\]:\d+$/.test(ip)) return ip.slice(1, ip.lastIndexOf(']')); // [IPv6]:端口
  return (ip.match(/:/g) || []).length === 1 ? ip.split(':')[0] : ip; // IPv4:端口
}

function clientIp(request) {
  const hops = (request.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!hops.length) return 'unknown';
  return stripPort(hops[Math.max(0, hops.length - 2)]);
}

// Static Web Apps 内置登录会把用户信息放在这个请求头里（base64 JSON），只有经过 SWA 网关的请求才会带上
function principal(request) {
  const h = request.headers.get('x-ms-client-principal');
  if (!h) return null;
  try {
    const p = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    if (!p || !p.userId) return null;
    return { id: p.userId, name: p.userDetails || '', provider: p.identityProvider || '' };
  } catch { return null; }
}

/** { user, key }：user 为登录用户（未登录为 null），key 是计额度用的身份 */
function who(request) {
  const user = principal(request);
  return { user, key: user ? `u:${user.provider}:${user.id}` : `ip:${clientIp(request)}` };
}

module.exports = { who, principal, clientIp };
