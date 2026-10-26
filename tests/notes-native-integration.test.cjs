const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path').posix;
const PCore = require('../addon/content/core.js');
const { PCNoteDocument, PCNoteEditor } = require('../addon/content/note-editor.js');

function native({ receipts = true } = {}) {
  const files = new Map(), events = [], errors = [];
  const scope = { PCore, PCInsights: { defaultPrompts: {} }, Zotero: { logError: e => errors.push(e), Reader: { unregisterEventListener() {} } }, AbortController,
    PathUtils: { join: path.join }, IOUtils: { exists: async p => files.has(p), readUTF8: async p => files.get(p), writeUTF8: async (p, text) => files.set(p, text) } };
  vm.createContext(scope);
  const names = ['persistence.js', 'sessions.js', 'reading-scope.js', 'model-gateway.js', 'chat-service.js'];
  if (receipts) names.push('note-insertions.js');
  names.push('native.js');
  for (const name of names) vm.runInContext(fs.readFileSync(require.resolve('../addon/content/' + name), 'utf8'), scope);
  const api = scope.PaperCompanion;
  api.dir = '/profile/paper-companion'; api.insights = { validatePrompts: () => ({}) };
  api.emit = (type, data) => events.push({ type, data });
  return { api, scope, files, events, errors };
}

test('settings save remains successful after a committed write when selection popup rendering fails', async () => {
  const s = native(); s.api.refreshSelectionPopups = () => { throw Error('synthetic detached popup'); };
  await s.api.saveSettings({ language: 'English' });
  assert.equal(s.api.settings.language, 'English');
  assert.equal(JSON.parse(s.files.get('/profile/paper-companion/settings.json')).language, 'English');
  assert.deepEqual(s.events.map(e => e.type), ['settings', 'settingsRefreshError']);
  assert.match(s.events[1].data.message, /已保存/); assert.equal(s.errors.length, 1);
});

test('failed settings persistence retains the previous settings and never claims display-only failure', async () => {
  const s = native(), original = s.api.settings;
  s.api.writeJSON = async () => { throw Error('synthetic disk failure'); };
  let refreshed = false; s.api.refreshSelectionPopups = () => { refreshed = true; };
  await assert.rejects(s.api.saveSettings({ language: 'English' }), /disk failure/);
  assert.equal(s.api.settings, original); assert.equal(refreshed, false); assert.equal(s.events.length, 0);
});

test('native initialization leaves the optional insertion store unloaded until it is requested', () => {
  const s = native({ receipts: false });
  assert.equal(s.api._noteInsertions, undefined);
  assert.equal(s.api.settings.language, '简体中文');
});

test('the native insertion store is shared by panes and cleared after normal shutdown', async () => {
  const s = native(), first = s.api.noteInsertions, receipt = first.record('paper', 'before', '\nnew');
  assert.equal(s.api.noteInsertions, first); assert.equal(s.api.noteInsertions.get(receipt.id).key, 'paper');
  s.api.disconnect = () => {}; s.api.clearVocabularyContext = () => {};
  s.api.flushNotes = async () => {}; s.api.insights = { destroy() {} };
  await s.api.shutdown();
  assert.equal(first.size, 0); assert.equal(first.characters, 0);
});

function editorFixture(text) {
  const nodes = [], timers = new Map(); let serial = 0, renderCount = 0, focused = null;
  const container = { scrollTop: 20, clientTop: 1, clientHeight: 160,
    ownerDocument: { defaultView: { setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id) } },
    focus: options => { focused = options; }, getBoundingClientRect: () => ({ top: 100 }), children: nodes };
  const editor = { container, model: new PCNoteDocument(text), disabled: false,
    clearLocation: PCNoteEditor.prototype.clearLocation,
    render() {
      renderCount++; this.clearLocation(); nodes.length = 0;
      PCNoteDocument.blocks(this.model.text).forEach((_, index) => {
        const classes = new Set(['note-block']);
        nodes.push({ classes, classList: { contains: v => classes.has(v), add: v => classes.add(v), remove: v => classes.delete(v) },
          getBoundingClientRect: () => ({ top: 130 + index * 90 }), scrollIntoView() { throw Error('must never scroll outer frame'); } });
      });
    } };
  return { editor, nodes, timers, renderCount: () => renderCount, focused: () => focused };
}

test('receipt navigation maps Markdown offsets to the right rendered source blocks and scrolls only the editor', () => {
  const text = '# **Title**\n\nOld text\n\n### 问答摘记\n\n**new** $x_1$\n';
  const s = editorFixture(text), start = text.indexOf('### 问答摘记');
  assert.equal(PCNoteEditor.prototype.revealSourceRange.call(s.editor, start, text.length), true);
  assert.equal(s.renderCount(), 1); assert.deepEqual(s.focused(), { preventScroll: true });
  assert.equal(s.editor.container.scrollTop, 217);
  assert.deepEqual(s.nodes.map(n => n.classes.has('note-located')), [false, false, true, true]);
  assert.equal(s.editor.model.text, text); assert.equal(s.editor.model.undoStack.length, 0);
  [...s.timers.values()][0](); assert(s.nodes.every(n => !n.classes.has('note-located')));
});

test('invalid, whitespace-only and disabled receipt ranges never render or move an editor', () => {
  const text = 'before\n\n\n\nafter', s = editorFixture(text);
  for (const range of [[-1, 3], [0, text.length + 1], [2, 2], [2.5, 5], [8, 10]]) {
    assert.equal(PCNoteEditor.prototype.revealSourceRange.call(s.editor, ...range), false);
  }
  s.editor.disabled = true;
  assert.equal(PCNoteEditor.prototype.revealSourceRange.call(s.editor, 0, 3), false);
  assert.equal(s.renderCount(), 0); assert.equal(s.editor.container.scrollTop, 20); assert.equal(s.focused(), null);
});
