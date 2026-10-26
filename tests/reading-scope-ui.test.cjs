const { test } = require('node:test');
const assert = require('node:assert/strict');
const PCReadingScopeUI = require('../addon/content/reading-scope-ui.js');
class Node extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.textContent = ''; this.attributes = {}; this.open = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
function fixture() {
  let value = { key: 'A', paperID: 1, smartReading: true, provider: 'deepseek', model: 'deepseek-flash', session: { messages: [] } };
  const document = { createElement: tag => new Node(tag) }, host = new Node(), changes = [];
  const ui = new PCReadingScopeUI({ document, host, input: () => value, onChange: next => { changes.push(next); value.includePrimary = next; } });
  return { ui, host, document, changes, input: patch => { value = { ...value, ...patch }; } };
}
test('scope is planned until explicit prepared metadata arrives; unchanged updates retain the disclosure', () => {
  const f = fixture(); f.ui.update(); const disclosure = f.ui.disclosure, section = f.ui.content.children[0]; disclosure.open = true;
  assert.match(f.ui.summary.textContent, /本篇智能检索/); f.ui.update(); assert.equal(f.ui.disclosure, disclosure); assert.equal(f.ui.content.children[0], section); assert.equal(disclosure.open, true);
  assert.equal(f.ui.accept({ key: 'A', scope: { version: 1, phase: 'planned' } }), false);
  const scope = { version: 1, phase: 'prepared', label: '本篇检索节选', details: ['实际节选'], warnings: [] };
  assert.equal(f.ui.accept({ key: 'A', scope }), true); assert.equal(f.ui.content.children.at(-1).children[0].textContent, '上轮实际依据');
  assert.match(f.ui.summary.textContent, /本篇智能检索/);
});
test('manual current-paper choice is explicit and does not appear for general chat', () => {
  const f = fixture(); f.input({ context: { text: 'selection' } }); f.ui.update(); assert.equal(f.ui.checkbox.checked, false); assert.equal(f.changes.length, 0);
  const checkbox = f.ui.checkbox; checkbox.checked = true; const event = new Event('change'); Object.defineProperty(event, 'target', { value: checkbox }); f.ui.content.dispatchEvent(event);
  assert.deepEqual(f.changes, [true]); assert.equal(f.ui.checkbox.checked, true);
  f.input({ key: 'general' }); f.ui.update(); assert.equal(f.ui.checkbox, null);
});
test('invalid selection is visibly unknown and cannot be mistaken for pure chat', () => {
  const f = fixture(); f.input({ ids: ['invalid'] }); f.ui.update(); assert.equal(f.ui.summary.textContent, '范围待核对'); assert.equal(f.ui.content.children[0].children[1].textContent, '范围待核对');
});
test('latest actual source is bounded per paper and webpage draft is explicitly unsent', () => {
  const f = fixture(); for (let index = 0; index < 20; index++) f.ui.accept({ key: String(index), scope: { version: 1, phase: 'draft', label: '网页草稿', details: [], warnings: [] } });
  assert.equal(f.ui.actual.size, 16); f.input({ key: '19', provider: 'chatgpt-web' }); f.ui.update(); assert.match(f.ui.content.children.at(-1).children[0].textContent, /草稿（未发送）/);
  f.ui.destroy(); assert.equal(f.ui.actual.size, 0); assert.equal(f.ui.accept({ key: 'A', scope: {} }), false);
});
