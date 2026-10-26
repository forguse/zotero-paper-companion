/* SPDX-License-Identifier: MIT */
// The view owns reading position and DOM reuse, never conversation data.
var PCChatView = class {
  constructor({ root, latest, refresh }) {
    this.root = root; this.latest = latest; this.refresh = refresh;
    this.win = root.ownerDocument.defaultView; this.scope = null;
    this.entries = new Map(); this.follow = true; this.timer = null;
    this.scroll = () => {
      if (root.clientHeight && !this.layoutAnchor) this.follow = this.atBottom();
      this.controls();
    };
    this.selection = () => { if (this.deferred && !this.hasSelection(root)) this.schedule(); };
    this.jump = () => { this.follow = true; root.scrollTop = root.scrollHeight; this.controls(); };
    this.interruptLayout = event => {
      this.layoutAnchor = null; this.layoutUntil = 0; this.win.clearTimeout(this.layoutTimer); this.layoutTimer = null;
      // A gesture at an unchanged scroll offset emits no scroll event. Recheck
      // visible geometry now so a stale follow flag cannot hide the return
      // control or push backreading to the end on the next resize.
      if (event && !this.closed && root.clientHeight > 0) { this.follow = this.atBottom(); this.controls(); }
    };
    this.resize = () => {
      if (!root.clientHeight) return;
      if (this.layoutAnchor) this.restoreLayout(this.layoutAnchor);
      else if (this.follow && !this.hasSelection(root)) root.scrollTop = root.scrollHeight;
      this.controls();
    };
    root.addEventListener('scroll', this.scroll, { passive: true });
    for (const type of ['wheel','touchstart','pointerdown','keydown']) root.addEventListener(type, this.interruptLayout, { passive: true });
    if (this.win.ResizeObserver) { this.resizeObserver = new this.win.ResizeObserver(this.resize); this.resizeObserver.observe(root); }
    root.ownerDocument.addEventListener('selectionchange', this.selection);
    latest.addEventListener('click', this.jump);
  }
  atBottom() { return this.root.scrollHeight - this.root.clientHeight - this.root.scrollTop < 64; }
  hasSelection(node) {
    const selection = this.win.getSelection();
    return !!selection && !selection.isCollapsed && selection.containsNode(node, true);
  }
  controls() { this.latest.hidden = this.follow || this.root.scrollHeight <= this.root.clientHeight; }
  captureLayout() {
    if (!this.root.clientHeight) return null;
    if (this.follow && !this.hasSelection(this.root)) return { bottom: true };
    const top = this.root.getBoundingClientRect().top;
    const node = [...this.root.children].find(child => child.getBoundingClientRect().bottom > top + 2);
    return { node, offset: node ? node.getBoundingClientRect().top - top : 0, scrollTop: this.root.scrollTop };
  }
  restoreLayout(anchor) {
    if (!anchor || !this.root.clientHeight) return;
    if (anchor.bottom) this.root.scrollTop = this.root.scrollHeight;
    else if (anchor.node?.isConnected) this.root.scrollTop += anchor.node.getBoundingClientRect().top - this.root.getBoundingClientRect().top - anchor.offset;
    else this.root.scrollTop = anchor.scrollTop;
  }
  layout(change, duration = 160) {
    const anchor = this.layoutAnchor || this.captureLayout();
    const now = this.win.performance?.now() ?? Date.now();
    this.layoutUntil = Math.max(this.layoutUntil || 0, now + Math.max(0, duration) + 32);
    this.layoutAnchor = anchor; this.win.clearTimeout(this.layoutTimer);
    try { return change(); }
    finally {
      this.restoreLayout(anchor);
      this.layoutTimer = this.win.setTimeout(() => { this.restoreLayout(this.layoutAnchor); this.layoutAnchor = null; this.layoutUntil = 0; this.layoutTimer = null; this.controls(); }, Math.max(0, this.layoutUntil - now));
    }
  }
  reset(scope) {
    if (scope === this.scope) return;
    this.interruptLayout(); this.scope = scope; this.entries.clear(); this.root.replaceChildren(); this.follow = true;
  }
  empty(scope, node) {
    this.reset(scope); this.follow = true; this.entries.clear(); this.root.replaceChildren(node); this.controls();
  }
  update(scope, messages, render, signature) {
    this.reset(scope); this.deferred = false;
    const keep = new Set(), next = new Map(); let index = 0;
    for (const message of messages) {
      let entry = this.entries.get(message); const value = signature(message);
      const same = entry && value.every((part, i) => part === entry.signature[i]);
      if (!same && entry && this.hasSelection(entry.node)) this.deferred = true;
      else if (!same) {
        const node = render(message);
        if (entry) entry.node.replaceWith(node);
        entry = { node, signature: value };
      }
      const node = entry.node; keep.add(node); next.set(message, entry);
      if (this.root.children[index] !== node) this.root.insertBefore(node, this.root.children[index] || null);
      index++;
    }
    for (const node of [...this.root.children]) if (!keep.has(node)) node.remove();
    this.entries = next;
    if (this.follow && !this.hasSelection(this.root)) this.root.scrollTop = this.root.scrollHeight;
    this.controls();
  }
  schedule() {
    if (this.closed || this.timer !== null) return;
    this.timer = this.win.setTimeout(() => { this.timer = null; this.refresh(); }, 80);
  }
  cancel() { if (this.timer !== null) this.win.clearTimeout(this.timer); this.timer = null; }
  destroy() {
    this.closed = true; this.cancel(); this.interruptLayout(); this.resizeObserver?.disconnect(); this.entries.clear();
    this.root.removeEventListener('scroll', this.scroll);
    for (const type of ['wheel','touchstart','pointerdown','keydown']) this.root.removeEventListener(type, this.interruptLayout);
    this.root.ownerDocument.removeEventListener('selectionchange', this.selection);
    this.latest.removeEventListener('click', this.jump);
  }
};
