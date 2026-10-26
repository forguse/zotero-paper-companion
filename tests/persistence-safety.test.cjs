const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path').posix;
const core = require('../addon/content/core.js');
function setup() {
  const files = new Map(), events = [];
  let uuid = 0;
  const scope = { PCore: core, PCInsights: { defaultPrompts: {} }, PCReadingIndex: { cite: t => t }, Zotero: {}, AbortController,
    PathUtils: { join: path.join }, Services: { uuid: { generateUUID: () => '{test-uuid-' + (++uuid) + '}' } },
    IOUtils: { exists: async p => files.has(p), readUTF8: async p => files.get(p), makeDirectory: async () => {} } };
  vm.createContext(scope); for (const name of ['persistence.js', 'sessions.js', 'model-gateway.js', 'reading-scope.js', 'chat-service.js', 'native.js']) vm.runInContext(fs.readFileSync(require.resolve('../addon/content/' + name), 'utf8'), scope);
  const api = scope.PaperCompanion;
  api.chatsDir = '/chats'; api.meta = { active: 'fake-account' };
  api.settings = { ...api.settings, chatProvider: 'deepseek', smartReading: false };
  api.readJSON = async (p, fallback) => files.has(p) ? JSON.parse(files.get(p)) : fallback;
  api.writeJSON = async (p, value) => files.set(p, JSON.stringify(value));
  api.writeText = async (p, value) => files.set(p, value);
  api.emit = (type, value) => events.push({ type, value, busy: api.chatBusy });
  api.preread = { jobs: new Map() }; api.insights = { enabled: () => false };
  api.readSecrets = async () => ({ deepseek: 'fake-test-key' });
  let requests = 0;
  api.infer = async (url, options) => { requests++; options.onChunk('data: {"choices":[{"delta":{"content":"已完成的测试回答"},"finish_reason":"stop"}]}\n\n'); };
  return { api, files, events, requests: () => requests };
}
test('a response stays busy until its local session has finished saving', async () => {
  const s = setup(); let release, started;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  s.api.writeText = async () => { started(); await gate; };
  const pending = s.api.ask('general', 'question', null); await ready;
  const busyDuringSave = s.api.chatBusy; release(); await pending;
  assert.equal(busyDuringSave, true); assert.equal(s.api.chatBusy, false);
});
test('a failed local save retains the completed answer, clears busy and supports saving without another model request', async () => {
  const s = setup(); s.api.writeText = async () => { throw Error('synthetic disk full'); };
  await assert.rejects(s.api.ask('general', 'question', null), e => e.code === 'CHAT_SAVE_FAILED');
  assert.equal(s.api.chatBusy, false); assert.equal(s.events.at(-1).type, 'busy'); assert.equal(s.api.unsavedSessions?.has('general'), true);
  assert.equal((await s.api.session('general')).messages.at(-1).status, 'complete');
  s.api.writeText = async (p, v) => s.files.set(p, v);
  await s.api.saveSession('general'); assert.equal(s.api.unsavedSessions.has('general'), false);
  assert.equal(JSON.parse(s.files.get('/chats/general.json')).messages.at(-1).text, '已完成的测试回答'); assert.equal(s.requests(), 1);
});
test('overlapping saves of the same session write ordered snapshots without concurrent temporary-file writes', async () => {
  const s = setup(); const data = { messages: [{ role: 'user', text: 'first' }] }; s.api.sessions.set('general', data);
  let release, started, inflight = 0, peak = 0, calls = 0;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  s.api.writeText = async (p, v) => { peak = Math.max(peak, ++inflight); if (++calls === 1) { started(); await gate; } s.files.set(p, v); inflight--; };
  const first = s.api.saveSession('general'); await ready; data.messages[0].text = 'second'; const second = s.api.saveSession('general');
  await new Promise(setImmediate); release(); await Promise.all([first, second]);
  assert.equal(peak, 1); assert.equal(JSON.parse(s.files.get('/chats/general.json')).messages[0].text, 'second');
});
async function noteSetup() {
  const s = setup(), paper = { key: '1_TESTKEY1' }, paths = { note: '/paper/阅读笔记.md', backups: '/paper/backups' };
  s.api.files = { ensure: async () => paths }; s.api.paperFromKey = async () => paper;
  s.files.set(paths.note, 'last loaded note'); await s.api.note(paper);
  s.api.noteWrites.set(paper.key, { text: 'plugin draft', timer: { cancel() {} } });
  return { ...s, paper, paths };
}
test('autosaving after an external edit preserves the external Markdown in a separate backup', async () => {
  const s = await noteSetup(); s.files.set(s.paths.note, 'external editor version');
  await s.api.flushNote(s.paper.key);
  assert.equal(s.files.get(s.paths.note), 'plugin draft');
  assert([...s.files.entries()].some(([p, text]) => p.startsWith(s.paths.backups + '/') && text === 'external editor version'));
  assert(s.events.some(e => e.type === 'noteExternalBackup'));
});
test('ordinary unchanged-file autosaves do not create repeated external-edit backups', async () => {
  const s = await noteSetup(); await s.api.flushNote(s.paper.key);
  assert.equal([...s.files.keys()].filter(p => p.startsWith(s.paths.backups + '/')).length, 0);
});
test('a failed external-note backup leaves both the external file and unsaved plugin draft intact', async () => {
  const s = await noteSetup(); s.files.set(s.paths.note, 'external editor version');
  s.api.writeText = async (p, text) => { if (p.startsWith(s.paths.backups + '/')) throw Error('synthetic backup failure'); s.files.set(p, text); };
  await assert.rejects(s.api.flushNote(s.paper.key), /synthetic backup failure/);
  assert.equal(s.files.get(s.paths.note), 'external editor version'); assert.equal(s.api.noteWrites.get(s.paper.key).text, 'plugin draft');
});
test('missing credentials do not write an empty session or mask the credential error as a save error', async () => {
  const s = setup(); s.api.readSecrets = async () => ({});
  s.api.writeText = async () => { throw Error('must not write'); };
  await assert.rejects(s.api.ask('general', 'unsent question', null), /API Key/);
  assert.equal(s.api.chatBusy, false); assert.equal(s.api.unsavedSessions.size, 0); assert.equal(s.requests(), 0);
});
test('a model failure followed by a save failure remains eligible for question draft recovery', async () => {
  const s = setup(); s.api.infer = async () => { throw Error('synthetic provider failure'); };
  s.api.writeText = async () => { throw Error('synthetic disk full'); };
  await assert.rejects(s.api.ask('general', 'failed question', null), e => e.code === 'CHAT_SAVE_FAILED' && e.answerComplete === false);
  assert.equal((await s.api.session('general')).messages.at(-1).status, 'failed');
});
test('starting a new session archives an unsaved answer before clearing its warning', async () => {
  const s = setup(); s.api.sessions.set('general', { messages: [{ role: 'assistant', text: 'keep in archive', status: 'complete' }] });
  s.api.unsavedSessions.add('general'); await s.api.newSession('general');
  assert.equal(s.api.unsavedSessions.has('general'), false);
  assert([...s.files.entries()].some(([p, data]) => /^\/chats\/general-\d+\.json$/.test(p) && JSON.parse(data).messages[0].text === 'keep in archive'));
});
test('a session cannot be replaced while a previous local save is still writing', async () => {
  const s = setup(); s.api.sessions.set('general', { messages: [{ role: 'assistant', text: 'current answer', status: 'complete' }] });
  let release, started; const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  const originalWrite = s.api.writeText;
  s.api.writeText = async (p, value) => { started(); await gate; return originalWrite(p, value); };
  const pending = s.api.saveSession('general'); await ready;
  let refused = false; const replacement=s.api.newSession('general').catch(()=>{refused=true;}); await new Promise(setImmediate); release(); await replacement;
  await pending; assert.equal(refused, true); assert.equal((await s.api.session('general')).messages[0].text, 'current answer');
});
test('saving cannot race a session restore transaction', async () => {
  const s = setup(); s.api.sessionStore.restoring = true;
  await assert.rejects(s.api.saveSession('general'), /切换|恢复/);
  assert.equal(s.files.size, 0);
});
