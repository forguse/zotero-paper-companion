const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PCWebChatService: WebChat, PCWebView: WebView } = require('../addon/content/webview.js');

test('a modern guest conversation offers login before unsupported path handling', () => {
  const service = new WebChat({});
  assert.throws(() => service.checkPage({ conversation:'/uc/guest', blocked:'请先登录 ChatGPT。' }), error => error.code === 'WEB_NEEDS_INTERACTION' && /登录/.test(error.message));
});

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup(options = {}) {
  const win = {}, view = {}, sessions = new Map(), sent = [], events = [], stopped = [], records = [], summaries = [];
  const state = { settings: { chatProvider: 'chatgpt-web', autoRecord: false } };
  let now = 0, serial = 0, saves = 0;
  let page = { composer: true, conversation: '/', draft: '', userCount: 0, assistantCount: 0, lastAssistantID: '', attachments: false, streaming: false };
  const io = {
    runtime: () => state, view: () => view,
    session: async key => { if (!sessions.has(key)) sessions.set(key, { messages: [] }); return sessions.get(key); },
    save: async () => { saves++; }, inspect: async () => ({ ...page }),
    prepare: async () => ({}), files: context => context?.file ? [{ name: context.filename || 'paper.pdf', type: 'application/pdf', dataURL: context.file }] : [],
    submit: async (_win, data) => { sent.push(data); return { requestID: data.requestID, state: 'submitted', submitted: true, text: '', conversation: '/c/owned' }; },
    snapshot: async (_win, requestID) => {
      page = { ...page, conversation: '/c/owned', userCount: page.userCount + 1, lastAssistantID: 'a-' + serial };
      return { requestID, state: 'complete', submitted: true, text: 'A **complete** answer.', messageID: page.lastAssistantID, conversation: page.conversation, model: 'website-selected-model' };
    },
    stop: async (_win, requestID) => { stopped.push(requestID); },
    requestID: () => 'request-' + (++serial), now: () => now,
    delay: async (_win, ms, signal) => { if (signal.aborted) throw Error('aborted'); now += ms; },
    record: async (...value) => records.push(value), organize: (...value) => summaries.push(value), emit: (...value) => events.push(value)
  };
  const service = new WebChat(io, options);
  return { service, io, state, win, view, sent, sessions, stopped, records, summaries, events,
    setPage: value => { page = { ...page, ...value }; }, getPage: () => page, get saves() { return saves; } };
}

test('only the typed question is submitted once and Markdown is streamed into ordinary local messages', async () => {
  const s = setup(), deltas = []; let step = 0;
  s.io.snapshot = async (_win, requestID) => (++step === 1 ? { requestID, state: 'streaming', submitted: true, conversation: '/c/owned', text: 'Partial' } :
    { requestID, state: 'complete', submitted: true, conversation: '/c/owned', text: '### Result\n\n- Evidence\n\n```tex\nx^2\n```\n\n$E=mc^2$', messageID: 'answer-1', model: 'real-web-model' });
  const answer = await s.service.ask(s.win, 'paper', 'What is the result?', null, text => deltas.push(text));
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].text, 'What is the result?'); assert.equal('files' in s.sent[0], false);
  assert.deepEqual(deltas.slice(0, 2), ['', 'Partial']); assert.equal(deltas.at(-1), answer);
  const session = s.sessions.get('paper'); assert.equal(session.messages.length, 2); assert(session.messages.every(m => m.status === 'complete'));
  assert.equal(session.messages[1].model, 'real-web-model'); assert.equal(session.webConversation.path, '/c/owned');
  assert.equal(session.webConversation.lastAssistantID, 'answer-1'); assert.equal(session.webPending, undefined);
  assert.equal(s.summaries.length, 1); assert.equal(s.saves, 2); assert.equal(s.service.busy, false);
});

test('explicitly selected text and PDF are submitted together only when the user asks a question', async () => {
  const s = setup(), context = { id: 'pdf', title: 'Selected paper', text: 'Selected excerpt', label: 'Selected range', file: 'data:application/pdf;base64,QQ==' };
  let prepared = 0; s.io.prepare = async () => { prepared++; return { evidence: { text: 'Chosen primary evidence', label: 'page 1', references: [{ paperID: 1, page: 1 }] }, readingScope: { label: 'Selected material', warnings: [] } }; };
  assert.equal(prepared, 0); assert.equal(s.sent.length, 0);
  await s.service.ask(s.win, 'paper', 'Explain', context);
  assert.equal(prepared, 1); assert.match(s.sent[0].text, /Selected excerpt/); assert.match(s.sent[0].text, /Chosen primary evidence/);
  assert.equal(s.sent[0].files.length, 1); assert.equal(s.sent[0].files[0].dataURL, context.file);
  const answer = s.sessions.get('paper').messages[1]; assert.equal(answer.references[0].page, 1); assert.equal(answer.readingScope.label, 'Selected material');
});

test('the same confirmed material is not uploaded again in its bound continuous conversation', async () => {
  const s = setup(), context = { id: 'pdf', title: 'Selected paper', text: 'Full original text', file: 'data:application/pdf;base64,QQ==' };
  await s.service.ask(s.win, 'paper', 'First question', context); await s.service.ask(s.win, 'paper', 'Follow-up question', context);
  assert.equal(s.sent[0].files.length, 1); assert.equal('files' in s.sent[1], false); assert.doesNotMatch(s.sent[1].text, /Full original text/);
  assert.match(s.sent[1].text, /此前已提供的材料/);
  await s.service.ask(s.win, 'paper', 'Changed excerpt', { ...context, text: 'New original text' });
  assert.equal(s.sent[2].files.length, 1); assert.match(s.sent[2].text, /New original text/);
});

test('reading preparation stays inside the synchronous busy lifetime and cancellation prevents any upload or Send', async () => {
  const s = setup(), entered = deferred(), finished = deferred(); let signal;
  s.io.prepare = async (_key, _prompt, _context, _session, _options, value) => { signal = value; entered.resolve(); await finished.promise; return {}; };
  const pending = s.service.ask(s.win, 'paper', 'Explain', { id: 'pdf', file: 'data:application/pdf;base64,QQ==' }); await entered.promise;
  assert.equal(s.service.busy, true); s.service.stop(); assert.equal(signal.aborted, true); finished.resolve();
  await assert.rejects(pending, /停止/); assert.equal(s.sent.length, 0); assert.equal(s.sessions.get('paper').messages.length, 0);
});

test('selected paper IDs, materials and smart reading are snapshotted before asynchronous work', async () => {
  const s = setup(), gate = deferred(), context = { id: 'screenshots', text: 'original', images: ['original-image'] }, ids = [2]; let snapshot;
  s.state.settings.smartReading = true; s.io.session = async () => { await gate.promise; return { messages: [] }; };
  s.io.prepare = async (_key, _prompt, material, _session, options) => { snapshot = { material, options }; return {}; };
  const pending = s.service.ask(s.win, 'paper', 'q', context, null, { ids });
  context.text = 'changed'; context.images.push('later-image'); ids.push(3); s.state.settings.smartReading = false; gate.resolve(); await pending;
  assert.equal(snapshot.material.text, 'original'); assert.deepEqual(snapshot.material.images, ['original-image']);
  assert.deepEqual(snapshot.options.ids, [2]); assert.equal(snapshot.options.smartReading, true);
});

test('a website conversation changed during reading preparation is never submitted into', async () => {
  const s = setup(); s.io.prepare = async () => { s.setPage({ conversation: '/c/other', userCount: 1 }); return {}; };
  await assert.rejects(s.service.ask(s.win, 'paper', 'q'), /其他对话|发生了变化/); assert.equal(s.sent.length, 0);
});

test('unrelated website conversations, existing drafts, attachments, login and busy pages fail before local mutation', async () => {
  for (const [page, error] of [
    [{ conversation: '/c/other', userCount: 1 }, /其他对话/], [{ draft: 'unsent website draft' }, /草稿/],
    [{ attachments: true }, /附件/], [{ composer: false }, /登录/], [{ streaming: true }, /正在回答/],
    [{ blocked: 'verification required' }, /verification/], [{ userCount: undefined }, /结构/]
  ]) {
    const s = setup(); s.setPage(page); await assert.rejects(s.service.ask(s.win, 'paper', 'q'), error);
    assert.equal(s.sent.length, 0); assert.equal(s.sessions.get('paper').messages.length, 0); assert.equal(s.service.busy, false);
  }
});

test('continuous questions use the bound website chat while a different paper cannot inherit it', async () => {
  const s = setup(); await s.service.ask(s.win, 'one', 'First'); await s.service.ask(s.win, 'one', 'Follow-up');
  assert.equal(s.sent.length, 2); assert.equal(s.sent[1].expectedConversation, '/c/owned');
  assert.equal(s.sessions.get('one').webConversation.userCount, 2);
  await assert.rejects(s.service.ask(s.win, 'two', 'Different paper'), /其他对话/); assert.equal(s.sent.length, 2);
  s.setPage({ lastAssistantID: 'manually-replaced-answer' });
  await assert.rejects(s.service.ask(s.win, 'one', 'Must not cross'), /另一段对话/); assert.equal(s.sent.length, 2);
});

test('old local API conversation is never presented as website memory or automatically uploaded', async () => {
  const s = setup(), session = await s.io.session('one'); session.messages.push({ role: 'assistant', text: 'old API answer', status: 'complete' });
  await assert.rejects(s.service.ask(s.win, 'one', 'Follow-up'), /旧对话自动上传/); assert.equal(s.sent.length, 0);
});

test('busy, cancellation and draining cover a slow initial session load', async () => {
  const s = setup(), loaded = deferred(); s.io.session = () => loaded.promise;
  const pending = s.service.ask(s.win, 'one', 'q'); assert.equal(s.service.busy, true);
  await assert.rejects(s.service.ask(s.win, 'one', 'duplicate'), /等待/);
  s.service.stop(s.win); let drained = false; const draining = s.service.drain().then(() => { drained = true; });
  await new Promise(setImmediate); assert.equal(drained, false); loaded.resolve({ messages: [] });
  await assert.rejects(pending, /停止/); await draining; assert.equal(s.sent.length, 0); assert.equal(s.service.completion, null);
});

test('a lost submit acknowledgement is resolved by identity lookup without a second Send', async () => {
  const s = setup(); s.io.submit = async (_win, data) => { s.sent.push(data); throw Error('lost acknowledgement'); };
  assert.equal(await s.service.ask(s.win, 'one', 'q'), 'A **complete** answer.');
  assert.equal(s.sent.length, 1); assert.equal(s.sessions.get('one').webPending, undefined);
});

test('uncertain submission is persisted and cannot be retried implicitly, including after service recreation', async () => {
  const s = setup(); s.io.snapshot = async (_win, requestID) => ({ requestID, state: 'uncertain', submitted: true, error: 'page replaced', conversation: '/c/owned' });
  await assert.rejects(s.service.ask(s.win, 'one', 'q'), error => error.code === 'WEB_SUBMISSION_UNCERTAIN' && error.webSubmitted);
  const session = s.sessions.get('one'); assert(session.webPending); assert.equal(session.messages[1].status, 'failed'); assert.equal(s.sent.length, 1);
  const restarted = new WebChat(s.io); await assert.rejects(restarted.ask(s.win, 'one', 'q'), error => /上次网页提交/.test(error.message) && !error.webSubmitted);
  assert.equal(s.sent.length, 1); assert.equal(session.messages.length, 2); assert.equal(s.summaries.length, 0);
});

test('definite pre-submit failure preserves a retryable local question and does not lock the website session', async () => {
  const s = setup(); s.io.submit = async (_win, data) => ({ requestID: data.requestID, state: 'failed', submitted: false, text: '', error: 'Send unavailable', conversation: '/' });
  await assert.rejects(s.service.ask(s.win, 'one', 'q'), error => /Send unavailable/.test(error.message) && !error.webSubmitted);
  const session = s.sessions.get('one'); assert.equal(session.webPending, undefined); assert.equal(session.webConversation, undefined); assert.equal(session.messages[1].status, 'failed');
  assert.equal(s.stopped.length,0,'an authoritative unsent failure must not query Stop for a nonexistent actor request');
});

function missingSourceAdapter() {
  const bridge = new WebView({ settings: {}, emit() {} }, { sourceCheck() { const error = new Error('插件安装文件已丢失，请重新安装并重启。'); error.code = 'WEB_BRIDGE_INSTALLATION_MISSING'; throw error; } });
  let dispatched = 0; bridge.actor = () => { dispatched++; throw Error('Missing source must not reach an actor'); };
  return { bridge, get dispatched() { return dispatched; } };
}

test('source loss before submit is a definite unsent failure without a pending lock or status lookup', async () => {
  const s = setup(), denied = missingSourceAdapter(); let snapshots = 0;
  s.io.submit = (win, data) => denied.bridge.query(win, 'submit', data);
  s.io.snapshot = async () => { snapshots++; throw Error('An undispatched submit must not need reconciliation'); };
  await assert.rejects(s.service.ask(s.win, 'paper', 'Original local question'), error => error.code === 'WEB_BRIDGE_INSTALLATION_MISSING' && error.webSubmitted === false);
  const session = s.sessions.get('paper');
  assert.equal(session.webPending, undefined); assert.equal(session.webStaged, undefined); assert.equal(session.messages[1].webUncertain, false);
  assert.equal(session.messages[0].text, 'Original local question'); assert.equal(session.messages[1].status, 'failed');
  assert.equal(s.service.busy, false); assert.equal(s.service.statuses.get('paper').state, 'failed'); assert.equal(snapshots, 0); assert.equal(s.stopped.length, 0); assert.equal(denied.dispatched, 0);
});

test('source loss while reading an already submitted request never clears its uncertainty lock', async () => {
  const s = setup(), denied = missingSourceAdapter();
  s.io.snapshot = (win, requestID) => denied.bridge.query(win, 'request-status', { requestID });
  await assert.rejects(s.service.ask(s.win, 'paper', 'Already submitted'), error => error.code === 'WEB_BRIDGE_INSTALLATION_MISSING' && error.webSubmitted === true);
  const session = s.sessions.get('paper'); assert(session.webPending); assert.equal(session.messages[1].webUncertain, true);
  assert.equal(s.sent.length, 1); assert.equal(s.stopped.length, 1); assert.equal(denied.dispatched, 0); assert.equal(s.service.busy, false);
});

test('a lost submit receipt followed by a local source failure remains uncertain rather than becoming unsent', async () => {
  const s = setup(), denied = missingSourceAdapter();
  s.io.submit = async (_win, data) => { s.sent.push(data); throw Error('Receipt lost after dispatch'); };
  s.io.snapshot = (win, requestID) => denied.bridge.query(win, 'request-status', { requestID });
  await assert.rejects(s.service.ask(s.win, 'paper', 'One attempted website send'), error => error.webSubmitted === true);
  assert(s.sessions.get('paper').webPending); assert.equal(s.sessions.get('paper').messages[1].webUncertain, true); assert.equal(s.sent.length, 1); assert.equal(s.service.busy, false);
});

test('source loss before an explicit stage retry restores the original unsent stage without a new pending lock', async () => {
  const s = setup(), denied = missingSourceAdapter();
  s.io.submit = async (_win, data) => ({ requestID: data.requestID, state: 'failed', submitted: false, retryable: true, error: 'Send unavailable', conversation: '/' });
  await assert.rejects(s.service.ask(s.win, 'paper', 'Original staged question'), /Send unavailable/);
  const session = s.sessions.get('paper'), original = session.webStaged; let snapshots = 0;
  s.io.retry = (win, data) => denied.bridge.query(win, 'retry-staged', data);
  s.io.snapshot = async () => { snapshots++; throw Error('An undispatched retry must not need reconciliation'); };
  await assert.rejects(s.service.recover(s.win, 'paper', { retry: true }), error => error.code === 'WEB_BRIDGE_INSTALLATION_MISSING' && error.webSubmitted === false);
  assert.equal(session.webStaged, original); assert.equal(session.webPending, undefined); assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0].text, 'Original staged question'); assert.equal(session.messages[1].status, 'failed'); assert.equal(session.messages[1].webUncertain, false);
  assert.equal(s.service.statuses.get('paper').state, 'staged'); assert.equal(s.service.busy, false); assert.equal(s.stopped.length, 0); assert.equal(snapshots, 0); assert.equal(denied.dispatched, 0);
});

test('source failure after a dispatched stage retry keeps its pending identity', async () => {
  const s = setup(), denied = missingSourceAdapter();
  s.io.submit = async (_win, data) => ({ requestID: data.requestID, state: 'failed', submitted: false, retryable: true, error: 'Send unavailable', conversation: '/' });
  await assert.rejects(s.service.ask(s.win, 'paper', 'Staged before later dispatch'), /Send unavailable/);
  let retries = 0;
  s.io.retry = async (_win, data) => { retries++; return { requestID: data.requestID, state: 'submitted', submitted: true, conversation: '/c/owned', userID: 'owned-user' }; };
  s.io.snapshot = (win, requestID) => denied.bridge.query(win, 'request-status', { requestID });
  await assert.rejects(s.service.recover(s.win, 'paper', { retry: true }), error => error.webSubmitted === true);
  const session = s.sessions.get('paper'); assert(session.webPending); assert.equal(session.webStaged, undefined); assert.equal(session.messages[1].webUncertain, true);
  assert.equal(retries, 1); assert.equal(s.stopped.length, 1); assert.equal(s.service.busy, false);
});

test('partial cancellation calls owned Stop once and retains text while excluding completion effects', async () => {
  const s = setup(), polling = deferred();
  s.io.snapshot = async (_win, requestID) => ({ requestID, state: 'streaming', submitted: true, text: 'Partial result', conversation: '/c/owned' });
  let delays = 0;
  s.io.delay = async (_win, _ms, signal) => {
    if (++delays === 1) return;
    polling.resolve(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  };
  const pending = s.service.ask(s.win, 'one', 'q'); await polling.promise;
  s.service.stop({}); assert.equal(s.service.controller.signal.aborted, false); s.service.stop(s.win); s.service.stop(s.win);
  await assert.rejects(pending, error => error.webSubmitted); await s.service.drain();
  assert.equal(s.stopped.length, 1); const answer = s.sessions.get('one').messages[1];
  assert.equal(answer.status, 'cancelled'); assert.equal(answer.text, 'Partial result'); assert.equal(s.summaries.length, 0); assert.equal(s.records.length, 0);
});

test('a bounded response timeout preserves the request identity without auto-resubmitting', async () => {
  const s = setup({ responseTimeout: 100 }); s.io.snapshot = async (_win, requestID) => ({ requestID, state: 'streaming', submitted: true, text: 'unfinished', conversation: '/c/owned' });
  await assert.rejects(s.service.ask(s.win, 'one', 'q'), /超时/); assert.equal(s.sent.length, 1); assert(s.sessions.get('one').webPending); assert.equal(s.stopped.length, 1);
});

test('local checkpoint failure prevents external Send and final save failure retains a completed answer', async () => {
  const before = setup(); before.io.save = async () => { throw Error('disk unavailable'); };
  await assert.rejects(before.service.ask(before.win, 'one', 'q'), /disk unavailable/); assert.equal(before.sent.length, 0);
  const after = setup(); let saves = 0; after.io.save = async () => { if (++saves === 2) throw Error('final save failed'); };
  await assert.rejects(after.service.ask(after.win, 'one', 'q'), error => error.answerComplete && /final save/.test(error.message));
  assert.equal(after.sessions.get('one').messages[1].status, 'complete'); assert.equal(after.service.busy, false);
});

test('busy remains set until the completed answer has finished local persistence', async () => {
  const s = setup(), entered = deferred(), gate = deferred(); let saves = 0;
  s.io.save = async () => { if (++saves === 2) { entered.resolve(); await gate.promise; } };
  const pending = s.service.ask(s.win, 'one', 'q'); await entered.promise;
  assert.equal(s.service.busy, true); assert.equal(s.sessions.get('one').messages[1].status, 'complete');
  gate.resolve(); await pending; assert.equal(s.service.busy, false);
});

test('provider changes and maintenance gates cannot admit a website send after a slow session load', async () => {
  for (const mutate of [s => { s.state.closing = true; }, s => { s.state.maintenance = true; }, s => { s.state.changing = true; }, s => { s.state.settings.chatProvider = 'deepseek'; }]) {
    const s = setup(), gate = deferred(); s.io.session = () => gate.promise; const pending = s.service.ask(s.win, 'one', 'q');
    mutate(s); gate.resolve({ messages: [] }); await assert.rejects(pending); assert.equal(s.sent.length, 0);
  }
});

test('the adapter only prepares selected sources and manual material precedence is preserved', async () => {
  const calls = [], win = {}, api = { settings: { chatProvider: 'chatgpt-web', smartReading: true }, emit() {},
    paperFromKey: async () => ({ id: 1 }), reading: { prepare: async (...args) => { calls.push(args); return { text: 'selected source', references: [{ key: 'paper', paperID: 1, page: 2 }] }; } } };
  const web = new WebView(api); web.hasPreread = async () => false;
  const signal = new AbortController().signal, session = { messages: [] }, manual = { id: 'manual', text: 'selected excerpt' };
  await web.prepare('paper', 'q', manual, session, { webWindow: win, ids: [], smartReading: true }, signal); assert.equal(calls.length, 0);
  await web.prepare('paper', 'q', manual, session, { webWindow: win, ids: [2], smartReading: true, includePrimary: true }, signal);
  assert.deepEqual(calls[0][2].ids, [2]); assert.equal(calls[0][2].includePrimary, true); assert.equal(calls[0][2].first, false); assert.equal(calls[0][2].signal, signal);
  await web.prepare('paper', 'q', null, session, { webWindow: win, ids: [], smartReading: false }, signal); assert.equal(calls.length, 1);
});

test('webpage readiness waits for loading without filling, attaching or sending anything', async () => {
  const win = {}, events = [], web = new WebView({ settings: {}, emit: (...args) => events.push(args) });
  web.views.set(win, { opened: true, browser: {} }); let checks = 0, delays = 0;
  web.query = async (_win, action) => { assert.equal(action, 'status'); return ++checks < 3 ? { composer: false, readyState: 'loading' } : { composer: true, conversation: '/' }; };
  web.delay = async () => { delays++; };
  assert.equal((await web.ready(win)).composer, true); assert.equal(checks, 3); assert.equal(delays, 2); assert(events.every(([type]) => type === 'webStatus'));
});

test('a composer in initial HTML does not admit input before document loading has finished', async () => {
  let now = 0, checks = 0; const delays = [], win = {}, controller = new AbortController();
  const web = new WebView({ settings: {}, emit() {} }, { now: () => now });
  web.views.set(win, { opened: true, browser: {} });
  web.query = async (_win, action, _data, options) => {
    assert.equal(action, 'status'); assert.equal(options.signal, controller.signal);
    return { composer: true, conversation: '/', readyState: ++checks < 3 ? 'loading' : 'interactive' };
  };
  web.delay = async ms => { delays.push(ms); now += ms; };
  const status = await web.ready(win, controller.signal);
  assert.equal(status.readyState, 'interactive'); assert.equal(checks, 3); assert.deepEqual(delays, [350, 350]);
});

test('loading documents still report explicit verification blocks or active streaming without delaying interaction', async () => {
  for (const extra of [{ blocked: '请完成网页验证。' }, { streaming: true }]) {
    const win = {}, web = new WebView({ settings: {}, emit() {} });
    web.views.set(win, { opened: true, browser: {} });
    const expected = { composer: true, readyState: 'loading', ...extra };
    web.query = async () => expected; web.delay = async () => { throw Error('An explicit interaction state must not wait for loading'); };
    assert.equal(await web.ready(win), expected);
  }
});

test('login, verification and redirected authentication pages immediately request visible interaction', async () => {
  const win = {}, web = new WebView({ settings: {}, emit() {} }); web.views.set(win, { opened: true, browser: { currentURI: { scheme: 'https', host: 'auth.openai.com' } } });
  web.delay = async () => { throw Error('No wait expected'); };
  web.query = async () => ({ composer: false, blocked: '请在网页登录' }); assert.equal((await web.ready(win)).blocked, '请在网页登录');
  web.query = async () => { throw Error('登录重定向'); }; await assert.rejects(web.ready(win), error => error.webNeedsInteraction && /重定向/.test(error.message));
});

test('readiness can be cancelled before any paper extraction or Send', async () => {
  const win = {}, controller = new AbortController(), web = new WebView({ settings: {}, emit() {} }); web.views.set(win, { opened: true, browser: {} });
  web.query = async () => ({ composer: false, readyState: 'loading' }); web.delay = async () => { controller.abort(); };
  await assert.rejects(web.ready(win, controller.signal), /停止/);
});

async function withWebTimers(run) {
  const oldCc = global.Cc, oldCi = global.Ci, timers = []; let now = 0;
  global.Ci = { nsITimer: { TYPE_ONE_SHOT: 0 } };
  global.Cc = { '@mozilla.org/timer;1': { createInstance() {
    const timer = { initWithCallback(callback, ms) { this.callback = callback; this.ms = ms; this.due = now + ms; }, cancel() { this.cancelled = true; } };
    timers.push(timer); return timer;
  } } };
  const clock = { timers, now: () => now, async next() {
    const timer = timers.filter(timer => !timer.cancelled && !timer.fired && timer.callback).sort((a, b) => a.due - b.due)[0];
    assert(timer, 'a scheduled native timer must exist'); now = timer.due; timer.fired = true; timer.callback(); await new Promise(setImmediate); return timer;
  } };
  try { await run(clock); } finally { global.Cc = oldCc; global.Ci = oldCi; }
}

test('Stop interrupts a pending readiness IPC immediately and a late reply cannot resume Send', async () => {
  await withWebTimers(async clock => {
    const s = setup(), response = deferred(), web = new WebView({ settings: {}, emit() {} }, { now: clock.now, sourceCheck() {} });
    web.views.set(s.win, { opened: true, browser: {} }); let calls = 0;
    web.actor = () => ({ sendQuery(action) { assert.equal(action, 'status'); calls++; return response.promise; } });
    s.io.inspect = (win, signal) => web.ready(win, signal);
    const pending = s.service.ask(s.win, 'paper', 'Keep my question');
    const rejected = assert.rejects(pending, error => /停止/.test(error.message) && !error.webSubmitted);
    await new Promise(setImmediate); assert.equal(calls, 1); assert.equal(s.service.busy, true);
    s.service.stop(s.win); await rejected;
    assert.equal(clock.now(), 0, 'Stop must not wait for the 15-second actor timeout');
    assert.equal(s.service.busy, false); assert.equal(s.sent.length, 0); assert.equal(s.sessions.get('paper').messages.length, 0);
    assert(clock.timers.every(timer => timer.cancelled));
    const eventCount = s.events.length;
    response.resolve({ composer: true, conversation: '/', userCount: 0 }); await new Promise(setImmediate);
    assert.equal(calls, 1); assert.equal(s.sent.length, 0); assert.equal(s.events.length, eventCount); assert.equal(s.service.busy, false);
  });
});

test('Stop remains immediate while awaiting the next IPC after discovering a still-loading composer', async () => {
  await withWebTimers(async clock => {
    const s = setup(), late = deferred(), web = new WebView({ settings: {}, emit() {} }, { now: clock.now, sourceCheck() {} });
    web.views.set(s.win, { opened: true, browser: {} }); let checks = 0;
    web.actor = () => ({ sendQuery(action) { assert.equal(action, 'status'); return ++checks === 1 ? Promise.resolve({ composer: true, readyState: 'loading' }) : late.promise; } });
    s.io.inspect = (win, signal) => web.ready(win, signal);
    const pending = s.service.ask(s.win, 'paper', 'Wait for the actual website input handlers');
    const rejected = assert.rejects(pending, error => /停止/.test(error.message) && !error.webSubmitted);
    await new Promise(setImmediate); assert.equal(checks, 1); assert.equal(s.service.busy, true);
    assert.equal((await clock.next()).ms, 350); assert.equal(checks, 2);
    s.service.stop(s.win); await rejected;
    assert.equal(clock.now(), 350); assert.equal(s.service.busy, false); assert.equal(s.sent.length, 0); assert.equal(s.sessions.get('paper').messages.length, 0);
    late.resolve({ composer: true, readyState: 'interactive' }); await new Promise(setImmediate);
    assert.equal(checks, 2); assert.equal(s.sent.length, 0); assert(clock.timers.every(timer => timer.cancelled || timer.fired));
  });
});

test('readiness bounds each IPC and delay by the remaining 30-second cold-start deadline', async () => {
  await withWebTimers(async clock => {
    const win = {}, events = [], web = new WebView({ settings: {}, emit: (...args) => events.push(args) }, { now: clock.now, sourceCheck() {} });
    web.views.set(win, { opened: true, browser: {} }); let calls = 0;
    web.actor = () => ({ sendQuery(action) { assert.equal(action, 'status'); calls++; return new Promise(() => {}); } });
    const pending = web.ready(win);
    const rejected = assert.rejects(pending, error => error.webNeedsInteraction && /未及时确认/.test(error.message));
    assert.equal((await clock.next()).ms, 15000);
    assert.equal((await clock.next()).ms, 350);
    assert.equal((await clock.next()).ms, 14650);
    await rejected;
    assert.equal(clock.now(), 30000); assert.equal(calls, 2); assert.equal(events.length, 1);
    assert(clock.timers.every(timer => timer.cancelled || timer.fired));
  });
});

test('a readiness response delivered at the overall deadline is not treated as a successful connection', async () => {
  let now = 0;
  const win = {}, web = new WebView({ settings: {}, emit() {} }, { now: () => now });
  web.views.set(win, { opened: true, browser: {} });
  web.query = async (_win, action, _data, options) => { assert.equal(action, 'status'); assert.equal(options.timeoutMs, 15000); now = 30000; return { composer: true }; };
  await assert.rejects(web.ready(win), error => error.webNeedsInteraction && /尚未准备好/.test(error.message));
});

test('cancellation options never abandon submit or other write acknowledgements', async () => {
  await withWebTimers(async clock => {
    for (const action of ['submit', 'retry-staged', 'stop', 'fill', 'attach']) {
      const response = deferred(), controller = new AbortController(), web = new WebView({ settings: {}, emit() {} }, { sourceCheck() {} });
      web.actor = () => ({ sendQuery(name) { assert.equal(name, action); return response.promise; } });
      let settled = false; const pending = web.query({}, action, {}, { signal: controller.signal, timeoutMs: 1 }).then(value => { settled = true; return value; });
      controller.abort(); await new Promise(setImmediate); assert.equal(settled, false); assert.equal(clock.timers.at(-1).ms, 15000);
      const receipt = { submitted: true }; response.resolve(receipt); assert.equal(await pending, receipt); assert.equal(clock.timers.at(-1).cancelled, true);
    }
  });
});

test('native network and certificate failures are reported immediately before generic login handling', async () => {
  for (const [url, expected] of [['about:neterror?e=connectionFailure', /网页连接失败/], ['about:certerror?e=nssBadCert', /证书校验失败/]]) {
    const win = {}, web = new WebView({ settings: {}, emit() {} }, { sourceCheck() {} });
    web.views.set(win, { opened: true, browser: { currentURI: { scheme: 'about', spec: url }, browsingContext: { currentWindowGlobal: { documentURI: { spec: url } } } } });
    web.delay = async () => { throw Error('Must not wait on a failed browser document'); };
    await assert.rejects(web.ready(win), error => error.webNeedsInteraction && expected.test(error.message));
  }
  const win = {}, web = new WebView({ settings: {}, emit() {} }, { sourceCheck() {} });
  web.views.set(win, { opened: true, browser: { currentURI: { scheme: 'https', host: 'auth.openai.com' } } });
  await assert.rejects(web.ready(win), error => error.webNeedsInteraction && /登录或验证/.test(error.message));
});

test('closing a panel cannot discard the actor query timeout or leave shutdown draining forever', async () => {
  const oldCc = global.Cc, oldCi = global.Ci, timers = [];
  global.Ci = { nsITimer: { TYPE_ONE_SHOT: 0 } };
  global.Cc = { '@mozilla.org/timer;1': { createInstance() { const timer = { initWithCallback(callback) { this.callback = callback; }, cancel() { this.cancelled = true; } }; timers.push(timer); return timer; } } };
  try {
    const web = new WebView({ settings: {}, emit() {} }, { sourceCheck() {} }); web.actor = () => ({ sendQuery: () => new Promise(() => {}) });
    const pending = web.query({ closed: true, setTimeout() { throw Error('Must not depend on window timer'); } }, 'status', {});
    timers[0].callback(); await assert.rejects(pending, /未及时确认/); assert.equal(timers[0].cancelled, true);
  } finally { global.Cc = oldCc; global.Ci = oldCi; }
});

test('the website actor uses the same versioned resource graph as the plugin UI', () => {
  const oldChrome = global.ChromeUtils; let registration;
  global.ChromeUtils = { registerWindowActor(name, options) { registration = { name, options }; } };
  try {
    new WebView({ settings: {}, resourceURL: name => 'chrome://paper-companion-ui-new-version/content/' + name }).init();
    assert.equal(registration.name, 'PaperCompanionWeb');
    assert.equal(registration.options.child.esModuleURI, 'chrome://paper-companion-ui-new-version/content/WebBridgeChild.sys.mjs');
    assert.deepEqual(registration.options.matches, ['https://chatgpt.com/*']); assert.equal(registration.options.allFrames, false);
  } finally { global.ChromeUtils = oldChrome; }
});

test('explicit webpage preread uses the verified background chat rather than leaving an unseen draft',async()=>{
  const win={},paper={id:7,key:'paper-key',title:'Selected paper'},events=[],calls=[];
  const web=new WebView({settings:{},chatBusy:false,emit:(...args)=>events.push(args),reading:{load:async id=>{assert.equal(id,7);return {data:{fingerprint:'fp',pages:[{page:1,text:'PAGE_ONE'},{page:2,text:'PAGE_TWO'}]}};}}});
  const view={opened:true};web.views.set(win,view);web.ask=async(...args)=>{calls.push(args);args[4]();return 'Verified outline';};
  assert.equal(await web.preread(win,paper),true);assert.equal(calls.length,1);
  assert.equal(calls[0][1],paper.key);assert(calls[0][3].text.includes('PAGE_ONE')&&calls[0][3].text.includes('PAGE_TWO'));
  assert.equal(calls[0][5].includePrimary,false);assert.equal(view.preread.fingerprint,'fp');assert.equal(events[0][0],'webReplyDelta');
});

test('cancellation during submit consumes the actual receipt before deciding whether retry is safe', async () => {
  for (const outcome of ['submitted','unsent','lost']) {
    const s = setup(), entered = deferred(), gate = deferred();
    s.io.submit = async (_win, data) => { s.sent.push(data); entered.resolve(); await gate.promise; if (outcome === 'lost') throw Error('lost receipt'); return {requestID:data.requestID,state:outcome==='unsent'?'failed':'submitted',submitted:outcome!=='unsent',conversation:'/c/owned',userID:'owned-user'}; };
    s.io.stop = async (_win, requestID) => ({requestID,state:outcome==='unsent'?'failed':'uncertain',submitted:outcome!=='unsent',cancelled:true,conversation:'/c/owned',userID:'owned-user'});
    s.io.snapshot = async (_win, requestID) => ({requestID,state:'uncertain',submitted:true,conversation:'/c/owned'});
    const pending = s.service.ask(s.win,'paper','original'); await entered.promise; s.service.stop(s.win); gate.resolve();
    await assert.rejects(pending, error => error.webSubmitted === (outcome!=='unsent'));
    assert.equal(s.sent.length,1); const session=s.sessions.get('paper'); assert.equal(!!session.webPending,outcome!=='unsent');
    assert.equal(session.messages[1].webUncertain,outcome!=='unsent');
  }
});

test('a staged failure exposes only an explicit original retry and keeps the original local message pair', async () => {
  const s=setup();s.io.submit=async(_win,data)=>{s.sent.push(data);return{requestID:data.requestID,state:'failed',submitted:false,retryable:true,error:'Send unavailable',conversation:'/'};};
  await assert.rejects(s.service.ask(s.win,'paper','original prompt'),/Send unavailable/);
  const session=s.sessions.get('paper');assert.equal(session.webStaged.prompt,'original prompt');assert.equal(session.webPending,undefined);
  await assert.rejects(s.service.ask(s.win,'paper','new edited draft'),/继续本轮发送/);assert.equal(s.sent.length,1);
  let retries=0;s.io.retry=async(_win,data)=>{retries++;return{requestID:data.requestID,state:'submitted',submitted:true,conversation:'/c/owned',userID:'own-user'};};
  s.io.snapshot=async(_win,requestID)=>({requestID,state:'complete',submitted:true,text:'Recovered answer',conversation:'/c/owned',messageID:'own-answer',userID:'own-user'});
  s.setPage({conversation:'/c/owned',userCount:1,lastAssistantID:'own-answer'});
  const result=await s.service.recover(s.win,'paper',{retry:true});
  assert.equal(result.state,'complete');assert.equal(result.prompt,'original prompt');assert.equal(retries,1);assert.equal(s.sent.length,1);
  assert.equal(session.messages.length,2);assert.equal(session.messages[1].text,'Recovered answer');assert.equal(session.webPending,undefined);assert.equal(session.webStaged,undefined);
});

test('read-only reconciliation recovers a complete owned answer without resubmitting',async()=>{
  const s=setup();s.io.snapshot=async(_win,requestID)=>({requestID,state:'uncertain',submitted:true,conversation:'/c/owned',userID:'own-user',error:'lost response'});
  await assert.rejects(s.service.ask(s.win,'paper','original'),/lost response/);const session=s.sessions.get('paper');
  assert.equal(session.webPending.sentText,'original');assert.equal(session.webPending.userID,'own-user');
  let reads=0;s.io.recover=async(_win,data)=>{reads++;assert.equal(data.userID,'own-user');return{requestID:data.requestID,state:'complete',submitted:true,text:'Verified late reply',conversation:'/c/owned',userID:'own-user',messageID:'own-answer'};};
  s.setPage({conversation:'/c/owned',userCount:1,lastAssistantID:'own-answer'});
  const result=await s.service.recover(s.win,'paper');assert.equal(result.state,'complete');assert.equal(reads,1);assert.equal(s.sent.length,1);
  assert(session.messages.every(m=>m.status==='complete'&&m.webVerified));assert.equal(session.webPending,undefined);assert.equal(session.webConversation.uncertain,false);
});

test('an exact cancelled idle turn unlocks following questions while preserving partial status',async()=>{
  const s=setup(),session=await s.io.session('paper');session.messages=[{role:'user',text:'original',status:'cancelled',webRequestID:'old'},{role:'assistant',text:'Partial',status:'cancelled',webRequestID:'old'}];
  session.webPending={requestID:'old',prompt:'original',sentText:'original',conversation:'/c/owned',baselineUserCount:0,userID:'own-user',cancelled:true};
  s.io.recover=async()=>({requestID:'old',state:'cancelled',submitted:true,idleVerified:true,text:'Partial',conversation:'/c/owned',userID:'own-user',messageID:'partial-answer',cancelled:true});
  s.setPage({conversation:'/c/owned',userCount:1,lastAssistantID:'partial-answer'});
  assert.equal((await s.service.recover(s.win,'paper')).state,'cancelled');assert.equal(session.messages[1].status,'cancelled');assert.equal(session.messages[1].webVerified,undefined);
  await s.service.ask(s.win,'paper','followup');assert.equal(s.sent.length,1);assert.equal(s.sent[0].expectedConversation,'/c/owned');
});

test('recovery never unlocks unknown or manually advanced website turns',async()=>{
  const s=setup(),session=await s.io.session('paper');session.messages=[{role:'user',text:'original',status:'failed',webRequestID:'old'},{role:'assistant',text:'',status:'failed',webRequestID:'old'}];
  session.webPending={requestID:'old',sentText:'original',conversation:'/c/owned',baselineUserCount:0,userID:'own-user'};
  s.io.recover=async()=>({requestID:'old',state:'complete',submitted:true,text:'Answer',conversation:'/c/owned',messageID:'own-answer'});s.setPage({conversation:'/c/owned',userCount:2,lastAssistantID:'other-answer'});
  await assert.rejects(s.service.recover(s.win,'paper'),/另一段对话/);assert(session.webPending);assert.equal(session.messages[1].status,'failed');assert.equal(s.sent.length,0);
  s.io.recover=async()=>({requestID:'old',state:'uncertain',submitted:true,error:'Missing exact reload identity'});
  await assert.rejects(s.service.recover(s.win,'paper'),/Missing exact/);assert(session.webPending);assert.equal(s.sent.length,0);
});

test('web phases are scoped to a local session and reset after a new session object replaces it',()=>{
  const sessions=new Map(),oldSession={messages:[]},web=new WebView({settings:{},sessions,emit(){}});sessions.set('paper',oldSession);
  web.chat.statusSessions.set('paper',oldSession);web.chat.status('paper','uncertain',{requestID:'old'});assert.equal(web.statusFor({},'paper').state,'uncertain');
  sessions.set('paper',{messages:[]});assert.equal(web.statusFor({},'paper'),undefined);assert.equal(web.statusFor({},'other'),undefined);
});

test('explicit staged retry streams into the same pending row before the final reply arrives',async()=>{
  const s=setup();s.io.submit=async(_win,data)=>({requestID:data.requestID,state:'failed',submitted:false,retryable:true,error:'not sent',conversation:'/'});
  await assert.rejects(s.service.ask(s.win,'paper','Original question'),/not sent/);const session=s.sessions.get('paper');
  const entered=deferred(),gate=deferred();let delays=0,reads=0;
  s.io.retry=async(_win,data)=>({requestID:data.requestID,state:'submitted',submitted:true,conversation:'/c/owned'});
  s.io.snapshot=async(_win,requestID)=>++reads===1?{requestID,state:'streaming',submitted:true,text:'Visible partial',conversation:'/c/owned'}:{requestID,state:'complete',submitted:true,text:'Final answer',conversation:'/c/owned',messageID:'final'};
  s.io.delay=async()=>{if(++delays===2){entered.resolve();await gate.promise;}};
  s.setPage({conversation:'/c/owned',userCount:1,lastAssistantID:'final'});
  const retry=s.service.recover(s.win,'paper',{retry:true});await entered.promise;
  assert.equal(session.messages.length,2);assert.equal(session.messages[1].status,'pending');assert.equal(session.messages[1].text,'Visible partial');assert.equal(session.messages[1].error,undefined);
  assert(s.events.filter(([type])=>type==='webReplyDelta').length>=2);gate.resolve();await retry;assert.equal(session.messages[1].status,'complete');assert.equal(session.messages[1].text,'Final answer');
});

function resumeHistoryFixture({ kind = 'pending', baseline = 0, userCount = now => now >= 1050 ? 1 : 0, now } = {}) {
  const state = { now: 0 }, win = {}, calls = [], events = [];
  now ||= () => state.now;
  const checkpoint = { requestID: 'old-turn', conversation: '/c/owned', sentText: 'Exact saved question', baselineUserCount: baseline };
  const session = { messages: [{ role: 'user', text: checkpoint.sentText, status: 'failed', webRequestID: checkpoint.requestID }, { role: 'assistant', text: '', status: 'failed', webRequestID: checkpoint.requestID }] };
  if (kind === 'pending') session.webPending = checkpoint;
  else if (kind === 'staged') session.webStaged = checkpoint;
  else session.webConversation = { path: '/c/owned', userCount: baseline, lastAssistantID: baseline ? 'owned-answer' : '' };
  const api = { settings: { chatProvider: 'chatgpt-web', autoRecord: false }, sessions: new Map([['general', session]]), session: async () => session, saveSession: async () => {}, emit: (...args) => events.push(args) };
  const web = new WebView(api, { now, sourceCheck() {} });
  web.views.set(win, { opened: true, browser: {} });
  const status = () => ({ composer: true, readyState: 'complete', conversation: '/c/owned', userCount: userCount(now()), draft: '', attachments: false, streaming: false, lastAssistantID: 'owned-answer' });
  web.query = async (_win, action, data, options) => {
    calls.push({ action, at: now(), options });
    if (action === 'status') return status();
    assert.equal(action, 'recover', 'resume must never submit, retry, fill, attach or stop');
    if (kind === 'staged') return { requestID: data.requestID, state: 'staged', submitted: false, retryable: true };
    if (status().userCount !== baseline + 1) return { requestID: data.requestID, state: 'uncertain', submitted: true, error: 'Exact webpage identity mismatch' };
    return { requestID: data.requestID, state: 'complete', submitted: true, userID: 'owned-user', conversation: '/c/owned', messageID: 'owned-answer', text: 'Exact recovered answer' };
  };
  web.delay = async (ms, signal) => { if (signal.aborted) throw Error('已停止网页问答。'); state.now += ms; };
  return { web, win, api, state, calls, session, checkpoint, status, events };
}

test('resume waits for saved conversation history after its composer and path are already ready', async () => {
  const f = resumeHistoryFixture();
  const result = await f.web.resume(f.win, 'general');
  assert.equal(result.state, 'complete'); assert.equal(f.calls.find(call => call.action === 'recover').at, 1050);
  assert.equal(f.session.messages[1].text, 'Exact recovered answer'); assert.equal(f.web.busy, false);
  assert(f.calls.every(call => ['status', 'recover'].includes(call.action)));
});

test('resume history gate uses staged baseline and complete binding count, including empty saved conversations', async () => {
  for (const kind of ['staged', 'binding']) {
    const f = resumeHistoryFixture({ kind, baseline: 2, userCount: now => now >= 700 ? 2 : 0 });
    const result = await f.web.resume(f.win, 'general');
    assert.equal(result.state, kind === 'staged' ? 'staged' : 'ready'); assert.equal(f.state.now, 700);
    assert.equal(f.calls.some(call => call.action === 'recover'), kind === 'staged'); assert.equal(f.web.busy, false);
  }
  const empty = resumeHistoryFixture({ kind: 'binding', baseline: 0, userCount: () => 0 });
  assert.equal((await empty.web.resume(empty.win, 'general')).state, 'ready'); assert.equal(empty.state.now, 0);
});

test('resume passes extra users or invalid baselines to strict identity checks without waiting or resubmitting', async () => {
  const extra = resumeHistoryFixture({ userCount: () => 2 });
  await assert.rejects(extra.web.resume(extra.win, 'general'), /identity mismatch/); assert.equal(extra.state.now, 0);
  assert.equal(extra.calls.filter(call => call.action === 'recover').length, 1); assert(extra.session.webPending);
  for (const baseline of [undefined, -1, '0', Number.MAX_SAFE_INTEGER]) {
    const f = resumeHistoryFixture({ baseline, userCount: () => 0 });
    if (baseline === undefined) delete f.checkpoint.baselineUserCount;
    await assert.rejects(f.web.resume(f.win, 'general')); assert.equal(f.state.now, 0); assert(f.session.webPending);
  }
});

test('resume history waiting stops on explicit login and installation errors without dropping the checkpoint', async () => {
  for (const mode of ['login', 'source']) {
    const f = resumeHistoryFixture(), original = f.web.query; let statuses = 0;
    f.web.query = async (...args) => {
      if (args[1] === 'status' && ++statuses > 1) {
        if (mode === 'source') throw Object.assign(Error('请重新安装插件并重启 Zotero。'), { code: 'WEB_BRIDGE_INSTALLATION_MISSING' });
        return { ...f.status(), blocked: '请先在网页登录。' };
      }
      return original(...args);
    };
    await assert.rejects(f.web.resume(f.win, 'general'), error => mode === 'source' ? error.code === 'WEB_BRIDGE_INSTALLATION_MISSING' : /登录/.test(error.message));
    assert.equal(f.state.now, 350); assert(f.session.webPending); assert.equal(f.web.busy, false);
    assert.equal(f.calls.some(call => call.action === 'recover'), false);
  }
});

test('resume history deadline bounds both delay and a hanging status RPC to fifteen seconds', async () => {
  await withWebTimers(async clock => {
    const f = resumeHistoryFixture({ now: clock.now, userCount: () => 0 }); let statuses = 0;
    f.web.query = WebView.prototype.query.bind(f.web); f.web.delay = WebView.prototype.delay.bind(f.web);
    f.web.actor = () => ({ sendQuery(action) { f.calls.push({ action, at: clock.now() }); assert.equal(action, 'status'); return ++statuses === 1 ? Promise.resolve(f.status()) : new Promise(() => {}); } });
    const pending = f.web.resume(f.win, 'general'); const rejected = assert.rejects(pending, /历史|未及时确认/);
    await new Promise(setImmediate); assert.equal((await clock.next()).ms, 350);
    assert.equal((await clock.next()).ms, 14650); await rejected;
    assert.equal(clock.now(), 15000); assert.equal(statuses, 2); assert.equal(f.web.busy, false); assert(f.session.webPending);
    assert(clock.timers.every(timer => timer.cancelled || timer.fired));
  });
});

test('resume history polling clips its final delay and rejects a hydrated response arriving at the deadline', async () => {
  const f = resumeHistoryFixture({ userCount: () => 0 }), delays = [], original = f.web.delay;
  f.web.delay = async (...args) => { delays.push(args[0]); return original(...args); };
  await assert.rejects(f.web.resume(f.win, 'general'), /历史尚未加载完成/);
  assert.equal(f.state.now, 15000); assert.equal(delays.at(-1), 300); assert(delays.every(ms => ms <= 350));
  for (const call of f.calls.filter(call => call.action === 'status').slice(1)) assert.equal(call.options.timeoutMs, 15000 - call.at);
  assert(f.session.webPending); assert.equal(f.web.busy, false);
  const late = resumeHistoryFixture(), query = late.web.query; let statuses = 0;
  late.web.query = async (...args) => { if (args[1] === 'status' && ++statuses > 1) { late.state.now = 15000; return { ...late.status(), userCount: 1 }; } return query(...args); };
  await assert.rejects(late.web.resume(late.win, 'general'), /历史尚未加载完成/);
  assert.equal(late.calls.some(call => call.action === 'recover'), false); assert(late.session.webPending);
});

test('resume cancellation during the history delay releases busy without starting another status or recovery', async () => {
  await withWebTimers(async clock => {
    const f = resumeHistoryFixture({ now: clock.now, userCount: () => 0 }); f.web.delay = WebView.prototype.delay.bind(f.web);
    const pending = f.web.resume(f.win, 'general'), rejected = assert.rejects(pending, /停止/);
    await new Promise(setImmediate); assert.equal(f.web.busy, true); assert.equal(f.calls.length, 1);
    f.web.stop(f.win); await rejected;
    assert.equal(clock.now(), 0); assert.equal(f.web.busy, false); assert.equal(f.calls.length, 1); assert(f.session.webPending);
    assert(clock.timers.every(timer => timer.cancelled || timer.fired));
  });
});

test('resume cancellation interrupts a pending history status RPC and ignores its late hydrated result', async () => {
  await withWebTimers(async clock => {
    const f = resumeHistoryFixture({ now: clock.now, userCount: () => 0 }), late = deferred(); let statuses = 0;
    f.web.query = WebView.prototype.query.bind(f.web); f.web.delay = WebView.prototype.delay.bind(f.web);
    f.web.actor = () => ({ sendQuery(action) { f.calls.push({ action, at: clock.now() }); assert.equal(action, 'status'); return ++statuses === 1 ? Promise.resolve(f.status()) : late.promise; } });
    const pending = f.web.resume(f.win, 'general'); const rejected = assert.rejects(pending, /停止/);
    await new Promise(setImmediate); assert.equal((await clock.next()).ms, 350); assert.equal(statuses, 2);
    f.web.stop(f.win); await rejected; assert.equal(clock.now(), 350); assert.equal(f.web.busy, false); assert(f.session.webPending);
    late.resolve({ ...f.status(), userCount: 1 }); await new Promise(setImmediate);
    assert.equal(statuses, 2); assert(f.calls.every(call => call.action === 'status')); assert(clock.timers.every(timer => timer.cancelled || timer.fired));
  });
});
