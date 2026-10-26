/* SPDX-License-Identifier: MIT — local, non-inferencing reading scope disclosure. */
var PCReadingScopeUI = class PCReadingScopeUI {
  constructor({ document, host, input, onChange = () => {} }) {
    Object.assign(this, { document, host, input, onChange }); this.actual = new Map(); this.signature = ''; this.destroyed = false;
    this.disclosure = document.createElement('details'); this.disclosure.className = 'reading-scope';
    this.summary = document.createElement('summary'); this.summary.className = 'reading-scope-label'; this.summary.setAttribute('aria-label', '本轮阅读范围');
    this.content = document.createElement('div'); this.content.className = 'reading-scope-details';
    this.disclosure.append(this.summary, this.content); host.append(this.disclosure);
    this.change = event => { if (this.destroyed || event.target !== this.checkbox) return; this.onChange(this.checkbox.checked); this.update(); };
    this.content.addEventListener('change', this.change);
  }
  node(tag, text, className = '') { const node = this.document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  rows(scope, title) {
    const section = this.node('section'), heading = this.node('strong', title); section.append(heading);
    section.append(this.node('p', scope.label));
    for (const detail of scope.details || []) section.append(this.node('p', detail));
    for (const warning of scope.warnings || []) section.append(this.node('p', warning, 'reading-scope-warning'));
    return section;
  }
  accept({ key, scope } = {}) {
    if (this.destroyed || typeof key !== 'string' || !scope || scope.version !== 1 || !['prepared', 'draft'].includes(scope.phase)) return false;
    this.actual.delete(key); this.actual.set(key, scope);
    while (this.actual.size > 16) this.actual.delete(this.actual.keys().next().value);
    this.update(); return true;
  }
  forget(key) { if (this.destroyed) return; this.actual.delete(key); this.update(); }
  update() {
    if (this.destroyed) return;
    let input, scope;
    try { input = this.input(); scope = PCReadingScopeUI.describe(input); }
    catch (_) { input = input || {}; scope = { label: '范围待核对', details: ['暂时无法确认本轮材料范围，请核对材料与模型后再发送。'], warnings: [] }; }
    const actual = this.actual.get(input.key), manual = !!input.context && input.key && input.key !== 'general';
    const signature = JSON.stringify([input.key, scope, actual, manual]);
    if (signature === this.signature) return; this.signature = signature;
    this.summary.textContent = scope.label; this.summary.title = '本轮阅读范围：' + scope.label;
    // The disclosure stays in place. Unchanged inputs return above; when its
    // contents do change, restore focus only if the checkbox owned it already.
    const focused = this.document.activeElement === this.checkbox;
    const section = this.rows(scope, '本轮计划'); this.content.replaceChildren(section); this.checkbox = null;
    if (manual) {
      const label = this.node('label', undefined, 'reading-scope-primary'), checkbox = this.node('input'); checkbox.type = 'checkbox'; checkbox.checked = scope.selection?.includePrimary === true;
      label.append(checkbox, this.node('span', '同时参考本篇（提要与原文检索）')); this.content.append(label); this.checkbox = checkbox;
      if (focused) checkbox.focus?.({ preventScroll: true });
    }
    if (actual) this.content.append(this.rows(actual, actual.phase === 'draft' ? '上次传入的网页草稿（未发送）' : '上轮实际依据'));
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.content.removeEventListener('change', this.change); this.actual.clear(); }
  static describe(input) { return (typeof PCReadingScope !== 'undefined' ? PCReadingScope : require('./reading-scope.js')).describe({ ...input, phase: 'planned' }); }
};
if (typeof module !== 'undefined' && module.exports) module.exports = PCReadingScopeUI;
