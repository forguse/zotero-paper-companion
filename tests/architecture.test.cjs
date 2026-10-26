const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path').posix;
const core = require('../addon/content/core.js');

function setup() {
  const files = new Map(), events = [];
  const state = { scans: 0, encodes: 0, decodes: 0, beforeRead: async () => {}, beforeWrite: async () => {} };
  const json = { stringify(...args) { state.encodes++; return JSON.stringify(...args); }, parse(...args) { state.decodes++; return JSON.parse(...args); } };
  const scope = { JSON: json, PCore: core, PCInsights: { defaultPrompts: {} }, Zotero: { Reader: { unregisterEventListener() {} } }, AbortController,
    PathUtils: { join: path.join, filename: path.basename },
    IOUtils: { exists: async p => files.has(p),
      async readUTF8(p) { await state.beforeRead(p); return files.get(p); },
      async writeUTF8(p, text) { await state.beforeWrite(p, text); files.set(p, text); },
      async getChildren(dir) { state.scans++; return [...files.keys()].filter(p => path.dirname(p) === dir); } } };
  vm.createContext(scope);
  for (const name of ['persistence.js', 'sessions.js', 'model-gateway.js', 'reading-scope.js', 'chat-service.js', 'native.js']) vm.runInContext(fs.readFileSync(require.resolve('../addon/content/' + name), 'utf8'), scope);
  const api = scope.PaperCompanion; api.chatsDir = '/chats'; api.dir = '/profile';
  api.meta = { hostID: 'local-test', accounts: [{ clientID: 'one' }, { clientID: 'two' }], active: 'one' };
  api.emit = (type, data) => events.push({ type, data });
  api.readSecrets = async () => ({ openai: {} }); api.writeSecrets = async () => {};
  return { api, files, events, state };
}
const conversation = text => ({ messages: [{ role: 'user', text, status: 'complete', at: 1 }] });

test('simultaneous first session loads share one read and one live object', async () => {
  const s = setup(); s.files.set('/chats/A.json', JSON.stringify(conversation('saved')));
  let release, reads = 0; const gate = new Promise(r => release = r);
  s.state.beforeRead = async () => { reads++; await gate; };
  const first = s.api.session('A'), second = s.api.session('A');
  await new Promise(setImmediate); release(); const [a, b] = await Promise.all([first, second]);
  assert.equal(reads, 1); assert.equal(a, b);
  a.messages.push({ role: 'assistant', text: 'live answer' }); assert.equal(b.messages.length, 2);
});

test('a failed account selection keeps the last committed account in memory and on disk', async () => {
  const s = setup(), original = s.api.meta; s.files.set('/profile/accounts.json', JSON.stringify(original));
  s.state.beforeWrite = async () => { throw Error('synthetic disk full'); };
  await assert.rejects(s.api.chooseAccount('two'), /disk full/);
  assert.equal(s.api.meta, original); assert.equal(s.api.meta.active, 'one');
  assert.equal(JSON.parse(s.files.get('/profile/accounts.json')).active, 'one');
});

test('a failed account metadata write does not publish an account whose metadata was never committed', async () => {
  const s = setup(), original = JSON.stringify(s.api.meta);
  s.state.beforeWrite = async () => { throw Error('synthetic metadata failure'); };
  await assert.rejects(s.api.setAccount({ clientID: 'three' }, { access_token: 'fake' }), /metadata failure/);
  assert.equal(JSON.stringify(s.api.meta), original);
});

test('summary history enumerates the directory once while retaining chronological boundaries', async () => {
  const s = setup();
  for (let i = 1; i <= 30; i++) s.files.set(`/chats/A-${i}.json`, JSON.stringify(conversation('old-' + i)));
  s.files.set('/chats/B-1.json', JSON.stringify(conversation('other paper')));
  s.files.set('/chats/A-not-an-archive.json', '{}'); s.api.sessions.set('A', conversation('current'));
  const rows = await s.api.summaryMessages('A');
  assert.equal(s.state.scans, 1); assert.equal(rows.filter(m => m.role === 'boundary').length, 31);
  assert.equal(rows.filter(m => m.role === 'user').map(m => m.text).join(','), [...Array.from({ length: 30 }, (_, i) => 'old-' + (i + 1)), 'current'].join(','));
});

test('a failed restore target write leaves the current session intact rather than committing an empty session', async () => {
  const s = setup(), current = conversation('current'); s.api.sessions.set('A', current);
  s.files.set('/chats/A.json', JSON.stringify(current));
  s.files.set('/chats/A-10.json', JSON.stringify(conversation('archived')));
  s.state.beforeWrite = async (p, text) => { if (p === '/chats/A.json' && text.includes('archived')) throw Error('synthetic restore failure'); };
  await assert.rejects(s.api.restoreSession('A', 'A-10.json'), /restore failure/);
  assert.equal(await s.api.session('A'), current);
  assert.equal(JSON.parse(s.files.get('/chats/A.json')).messages[0].text, 'current');
  assert.equal(JSON.parse(s.files.get('/chats/A-10.json')).messages[0].text, 'archived');
});

test('saving captures immutable JSON in one encoding pass without a decode-and-reencode clone', async () => {
  const s = setup(), data = conversation('snapshot'); s.api.sessions.set('A', data);
  await s.api.saveSession('A');
  assert.equal(s.state.encodes, 1); assert.equal(s.state.decodes, 0);
  assert.equal(JSON.parse(s.files.get('/chats/A.json')).messages[0].text, 'snapshot');
});

test('all native text writes serialize the same target and allow a different file to finish', async () => {
  const s = setup(), written = []; let release, started;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  s.state.beforeWrite = async (p, text) => { if (p === '/same.md' && text === 'first') { started(); await gate; } written.push(text); };
  const first = s.api.writeText('/same.md', 'first'); await ready;
  const second = s.api.writeText('/same.md', 'second');
  await s.api.writeText('/other.md', 'independent');
  assert.deepEqual(written, ['independent']); release(); await Promise.all([first, second]);
  assert.deepEqual(written, ['independent', 'first', 'second']); assert.equal(s.files.get('/same.md'), 'second');
  await s.api.fileWrites.drain(); assert.equal(s.api.fileWrites.tails.size, 0);
});

test('a failed path write releases its lane so retry and shutdown draining can complete', async () => {
  const s = setup(); s.state.beforeWrite = async () => { throw Error('synthetic failure'); };
  await assert.rejects(s.api.writeText('/same.md', 'first'), /failure/);
  s.state.beforeWrite = async () => {}; await s.api.writeText('/same.md', 'retry');
  await s.api.fileWrites.drain(); assert.equal(s.files.get('/same.md'), 'retry'); assert.equal(s.api.fileWrites.tails.size, 0);
});

test('a blocked paper index transaction does not block preferences or a conversation snapshot', async () => {
  const s = setup(); let release, started;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r), finished = [];
  const slow = s.api.queue(async () => { started(); await gate; finished.push('index'); }, 'reading:A'); await ready;
  await s.api.queue(async () => finished.push('preferences'));
  s.api.sessions.set('A', conversation('independent')); await s.api.saveSession('A');
  assert.equal(JSON.parse(s.files.get('/chats/A.json')).messages[0].text, 'independent');
  assert.deepEqual(finished, ['preferences']); release(); await slow; await s.api.serial;
  assert.equal(s.api.tasks.tails.size, 0);
});

test('concurrent account creation and selection commit in order without dropping either account', async () => {
  const s = setup(); let release, started;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  s.api.writeSecrets = async () => { started(); await gate; };
  const adding = s.api.setAccount({ clientID: 'three' }, { access_token: 'fake' }); await ready;
  const choosing = s.api.chooseAccount('two'); release(); await Promise.all([adding, choosing]);
  const disk = JSON.parse(s.files.get('/profile/accounts.json'));
  assert.equal(s.api.meta.active, 'two'); assert.equal(disk.active, 'two');
  assert.deepEqual(disk.accounts.map(a => a.clientID), ['one', 'two', 'three']);
});

test('normal shutdown waits for a cancelled answer to save before releasing persistence services', async () => {
  const s = setup(); let modelStarted, writeStarted, release;
  const modelReady = new Promise(r => modelStarted = r), writeReady = new Promise(r => writeStarted = r), gate = new Promise(r => release = r);
  s.api.settings.chatProvider = 'deepseek'; s.api.readSecrets = async () => ({ deepseek: 'fake' });
  s.api.preread = { jobs: new Map(), destroy() {} }; s.api.insights = { enabled: () => false, destroy() {} };
  s.api.infer = async (_, options) => { modelStarted(); await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true })); };
  s.state.beforeWrite = async p => { if (p === '/chats/general.json') { writeStarted(); await gate; } };
  const answer = s.api.ask('general', 'question', null).catch(e => e); await modelReady;
  let closed = false; const closing = s.api.shutdown().then(() => { closed = true; }); await writeReady;
  await new Promise(setImmediate); assert.equal(closed, false); assert.equal(s.api.chatBusy, true);
  release(); await Promise.all([answer, closing]);
  assert.equal(JSON.parse(s.files.get('/chats/general.json')).messages.at(-1).status, 'cancelled'); assert.equal(closed, true);
  await assert.rejects(s.api.ask('general', 'late', null), /关闭/);
});

test('disconnect preserves the local reading service; full shutdown drains it once', async () => {
  const s = setup(); let destroyed = 0;
  s.api.reading = { async destroy() { destroyed++; } };
  s.api.preread = { destroy() {} }; s.api.insights = { destroy() {} };
  s.api.disconnect(); assert.equal(destroyed, 0);
  await s.api.shutdown(); assert.equal(destroyed, 1);
});

test('a question waiting on first disk read cannot enter a conversation replacement already in progress', async () => {
  const s = setup(); let release, started, requests = 0;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  s.files.set('/chats/general.json', JSON.stringify(conversation('old question')));
  s.api.settings.chatProvider = 'deepseek'; s.api.readSecrets = async () => ({ deepseek: 'fake' });
  s.api.preread = { jobs: new Map() }; s.api.insights = { enabled: () => false };
  s.api.infer = async () => { requests++; throw Error('must not reach a model'); };
  s.state.beforeRead = async () => { started(); await gate; };
  const answer = s.api.ask('general', 'late question', null).catch(e => e); await ready;
  await assert.rejects(s.api.newSession('general'), /停止/);
  s.api.getChatService().stop(); release(); const error = await answer;
  assert.equal(requests, 0); assert.match(error.message, /停止/);
  await s.api.newSession('general');
  assert.equal((await s.api.session('general')).messages.length, 0);
  assert([...s.files.entries()].some(([p, text]) => /general-\d+\.json$/.test(p) && JSON.parse(text).messages[0].text === 'old question'));
});
