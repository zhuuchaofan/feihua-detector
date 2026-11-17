// 认出“这是谁”：登录用户按账号，未登录按 IP。额度就是按这里给出的 key 计的。

// 客户端 IP。浏览器自己也能在请求里塞一个 X-Forwarded-For，所以优先用 Azure 网关自己写的头；
// 都没有时才退回 X-Forwarded-For 的第一项。
const IP_HEADERS = ['x-azure-socketip', 'x-azure-clientip', 'x-client-ip', 'x-forwarded-for'];

function stripPort(ip) {
  if (/^\[.+\]:\d+$/.test(ip)) return ip.slice(1, ip.lastIndexOf(']')); // [IPv6]:端口
  return (ip.match(/:/g) || []).length === 1 ? ip.split(':')[0] : ip; // IPv4:端口
}

function clientIp(request) {
  for (const name of IP_HEADERS) {
    const first = (request.headers.get(name) || '').split(',')[0].trim();
    if (first) return stripPort(first);
  }
  return 'unknown';
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
