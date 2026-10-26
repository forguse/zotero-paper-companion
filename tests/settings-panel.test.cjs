const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PCSettingsPanel = require('../addon/content/settings-panel.js');

const ids = new Set([...fs.readFileSync(require.resolve('../addon/content/panel.xhtml'), 'utf8').matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
class Node extends EventTarget {
  constructor() { super(); this._value = ''; this.checked = false; this.disabled = false; this.textContent = ''; }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const turn = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; }
function fixture(options = {}) {
  const nodes = new Map(), writes = [], notices = [], errors = [], states = [];
  const data = { chatProvider: 'deepseek', chatDeepseekModel: 'deepseek-flash', translationProvider: 'deepseek', deepseekModel: 'deepseek-flash', language: '简体中文', quickQuestions: ['原问题'], summaryPrompt: '总结默认', reviewPrompt: '整理默认', vocabularyReminderEnabled: true, vocabularyReminderMinutes: 10080, vocabularyContextFallback: 'manual', vocabularyContextMethod: 'text', vocabularyManualAssist: true, vocabularyGenerateOnAdd: true };
  let key = 'existing-test-key', controller, saves = 0, keyReads = 0, settingsReads = 0, beforeWrite = async () => {}, keyRead = async () => !!key, afterSave = () => {};
  const document = { getElementById(id) { assert.ok(ids.has(id), 'control exists in shipped XHTML: ' + id); if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); } };
  const ports = { document,
    readSettings: () => { settingsReads++; return data; },
    async saveSettings(values, nextKey) { saves++; const snapshot = JSON.parse(JSON.stringify(values)); writes.push({ values: snapshot, key: nextKey }); await beforeWrite(); Object.assign(data, snapshot); if (nextKey !== undefined) key = nextKey; controller.refresh(); },
    keyPresent: async () => { keyReads++; return keyRead(); },
    readPrompt: kind => data[kind === 'summary' ? 'summaryPrompt' : 'reviewPrompt'],
    defaultPrompt: kind => kind === 'summary' ? '总结默认' : '整理默认',
    readVocabularyState: () => ({ stats: { words: 2, pending: 3 }, problem: '' }),
    notice: value => notices.push(value), error: value => errors.push(value),
    afterSaved: () => afterSave(), vocabularyChanged: options.vocabularyChanged || (() => {}),
    instantGroups: options.instantGroups || [],
    saveState(group, detail) { states.push({ group, ...detail }); options.saveState?.(group, detail); } };
  controller = new PCSettingsPanel(ports);
  const node = id => document.getElementById(id);
  return { controller, data, writes, notices, errors, states, node,
    state(group) { return states.filter(state => state.group === group).at(-1); },
    refresh() { controller.refresh(); controller.refreshVocabulary(); },
    input(id, value, type = 'input') { const n = node(id); if (typeof value === 'boolean') n.checked = value; else n.value = value; n.dispatchEvent(new Event(type)); },
    hold(value) { beforeWrite = value; }, keyRead(value) { keyRead = value; }, afterSaved(value) { afterSave = value; },
    get key() { return key; }, get saves() { return saves; }, get keyReads() { return keyReads; }, get settingsReads() { return settingsReads; } };
}

test('controller construction only binds controls; explicit refresh uses display ports and seven-day units', async () => {
  const f = fixture();
  assert.equal(f.saves, 0); assert.equal(f.keyReads, 0); assert.equal(f.settingsReads, 0);
  f.refresh();
  assert.equal(f.node('quick-questions').value, '原问题');
  assert.equal(f.node('summary-prompt').value, '总结默认');
  assert.equal(f.node('vocabulary-reminder-unit').value, '1440');
  assert.equal(f.node('vocabulary-reminder-count').value, '7');
  assert.equal(f.node('vocabulary-settings-status').textContent, '2 个词 · 3 条待复习');
  await f.controller.refreshKeyState();
  assert.match(f.node('key-state').textContent, /已在本机加密保存/);
  assert.equal(f.saves, 0);
});

test('external preference refresh updates clean controls while preserving all unsaved draft groups', () => {
  const f = fixture(); f.refresh();
  f.input('language', '新语言'); f.input('summary-prompt', '新提示词'); f.input('vocabulary-reminder-count', '9');
  Object.assign(f.data, { language: '外部语言', quickQuestions: ['外部问题'], summaryPrompt: '外部提示词', vocabularyReminderMinutes: 1440 });
  f.refresh();
  assert.equal(f.node('language').value, '新语言');
  assert.equal(f.node('quick-questions').value, '外部问题');
  assert.equal(f.node('summary-prompt').value, '新提示词');
  assert.equal(f.node('vocabulary-reminder-count').value, '9');
  assert.equal(f.node('settings-save-status').textContent, '有未保存的修改');
});

test('full save freezes its payload but never clears edits typed while the write is pending', async () => {
  const f = fixture(); f.refresh();
  f.input('quick-questions', '先保存的问题'); f.input('deepseek-key', 'first-test-key'); f.input('summary-prompt', '先保存的提示词');
  const hold = gate(); f.hold(() => hold.promise);
  const saving = f.controller.save();
  assert.equal(f.node('save-settings').disabled, true);
  assert.equal(f.node('save-summary-prompts').disabled, true);
  assert.equal(await f.controller.saveVocabulary(), false);
  f.input('quick-questions', '保存期间的新问题'); f.input('deepseek-key', 'later-test-key');
  f.input('summary-prompt', '保存期间的新提示词'); f.input('vocabulary-reminder-count', '8');
  hold.release(); await saving;
  assert.deepEqual(f.writes[0].values.quickQuestions, ['先保存的问题']);
  assert.equal(f.key, 'first-test-key');
  assert.equal(f.node('quick-questions').value, '保存期间的新问题');
  assert.equal(f.node('deepseek-key').value, 'later-test-key');
  assert.equal(f.node('summary-prompt').value, '保存期间的新提示词');
  assert.equal(f.node('vocabulary-reminder-count').value, '8');
  assert.equal(f.node('settings-save-status').textContent, '有未保存的修改');
  assert.equal(f.node('save-settings').disabled, false);
  await f.controller.save();
  assert.equal(f.key, 'later-test-key'); assert.equal(f.node('deepseek-key').value, '');
  assert.equal(f.data.summaryPrompt, '保存期间的新提示词');
  assert.equal(f.data.vocabularyReminderMinutes, 11520);
  assert.equal(f.node('settings-save-status').textContent, '设置已保存');
});

test('write failure retains key, questions, prompt and vocabulary drafts and re-enables actions', async () => {
  const f = fixture(); f.refresh();
  f.input('quick-questions', '待保存'); f.input('deepseek-key', 'unsaved-test-key');
  f.input('review-prompt', '待保存整理'); f.input('vocabulary-manual-assist', false);
  f.hold(async () => { throw new Error('synthetic write failure'); });
  await assert.rejects(f.controller.save(), /synthetic write failure/);
  assert.equal(f.key, 'existing-test-key');
  assert.equal(f.node('deepseek-key').value, 'unsaved-test-key');
  assert.equal(f.node('quick-questions').value, '待保存');
  assert.equal(f.node('review-prompt').value, '待保存整理');
  assert.equal(f.node('vocabulary-manual-assist').checked, false);
  assert.equal(f.node('settings-save-status').textContent, '保存失败，修改仍保留');
  for (const id of ['save-settings', 'save-summary-prompts', 'vocabulary-reminder-save', 'clear-key', 'check-key']) assert.equal(f.node(id).disabled, false);
});

test('blank full-save key means retain; only the explicit delete action sends an empty key', async () => {
  const f = fixture(); f.refresh(); await f.controller.save();
  assert.equal(f.writes[0].key, undefined); assert.equal(f.key, 'existing-test-key');
  f.input('deepseek-key', 'replacement-draft'); await f.controller.clearKey();
  assert.equal(f.writes[1].key, ''); assert.equal(f.key, '');
  assert.equal(f.node('deepseek-key').value, 'replacement-draft');
  assert.match(f.node('key-state').textContent, /新 Key 尚未保存/);
  assert.equal(f.node('settings-save-status').textContent, '有未保存的修改');
});

test('restoring a prompt is local until saved; a later prompt edit survives a pending prompt-only save', async () => {
  const f = fixture(); f.refresh(); f.input('summary-prompt', '自定义');
  f.node('summary-prompt-reset').click();
  assert.equal(f.node('summary-prompt').value, '总结默认'); assert.equal(f.saves, 0);
  const hold = gate(); f.hold(() => hold.promise); const saving = f.controller.savePrompts();
  f.input('review-prompt', '稍后新整理'); hold.release(); await saving;
  assert.equal(f.node('review-prompt').value, '稍后新整理'); assert.equal(f.controller.promptsDirty, true);
  await f.controller.savePrompts();
  assert.equal(f.data.reviewPrompt, '稍后新整理'); assert.equal(f.controller.promptsDirty, false);
  assert.equal(f.node('settings-save-status').textContent, '设置已保存');
});

test('vocabulary unit editing and a pending dedicated save preserve newer interval and context choices', async () => {
  const f = fixture(); f.refresh();
  f.input('vocabulary-reminder-unit', '60'); f.input('vocabulary-reminder-count', '2');
  assert.equal(f.node('vocabulary-reminder-minutes').value, '120');
  assert.equal(f.node('vocabulary-reminder-count').min, '1');
  const hold = gate(); f.hold(() => hold.promise); const saving = f.controller.saveVocabulary();
  f.input('vocabulary-reminder-count', '3'); f.input('vocabulary-context-fallback', 'auto');
  hold.release(); await saving;
  assert.equal(f.data.vocabularyReminderMinutes, 120);
  assert.equal(f.node('vocabulary-reminder-minutes').value, '180');
  assert.equal(f.node('vocabulary-context-fallback').value, 'auto');
  assert.match(f.node('vocabulary-settings-status').textContent, /新修改尚未保存/);
  await f.controller.saveVocabulary();
  assert.equal(f.data.vocabularyReminderMinutes, 180); assert.equal(f.data.vocabularyContextFallback, 'auto');
  assert.equal(f.controller.vocabularyDirty, false);
});

test('oversized quick questions are rejected before persistence without dropping the draft', async () => {
  const f = fixture(); f.refresh(); const value = Array.from({ length: 31 }, (_, i) => String(i)).join('\n');
  f.input('quick-questions', value); f.input('deepseek-key', 'uncommitted-key');
  await assert.rejects(f.controller.save(), /最多 30 个问题/);
  assert.equal(f.saves, 0); assert.equal(f.node('quick-questions').value, value);
  assert.equal(f.node('deepseek-key').value, 'uncommitted-key'); assert.equal(f.node('save-settings').disabled, false);
});

test('a stale key-presence check cannot overwrite a newer result or erase input typed during either check', async () => {
  const f = fixture(), first = gate(); f.refresh(); let calls = 0;
  f.keyRead(async () => ++calls === 1 ? (await first.promise, true) : false);
  const stale = f.controller.refreshKeyState(); await f.controller.refreshKeyState();
  f.input('deepseek-key', 'draft-while-checking'); first.release(); await stale;
  assert.equal(f.controller.savedKeyPresent, false);
  assert.equal(f.node('deepseek-key').value, 'draft-while-checking');
  assert.equal(f.node('deepseek-key').placeholder, '填写自己的 API Key');
  assert.match(f.node('key-state').textContent, /新 Key 尚未保存/);
});

test('event errors reach the view error port and leave input available for retry', async () => {
  const f = fixture(); f.refresh(); f.input('language', '待保存语言');
  f.hold(async () => { throw new Error('synthetic event failure'); }); f.node('save-settings').click();
  await turn();
  assert.equal(f.errors.length, 1); assert.match(f.errors[0].message, /synthetic event failure/);
  assert.equal(f.node('language').value, '待保存语言'); assert.equal(f.node('save-settings').disabled, false);
});

test('a superseded key-check failure does not replace a newer known key status', async () => {
  const f = fixture(), hold = gate(); f.refresh(); let calls = 0;
  f.keyRead(async () => { if (++calls === 1) { await hold.promise; throw new Error('superseded status failure'); } return false; });
  const stale = f.controller.refreshKeyState(); await f.controller.refreshKeyState(); hold.release();
  await assert.doesNotReject(stale);
  assert.equal(f.controller.savedKeyPresent, false); assert.equal(f.node('key-state').textContent, '尚未保存 API Key。');
});

test('display refresh failures after a committed save do not misreport persistence failure or request another write', async () => {
  const f = fixture(); f.refresh(); f.input('deepseek-key', 'new-saved-key');
  f.keyRead(async () => { throw new Error('synthetic key status failure'); });
  f.afterSaved(async () => { throw new Error('synthetic render failure'); });
  assert.equal(await f.controller.save(), true);
  assert.equal(f.key, 'new-saved-key'); assert.equal(f.node('deepseek-key').value, '');
  assert.equal(f.node('settings-save-status').textContent, '设置已保存');
  assert.match(f.node('key-state').textContent, /设置已保存，Key 状态暂时无法读取/);
  assert.equal(f.saves, 1); assert.equal(f.errors.length, 2);
});

test('destroy detaches listeners and prevents a completed write from touching the closed view', async () => {
  const f = fixture(); f.refresh(); f.input('deepseek-key', 'saved-after-close');
  const hold = gate(); f.hold(() => hold.promise); const saving = f.controller.save();
  const text = f.node('settings-save-status').textContent;
  f.controller.destroy(); hold.release(); await saving;
  assert.equal(f.key, 'saved-after-close');
  assert.equal(f.node('deepseek-key').value, 'saved-after-close');
  assert.equal(f.node('settings-save-status').textContent, text); assert.equal(f.notices.length, 0);
  f.node('save-settings').disabled = false; f.node('save-settings').click(); await turn();
  assert.equal(f.saves, 1);
});

test('an asynchronous event failure after destroy cannot notify or mutate the closed view', async () => {
  const f = fixture(), hold = gate(); f.refresh(); f.input('language', '关闭前草稿');
  f.hold(async () => { await hold.promise; throw new Error('late synthetic failure'); });
  f.node('save-settings').click(); const text = f.node('settings-save-status').textContent;
  f.controller.destroy(); hold.release(); await turn();
  assert.equal(f.errors.length, 0); assert.equal(f.node('settings-save-status').textContent, text);
  assert.equal(f.node('language').value, '关闭前草稿');
});

test('clean forms disable explicit submit buttons while a prompt draft enables only its own and full-form save', async () => {
  const f = fixture(); f.refresh();
  for (const id of ['save-settings', 'save-summary-prompts', 'vocabulary-reminder-save']) assert.equal(f.node(id).disabled, true);
  for (const id of ['check-key', 'clear-key']) assert.equal(f.node(id).disabled, false);
  f.node('save-settings').click(); await turn(); assert.equal(f.saves, 0);
  assert.deepEqual(f.state('prompts'), { group: 'prompts', mode: 'manual', status: 'clean', dirty: false, text: '已保存 · 修改后需点击保存' });
  f.input('summary-prompt', '新总结');
  assert.equal(f.node('save-settings').disabled, false); assert.equal(f.node('save-summary-prompts').disabled, false);
  assert.equal(f.node('vocabulary-reminder-save').disabled, true);
  assert.equal(f.state('prompts').status, 'dirty'); assert.equal(f.state('questions').status, 'clean');
  f.node('save-settings').click(); await turn();
  assert.equal(f.data.summaryPrompt, '新总结'); assert.equal(f.state('prompts').status, 'clean');
  assert.equal(f.node('save-settings').disabled, true);
});

test('manual groups expose pending, saving, failure and retry without publishing values or credentials', async () => {
  const f = fixture(); f.refresh(); f.input('deepseek-key', 'secret-draft-that-must-stay-private');
  const hold = gate(); f.hold(async () => { await hold.promise; throw new Error('cannot write'); });
  const saving = f.controller.save();
  assert.equal(f.state('api').status, 'saving'); hold.release(); await assert.rejects(saving, /cannot write/);
  assert.equal(f.state('api').status, 'error'); assert.equal(f.state('translation').status, 'clean');
  assert.match(f.node('save-settings').textContent, /重试/);
  assert.equal(JSON.stringify(f.states).includes('secret-draft-that-must-stay-private'), false);
  f.hold(async () => {}); await f.controller.save();
  assert.equal(f.state('api').status, 'clean'); assert.equal(f.node('deepseek-key').value, '');
  assert.match(f.node('key-state').textContent, /已在本机加密保存/);
});

test('instant fields report independent failures, allow retry and never turn the full-form button into an autosave retry', async () => {
  const f = fixture({ instantGroups: ['appearance'] }); f.refresh();
  assert.equal(f.state('appearance').mode, 'instant'); assert.equal(f.state('appearance').status, 'clean');
  assert.equal(f.saves, 0); assert.equal(f.keyReads, 0);
  const hold = gate();
  const theme = f.controller.immediate('appearance', async () => { await hold.promise; throw new Error('theme failure'); }, 'theme');
  assert.equal(f.state('appearance').status, 'saving'); assert.equal(f.node('settings-save-status').textContent, '正在自动保存…');
  await f.controller.immediate('appearance', async () => true, 'motion');
  hold.release(); await assert.rejects(theme, /theme failure/);
  assert.equal(f.state('appearance').status, 'error');
  await f.controller.immediate('appearance', async () => true, 'motion');
  assert.equal(f.state('appearance').status, 'error');
  assert.match(f.node('settings-save-status').textContent, /自动保存失败/);
  assert.equal(f.node('save-settings').disabled, true);
  await f.controller.immediate('appearance', async () => true, 'theme');
  assert.equal(f.state('appearance').status, 'clean'); assert.equal(f.node('settings-save-status').textContent, '设置已保存');
});

test('late same-field instant results cannot replace the latest success or clear its failure', async () => {
  const f = fixture(); f.refresh(); const first = gate();
  const stale = f.controller.immediate('formula', async () => { await first.promise; throw new Error('stale failure'); }, 'formulaModel');
  await f.controller.immediate('formula', async () => true, 'formulaModel');
  assert.equal(f.state('formula').status, 'clean');
  first.release(); await assert.rejects(stale, /stale failure/);
  assert.equal(f.state('formula').status, 'clean');
  const second = gate();
  const staleSuccess = f.controller.immediate('formula', async () => { await second.promise; return true; }, 'formulaModel');
  await assert.rejects(f.controller.immediate('formula', async () => { throw new Error('new failure'); }, 'formulaModel'), /new failure/);
  assert.equal(f.state('formula').status, 'error'); second.release(); await staleSuccess;
  assert.equal(f.state('formula').status, 'error');
});

test('editing back to the previous saved value while a write is pending remains a newer draft', async () => {
  const f = fixture(); f.refresh(); f.input('language', '待提交语言');
  const hold = gate(); f.hold(() => hold.promise); const saving = f.controller.save();
  f.input('language', '简体中文'); hold.release(); await saving;
  assert.equal(f.data.language, '待提交语言'); assert.equal(f.node('language').value, '简体中文');
  assert.equal(f.state('translation').status, 'dirty'); assert.equal(f.node('save-settings').disabled, false);
});

test('post-commit view failures remain view errors and do not invite duplicate persistence', async () => {
  const f = fixture({ vocabularyChanged: () => { throw new Error('vocabulary render unavailable'); } });
  f.refresh(); f.input('vocabulary-manual-assist', false);
  assert.equal(await f.controller.saveVocabulary(), true);
  assert.equal(f.data.vocabularyManualAssist, false); assert.equal(f.saves, 1);
  assert.equal(f.controller.failure, false); assert.equal(f.state('vocabulary').status, 'clean');
  assert.equal(f.node('vocabulary-reminder-save').disabled, true);
  assert.match(f.errors[0].message, /vocabulary render unavailable/);
  const g = fixture({ saveState: () => { throw new Error('state renderer unavailable'); } });
  g.refresh(); g.input('language', 'English'); await g.controller.save();
  assert.equal(g.data.language, 'English'); assert.equal(g.saves, 1); assert.equal(g.controller.failure, false);
  assert.equal(g.node('settings-save-status').textContent, '设置已保存');
});

test('instant completion after destroy cannot publish status or start further operations', async () => {
  const f = fixture(); f.refresh(); const hold = gate();
  const saving = f.controller.immediate('appearance', () => hold.promise, 'theme');
  const count = f.states.length, text = f.node('settings-save-status').textContent;
  f.controller.destroy(); hold.release(); await saving;
  assert.equal(f.states.length, count); assert.equal(f.node('settings-save-status').textContent, text);
  let invoked = false;
  assert.equal(await f.controller.immediate('appearance', () => { invoked = true; }, 'theme'), false);
  assert.equal(invoked, false);
});

test('save state updates preserve shared button label and icon markup', () => {
  const f = fixture(), button = f.node('save-settings'), label = { textContent: '保存设置' };
  button.textContent = 'existing component with glyph';
  button.querySelector = selector => { assert.equal(selector, ':scope > .pc-control-label'); return label; };
  f.refresh(); assert.equal(label.textContent, '无待保存修改');
  f.input('language', 'English'); assert.equal(label.textContent, '保存设置');
  assert.equal(button.textContent, 'existing component with glyph');
});
