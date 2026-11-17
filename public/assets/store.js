// 本地存储：历史记录和设置都只存在这台设备的浏览器里，读写失败（隐私模式、存满）时安静降级
(function () {
  const KEY = 'feihua.history.v1';
  const SETTINGS = 'feihua.settings.v1';
  const MAX = 60;

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  const Store = {
    list() { return read(KEY, []).sort((a, b) => b.at - a.at); },
    get(id) { return this.list().find((r) => r.id === id) || null; },
    /** 新增或覆盖一条；存满时丢掉最旧的再试 */
    save(rec) {
      let all = read(KEY, []).filter((r) => r.id !== rec.id);
      all.unshift(rec);
      all = all.sort((a, b) => b.at - a.at).slice(0, MAX);
      while (!write(KEY, all) && all.length > 1) all.pop();
      return all.some((r) => r.id === rec.id);
    },
    remove(id) { write(KEY, read(KEY, []).filter((r) => r.id !== id)); },
    clear() { write(KEY, []); },
    newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    settings() { return Object.assign({ custom: '', ignore: '', autoJudge: true }, read(SETTINGS, {})); },
    saveSettings(s) { return write(SETTINGS, s); },
    /** 自定义词库文本 -> [{w, s}]，每行“词 权重”，权重可省略 */
    parseCustom(text) {
      return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = l.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
        return m ? { w: m[1], s: Number(m[2]) } : { w: l, s: 2 };
      });
    },
    parseIgnore(text) { return String(text || '').split(/[\n,，\s]+/).map((x) => x.trim()).filter(Boolean); },
  };

  // AI 判断以 [key, w, tag, why] 数组形式存，省空间
  Store.packAi = (map) => [...map.entries()].map(([k, v]) => [k, v.w, v.tag, v.why]);
  Store.unpackAi = (arr) => new Map((arr || []).map(([k, w, tag, why]) => [k, { w, tag, why }]));

  window.Store = Store;
})();
