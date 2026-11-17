// 每日计数器：额度用量存在哪里。
//   配了 QUOTA_STORAGE（Azure 存储账户的连接字符串）就存在 Azure 表存储里：
//     函数重启不清零，多台实例共用一份；PartitionKey 是日期，RowKey 是计数项。
//   没配就存在内存里（每台实例各算各的，重启清零），本地开发和存储出故障时也用它兜底。
// 对外只有三个方法，都是 async：
//   get(day, key)                    -> 当前用量
//   add(day, key, amount, limit)     -> 加上后不超过 limit 才加，返回 true；否则不动，返回 false
//   sub(day, key, amount)            -> 退回用量，最少减到 0

const TABLE = 'quota';
const MAX_TRIES = 10; // 并发写冲突时的重试次数，每次随机等一小会儿再试

function memoryCounter() {
  let day = '', counts = new Map();
  const roll = (d) => { if (d !== day) { day = d; counts = new Map(); } };
  return {
    async get(d, key) { roll(d); return counts.get(key) || 0; },
    async add(d, key, amount, limit) {
      roll(d);
      const used = counts.get(key) || 0;
      if (used + amount > limit) return false;
      counts.set(key, used + amount);
      return true;
    },
    async sub(d, key, amount) { roll(d); counts.set(key, Math.max(0, (counts.get(key) || 0) - amount)); },
  };
}

function tableCounter(connectionString) {
  const { TableClient } = require('@azure/data-tables');
  const client = TableClient.fromConnectionString(connectionString, TABLE);
  let ready = null;
  const ensureTable = () => (ready ||= client.createTable().catch((err) => { ready = null; throw err; }));
  const rowKey = (key) => encodeURIComponent(key); // RowKey 里不能有 / \ # ?

  async function read(day, key) {
    try { return await client.getEntity(day, rowKey(key)); } catch (err) { if (err.statusCode === 404) return null; throw err; }
  }

  // 读出当前值 -> 算新值 -> 带 ETag 写回；被别人抢先改了（412/409）就重读再来，保证不会多算少算
  async function update(day, key, next) {
    await ensureTable();
    for (let i = 0; i < MAX_TRIES; i++) {
      const e = await read(day, key);
      const n = next(e ? Number(e.n) || 0 : 0);
      if (n === null) return false;
      try {
        if (e) await client.updateEntity({ partitionKey: day, rowKey: rowKey(key), n }, 'Replace', { etag: e.etag });
        else await client.createEntity({ partitionKey: day, rowKey: rowKey(key), n });
        return true;
      } catch (err) {
        if (err.statusCode !== 412 && err.statusCode !== 409) throw err;
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * (i + 1)));
      }
    }
    throw new Error('额度计数写入冲突太多');
  }

  return {
    async get(day, key) { await ensureTable(); const e = await read(day, key); return e ? Number(e.n) || 0 : 0; },
    add: (day, key, amount, limit) => update(day, key, (used) => (used + amount > limit ? null : used + amount)),
    sub: (day, key, amount) => update(day, key, (used) => Math.max(0, used - amount)),
  };
}

// 表存储出错时不让网站跟着挂：这一次改用内存计数，并记一条日志
function withFallback(primary, fallback) {
  const wrap = (name) => async (...args) => {
    try { return await primary[name](...args); } catch (err) {
      console.warn(`[quota] 表存储 ${name} 失败，临时改用内存计数：${err.message}`);
      return fallback[name](...args);
    }
  };
  return { get: wrap('get'), add: wrap('add'), sub: wrap('sub') };
}

const memory = memoryCounter();
const conn = process.env.QUOTA_STORAGE;
module.exports = conn ? withFallback(tableCounter(conn), memory) : memory;
