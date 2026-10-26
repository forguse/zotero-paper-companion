const { test } = require('node:test');
const assert = require('node:assert/strict');
const PCNoteInsertions = require('../addon/content/note-insertions.js');

test('record exposes only a frozen range receipt, never the private note prefix', () => {
  const store = new PCNoteInsertions(), before = '先前的私有笔记\n', inserted = '\n新摘记：$E=mc^2$';
  const receipt = store.record('paper-A', before, inserted);
  assert.deepEqual(Object.keys(receipt).sort(), ['from', 'id', 'key', 'operation', 'revision', 'status', 'to', 'undoable']);
  assert.equal(receipt.from, before.length); assert.equal(receipt.to, (before + inserted).length);
  assert.equal(receipt.status, 'pending'); assert.equal(receipt.undoable, true); assert.equal(Object.isFrozen(receipt), true);
  assert.equal(JSON.stringify(receipt).includes(before), false); assert.equal(JSON.stringify(store).includes(before), false);
  assert.equal(store.characters, (before + inserted).length);
  assert.deepEqual(store.locate(receipt.id, before + inserted, 'paper-A'), { id: receipt.id, key: 'paper-A', from: before.length, to: receipt.to });
});

test('undo removes only the recorded append and preserves later typing including repeated identical text', () => {
  const store = new PCNoteInsertions(), before = '重复段\n', inserted = '重复段\n';
  const receipt = store.record('A', before, inserted), current = before + inserted + inserted + '后续输入';
  assert.equal(store.canUndo(receipt.id, current, 'A'), true);
  const plan = store.prepareUndo(receipt.id, current, 'A');
  assert.equal(plan.text, before + inserted + '后续输入');
  assert.equal(plan.from, before.length); assert.equal(plan.to, (before + inserted).length);
  assert.equal(store.size, 1); assert.equal(store.get(receipt.id).status, 'pending');
});

test('changed prefix, changed insertion or moved text refuses both locate and undo without fuzzy deletion', () => {
  const store = new PCNoteInsertions(), receipt = store.record('A', 'before\n', 'inserted');
  for (const current of ['changed\ninserted', 'before\nInserted', 'before\n', 'unrelated\nbefore\ninserted', 'before\ninserted'.slice(1), 'inserted']) {
    assert.equal(store.locate(receipt.id, current, 'A'), null);
    assert.equal(store.canUndo(receipt.id, current, 'A'), false);
    assert.equal(store.prepareUndo(receipt.id, current, 'A'), null);
  }
  assert.equal(store.size, 1);
});

test('empty and Unicode notes use exact DOM offsets without inventing an empty insertion', () => {
  const store = new PCNoteInsertions(); assert.equal(store.record('A', '', ''), null); assert.equal(store.size, 0);
  const receipt = store.record('A', '', '😀 中文\n');
  assert.equal(receipt.from, 0); assert.equal(receipt.to, 6);
  assert.equal(store.prepareUndo(receipt.id, '😀 中文\n后来', 'A').text, '后来');
  assert.equal(store.prepareUndo(receipt.id, '', 'A'), null);
  const whitespace = store.record('A', '', ' ');
  assert.equal(store.prepareUndo(whitespace.id, ' ', 'A').text, '');
});

test('same text in different papers remains isolated by paper identity', () => {
  const store = new PCNoteInsertions(), a = store.record('A', '相同', '笔记'), b = store.record('B', '相同', '笔记');
  assert.notEqual(a.id, b.id);
  assert.equal(store.latest('A').id, a.id); assert.equal(store.latest('B').id, b.id); assert.equal(store.latest('missing'), null);
  assert.equal(store.canUndo(a.id, '相同笔记', 'B'), false); assert.equal(store.locate(a.id, '相同笔记', 'B'), null);
  assert.equal(store.prepareUndo(a.id, '相同笔记', 'B'), null);
  assert.equal(store.prepareUndo(b.id, '相同笔记', 'B').key, 'B');
  store.clear('A'); assert.equal(store.get(a.id), null); assert.equal(store.get(b.id).key, 'B');
});

test('entry capacity evicts the oldest receipt without changing note text or consuming newer receipts', () => {
  const store = new PCNoteInsertions({ maxEntries: 2, maxChars: 100 });
  const first = store.record('A', '', 'one'), second = store.record('A', 'one', 'two'), third = store.record('B', '', 'three');
  assert.equal(store.size, 2); assert.equal(store.characters, 11);
  assert.equal(store.prepareUndo(first.id, 'onetwo', 'A'), null);
  assert.equal(store.prepareUndo(second.id, 'onetwo', 'A').text, 'one');
  assert.equal(store.prepareUndo(third.id, 'three', 'B').text, '');
});

test('character budget evicts old guards while an individually oversized append returns only a viewing range', () => {
  const store = new PCNoteInsertions({ maxEntries: 16, maxChars: 10 });
  const first = store.record('A', 'one', 'two'), second = store.record('B', '', 'three');
  assert.equal(store.get(first.id), null); assert.equal(store.characters, 5);
  const oversized = store.record('C', 'a very long original note', 'appended');
  assert.equal(oversized.undoable, false); assert.equal(oversized.from, 25); assert.equal(oversized.to, 33);
  assert.equal(store.get(oversized.id), null); assert.equal(store.locate(oversized.id, 'a very long original noteappended', 'C'), null);
  assert.equal(store.size, 1); assert.equal(store.get(second.id).id, second.id);
  const disabled = new PCNoteInsertions({ maxEntries: 0 });
  assert.equal(disabled.record('A', '', 'one').undoable, false); assert.equal(disabled.size, 0);
});

test('save status and failed undo retries never consume or alter a receipt before successful commit', () => {
  const store = new PCNoteInsertions(), receipt = store.record('A', 'base', '\nappend');
  assert.equal(store.mark(receipt.id, 'saved').status, 'saved');
  const candidate = store.prepareUndo(receipt.id, 'base\nappendtail', 'A');
  const pending = store.mark(receipt.id, 'pending', 'undo'); store.mark(receipt.id, 'error');
  assert.equal(store.get(receipt.id).status, 'error');
  assert.equal(store.latest('A').operation, 'undo'); assert.equal(store.get(receipt.id).revision, pending.revision + 1);
  assert.deepEqual(store.prepareUndo(receipt.id, 'base\nappendtail', 'A'), candidate);
  assert.equal(store.prepareUndo(receipt.id, 'base\nappendtail-new-input', 'A').text, 'basetail-new-input');
  assert.equal(store.forget(receipt.id), true); assert.equal(store.forget(receipt.id), false);
  assert.equal(store.prepareUndo(receipt.id, 'base\nappendtail', 'A'), null); assert.equal(store.characters, 0);
});

test('clear drops session receipts and keeps identity monotonic; malformed input cannot allocate guards', () => {
  const store = new PCNoteInsertions(), first = store.record('A', '', 'text');
  store.clear(); assert.equal(store.size, 0); assert.equal(store.characters, 0);
  const later = store.record('A', '', 'text'); assert.notEqual(later.id, first.id);
  assert.equal(store.get('missing'), null); assert.equal(store.mark('missing', 'saved'), null);
  assert.equal(store.canUndo(later.id, null, 'A'), false);
  assert.throws(() => store.mark(later.id, 'committed'), /无效/);
  for (const args of [[null, '', 'text'], ['', '', 'text'], ['A', null, 'text'], ['A', '', null]]) assert.throws(() => store.record(...args), TypeError);
  for (const limits of [{ maxEntries: -1 }, { maxChars: NaN }, { maxChars: 1.5 }]) assert.throws(() => new PCNoteInsertions(limits), TypeError);
});
