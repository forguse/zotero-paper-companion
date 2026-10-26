/* SPDX-License-Identifier: MIT */
/**
 * Bounded, session-only receipts for text appended to per-paper notes.
 * The exact original prefix stays private. Public receipts contain only identity,
 * offsets, capacity and local save state; nothing is written to Markdown or disk.
 * Offsets use JavaScript/DOM UTF-16 positions, as does PCNoteEditor.
 */
var PCNoteInsertions = class PCNoteInsertions {
  #records = new Map();
  #chars = 0;
  #sequence = 0;
  #limits;

  constructor({ maxEntries = 16, maxChars = 2000000 } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxChars) || maxChars < 0) {
      throw new TypeError('摘记撤销容量必须是非负整数。');
    }
    this.#limits = Object.freeze({ maxEntries, maxChars });
  }

  get limits() { return this.#limits; }
  get size() { return this.#records.size; }
  get characters() { return this.#chars; }

  metadata(record) {
    return Object.freeze({ id: record.id, key: record.key, from: record.from, to: record.to,
      undoable: !!record.prefix, status: record.status, operation: record.operation, revision: record.revision });
  }

  record(key, before, inserted) {
    if (typeof key !== 'string' || !key.trim() || typeof before !== 'string' || typeof inserted !== 'string') {
      throw new TypeError('摘记记录需要论文键和明确的文本。');
    }
    if (!inserted.length) return null;
    const receipt = { id: 'note-insertion-' + ++this.#sequence, key,
      from: before.length, to: before.length + inserted.length, status: 'pending', operation: 'append', revision: 0, prefix: null };
    // An oversized append still gets its immediate viewing range, but retains
    // no note body and cannot later claim a verified location or safe undo.
    if (!this.limits.maxEntries || receipt.to > this.limits.maxChars) return this.metadata(receipt);
    while (this.#records.size >= this.limits.maxEntries || this.#chars + receipt.to > this.limits.maxChars) {
      this.forget(this.#records.keys().next().value);
    }
    receipt.prefix = before + inserted;
    this.#records.set(receipt.id, receipt); this.#chars += receipt.prefix.length;
    return this.metadata(receipt);
  }

  get(id) {
    const record = this.#records.get(id);
    return record ? this.metadata(record) : null;
  }

  latest(key) {
    let latest = null;
    for (const record of this.#records.values()) if (key === undefined || record.key === key) latest = record;
    return latest ? this.metadata(latest) : null;
  }

  mark(id, status, operation) {
    if (!['pending', 'saved', 'error'].includes(status)) throw new TypeError('无效的摘记保存状态。');
    if (operation !== undefined && !['append', 'undo'].includes(operation)) throw new TypeError('无效的摘记操作。');
    const record = this.#records.get(id);
    if (!record) return null;
    record.status = status; if (operation !== undefined) record.operation = operation; record.revision++;
    return this.metadata(record);
  }

  #match(id, current, key) {
    const record = this.#records.get(id);
    if (!record || typeof current !== 'string' || key !== undefined && key !== record.key) return null;
    return current.startsWith(record.prefix) ? record : null;
  }

  locate(id, current, key) {
    const record = this.#match(id, current, key);
    return record ? Object.freeze({ id: record.id, key: record.key, from: record.from, to: record.to }) : null;
  }

  canUndo(id, current, key) { return !!this.#match(id, current, key); }

  prepareUndo(id, current, key) {
    const record = this.#match(id, current, key);
    if (!record) return null;
    // Do not consume the receipt here: the caller commits this candidate through
    // its normal note transaction and forgets only after that write succeeds.
    return Object.freeze({ id: record.id, key: record.key, from: record.from, to: record.to,
      text: current.slice(0, record.from) + current.slice(record.to) });
  }

  forget(id) {
    const record = this.#records.get(id);
    if (!record) return false;
    this.#records.delete(id); this.#chars -= record.prefix.length;
    return true;
  }

  clear(key) {
    if (key === undefined) { this.#records.clear(); this.#chars = 0; return; }
    for (const record of this.#records.values()) if (record.key === key) this.forget(record.id);
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = PCNoteInsertions;
