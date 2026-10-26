const test = require('node:test'), assert = require('node:assert/strict');
const Scope = require('../addon/content/reading-scope.js');
const base = { key: '1_A', paperID: 1, provider: 'deepseek', model: 'deepseek-flash', smartReading: true, session: { messages: [], materials: {} } };
const manual = { id: 'selected', mode: 'selection', label: '第 2 页选段', text: 'PRIVATE_SOURCE_TEXT' };
const evidence = { text: 'PRIVATE_EVIDENCE_TEXT', references: [{ key: '1_A', paperID: 1, page: 2, text: 'PRIVATE_ORIGINAL_PASSAGE' }], coverage: [{ paperID: 1, title: 'Active study', kind: 'lexical', brief: true, snippets: 2, characters: 300 }] };
test('scope planning is pure and preserves manual precedence unless the user explicitly combines this paper', () => {
  assert.deepEqual(Scope.selection(base), { shouldPrepare: true, includePrimary: true, comparisonIDs: [] });
  assert.deepEqual(Scope.selection({ ...base, context: manual }), { shouldPrepare: false, includePrimary: false, comparisonIDs: [] });
  assert.deepEqual(Scope.selection({ ...base, context: manual, includePrimary: true }), { shouldPrepare: true, includePrimary: true, comparisonIDs: [] });
  assert.deepEqual(Scope.selection({ ...base, context: manual, ids: [2, 2, '3'] }), { shouldPrepare: true, includePrimary: false, comparisonIDs: [2, 3] });
  assert.equal(Scope.selection({ ...base, smartReading: false, ids: [2] }).includePrimary, true);
  assert.equal(Scope.selection({ ...base, includePrimary: false }).shouldPrepare, false);
  assert.equal(Scope.selection({ key: 'general', includePrimary: true }).shouldPrepare, false);
  assert.deepEqual(Scope.selection({ key: 'general', ids: [2] }).comparisonIDs, []);
  assert.throws(() => Scope.selection({ ...base, ids: ['invalid'] }), /标识无效/);
});
test('pure conversation, selected text, page images, screenshots and PDFs have separate source descriptions', () => {
  const pure = Scope.describe({ ...base, smartReading: false }); assert.match(pure.label, /纯聊天/); assert.equal(pure.sources.primaryRequested, false);
  assert.match(Scope.describe({ ...base, context: manual }).label, /文字选段/);
  assert.match(Scope.describe({ ...base, context: { mode: 'page', images: ['data:image/png;base64,PRIVATE_IMAGE'], text: 'PRIVATE_TEXT' } }).label, /页图＋提取文字/);
  assert.match(Scope.describe({ ...base, context: { mode: 'screenshot', image: 'PRIVATE_IMAGE' } }).label, /截图/);
  const pdf = Scope.describe({ ...base, context: { mode: 'pdf', file: 'PRIVATE_PDF' } }); assert.match(pdf.label, /PDF/); assert(pdf.warnings.some(value => /DeepSeek 不接收 PDF/.test(value)));
});
test('a locally available preread is not presented as used when manual material excludes this paper', () => {
  const excluded = Scope.describe({ ...base, context: manual, preread: { state: 'ready' } });
  assert.equal(excluded.sources.preread, 'not-used'); assert.equal(excluded.sources.primaryRequested, false); assert(excluded.details.some(value => /本轮未选择额外读取本篇/.test(value)));
  const included = Scope.describe({ ...base, context: manual, includePrimary: true, preread: { state: 'ready' } });
  assert.equal(included.sources.preread, 'available'); assert.match(included.label, /本篇提要＋原文检索/); assert(included.warnings.some(value => /不是模型永久记忆全文/.test(value)));
  assert(included.details.some(value => /发送时重新核对/.test(value)));
});
test('stale or unverified prereads are never claimed as usable and do not initiate a refresh', () => {
  for (const state of ['stale', 'unchecked']) {
    const scope = Scope.describe({ ...base, preread: { state } }); assert.equal(scope.sources.preread, 'not-used'); assert(!scope.label.includes('本篇提要')); assert(scope.warnings.some(value => /失效|尚待核对/.test(value)));
  }
});
test('prepared context records actual brief reuse, source coverage and selected comparison provenance without source bodies', () => {
  const combined = { ...evidence, references: [...evidence.references, { key: '1_B', paperID: 2, text: 'PRIVATE_OTHER_PASSAGE' }], coverage: [...evidence.coverage, { paperID: 2, title: 'Other study', kind: 'overview', zeroMatches: true, snippets: 3, characters: 700 }] };
  const scope = Scope.describe({ ...base, context: manual, includePrimary: true, ids: [2], evidence: combined, phase: 'prepared' });
  assert.equal(scope.sources.primaryActual, true); assert.equal(scope.sources.preread, 'used'); assert.deepEqual(scope.sources.actualComparisonIDs, [2]); assert.match(scope.label, /本篇提要/); assert.match(scope.label, /对比论文 1 篇/);
  assert(scope.warnings.some(value => /检索未命中/.test(value))); assert(scope.details.some(value => /并非全文/.test(value)));
  const serialized = JSON.stringify(scope); for (const secret of ['PRIVATE_SOURCE_TEXT', 'PRIVATE_EVIDENCE_TEXT', 'PRIVATE_ORIGINAL_PASSAGE', 'PRIVATE_OTHER_PASSAGE']) assert(!serialized.includes(secret));
  assert.deepEqual(JSON.parse(serialized).coverage, scope.coverage);
});
test('prepared sources follow actual evidence even when a stale preview suggested that a brief was available', () => {
  const scope = Scope.describe({ ...base, preread: { state: 'ready' }, evidence: { ...evidence, coverage: [{ ...evidence.coverage[0], brief: false, kind: 'overview' }] }, phase: 'prepared' });
  assert.equal(scope.sources.preread, 'not-used'); assert.match(scope.label, /概览节选/); assert(!scope.label.includes('提要'));
  const unknown = Scope.describe({ ...base, evidence: { text: 'data' }, phase: 'prepared' }); assert.equal(unknown.sources.primaryActual, null); assert.match(unknown.label, /范围待核对/);
});
test('only eligible previous messages and their referenced materials enter the history description', () => {
  const session = { messages: [{ role: 'user', status: 'complete', materialID: 'first' }, { role: 'assistant', status: 'complete' }, { role: 'user', materialID: 'legacy' }, { role: 'assistant', status: 'failed', materialID: 'bad' }, { role: 'user', status: 'pending', materialID: 'bad' }], materials: { first: { id: 'first', mode: 'selection', text: 'PRIVATE_OLD_TEXT' }, legacy: { id: 'legacy', mode: 'pdf', file: 'PRIVATE_PDF' }, bad: { id: 'bad', mode: 'pdf', file: 'PRIVATE_FAILED_PDF' } } };
  const scope = Scope.describe({ ...base, provider: 'chatgpt', smartReading: false, session });
  assert.equal(scope.sources.historyMessages, 3); assert.equal(scope.sources.historyMaterials, 2); assert.match(scope.label, /既有会话材料 2 份/); assert(!JSON.stringify(scope).includes('PRIVATE_'));
});
test('DeepSeek historical PDF and Pro images are described as omitted rather than falsely as resubmitted binaries', () => {
  const session = { messages: [{ role: 'user', status: 'complete', materialID: 'pdf' }, { role: 'assistant', status: 'complete' }, { role: 'user', status: 'complete', materialID: 'img' }], materials: { pdf: { id: 'pdf', mode: 'pdf', file: 'PRIVATE_PDF' }, img: { id: 'img', mode: 'page', image: 'PRIVATE_IMAGE', text: 'PRIVATE_EXTRACTED_TEXT' } } };
  const scope = Scope.describe({ ...base, model: 'deepseek-v4-pro', smartReading: false, session });
  assert.equal(scope.sources.historyMaterials, 2); assert(scope.details.some(value => /PDF 未重传/.test(value))); assert(scope.warnings.some(value => /PDF 原件、页面图片未重传/.test(value)));
  assert(!scope.details.some(value => /既有会话材料.*页图/.test(value))); assert(!JSON.stringify(scope).includes('PRIVATE_'));
});
test('a current material reused by history is counted once and unsupported current images are not silently omitted', () => {
  const image = { id: 'same', mode: 'screenshot', image: 'PRIVATE_CURRENT_IMAGE' }, session = { messages: [{ role: 'user', status: 'complete', materialID: 'same' }], materials: { same: image } };
  const scope = Scope.describe({ ...base, model: 'deepseek-v4-pro', context: image, session });
  assert.equal(scope.sources.manual, true); assert.equal(scope.sources.historyMaterials, 0); assert(scope.warnings.some(value => /不会静默丢弃截图/.test(value)));
});

test('historical screenshots projected to text for DeepSeek Pro are never described as resent screenshot images', () => {
  const screenshot = { id: 'shot', mode: 'screenshot', image: 'PRIVATE_SCREENSHOT', text: 'PRIVATE_CONTEXT' };
  const session = { messages: [{ role: 'user', status: 'complete', materialID: 'shot' }], materials: { shot: screenshot } };
  const pro = Scope.describe({ ...base, model: 'deepseek-v4-pro', smartReading: false, session });
  assert.equal(pro.sources.historyMaterials, 1);
  assert(pro.details.some(value => /既有会话材料 1 份：历史文字说明（截图未重传）/.test(value)));
  assert(!pro.details.some(value => /既有会话材料.*区域截图/.test(value)));
  assert(pro.warnings.some(value => /历史页面图片未重传/.test(value)));
  const flash = Scope.describe({ ...base, smartReading: false, session });
  assert(flash.details.some(value => /既有会话材料 1 份：区域截图/.test(value)));
  assert(!flash.details.some(value => /截图未重传/.test(value)));
  assert.equal(screenshot.image, 'PRIVATE_SCREENSHOT');
  assert(!JSON.stringify(pro).includes('PRIVATE_')); assert(!JSON.stringify(flash).includes('PRIVATE_'));
});
test('website drafts never borrow local API history as proof of website context or claim that the model has received the draft', () => {
  const session = { messages: [{ role: 'user', status: 'complete', materialID: 'pdf' }], materials: { pdf: { id: 'pdf', file: 'PRIVATE_LOCAL_FILE' } } };
  const planned = Scope.describe({ ...base, provider: 'chatgpt-web', smartReading: false, session });
  assert.equal(planned.sources.historyMessages, null); assert.equal(planned.sources.historyMaterials, null); assert.match(planned.label, /网页问题草稿/); assert(planned.warnings.some(value => /仍需在网页确认/.test(value)));
  const draft = Scope.describe({ ...base, provider: 'chatgpt-web', context: manual, includePrimary: true, session, evidence, phase: 'draft' });
  assert.equal(draft.webDraft, true); assert(draft.warnings.some(value => /草稿尚未发送/.test(value))); assert(draft.warnings.some(value => /不代表网页模型已经读取/.test(value))); assert(!JSON.stringify(draft).includes('PRIVATE_LOCAL_FILE'));
});
