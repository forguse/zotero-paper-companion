const test = require('node:test');
const assert = require('node:assert/strict');
const Formula = require('../addon/content/formula.js');

test('formula selection clips to its PDF page and supports reverse dragging', () => {
  const rect = { left: 100, right: 500, top: 20, bottom: 620, width: 400, height: 600 };
  assert.deepEqual(Formula.crop({ x: 400, y: 500 }, { x: 0, y: 800 }, rect), { x: 0, y: .8, width: .75, height: .2 });
});
test('TeX transcription preserves math and removes only outer output wrappers', () => {
  const tex = String.raw`\begin{aligned}x_i &= \frac{a}{b} \\ y &= \alpha^2\end{aligned}`;
  for (const value of [tex, '```latex\n' + tex + '\n```', '$$\n' + tex + '\n$$', '\\[' + tex + '\\]']) assert.equal(Formula.tex(value), tex);
  assert.throws(() => Formula.tex('无法识别：下标模糊'), /下标模糊/);
  assert.throws(() => Formula.tex(''), /有效/);
});
test('formula OCR is independent, explicitly selects its model and cancels without returning partial TeX', async () => {
  const calls = [], api = { models: [{ id: 'chosen-model', inputModalities: ['text', 'image'] }], settings: { formulaProvider: 'chatgpt', formulaChatGPTModel: 'chosen-model' }, gateway: { generate: async opts => { calls.push(opts); return '$$x_i^2$$'; } } };
  const formula = new Formula(api);
  assert.equal(calls.length, 0);
  assert.equal(await formula.recognize('data:image/png;base64,YQ=='), 'x_i^2');
  assert.equal(calls[0].model, 'chosen-model'); assert.equal(calls[0].images[0], 'data:image/png;base64,YQ=='); assert.equal(calls[0].history, undefined);
  await assert.rejects(formula.recognize('https://example.com/image.png'), /PNG/);
  api.settings.formulaProvider = 'deepseek';
  api.gateway.generate = async opts => { calls.push(opts); formula.destroy(); return 'partial'; };
  await assert.rejects(formula.recognize('data:image/png;base64,YQ=='), /取消/);
  assert.equal(calls[1].model, 'deepseek-flash'); assert(calls[1].signal.aborted);
});
test('formula models require explicit image capability and reject text-only or unknown models before OCR', async () => {
  const api = { models: [{id:'vision',inputModalities:['text','image']},{id:'text',inputModalities:['text']},{id:'unknown'}], settings:{formulaProvider:'chatgpt',formulaChatGPTModel:'text'} };
  const formula = new Formula(api);
  assert.deepEqual(formula.models().map(m=>m.id),['vision']);
  assert.throws(()=>formula.validateSettings({formulaChatGPTModel:'unknown'}),/多模态/);
  assert.throws(()=>formula.validateSettings({formulaProvider:'chatgpt-web'}),/请选择/);
  await assert.rejects(formula.recognize('data:image/png;base64,YQ=='),/多模态/);
});
test('formula insertion targets its captured paper and appends only the equation to the latest note', async () => {
  const source = { paper: { key: '1_A', link: 'zotero://open-pdf/library/items/A' }, page: 3 }, writes = [];
  const api = { files: { changing: new Set() }, note: async () => 'Already edited\n', saveNote: (key, text) => writes.push({ key, text }), emit() {}, flushNote: async key => assert.equal(key, '1_A') };
  await new Formula(api).insert('x_1 = 2', source);
  assert.equal(writes[0].key, '1_A'); assert.equal(writes[0].text,'Already edited\n\n\n$$\nx_1 = 2\n$$\n\n');
  assert.equal(Formula.markdown('x',{paper:source.paper,page:null}), '\n\n$$\nx\n$$\n\n');
  api.files.changing.add('1_A'); await assert.rejects(new Formula(api).insert('x', source), /文件夹/); assert.equal(writes.length, 1);
});
