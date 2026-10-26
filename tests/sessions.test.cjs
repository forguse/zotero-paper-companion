const { test } = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../addon/content/sessions.js');

function setup() {
  const files = new Map(), events = [], state = { beforeRead: async () => {}, beforeWrite: async () => {}, busy: false };
  const store = new Store({
    async read(name, fallback) { await state.beforeRead(name); return files.has(name) ? JSON.parse(files.get(name)) : fallback; },
    async write(name, text) { await state.beforeWrite(name, text); files.set(name, text); },
    exists: async name => files.has(name), list: async () => [...files.keys()], basename: name => name,
    busy: () => state.busy, emit: (type, data) => events.push({ type, ...data }), safeError: message => message
  });
  return { store, files, events, state };
}
const data = text => ({ messages: [{ role: 'user', text, status: 'complete' }] });

test('a failed initial read can be retried without leaving a poisoned cached promise', async () => {
  const s = setup(); s.state.beforeRead = async () => { throw Error('read failure'); };
  await assert.rejects(s.store.load('A'), /read failure/); assert.equal(s.store.loads.size, 0);
  s.state.beforeRead = async () => {}; s.files.set('A.json', JSON.stringify(data('recovered')));
  assert.equal((await s.store.load('A')).messages[0].text, 'recovered');
});

test('a deliberate live replacement wins over a late first read', async () => {
  const s = setup(); let release, started;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  s.files.set('A.json', JSON.stringify(data('old disk'))); s.state.beforeRead = async () => { started(); await gate; };
  const pending = s.store.load('A'); await ready; const replacement = data('live'); s.store.sessions.set('A', replacement);
  release(); assert.equal(await pending, replacement); assert.equal(await s.store.load('A'), replacement);
});

test('malformed current data is reported and never replaced by an empty conversation', async () => {
  for (const raw of ['{broken', '{"messages":null}', '{"messages":[{"role":"user","text":3}]}']) {
    const s = setup(); s.files.set('A.json', raw);
    await assert.rejects(s.store.load('A')); await assert.rejects(s.store.save('A'), e => e.code === 'CHAT_SAVE_FAILED');
    assert.equal(s.files.get('A.json'), raw); assert.equal(s.store.sessions.has('A'), false);
  }
});

test('loading cancels interrupted turns while preserving material IDs and unknown compatible fields', async () => {
  const s = setup(), original = { ...data('pending'), materials: { picture: { data: 'unchanged' } }, lastContextID: 'picture', future: { version: 3 } };
  original.messages[0].status = 'pending'; s.files.set('A.json', JSON.stringify(original));
  const session = await s.store.load('A'); assert.equal(session.messages[0].status, 'cancelled');
  await s.store.save('A'); const disk = JSON.parse(s.files.get('A.json'));
  assert.equal(disk.lastContextID, 'picture'); assert.deepEqual(disk.future, { version: 3 }); assert.deepEqual(disk.materials, original.materials);
});

test('slow writes keep their original snapshot and do not block a different paper', async () => {
  const s = setup(); let release, started;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  const a = data('first'); s.store.sessions.set('A', a); s.store.sessions.set('B', data('other'));
  s.state.beforeWrite = async name => { if (name === 'A.json') { started(); await gate; } };
  const first = s.store.save('A'); await ready; a.messages[0].text = 'later mutation'; await s.store.save('B');
  assert.equal(JSON.parse(s.files.get('B.json')).messages[0].text, 'other');
  release(); await first; assert.equal(JSON.parse(s.files.get('A.json')).messages[0].text, 'first');
});

test('session and archive access reject traversal and cross-paper archive IDs', async () => {
  const s = setup(); s.files.set('B-1.json', JSON.stringify(data('private to B')));
  await assert.rejects(s.store.load('../A'), /标识无效/);
  await assert.rejects(s.store.archived('A', 'B-1.json'), /不存在/);
  await assert.rejects(s.store.readArchive('../B-1.json'), /不存在/);
});

test('normal draining waits for initial reads and pending writes and clears settled entries', async () => {
  const s = setup(); let release, started, drained = false;
  const gate = new Promise(r => release = r), ready = new Promise(r => started = r);
  s.state.beforeRead = async () => { started(); await gate; };
  const saving = s.store.save('A'); await ready;
  const closing = s.store.drain().then(() => { drained = true; }); await new Promise(setImmediate); assert.equal(drained, false);
  release(); await Promise.all([saving, closing]);
  assert(s.files.has('A.json')); assert.equal(s.store.operations.size, 0); assert.equal(s.store.loads.size, 0); assert.equal(s.store.writes.tails.size, 0);
});
