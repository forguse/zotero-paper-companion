const test = require('node:test'), assert = require('node:assert/strict');
const math = require('../addon/content/math.js'), core = require('../addon/content/core.js');
const katex = require('../addon/content/vendor/katex/katex.min.js');
const { PCNoteDocument: Note } = require('../addon/content/note-editor.js');
test('math delimiters preserve TeX before Markdown parsing, including matrices and escaped HTML', () => {
  const tex = String.raw`\begin{aligned}x_1 &= \frac{a}{b} \\ x_2 &< y^2\end{aligned}`;
  for (const text of ['$$\n'+tex+'\n$$', '\\['+tex+'\\]','$x_1$','\\(x_1\\)']) {
    const html = core.markdown(text);
    assert(html.includes('class="pc-math"')); assert(html.includes('data-math-source=')); assert(!html.includes('<script'));
  }
  assert(core.markdown('$$'+tex+'$$').includes('&lt; y^2'));
  assert(!core.markdown('`$x$`\n\n```tex\n$$x$$\n```').includes('class="pc-math"'));
  assert(!core.markdown(String.raw`Price \$10`).includes('class="pc-math"'));
});
test('plain copied TeX becomes display math while prose and code retain their meaning', () => {
  for (const tex of [String.raw`\frac{a_1}{b^2}`, 'E = mc^{2}', 'a+b']) assert.equal(math.preparePaste(tex, tex==='a+b'),'$$\n'+tex+'\n$$');
  for (const text of ['普通阅读笔记。', 'We used x_1 in the paper.', '# PASTED_HEADING\n\n**PASTED_BOLD**', '$x^2$', '```tex\nx_1\n```']) assert.equal(math.preparePaste(text),text);
  assert(!core.markdown('~~~tex\n$$x$$\n~~~').includes('class="pc-math"'));
});
test('bundled KaTeX renders offline and refuses remote images or executable links', () => {
  assert(katex.renderToString(String.raw`\frac{a_1}{b^2}`,{trust:false}).includes('katex-mathml'));
  const html = katex.renderToString(String.raw`\href{javascript:alert(1)}{x}+\includegraphics{https://example.com/x.png}`,{trust:false,throwOnError:false});
  assert(!/<(?:a|img)\b/.test(html));
});
test('multiline formulas remain a single lossless note block across blank lines', () => {
  const text = '$$\n\\begin{aligned}\nx &= 1 \\\\\n\ny &= 2\n\\end{aligned}\n$$\n\nProse\n';
  const blocks = Note.blocks(text); assert.equal(blocks.length,2); assert(blocks[0].source.includes('y &= 2'));
  const protectedMath = math.protect(blocks[0].source), html = protectedMath.html[0];
  const source = html.match(/data-math-source="([^"]+)"/)[1]; assert.equal(decodeURIComponent(source),blocks[0].source.trimEnd());
});
