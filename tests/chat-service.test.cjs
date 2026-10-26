const { test } = require('node:test');
const assert = require('node:assert/strict');
const ChatService = require('../addon/content/chat-service.js');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup() {
  const session = { messages: [], materials: {} }, events = [], sent = [], records = [], summaries = [];
  const state = { settings: { chatProvider: 'deepseek', chatDeepseekModel: 'deepseek-flash', smartReading: false }, models: [], online: false };
  const io = {
    runtime: () => state, snapshotModel: c => Object.freeze({ ...c }), session: async () => session, save: async () => {},
    openModel: async (selection, signal) => ({ prepare: options => ({ notice: 'history notice', run: async callbacks => {
      if (signal.aborted) throw Error('cancelled'); sent.push({ selection, options }); callbacks.onDelta('partial'); callbacks.onModel('actual-service-model'); return 'answer';
    } }) }),
    prepare: async () => ({ text: 'evidence', label: 'source', references: [1] }), cite: (text, references) => text + ':' + references.length,
    record: async (...args) => records.push(args), organize: (...args) => summaries.push(args), verified() {}, emit: (...args) => events.push(args)
  };
  return { service: new ChatService(io), io, state, session, events, sent, records, summaries };
}
test('a closed or changing conversation rejects without loading a session or opening a model', async () => {
  const s = setup(); let calls = 0; s.io.session = async () => { calls++; };
  s.state.closing = true; await assert.rejects(s.service.ask('A', 'q'), /关闭/);
  s.state.closing = false; s.state.changing = true; await assert.rejects(s.service.ask('A', 'q'), /切换/); assert.equal(calls, 0);
});
test('the conversation replacement guard is checked again after a slow session read', async () => {
  const s = setup(), gate = deferred(); s.io.session = () => gate.promise;
  const pending = s.service.ask('A', 'q'); s.state.changing = true; gate.resolve(s.session);
  await assert.rejects(pending, /切换/); assert.equal(s.sent.length, 0); assert.equal(s.service.busy, false);
});
test('selection and reading paper IDs are captured before the first asynchronous operation', async () => {
  const s = setup(), gate = deferred(), ids = [2]; s.io.session = () => gate.promise;
  let prepared; s.io.prepare = async (_key, _query, options) => { prepared = options; return { text: 'local', references: [] }; };
  const pending = s.service.ask('A', 'q', null, null, { ids }); ids.push(3); s.state.settings.chatDeepseekModel = 'deepseek-v4-pro';
  gate.resolve(s.session); await pending; assert.deepEqual(prepared.ids, [2]); assert.equal(s.sent[0].selection.model, 'deepseek-flash');
});
test('the response and actual returned model remain busy until the local save completes', async () => {
  const s = setup(), gate = deferred(), saving = deferred(); s.io.save = async () => { saving.resolve(); await gate.promise; };
  const pending = s.service.ask('general', 'q'); await saving.promise;
  assert.equal(s.service.busy, true); assert.equal(s.session.messages[1].model, 'actual-service-model');
  assert.equal(s.session.messages[1].status, 'complete'); gate.resolve(); assert.equal(await pending, 'answer:0'); assert.equal(s.service.busy, false);
});
test('failed local persistence retains a completed answer and exposes its completion for recovery', async () => {
  const s = setup(); s.io.save = async () => { throw Error('disk full'); };
  await assert.rejects(s.service.ask('general', 'q'), error => error.answerComplete === true && /disk full/.test(error.message));
  assert.equal(s.session.messages[1].status, 'complete'); assert.equal(s.service.completion, null); assert.equal(s.service.busy, false);
});
test('incompatible materials fail before altering conversation messages or materials', async () => {
  const s = setup(); s.io.openModel = async () => ({ prepare() { throw Error('unsupported PDF'); } });
  await assert.rejects(s.service.ask('A', 'q', { id: 'pdf', mode: 'pdf' }), /unsupported PDF/);
  assert.deepEqual(s.session.messages, []); assert.deepEqual(s.session.materials, {}); assert.equal(s.service.busy, false);
});
test('cancellation during local evidence collection never dispatches a model request', async () => {
  const s = setup(), gate = deferred(), extracting = deferred(); s.state.settings.smartReading = true;
  s.io.prepare = async () => { extracting.resolve(); await gate.promise; return { text: 'evidence' }; };
  const pending = s.service.ask('A', 'q'); await extracting.promise; s.service.stop(); gate.resolve();
  await assert.rejects(pending, /停止/); assert.equal(s.sent.length, 0); assert.equal(s.session.messages.length, 0); await s.service.drain();
});
test('partial transport failure marks the pair failed and saves the visible partial response once', async () => {
  const s = setup(); let saves = 0; s.io.save = async () => { saves++; };
  s.io.openModel = async () => ({ prepare: () => ({ run: async ({ onDelta }) => { onDelta('partial response'); throw Error('network broke'); } }) });
  await assert.rejects(s.service.ask('A', 'q'), /network broke/); assert.equal(s.session.messages[1].text, 'partial response');
  assert.equal(s.session.messages[0].status, 'failed'); assert.equal(saves, 1); assert.equal(s.summaries.length, 0);
});
test('a note failure never converts a completed answer into a failed model request', async () => {
  const s = setup(); s.state.settings.autoRecord = true; s.io.record = async () => { throw Error('note storage'); };
  await s.service.ask('A', 'q'); assert.equal(s.session.messages[1].status, 'complete'); assert.equal(s.summaries.length, 1);
  assert.match(s.events.find(([event]) => event === 'error')[1].message, /自动记录失败/);
});
test('stop and shutdown draining cover the initial asynchronous session read', async () => {
  const s = setup(), gate = deferred(); s.io.session = () => gate.promise;
  const pending = s.service.ask('A', 'q'); assert.equal(s.service.busy, true); assert(s.service.controller);
  s.service.stop(); let drained = false; const drain = s.service.drain().then(() => { drained = true; });
  await new Promise(setImmediate); assert.equal(drained, false); gate.resolve(s.session);
  await assert.rejects(pending, /停止/); await drain;
  assert.equal(s.sent.length, 0); assert.equal(drained, true); assert.equal(s.service.busy, false);
});
test('a post-answer organization error is nonfatal and never changes a completed pair', async () => {
  const s = setup(); s.io.organize = () => { throw Error('summary queue'); };
  await s.service.ask('A', 'q'); assert.equal(s.session.messages[1].status, 'complete');
  assert.match(s.events.find(([event]) => event === 'error')[1].message, /重点整理失败/);
});
test('oversized history and unsupported screenshot models do not start model authorization', async () => {
  const s = setup(); s.session.messages.push({ text: 'x'.repeat(300001) }); let opened = 0; s.io.openModel = async () => { opened++; };
  await assert.rejects(s.service.ask('A', 'q'), /过长/); assert.equal(opened, 0);
  s.state.settings = { chatProvider: 'chatgpt', model: 'model', chatGPTEffort: 'default' }; s.state.online = true; s.state.models = [{ id: 'model' }];
  await assert.rejects(s.service.ask('A', 'q', { mode: 'screenshot' }), /图片能力/); assert.equal(opened, 0);
});
test('manual materials retain precedence by default and only an explicit choice adds bounded primary retrieval', async () => {
  const s = setup(), material = { id: 'selection', mode: 'selection', text: 'manual excerpt', label: 'Selected text' }, calls = [];
  s.state.settings.smartReading = true;
  s.io.prepare = async (key, query, options) => { calls.push({ key, query, options }); return { text: 'focused source', references: [{ key, paperID: 1 }], coverage: [{ paperID: 1, title: 'This paper', kind: 'lexical', brief: true, snippets: 1, characters: 40 }] }; };
  await s.service.ask('A', 'Explain this excerpt', material); assert.equal(calls.length, 0); assert.equal(s.session.messages.at(-1).readingScope.sources.primaryActual, false);
  await s.service.ask('A', 'Relate this excerpt to the method', material, null, { includePrimary: true });
  assert.equal(calls.length, 1); assert.equal(calls[0].options.includePrimary, true); assert.equal(calls[0].options.first, false);
  assert.equal(s.sent.at(-1).options.context, material); assert.equal(s.sent.at(-1).options.evidence.text, 'focused source');
  const answer = s.session.messages.at(-1), user = s.session.messages.at(-2); assert.equal(user.readingScope, answer.readingScope); assert.equal(answer.readingScope.sources.primaryActual, true); assert.equal(answer.readingScope.sources.preread, 'used');
  const event = s.events.filter(([type]) => type === 'readingScope').at(-1); assert.equal(event[1].key, 'A'); assert.equal(event[1].scope, answer.readingScope); assert.equal(event[1].at, answer.at);
});
test('manual context plus comparisons excludes the primary unless explicitly selected and does not send initial full text', async () => {
  const s = setup(), material = { id: 'selected', text: 'manual excerpt' }; let options;
  s.state.settings.smartReading = true; s.io.prepare = async (_key, _query, value) => { options = value; return { text: 'other paper source', references: [{ key: 'B', paperID: 2 }], coverage: [{ paperID: 2, title: 'Other', kind: 'lexical', snippets: 1, characters: 30 }] }; };
  await s.service.ask('A', 'Compare the excerpt', material, null, { ids: [2] });
  assert.equal(options.includePrimary, false); assert.equal(options.first, false); assert.equal(s.session.messages.at(-1).readingScope.sources.primaryActual, false); assert.deepEqual(s.session.messages.at(-1).readingScope.sources.actualComparisonIDs, [2]);
});
test('explicit source selection is frozen across a slow session load and source planning itself does not open models', async () => {
  const s = setup(), gate = deferred(), options = { includePrimary: true }, material = { id: 's', text: 'manual excerpt' }; let prepared;
  s.io.session = () => gate.promise; s.io.prepare = async (_key, _query, value) => { prepared = value; return { text: 'source', references: [{ key: 'A', paperID: 1 }] }; };
  const pending = s.service.ask('A', 'q', material, null, options); options.includePrimary = false; gate.resolve(s.session); await pending; assert.equal(prepared.includePrimary, true);
  const invalid = setup(); let opened = 0; invalid.io.openModel = async () => { opened++; }; await assert.rejects(invalid.service.ask('A', 'q', null, null, { ids: ['not-a-paper'] }), /标识无效/); assert.equal(opened, 0); assert.equal(invalid.service.busy, false);
});
test('prepared reading scope persists with failed or cancelled requests without claiming permanent model memory', async () => {
  const s = setup(); s.state.settings.smartReading = true;
  s.io.prepare = async () => ({ text: 'source', references: [{ key: 'A', paperID: 1 }], coverage: [{ paperID: 1, title: 'Paper', kind: 'overview', zeroMatches: true, brief: false, snippets: 2, characters: 50 }] });
  s.io.openModel = async () => ({ prepare: () => ({ run: async () => { throw Error('transport failure'); } }) });
  await assert.rejects(s.service.ask('A', 'q'), /transport failure/); const answer = s.session.messages.at(-1);
  assert.equal(answer.status, 'failed'); assert.equal(answer.readingScope.phase, 'prepared'); assert.equal(answer.readingScope.sources.preread, 'not-used'); assert(answer.readingScope.warnings.some(value => /检索未命中/.test(value)));
});
