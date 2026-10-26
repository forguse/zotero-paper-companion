const { test } = require('node:test');
const assert = require('node:assert/strict');
const PCNoteInsertions = require('../addon/content/note-insertions.js');
const PCNoteReceiptUI = require('../addon/content/note-receipt-ui.js');

class Node extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.className = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.dataset = {}; this.attributes = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const turn = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; }
function fixture(options = {}) {
  const insertions = options.insertions || new PCNoteInsertions(), host = new Node(), notices = [], writes = [], flushes = [], views = [];
  const snapshot = options.snapshot || { key: 'A', text: '原笔记', ready: true };
  let flush = async () => {}, view = async () => {}, writeFailure = null;
  const document = { createElement: tag => new Node(tag) };
  const ui = new PCNoteReceiptUI({ document, insertions, current: () => snapshot,
    write(text, key) { if (writeFailure) throw writeFailure; writes.push({ text, key }); snapshot.text = text; },
    flush: async key => { flushes.push(key); await flush(key); },
    view: async range => { views.push(range); await view(range); },
    notify: (message, error) => notices.push({ message, error }) });
  return { ui, insertions, host, snapshot, notices, writes, flushes, views, document,
    flush(fn) { flush = fn; }, view(fn) { view = fn; }, writeFailure(error) { writeFailure = error; },
    status() { return host.children[0]?.children[0]; },
    button(name) { return host.children[0]?.children[1].children.find(node => node.className === 'note-receipt-' + name); } };
}

test('append synchronously updates only the owned ready paper, keeps its page and exposes local save feedback', async () => {
  const f = fixture(), hold = gate(); f.flush(() => hold.promise);
  const receipt = f.ui.append('\n新摘记', { host: f.host, ownerKey: 'A' });
  assert.equal(f.snapshot.text, '原笔记\n新摘记'); assert.equal(f.writes.length, 1);
  assert.deepEqual(f.flushes, ['A']); assert.equal(f.views.length, 0);
  assert.match(f.status().textContent, /已记入 · 保存中/);
  assert.equal(f.button('view').disabled, false); assert.equal(f.button('undo').disabled, false);
  hold.release(); assert.equal(await f.ui.whenSettled(receipt.id), true);
  assert.equal(f.status().textContent, '已记入笔记'); assert.equal(f.insertions.get(receipt.id).status, 'saved');
  f.button('view').click(); await turn();
  assert.equal(f.views.length, 1); assert.deepEqual(f.views[0], { id: receipt.id, key: 'A', from: 3, to: 7 });
});

test('empty input, wrong paper, unready draft and synchronous write failures cannot create receipts or flush', () => {
  const f = fixture(); assert.equal(f.ui.append('', { host: f.host }), null);
  assert.throws(() => f.ui.append('x', { ownerKey: 'B' }), /论文已切换/);
  f.snapshot.ready = false; assert.throws(() => f.ui.append('x'), /尚未准备好/); f.snapshot.ready = true;
  f.writeFailure(new Error('local edit failure')); assert.throws(() => f.ui.append('x'), /local edit failure/);
  assert.equal(f.insertions.size, 0); assert.equal(f.flushes.length, 0); assert.equal(f.writes.length, 0);
});

test('redrawing a message can reattach its exact receipt without appending or flushing again', async () => {
  const f=fixture(),receipt=f.ui.append('\n摘记',{host:f.host});await f.ui.whenSettled(receipt.id);
  const second=new Node();assert.equal(f.ui.show(receipt.id,second).id,receipt.id);
  assert.equal(second.children[0].children[0].textContent,'已记入笔记');assert.equal(f.writes.length,1);assert.equal(f.flushes.length,1);
  assert.equal(f.ui.show('missing',new Node()),null);f.ui.destroy();assert.equal(f.ui.show(receipt.id,new Node()),null);
});

test('failed append retries only persistence and never appends the same note again', async () => {
  const f = fixture(); f.flush(async () => { throw new Error('synthetic save failure'); });
  const receipt = f.ui.append('\n新摘记', { host: f.host });
  assert.equal(await f.ui.whenSettled(receipt.id), false);
  assert.equal(f.status().textContent, '已记入 · 保存失败'); assert.equal(f.button('retry').hidden, false);
  f.flush(async () => {}); f.button('retry').click(); await f.ui.whenSettled(receipt.id);
  assert.equal(f.snapshot.text, '原笔记\n新摘记'); assert.equal(f.writes.length, 1); assert.equal(f.flushes.length, 2);
  assert.equal(f.status().textContent, '已记入笔记'); assert.equal(f.button('retry').hidden, true);
});

test('undo keeps subsequent input, and a failed undo retries only saving the already changed draft', async () => {
  const f = fixture(), receipt = f.ui.append('\n新摘记', { host: f.host }); await f.ui.whenSettled(receipt.id);
  f.snapshot.text += '\n后续输入'; f.flush(async () => { throw new Error('synthetic undo save failure'); });
  assert.equal(await f.ui.undo(receipt.id), false);
  assert.equal(f.snapshot.text, '原笔记\n后续输入'); assert.equal(f.status().textContent, '已撤销 · 待重试保存');
  assert.equal(f.insertions.get(receipt.id).operation, 'undo'); assert.equal(f.insertions.get(receipt.id).status, 'error');
  assert.equal(f.button('undo').disabled, true); assert.equal(f.button('view').disabled, true);
  f.snapshot.text += '\n更晚输入'; f.flush(async () => {}); f.button('retry').click(); await f.ui.whenSettled(receipt.id);
  assert.equal(f.writes.length, 2); assert.equal(f.snapshot.text, '原笔记\n后续输入\n更晚输入');
  assert.equal(f.status().textContent, '已撤销'); assert.equal(f.insertions.get(receipt.id), null);
});

test('a changed prefix blocks undo and current-paper changes disable every receipt action', async () => {
  const f = fixture(), receipt = f.ui.append('\n新摘记', { host: f.host }); await f.ui.whenSettled(receipt.id);
  f.snapshot.text = '改过的原笔记\n新摘记'; f.ui.update();
  assert.equal(f.button('undo').disabled, true); assert.equal(await f.ui.undo(receipt.id), false);
  assert.equal(f.writes.length, 1); assert.match(f.notices.at(-1).message, /无法安全撤销/);
  f.snapshot.key = 'B'; f.ui.setPaper();
  assert.equal(f.button('view').disabled, true); assert.equal(f.button('undo').disabled, true); assert.equal(f.button('retry').disabled, true);
  assert.equal(await f.ui.view(receipt.id), false); assert.equal(f.views.length, 0);
});

test('late append success cannot overwrite a newer failed undo; its retry never deletes twice', async () => {
  const f = fixture(), first = gate(); let calls = 0;
  f.flush(async () => { if (++calls === 1) await first.promise; else throw new Error('newer save failed'); });
  const receipt = f.ui.append('\n新摘记', { host: f.host }), append = f.ui.whenSettled(receipt.id);
  assert.equal(await f.ui.undo(receipt.id), false); first.release(); assert.equal(await append, false);
  assert.equal(f.status().textContent, '已撤销 · 待重试保存'); assert.equal(f.insertions.get(receipt.id).operation, 'undo');
  f.flush(async () => {}); await f.ui.retry(receipt.id);
  assert.equal(f.writes.length, 2); assert.equal(f.snapshot.text, '原笔记');
});

test('late append failure cannot replace successful undo feedback or revive its forgotten receipt', async () => {
  const f = fixture(), first = gate(); let calls = 0;
  f.flush(async () => { if (++calls === 1) { await first.promise; throw new Error('stale append failed'); } });
  const receipt = f.ui.append('\n新摘记', { host: f.host }), append = f.ui.whenSettled(receipt.id);
  assert.equal(await f.ui.undo(receipt.id), true); first.release(); assert.equal(await append, false);
  assert.equal(f.status().textContent, '已撤销'); assert.equal(f.notices.length, 0); assert.equal(f.insertions.get(receipt.id), null);
});

test('showLatest restores shared receipts including an undo awaiting persistence after the original pane closes', async () => {
  const f = fixture(), receipt = f.ui.append('\n新摘记', { host: f.host }); await f.ui.whenSettled(receipt.id);
  f.flush(async () => { throw new Error('cannot save undo'); }); await f.ui.undo(receipt.id); f.ui.destroy();
  const reopened = fixture({ insertions: f.insertions, snapshot: f.snapshot });
  assert.equal(reopened.ui.showLatest(reopened.host).id, receipt.id);
  assert.equal(reopened.status().textContent, '已撤销 · 待重试保存');
  assert.equal(await reopened.ui.retry(receipt.id), true); assert.equal(reopened.writes.length, 0); assert.equal(reopened.flushes.length, 1);
  assert.equal(reopened.insertions.get(receipt.id), null);
});

test('shared receipt revisions stop a closed pane from overwriting newer retry outcome', async () => {
  const f = fixture(), hold = gate(); f.flush(async () => { await hold.promise; throw new Error('old pane failure'); });
  const receipt = f.ui.append('\n新摘记', { host: f.host }), oldTask = f.ui.whenSettled(receipt.id); f.ui.destroy();
  const reopened = fixture({ insertions: f.insertions, snapshot: f.snapshot }); reopened.ui.showLatest(reopened.host);
  await reopened.ui.undo(receipt.id); hold.release(); await oldTask;
  assert.equal(reopened.insertions.get(receipt.id), null); assert.equal(reopened.status().textContent, '已撤销');
});

test('view failures never change saved status or initiate a second persistence write', async () => {
  const f = fixture(), receipt = f.ui.append('\n新摘记', { host: f.host }); await f.ui.whenSettled(receipt.id);
  f.view(async () => { throw new Error('cannot render note'); }); assert.equal(await f.ui.view(receipt.id), false);
  assert.equal(f.flushes.length, 1); assert.equal(f.insertions.get(receipt.id).status, 'saved'); assert.equal(f.status().textContent, '已记入笔记');
  assert.match(f.notices.at(-1).message, /暂时无法定位/);
});

test('oversized receipts preserve append saving while refusing unverified later locate or undo', async () => {
  const f = fixture({ insertions: new PCNoteInsertions({ maxChars: 1 }) });
  const receipt = f.ui.append('\n新摘记', { host: f.host }); await f.ui.whenSettled(receipt.id);
  assert.equal(receipt.undoable, false); assert.equal(f.snapshot.text, '原笔记\n新摘记');
  assert.match(f.status().textContent, /未保留撤销记录/); assert.equal(f.button('undo').disabled, true); assert.equal(f.button('view').disabled, true);
  assert.equal(f.flushes.length, 1);
});

test('feedback renderer failure does not prevent flush or misclassify a committed write', async () => {
  const f = fixture(); f.host.replaceChildren = () => { throw new Error('cannot mount DOM'); };
  const receipt = f.ui.append('\n新摘记', { host: f.host }); assert.equal(await f.ui.whenSettled(receipt.id), true);
  assert.equal(f.flushes.length, 1); assert.equal(f.insertions.get(receipt.id).status, 'saved');
  assert.match(f.notices[0].message, /反馈暂时无法显示/);
});

test('destroy detaches receipt actions and never touches DOM or notifies after pending completion', async () => {
  const f = fixture(), hold = gate(); f.flush(async () => { await hold.promise; throw new Error('late failure'); });
  const receipt = f.ui.append('\n新摘记', { host: f.host }), pending = f.ui.whenSettled(receipt.id), text = f.status().textContent;
  const view = f.button('view'); f.ui.destroy(); hold.release(); await pending; view.click(); await turn();
  assert.equal(f.status().textContent, text); assert.equal(f.notices.length, 0); assert.equal(f.views.length, 0);
  assert.equal(f.insertions.get(receipt.id).status, 'error');
  assert.throws(() => f.ui.append('later', { host: f.host }), /已关闭/);
});

test('detached hosts release listeners and completed metadata without views remains bounded', async () => {
  const f = fixture(); f.host.isConnected = true;
  const receipt = f.ui.append('x', { host: f.host }); await f.ui.whenSettled(receipt.id);
  const view = f.button('view'); f.host.isConnected = false; f.ui.update(); view.click(); await turn();
  assert.equal(f.views.length, 0); assert.equal(f.ui.bindings.size, 0);
  for (let i = 0; i < 60; i++) {
    const next = f.ui.append('x'); await f.ui.whenSettled(next.id);
  }
  assert.equal(f.insertions.size, 16); assert.ok(f.ui.states.size <= 32);
});
