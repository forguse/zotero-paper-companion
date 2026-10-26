/* SPDX-License-Identifier: MIT */
/**
 * Local append feedback. Domain validation belongs to PCNoteInsertions; this
 * controller knows no files, providers or Markdown source annotations.
 * write(text, key) updates the local draft synchronously; flush(key) persists it.
 */
var PCNoteReceiptUI = class PCNoteReceiptUI {
  constructor({ document, insertions, current, write, flush, view, notify = () => {} }) {
    this.document = document;
    this.ports = { insertions, current, write, flush, view, notify };
    this.states = new Map(); this.bindings = new Map(); this.destroyed = false;
  }

  notify(message, error = false) {
    if (this.destroyed) return;
    try { this.ports.notify(message, error); } catch (_) {}
  }

  snapshot(ownerKey) {
    if (this.destroyed) throw new Error('摘记视图已关闭。');
    const current = this.ports.current();
    if (!current?.ready || typeof current.key !== 'string' || typeof current.text !== 'string') throw new Error('笔记尚未准备好，请稍后重试。');
    if (ownerKey !== undefined && current.key !== ownerKey) throw new Error('当前论文已切换，请回到原论文再记入笔记。');
    return current;
  }

  state(receipt) {
    let state = this.states.get(receipt.id);
    if (!state) {
      state = { receipt, phase: receipt.status, operation: receipt.operation || 'append', revision: 0, promise: null };
      this.states.set(receipt.id, state);
    }
    return state;
  }

  append(value, { host, ownerKey } = {}) {
    const current = this.snapshot(ownerKey);
    if (typeof value !== 'string') throw new TypeError('摘记内容必须是文本。');
    if (!value.length) return null;
    const before = current.text, key = current.key;
    this.ports.write(before + value, key);
    const receipt = this.ports.insertions.record(key, before, value), state = this.state(receipt);
    if (host) {
      try { this.mount(host, state); }
      catch (_) { this.notify('摘记反馈暂时无法显示，内容仍会保存。', true); }
    }
    this.save(state, 'append');
    return receipt;
  }

  showLatest(host) {
    if (this.destroyed) return null;
    const current = this.ports.current();
    const receipt = current?.key ? this.ports.insertions.latest(current.key) : null;
    if (receipt && host) {
      try { this.mount(host, this.state(receipt)); }
      catch (_) { this.notify('摘记反馈暂时无法显示。', true); }
    }
    return receipt;
  }

  // Reattach feedback after a chat article is redrawn without inserting again.
  show(id, host) {
    if (this.destroyed || !host) return null;
    const receipt = this.ports.insertions.get(id), state = this.states.get(id) || (receipt ? this.state(receipt) : null);
    if (!state) return null;
    this.mount(host, state); this.update(); return state.receipt;
  }

  whenSettled(id) {
    const state = this.states.get(id);
    return state?.promise || Promise.resolve(state?.phase === 'saved');
  }

  mount(host, state) {
    if (this.destroyed) return;
    const previous = this.bindings.get(host);
    if (previous?.state === state) { this.render(previous); return; }
    if (previous) this.unmount(host);
    const row = this.document.createElement('div'), status = this.document.createElement('span'), actions = this.document.createElement('div');
    row.className = 'note-receipt'; status.className = 'note-receipt-status'; actions.className = 'note-receipt-actions';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const binding = { row, status, actions, state, buttons: {}, listeners: [], connected: host.isConnected === true };
    for (const [name, label, action] of [['view', '查看', () => this.view(state.receipt.id)],
      ['undo', '撤销', () => this.undo(state.receipt.id)], ['retry', '重试保存', () => this.retry(state.receipt.id)]]) {
      const button = this.document.createElement('button'); button.type = 'button'; button.className = 'note-receipt-' + name; button.textContent = label;
      const handler = () => {
        if (this.destroyed || button.disabled) return;
        try { Promise.resolve(action()).catch(() => this.notify('操作暂时未完成，请稍后重试。', true)); }
        catch (_) { this.notify('操作暂时未完成，请稍后重试。', true); }
      };
      button.addEventListener('click', handler); binding.listeners.push(() => button.removeEventListener('click', handler));
      actions.append(button); binding.buttons[name] = button;
    }
    row.append(status, actions); host.replaceChildren(row); this.bindings.set(host, binding); this.render(binding);
  }

  sync(state) {
    if (state.promise || !state.receipt.undoable) return;
    const saved = this.ports.insertions.get(state.receipt.id);
    if (saved) { state.receipt = saved; state.operation = saved.operation; state.phase = saved.status; }
    else if (state.phase !== 'saved' || state.operation !== 'undo') state.phase = 'expired';
  }

  render(binding) {
    if (this.destroyed) return;
    const { state, row, status, buttons } = binding, undo = state.operation === 'undo';
    const current = this.ports.current(), available = !!current?.ready && current.key === state.receipt.key && typeof current.text === 'string';
    const range = available && !undo ? this.ports.insertions.locate(state.receipt.id, current.text, current.key) : null;
    const text = state.phase === 'expired' ? '摘记记录已过期' : undo ?
      state.phase === 'error' ? '已撤销 · 待重试保存' : state.phase === 'pending' ? '已撤销 · 保存中…' : '已撤销' :
      state.phase === 'error' ? '已记入 · 保存失败' : state.phase === 'pending' ? '已记入 · 保存中…' : '已记入笔记';
    const suffix = !state.receipt.undoable && !undo ? ' · 未保留撤销记录' : '';
    if (status.textContent !== text + suffix) status.textContent = text + suffix;
    row.dataset.status = state.phase; row.dataset.operation = state.operation;
    buttons.view.disabled = !range; buttons.undo.disabled = !range || state.phase === 'expired';
    buttons.retry.hidden = state.phase !== 'error'; buttons.retry.disabled = !available || state.phase !== 'error';
  }

  update() {
    if (this.destroyed) return;
    try {
      for (const [host, binding] of this.bindings) {
        if (host.isConnected === true) binding.connected = true;
        else if (host.isConnected === false && binding.connected) this.unmount(host);
      }
      for (const state of this.states.values()) this.sync(state);
      for (const binding of this.bindings.values()) this.render(binding);
      // Detached feedback must not keep the whole chat tree alive. Metadata with
      // no remaining view is also bounded; pending writes always finish first.
      const limit = Math.max(16, this.ports.insertions.limits.maxEntries * 2);
      for (const [id, state] of this.states) {
        if (this.states.size <= limit) break;
        if (state.phase !== 'pending' && !state.promise && ![...this.bindings.values()].some(binding => binding.state === state)) this.states.delete(id);
      }
    } catch (_) { this.notify('摘记已保留，反馈显示暂时无法更新。', true); }
  }

  setPaper() { this.update(); }

  save(state, operation) {
    if (this.destroyed) return Promise.resolve(false);
    const revision = ++state.revision;
    state.operation = operation; state.phase = 'pending';
    const claim = this.ports.insertions.mark(state.receipt.id, 'pending', operation);
    const ticket = claim?.revision;
    if (claim) state.receipt = claim;
    this.update();
    const task = (async () => {
      let failure = false;
      try { await this.ports.flush(state.receipt.key); }
      catch (_) { failure = true; }
      if (revision !== state.revision) return false;
      const live = this.ports.insertions.get(state.receipt.id);
      // Another pane may have started a newer operation on this shared receipt.
      if (ticket !== undefined && live?.revision !== ticket) return false;
      state.phase = failure ? 'error' : 'saved';
      const marked = this.ports.insertions.mark(state.receipt.id, state.phase, operation);
      if (marked) state.receipt = marked;
      if (!failure && operation === 'undo') this.ports.insertions.forget(state.receipt.id);
      if (failure) this.notify(operation === 'undo' ? '已撤销，保存失败，可重试保存。' : '摘记已留在本机稿中，保存失败，可重试。', true);
      this.update();
      return !failure;
    })();
    state.promise = task.finally(() => {
      if (revision === state.revision) { state.promise = null; this.update(); }
    });
    return state.promise;
  }

  async view(id) {
    if (this.destroyed) return false;
    const state = this.states.get(id);
    if (!state || state.operation === 'undo') return false;
    let current;
    try { current = this.snapshot(state.receipt.key); }
    catch (error) { this.notify(error.message, true); return false; }
    const range = this.ports.insertions.locate(id, current.text, current.key);
    if (!range) { this.notify('笔记内容已有变化，无法定位原摘记。', true); this.update(); return false; }
    try { await this.ports.view(range); return true; }
    catch (_) { this.notify('暂时无法定位这次摘记，请到笔记页查看。', true); return false; }
  }

  undo(id) {
    if (this.destroyed) return Promise.resolve(false);
    const state = this.states.get(id);
    if (!state || state.operation === 'undo') return Promise.resolve(false);
    const current = this.snapshot(state.receipt.key), plan = this.ports.insertions.prepareUndo(id, current.text, current.key);
    if (!plan) { this.notify('笔记已有修改，无法安全撤销这次摘记。内容已保留。', true); this.update(); return Promise.resolve(false); }
    this.ports.write(plan.text, plan.key);
    return this.save(state, 'undo');
  }

  retry(id) {
    if (this.destroyed) return Promise.resolve(false);
    const state = this.states.get(id);
    if (!state || state.phase !== 'error') return Promise.resolve(false);
    this.snapshot(state.receipt.key);
    return this.save(state, state.operation);
  }

  unmount(host) {
    const binding = this.bindings.get(host);
    if (!binding) return;
    for (const remove of binding.listeners) remove(); this.bindings.delete(host);
  }

  destroy() {
    this.destroyed = true;
    for (const host of this.bindings.keys()) this.unmount(host);
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = PCNoteReceiptUI;
