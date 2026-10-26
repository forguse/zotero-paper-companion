/* SPDX-License-Identifier: MIT — offline TeX rendering and lossless Markdown. */
var PCMath = {
  escape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  protect(value) {
    const text = String(value).replace(/\u0001/g, ''), html = []; let out = '', i = 0;
    const escaped = index => { let n = 0; while (index > 0 && text[--index] === '\\') n++; return n % 2 !== 0; };
    while (i < text.length) {
      if (text[i] === '`' || text.startsWith('~~~', i)) {
        const run = /^(?:`+|~+)/.exec(text.slice(i))[0], end = text.indexOf(run, i + run.length);
        if (end >= 0) { out += text.slice(i, end + run.length); i = end + run.length; continue; }
        if (run.length >= 3) { out += text.slice(i); break; }
      }
      let left = '', right = '', display = false;
      if (!escaped(i)) {
        if (text.startsWith('$$', i)) { left = right = '$$'; display = true; }
        else if (text.startsWith('\\[', i)) { left = '\\['; right = '\\]'; display = true; }
        else if (text.startsWith('\\(', i)) { left = '\\('; right = '\\)'; }
        else if (text[i] === '$') left = right = '$';
      }
      if (left) {
        let end = text.indexOf(right, i + left.length);
        while (end >= 0 && escaped(end)) end = text.indexOf(right, end + right.length);
        const tex = end >= 0 ? text.slice(i + left.length, end) : '';
        if (tex.trim() && tex.length <= 20000 && (display || !tex.includes('\n'))) {
          const source = text.slice(i, end + right.length), index = html.length;
          html.push(`<span class="pc-math" data-tex="${this.escape(encodeURIComponent(tex))}" data-math-source="${this.escape(encodeURIComponent(source))}" data-display="${display ? 'block' : 'inline'}">${this.escape(source)}</span>`);
          out += '\u0001PCMath' + index + '\u0001'; i = end + right.length; continue;
        }
      }
      out += text[i++];
    }
    return { text: out, html };
  },
  hasMath(text) { return this.protect(text).html.length > 0; },
  attribute(node, name) { const value = node.getAttribute(name) || ''; try { return decodeURIComponent(value); } catch (_) { return value; } },
  source(node) { return this.attribute(node, 'data-math-source'); },
  preparePaste(text, knownFormula = false) {
    const value = String(text), trimmed = value.trim();
    if (!trimmed || this.hasMath(value) || /^\s*`{3}/.test(value)) return value;
    if (!knownFormula && (/^\s*(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s|~{3})/m.test(value) || /\*\*|`/.test(value))) return value;
    const looksLikeTeX = /\\(?:frac|sqrt|sum|int|prod|begin|alpha|beta|gamma|delta|theta|lambda|sigma|mathbf|mathbb|mathrm|left|partial|nabla)\b|[_^](?:\{|[a-zA-Z0-9])/.test(trimmed);
    const simpleEquation = /^[a-zA-Z][a-zA-Z0-9_ ]*\s*=\s*[a-zA-Z0-9\\({+\-]/.test(trimmed);
    const words = trimmed.replace(/\\(?:text|mathrm|operatorname)\{[^}]*\}/g, '').replace(/\\[A-Za-z]+/g, '');
    const prose = /[。！？\u4e00-\u9fff]|\b(?:the|this|that|paper|we|used|using|with|note|and|are)\b/i.test(words);
    return knownFormula || (!prose && (looksLikeTeX || simpleEquation)) ? '$$\n' + trimmed + '\n$$' : value;
  },
  render(container) {
    if (typeof katex === 'undefined') return;
    for (const node of container.querySelectorAll('.pc-math:not([data-rendered])')) {
      const tex = this.attribute(node, 'data-tex');
      node.setAttribute('data-rendered', 'true'); node.contentEditable = 'false';
      node.setAttribute('aria-label', '公式：' + tex); node.title = 'TeX：' + tex + '\n可在 Markdown 源码中修改';
      try { katex.render(tex, node, { displayMode: node.dataset.display === 'block', throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }); }
      catch (_) { node.textContent = this.source(node) || tex; node.classList.add('math-error'); }
    }
  }
};
if (typeof module !== 'undefined') module.exports = PCMath;
