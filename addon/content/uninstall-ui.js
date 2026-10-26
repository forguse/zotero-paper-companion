/* SPDX-License-Identifier: MIT — reviewed, explicitly confirmed runtime cleanup. */
(function (root) {
'use strict';
const PCUninstallUI = class {
  constructor({ document, button, review, reveal, copy, notify = () => {} }) {
    this.document = document; this.button = button; this.review = review; this.reveal = reveal; this.copy = copy; this.notify = notify; this.sequence = 0; this.destroyed = false;
    this.launch = () => this.open(); button?.addEventListener('click', this.launch);
    this.unsubscribe = review.subscribe?.(state => this.progress(state));
  }
  node(tag, className, text) { const node = this.document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
  action(text, fn, className) {
    const button = this.node('button', className, text); button.type = 'button';
    button.addEventListener('click', () => { Promise.resolve().then(fn).catch(error => { if (!this.destroyed) this.notify(error.message || String(error), true); }); }); return button;
  }
  async open() {
    if (this.destroyed) return;
    if (this.dialog) { this.dialog.focus({ preventScroll: true }); return; }
    const doc = this.document; this.previousFocus = doc.activeElement;
    const dialog = this.dialog = this.node('dialog', 'pc-uninstall-review'); dialog.setAttribute('aria-labelledby', 'pc-uninstall-review-title');
    const header = this.node('div', 'pc-uninstall-header'), title = this.node('h2', '', '卸载与清理'); title.id = 'pc-uninstall-review-title';
    const close = this.closeButton = this.action('关闭', () => this.close(), 'pc-uninstall-close'); close.setAttribute('aria-label', '关闭卸载前核对'); header.append(title, close);
    const intro = this.node('p', 'pc-uninstall-intro', this.review.available ? '先核对清单。只有明确确认后，才会删除勾选类别中的插件文件，并移除论文伴读。打开本页不会清理数据。' : '本页只列出当前可确认的插件文件，不会删除数据。需要清理时，请打开位置并逐个核对。');
    this.status = this.node('p', 'pc-uninstall-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.content = this.node('div', 'pc-uninstall-content');
    const footer = this.node('div', 'pc-uninstall-footer');
    this.copyButton = this.action('复制清单', () => this.copy(this.review.text()), 'pc-uninstall-copy'); this.copyButton.disabled = true;
    this.refreshButton = this.action('重新核对', () => this.refresh(), 'pc-uninstall-refresh');
    footer.append(this.copyButton, this.refreshButton);
    this.confirmationBox = this.node('div', 'pc-uninstall-confirmation'); this.confirmationBox.hidden = true;
    this.confirmationStatus = this.node('p', 'pc-uninstall-confirmation-status'); this.confirmationStatus.hidden = true; this.confirmationStatus.setAttribute('aria-hidden', 'true');
    const acknowledgement = this.node('label', 'pc-uninstall-acknowledgement'); this.acknowledgement = this.node('input'); this.acknowledgement.type = 'checkbox';
    acknowledgement.append(this.acknowledgement, this.node('span', '', '我已备份需要的内容，了解所选笔记、单词本、对话及本机授权删除后不可撤销。'));
    const confirmationLabel = this.node('label', 'pc-uninstall-confirmation-label', '输入“完全卸载”确认'); this.confirmation = this.node('input'); this.confirmation.type = 'text'; this.confirmation.autocomplete = 'off'; this.confirmation.spellcheck = false; this.confirmation.setAttribute('aria-label', '输入完全卸载确认'); confirmationLabel.append(this.confirmation);
    this.executeButton = this.action('完全卸载', () => this.execute(), 'pc-uninstall-delete'); this.executeButton.disabled = true;
    this.acknowledgement.addEventListener('change', () => this.selectionState()); this.confirmation.addEventListener('input', () => this.selectionState());
    this.confirmationBox.append(this.confirmationStatus, acknowledgement, confirmationLabel, this.executeButton);
    const ending = this.node('p', 'pc-uninstall-ending', '原始 PDF、Zotero 文献、未知文件和共享网页登录状态会保留。空文件夹可能保留。云端 API Key 及服务商对话需在服务商处处理。');
    dialog.append(header, intro, this.status, this.content, ending, this.confirmationBox, footer);
    this.cancelHandler = event => { event.preventDefault(); this.close(); }; dialog.addEventListener('cancel', this.cancelHandler);
    doc.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
    close.focus({ preventScroll: true }); await this.refresh();
  }
  async refresh() {
    if (!this.dialog || this.destroyed) return;
    if (this.review.running) return;
    const sequence = ++this.sequence; this.plan = null; this.refreshButton.disabled = true; this.copyButton.disabled = true; this.executeButton.disabled = true; this.confirmationBox.hidden = true; this.status.textContent = '正在核对本机文件…';
    this.confirmationStatus.hidden = true; this.confirmationStatus.textContent = '';
    this.acknowledgement.checked = false; this.confirmation.value = ''; this.categoryInputs = new Map();
    this.content.replaceChildren();
    try {
      const plan = await this.review.preview();
      if (this.destroyed || !this.dialog || sequence !== this.sequence) return;
      this.plan = plan;
      this.status.textContent = plan.files.length + ' 个已登记文件 · ' + PCUninstallUI.size(plan.bytes) + ' · 仅预览';
      const list = this.node('div', 'pc-uninstall-files');
      for (const category of plan.categories || []) {
        if (!category.count) continue;
        const section = this.node('section', 'pc-uninstall-category'), title = this.node('h3', '', category.label + ' · ' + category.count);
        if (this.review.available) { const label = this.node('label', 'pc-uninstall-category-choice'), checkbox = this.node('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.setAttribute('aria-label', '清理' + category.label); label.append(checkbox, title); section.append(label); this.categoryInputs.set(category.id, checkbox); checkbox.addEventListener('change', () => { this.acknowledgement.checked = false; this.confirmation.value = ''; this.selectionState(); }); }
        else section.append(title);
        for (const row of plan.files.filter(file => file.category === category.id)) {
          const item = this.node('div', 'pc-uninstall-file'), path = this.node('span', 'pc-uninstall-path', row.path); path.title = row.path;
          const reveal = this.action('打开位置', () => this.reveal(row.path), 'pc-uninstall-reveal'); reveal.setAttribute('aria-label', '打开位置：' + row.path); item.append(path, reveal); section.append(item);
        }
        list.append(section);
      }
      if (!plan.files.length) list.append(this.node('p', '', '没有找到当前可确认的插件文件。旧位置、手动导出的副本仍需自行核对。'));
      const limitations = this.node('ul', 'pc-uninstall-limitations'); for (const text of plan.limitations || []) limitations.append(this.node('li', '', text));
      this.content.append(list, limitations);
      if (plan.kept?.length) {
        const kept = this.node('details', 'pc-uninstall-kept'); kept.append(this.node('summary', '', '保留与需手动核对的项目 · ' + plan.kept.length));
        for (const row of plan.kept) { const item = this.node('p', '', row.path + ' — ' + row.reason); kept.append(item); } this.content.append(kept);
      }
      this.copyButton.disabled = false;
      this.confirmationBox.hidden = !this.review.available; this.selectionState();
    } catch (error) {
      if (!this.destroyed && this.dialog && sequence === this.sequence) { this.status.textContent = '清单未能完成，请重试。现有文件未更改。'; this.notify(error.message || String(error), true); }
    } finally { if (!this.destroyed && this.dialog && sequence === this.sequence) this.refreshButton.disabled = false; }
  }
  selectionState() {
    if (!this.executeButton) return;
    const selected = [...(this.categoryInputs || [])].filter(([, node]) => node.checked).map(([id]) => id), all = [...(this.categoryInputs || [])].every(([, node]) => node.checked);
    const count = this.plan?.files.filter(row => selected.includes(row.category)).length || 0;
    this.executeButton.textContent = all ? '完全卸载' : '清理所选并卸载';
    this.executeButton.disabled = !this.plan || !this.plan.verified || !this.review.available || this.review.running || !this.acknowledgement.checked || this.confirmation.value !== '完全卸载' || this.plan.files.length > 0 && !count;
    this.confirmationBox.dataset.selected = count;
    if (this.plan && !this.review.running) this.status.textContent = this.plan.files.length + ' 个已登记文件 · ' + PCUninstallUI.size(this.plan.bytes) + ' · ' + (this.review.available ? '仅预览；选中 ' + count + ' 个；未选类别将保留' : '仅预览');
  }
  progress(state) {
    if (this.destroyed || !this.dialog || !this.status) return;
    const busy = ['preparing', 'removing', 'finalizing'].includes(state.stage);
    if (busy) {
      this.closeButton.disabled = true; this.refreshButton.disabled = true; this.executeButton.disabled = true; this.copyButton.disabled = true;
      this.acknowledgement.disabled = true; this.confirmation.disabled = true;
      for (const node of this.categoryInputs?.values() || []) node.disabled = true;
      this.status.textContent = state.stage === 'preparing' ? '正在暂停插件写入并重新核对清单…' : state.stage === 'finalizing' ? '文件清理完成，正在移除插件…' : '正在清理所选文件 · 已处理 ' + state.removed + ' 个';
    } else if (state.stage === 'error') {
      this.closeButton.disabled = false; this.refreshButton.disabled = false; this.copyButton.disabled = false;
      this.acknowledgement.disabled = false; this.confirmation.disabled = false; for (const node of this.categoryInputs?.values() || []) node.disabled = false;
      this.executeButton.disabled = true; this.acknowledgement.checked = false; this.confirmation.value = '';
      this.status.textContent = state.partial ? '清理未完成，插件写入已暂停以避免重建文件。请重新核对后继续；已处理 ' + state.removed + ' 个。' : '清理未执行完成，现有文件已保留。请重新核对后重试。';
    } else if (state.stage === 'complete') {
      this.status.textContent = state.kept ? '插件已移除。未选类别与保留项目仍在原位置。' : '文件清理完成，插件已移除。';
      this.executeButton.disabled = true; this.refreshButton.disabled = true; this.copyButton.disabled = true; this.closeButton.disabled = false;
    }
    // Keep the result beside the controls where cleanup was confirmed. The
    // original live region remains the single screen-reader announcement.
    if (busy || state.stage === 'error' || state.stage === 'complete') {
      this.confirmationStatus.hidden = false; this.confirmationStatus.textContent = this.status.textContent; this.confirmationStatus.dataset.stage = state.stage;
    } else if (state.stage === 'preview' || state.stage === 'idle') {
      this.confirmationStatus.hidden = true; this.confirmationStatus.textContent = '';
    }
  }
  async execute() {
    if (this.destroyed || this.executeButton.disabled || !this.plan) return;
    const categories = [...this.categoryInputs].filter(([, node]) => node.checked).map(([id]) => id);
    try { await this.review.execute({ id: this.plan.id, confirmation: this.confirmation.value, acknowledged: this.acknowledgement.checked, categories }); }
    catch (error) { if (!this.destroyed && this.dialog) this.notify(error.message || String(error), true); }
  }
  static size(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B'; }
  close() {
    if (!this.dialog || this.review.running && !this.destroyed) return; this.sequence++; this.review.cancel();
    const dialog = this.dialog; this.dialog = null; dialog.removeEventListener('cancel', this.cancelHandler);
    if (typeof dialog.close === 'function') dialog.close(); dialog.remove();
    if (!this.destroyed && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
  destroy() { this.destroyed = true; this.button?.removeEventListener('click', this.launch); this.unsubscribe?.(); this.close(); }
};
root.PCUninstallUI = PCUninstallUI;
if (typeof module === 'object' && module.exports) module.exports = PCUninstallUI;
})(this);
