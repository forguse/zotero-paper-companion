/* SPDX-License-Identifier: MIT — optional local action guide and bounded shortcuts. */
(function (root) {
const PAGES = { chat: '对话', translate: '翻译', notes: '笔记', vocabulary: '单词本', highlights: '重点', settings: '设置' };
const HINTS = {
  chat: '先选材料，再输入问题。常用问题可作起点；发送前核对本轮阅读范围。',
  translate: '划词或输入文字后翻译。原文可展开，译文可复制或记入笔记。',
  notes: '直接在正文写笔记，修改自动保存；需要精确排版时可切换 Markdown 源码。',
  vocabulary: '本章单词只看当前论文，所有单词查看个人词库；复习可遮挡释义并记录掌握情况。',
  highlights: '先更新聊天重点，再按需重新整理；自动维护有独立开关，手动更新才发起本次整理。',
  settings: '自动保存选项会标明状态；需要手动提交的分组，请在修改后点击对应保存按钮。'
};
class GuidePrefs {
  constructor({ readPrefs, savePrefs, ids, changed = () => {}, notify = () => {} }) {
    Object.assign(this, { readPrefs, savePrefs, changed, notify }); this.ids = new Set(ids); this.pending = new Map(); this.revision = 0;
    this.value = this.normalize(readPrefs()); this.draft = this.normalize(this.value); this.error = ''; this.saved = false; this.job = null;
  }
  normalize(value = {}) { return { pins: [...new Set(Array.isArray(value?.pins) ? value.pins.filter(id => this.ids.has(id)) : [])].slice(0, 2), dismissed: value?.dismissed === true }; }
  get saving() { return !!this.job || this.pending.size > 0; }
  report(error) { try { this.notify(error); } catch (_) {} }
  emit() { try { this.changed(); } catch (error) { this.report(new Error('操作指南显示未更新：' + error.message)); } }
  refresh() {
    if (this.saving) return false;
    this.value = this.normalize(this.readPrefs()); this.draft = this.normalize(this.value); return true;
  }
  change(patch) {
    if (this.detached) return Promise.reject(new Error('操作指南已关闭。'));
    if (Object.keys(patch).some(key => !['pins', 'dismissed'].includes(key))) throw new Error('快捷设置字段无效。');
    if ('pins' in patch && (!Array.isArray(patch.pins) || patch.pins.some(id => !this.ids.has(id)) || new Set(patch.pins).size > 2)) throw new Error('最多固定两个常用入口。');
    if ('dismissed' in patch && typeof patch.dismissed !== 'boolean') throw new Error('提示设置无效。');
    for (const [key, value] of Object.entries(patch)) {
      const next = key === 'pins' ? [...new Set(value)] : value;
      if (JSON.stringify(this.draft[key]) === JSON.stringify(next)) continue;
      this.pending.set(key, { revision: ++this.revision, value: next });
    }
    this.rebuild(); this.emit();
    if (!this.pending.size) return this.job || Promise.resolve(true);
    if (!this.job) {
      const task = Promise.resolve().then(() => this.flush()); this.job = task;
      const finish = () => { if (this.job === task) this.job = null; this.emit(); };
      task.then(finish, finish);
    }
    return this.job;
  }
  setPin(id, selected) {
    if (!this.ids.has(id)) throw new Error('这个常用入口已不可用。');
    const pins = this.draft.pins.filter(value => value !== id); if (selected) pins.push(id);
    return this.change({ pins });
  }
  rebuild() { const next = { ...this.value }; for (const [key, item] of this.pending) next[key] = item.value; this.draft = this.normalize(next); }
  async flush() {
    let successful = true;
    while (this.pending.size) {
      const captured = new Map(this.pending), patch = {};
      for (const [key, item] of captured) patch[key] = Array.isArray(item.value) ? [...item.value] : item.value;
      try {
        await this.savePrefs(patch); this.value = this.normalize({ ...this.value, ...patch }); this.error = ''; this.saved = true;
      } catch (error) { successful = false; this.error = error.message || '快捷设置未保存。'; this.report(error); }
      // Only settle fields from this exact write. A later checkbox click or
      // hint dismissal remains queued even if the older write failed.
      for (const [key, item] of captured) if (this.pending.get(key)?.revision === item.revision) this.pending.delete(key);
      this.rebuild(); this.emit();
    }
    return successful;
  }
  detach() { this.detached = true; this.changed = () => {}; this.notify = () => {}; }
}

class PCActionGuide {
  static serial = 0;
  constructor({ document, openButton, shortcutsHost, hintHost = null, getState, readPrefs, savePrefs, actions = [], notify = () => {} }) {
    Object.assign(this, { document, openButton, shortcutsHost, hintHost, getState, notify }); this.listeners = []; this.rows = new Map(); this.shortcuts = new Map();
    this.actions = new Map(); for (const action of actions) { if (!action.id || this.actions.has(action.id) || typeof action.run !== 'function') throw new Error('操作指南入口标识或动作无效。'); this.actions.set(action.id, action); }
    this.id = 'pc-action-guide-' + (++PCActionGuide.serial); this.build();
    this.prefs = new GuidePrefs({ readPrefs, savePrefs, ids: this.actions.keys(), changed: () => this.render(), notify: error => this.report(error) });
    this.on(openButton, 'click', () => this.open()); this.update(getState());
  }
  node(tag, className, text) { const node = this.document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; }
  button(className, text) { const node = this.node('button', className, text); node.type = 'button'; return node; }
  on(node, type, handler) { if (!node) return; node.addEventListener(type, handler); this.listeners.push(() => node.removeEventListener(type, handler)); }
  report(error) { if (!this.destroyed) { try { this.notify(error); } catch (_) {} } }
  async perform(callback) { try { return await callback(); } catch (error) { this.report(error); this.render(); return false; } }
  build() {
    this.dialog = this.node('dialog', 'pc-action-guide'); this.dialog.setAttribute('aria-labelledby', this.id + '-title');
    const header = this.node('div', 'pc-guide-header'), title = this.node('h2', '', '操作指南'); title.id = this.id + '-title';
    this.closeButton = this.button('pc-guide-close', '×'); this.closeButton.setAttribute('aria-label', '关闭操作指南'); header.append(title, this.closeButton);
    const pageLabel = this.node('label', 'pc-guide-page', '查看页面'); this.pageSelect = this.node('select'); this.pageSelect.setAttribute('aria-label', '查看页面的操作提示');
    for (const [id, name] of Object.entries(PAGES)) { const option = this.node('option', '', name); option.value = id; this.pageSelect.append(option); } pageLabel.append(this.pageSelect);
    this.hint = this.node('p', 'pc-guide-hint'); this.actionList = this.node('div', 'pc-guide-actions');
    this.status = this.node('p', 'pc-guide-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.resetButton = this.button('pc-guide-reset', '重新显示空对话提示');
    this.dialog.append(header, pageLabel, this.hint, this.actionList, this.status, this.resetButton); this.document.body.append(this.dialog);
    this.shortcutsRoot = this.node('div', 'pc-guide-shortcuts'); this.shortcutsRoot.setAttribute('aria-label', '固定的常用入口'); this.shortcutsHost?.append(this.shortcutsRoot);
    if (this.hintHost) {
      this.emptyHint = this.node('div', 'pc-guide-empty-hint'); const text = this.node('span', '', '从常用问题或附加材料开始');
      this.dismissButton = this.button('pc-guide-dismiss', '×'); this.dismissButton.setAttribute('aria-label', '不再显示空对话提示'); this.emptyHint.append(text, this.dismissButton); this.hintHost.append(this.emptyHint);
      this.on(this.dismissButton, 'click', () => this.perform(() => this.prefs.change({ dismissed: true })));
    }
    for (const action of this.actions.values()) {
      const row = this.node('div', 'pc-guide-action-row'), main = this.node('div', 'pc-guide-action-main'), button = this.button('pc-guide-action-button', action.label), description = this.node('p', 'pc-guide-action-description', action.description || '');
      description.id = this.id + '-' + this.rows.size + '-description'; button.setAttribute('aria-describedby', description.id); main.append(button, description);
      const pinLabel = this.node('label', 'pc-guide-pin'), checkbox = this.node('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '固定“' + action.label + '”到快捷条'); pinLabel.append(checkbox, this.node('span', '', '固定')); row.append(main, pinLabel); this.actionList.append(row);
      const shortcut = this.button('pc-guide-shortcut', action.label); shortcut.title = action.description || action.label;
      this.rows.set(action.id, { row, button, checkbox }); this.shortcuts.set(action.id, shortcut);
      this.on(button, 'click', () => this.perform(() => this.invoke(action.id))); this.on(shortcut, 'click', () => this.perform(() => this.invoke(action.id)));
      this.on(checkbox, 'change', () => this.perform(() => this.prefs.setPin(action.id, checkbox.checked)));
    }
    this.on(this.closeButton, 'click', () => this.close());
    this.on(this.dialog, 'cancel', event => { event.preventDefault(); this.close(); });
    this.on(this.pageSelect, 'change', () => { this.selectedPage = this.pageSelect.value; this.render(); });
    this.on(this.resetButton, 'click', () => this.perform(() => this.prefs.change({ dismissed: false })));
  }
  stateValue(value = {}) { return { page: value.page in PAGES ? value.page : 'chat', empty: value.empty === true, paperAvailable: value.paperAvailable === true }; }
  update(state = this.getState()) {
    if (this.destroyed) return; const next = this.stateValue(state);
    if (!this.state || this.state.page !== next.page) this.selectedPage = next.page;
    this.state = next; this.prefs.refresh(); this.render();
  }
  available(action) { try { return typeof action.available === 'function' ? action.available(this.state) !== false : action.available !== false; } catch (_) { return false; } }
  render() {
    if (this.destroyed || !this.prefs) return;
    const { pins, dismissed } = this.prefs.draft; this.pageSelect.value = this.selectedPage; this.hint.textContent = HINTS[this.selectedPage] || HINTS.chat;
    for (const [id, action] of this.actions) {
      const row = this.rows.get(id); row.row.hidden = Array.isArray(action.pages) && !action.pages.includes(this.selectedPage); row.button.disabled = !this.available(action);
      row.checkbox.checked = pins.includes(id); row.checkbox.disabled = pins.length >= 2 && !pins.includes(id);
      this.shortcuts.get(id).disabled = !this.available(action);
    }
    this.shortcutsRoot.replaceChildren(...pins.map(id => this.shortcuts.get(id))); if (this.shortcutsHost) this.shortcutsHost.hidden = !pins.length;
    if (this.hintHost) this.hintHost.hidden = this.state.page !== 'chat' || !this.state.empty || dismissed;
    this.resetButton.disabled = !dismissed; this.status.textContent = this.prefs.saving ? '保存中…' : this.prefs.error ? '保存失败，已保留原设置。可重新选择后重试。' : this.prefs.saved ? '已保存' : '固定入口与提示偏好自动保存；最多固定两个入口。';
  }
  open() {
    if (this.destroyed) return false;
    try {
      this.update(this.getState()); this.selectedPage = this.state.page; this.render();
      if (!this.dialog.open) this.dialog.showModal(); this.pageSelect.focus({ preventScroll: true }); return true;
    } catch (error) { this.report(error); return false; }
  }
  close() { if (this.destroyed || !this.dialog.open) return; this.dialog.close(); this.openButton?.focus({ preventScroll: true }); }
  async invoke(id) {
    const action = this.actions.get(id); this.state = this.stateValue(this.getState());
    if (!action || !this.available(action)) throw new Error('这个入口当前不可用，请先打开相应论文或页面。');
    this.close(); return action.run(this.state);
  }
  destroy() {
    if (this.destroyed) return; this.destroyed = true;
    for (const remove of this.listeners) remove(); this.listeners.length = 0; this.prefs.detach();
    if (this.dialog.open) this.dialog.close(); this.dialog.remove(); this.shortcutsRoot.remove(); this.emptyHint?.remove();
    if (this.shortcutsHost) this.shortcutsHost.hidden = true; if (this.hintHost) this.hintHost.hidden = true;
  }
}
PCActionGuide.Prefs = GuidePrefs; root.PCActionGuide = PCActionGuide;
if (typeof module === 'object' && module.exports) module.exports = PCActionGuide;
})(this);
