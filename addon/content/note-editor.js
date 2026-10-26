/* SPDX-License-Identifier: MIT — direct rich-text editing with untouched Markdown blocks preserved. */
var PCNoteDocument = class {
  constructor(text = '') { this.text = String(text); this.undoStack = []; this.redoStack = []; this.group = ''; this.at = 0; }
  set(text, group = '') {
    text = String(text); if (text === this.text) return false;
    const now = Date.now();
    if (!group || group !== this.group || now - this.at > 800) this.undoStack.push(this.text);
    while (this.undoStack.length > 50 || (this.undoStack.length > 1 && this.undoStack.reduce((n, s) => n + s.length, 0) > 2000000)) this.undoStack.shift();
    this.text = text; this.group = group; this.at = now; this.redoStack = []; return true;
  }
  replace(from, to, value, group = '') {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > this.text.length) throw new Error('笔记编辑范围无效。');
    return this.set(this.text.slice(0, from) + value + this.text.slice(to), group);
  }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(this.text); this.text = this.undoStack.pop(); this.group = ''; return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(this.text); this.text = this.redoStack.pop(); this.group = ''; return true; }
  find(query, sensitive = false) {
    if (!query) return [];
    const escaped = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...this.text.matchAll(new RegExp(escaped, sensitive ? 'gu' : 'giu'))].map(m => ({ from: m.index, to: m.index + m[0].length }));
  }
  replaceAll(query, replacement, sensitive = false) {
    const matches = this.find(query, sensitive); if (!matches.length) return 0;
    let next = this.text;
    for (const match of matches.reverse()) next = next.slice(0, match.from) + replacement + next.slice(match.to);
    this.set(next); return matches.length;
  }
  static blocks(text) {
    const blocks = []; let from = null, offset = 0, fence = null, mathFence = null;
    for (const line of String(text).match(/[^\n]*(?:\n|$)/g) || []) {
      if (!line) continue;
      const value = line.replace(/\r?\n$/, ''), marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(value);
      if (from === null && (value.trim() || fence)) from = offset;
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      }
      if (!fence && !marker) {
        for (const delimiter of value.match(/(?<!\\)\$\$|\\\[|\\\]/g) || []) {
          if (!mathFence && delimiter !== '\\]') mathFence = delimiter;
          else if ((mathFence === '$$' && delimiter === '$$') || (mathFence === '\\[' && delimiter === '\\]')) mathFence = null;
        }
      }
      if (!value.trim() && !fence && !mathFence && from !== null) { blocks.push({ from, to: offset, source: text.slice(from, offset) }); from = null; }
      offset += line.length;
    }
    if (from !== null) blocks.push({ from, to: text.length, source: text.slice(from) });
    return blocks;
  }
};
// One continuously editable surface. Original Markdown is retained for every
// untouched block; only changed DOM blocks are converted back to Markdown.
var PCNoteEditor = class {
  constructor({ container, markdown, onChange, onState, normalizePaste }) {
    Object.assign(this, { container, markdown, onChange, onState, normalizePaste });
    this.documents = new Map(); this.originals = new WeakMap(); this.key = null;
    this.model = null; this.disabled = true; this.query = ''; this.sensitive = false; this.matchIndex = -1; this.composing = false;
    container.setAttribute('role', 'textbox'); container.setAttribute('aria-multiline', 'true');
    container.setAttribute('data-placeholder', '直接在这里写笔记…');
    container.addEventListener('input', e => { if (!this.composing) this.autoformat(); this.commit('typing:' + (e.inputType || 'insertText')); });
    container.addEventListener('compositionstart', () => { this.composing = true; });
    container.addEventListener('compositionend', () => { this.composing = false; this.autoformat(); this.commit('typing'); });
    container.addEventListener('beforeinput', e => {
      if (!container.ownerDocument.getSelection()?.isCollapsed || e.inputType === 'insertParagraph' || e.inputType === 'insertFromPaste') { if (this.model) this.model.group = ''; }
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); e.inputType === 'historyUndo' ? this.undo() : this.redo(); }
    });
    container.addEventListener('keydown', e => {
      if (this.disabled || e.isComposing || this.composing) return;
      if ((e.ctrlKey || e.metaKey) && ['b', 'i'].includes(e.key.toLowerCase())) {
        e.preventDefault(); this.command(e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
      }
      // Enter in code is a literal newline. Other paragraphs, lists, quotes and
      // selections use Firefox's normal editing behavior, including Shift+Enter.
      if (e.key === 'Enter' && this.selectionNode()?.closest('pre')) { e.preventDefault(); this.paste('\n'); }
    });
    container.addEventListener('paste', e => {
      if (this.disabled) return;
      e.preventDefault(); const text = e.clipboardData?.getData('text/plain'); if (!text) return;
      // Never import clipboard HTML, scripts, external images or site styles.
      this.paste(text);
    });
    container.addEventListener('drop', e => e.preventDefault());
    container.addEventListener('copy', e => {
      const selection = container.ownerDocument.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const holder = container.ownerDocument.createElement('div'); holder.append(selection.getRangeAt(0).cloneContents());
      if (!holder.querySelector('.pc-math')) return;
      e.preventDefault(); e.clipboardData.setData('text/plain', this.children(holder));
    });
    container.addEventListener('click', e => { if (e.target.closest('a')) e.preventDefault(); });
  }
  check() { if (this.disabled || !this.model) throw new Error('请先打开 PDF 后编辑这篇文献的笔记。'); }
  selectionNode() {
    const node = this.container.ownerDocument.getSelection()?.anchorNode;
    return node && this.container.contains(node) ? (node.nodeType === 1 ? node : node.parentElement) : null;
  }
  bookmark() {
    const doc = this.container.ownerDocument, selection = doc.getSelection();
    if (!selection?.rangeCount || !this.container.contains(selection.anchorNode) || !this.container.contains(selection.focusNode)) return null;
    const offset = (node, at) => { const range = doc.createRange(); range.selectNodeContents(this.container); range.setEnd(node, at); return this.segments(range.cloneContents()).map(s => s.text).join('').length; };
    return { anchor: offset(selection.anchorNode, selection.anchorOffset), focus: offset(selection.focusNode, selection.focusOffset) };
  }
  point(offset, bias = 'forward') {
    let last;
    for (const segment of this.segments()) {
      last = segment;
      if (offset < segment.text.length || (offset === segment.text.length && bias === 'backward')) {
        if (!segment.math) return [segment.node, offset];
        const parent = segment.node.parentNode, index = [...parent.childNodes].indexOf(segment.node);
        return [parent, index + (bias === 'backward' && offset > 0 ? 1 : 0)];
      }
      offset -= segment.text.length;
    }
    return last && !last.math ? [last.node, last.text.length] : [this.container, this.container.childNodes.length];
  }
  segments(root = this.container) {
    const result = [];
    const walk = node => {
      if (node.nodeType === 3) result.push({ node, text: node.data, math: false });
      else if (node.nodeType === 1 && node.classList.contains('pc-math')) result.push({ node, text: PCMath.source(node), math: true });
      else for (const child of node.childNodes) walk(child);
    };
    walk(root); return result;
  }
  restore(mark) {
    if (!mark) return; const selection = this.container.ownerDocument.getSelection();
    this.container.focus(); selection.setBaseAndExtent(...this.point(mark.anchor), ...this.point(mark.focus));
  }
  setDocument(key, text, disabled = false) {
    if (key === this.key && this.model?.text === text && this.disabled === disabled) return;
    const mark = key === this.key ? this.bookmark() : null;
    this.disabled = disabled; this.key = key;
    if (!this.documents.has(key)) this.documents.set(key, new PCNoteDocument(text));
    this.model = this.documents.get(key); if (this.model.text !== text) this.model.set(text);
    this.matchIndex = -1; this.render(); this.restore(mark); this.state();
  }
  render() {
    const doc = this.container.ownerDocument, text = this.model?.text || '';
    this.clearLocation();
    this.container.replaceChildren(); this.originals = new WeakMap(); this.codeLanguages = new WeakMap();
    this.container.contentEditable = this.disabled ? 'false' : 'true';
    this.container.setAttribute('aria-disabled', String(this.disabled));
    this.container.setAttribute('data-placeholder', this.disabled ? '打开 PDF 后可编辑笔记。' : '直接在这里写笔记…');
    let previous = 0;
    for (const block of PCNoteDocument.blocks(text)) {
      const node = doc.createElement('section'); node.className = 'note-block'; this.paint(node, block.source);
      const language = /^\s*`{3,}([^\r\n]*)/.exec(block.source)?.[1] || '';
      for (const pre of node.querySelectorAll('pre')) this.codeLanguages.set(pre, language);
      this.originals.set(node, { source: block.source, gap: text.slice(previous, block.from), html: node.innerHTML });
      previous = block.to; this.container.append(node);
    }
    this.tail = text.slice(previous);
    if (!this.container.childNodes.length) { const p = doc.createElement('p'); p.append(doc.createElement('br')); this.container.append(p); }
    this.container.dataset.empty = String(!text);
  }
  paint(node, source) {
    const html = this.markdown(source); node.innerHTML = html;
    // Gecko's privileged innerHTML sanitizer removes zotero: href attributes.
    // Restore only renderer-vetted link URLs, using DOM setters.
    const links = [...html.matchAll(/<a href="([^"]+)"/g)];
    [...node.querySelectorAll('a')].forEach((a, i) => {
      const href = links[i]?.[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (href && /^(https?:|zotero:)/i.test(href)) a.setAttribute('href', href);
    });
    if (typeof PCMath !== 'undefined') PCMath.render(node);
  }
  escape(text) { return String(text).replace(/\u00a0/g, ' ').replace(/([\\`*{}\[\]<>#])/g, '\\$1').replace(/^(\s*)([-+] |\d+\. )/gm, '$1\\$2'); }
  inline(node) {
    if (node.nodeType === 3) return this.escape(node.data);
    if (node.nodeType !== 1) return '';
    if (node.classList.contains('pc-math')) return PCMath.source(node);
    const tag = node.localName, body = () => [...node.childNodes].map(n => this.inline(n)).join('');
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') { const value = body(); return value ? '**' + value + '**' : ''; }
    if (tag === 'em' || tag === 'i') { const value = body(); return value ? '*' + value + '*' : ''; }
    if (tag === 'code') {
      const value = node.textContent, runs = value.match(/`+/g) || [], fence = '`'.repeat(Math.max(1, ...runs.map(r => r.length + 1)));
      return fence + (value.startsWith('`') || value.endsWith('`') ? ' ' + value + ' ' : value) + fence;
    }
    if (tag === 'a') { const href = node.getAttribute('href') || ''; return /^(https?:|zotero:)/i.test(href) ? '[' + body() + '](' + href.replace(/\)/g, '%29') + ')' : body(); }
    if (tag === 'img' || tag === 'script' || tag === 'style') return '';
    return body();
  }
  block(node) {
    if (node.nodeType !== 1) return this.inline(node);
    const tag = node.localName;
    if (tag === 'pre') {
      const text = node.textContent, fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) || []).map(r => r.length + 1)));
      return fence + (this.codeLanguages.get(node) || '') + '\n' + text + '\n' + fence;
    }
    if (/^h[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + this.inline(node);
    if (tag === 'hr') return '---';
    if (tag === 'blockquote') return this.children(node).split('\n').map(line => '> ' + line).join('\n');
    if (tag === 'ul' || tag === 'ol') return [...node.children].map((li, i) => (tag === 'ol' ? (i + 1) + '. ' : '- ') + this.children(li).replace(/\n/g, '\n  ')).join('\n');
    if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map(row => '| ' + [...row.children].map(cell => this.inline(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |');
      if (rows.length) rows.splice(1, 0, '| ' + [...node.querySelector('tr').children].map(() => '---').join(' | ') + ' |');
      return rows.join('\n');
    }
    if (['section', 'div', 'p', 'li', 'article'].includes(tag)) return this.children(node);
    return this.inline(node);
  }
  children(node) {
    const parts = []; let inline = '';
    const flush = () => { if (inline) { parts.push(inline); inline = ''; } };
    for (const child of node.childNodes) {
      if (child.nodeType === 1 && /^(p|div|section|h[1-6]|pre|blockquote|ul|ol|table|hr)$/.test(child.localName)) { flush(); parts.push(this.block(child)); }
      else if (child.nodeType === 3 && !child.data.trim() && child.data.includes('\n')) { /* renderer whitespace */ }
      else inline += this.inline(child);
    }
    flush(); return parts.join('\n\n');
  }
  serialize() {
    if (!this.container.textContent && !this.container.querySelector('hr')) return '';
    let out = '', lastOriginal = false;
    for (const node of this.container.childNodes) {
      if (node.nodeType === 3 && !node.data.trim() && node.data.includes('\n')) continue;
      const original = this.originals.get(node), unchanged = original && node.innerHTML === original.html;
      let value = unchanged ? original.source : this.block(node);
      if (!unchanged && original && /\r?\n$/.test(original.source)) value += original.source.match(/\r?\n$/)[0];
      if (!value && !original) continue;
      if (original && (!out || lastOriginal)) out += original.gap;
      else if (out) out += out.endsWith('\n\n') ? '' : out.endsWith('\n') ? '\n' : '\n\n';
      out += value; lastOriginal = !!original;
    }
    return out + (lastOriginal ? this.tail : '');
  }
  commit(group = '') {
    if (this.disabled || !this.model) return;
    this.container.dataset.empty = String(!this.container.textContent && !this.container.querySelector('hr'));
    if (this.model.set(this.serialize(), group)) { this.matchIndex = -1; this.notify(); }
  }
  autoformat() {
    const doc = this.container.ownerDocument, selection = doc.getSelection();
    if (!selection?.isCollapsed || !this.selectionNode()) return;
    let node = this.selectionNode();
    while (node !== this.container && !/^(p|div|h[1-6])$/.test(node.localName)) node = node.parentElement;
    if (node === this.container || node.closest('pre,blockquote,li') || [...node.childNodes].some(n => n.nodeType !== 3 && n.localName !== 'br')) return;
    const text = node.textContent.replace(/\u00a0/g, ' '), range = doc.createRange(); range.selectNodeContents(node); range.setEnd(selection.anchorNode, selection.anchorOffset);
    if (range.toString().length !== text.length || !(/^(?:#{1,6} |> |[-+] |\d+\. )\S/.test(text) || /\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*)|`[^`]+`/.test(text) || (typeof PCMath !== 'undefined' && PCMath.hasMath(text)))) return;
    const holder = doc.createElement('div'); this.paint(holder, text);
    const nodes = [...holder.childNodes]; if (!nodes.length) return;
    if (/^h[1-6]$/.test(node.localName) && nodes.length === 1 && nodes[0].localName === 'p') { const heading = doc.createElement(node.localName); heading.append(...nodes[0].childNodes); nodes[0] = heading; }
    node.replaceWith(...nodes); const end = doc.createRange(); end.selectNodeContents(nodes.at(-1)); end.collapse(false); selection.removeAllRanges(); selection.addRange(end);
  }
  paste(text) {
    this.check(); const doc = this.container.ownerDocument, selection = doc.getSelection();
    if (!selection?.rangeCount || !this.container.contains(selection.anchorNode) || !this.container.contains(selection.focusNode)) return;
    const code = this.selectionNode()?.closest('pre');
    if (!code) text = this.normalizePaste?.(text) ?? text;
    const range = selection.getRangeAt(0), fragment = doc.createDocumentFragment();
    if (code || (!text.includes('\n') && !(typeof PCMath !== 'undefined' && PCMath.hasMath(text)))) fragment.append(doc.createTextNode(text));
    else { const holder = doc.createElement('div'); this.paint(holder, text); fragment.append(...holder.childNodes); }
    const last = fragment.lastChild; if (!last) return;
    this.model.group = ''; range.deleteContents(); range.insertNode(fragment);
    const after = doc.createRange(); after.setStartAfter(last); after.collapse(true); selection.removeAllRanges(); selection.addRange(after);
    this.commit();
  }
  command(command, value = null) { this.check(); this.container.focus(); this.container.ownerDocument.execCommand(command, false, value); this.commit(); }
  finish() { this.commit(); }
  notify() { this.onChange?.(this.model.text); this.state(); }
  matches() { return new PCNoteDocument(this.segments().map(s => s.text).join('')).find(this.query, this.sensitive); }
  state() { this.onState?.({ undo: !!this.model?.undoStack.length, redo: !!this.model?.redoStack.length, matches: this.matches().length, index: this.matchIndex }); }
  source(text) { this.check(); if (this.model.set(text, 'source')) { this.render(); this.notify(); } }
  clear() { this.source(''); }
  undo() { this.check(); const mark = this.bookmark(); if (this.model.undo()) { this.render(); this.restore(mark); this.notify(); } }
  redo() { this.check(); const mark = this.bookmark(); if (this.model.redo()) { this.render(); this.restore(mark); this.notify(); } }
  search(query, sensitive = false) { this.query = query; this.sensitive = sensitive; this.matchIndex = -1; this.state(); }
  range(match) { const range = this.container.ownerDocument.createRange(); range.setStart(...this.point(match.from)); range.setEnd(...this.point(match.to, 'backward')); return range; }
  clearLocation() {
    const win = this.container.ownerDocument.defaultView;
    if (this.locationTimer != null) win?.clearTimeout(this.locationTimer);
    this.locationTimer = null;
    for (const node of this.locationNodes || []) node.classList.remove('note-located');
    this.locationNodes = [];
  }
  revealSourceRange(from, to) {
    const text = this.model?.text;
    if (this.disabled || typeof text !== 'string' || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > text.length) return false;
    // Receipts refer to Markdown offsets, which differ from rendered text (for
    // example **bold**, fenced code and TeX). Rebuild the source-block mapping
    // only for this explicit navigation, never by guessing display offsets.
    const blocks = PCNoteDocument.blocks(text), indexes = [];
    blocks.forEach((block, index) => { if (block.from < to && block.to > from) indexes.push(index); });
    if (!indexes.length) return false;
    this.render();
    const nodes = [...this.container.children].filter(node => node.classList.contains('note-block'));
    const hits = indexes.map(index => nodes[index]).filter(Boolean);
    if (!hits.length) return false;
    this.container.focus({ preventScroll: true });
    const box = this.container.getBoundingClientRect(), hit = hits[0].getBoundingClientRect();
    // Do not use scrollIntoView: it also scrolls Zotero's outer sidebar/frame.
    const top = box.top + this.container.clientTop, inset = Math.min(12, this.container.clientHeight / 4);
    this.container.scrollTop += hit.top - top - inset;
    this.locationNodes = hits;
    for (const node of hits) node.classList.add('note-located');
    const win = this.container.ownerDocument.defaultView;
    if (win) this.locationTimer = win.setTimeout(() => this.clearLocation(), 1600);
    return true;
  }
  next(direction = 1) {
    this.check(); const matches = this.matches(); if (!matches.length) { this.matchIndex = -1; this.state(); return null; }
    this.matchIndex = this.matchIndex < 0 ? (direction < 0 ? matches.length - 1 : 0) : (this.matchIndex + direction + matches.length) % matches.length;
    const match = matches[this.matchIndex], range = this.range(match), selection = this.container.ownerDocument.getSelection();
    this.container.focus({ preventScroll: true }); selection.removeAllRanges(); selection.addRange(range);
    // Scroll the editor, not every ancestor across the embedded Zotero frame.
    const box = this.container.getBoundingClientRect(), hit = range.getBoundingClientRect();
    if (hit.top < box.top + this.container.clientTop) this.container.scrollTop += hit.top - box.top - this.container.clientTop;
    else if (hit.bottom > box.top + this.container.clientTop + this.container.clientHeight) this.container.scrollTop += hit.bottom - box.top - this.container.clientTop - this.container.clientHeight;
    this.state(); return match;
  }
  replaceMatches(matches, replacement) {
    this.check(); const doc = this.container.ownerDocument; let changedMath = false;
    for (const match of [...matches].reverse()) {
      let offset = 0, math;
      for (const segment of this.segments()) {
        if (segment.math && match.from >= offset && match.to <= offset + segment.text.length) { math = { ...segment, offset }; break; }
        offset += segment.text.length;
      }
      if (math) {
        const text = math.text.slice(0, match.from - math.offset) + replacement + math.text.slice(match.to - math.offset);
        math.node.setAttribute('data-math-source', encodeURIComponent(text)); math.node.textContent = text; changedMath = true;
      } else { const range = this.range(match); range.deleteContents(); range.insertNode(doc.createTextNode(replacement)); }
    }
    this.commit(); if (changedMath) this.render(); this.state(); return matches.length;
  }
  replaceOne(replacement) { const matches = this.matches(); return matches.length ? this.replaceMatches([matches[this.matchIndex >= 0 && this.matchIndex < matches.length ? this.matchIndex : 0]], replacement) : 0; }
  replaceAll(replacement) { return this.replaceMatches(this.matches(), replacement); }
};
if (typeof module === 'object' && module.exports) module.exports = { PCNoteDocument, PCNoteEditor };
