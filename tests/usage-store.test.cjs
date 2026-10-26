const test = require('node:test'), assert = require('node:assert/strict');
const Store = require('../addon/content/usage-store.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);
function record(number, changes = {}) {
  return { id: 'call-' + number, at: Date.now() + number, provider: number % 2 ? 'deepseek' : 'chatgpt', requestedModel: 'model-' + number, model: 'actual-model', feature: number % 3 ? 'chat' : 'translation', paperKey: number % 2 ? 'A' : 'B', status: 'complete',
    usage: { input: number, output: 2, total: number + 2, cached: 0, write: 0, reasoning: 1, valid: true },
    cost: { currency: number % 2 ? 'CNY' : 'USD', low: number, high: number * 2, equivalent: number % 2 === 0, rate: { currency: number % 2 ? 'CNY' : 'USD', input: [1, 1], output: [2, 2], cached: [0, 0], write: [0, 0] } }, ...changes };
}
function setup(options = {}) {
  const files = new Map(), writes = [], reads = [], state = { beforeWrite: async () => {}, beforeRead: async () => {}, changes: 0 };
  const io = { dir: '/profile', join: (...parts) => parts.join('/'), changed: () => { state.changes++; },
    async read(path, fallback) { reads.push(path); await state.beforeRead(path); return files.has(path) ? JSON.parse(files.get(path)) : fallback; },
    async write(path, value) { const text = JSON.stringify(value); writes.push({ path, bytes: text.length }); await state.beforeWrite(path, text); files.set(path, text); } };
  const create = () => new Store(io, { recentLimit: 2, segmentSize: 2, cacheLimit: 2, ...options });
  return { store: create(), create, io, files, writes, reads, state };
}
function canonical(summary) { return { ...summary, costs: [...summary.costs].sort((a, b) => (a.provider + a.currency).localeCompare(b.provider + b.currency)) }; }
async function append(store, value) { store.data.records.push(value); await store.save(); }

test('small legacy ledgers keep their compatible shape, without model access or extra segment files', async () => {
  const s = setup(); await s.store.init(); await append(s.store, record(1));
  assert.equal(s.store.path, '/profile/usage.json'); assert.equal(JSON.parse(s.files.get(s.store.path)).version, 1);
  assert.equal(s.store.data.records.length, 1); assert.equal(s.store.summary().calls, 1); assert.equal(s.store.segments.length, 0);
});
test('legacy migration preserves the original file, every detail and all immutable original rate snapshots', async () => {
  const s = setup(), records = Array.from({ length: 11 }, (_, i) => record(i + 1));
  const original = JSON.stringify({ version: 1, records, rates: {}, balance: { at: 12, rows: [] } }); s.files.set('/profile/usage.json', original);
  await s.store.init(); assert(!s.store.broken); assert.equal(s.files.get('/profile/usage.json'), original); assert.equal(s.store.path, '/profile/usage-index.json');
  assert(s.store.data.records.length < 4); assert.equal(s.store.summary().calls, records.length);
  const restored = s.create(); await restored.init(); const result = [];
  for (let page = 0; page < 4; page++) result.push(...(await restored.page({}, page, 3)).records);
  assert.deepEqual(result, records.slice().reverse()); assert.deepEqual(result.at(-1).cost.rate, records[0].cost.rate); assert.equal(restored.data.balance.at, 12);
  assert(restored.cache.size <= 2); assert(restored.data.records.length < 4);
});
test('all combinations of existing provider, feature, paper and today filters retain exact aggregate and paginated results', async () => {
  const s = setup(), records = Array.from({ length: 22 }, (_, i) => record(i + 1, i % 4 === 0 ? { at: Date.now() - 172800000 } : {}));
  records[0] = record(1, { usage: { input: null, output: null, total: null, cached: null, write: null, reasoning: null, valid: true }, cost: null });
  for (const value of records) await append(s.store, value);
  for (const period of ['all', 'today', 'paper']) for (const provider of ['', 'deepseek', 'chatgpt']) for (const feature of ['', 'chat', 'translation']) for (const paperKey of ['', 'A', 'B']) {
    const filters = { period, provider, feature, paperKey }, expected = records.filter(r => s.store.matches(r, filters));
    assert.deepEqual(canonical(s.store.summary(filters)), canonical(Store.summarize(expected)), JSON.stringify(filters));
    const shown = []; for (let page = 0; page < Math.max(1, Math.ceil(expected.length / 3)); page++) shown.push(...(await s.store.page(filters, page, 3)).records);
    assert.deepEqual(shown, expected.slice().reverse(), JSON.stringify(filters));
  }
});
test('successful appends bound raw in-memory detail and never rewrite previously committed history segments', async () => {
  const s = setup(); await s.store.init();
  s.state.beforeWrite = async path => { if (/usage-records-/.test(path)) assert(!s.files.has(path), 'history segments are immutable'); };
  for (let number = 1; number <= 44; number++) await append(s.store, record(number));
  assert(s.store.data.records.length < 4); assert.equal(s.store.summary().calls, 44); assert.equal(s.store.segments.length, 21);
  await s.store.page({}, 20, 2); await s.store.page({}, 19, 2); await s.store.page({}, 18, 2); assert(s.store.cache.size <= 2);
  const modelNames = s.store.knownModels('deepseek'); assert(modelNames.includes('model-1')); assert(modelNames.includes('model-43'));
  const before = new Map(s.store.segments.map(row => [row.name, s.files.get('/profile/' + row.name)]));
  await append(s.store, record(45)); for (const [name, contents] of before) assert.equal(s.files.get('/profile/' + name), contents);
});
test('deep filtered pages skip complete or nonmatching segments using metadata instead of scanning historical files', async () => {
  const s = setup(); for (let number = 1; number <= 30; number++) await append(s.store, record(number)); s.store.cache.clear();
  let before = s.reads.length; const page = await s.store.page({ paperKey: 'A' }, 5, 2);
  assert.deepEqual(page.records.map(row => row.id), ['call-9', 'call-7']); assert.equal(s.reads.slice(before).filter(path => /usage-records-/.test(path)).length, 2);
  before = s.reads.length; const empty = await s.store.page({ paperKey: 'missing-paper' }, 0, 30);
  assert.equal(empty.total, 0); assert.deepEqual(empty.records, []); assert.equal(s.reads.length, before);
});
test('a failed segment or index commit leaves every pending record available and can retry without duplicate accounting', async () => {
  for (const target of ['segment', 'index']) {
    const s = setup(); await s.store.init(); for (let i = 1; i <= 3; i++) await append(s.store, record(i));
    const legacy = s.files.get('/profile/usage.json'); let failed = false;
    s.state.beforeWrite = async path => { if (!failed && (target === 'segment' ? /usage-records-/.test(path) : path.endsWith('usage-index.json'))) { failed = true; throw Error('disk unavailable'); } };
    s.store.data.records.push(record(4)); await assert.rejects(s.store.save(), /disk unavailable/);
    assert.equal(s.store.data.records.length, 4); assert.equal(s.store.segments.length, 0); assert.equal(s.store.summary().calls, 4); assert.equal(s.files.get('/profile/usage.json'), legacy); assert(/尚未保存/.test(s.store.error));
    s.state.beforeWrite = async () => {}; await s.store.save(); const restored = s.create(); await restored.init();
    assert.equal(restored.summary().calls, 4); assert.equal(new Set((await restored.page({}, 0, 100)).records.map(r => r.id)).size, 4); assert.equal(restored.segments.length, 1);
  }
});
test('records appended and rates or balance changed during rollover survive queued saves and restart', async () => {
  const s = setup(), entered = deferred(), gate = deferred(); await s.store.init();
  for (let i = 1; i <= 3; i++) await append(s.store, record(i));
  let first = true; s.state.beforeWrite = async path => { if (first && path.endsWith('usage-index.json')) { first = false; entered.resolve(); await gate.promise; } };
  s.store.data.records.push(record(4)); const rollover = s.store.save(); await entered.promise;
  s.store.data.records.push(record(5)); const appendSave = s.store.save();
  s.store.data.rates.custom = record(2).cost.rate; const rateSave = s.store.save(); s.store.data.balance = { at: 123, rows: [{ currency: 'CNY', total_balance: '9.00' }] }; const balanceSave = s.store.save();
  gate.resolve(); await Promise.all([rollover, appendSave, rateSave, balanceSave]);
  const restored = s.create(); await restored.init(); assert.equal(restored.summary().calls, 5); assert(restored.data.rates.custom); assert.equal(restored.data.balance.at, 123);
  assert.deepEqual((await restored.page({}, 0, 10)).records.map(r => r.id), ['call-5', 'call-4', 'call-3', 'call-2', 'call-1']);
});
test('a corrupt new index never silently falls back to or overwrites the preserved legacy ledger', async () => {
  for (const corrupt of ['{not json', 'null', '{}']) {
    const s = setup(), legacy = JSON.stringify({ version: 1, records: [record(1)], rates: {}, balance: null });
    s.files.set('/profile/usage.json', legacy); s.files.set('/profile/usage-index.json', corrupt); await s.store.init(); assert(s.store.broken);
    await assert.rejects(s.store.save()); assert.equal(s.files.get('/profile/usage-index.json'), corrupt); assert.equal(s.files.get('/profile/usage.json'), legacy); assert.equal(s.writes.length, 0);
  }
});
test('a failed initial migration retains the loaded legacy details and can be retried without reloading or losing history', async () => {
  const s = setup(), original = JSON.stringify({ version: 1, records: [1, 2, 3, 4, 5].map(number => record(number)), rates: {} });
  s.files.set('/profile/usage.json', original); s.state.beforeWrite = async () => { throw Error('disk offline'); };
  await s.store.init(); assert(!s.store.broken); assert.equal(s.store.summary().calls, 5); assert.equal(s.store.data.records.length, 5); assert(/尚未保存/.test(s.store.error));
  s.state.beforeWrite = async () => {}; await s.store.save(); const restored = s.create(); await restored.init(); assert.equal(restored.summary().calls, 5); assert.equal(s.files.get('/profile/usage.json'), original);
});
test('index traversal, duplicate segment names and inconsistent aggregate counts are rejected without touching files', async () => {
  const s = setup(); for (let i = 1; i <= 4; i++) await append(s.store, record(i)); const valid = JSON.parse(s.files.get('/profile/usage-index.json'));
  for (const change of [index => { index.segments[0].name = '../private.json'; }, index => { index.segments.push(index.segments[0]); }, index => { index.groups[0].summary.calls++; }]) {
    const bad = structuredClone(valid); change(bad); const text = JSON.stringify(bad); s.files.set('/profile/usage-index.json', text); const restored = s.create(); await restored.init(); assert(restored.broken); await assert.rejects(restored.save()); assert.equal(s.files.get('/profile/usage-index.json'), text);
  }
});
test('valid JSON with contradictory per-segment and top-level token or cost summaries is rejected rather than shown as an accurate bill', async () => {
  const s = setup(); for (let number = 1; number <= 6; number++) await append(s.store, record(number)); const valid = JSON.parse(s.files.get('/profile/usage-index.json'));
  const changes = [index => { index.groups[0].summary.input++; }, index => { index.groups[0].summary.costs[0].high += .001; }, index => { index.segments[0].groups[0].summary.total++; }, index => { index.segments[0].groups[0].summary.costs[0].equivalent = !index.segments[0].groups[0].summary.costs[0].equivalent; }];
  for (const change of changes) {
    const index = structuredClone(valid); change(index); const text = JSON.stringify(index); s.files.set('/profile/usage-index.json', text);
    const resumed = s.create(); await resumed.init(); assert(resumed.broken); assert.match(resumed.error, /摘要/); assert.equal(resumed.summary().unavailable, true); assert.equal(resumed.summary().calls, null); assert.equal(resumed.summary().total, null);
    await assert.rejects(resumed.save()); assert.equal(s.files.get('/profile/usage-index.json'), text);
  }
});
test('grouped cost consistency permits normal floating-point summation roundoff while token and call counts remain exact', async () => {
  const s = setup({ segmentSize: 7 });
  for (let number = 1; number <= 103; number++) await append(s.store, record(number, { provider: 'deepseek', feature: 'chat', paperKey: 'A', cost: { currency: 'CNY', low: .1, high: .3, equivalent: false, rate: { currency: 'CNY', input: [1, 1], output: [2, 2], cached: [0, 0], write: [0, 0] } } }));
  const resumed = s.create(); await resumed.init(); assert(!resumed.broken); assert.equal(resumed.summary().calls, 103); assert.equal(resumed.summary().total, 5562); assert(Math.abs(resumed.summary().costs[0].low - 10.3) < 1e-10);
});
test('missing or corrupt old detail is reported on demand, preserves the index and never replaces history with an empty ledger', async () => {
  const s = setup(); for (let i = 1; i <= 6; i++) await append(s.store, record(i, { at: Date.now() - 172800000 + i }));
  const index = s.files.get('/profile/usage-index.json'); s.files.set('/profile/' + s.store.segments[0].name, '{bad segment');
  const restored = s.create(); await restored.init(); assert(!restored.broken); await assert.rejects(restored.page({}, 2, 2), /无法读取/); assert(restored.broken); await assert.rejects(restored.save()); assert.equal(s.files.get('/profile/usage-index.json'), index);
});
test('local day rollover has an explicit pending state and recomputes exact today totals without treating unknown calls as free', async () => {
  let now = new Date(2026, 9, 25, 12).getTime(); const s = setup({ now: () => now });
  for (let i = 1; i <= 4; i++) await append(s.store, record(i, { at: now - 1000 + i }));
  assert.equal(s.store.summary({ period: 'today' }).calls, 4);
  now += 86400000; const unknown = record(5, { at: now, usage: { input: null, output: null, total: null, cached: null, write: null, reasoning: null, valid: true }, cost: null });
  await append(s.store, unknown); assert.equal(s.store.summary({ period: 'today' }).pending, true); await s.store.ready({ period: 'today' });
  assert.equal(s.store.summary({ period: 'today' }).calls, 1); assert.equal(s.store.summary({ period: 'today' }).unknown, 1); assert.equal(s.store.summary({ period: 'today' }).unpriced, 1);
  assert.equal((await s.store.page({ period: 'today' }, 0, 30)).records[0].id, unknown.id); assert.equal(s.store.summary().calls, 5);
});
test('today summaries reuse full-segment metadata and read only the segments crossing a day boundary', async () => {
  const now = new Date(2026, 9, 25, 12).getTime(), s = setup({ now: () => now });
  const values = [record(1, { at: now - 86400000 }), record(2, { at: now }), record(3, { at: now + 1 }), record(4, { at: now + 2 }), record(5, { at: now + 3 }), record(6, { at: now + 4 })];
  for (const value of values) await append(s.store, value); const before = s.reads.length;
  const restored = s.create(); await restored.init(); const archiveReads = s.reads.slice(before).filter(path => /usage-records-/.test(path));
  assert.equal(archiveReads.length, 1); assert(archiveReads[0].endsWith(restored.segments[0].name)); assert.equal(restored.summary({ period: 'today' }).calls, 5);
});
test('a day change while reading a historical page retries against the new day instead of mixing two days', async () => {
  let now = new Date(2026, 9, 25, 12).getTime(); const s = setup({ now: () => now });
  for (let number = 1; number <= 4; number++) await append(s.store, record(number, { at: now + number }));
  const entered = deferred(), gate = deferred(); s.state.beforeRead = async path => { if (/usage-records-/.test(path)) { entered.resolve(); await gate.promise; } };
  const pending = s.store.page({ period: 'today' }, 1, 2); await entered.promise; now += 86400000; gate.resolve(); const page = await pending;
  assert.equal(page.total, 0); assert.deepEqual(page.records, []); assert.equal(page.page, 0); assert(!s.store.broken);
});
test('normal shutdown waits for an in-progress ledger commit and releases detail caches', async () => {
  const s = setup(), entered = deferred(), gate = deferred(); await s.store.init();
  s.state.beforeWrite = async () => { entered.resolve(); await gate.promise; }; s.store.data.records.push(record(1)); const saving = s.store.save(); await entered.promise;
  let closed = false; const closing = s.store.destroy().then(() => { closed = true; }); await tick(); assert.equal(closed, false); gate.resolve(); await Promise.all([saving, closing]); assert.equal(s.store.cache.size, 0); await assert.rejects(s.store.save(), /关闭/);
});
