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
      // The mobile website mounts Send only after input. Its known textarea
      // must be discoverable while the empty form still exposes only Voice.
      const mobile = node.localName === 'textarea' && node.id === 'mobile-composer-prompt' && !!node.closest('form');
      const identified = mobile || node.id.startsWith('prompt-textarea') || node.getAttribute('data-testid') === 'prompt-textarea' || node.classList.contains('ProseMirror');
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
    if (this.filling || this.submitting) return;
    if (!this.compactRequested) { this.clearCompact(); return; }
    const editor = this.editor(); if (!editor) { this.clearCompact(); return; }
    let target = editor;
    // Collapse only the text branch. Model, attachment, voice and Send controls
    // remain native and visible, including any surrounding form.
    for (let i = 0; i < 3; i++) {
      const parent = target.parentElement;
      if (!parent || ['form', 'body', 'main', 'html'].includes(parent.localName)) break;
      const controls = [...parent.querySelectorAll('button, input, select, textarea, a, [role="button"], [data-message-author-role], [data-message-role], [data-thread-find-target="conversation"] [data-chatgpt-search-unit-key], [contenteditable]')];
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
  conversationPath() { return this.document.location.pathname; }
  searchUnitRole(node) {
    const key = node?.getAttribute?.('data-chatgpt-search-unit-key') || '';
    return node?.closest?.('[data-thread-find-target="conversation"]') ? key.match(/:(user|assistant)$/)?.[1] || '' : '';
  }
  searchUnitsUnclear() {
    return [...this.document.querySelectorAll('[data-thread-find-target="conversation"] [data-chatgpt-search-unit-key]')].some(node => this.searchUnitRole(node) && this.visible(node) && !this.messageID(node));
  }
  messageRole(node) { const role = node?.getAttribute?.('data-message-author-role') || node?.getAttribute?.('data-message-role'); return ['user','assistant'].includes(role) ? role : this.searchUnitRole(node); }
  messageID(node) {
    if (this.searchUnitRole(node)) {
      const ids = (node.getAttribute('data-chatgpt-search-message-ids') || '').trim().split(/\s+/);
      // The website repeats an assistant UUID in the search unit. Deduplicate
      // that identity, but never merge a unit carrying distinct message IDs.
      if (!ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return '';
      const unique = new Set(ids.map(id => id.toLowerCase())); return unique.size === 1 ? [...unique][0] : '';
    }
    const legacy = node?.getAttribute?.('data-message-id'); if (legacy) return legacy;
    const id = node?.getAttribute?.('id') || node?.id || '';
    return node?.matches?.('ol[data-conversation-transcript] > li[data-message-role]') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '';
  }
  messageNodes() {
    const selector = '[data-message-author-role],ol[data-conversation-transcript] > li[data-message-role],[data-thread-find-target="conversation"] [data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]';
    return [...this.document.querySelectorAll(selector)].filter(node => {
      if (!this.messageRole(node) || this.searchUnitRole(node) && (!this.messageID(node) || !this.visible(node))) return false;
      const parent = node.parentElement?.closest(selector);
      return !parent || this.messageRole(parent) !== this.messageRole(node);
    });
  }
  messageOwner(node) {
    const legacy = node.closest?.('[data-message-author-role]'); if (this.messageRole(legacy)) return legacy;
    const modern = node.closest?.('ol[data-conversation-transcript] > li[data-message-role]'); if (this.messageRole(modern)) return modern;
    const unit = node.closest?.('[data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]'); if (this.searchUnitRole(unit) && this.messageID(unit)) return unit;
    return node.closest?.('article,[data-testid^="conversation-turn-"]')?.querySelector('[data-message-author-role],ol[data-conversation-transcript] > li[data-message-role]');
  }
  visible(node) {
    if (!node?.isConnected || node.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = this.contentWindow.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && [...node.getClientRects()].some(r => r.width && r.height);
  }
  composerRoot() {
    const editor = this.editor();
    return editor?.form || editor?.closest('form') || editor?.closest('[data-type="unified-composer"]') || this.document;
  }
  draftText() { const editor = this.editor(); return editor ? String(editor.value ?? editor.innerText ?? editor.textContent).trim() : ''; }
  normalized(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  sendButtons() {
    const editor = this.editor(); if (!editor) return [];
    const root = this.composerRoot(), form = editor.form || editor.closest('form');
    const selector = '[data-testid="send-button"],button[aria-label="Send"],button[aria-label="Send prompt"],button[aria-label="Send message"],button[aria-label="发送"],button[aria-label="发送提示"],button[aria-label="发送消息"],button#send';
    const candidates = new Set();
    // A unified-composer can describe only the text branch. Its toolbar may
    // be a sibling, or be associated with the same HTML form from outside it.
    for (const scope of new Set([root, form].filter(Boolean)))
      for (const node of scope.querySelectorAll(selector)) candidates.add(node);
    const knownEditor = editor.id === 'mobile-composer-prompt' || editor.id?.startsWith('prompt-textarea') ||
      editor.getAttribute?.('data-testid') === 'prompt-textarea' || editor.classList?.contains('ProseMirror');
    if (form) for (const node of Array.from(form.elements || [])) {
      if (node.matches?.(selector) || knownEditor && node.localName === 'button' && node.type === 'submit') candidates.add(node);
    }
    return [...candidates].filter(node => node.localName === 'button' && this.visible(node) &&
      (!form || (node.form === undefined ? node.closest?.('form') === form : node.form === form)));
  }
  enabled(node) { return !!node && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !node.matches(':disabled'); }
  stopButtons() {
    return [...this.document.querySelectorAll('button[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止流式传输"]')].filter(node => this.visible(node));
  }
  isStreaming() {
    return !!this.stopButtons().length || [...this.document.querySelectorAll('[data-is-streaming="true"],[data-message-streaming="true"],[data-message-author-role="assistant"][aria-busy="true"],ol[data-conversation-transcript] > li[data-message-role="assistant"][aria-busy="true"]')].some(node => this.visible(node)) ||
      this.messageNodes().some(node => this.searchUnitRole(node) === 'assistant' && this.searchTurnState(node) !== null && this.searchTurnState(node) !== 'complete' && this.visible(node));
  }
  attachmentNodes() {
    return [...this.composerRoot().querySelectorAll('[data-file-id],[data-testid*="attachment"],[data-testid*="file-upload"],[data-testid^="file-"],button[aria-label^="Remove file"],button[aria-label*="Remove attachment"],button[aria-label*="移除文件"]')].filter(node => this.visible(node));
  }
  hasAttachments() {
    return !!this.attachmentNodes().length || [...this.document.querySelectorAll('input[type="file"]')].some(node => node.files?.length);
  }
  validateFiles(files) {
    if (!Array.isArray(files) || files.length > 30) throw new Error('本次附件数量无效。');
    if (files.reduce((total, file) => total + String(file?.dataURL || '').length, 0) > 36 * 1048576) throw new Error('附件总量过大，请分批传入。');
    for (const file of files) {
      if (!file || !['image/png', 'application/pdf'].includes(file.type) || typeof file.name !== 'string' || !file.name.trim()) throw new Error('不支持的附件格式或文件名。');
      if (typeof file.dataURL !== 'string' || !file.dataURL.startsWith(`data:${file.type};base64,`)) throw new Error('附件数据格式无效。');
    }
  }
  attachmentInput(files) {
    return [...this.document.querySelectorAll('input[type="file"]')].find(input => !input.disabled && (files.length === 1 || input.multiple) && files.every(file => !input.accept.trim() || input.accept.toLowerCase().split(',').some(value => {
      const rule = value.trim(); return rule === '*/*' || rule === file.type || (rule.endsWith('/*') && file.type.startsWith(rule.slice(0, -1))) || (rule.startsWith('.') && file.name.toLowerCase().endsWith(rule));
    })));
  }
  stagedFileNodes(files) {
    const nodes = this.attachmentNodes(), used = new Set();
    for (const file of files) {
      const name = this.normalized(file.name), matches = nodes.filter(node => this.normalized([node.innerText || node.textContent, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-filename')].filter(Boolean).join(' ')).includes(name));
      // Use one distinct file chip for each requested file. A list wrapper that
      // contains every filename cannot falsely confirm several uploads at once.
      const leaves = matches.filter(node => !matches.some(other => other !== node && node.contains(other))), match = leaves.find(node => !used.has(node));
      if (!match) return null; used.add(match);
    }
    if (nodes.some(node => ![...used].some(file => node === file || node.contains(file) || file.contains(node)))) return null;
    const remaining = files.map(file => file.name + '\n' + file.type);
    for (const file of [...this.document.querySelectorAll('input[type="file"]')].flatMap(input => [...(input.files || [])])) {
      const at = remaining.indexOf(file.name + '\n' + file.type); if (at < 0) return null; remaining.splice(at, 1);
    }
    return [...used];
  }
  stagedFilesMatch(files) { return !!this.stagedFileNodes(files); }
  attachmentIdentity(node) { return node.getAttribute('data-file-id') || node.closest?.('[data-file-id]')?.getAttribute('data-file-id') || ''; }
  captureStage(record) {
    const nodes = this.stagedFileNodes(record.files); if (!nodes || record.attachmentTampered) return;
    // Capture only this injection's first chip identities. A later same-name
    // replacement must never become trusted merely by being observed again.
    if (!record.attachmentOwnership) record.attachmentOwnership = nodes.map(node => ({ node, id: this.attachmentIdentity(node) }));
    else for (const old of record.attachmentOwnership) if (nodes.includes(old.node) && !old.id) old.id = this.attachmentIdentity(old.node);
  }
  ownsStagedFiles(record) {
    if (record.attachmentTampered || !record.attachmentOwnership?.length) return false;
    const nodes = this.stagedFileNodes(record.files), used = new Set(); if (!nodes) return false;
    for (const node of nodes) {
      const identity = this.attachmentIdentity(node), old = record.attachmentOwnership.find(item => !used.has(item) && (item.node === node || identity && item.id === identity));
      if (!old) return false; used.add(old);
    }
    const inputs = [...this.document.querySelectorAll('input[type="file"]')].flatMap(input => [...(input.files || [])]);
    return inputs.every(file => record.injectedFiles?.includes(file));
  }
  uploadsReady(files) { return this.stagedFilesMatch(files) && !this.uploading(); }
  uploading() {
    return [...this.composerRoot().querySelectorAll('[role="progressbar"],[aria-busy="true"],[data-testid*="upload"] .animate-spin,[data-testid*="upload"][data-state="loading"]')].some(node => this.visible(node));
  }
  blocked() {
    if ([...this.document.querySelectorAll('#challenge-form,iframe[src*="challenges.cloudflare.com"],dialog[open],[role="dialog"][aria-modal="true"]')].some(node => this.visible(node)))
      return '网页有登录、验证或确认窗口，请打开网页完成后再发送。';
    if ([...this.document.querySelectorAll('[data-testid="login-button"],[data-testid="log-in-button"],button[data-login-button],[data-mobile-auth-entry-action="login"],a[href^="/auth/login"],a[href^="https://chatgpt.com/auth/login"]')].some(node => this.visible(node)))
      return '请先在网页登录 ChatGPT，完成后即可在插件中继续提问。';
    return '';
  }
  errorNodes() {
    return [...this.document.querySelectorAll('[data-testid="conversation-turn-error"],[data-testid="error-message"],[role="alert"]')].filter(node => this.visible(node) && node.textContent.trim() && (node.getAttribute('role') !== 'alert' || /error|failed|limit|unavailable|try again|something went wrong|错误|失败|额度|限制|无法|重试|出错/i.test(node.textContent)));
  }
  requestFailure(record) {
    const node = this.errorNodes().find(node => {
      if (!record || record.answerNode?.contains(node)) return true;
      const owner = this.messageOwner(node);
      if (owner && [record.userID, record.messageID].filter(Boolean).includes(this.messageID(owner))) return true;
      if (owner && record.baselineIDs?.has(this.messageID(owner))) return false;
      return !record.baselineErrors?.some(old => old.node === node && old.text === node.textContent.trim());
    });
    return node ? node.textContent.trim().slice(0, 500) : '';
  }
  pageStatus() {
    const messages = this.messageNodes(), users = messages.filter(n => this.messageRole(n) === 'user'), assistants = messages.filter(n => this.messageRole(n) === 'assistant');
    return { composer: !!this.editor(), fileInput: !!this.document.querySelector('input[type="file"]'), readyState: this.document.readyState, streaming: this.isStreaming(), conversation: this.conversationPath(), draft: this.draftText(),
      userCount: users.length, assistantCount: assistants.length, lastUserID: this.messageID(users.at(-1)), lastAssistantID: this.messageID(assistants.at(-1)),
      attachments: this.hasAttachments(), uploading: this.uploading(), blocked: this.blocked() };
  }
  markdown(node) {
    // Read only the visible answer DOM, never page HTML. Protected code/math
    // fragments retain whitespace while surrounding prose is normalized.
    const fragments = [], protect = text => '\uE000' + (fragments.push(text) - 1) + '\uE001';
    const children = node => [...node.childNodes].map(render).join('');
    const render = node => {
      if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
      if (node.nodeType !== 1 || ['script', 'style', 'button', 'input', 'textarea', 'select', 'svg', 'nav'].includes(node.localName) || node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return '';
      const tag = node.localName, annotation = node.querySelector('annotation[encoding="application/x-tex"]');
      if (annotation && (tag === 'math' || node.classList.contains('katex') || node.classList.contains('katex-display'))) {
        const display = tag === 'math' ? node.getAttribute('display') === 'block' : node.classList.contains('katex-display');
        return protect(display ? '\n\n$$\n' + annotation.textContent.trim() + '\n$$\n\n' : '$' + annotation.textContent.trim() + '$');
      }
      if (tag === 'pre') {
        const code = node.querySelector('code') || node, text = code.textContent.replace(/\n$/, ''), ticks = Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1));
        const language = [...code.classList].find(c => c.startsWith('language-'))?.slice(9).replace(/[^\w+-]/g, '') || '';
        const fence = '`'.repeat(ticks); return protect('\n\n' + fence + language + '\n' + text + '\n' + fence + '\n\n');
      }
      if (tag === 'code') { const text = node.textContent, fence = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1))), pad = /^[`\s]|[`\s]$/.test(text) ? ' ' : ''; return protect(fence + pad + text + pad + fence); }
      if (tag === 'br') return '\n';
      if (tag === 'hr') return '\n\n---\n\n';
      if (tag === 'img') return node.getAttribute('alt') || '';
      if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')].map(row => [...row.children].filter(c => ['td', 'th'].includes(c.localName)).map(c => children(c).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '))).filter(row => row.length);
        if (!rows.length) return '';
        const width = Math.max(...rows.map(row => row.length)), line = row => '| ' + Array.from({ length: width }, (_, i) => row[i] || '').join(' | ') + ' |';
        return '\n\n' + [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
      }
      if (tag === 'ul' || tag === 'ol') {
        let index = parseInt(node.getAttribute('start'), 10) || 1;
        return '\n\n' + [...node.children].filter(child => child.localName === 'li').map(item => {
          const prefix = tag === 'ol' ? index++ + '. ' : '- ', text = children(item).trim();
          return prefix + text.replace(/\n/g, '\n' + ' '.repeat(prefix.length));
        }).join('\n') + '\n\n';
      }
      const text = children(node);
      if (tag === 'a') { const href = node.getAttribute('href') || ''; return /^https?:\/\//i.test(href) ? '[' + text + '](' + href.replace(/\)/g, '%29') + ')' : text; }
      if (tag === 'strong' || tag === 'b') return '**' + text.trim() + '**';
      if (tag === 'em' || tag === 'i') return '*' + text.trim() + '*';
      if (tag === 'del' || tag === 's') return '~~' + text.trim() + '~~';
      if (/^h[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + text.trim() + '\n\n';
      if (tag === 'blockquote') return '\n\n' + text.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
      return ['p', 'div', 'section', 'article'].includes(tag) ? '\n\n' + text.trim() + '\n\n' : text;
    };
    return render(node).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().replace(/\uE000(\d+)\uE001/g, (_, i) => fragments[Number(i)]).trim();
  }
  answerText(node) { return this.markdown(node.querySelector('[data-assistant-markdown-root]') || node.querySelector('[data-assistant-markdown]') || node.querySelector('[data-markdown-text-style="assistant-message"]') || node.querySelector('.markdown,[data-message-content]') || node); }
  userContent(node) { return node.querySelector?.('[data-user-message-copy]:not(button),[data-user-message-bubble]:not(button)') || node.querySelector?.('[data-message-content],.whitespace-pre-wrap') || node; }
  userText(node) { const content = this.userContent(node); return this.normalized(content.innerText || content.textContent); }
  userTextMatches(node, sent) {
    const content=this.userContent(node);
    // Layout may collapse a paragraph break in innerText. Accept either exact
    // text representation, keeping whitespace boundaries and fresh-turn IDs.
    return this.userText(node)===sent||this.normalized(content.textContent)===sent;
  }
  searchTurnState(node) {
    if (!this.searchUnitRole(node)) return null;
    const turn = node.closest?.('[data-talvt-turn-state]');
    return turn?.closest('[data-thread-find-target="conversation"]') ? turn.getAttribute('data-talvt-turn-state') : null;
  }
  hasCompletionControl(node) {
    const state = this.searchTurnState(node);
    if (this.searchUnitRole(node)) return state === 'complete' && this.searchUnitRole(node) === 'assistant' && !!this.messageID(node) && this.visible(node);
    const turn = node.closest('ol[data-conversation-transcript] > li[data-message-role],article,[data-testid^="conversation-turn-"]') || node;
    if (this.messageRole(turn) === 'assistant' && this.messageID(turn) && turn.hasAttribute('data-message-complete') && turn.getAttribute('data-message-complete') !== 'false' && this.visible(turn)) return true;
    return [...turn.querySelectorAll('[data-testid="copy-turn-action-button"],button[data-copy-message],button[aria-label="Copy"],button[aria-label="Copy response"],button[aria-label="复制"],button[aria-label="复制回复"]')].some(control => this.visible(control));
  }
  snapshot(record) {
    return { requestID: record.id, known: true, state: record.state, submitted: record.submitted, text: record.text, conversation: record.conversation, messageID: record.messageID,
      userID: record.userID || '', ...(record.error ? { error: record.error } : {}), ...(record.cancelled ? { cancelled: true } : {}),
      ...(record.needsInteraction ? { needsInteraction: true } : {}), ...(record.retryable ? { retryable: true } : {}), ...(record.idleVerified ? { idleVerified: true } : {}) };
  }
  ownsStage(record) {
    try {
      return !record.submitted && this.conversationPath() === record.baseConversation && this.messageNodes().length === record.baselineCount &&
        this.normalized(this.draftText()) === record.sentNormalized && !this.isStreaming() && !this.blocked() && !this.searchUnitsUnclear() &&
        (record.files.length ? record.attached && this.ownsStagedFiles(record) : !this.hasAttachments());
    } catch (_) { return false; }
  }
  finishRequest(record, state, error = '') {
    record.state = state; record.error = error;
    record.observer?.disconnect(); record.observer = null;
    this.contentWindow.clearTimeout(record.checkTimer); this.contentWindow.clearTimeout(record.deadlineTimer); record.checkTimer = record.deadlineTimer = null;
    if (this.activeRequest === record) this.activeRequest = null;
    if (record.submitted && record.stageInput && record.stageWatch) { record.stageInput.removeEventListener('change', record.stageWatch); record.stageWatch = null; }
    return this.snapshot(record);
  }
  refreshRequest(record) {
    if (['complete', 'failed', 'uncertain'].includes(record.state) || !record.submitted) return this.snapshot(record);
    const path = this.conversationPath(), now = Date.now();
    if (path !== record.baseConversation && !(record.baseConversation === '/' && /^\/c\/[^/]+\/?$/.test(path))) return this.finishRequest(record, 'uncertain', '网页对话已切换。请查看网页确认本轮结果；不会自动重发。');
    record.conversation = path;
    if (this.searchUnitsUnclear()) return this.finishRequest(record, 'uncertain', '网页消息身份无法唯一确认，请查看网页；不会混入或自动重发。');
    const nodes = this.messageNodes();
    let user = record.userID ? nodes.find(n => this.messageID(n) === record.userID) : nodes.includes(record.userNode) ? record.userNode : null;
    if (!user) user = nodes.find((node, index) => index >= record.baselineCount && this.messageRole(node) === 'user' && !record.baselineNodes.has(node) && !record.baselineIDs.has(this.messageID(node)) && this.userTextMatches(node,record.sentNormalized));
    if (!user) {
      if (now - record.clickedAt > 20000) return this.finishRequest(record, 'uncertain', '网页未确认接收本轮问题。请查看网页；为避免重复发送，不会自动重试。');
      return this.snapshot(record);
    }
    record.userNode = user; record.userID = this.messageID(user);
    let answer;
    for (const node of nodes.slice(nodes.indexOf(user) + 1)) {
      if (this.messageRole(node) === 'user') return this.finishRequest(record, 'uncertain', '网页中出现了另一条提问，已停止同步以避免混入其他回答。');
      if (this.messageRole(node) === 'assistant' && !record.baselineIDs.has(this.messageID(node))) answer = node;
    }
    record.answerNode = answer;
    const error = this.requestFailure(record); if (error) return this.finishRequest(record, 'failed', '网页返回：' + error);
    if (!answer) return this.snapshot(record);
    record.answerNode = answer; record.messageID = this.messageID(answer);
    const text = this.answerText(answer);
    if (text.length > 350000) return this.finishRequest(record, 'uncertain', '网页回复超过可同步范围，请在网页查看完整结果；不会截断后当作完整回答。');
    if (text !== record.text) { record.text = text; record.changedAt = now; }
    if (this.isStreaming()) { record.sawStreaming = true; record.state = 'streaming'; record.stoppedAt = null; return this.snapshot(record); }
    record.stoppedAt ||= now;
    const stableFor = now - Math.max(record.changedAt || now, record.stoppedAt);
    if (text && ((this.hasCompletionControl(answer) && stableFor >= 650) || (!this.searchUnitRole(answer) && record.sawStreaming && this.editor() && stableFor >= 1200))) return this.finishRequest(record, 'complete');
    if (text) record.state = 'streaming';
    return this.snapshot(record);
  }
  observeRequest(record) {
    record.observer = new this.contentWindow.MutationObserver(() => {
      if (record.checkTimer) return;
      record.checkTimer = this.contentWindow.setTimeout(() => { record.checkTimer = null; try { this.refreshRequest(record); } catch (_) { this.finishRequest(record, 'uncertain', '网页结构变化，无法确认本轮回复，请查看网页；不会自动重发。'); } }, 75);
    });
    record.observer.observe(this.document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-busy', 'data-is-streaming', 'data-message-streaming', 'data-talvt-turn-state'] });
    record.deadlineTimer = this.contentWindow.setTimeout(() => this.finishRequest(record, 'uncertain', '本轮网页等待时间过长，请查看网页确认结果；不会自动重发。'), 480000);
  }
  sendUnavailableReason(record) {
    const blocked = this.blocked(); if (blocked) return blocked;
    const failure = this.requestFailure(record); if (failure) return '网页返回：' + failure;
    if (this.normalized(this.draftText()) !== record.sentNormalized) return '网页未保留本轮输入，尚未发送。请查看网页；本机问题已保留。';
    if (this.uploading()) return '网页附件仍在上传，尚未发送；草稿已保留，请查看网页。';
    const buttons = this.sendButtons();
    if (!buttons.length) return '尚未识别到网页发送按钮，尚未发送；草稿已保留，请查看网页。';
    if (buttons.length === 1 && !this.enabled(buttons[0])) return '网页发送按钮尚未启用，尚未发送；草稿已保留，请查看网页。';
    return '网页发送按钮状态尚未稳定，尚未发送；草稿已保留，请查看网页。';
  }
  async performSubmit(record, files, continuing = false) {
    const win = this.contentWindow, pause = ms => new Promise(resolve => win.setTimeout(resolve, ms));
    const ensure = () => { if (record.cancelled) throw new Error('已取消本轮网页发送。'); if (Date.now() > record.preparationDeadline) throw new Error('网页材料准备超时，未自动发送，请查看网页。'); if (this.conversationPath() !== record.baseConversation) throw new Error('网页对话已切换，请重新确认后发送。'); };
    this.submitting=true;
    try {
      record.state = 'preparing';
      ensure(); if (!continuing) await this.receiveMessage({ name: 'fill', data: { text: record.sentText } }); ensure();
      if (files.length) {
        record.state = 'uploading';
        if (!continuing) { await this.receiveMessage({ name: 'attach', data: { files } }); record.attached = true; this.captureStage(record); }
        const deadline = Math.min(record.preparationDeadline, Date.now() + 90000); let readySince = 0;
        while (Date.now() < deadline) {
          ensure(); const error = this.requestFailure(record); if (error) throw new Error('网页附件上传未完成：' + error);
          if (this.uploadsReady(files)) { this.captureStage(record); readySince ||= Date.now(); if (Date.now() - readySince >= 250) break; } else readySince = 0;
          await pause(100);
        }
        if (!readySince || Date.now() - readySince < 250) throw new Error('无法确认网页附件已上传完成，未自动发送。请查看网页附件后再操作。');
      }
      // Empty Chat pages show a voice control instead of Send. Fill first,
      // then let the site's input state render one explicit Send control.
      record.state = 'preparing';
      const deadline = Math.min(record.preparationDeadline,Date.now()+15000); let button;
      while (Date.now() < deadline) {
        ensure(); const buttons = this.sendButtons();
        if (buttons.length > 1) throw new Error('网页发送按钮无法唯一确认，未自动发送。请查看网页。');
        if (buttons.length===1&&this.enabled(buttons[0]) && !this.uploading()) { button = buttons[0]; break; }
        await pause(100);
      }
      if (!button) throw new Error(this.sendUnavailableReason(record));
      ensure();
      if (this.normalized(this.draftText()) !== record.sentNormalized || this.messageNodes().length !== record.baselineCount || this.searchUnitsUnclear() || this.isStreaming() || this.blocked()) throw new Error('网页草稿或对话在准备期间改变，未自动发送，请查看网页。');
      if (continuing && files.length && !this.ownsStagedFiles(record)) throw new Error('原附件在继续准备期间改变，未自动发送，请查看网页确认材料。');
      // Register ownership before the sole click. An ambiguous acknowledgement
      // is never grounds for clicking again, even if the caller times out.
      record.submitted = true; record.state = 'submitted'; record.clickedAt = Date.now(); this.observeRequest(record); button.click();
      return this.refreshRequest(record);
    } catch (error) { record.needsInteraction = !record.cancelled; record.retryable = this.ownsStage(record); return this.finishRequest(record, record.submitted ? 'uncertain' : 'failed', error.message); }
    finally { this.submitting=false;try{this.applyPresentation();}catch(_){} }
  }
  async submit(data) {
    const id = String(data.requestID || ''), text = String(data.text || ''), files = data.files || [];
    if (!/^[\w:-]{1,128}$/.test(id) || !text.trim() || text.length > 350000) throw new Error('本轮网页请求标识或文字无效。');
    this.validateFiles(files);
    this.requests ||= new Map();
    const existing = this.requests.get(id);
    if (existing) { if (existing.sentText !== text) throw new Error('同一网页请求不能替换成另一条问题。'); await existing.operation; return this.snapshot(existing); }
    const blocked = this.blocked(); if (blocked) throw new Error(blocked);
    if (this.searchUnitsUnclear()) throw new Error('网页消息身份无法唯一确认，未自动发送，请查看网页结构；本机问题已保留。');
    if (this.activeRequest || this.isStreaming()) throw new Error('网页正在回答，请等待完成或先停止。');
    if (!this.editor()) throw new Error('暂未找到可输入的网页编辑区，请打开网页完成登录或验证。');
    if (data.expectedConversation !== undefined && data.expectedConversation !== this.conversationPath()) throw new Error('网页对话与本篇绑定不一致，请查看网页或新建对话。');
    if (this.draftText()) throw new Error('网页里已有未发送的草稿，未覆盖或发送。请打开网页处理原草稿后重试。');
    if (this.hasAttachments()) throw new Error('网页里已有未发送的附件，未混入本轮。请打开网页处理原附件后重试。');
    if (files.length && !this.attachmentInput(files)) throw new Error('网页附件控件暂不可用，未传入或发送材料。请打开网页检查附件入口。');
    if (this.sendButtons().length > 1) throw new Error('暂未找到唯一的网页发送按钮，请打开网页检查。');
    const nodes = this.messageNodes(), record = { id, sentText: text, sentNormalized: this.normalized(text), baseConversation: this.conversationPath(), conversation: this.conversationPath(), baselineCount: nodes.length,
      baselineNodes: new Set(nodes), baselineIDs: new Set(nodes.map(n => this.messageID(n)).filter(Boolean)), baselineErrors: this.errorNodes().map(node => ({ node, text: node.textContent.trim() })), files,
      state: 'preparing', submitted: false, text: '', messageID: '', changedAt: Date.now(), preparationDeadline: Date.now() + 97000 };
    this.requests.set(id, record); this.activeRequest = record;
    while (this.requests.size > 8) { const old = [...this.requests].find(([, value]) => value !== record && ['complete', 'failed', 'uncertain'].includes(value.state)); if (!old) break; if (old[1].stageWatch) old[1].stageInput.removeEventListener('change', old[1].stageWatch); this.requests.delete(old[0]); }
    record.operation = this.performSubmit(record, files); await record.operation; return this.snapshot(record);
  }
  requestStatus(id) {
    const record = this.requests?.get(String(id || ''));
    return record ? this.refreshRequest(record) : { requestID: String(id || ''), known: false, state: 'uncertain', submitted: true, text: '', conversation: this.conversationPath(), messageID: '', error: '网页已刷新或本轮标识不可用，请查看网页确认；不会自动重发。' };
  }
  async retryStaged(data) {
    const record = this.requests?.get(String(data.requestID || ''));
    if (!record || record.submitted || this.activeRequest || !record.retryable || !this.ownsStage(record)) throw new Error('无法确认这是插件本轮留下的原草稿和附件，请查看网页处理；不会覆盖未知内容。');
    record.cancelled = false; record.retryable = false; record.needsInteraction = false; record.error = '';
    record.preparationDeadline = Date.now() + 97000; this.activeRequest = record;
    record.operation = this.performSubmit(record, record.files, true); await record.operation; return this.snapshot(record);
  }
  recoverRequest(data) {
    const id = String(data.requestID || ''), unknown = message => ({ requestID: id, state: 'uncertain', submitted: true, text: '', conversation: this.conversationPath(), messageID: '', needsInteraction: true, error: message });
    let record = this.requests?.get(id);
    if (record && !record.submitted) {
      record.retryable = !this.activeRequest && this.ownsStage(record);
      return { ...this.snapshot(record), ...(record.retryable ? { state: 'staged', retryable: true } : {}) };
    }
    if (this.searchUnitsUnclear()) return unknown('网页消息身份无法唯一确认，不能安全恢复，请查看网页。');
    // A reloaded actor needs the saved exact conversation, count and full text.
    // Old checkpoints lacking userID can migrate only on the newly identified
    // search-unit DOM; a persisted but different ID is never replaced by text.
    if (!record) {
      if (!/^\/c\/[A-Za-z0-9_-]+$/.test(data.conversation || '') || data.conversation !== this.conversationPath() || !data.sentText || !Number.isSafeInteger(data.baselineUserCount) || data.baselineUserCount < 0)
        return unknown('本轮缺少可跨刷新核对的网页身份，请在网页确认结果或新建对话；不会猜测或自动重发。');
      const nodes = this.messageNodes(), users = nodes.filter(node => this.messageRole(node) === 'user'), user = users.at(-1);
      const userID = this.messageID(user), identified = data.userID ? userID === data.userID : this.searchUnitRole(user) === 'user' && !!userID;
      if (users.length !== data.baselineUserCount + 1 || !identified || !this.userTextMatches(user, this.normalized(data.sentText)))
        return unknown('网页回合与本轮保存的身份不一致，无法安全恢复，请查看网页；不会混入其他对话。');
      const before = nodes.slice(0, nodes.indexOf(user)), oldErrors = this.errorNodes().filter(error => {
        const owner = this.messageOwner(error);
        return owner && before.includes(owner);
      });
      record = { id, submitted: true, state: 'uncertain', text: '', sentNormalized: this.normalized(data.sentText), userID, userNode: user, baseConversation: data.conversation, conversation: data.conversation, baselineIDs: new Set(before.map(node => this.messageID(node)).filter(Boolean)), baselineNodes: new Set(before), baselineCount: nodes.indexOf(user), baselineErrors: oldErrors.map(node => ({ node, text: node.textContent.trim() })), cancelled: data.cancelled === true };
      this.requests ||= new Map(); this.requests.set(id, record);
    }
    const path = this.conversationPath(), nodes = this.messageNodes(), users = nodes.filter(node => this.messageRole(node) === 'user');
    if (path !== record.baseConversation && !(record.baseConversation === '/' && /^\/c\/[^/]+\/?$/.test(path))) return unknown('网页已切换到另一段对话，不能恢复本轮。');
    let user = record.userID ? users.find(node => this.messageID(node) === record.userID) : users.find(node => !record.baselineNodes.has(node) && !record.baselineIDs.has(this.messageID(node)) && nodes.indexOf(node) >= record.baselineCount && this.userTextMatches(node, record.sentNormalized));
    if (!user || user !== users.at(-1) || !this.userTextMatches(user, record.sentNormalized)) return unknown('尚未找到可精确核对的本轮问题，请查看网页确认；不会自动重发。');
    if (Number.isSafeInteger(data.baselineUserCount) && users.length !== data.baselineUserCount + 1) return unknown('网页提问数已改变，不能把其他回合当作本轮恢复。');
    record.userID = this.messageID(user); record.userNode = user; record.conversation = path;
    const answers = nodes.slice(nodes.indexOf(user) + 1).filter(node => this.messageRole(node) === 'assistant'), answer = answers.at(-1), text = answer ? this.answerText(answer) : '';
    if (text.length > 350000) return unknown('网页回复超过可同步范围，请在网页查看完整结果。');
    record.answerNode = answer; record.messageID = this.messageID(answer); record.text = text;
    if (this.isStreaming()) { record.recoveryIdleAt = 0; return { ...this.snapshot(record), state: 'streaming', idleVerified: false }; }
    if (this.blocked() || !this.editor()) return unknown(this.blocked() || '网页尚未就绪，请完成登录后再检查。');
    if (record.recoveryText !== text || !record.recoveryIdleAt) { record.recoveryText = text; record.recoveryIdleAt = Date.now(); }
    if (Date.now() - record.recoveryIdleAt < 700) return { ...this.snapshot(record), state: 'recovering', idleVerified: false };
    const error = this.requestFailure(record);
    if (!record.cancelled && !error && (!text || !this.hasCompletionControl(answer))) return unknown('本轮回复尚无可确认的结束标志，请在网页检查后再恢复。');
    record.idleVerified = true; record.error = error ? '网页返回：' + error : '';
    record.state = record.cancelled ? 'cancelled' : error ? 'failed' : 'complete';
    record.observer?.disconnect(); record.observer = null; if (this.activeRequest === record) this.activeRequest = null;
    return this.snapshot(record);
  }
  stopRequest(id) {
    const record = this.requests?.get(String(id || ''));
    if (!record || ['complete', 'failed', 'uncertain'].includes(record.state)) return this.requestStatus(id);
    this.refreshRequest(record);
    if (['complete', 'failed', 'uncertain'].includes(record.state)) return this.snapshot(record);
    if (record.submitted) {
      const buttons = this.stopButtons();
      if (!record.userNode || this.activeRequest !== record || buttons.length !== 1) return this.finishRequest(record, 'uncertain', '无法确认网页当前生成属于本轮，请打开网页停止；不会操作其他对话。');
      buttons[0].click();
    }
    record.cancelled = true;
    if (!record.submitted) {
      // A fill/upload promise may still be unwinding. Keep ownership until its
      // ensure() observes cancellation, so a new request cannot race that write.
      record.state = 'failed'; record.error = '已取消本轮网页发送。'; return this.snapshot(record);
    }
    return this.finishRequest(record, 'failed', '已请求停止网页生成，保留已读取的内容。');
  }
  didDestroy() {
    this.presentationObserver?.disconnect();
    for (const record of this.requests?.values() || []) { record.observer?.disconnect(); try { if (record.stageWatch) record.stageInput.removeEventListener('change', record.stageWatch); this.contentWindow.clearTimeout(record.checkTimer); this.contentWindow.clearTimeout(record.deadlineTimer); } catch (_) {} }
    try { if (this.presentationFrame) this.contentWindow.cancelAnimationFrame(this.presentationFrame); } catch (_) {}
  }
  async receiveMessage({ name, data = {} }) {
    this.checkOrigin();
    const doc = this.document, win = this.contentWindow;
    if (name === "status") return this.pageStatus();
    if (name === 'submit') {
      try {
        let rejected; const operation = this.submit(data); operation.catch(error => { rejected = error; }); await Promise.resolve(); if (rejected) throw rejected;
        const record = this.requests?.get(String(data.requestID || ''));
        return record ? this.snapshot(record) : await operation;
      }
      catch(error) {
        const record=this.requests?.get(String(data.requestID||''));
        if(record)return this.finishRequest(record,record.submitted?'uncertain':'failed',error.message);
        return {requestID:String(data.requestID||''),state:'failed',submitted:false,text:'',conversation:this.conversationPath(),messageID:'',error:error.message,needsInteraction:true};
      }
    }
    if (name === 'retry-staged') {
      try {
        let rejected; const operation = this.retryStaged(data); operation.catch(error => { rejected = error; }); await Promise.resolve(); if (rejected) throw rejected;
        const record = this.requests?.get(String(data.requestID || ''));
        if (!record || !this.activeRequest) return await operation;
        return this.snapshot(record);
      } catch (error) {
        const record = this.requests?.get(String(data.requestID || ''));
        return { requestID: String(data.requestID || ''), state: record && !record.submitted ? 'failed' : 'uncertain', submitted: !record || record.submitted, text: record?.text || '', conversation: this.conversationPath(), error: error.message, needsInteraction: true };
      }
    }
    if (name === 'recover') return this.recoverRequest(data);
    if (name === 'request-status' || name === 'snapshot') return this.requestStatus(data.requestID);
    if (name === 'stop') {
      const result = this.stopRequest(data.requestID), record = this.requests?.get(String(data.requestID || ''));
      // Drain a cancelled fill/upload before claiming an authoritative unsent
      // result, so no later write can race the next explicit request.
      if (record && !record.submitted && record.operation) { await record.operation; return this.snapshot(record); }
      return result;
    }
    if (name === 'presentation') return this.presentation(data.compact === true);
    if (name === "conversation") {
      const streaming = this.isStreaming();
      if (streaming) return { streaming: true, turns: [], conversation: doc.location.pathname };
      if (this.searchUnitsUnclear()) throw new Error('网页消息身份无法唯一确认，请在网页检查，未导入其他回合。');
      const messages = this.messageNodes();
      if (!messages.length) throw new Error('尚未找到网页对话，或网页结构已变化。');
      const turns = []; let question = '';
      for (const node of messages) {
        const role = this.messageRole(node), text = role === 'user' ? this.userText(node) : this.answerText(node);
        if (role === 'user') question = text;
        if (role === 'assistant' && text && question) turns.push({ question, answer: text, id: this.messageID(node) || String(turns.length) });
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
      if (!editor.isConnected || this.editor() !== editor || doc.activeElement !== editor) throw new Error('网页输入框尚未取得输入焦点，未写入其他位置；本机问题已保留。');
      const before = editor.localName === 'textarea' ? editor.value : editor.innerText || editor.textContent;
      const prefix = String(before).trim() ? '\n\n' : '', expected = before + prefix + text;
      if (editor.localName === "textarea") {
        // Use the browser's editing transaction so the site receives the same
        // input lifecycle as ordinary typing. A DOM setter can echo a value
        // that a controlled editor then clears on its next render.
        editor.setSelectionRange(before.length, before.length);
        const accepted = doc.execCommand('insertText', false, prefix + text);
        if (!accepted && editor.value !== expected) throw new Error('网页未接受本轮文字输入，未重复写入；本机问题已保留。');
      } else {
        const range = doc.createRange(); range.selectNodeContents(editor); range.collapse(false);
        const selection = win.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        if (!doc.execCommand("insertText", false, prefix + text)) throw new Error("网页编辑器未接受自动输入，请使用复制后粘贴。");
      }
      for (let check = 0; check < 3; check++) {
        await new Promise(resolve => win.setTimeout(resolve, 100));
        const current = this.editor();
        const actual = current?.localName === 'textarea' ? current.value : current?.innerText || current?.textContent;
        if (!current?.isConnected || this.normalized(actual) !== this.normalized(expected))
          throw new Error('网页未稳定保留本轮输入，尚未发送，也未重复写入；本机问题已保留。');
      }
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
      if (this.submitting && this.activeRequest && !this.activeRequest.submitted) {
        const record = this.activeRequest; record.injectedFiles = [...(input.files || [])]; record.stageInput = input;
        record.stageWatch = event => { if (event.isTrusted) record.attachmentTampered = true; };
        input.addEventListener('change', record.stageWatch);
      }
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      return { count: files.length, staged: true }; // The page owns upload progress and completion.
    }
    throw new Error("未知的网页操作。");
  }
}
