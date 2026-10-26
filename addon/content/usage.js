/* SPDX-License-Identifier: MIT — local usage ledger; never stores prompts or credentials. */
var PCUsageStoreClass = typeof module === 'object' && module.exports && typeof require === 'function' ? require('./usage-store.js') : PCUsageStore;
var PCUsage = class {
  static checked = '2026-10-26';
  static sources = { deepseek: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', chatgpt: 'https://developers.openai.com/api/docs/pricing' };
  static catalog = {
    'deepseek:deepseek-flash': { currency: 'CNY', input: [1, 2], cached: [.02, .04], write: [1, 2], output: [4, 8] },
    'deepseek:deepseek-v4-pro': { currency: 'CNY', input: [4.5, 9], cached: [.15, .30], write: [4.5, 9], output: [13.5, 27] },
    'chatgpt:gpt-6.1-sol': { currency: 'USD', input: [2, 2], cached: [.1, .1], write: [2.5, 2.5], output: [10, 10], threshold: 272000, ultrafast: 6 },
    'chatgpt:gpt-6-astra': { currency: 'USD', input: [10, 10], cached: [1, 1], write: [12.5, 12.5], output: [50, 50], threshold: 272000 },
    'chatgpt:gpt-6-luna': { currency: 'USD', input: [.1, .1], cached: [.01, .01], write: [.125, .125], output: [.5, .5], threshold: 272000 }
  };
  static count(n) { return Number.isSafeInteger(n) && n >= 0 ? n : null; }
  static normalize(raw, provider) {
    const n = PCUsage.count, r = raw || {}, input = n(r.input_tokens ?? r.prompt_tokens), output = n(r.output_tokens ?? r.completion_tokens);
    let cached = n(r.input_tokens_details?.cached_tokens ?? r.prompt_cache_hit_tokens ?? r.prompt_tokens_details?.cached_tokens);
    const missed = n(r.prompt_cache_miss_tokens);
    if (cached === null && input !== null && missed !== null) cached = n(input - missed);
    const write = provider === 'deepseek' ? 0 : n(r.input_tokens_details?.cache_write_tokens);
    const reasoning = n(r.output_tokens_details?.reasoning_tokens ?? r.completion_tokens_details?.reasoning_tokens);
    const total = n(r.total_tokens) ?? (input !== null && output !== null ? input + output : null);
    const valid = !(input !== null && ((cached !== null && (cached < 0 || cached > input)) || (write !== null && write > input) || (cached !== null && write !== null && cached + write > input)))
      && !(input !== null && missed !== null && (missed > input || (cached !== null && cached + missed !== input)))
      && !(output !== null && reasoning !== null && reasoning > output) && !(input !== null && output !== null && total !== input + output);
    return { input, output, total, cached, write, reasoning, valid };
  }
  static validateRate(value) {
    if (!value || !['CNY', 'USD'].includes(value.currency)) throw new Error('单价币种必须为 CNY 或 USD。');
    for (const name of ['input', 'cached', 'write', 'output']) if (!Number.isFinite(value[name]) || value[name] < 0 || value[name] > 1000000) throw new Error('请填写有效的非负单价（每百万 Token）。');
    return { currency: value.currency, ...Object.fromEntries(['input', 'cached', 'write', 'output'].map(k => [k, [value[k], value[k]]])), custom: true, checked: new Date().toISOString().slice(0, 10) };
  }
  static quote(provider, usage, rate, tier = 'default') {
    if (!rate || !usage.valid || usage.input === null || usage.output === null) return null;
    const factors = { default: 1, auto: 1, standard: 1, priority: 2, fast: 2, flex: .5, batch: .5, ultrafast: 6 };
    if (!(tier in factors)) return null;
    if (tier === 'ultrafast' && !rate.custom && !rate.ultrafast) return null;
    const multiplier = provider === 'chatgpt' && !rate.custom ? tier === 'ultrafast' ? rate.ultrafast : factors[tier] : 1;
    const long = rate.threshold && usage.input > rate.threshold;
    const bounds = [0, 1].map(i => {
      const p = Object.fromEntries(['input', 'cached', 'write', 'output'].map(k => [k, rate[k][i] * multiplier * (long ? k === 'output' ? 1.5 : 2 : 1)]));
      const cached = usage.cached ?? 0, write = usage.write ?? 0, remaining = usage.input - cached - write;
      const choices = [p.input]; if (usage.cached === null) choices.push(p.cached); if (usage.write === null) choices.push(p.write);
      return (cached * p.cached + write * p.write + remaining * (i ? Math.max(...choices) : Math.min(...choices)) + usage.output * p.output) / 1000000;
    });
    return { currency: rate.currency, low: bounds[0], high: bounds[1], equivalent: provider === 'chatgpt', rate: JSON.parse(JSON.stringify(rate)), tier, long: !!long };
  }
  constructor(api, options) {
    this.api = api; this.balanceRevision = 0;
    this.store = new PCUsageStoreClass({ dir: api.dir, join: (...parts) => PathUtils.join(...parts), read: (path, fallback) => api.readJSON(path, fallback), write: (path, value) => api.writeJSON(path, value), changed: () => api.emit('usage') }, options);
  }
  get data() { return this.store.data; }
  get serial() { return this.store.serial; }
  get path() { return this.store.path; }
  get broken() { return this.store.broken; }
  set broken(value) { this.store.broken = value; }
  get error() { return this.store.error; }
  set error(value) { this.store.error = value; }
  init() { return this.store.init(); }
  save() { return this.store.save(); }
  rate(provider, model) { return this.data.rates[provider + ':' + model] || (PCUsage.catalog[provider + ':' + model] ? { ...PCUsage.catalog[provider + ':' + model], checked: PCUsage.checked } : null); }
  async setRate(provider, model, value) {
    if (!['chatgpt', 'deepseek'].includes(provider) || !model || model.length > 160) throw new Error('请选择引擎并填写准确的模型名。');
    const name = provider + ':' + model;
    await this.store.setRate(name, value === null ? null : PCUsage.validateRate(value)); this.api.emit('usage');
  }
  begin(meta) {
    const meter = { id: Date.now() + '-' + Math.random().toString(36).slice(2), at: Date.now(), raw: null, complete: false, model: meta.model, tier: 'default' };
    const rate = this.rate(meta.provider, meta.model); const snapshot = rate ? JSON.parse(JSON.stringify(rate)) : null;
    meter.observe = data => {
      const response = data.response || data;
      if (response.usage) meter.raw = response.usage;
      if (typeof response.model === 'string') meter.model = response.model;
      if (typeof response.id === 'string') meter.responseID = response.id;
      if (typeof response.service_tier === 'string') meter.tier = response.service_tier;
      if (data.type === 'response.completed' || response.status === 'completed' || response.choices?.[0]?.finish_reason === 'stop') meter.complete = true;
    };
    meter.parser = new PCore.SSEParser(event => { if (event.data !== '[DONE]') meter.observe(JSON.parse(event.data)); });
    meter.finish = async status => {
      if (meter.saved) return; meter.saved = true;
      const usage = PCUsage.normalize(meter.raw, meta.provider);
      const record = { id: meter.id, at: meter.at, provider: meta.provider, requestedModel: meta.model, model: String(meter.model).slice(0, 160), feature: meta.feature || 'other', paperKey: meta.paperKey || '',
        status: status === 'complete' && !meter.complete ? 'incomplete' : status, usage, cost: PCUsage.quote(meta.provider, usage, snapshot, meter.tier), responseID: meter.responseID };
      this.data.records.push(record); this.api.emit('usage');
      try { await this.save(); } catch (_) { this.api.emit('usage'); }
    };
    return meter;
  }
  async run(meta, options, request) {
    const meter = this.begin(meta); let status = 'failed';
    try {
      const result = await request({ ...options, onChunk: options.onChunk ? chunk => { try { meter.parser.push(chunk); } catch (_) {} options.onChunk(chunk); } : undefined });
      if (options.onChunk) { try { meter.parser.push('', true); } catch (_) {} } else if (result) meter.observe(result);
      status = 'complete'; return result;
    } catch (e) { status = options.signal?.aborted ? 'cancelled' : 'failed'; throw e; }
    finally { await meter.finish(status); }
  }
  records(filters = {}) { return this.store.records(filters); }
  summary(filters = {}) { return this.store.summary(filters); }
  recordPage(filters = {}, page = 0, size = 30) { return this.store.page(filters, page, size); }
  ready(filters = {}) { return this.store.ready(filters); }
  knownModels(provider) { return this.store.knownModels(provider); }
  tokens(value) { return value === null ? '未返回' : Number(value).toLocaleString('zh-CN'); }
  money(cost) {
    if (!cost) return '未计价';
    const number = n => n > 0 && n < .000001 ? '<0.000001' : n.toFixed(6).replace(/\.?0+$/, '') || '0';
    return (cost.currency === 'CNY' ? '¥' : '$') + number(cost.low) + (Math.abs(cost.high - cost.low) > 1e-12 ? '–' + number(cost.high) : '');
  }
  moneySummary(cost) {
    if(!cost)return '未计价';
    const symbol=cost.currency==='CNY'?'¥':'$';
    if(cost.high>0&&cost.high<.01)return symbol+'<0.01';
    const low=cost.low>0&&cost.low<.01?'<0.01':(Math.floor((cost.low+1e-10)*100)/100).toFixed(2);
    const high=(Math.ceil((cost.high-1e-10)*100)/100).toFixed(2);
    return symbol+low+(low!==high?'–'+high:'');
  }
  compact(provider) {
    if (provider === 'chatgpt-web') return '网页费用暂不可读取 ›';
    if (!['deepseek', 'chatgpt'].includes(provider)) return '费用与额度 ›';
    if (this.broken) return '费用记录未加载 ›';
    const s = this.summary({ period: 'today', provider });
    if (s.pending) return '费用统计更新中 ›';
    const money = cost => this.moneySummary(cost).replace('$', 'US$');
    const label = provider === 'chatgpt' ? '等效 ' : '';
    if (!s.calls) return label + (provider === 'chatgpt' ? 'US$0' : '¥0') + ' · 今日 ›';
    if (!s.costs.length) return label + '费用未知 ›';
    return label + s.costs.map(money).join(' / ') + (s.unpriced ? '＋待计价' : provider === 'deepseek' ? ' 估' : '') + ' ›';
  }
  compactDetail(provider) {
    if (provider === 'chatgpt-web') return '网页模式无法读取官方费用和 Token；未提供不等于免费。点击查看明细与套餐用量入口。';
    if (!['deepseek', 'chatgpt'].includes(provider)) return '查看本机费用估算、Token 明细、DeepSeek 余额与 ChatGPT 套餐用量入口。';
    if (this.broken) return this.error;
    const s = this.summary({ period: 'today', provider });
    if (s.pending) return '正在读取今日费用统计，尚未完成不代表没有消耗。';
    return '今日本机插件' + (provider === 'chatgpt' ? ' API 等效费用（非套餐扣款）' : ' API 费用估算') + '：' + (s.costs.length?s.costs.map(c=>this.money(c).replace('$','US$')).join(' / '):s.calls?'费用未知':'0')
      + '；' + s.calls + ' 次调用，' + this.tokens(s.total) + ' Token；' + s.unknown + ' 次用量未知，' + s.unpriced + ' 次未计价。点击展开完整明细。' + (this.error ? ' ' + this.error : '');
  }
  openPlanUsage() { return this.api.openURL('https://chatgpt.com/settings/usage'); }
  async invalidateBalance() { this.balanceRevision++; this.balanceController?.abort(); this.data.balance = null; await this.save().catch(() => {}); this.api.emit('usage'); }
  async queryBalance() {
    if (this.balanceJob) return this.balanceJob;
    const revision = this.balanceRevision, controller = new AbortController(); this.balanceController = controller;
    this.balanceJob = (async () => {
      this.balanceLoading = true; this.balanceError = ''; this.api.emit('usage');
      try {
        const key = (await this.api.readSecrets()).deepseek;
        if (!key) throw new Error('请先在设置中保存 DeepSeek API Key。');
        const data = await this.api.request('https://api.deepseek.com/user/balance', { method: 'GET', provider: 'DeepSeek', headers: { Authorization: 'Bearer ' + key }, signal: controller.signal });
        if (revision !== this.balanceRevision || (await this.api.readSecrets()).deepseek !== key) throw new Error('密钥已变更，请重新查询余额。');
        if (typeof data?.is_available !== 'boolean' || !Array.isArray(data.balance_infos) || !data.balance_infos.length) throw new Error('余额接口未返回有效数据。');
        const rows = data.balance_infos.map(r => {
          if (!['CNY', 'USD'].includes(r.currency) || ['total_balance', 'granted_balance', 'topped_up_balance'].some(k => !/^-?\d+(?:\.\d+)?$/.test(r[k]) || !Number.isFinite(Number(r[k])))) throw new Error('余额数据格式无效。');
          return Object.fromEntries(['currency', 'total_balance', 'granted_balance', 'topped_up_balance'].map(k => [k, r[k]]));
        });
        this.data.balance = { at: Date.now(), available: data.is_available, rows }; await this.save(); return this.data.balance;
      } catch (e) { this.balanceError = PCore.safeError(e.message); throw e; }
      finally { this.balanceLoading = false; this.balanceJob = null; this.api.emit('usage'); }
    })();
    return this.balanceJob;
  }
  async destroy() {
    this.balanceController?.abort();
    await Promise.allSettled([this.balanceJob].filter(Boolean));
    await this.store.destroy();
  }
};
if (typeof module === 'object' && module.exports) module.exports = PCUsage;
