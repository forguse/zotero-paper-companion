const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../addon/content/chat-view.js'), 'utf8'), context);
const ChatView = context.PCChatView;

class Element extends EventTarget {
  constructor(document) { super(); this.ownerDocument = document; this.clientHeight = 400; this.scrollHeight = 6517; this.children = []; this.offset = 0; this.hidden = false; }
  get scrollTop() { return this.offset; }
  set scrollTop(value) { this.offset = Math.max(0, Math.min(value, Math.max(0, this.scrollHeight - this.clientHeight))); }
  getBoundingClientRect() { return { top: 100, bottom: 100 + this.clientHeight }; }
  replaceChildren(...nodes) { this.children = nodes; }
}
function fixture() {
  const timers = new Map(); let sequence = 0, refreshes = 0;
  const document = new EventTarget(), win = {
    getSelection: () => ({ isCollapsed: true }), performance: { now: () => 0 },
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id)
  };
  document.defaultView = win;
  const root = new Element(document), latest = new Element(document);
  const view = new ChatView({ root, latest, refresh: () => { refreshes++; } }); view.controls();
  return { view, root, latest, timers, refreshes: () => refreshes,
    gesture: type => root.dispatchEvent(new Event(type)),
    flush: () => { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); } };
}

for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
  test(type + ' reconciles stale follow at an unchanged history offset and exposes the actual return control', () => {
    const f = fixture(); assert.equal(f.root.scrollTop, 0); assert.equal(f.view.follow, true); assert.equal(f.latest.hidden, true);
    f.view.layoutAnchor = { bottom: true }; f.view.layoutTimer = f.view.win.setTimeout(() => { throw Error('cancelled layout ran'); });
    f.gesture(type);
    assert.equal(f.root.scrollTop, 0); assert.equal(f.view.follow, false); assert.equal(f.latest.hidden, false);
    assert.equal(f.view.layoutAnchor, null); assert.equal(f.view.layoutTimer, null); assert.equal(f.timers.size, 0); assert.equal(f.refreshes(), 0);
    f.view.destroy();
  });
}

test('gesture reconciliation preserves the existing 64px follow threshold', () => {
  const f = fixture(); f.view.follow = false;
  f.root.scrollTop = f.root.scrollHeight - f.root.clientHeight - 63; f.gesture('wheel');
  assert.equal(f.view.follow, true); assert.equal(f.latest.hidden, true);
  f.root.scrollTop = f.root.scrollHeight - f.root.clientHeight - 64; f.gesture('wheel');
  assert.equal(f.view.follow, false); assert.equal(f.latest.hidden, false); f.view.destroy();
});

test('a backreading gesture prevents subsequent resize from jumping to the end, and actual return resumes follow', () => {
  const f = fixture(); f.gesture('wheel'); f.root.clientHeight = 250; f.view.resize();
  assert.equal(f.root.scrollTop, 0); assert.equal(f.latest.hidden, false);
  f.latest.dispatchEvent(new Event('click'));
  assert.equal(f.view.follow, true); assert.equal(f.latest.hidden, true); assert.equal(f.root.scrollTop, f.root.scrollHeight - 250);
  f.root.clientHeight = 150; f.view.resize();
  assert.equal(f.root.scrollTop, f.root.scrollHeight - 150); f.view.destroy();
});

test('gesture interrupts pending bottom restoration while retaining the current history position', () => {
  const f = fixture(); f.root.scrollTop = f.root.scrollHeight; f.view.layout(() => { f.root.clientHeight = 250; });
  assert.equal(f.timers.size, 1); f.root.scrollTop = 120; f.gesture('pointerdown'); f.flush(); f.view.resize();
  assert.equal(f.root.scrollTop, 120); assert.equal(f.view.follow, false); assert.equal(f.latest.hidden, false); f.view.destroy();
});

test('hidden or closed views do not reinterpret geometry or update the return control on a gesture', () => {
  const hidden = fixture(); hidden.root.clientHeight = 0; hidden.gesture('wheel');
  assert.equal(hidden.view.follow, true); assert.equal(hidden.latest.hidden, true); hidden.view.destroy();
  const closed = fixture(); closed.view.closed = true; closed.gesture('pointerdown');
  assert.equal(closed.view.follow, true); assert.equal(closed.latest.hidden, true); closed.view.destroy();
});

test('internal layout cancellation without a user event leaves follow and controls untouched', () => {
  const f = fixture(); f.view.layoutAnchor = { bottom: true }; f.latest.hidden = false;
  f.view.interruptLayout(); assert.equal(f.view.layoutAnchor, null); assert.equal(f.view.follow, true); assert.equal(f.latest.hidden, false);
  f.view.reset('new-paper'); assert.equal(f.view.follow, true); assert.equal(f.root.children.length, 0); f.view.destroy();
});

test('ordinary scroll still updates follow while an active layout anchor suppresses incidental scroll events', () => {
  const f = fixture(); f.root.dispatchEvent(new Event('scroll')); assert.equal(f.view.follow, false); assert.equal(f.latest.hidden, false);
  f.root.scrollTop = f.root.scrollHeight; f.root.dispatchEvent(new Event('scroll')); assert.equal(f.view.follow, true); assert.equal(f.latest.hidden, true);
  f.view.layoutAnchor = { bottom: true }; f.root.scrollTop = 0; f.root.dispatchEvent(new Event('scroll')); assert.equal(f.view.follow, true);
  f.gesture('keydown'); assert.equal(f.view.follow, false); assert.equal(f.latest.hidden, false); f.view.destroy();
});

test('destroy detaches gesture and return actions without scheduling refresh or changing history', () => {
  const f = fixture(); f.view.destroy(); f.root.scrollTop = 50; f.gesture('wheel'); f.latest.dispatchEvent(new Event('click'));
  assert.equal(f.root.scrollTop, 50); assert.equal(f.view.follow, true); assert.equal(f.refreshes(), 0); assert.equal(f.timers.size, 0);
});
