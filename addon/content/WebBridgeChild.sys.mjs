/* SPDX-License-Identifier: MIT */
export class PaperCompanionWebChild extends JSWindowActorChild {
  checkOrigin() {
    if (this.document.location.origin !== "https://chatgpt.com" || this.browsingContext.parent) throw new Error("只能向 ChatGPT 主页面传入材料。");
  }
  editor() {
    const doc = this.document, win = this.contentWindow;
    const selectors = '#prompt-textarea, [id^="prompt-textarea"], [data-testid="prompt-textarea"], form textarea, form [contenteditable="true"], form [contenteditable="plaintext-only"], .ProseMirror[contenteditable], [role="textbox"][contenteditable]';
    const candidates = new Set();
    for (const node of doc.querySelectorAll(selectors)) {
      candidates.add(node);
      for (const child of node.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) candidates.add(child);
    }
    return [...candidates].filter(node => {
      const ownCompact = !!this.compactNode && node.closest('[data-pc-web-compact]') === this.compactNode;
      if (!node.isConnected || node.disabled || node.getAttribute('aria-disabled') === 'true' || node.matches(':disabled')) return false;
      if (node.localName !== 'textarea' && !node.isContentEditable) return false;
      if (node.closest('dialog, [role="dialog"]')) return false;
      const identified = node.id.startsWith('prompt-textarea') || node.getAttribute('data-testid') === 'prompt-textarea' || node.classList.contains('ProseMirror');
      if (!identified && !node.closest('form, [data-type="unified-composer"]')?.querySelector('[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"], #send')) return false;
      if (node.closest('[inert]') && !ownCompact) return false;
      const style = win.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && (ownCompact || [...node.getClientRects()].some(r => r.width > 0 && r.height > 0));
    }).sort((a, b) => {
      const score = node => (node.id === 'prompt-textarea' ? 100 : 0) + (node.getAttribute('data-testid') === 'prompt-textarea' ? 90 : 0) + (node.id.startsWith('prompt-textarea') ? 60 : 0) + (node.classList.contains('ProseMirror') ? 50 : 0) + (node.closest('form') ? 20 : 0);
      return score(b) - score(a);
    })[0] || null;
  }
  clearCompact() {
    if (!this.compactNode) return;
    const node = this.compactNode; node.removeAttribute('data-pc-web-compact');
    for (const [name, value] of Object.entries(this.compactAttributes)) {
      if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
    }
    for (const [name, value] of Object.entries(this.compactStyles)) {
      if (!value.value) node.style.removeProperty(name); else node.style.setProperty(name, value.value, value.priority);
    }
    this.compactNode = null;
  }
  applyPresentation() {
    if (this.filling) return;
    if (!this.compactRequested) { this.clearCompact(); return; }
    const editor = this.editor(); if (!editor) { this.clearCompact(); return; }
    let target = editor;
    // Collapse only the text branch. Model, attachment, voice and Send controls
    // remain native and visible, including any surrounding form.
    for (let i = 0; i < 3; i++) {
      const parent = target.parentElement;
      if (!parent || ['form', 'body', 'main', 'html'].includes(parent.localName)) break;
      const controls = [...parent.querySelectorAll('button, input, select, textarea, a, [role="button"], [data-message-author-role], [contenteditable]')];
      if (controls.some(node => node !== editor && !editor.contains(node))) break;
      target = parent;
    }
    if (this.compactNode === target && target.hasAttribute('data-pc-web-compact')) return;
    this.clearCompact();
    this.compactNode = target; this.compactAttributes = { inert: target.getAttribute('inert'), 'aria-hidden': target.getAttribute('aria-hidden') };
    const styles = { height: '0px', 'min-height': '0px', 'max-height': '0px', overflow: 'hidden', opacity: '0', 'pointer-events': 'none', 'margin-block': '0px', 'padding-block': '0px', 'border-block-width': '0px' };
    this.compactStyles = {};
    for (const [name, value] of Object.entries(styles)) { this.compactStyles[name] = { value: target.style.getPropertyValue(name), priority: target.style.getPropertyPriority(name) }; target.style.setProperty(name, value, 'important'); }
    target.setAttribute('data-pc-web-compact', ''); target.setAttribute('inert', ''); target.setAttribute('aria-hidden', 'true');
  }
  presentation(compact) {
    this.compactRequested = compact;
    if (compact && !this.presentationObserver) {
      this.presentationObserver = new this.contentWindow.MutationObserver(() => {
        if (this.presentationFrame || this.filling) return;
        this.presentationFrame = this.contentWindow.requestAnimationFrame(() => { this.presentationFrame = null; this.applyPresentation(); });
      });
      this.presentationObserver.observe(this.document, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable', 'disabled', 'aria-disabled'] });
    } else if (!compact && this.presentationObserver) { this.presentationObserver.disconnect(); this.presentationObserver = null; }
    this.applyPresentation(); return { compact, composer: !!this.editor(), collapsed: !!this.compactNode };
  }
  didDestroy() {
    this.presentationObserver?.disconnect();
    try { if (this.presentationFrame) this.contentWindow.cancelAnimationFrame(this.presentationFrame); } catch (_) {}
  }
  async receiveMessage({ name, data = {} }) {
    this.checkOrigin();
    const doc = this.document, win = this.contentWindow;
    if (name === "status") return { composer: !!this.editor(), fileInput: !!doc.querySelector('input[type="file"]') };
    if (name === 'presentation') return this.presentation(data.compact === true);
    if (name === "conversation") {
      const streaming = !!doc.querySelector('[data-testid="stop-button"], [data-is-streaming="true"], button[aria-label="Stop streaming"], button[aria-label="停止生成"]');
      if (streaming) return { streaming: true, turns: [], conversation: doc.location.pathname };
      const messages = [...doc.querySelectorAll('[data-message-author-role]')];
      if (!messages.length) throw new Error('尚未找到网页对话，或网页结构已变化。');
      const turns = []; let question = '';
      for (const node of messages) {
        const content = node.querySelector('.markdown') || node;
        const text = content.innerText?.trim() || content.textContent.trim();
        if (node.getAttribute('data-message-author-role') === 'user') question = text;
        if (node.getAttribute('data-message-author-role') === 'assistant' && text && question) turns.push({ question, answer: text, id: node.getAttribute('data-message-id') || String(turns.length) });
      }
      if (turns.reduce((n, t) => n + t.question.length + t.answer.length, 0) > 200000) throw new Error('网页对话超过 20 万字符，请分成较短的对话整理；不会静默截断。');
      return { streaming: false, turns, conversation: doc.location.pathname };
    }
    if (name === "fill") {
      const text = String(data.text || "");
      if (!text || text.length > 350000) throw new Error("传入文字为空或过长。");
      this.filling = true; this.clearCompact();
      try {
      let editor = this.editor(); const deadline = Date.now() + 1500;
      while (!editor && Date.now() < deadline) { await new Promise(resolve => win.setTimeout(resolve, 100)); editor = this.editor(); }
      if (!editor) throw new Error('暂未找到可输入的网页编辑区。请等待页面加载或回答结束，也可展开「网页输入」检查；本机问题已保留。');
      editor.focus();
      if (editor.localName === "textarea") {
        const before = editor.value;
        const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value").set;
        setter.call(editor, before ? before + "\n\n" + text : text);
        editor.dispatchEvent(new win.Event("input", { bubbles: true }));
      } else {
        const range = doc.createRange(); range.selectNodeContents(editor); range.collapse(false);
        const selection = win.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const prefix = editor.textContent.trim() ? "\n\n" : "";
        if (!doc.execCommand("insertText", false, prefix + text)) throw new Error("网页编辑器未接受自动输入，请使用复制后粘贴。");
      }
      await new Promise(resolve => win.setTimeout(resolve, 0));
      const current = this.editor() || editor, actual = current.localName === 'textarea' ? current.value : current.innerText || current.textContent;
      const normalize = value => String(value).replace(/\s+/g, ' ').trim();
      if (!normalize(actual).includes(normalize(text))) throw new Error('网页尚未确认接收文字，请展开网页输入检查草稿后再重试。本机问题已保留。');
      return { draft: true, charactersAdded: text.length }; // Never submit the conversation.
      } finally { this.filling = false; this.applyPresentation(); }
    }
    if (name === "attach") {
      const records = data.files;
      if (!Array.isArray(records) || !records.length || records.length > 30) throw new Error("本次附件数量无效。");
      if (records.reduce((n, f) => n + String(f.dataURL || "").length, 0) > 36 * 1048576) throw new Error("附件总量过大，请分批传入。");
      const inputs = Array.from(doc.querySelectorAll('input[type="file"]')).filter(i => !i.disabled);
      const accepts = (input, file) => !input.accept.trim() || input.accept.toLowerCase().split(',').some(s => {
        const rule = s.trim();
        return rule === '*/*' || rule === file.type || (rule.endsWith('/*') && file.type.startsWith(rule.slice(0, -1))) || (rule.startsWith('.') && String(file.name).toLowerCase().endsWith(rule));
      });
      const input = inputs.find(i => records.every(file => accepts(i, file)) && (records.length === 1 || i.multiple));
      if (!input) throw new Error("请先点网页里的「＋ / 添加文件」以显示附件控件，再点「附加到网页」。也可以导出后手动拖入。");
      const files = records.map(record => {
        if (!['image/png','application/pdf'].includes(record.type)) throw new Error("不支持的附件格式。");
        const prefix = `data:${record.type};base64,`;
        if (!record.dataURL.startsWith(prefix)) throw new Error("附件数据格式无效。");
        const raw = win.atob(record.dataURL.slice(prefix.length));
        const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
        return new win.File([Cu.cloneInto(bytes, win)], String(record.name).replace(/[\\/]/g, '_'), { type: record.type });
      });
      if (typeof input.mozSetFileArray === "function") input.mozSetFileArray(files);
      else { const transfer = new win.DataTransfer(); for (const file of files) transfer.items.add(file); input.files = transfer.files; }
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      return { count: files.length, staged: true }; // The page owns upload progress and completion.
    }
    throw new Error("未知的网页操作。");
  }
}
