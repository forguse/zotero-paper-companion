const test = require('node:test'), assert = require('node:assert/strict');
const Panel = require('../addon/content/usage-panel.js');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function panel() {
  const elements = new Map(), create = () => ({ textContent: '', children: [], attributes: new Map(), append(...values) { this.children.push(...values); }, replaceChildren(...values) { this.children = values; }, setAttribute(key, value) { this.attributes.set(key, value); }, removeAttribute(key) { this.attributes.delete(key); } });
  const value = Object.create(Panel.prototype); value.page = 0; value.renderRevision = 1;
  value.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, create()); return elements.get(id); }, createElement: create };
  return value;
}
test('a late historical page cannot replace the results or controls for a newer filter', async () => {
  const view = panel(), first = deferred(), second = deferred(), calls = [];
  const ledger = { recordPage(filters, page, size) { calls.push({ filters, page, size }); return calls.length === 1 ? first.promise : second.promise; } };
  const old = view.loadRecords(ledger, { provider: 'deepseek' }, 1); view.renderRevision = 2;
  const current = view.loadRecords(ledger, { provider: 'chatgpt' }, 2); second.resolve({ records: [], page: 2, pages: 4 }); await current;
  assert.equal(view.el('usage-pages').textContent, '3 / 4'); assert.equal(view.page, 2); assert(!view.el('usage-next').disabled);
  first.resolve({ records: [], page: 0, pages: 1 }); await old; assert.equal(view.el('usage-pages').textContent, '3 / 4'); assert.equal(view.page, 2);
  assert.deepEqual(calls.map(row => row.filters.provider), ['deepseek', 'chatgpt']); assert(calls.every(row => row.size === 30));
});
test('late query failures do not overwrite the new view and current failures remain explicit', async () => {
  const view = panel(), old = deferred(); const first = view.loadRecords({ recordPage: () => old.promise }, {}, 1);
  view.renderRevision = 2; await view.loadRecords({ recordPage: async () => ({ records: [], page: 0, pages: 1 }) }, {}, 2);
  old.reject(Error('old failure')); await first; assert.equal(view.el('usage-notice').textContent, '');
  view.renderRevision = 3; await view.loadRecords({ recordPage: async () => { throw Error('historical segment unavailable'); } }, {}, 3);
  assert.equal(view.el('usage-notice').textContent, 'historical segment unavailable'); assert.equal(view.el('usage-pages').textContent, '明细未加载'); assert(!view.el('usage-records').attributes.has('aria-busy'));
});
test('historical model choices use the metadata index rather than scanning only the recent record tail', () => {
  const view = panel(); view.el('usage-rate-provider').value = 'deepseek';
  view.api = { settings: { chatDeepseekModel: 'deepseek-flash' }, usage: { knownModels: () => ['historical-only'], get data() { throw Error('must not scan raw records'); } } };
  view.rateModels(); assert(view.el('usage-models').children.some(option => option.value === 'historical-only'));
});
test('after an asynchronous day change finishes, aggregate amounts are refreshed before displaying the final page', async () => {
  const view = panel(); let rendered = 0; view.render = () => { rendered++; };
  await view.loadRecords({ recordPage: async () => ({ records: [], page: 0, pages: 1 }) }, { period: 'today' }, 1, true);
  assert.equal(rendered, 1);
});
test('an unavailable ledger renders unknown totals rather than a false empty or zero-cost history', () => {
  const view = panel(); view.filters = () => ({}); view.loadRecords = () => {};
  view.api = { settings: { chatProvider: 'deepseek' }, publicState: () => ({ accounts: [] }), usage: { summary: () => ({ calls: null, total: null, unknown: null, unpriced: null, costs: [], unavailable: true }), data: { balance: null }, error: '统计文件损坏，原文件已保留' } };
  view.render(); const text = node => node.textContent + node.children.map(text).join('');
  assert.match(text(view.el('usage-totals')), /未加载/); assert.match(text(view.el('usage-costs')), /历史费用和调用数量未知/);
  assert(!/0 次|暂无模型调用|¥0|\$0/.test(text(view.el('usage-totals')) + text(view.el('usage-costs'))));
  assert.match(view.el('usage-notice').textContent, /原文件已保留/);
});
