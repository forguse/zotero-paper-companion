/* SPDX-License-Identifier: MIT — bounded usage detail storage, without model or UI access. */
(function (root) {
const PCUsageStore = class {
  constructor(io, { recentLimit = 500, segmentSize = 250, cacheLimit = 2, now = () => Date.now() } = {}) {
    this.io = io; this.recentLimit = Math.max(1, Math.floor(recentLimit)); this.segmentSize = Math.max(1, Math.floor(segmentSize)); this.cacheLimit = Math.max(0, Math.floor(cacheLimit));
    this.data = { version: 1, records: [], rates: {}, balance: null }; this.serial = Promise.resolve();
    this.segments = []; this.groups = new Map(); this.models = {}; this.cache = new Map(); this.loads = new Map(); this.queries = new Set(); this.now = now;
    this.todayGroups = new Map(); this.todayKey = this.day().key; this.archiveRevision = 0; this.sequence = 0;
    this.legacyPath = io.join(io.dir, 'usage.json'); this.indexPath = io.join(io.dir, 'usage-index.json'); this.path = this.legacyPath;
  }
  static rate(rate) {
    return rate && ['CNY', 'USD'].includes(rate.currency) && ['input', 'cached', 'write', 'output'].every(k => Array.isArray(rate[k]) && rate[k].length === 2 && rate[k].every(n => Number.isFinite(n) && n >= 0) && rate[k][0] <= rate[k][1]);
  }
  static record(record) {
    return record && record.id && record.usage && Number.isFinite(record.at) && typeof record.usage.valid === 'boolean'
      && ['input', 'output', 'total', 'cached', 'write', 'reasoning'].every(k => record.usage[k] === null || Number.isSafeInteger(record.usage[k]) && record.usage[k] >= 0)
      && (!record.cost || PCUsageStore.rate(record.cost.rate) && ['CNY', 'USD'].includes(record.cost.currency) && Number.isFinite(record.cost.low) && record.cost.low >= 0 && Number.isFinite(record.cost.high) && record.cost.high >= record.cost.low);
  }
  static document(value) {
    return value && Array.isArray(value.records) && value.rates && typeof value.rates === 'object' && !Array.isArray(value.rates) && Object.values(value.rates).every(PCUsageStore.rate) && value.records.every(PCUsageStore.record);
  }
  static empty() { return { calls: 0, input: 0, output: 0, total: 0, cached: 0, reasoning: 0, unknown: 0, unpriced: 0, costs: [] }; }
  static merge(target, source) {
    for (const key of ['calls', 'input', 'output', 'total', 'cached', 'reasoning', 'unknown', 'unpriced']) target[key] += source[key];
    for (const cost of source.costs) {
      let current = target.costs.find(c => c.provider === cost.provider && c.currency === cost.currency);
      if (!current) { current = { ...cost, low: 0, high: 0 }; target.costs.push(current); }
      current.low += cost.low; current.high += cost.high;
    }
    return target;
  }
  static summarize(records) {
    const result = PCUsageStore.empty();
    for (const record of records) {
      result.calls++;
      for (const key of ['input', 'output', 'total', 'cached', 'reasoning']) result[key] += record.usage[key] ?? 0;
      if (record.usage.total === null) result.unknown++;
      if (!record.cost) { result.unpriced++; continue; }
      let cost = result.costs.find(c => c.provider === record.provider && c.currency === record.cost.currency);
      if (!cost) { cost = { provider: record.provider, currency: record.cost.currency, equivalent: record.cost.equivalent, low: 0, high: 0 }; result.costs.push(cost); }
      cost.low += record.cost.low; cost.high += record.cost.high;
    }
    return result;
  }
  static addGroups(groups, records) {
    for (const record of records) {
      const dimensions = { provider: record.provider, feature: record.feature || 'other', paperKey: record.paperKey || '' }, key = JSON.stringify(Object.values(dimensions));
      if (!groups.has(key)) groups.set(key, { ...dimensions, summary: PCUsageStore.empty() });
      PCUsageStore.merge(groups.get(key).summary, PCUsageStore.summarize([record]));
    }
    return groups;
  }
  static cloneGroups(groups) { return new Map([...groups].map(([key, value]) => [key, JSON.parse(JSON.stringify(value))])); }
  static addSummaries(groups, summaries) {
    for (const group of summaries) {
      const key = JSON.stringify([group.provider, group.feature, group.paperKey]);
      if (!groups.has(key)) groups.set(key, { provider: group.provider, feature: group.feature, paperKey: group.paperKey, summary: PCUsageStore.empty() });
      PCUsageStore.merge(groups.get(key).summary, group.summary);
    }
    return groups;
  }
  day() { const now = new Date(this.now()), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(); return { start, end, key: start + ':' + end }; }
  matches(record, filters = {}) {
    const day = filters.period === 'today' ? filters.dayBounds || this.day() : null;
    return (!filters.provider || record.provider === filters.provider) && (!filters.feature || record.feature === filters.feature) && (!filters.paperKey || record.paperKey === filters.paperKey)
      && (!day || record.at >= day.start && record.at < day.end);
  }
  validateGroups(values, count) {
    const groups = new Map(); let grouped = 0;
    for (const group of values) {
      const summary = group?.summary, key = JSON.stringify([group?.provider, group?.feature, group?.paperKey]);
      if (!group || ['provider', 'feature', 'paperKey'].some(k => typeof group[k] !== 'string') || groups.has(key) || !summary || !Number.isSafeInteger(summary.calls) || ['calls', 'input', 'output', 'total', 'cached', 'reasoning', 'unknown', 'unpriced'].some(k => !Number.isFinite(summary[k]) || summary[k] < 0) || summary.unknown > summary.calls || summary.unpriced > summary.calls || !Array.isArray(summary.costs) || summary.costs.some(c => !['CNY', 'USD'].includes(c.currency) || c.provider !== group.provider || !Number.isFinite(c.low) || c.low < 0 || !Number.isFinite(c.high) || c.high < c.low) || new Set(summary.costs.map(c => c.provider + ':' + c.currency)).size !== summary.costs.length) throw new Error('历史统计摘要无效。');
      grouped += summary.calls; groups.set(key, group);
    }
    if (grouped !== count) throw new Error('历史统计计数不一致。');
    return groups;
  }
  validateIndex(index) {
    if (!PCUsageStore.document(index) || index.version !== 2 || !Array.isArray(index.segments) || !Array.isArray(index.groups) || !index.models || typeof index.models !== 'object') throw new Error('分段统计索引格式不受支持。');
    const names = new Set(), combined = new Map(); let count = 0;
    for (const row of index.segments) {
      if (!row || !/^usage-records-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.json$/.test(row.name) || names.has(row.name) || !Number.isSafeInteger(row.count) || row.count < 1 || !Number.isFinite(row.first) || !Number.isFinite(row.last) || row.first > row.last) throw new Error('分段统计路径或范围无效。');
      if (!Array.isArray(row.groups)) throw new Error('分段统计摘要无效。'); this.validateGroups(row.groups, row.count); PCUsageStore.addSummaries(combined, row.groups);
      names.add(row.name); count += row.count;
    }
    if (Object.values(index.models).some(models => !Array.isArray(models) || models.some(name => typeof name !== 'string' || name.length > 160))) throw new Error('历史模型索引无效。');
    const groups = this.validateGroups(index.groups, count), near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-12;
    const same = (a, b) => {
      if (['calls', 'input', 'output', 'total', 'cached', 'reasoning', 'unknown', 'unpriced'].some(key => a[key] !== b[key]) || a.costs.length !== b.costs.length) return false;
      return a.costs.every(cost => { const other = b.costs.find(row => row.provider === cost.provider && row.currency === cost.currency); return other && other.equivalent === cost.equivalent && near(cost.low, other.low) && near(cost.high, other.high); });
    };
    if (combined.size !== groups.size || [...combined].some(([key, group]) => !groups.has(key) || !same(group.summary, groups.get(key).summary))) throw new Error('历史统计总摘要与分段摘要不一致，原文件已保留。');
    return groups;
  }
  async init() {
    let migrate = false;
    try {
      const missing = {}, index = await this.io.read(this.indexPath, missing);
      if (index !== missing) {
        this.groups = this.validateIndex(index); this.segments = index.segments; this.models = index.models; this.path = this.indexPath;
        this.data = { version: 1, records: index.records, rates: index.rates, balance: index.balance || null };
        this.todayKey = ''; await this.refreshToday();
      } else {
        const value = await this.io.read(this.legacyPath, this.data);
        if (value.version !== 1 || !PCUsageStore.document(value)) throw new Error('统计文件格式不受支持。');
        this.data = value;
        migrate = this.data.records.length >= this.recentLimit + this.segmentSize;
      }
    } catch (error) { this.broken = true; this.error = '统计文件未加载，原文件已保留：' + error.message; return; }
    // A migration write failure is retryable. It must not turn a valid legacy
    // ledger into a permanently broken or empty ledger.
    if (migrate) await this.save().catch(() => {});
  }
  enqueue(operation) {
    if (this.broken || this.closing) return Promise.reject(new Error(this.error || '统计服务正在关闭。'));
    const next = this.serial.then(operation);
    this.serial = next.catch(error => { this.error = '用量尚未保存：' + error.message; });
    return next;
  }
  save() { return this.enqueue(() => this.flush()); }
  setRate(name, value) {
    return this.enqueue(async () => {
      const candidate = JSON.parse(JSON.stringify(this.data.rates));
      if (value === null) delete candidate[name]; else candidate[name] = value;
      await this.flush(candidate); this.data.rates = candidate;
    });
  }
  async flush(rateCandidate = this.data.rates) {
    if (this.broken) throw new Error(this.error);
    const records = this.data.records.slice(), rates = JSON.parse(JSON.stringify(rateCandidate)), balance = JSON.parse(JSON.stringify(this.data.balance || null));
    const archiveCount = Math.max(0, Math.floor((records.length - this.recentLimit) / this.segmentSize)) * this.segmentSize;
    if (this.path === this.legacyPath && !archiveCount) {
      await this.io.write(this.legacyPath, { version: 1, records, rates, balance }); this.error = ''; return;
    }
    const segments = [...this.segments], groups = PCUsageStore.cloneGroups(this.groups), models = JSON.parse(JSON.stringify(this.models));
    for (let offset = 0; offset < archiveCount; offset += this.segmentSize) {
      const batch = records.slice(offset, offset + this.segmentSize);
      let name; const missing = {};
      do { name = `usage-records-${Date.now().toString(36)}-${(++this.sequence).toString(36)}-${Math.random().toString(36).slice(2) || '0'}.json`; } while (await this.io.read(this.io.join(this.io.dir, name), missing) !== missing);
      await this.io.write(this.io.join(this.io.dir, name), { version: 1, records: batch });
      segments.push({ name, count: batch.length, first: Math.min(...batch.map(r => r.at)), last: Math.max(...batch.map(r => r.at)), groups: [...PCUsageStore.addGroups(new Map(), batch).values()] });
      PCUsageStore.addGroups(groups, batch);
      for (const record of batch) { const list = models[record.provider] ||= []; if (record.requestedModel && !list.includes(record.requestedModel)) list.push(record.requestedModel); }
    }
    await this.io.write(this.indexPath, { version: 2, records: records.slice(archiveCount), rates, balance, segments, groups: [...groups.values()], models });
    // Commit metadata and remove only the successfully archived prefix. Records
    // appended while I/O was pending remain in memory for their queued save.
    this.path = this.indexPath; this.segments = segments; this.groups = groups; this.models = models;
    if (archiveCount) {
      if (this.todayKey === this.day().key) PCUsageStore.addGroups(this.todayGroups, records.slice(0, archiveCount).filter(record => this.matches(record, { period: 'today' })));
      this.data.records.splice(0, archiveCount); this.archiveRevision++;
    }
    this.error = '';
  }
  async segment(row) {
    if (this.cache.has(row.name)) { const value = this.cache.get(row.name); this.cache.delete(row.name); this.cache.set(row.name, value); return value; }
    if (!this.loads.has(row.name)) {
      const pending = Promise.resolve().then(async () => {
        const value = await this.io.read(this.io.join(this.io.dir, row.name), null);
        if (!value || value.version !== 1 || !Array.isArray(value.records) || value.records.length !== row.count || !value.records.every(PCUsageStore.record)
          || Math.min(...value.records.map(r => r.at)) !== row.first || Math.max(...value.records.map(r => r.at)) !== row.last) throw new Error('历史用量分段缺失或损坏，原文件已保留。');
        if (this.cacheLimit) this.cache.set(row.name, value.records);
        while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
        return value.records;
      });
      this.loads.set(row.name, pending);
      const clear = () => { if (this.loads.get(row.name) === pending) this.loads.delete(row.name); };
      pending.then(clear, clear);
    }
    try { return await this.loads.get(row.name); }
    catch (error) { this.broken = true; this.error = '历史用量无法读取，统计文件已保留：' + error.message; throw new Error(this.error); }
  }
  async refreshToday() {
    if (this.todayKey === this.day().key) return;
    if (this.todayJob) return this.todayJob;
    if (this.closing) throw new Error('统计服务正在关闭。');
    const pending = (async () => {
      while (true) {
        const day = this.day(), revision = this.archiveRevision, groups = new Map();
        for (const row of [...this.segments]) if (row.first < day.end && row.last >= day.start) {
          if (row.groups && row.first >= day.start && row.last < day.end) PCUsageStore.addSummaries(groups, row.groups);
          else PCUsageStore.addGroups(groups, (await this.segment(row)).filter(record => record.at >= day.start && record.at < day.end));
        }
        if (revision !== this.archiveRevision || day.key !== this.day().key) continue;
        this.todayGroups = groups; this.todayKey = day.key; return;
      }
    })();
    this.todayJob = pending;
    const finish = () => { if (this.todayJob === pending) this.todayJob = null; this.io.changed?.(); };
    pending.then(finish, finish); return pending;
  }
  async ready(filters = {}) { if (filters.period === 'today') await this.refreshToday(); }
  // Compatibility read of the bounded recent tail. Full history uses page().
  records(filters = {}) { const selected = filters.period === 'today' ? { ...filters, dayBounds: filters.dayBounds || this.day() } : filters; return this.data.records.filter(record => this.matches(record, selected)); }
  summary(filters = {}) {
    if (this.broken) return { calls: null, input: null, output: null, total: null, cached: null, reasoning: null, unknown: null, unpriced: null, costs: [], unavailable: true, error: this.error };
    const result = PCUsageStore.summarize(this.records(filters));
    if (filters.period === 'today' && this.todayKey !== this.day().key) {
      this.refreshToday().catch(error => { this.error = error.message; }); result.pending = true; return result;
    }
    for (const group of (filters.period === 'today' ? this.todayGroups : this.groups).values()) if (this.matches(group, { ...filters, period: 'all' })) PCUsageStore.merge(result, group.summary);
    return result;
  }
  page(filters = {}, requested = 0, pageSize = 30) {
    if (this.closing) return Promise.reject(new Error('统计服务正在关闭。'));
    const pending = this.readPage(filters, requested, pageSize); this.queries.add(pending);
    const finish = () => this.queries.delete(pending); pending.then(finish, finish); return pending;
  }
  async readPage(filters = {}, requested = 0, pageSize = 30) {
    await this.ready(filters); if (this.broken) throw new Error(this.error);
    const day = this.day(), stats = this.summary(filters); if (stats.pending) return this.readPage(filters, requested, pageSize);
    const total = stats.calls, size = Math.max(1, Math.min(100, Math.floor(pageSize) || 30)), pages = Math.max(1, Math.ceil(total / size)), page = Math.max(0, Math.min(pages - 1, Math.floor(requested) || 0));
    const selected = filters.period === 'today' ? { ...filters, dayBounds: day } : filters;
    const segments = [...this.segments].reverse(), tail = [...this.data.records].reverse(), records = []; let skip = page * size;
    const collect = batch => { for (const record of batch) if (this.matches(record, selected)) { if (skip) skip--; else if (records.length < size) records.push(record); if (records.length === size) return true; } return false; };
    if (!collect(tail)) for (const row of segments) {
      if (filters.period === 'today' && (row.first >= day.end || row.last < day.start)) continue;
      const matched = row.groups ? row.groups.filter(group => this.matches(group, { ...selected, period: 'all' })).reduce((n, group) => n + group.summary.calls, 0) : null;
      if (matched === 0) continue;
      if (matched !== null && (filters.period !== 'today' || row.first >= day.start && row.last < day.end) && skip >= matched) { skip -= matched; continue; }
      if (collect([...(await this.segment(row))].reverse())) break;
    }
    if (filters.period === 'today' && day.key !== this.day().key) return this.readPage(filters, requested, pageSize);
    return { records, total, page, pages, pageSize: size };
  }
  knownModels(provider) { return [...new Set([...(this.models[provider] || []), ...this.data.records.filter(r => r.provider === provider).map(r => r.requestedModel)].filter(Boolean))]; }
  async destroy() { this.closing = true; await Promise.allSettled([this.serial, this.todayJob, ...this.queries, ...this.loads.values()].filter(Boolean)); await this.serial; this.cache.clear(); }
};
root.PCUsageStore = PCUsageStore;
if (typeof module === 'object' && module.exports) module.exports = PCUsageStore;
})(this);
