/* SPDX-License-Identifier: MIT */
// Window-local, per-paper drafts. No disk writes or model requests.
var PCPromptDrafts = class {
  constructor() { this.entries = new Map(); }
  remember(key, value) {
    const text = String(value.text || '');
    this.entries.set(key, { ...value, text, start: Math.min(value.start || 0, text.length),
      end: Math.min(value.end || 0, text.length), ids: [...(value.ids || [])] });
  }
  get(key) {
    const value = this.entries.get(key);
    return value ? { ...value, ids: [...value.ids] } : null;
  }
  recover(key, submitted) {
    if (this.entries.get(key)?.text.trim()) return false;
    this.remember(key, submitted); return true;
  }
  clear() { this.entries.clear(); }
};
if (typeof module !== 'undefined') module.exports = PCPromptDrafts;
