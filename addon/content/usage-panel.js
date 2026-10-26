/* SPDX-License-Identifier: MIT — compact local usage indicator and detail sheet. */
var PCUsagePanel = class {
  constructor({ api, document, getPaperKey }) {
    Object.assign(this, { api, document, getPaperKey }); this.page = 0;
    const dialog = document.getElementById('usage-dialog'); this.dialog = dialog;
    const on = (id, fn) => this.el(id).addEventListener('click', () => this.run(fn));
    on('usage-open', () => { this.page = 0; this.refresh(); this.rateModels(); this.loadRate(); dialog.showModal(); this.render(); });
    on('usage-close', () => dialog.close());
    for (const id of ['usage-period', 'usage-provider', 'usage-feature']) this.el(id).addEventListener('change', () => { this.page = 0; this.render(); });
    on('usage-prev', () => { this.page--; this.render(); }); on('usage-next', () => { this.page++; this.render(); });
    on('usage-balance-refresh', () => api.usage.queryBalance());
    for (const id of ['usage-plan-open', 'usage-plan-quick']) on(id, () => api.usage.openPlanUsage());
    this.el('usage-rate-provider').addEventListener('change', () => { this.rateModels(); this.loadRate(); });
    this.el('usage-rate-model').addEventListener('change', () => this.loadRate());
    on('usage-rate-save', async () => { const value = { currency: this.el('usage-rate-currency').value }; for (const k of ['input', 'cached', 'write', 'output']) { if (this.el('usage-rate-' + k).value === '') throw new Error('请完整填写四项单价。'); value[k] = Number(this.el('usage-rate-' + k).value); } await api.usage.setRate(this.el('usage-rate-provider').value, this.el('usage-rate-model').value.trim(), value); this.loadRate(); this.status('已保存，后续调用按此单价估算。'); });
    on('usage-rate-reset', async () => { await api.usage.setRate(this.el('usage-rate-provider').value, this.el('usage-rate-model').value.trim(), null); this.loadRate(); this.status('已恢复默认；未知模型不会自动套用其他模型价格。'); });
  }
  el(id) { return this.document.getElementById(id); }
  status(value) { this.el('usage-notice').textContent = value; }
  async run(fn) { try { await fn(); } catch (e) { this.status(e.message); } }
  filters() { return { period: this.el('usage-period').value, provider: this.el('usage-provider').value, feature: this.el('usage-feature').value, paperKey: this.el('usage-period').value === 'paper' ? this.getPaperKey() : '' }; }
  refresh() {
    const label = this.api.usage.compact(this.api.settings.chatProvider);
    const detail = this.api.usage.compactDetail(this.api.settings.chatProvider);
    this.el('usage-hint').textContent=label.replace(/\s*›$/,'');this.el('usage-open').title=detail;this.el('usage-open').classList.add('pc-icon-control');if(!this.el('usage-open').querySelector('.pc-glyph'))this.el('usage-open').append(PCUI.icon(this.document,'next'));
    this.el('usage-open').setAttribute('aria-label', detail);
    this.el('usage-plan-shortcut').hidden = this.api.settings.chatProvider !== 'chatgpt';
    if (this.dialog.open) this.render();
  }
  render() {
    const ledger = this.api.usage, filters = this.filters(), stats = ledger.summary(filters), unavailable = !!stats.unavailable, revision = this.renderRevision = (this.renderRevision || 0) + 1;
    this.el('usage-totals').replaceChildren();
    for (const [label, value] of unavailable ? [['统计', '未加载']] : stats.pending ? [['统计', '更新中…']] : [['调用', stats.calls + ' 次'], ['Token', ledger.tokens(stats.total) + (stats.unknown ? '＋未知' : '')], ['输入 / 输出', ledger.tokens(stats.input) + ' / ' + ledger.tokens(stats.output)], ['缓存命中', ledger.tokens(stats.cached)]]) {
      const card = this.document.createElement('div'), name = this.document.createElement('small'), number = this.document.createElement('strong'); name.textContent = label; number.textContent = value; card.append(name, number); this.el('usage-totals').append(card);
    }
    this.el('usage-costs').replaceChildren();
    for (const cost of unavailable || stats.pending ? [] : stats.costs) {
      const card = this.document.createElement('div'), name = this.document.createElement('small'), value = this.document.createElement('strong'); card.className = 'usage-cost-card';
      name.textContent = cost.equivalent ? 'ChatGPT · API 等效估算' : 'DeepSeek · API 估算'; value.textContent = ledger.moneySummary(cost).replace('$', 'US$'); card.title='精确估算：'+ledger.money(cost).replace('$','US$');card.append(name, value); this.el('usage-costs').append(card);
    }
    if (!stats.costs.length || stats.pending || unavailable) { const p = this.document.createElement('p'); p.textContent = unavailable ? '费用统计未加载，历史费用和调用数量未知。' : stats.pending ? '正在读取费用统计，尚未完成不代表没有消耗。' : stats.calls ? '费用未知：尚无可计价的调用。' : '此范围暂无模型调用。'; this.el('usage-costs').append(p); }
    const missing = this.document.createElement('p'); missing.className = 'fine-print'; missing.textContent = unavailable ? '原统计文件已保留；未能读取不代表零消耗。' : stats.pending ? '历史明细按页加载，当前统计正在更新。' : `${stats.unknown} 次未返回 Token · ${stats.unpriced} 次未计价。${this.api.settings.chatProvider === 'chatgpt-web' ? '当前网页模式的会话未计入以上 Token。' : ''}`; this.el('usage-costs').append(missing);
    if (ledger.error) this.status(ledger.error);
    const state = this.api.publicState(), account = state.accounts.find(a => a.clientID === state.activeAccount);
    this.el('usage-plan-account').textContent = account ? '插件授权账号：' + account.email + '。请核对官方页的账号和工作区。' : '在官方页登录要查询的账号；请核对账号和工作区。';
    const balance = ledger.data.balance; this.el('usage-balance-value').replaceChildren();
    if (balance) for (const row of balance.rows) { const p = this.document.createElement('p'); p.textContent = `${row.currency} ${row.total_balance} · 充值 ${row.topped_up_balance} · 赠金 ${row.granted_balance}`; this.el('usage-balance-value').append(p); }
    this.el('usage-balance-refresh').disabled = ledger.balanceLoading;
    this.el('usage-balance-refresh').textContent = ledger.balanceLoading ? '查询中…' : balance ? '刷新余额' : '查询余额';
    this.el('usage-balance-status').textContent = ledger.balanceError || (balance ? `上次查询：${new Date(balance.at).toLocaleString()}${balance.available ? '' : ' · 账户当前不可用'}` : '尚未查询。点击按钮才访问 DeepSeek，不消耗模型 Token。');
    this.loadRecords(ledger, filters, revision, !!stats.pending);
  }
  async loadRecords(ledger, filters, revision, refreshTotals = false) {
    const requested = this.page;
    this.el('usage-records').setAttribute('aria-busy', 'true'); this.el('usage-pages').textContent = '读取中…'; this.el('usage-prev').disabled = this.el('usage-next').disabled = true;
    let result;
    try { result = await ledger.recordPage(filters, requested, 30); }
    catch (error) {
      if (this.renderRevision === revision) { this.el('usage-records').replaceChildren(); this.status(error.message); this.el('usage-pages').textContent = '明细未加载'; this.el('usage-records').removeAttribute('aria-busy'); }
      return;
    }
    if (this.renderRevision !== revision) return;
    if (refreshTotals) { this.render(); return; }
    this.page = result.page; this.el('usage-records').replaceChildren();
    for (const record of result.records) {
      const row = this.document.createElement('details'), title = this.document.createElement('summary'), body = this.document.createElement('p'), u = record.usage;
      const feature = { chat: '问答', translation: '翻译', formula: '公式', summary: '聊天重点', review: '重点再整理', preread: '预读', vocabulary: '单词释义' }[record.feature] || record.feature;
      title.textContent = `${new Date(record.at).toLocaleString()} · ${feature} · ${record.cost?.equivalent ? '等效 ' : ''}${ledger.money(record.cost).replace('$', 'US$')}`;
      body.textContent = `${record.model} · ${record.status}\n输入 ${ledger.tokens(u.input)}，输出 ${ledger.tokens(u.output)}，缓存命中 ${ledger.tokens(u.cached)}，缓存写入 ${ledger.tokens(u.write)}，思考 ${ledger.tokens(u.reasoning)}（包含于输出）\n${record.cost?.equivalent ? 'API 等价估算' : 'API 估算'} ${ledger.money(record.cost)}${u.valid ? '' : ' · 接口用量不一致，费用未计算'}`;
      if (record.cost) body.textContent += '\n单价快照：' + ['input', 'cached', 'write', 'output'].map(k => k + ' ' + record.cost.rate[k].join('–')).join(' / ') + '（每百万 Token）';
      PCUI.summary(title);row.append(title, body); this.el('usage-records').append(row);
    }
    this.el('usage-records').removeAttribute('aria-busy');
    this.el('usage-pages').textContent = `${this.page + 1} / ${result.pages}`; this.el('usage-prev').disabled = this.page === 0; this.el('usage-next').disabled = this.page === result.pages - 1;
  }
  rateModels() {
    const provider = this.el('usage-rate-provider').value, list = new Set(['deepseek-flash', 'deepseek-v4-pro'].filter(() => provider === 'deepseek'));
    if (provider === 'chatgpt') { for (const m of this.api.models) list.add(m.id); for (const id of Object.keys(this.api.usage.constructor.catalog)) if (id.startsWith('chatgpt:')) list.add(id.slice(8)); }
    for (const model of this.api.usage.knownModels(provider)) list.add(model);
    this.el('usage-models').replaceChildren(); for (const model of list) { const o = this.document.createElement('option'); o.value = model; this.el('usage-models').append(o); }
    this.el('usage-rate-model').value = provider === 'deepseek' ? this.api.settings.chatDeepseekModel : this.api.settings.model || [...list][0] || '';
  }
  loadRate() {
    const provider = this.el('usage-rate-provider').value, rate = this.api.usage.rate(provider, this.el('usage-rate-model').value.trim());
    this.el('usage-rate-currency').value = rate?.currency || (provider === 'deepseek' ? 'CNY' : 'USD');
    for (const key of ['input', 'cached', 'write', 'output']) this.el('usage-rate-' + key).value = rate ? rate[key][0] : '';
    this.el('usage-rate-info').textContent = rate ? (rate.custom ? '当前为自定义固定单价。' : '当前为官方价格；如为区间，表单展示下限。保存后改为固定单价。') : '此模型没有内置价格，请按官方价格填写；未配置时只记 Token，不编造费用。';
  }
};
if (typeof module === 'object' && module.exports) module.exports = PCUsagePanel;
