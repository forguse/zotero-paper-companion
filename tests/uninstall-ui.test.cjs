const { test } = require('node:test');
const assert = require('node:assert/strict');
const PCUninstallUI = require('../addon/content/uninstall-ui.js');

class Node extends EventTarget {
  constructor(tag, document) { super(); this.tagName = tag; this.ownerDocument = document; this.children = []; this.attributes = {}; this.className = ''; this.textContent = ''; this.disabled = false; this.isConnected = true; this.dataset = {}; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  showModal() { this.modal = true; }
  close() { this.modal = false; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const turn = () => new Promise(resolve => setImmediate(resolve));
const find = (node, className) => { if (node.className === className) return node; for (const child of node.children) { const match = find(child, className); if (match) return match; } };
function fixture({ automatic = false } = {}) {
  const document = { createElement(tag) { return new Node(tag, this); } }; document.body = new Node('body', document); const button = new Node('button', document); document.activeElement = button;
  const notices = [], reveals = [], copied = [], executions = []; let cancelled = 0, previews = 0, subscriber;
  let preview = async () => ({ version: 1, files: [{ path: '/p/settings.json', category: 'settings', label: '设置', size: 50, modified: 1 }], bytes: 50, categories: [{ id: 'settings', label: '设置与本机授权', count: 1 }], kept: [{ path: '/p/unknown.txt', reason: '未知文件保留' }], limitations: ['保留原始 PDF'] });
  const review = { available: automatic, preview: async () => { previews++; const plan = await preview(); return { ...plan, id: 'verified-plan', verified: automatic }; }, cancel() { cancelled++; }, text: () => 'read-only list', subscribe(fn) { subscriber = fn; return () => { subscriber = null; }; } };
  if (automatic) review.execute = async value => { executions.push(value); };
  const ui = new PCUninstallUI({ document, button, review, reveal: async path => reveals.push(path), copy: text => copied.push(text), notify: (text, error) => notices.push({ text, error }) });
  return { document, button, ui, review, notices, reveals, copied, executions, emit(state) { subscriber?.(state); }, preview(fn) { preview = fn; }, get cancelled() { return cancelled; }, get previews() { return previews; } };
}

test('read-only dialog lists exact paths and preserved items, with explicit reveal and copy actions only', async () => {
  const f = fixture(); await f.ui.open(); assert.equal(f.ui.dialog.modal, true); assert.match(f.ui.status.textContent, /1 个已登记文件.*仅预览/);
  assert.match(find(f.ui.dialog, 'pc-uninstall-intro').textContent, /不会删除数据/);
  assert.equal(find(f.ui.dialog, 'pc-uninstall-path').textContent, '/p/settings.json'); assert.ok(find(f.ui.dialog, 'pc-uninstall-kept'));
  assert.deepEqual(f.reveals, []); find(f.ui.dialog, 'pc-uninstall-reveal').click(); await turn(); assert.deepEqual(f.reveals, ['/p/settings.json']);
  f.ui.copyButton.click(); await turn(); assert.deepEqual(f.copied, ['read-only list']); assert.equal(f.previews, 1);
  assert.equal(f.ui.confirmationBox.hidden, true); assert.equal(f.ui.executeButton.disabled, true); assert.equal(f.review.execute, undefined);
});

test('close and escape cancel only inventory, return focus without scrolling, and do not trigger file actions', async () => {
  const f = fixture(); await f.ui.open(); const cancel = new Event('cancel', { cancelable: true }); f.ui.dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true); assert.equal(f.ui.dialog, null); assert.equal(f.cancelled, 1); assert.equal(f.document.activeElement, f.button);
  assert.deepEqual(f.button.focusOptions, { preventScroll: true }); assert.deepEqual(f.reveals, []); assert.deepEqual(f.copied, []);
});

test('late preview does not resurrect closed or destroyed UI', async () => {
  const f = fixture(); let release; const hold = new Promise(resolve => { release = resolve; }); f.preview(() => hold);
  const opening = f.ui.open(); const old = f.ui.dialog; f.ui.destroy(); release({ version: 1, files: [], bytes: 0, categories: [], limitations: [], kept: [] }); await opening;
  assert.equal(f.ui.dialog, null); assert.equal(old.isConnected, false); assert.equal(f.cancelled, 1); assert.deepEqual(f.notices, []);
  f.button.click(); await turn(); assert.equal(f.ui.dialog, null);
});

test('preview failure reports no changes, retains refresh, and recovery renders actual empty inventory honestly', async () => {
  const f = fixture(); f.preview(async () => { throw new Error('synthetic read error'); }); await f.ui.open();
  assert.match(f.ui.status.textContent, /现有文件未更改/); assert.equal(f.ui.copyButton.disabled, true); assert.equal(f.ui.refreshButton.disabled, false); assert.match(f.notices[0].text, /synthetic/);
  f.preview(async () => ({ version: 1, files: [], bytes: 0, categories: [], limitations: [], kept: [] })); await f.ui.refresh();
  assert.match(f.ui.status.textContent, /0 个/); assert.match(find(f.ui.dialog, 'pc-uninstall-files').children[0].textContent, /旧位置/); assert.equal(f.ui.copyButton.disabled, false);
});

test('repeated open reuses one dialog and reveal errors keep review visible', async () => {
  const f = fixture(); await f.ui.open(); const dialog = f.ui.dialog; await f.ui.open(); assert.equal(f.ui.dialog, dialog); assert.equal(f.previews, 1);
  f.ui.reveal = async () => { throw new Error('file missing'); }; find(dialog, 'pc-uninstall-reveal').click(); await turn(); assert.match(f.notices[0].text, /file missing/); assert.equal(f.ui.dialog, dialog);
});

test('automatic cleanup remains disabled until typed confirmation and explicit personal-data acknowledgement, then uses the exact current plan', async () => {
  const f = fixture({ automatic: true }); await f.ui.open(); assert.equal(f.ui.confirmationBox.hidden, false); assert.equal(f.ui.executeButton.disabled, true); assert.equal(f.ui.confirmationStatus.hidden, true);
  f.ui.confirmation.value = '完全卸载'; f.ui.confirmation.dispatchEvent(new Event('input')); assert.equal(f.ui.executeButton.disabled, true);
  f.ui.acknowledgement.checked = true; f.ui.acknowledgement.dispatchEvent(new Event('change')); assert.equal(f.ui.executeButton.disabled, false);
  f.ui.executeButton.click(); await turn(); assert.deepEqual(f.executions, [{ id: 'verified-plan', confirmation: '完全卸载', acknowledged: true, categories: ['settings'] }]);
});

test('changing selected categories invalidates prior confirmation and explains retained categories rather than claiming a complete reset', async () => {
  const f = fixture({ automatic: true });
  f.preview(async () => ({ version: 1, files: [{ path: '/p/a', category: 'settings' }, { path: '/p/note.md', category: 'papers' }], categories: [{ id: 'settings', label: '设置', count: 1 }, { id: 'papers', label: '笔记', count: 1 }], bytes: 100, kept: [], limitations: [] })); await f.ui.open();
  f.ui.confirmation.value = '完全卸载'; f.ui.acknowledgement.checked = true; f.ui.selectionState();
  const papers = f.ui.categoryInputs.get('papers'); papers.checked = false; papers.dispatchEvent(new Event('change'));
  assert.equal(f.ui.executeButton.textContent, '清理所选并卸载'); assert.equal(f.ui.executeButton.disabled, true); assert.equal(f.ui.acknowledgement.checked, false); assert.equal(f.ui.confirmation.value, ''); assert.match(f.ui.status.textContent, /未选类别将保留/);
});

test('running cleanup blocks close, selection and duplicate submit until the native finalization result is known', async () => {
  const f = fixture({ automatic: true }); await f.ui.open(); f.review.running = true; f.emit({ stage: 'preparing', removed: 0 });
  assert.equal(f.ui.closeButton.disabled, true); assert.equal(f.ui.executeButton.disabled, true); assert.equal(f.ui.confirmation.disabled, true);
  assert.equal(f.ui.confirmationStatus.hidden, false); assert.equal(f.ui.confirmationStatus.textContent, f.ui.status.textContent); assert.equal(f.ui.confirmationStatus.attributes['aria-hidden'], 'true'); assert.equal(f.ui.status.attributes['aria-live'], 'polite'); assert.equal(f.ui.confirmationStatus.attributes['aria-live'], undefined);
  f.ui.dialog.dispatchEvent(new Event('cancel', { cancelable: true })); assert.ok(f.ui.dialog); assert.equal(f.cancelled, 0);
  f.emit({ stage: 'finalizing', removed: 1 }); assert.match(f.ui.status.textContent, /正在移除插件/); assert.doesNotMatch(f.ui.status.textContent, /插件已移除/);
  f.review.running = false; f.emit({ stage: 'complete', removed: 1, kept: 2 }); assert.match(f.ui.status.textContent, /插件已移除.*保留/); assert.equal(f.ui.executeButton.disabled, true); assert.equal(f.ui.confirmationStatus.textContent, f.ui.status.textContent);
});

test('partial failure resets destructive consent, exposes refresh and clearly warns that writes remain paused', async () => {
  const f = fixture({ automatic: true }); await f.ui.open(); f.ui.confirmation.value = '完全卸载'; f.ui.acknowledgement.checked = true;
  f.emit({ stage: 'error', partial: true, removed: 2 });
  assert.match(f.ui.status.textContent, /插件写入已暂停/); assert.equal(f.ui.executeButton.disabled, true); assert.equal(f.ui.confirmation.value, ''); assert.equal(f.ui.acknowledgement.checked, false); assert.equal(f.ui.refreshButton.disabled, false);
  assert.equal(f.ui.confirmationStatus.hidden, false); assert.equal(f.ui.confirmationStatus.dataset.stage, 'error'); assert.equal(f.ui.confirmationStatus.textContent, f.ui.status.textContent); assert.ok(f.ui.confirmationBox.children.includes(f.ui.confirmationStatus));
  await f.ui.refresh(); assert.equal(f.ui.confirmationStatus.hidden, true); assert.equal(f.ui.confirmationStatus.textContent, '');
});
