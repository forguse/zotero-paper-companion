/* SPDX-License-Identifier: MIT — session ownership and persistence, without platform globals. */
(function (root) {
const Queue = typeof module === 'object' && module.exports ? require('./persistence.js') : root.PCKeyedQueue;
const PCSessionStore = class {
  constructor(io) {
    this.io = io;
    this.sessions = new Map(); this.loads = new Map(); this.unsaved = new Set();
    this.writes = new Queue(); this.operations = new Set();
    this.saving = 0; this.changing = false; this.restoring = false; this.archiveCounter = 0;
  }

  key(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_]{1,128}$/.test(key)) throw new Error('对话标识无效，原文件已保留。');
    return key;
  }

  validate(data) {
    if (!data || !Array.isArray(data.messages) || data.messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string')) {
      throw new Error('对话格式无效，原文件已保留。');
    }
    return data;
  }

  normalize(data) {
    this.validate(data);
    for (const message of data.messages) if (message.status === 'pending') message.status = 'cancelled';
    return data;
  }

  async load(key) {
    this.key(key);
    if (this.sessions.has(key)) return this.sessions.get(key);
    if (!this.loads.has(key)) {
      const task = Promise.resolve().then(() => this.io.read(key + '.json', { messages: [] })).then(data => {
        // A deliberate replacement made during a read must win over late I/O.
        if (!this.sessions.has(key)) this.sessions.set(key, this.normalize(data));
        return this.sessions.get(key);
      });
      this.loads.set(key, task);
      const clear = () => { if (this.loads.get(key) === task) this.loads.delete(key); };
      task.then(clear, clear);
    }
    return this.loads.get(key);
  }

  track(task) {
    this.operations.add(task);
    const clear = () => this.operations.delete(task);
    task.then(clear, clear);
    return task;
  }

  save(key) { return this.track(this.persist(key)); }
  async persist(key) {
    this.key(key);
    if (this.changing || this.restoring) throw new Error('正在切换或恢复会话，请稍后重试保存。');
    this.saving++;
    try {
      // A string is already an immutable snapshot. Avoid a decode/reencode clone.
      const text = JSON.stringify(this.validate(await this.load(key)), null, 2);
      await this.writes.run(key, () => this.io.write(key + '.json', text));
      this.unsaved.delete(key); this.io.emit('sessionSaved', { key });
    } catch (cause) {
      this.unsaved.add(key); this.io.emit('sessionSaveFailed', { key });
      const error = new Error('本机对话未保存，内容仍在当前窗口。可重试保存或先复制重要内容。' + this.io.safeError(cause.message));
      error.code = 'CHAT_SAVE_FAILED'; throw error;
    } finally { this.saving--; }
  }

  async archives(key) {
    this.key(key);
    const prefix = key + '-';
    return (await this.io.list()).map(path => this.io.basename(path)).filter(name => name.startsWith(prefix) && /^\d+\.json$/.test(name.slice(prefix.length)))
      .map(name => ({ id: name, at: Number(name.slice(prefix.length, -5)) })).sort((a, b) => b.at - a.at);
  }

  async readArchive(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_]{1,128}-\d+\.json$/.test(id)) throw new Error('历史对话不存在，请刷新列表。');
    return this.validate(await this.io.read(id, null));
  }
  async archived(key, id) {
    if (!(await this.archives(key)).some(row => row.id === id)) throw new Error('历史对话不存在，请刷新列表。');
    return this.readArchive(id);
  }

  async summary(key) {
    const messages = [];
    // Only names returned by the paper-scoped enumeration reach readArchive.
    // Read sequentially to avoid retaining a second copy of every archive at once.
    for (const row of (await this.archives(key)).reverse()) messages.push({ role: 'boundary' }, ...(await this.readArchive(row.id)).messages);
    messages.push({ role: 'boundary' }, ...(await this.load(key)).messages);
    return messages;
  }

  async archiveCurrent(key, current) {
    if (!current.messages.length) return;
    const text = JSON.stringify(this.validate(current), null, 2);
    let at = Math.max(Date.now(), this.archiveCounter + 1);
    while (await this.io.exists(`${key}-${at}.json`)) at++;
    this.archiveCounter = at;
    await this.io.write(`${key}-${at}.json`, text);
  }

  reset(key) { return this.track(this.replace(key)); }
  async replace(key) {
    this.key(key);
    if (this.saving) throw new Error('本机对话正在保存，请完成后再新建会话。');
    if (this.io.busy() || this.changing || this.restoring) throw new Error('请先停止当前回答或等待会话切换。');
    this.changing = true;
    try {
      await this.archiveCurrent(key, await this.load(key));
      const next = { messages: [] };
      await this.io.write(key + '.json', JSON.stringify(next, null, 2));
      this.sessions.set(key, next); this.unsaved.delete(key); this.io.emit('sessionSaved', { key });
    } finally { this.changing = false; }
  }

  restore(key, id) { return this.track(this.restoreFrom(key, id)); }
  async restoreFrom(key, id) {
    this.key(key);
    if (this.saving) throw new Error('本机对话正在保存，请完成后再恢复历史。');
    if (this.io.busy() || this.restoring || this.changing) throw new Error('请先等待当前对话操作完成。');
    this.restoring = true;
    try {
      const next = this.normalize(await this.archived(key, id));
      await this.archiveCurrent(key, await this.load(key));
      // Never commit an intermediate empty session during restoration.
      await this.io.write(key + '.json', JSON.stringify(next, null, 2));
      this.sessions.set(key, next); this.unsaved.delete(key); this.io.emit('sessionSaved', { key });
    } finally { this.restoring = false; }
  }

  async drain() {
    while (this.operations.size || this.loads.size) await Promise.allSettled([...this.operations, ...this.loads.values()]);
    await this.writes.drain();
  }
};
root.PCSessionStore = PCSessionStore;
if (typeof module === 'object' && module.exports) module.exports = PCSessionStore;
})(this);
