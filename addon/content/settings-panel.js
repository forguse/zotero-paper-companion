/* SPDX-License-Identifier: MIT */
/**
 * Settings draft controller. Ports are intentionally narrower than the plugin API:
 * - readSettings()/saveSettings(values, optionalKey) own persisted preferences;
 * - keyPresent() returns a boolean, never a credential or account object;
 * - readPrompt()/defaultPrompt() and readVocabularyState() provide display data;
 * - saveState(group, { mode, status, text, dirty }) reports only generic view state;
 * - notice/error/afterSaved/vocabularyChanged/providerChanged connect the view.
 * No constructor or refresh method performs inference, login or disk writes.
 */
var PCSettingsPanel = class PCSettingsPanel {
  static get fields() { return ['default-provider', 'translator', 'chat-deepseek-model', 'deepseek-model', 'language', 'quick-questions', 'deepseek-key']; }
  static get vocabularyFields() { return ['vocabulary-reminder-enabled', 'vocabulary-reminder-minutes', 'vocabulary-context-fallback', 'vocabulary-context-method', 'vocabulary-manual-assist', 'vocabulary-generate-on-add']; }

  constructor({ document, readSettings, saveSettings, keyPresent, readPrompt, defaultPrompt,
    readVocabularyState, notice = () => {}, error = () => {}, afterSaved = () => {},
    vocabularyChanged = () => {}, providerChanged = () => {}, saveState = () => {}, instantGroups = [] }) {
    this.document = document;
    this.ports = { readSettings, saveSettings, keyPresent, readPrompt, defaultPrompt, readVocabularyState,
      notice, error, afterSaved, vocabularyChanged, providerChanged, saveState };
    this.dirtyFields = new Set();
    this.promptsDirty = false;
    this.vocabularyDirty = false;
    this.savedKeyPresent = null;
    this.keyRevision = 0;
    this.busy = false;
    this.failure = false;
    this.savingScope = null;
    this.failureScope = null;
    this.instantGroups = new Map(instantGroups.map(group => [group, { latest: new Map(), pending: new Set(), failures: new Set() }]));
    this.instantRevision = 0;
    this.destroyed = false;
    this.listeners = [];
    this.bind();
  }

  node(id) { return this.document.getElementById(id); }

  report(error) {
    if (this.destroyed) return;
    // A view's error renderer must not turn a completed write into a failed save.
    try { this.ports.error(error); } catch (_) {}
  }

  listen(id, type, fn) {
    const node = this.node(id);
    const handler = () => {
      if (this.destroyed) return;
      try { Promise.resolve(fn()).catch(error => this.report(error)); }
      catch (error) { this.report(error); }
    };
    node.addEventListener(type, handler);
    this.listeners.push(() => node.removeEventListener(type, handler));
  }

  bind() {
    for (const id of PCSettingsPanel.fields) {
      for (const type of ['input', 'change']) this.listen(id, type, () => {
        this.dirtyFields.add(id); this.failure = false; this.status();
      });
    }
    this.listen('default-provider', 'change', () => this.ports.providerChanged());
    this.listen('deepseek-key', 'input', () => this.keyEdited());
    this.listen('check-key', 'click', () => this.refreshKeyState());
    this.listen('clear-key', 'click', () => this.clearKey());
    for (const kind of ['summary', 'review']) {
      this.listen(kind + '-prompt', 'input', () => this.promptEdited());
      this.listen(kind + '-prompt-reset', 'click', () => {
        this.node(kind + '-prompt').value = this.ports.defaultPrompt(kind); this.promptEdited();
      });
    }
    for (const id of PCSettingsPanel.vocabularyFields) this.listen(id, 'input', () => {
      this.vocabularyDirty = true; this.failure = false; this.status();
    });
    this.listen('vocabulary-reminder-minutes', 'input', () => this.displayInterval());
    for (const id of ['vocabulary-reminder-count', 'vocabulary-reminder-unit']) this.listen(id, 'input', () => {
      const unit = Number(this.node('vocabulary-reminder-unit').value);
      this.node('vocabulary-reminder-minutes').value = Number(this.node('vocabulary-reminder-count').value) * unit;
      this.intervalBounds(unit); this.vocabularyDirty = true; this.failure = false; this.status();
    });
    this.listen('vocabulary-reminder-save', 'click', () => this.saveVocabulary());
    this.listen('save-summary-prompts', 'click', () => this.savePrompts());
    this.listen('save-settings', 'click', () => this.save());
  }

  status() {
    if (this.destroyed) return;
    const dirty = !!(this.dirtyFields.size || this.promptsDirty || this.vocabularyDirty);
    const pending = [...this.instantGroups.values()].some(group => this.instantPending(group));
    const failed = [...this.instantGroups.values()].some(group => group.failures.size);
    this.node('settings-save-status').textContent = this.busy ? '正在保存…' : this.failure ? '保存失败，修改仍保留' :
      dirty ? '有未保存的修改' : pending ? '正在自动保存…' : failed ? '部分自动保存失败，请在对应选项重试' : '设置已保存';
    const buttons = [
      ['save-settings', dirty, '保存设置', '无待保存修改', 'all'],
      ['vocabulary-reminder-save', this.vocabularyDirty, '保存单词本设置', '单词本设置已保存', 'vocabulary'],
      ['save-summary-prompts', this.promptsDirty, '保存两份提示词', '提示词已保存', 'prompts']
    ];
    for (const [id, changed, label, clean, scope] of buttons) {
      const button = this.node(id), saving = this.busy && (this.savingScope === 'all' || this.savingScope === scope);
      const retry = this.failure && (scope === 'all' || this.failureScope === 'all' || this.failureScope === scope);
      button.disabled = this.busy || !changed;
      const caption = button.querySelector?.(':scope > .pc-control-label') || button;
      const text = saving ? '正在保存…' : !changed ? clean : retry ? '重试' + label : label;
      if (caption.textContent !== text) caption.textContent = text;
    }
    for (const id of ['clear-key', 'check-key']) this.node(id).disabled = this.busy;
    const groups = {
      general: dirty, connection: this.dirtyFields.has('default-provider'),
      api: ['deepseek-key', 'chat-deepseek-model'].some(id => this.dirtyFields.has(id)),
      translation: ['translator', 'deepseek-model', 'language'].some(id => this.dirtyFields.has(id)),
      questions: this.dirtyFields.has('quick-questions'), prompts: this.promptsDirty, vocabulary: this.vocabularyDirty
    };
    for (const [group, changed] of Object.entries(groups)) {
      const saving = this.busy && (this.savingScope === 'all' || this.savingScope === group || group === 'general');
      const error = this.failure && (this.failureScope === group || group === 'general' || this.failureScope === 'all' && changed);
      const state = saving ? 'saving' : error ? 'error' : changed ? 'dirty' : 'clean';
      this.publish(group, { mode: 'manual', status: state, dirty: changed,
        text: state === 'saving' ? '正在保存…' : state === 'error' ? '保存失败 · 修改已保留，可重试' : changed ? '待保存 · 点击保存后生效' : '已保存 · 修改后需点击保存' });
    }
    for (const [group, bucket] of this.instantGroups) {
      const state = this.instantPending(bucket) ? 'saving' : bucket.failures.size ? 'error' : 'clean';
      this.publish(group, { mode: 'instant', status: state, dirty: !!bucket.failures.size,
        text: state === 'saving' ? '自动保存中…' : state === 'error' ? '自动保存失败 · 请在此选项重试' : '自动保存 · 已保存' });
    }
  }

  publish(group, detail) {
    if (this.destroyed) return;
    try { this.ports.saveState(group, detail); } catch (error) { this.report(error); }
  }

  instantPending(bucket) { return [...bucket.latest.values()].some(revision => bucket.pending.has(revision)); }

  // Existing instant-save handlers retain their domain logic. This wrapper only
  // coordinates visible status; it never reads settings, credentials or models.
  async immediate(group, operation, key = group) {
    if (this.destroyed) return false;
    if (!this.instantGroups.has(group)) this.instantGroups.set(group, { latest: new Map(), pending: new Set(), failures: new Set() });
    const bucket = this.instantGroups.get(group), revision = ++this.instantRevision;
    bucket.latest.set(key, revision); bucket.pending.add(revision); this.status();
    try {
      const result = await operation();
      if (bucket.latest.get(key) === revision) bucket.failures.delete(key);
      return result;
    } catch (error) {
      if (bucket.latest.get(key) === revision) bucket.failures.add(key);
      throw error;
    } finally {
      bucket.pending.delete(revision); this.status();
    }
  }

  refresh() {
    if (this.destroyed) return;
    const s = this.ports.readSettings();
    const fields = { 'default-provider': s.chatProvider, translator: s.translationProvider,
      'chat-deepseek-model': s.chatDeepseekModel, 'deepseek-model': s.deepseekModel,
      language: s.language, 'quick-questions': s.quickQuestions.join('\n') };
    for (const [id, value] of Object.entries(fields)) if (!this.dirtyFields.has(id)) this.node(id).value = value;
    this.ports.providerChanged(); this.refreshPrompts(); this.status();
  }

  promptValues() { return { summaryPrompt: this.node('summary-prompt').value, reviewPrompt: this.node('review-prompt').value }; }

  refreshPrompts() {
    if (this.promptsDirty || this.destroyed) return;
    for (const kind of ['summary', 'review']) this.node(kind + '-prompt').value = this.ports.readPrompt(kind);
    this.node('summary-prompts-status').textContent = '当前提示词已生效；修改后请保存。保存不会调用模型。';
  }

  promptEdited() {
    this.promptsDirty = true; this.failure = false;
    this.node('summary-prompts-status').textContent = '有未保存的修改。保存后用于后续整理，不会立即调用模型。';
    this.status();
  }

  promptsSaved(values) {
    const current = this.promptValues();
    if (Object.keys(values).every(name => current[name].trim() === values[name].trim())) {
      this.promptsDirty = false; this.refreshPrompts();
    }
  }

  vocabularyValues() {
    return { vocabularyReminderEnabled: this.node('vocabulary-reminder-enabled').checked,
      vocabularyReminderMinutes: Number(this.node('vocabulary-reminder-minutes').value),
      vocabularyContextFallback: this.node('vocabulary-context-fallback').value,
      vocabularyContextMethod: this.node('vocabulary-context-method').value,
      vocabularyManualAssist: this.node('vocabulary-manual-assist').checked,
      vocabularyGenerateOnAdd: this.node('vocabulary-generate-on-add').checked };
  }

  intervalBounds(unit) {
    this.node('vocabulary-reminder-count').min = unit === 1 ? '5' : '1';
    this.node('vocabulary-reminder-count').max = String(Math.floor(525600 / unit));
  }

  displayInterval() {
    const minutes = Number(this.node('vocabulary-reminder-minutes').value);
    const unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
    this.node('vocabulary-reminder-unit').value = String(unit);
    this.node('vocabulary-reminder-count').value = minutes / unit; this.intervalBounds(unit);
  }

  refreshVocabulary(value) {
    if (this.destroyed) return;
    value ??= this.ports.readVocabularyState();
    this.node('vocabulary-settings-status').textContent = value.problem || `${value.stats.words} 个词 · ${value.stats.pending} 条待复习`;
    if (this.vocabularyDirty) return;
    const s = this.ports.readSettings();
    for (const [id, name] of [['vocabulary-reminder-enabled', 'vocabularyReminderEnabled'],
      ['vocabulary-manual-assist', 'vocabularyManualAssist'], ['vocabulary-generate-on-add', 'vocabularyGenerateOnAdd']]) this.node(id).checked = !!s[name];
    for (const [id, name] of [['vocabulary-reminder-minutes', 'vocabularyReminderMinutes'],
      ['vocabulary-context-fallback', 'vocabularyContextFallback'], ['vocabulary-context-method', 'vocabularyContextMethod']]) this.node(id).value = s[name];
    this.displayInterval();
  }

  keyEdited() {
    this.node('key-state').textContent = this.node('deepseek-key').value ? '新 Key 尚未保存；保存后才会替换。' :
      this.savedKeyPresent ? '已有 Key 将继续保留。' : '留空不会添加 Key。';
  }

  async refreshKeyState() {
    if (this.destroyed) return;
    const revision = ++this.keyRevision;
    let present;
    try { present = !!(await this.ports.keyPresent()); }
    catch (error) { if (this.destroyed || revision !== this.keyRevision) return; throw error; }
    if (this.destroyed || revision !== this.keyRevision) return;
    this.savedKeyPresent = present;
    this.node('deepseek-key').placeholder = present ? '已保存 API Key · 输入新 Key 可更换' : '填写自己的 API Key';
    this.node('key-state').textContent = this.node('deepseek-key').value ? '新 Key 尚未保存。' :
      present ? '✓ API Key 已在本机加密保存 · 未验证服务有效性。留空保存会保留。' : '尚未保存 API Key。';
  }

  async refreshSavedKeyState() {
    try { await this.refreshKeyState(); }
    catch (error) {
      if (this.destroyed) return;
      this.node('key-state').textContent = '设置已保存，Key 状态暂时无法读取，请点击检查重试。';
      this.report(error);
    }
  }

  async transact(action, scope = 'all') {
    if (this.busy || this.destroyed) return false;
    this.busy = true; this.savingScope = scope; this.failure = false; this.failureScope = null; this.status();
    let committed = false;
    try { await action(() => { committed = true; }); return true; }
    catch (error) {
      if (committed) { this.report(error); return true; }
      this.failure = true; this.failureScope = scope; throw error;
    }
    finally { this.busy = false; this.savingScope = null; this.status(); }
  }

  clearKey() {
    return this.transact(async committed => {
      await this.ports.saveSettings({}, ''); committed(); await this.refreshSavedKeyState();
      if (!this.destroyed) this.ports.notice('已删除保存的 Key；未保存的输入仍保留。');
    }, 'api');
  }

  savePrompts() {
    return this.transact(async committed => {
      const values = this.promptValues(); await this.ports.saveSettings(values); committed();
      if (this.destroyed) return;
      this.promptsSaved(values);
      this.ports.notice('两份文档的提示词已保存。点击更新按钮或按已开启的自动维护规则生效。');
    }, 'prompts');
  }

  saveVocabulary() {
    return this.transact(async committed => {
      const values = this.vocabularyValues(); await this.ports.saveSettings(values); committed();
      if (this.destroyed) return;
      this.vocabularyDirty = JSON.stringify(values) !== JSON.stringify(this.vocabularyValues());
      this.refreshVocabulary(); this.ports.vocabularyChanged();
      this.node('vocabulary-settings-status').textContent += this.vocabularyDirty ? ' · 已保存；新修改尚未保存' : ' · 设置已保存';
    }, 'vocabulary');
  }

  save() {
    return this.transact(async committed => {
      // Credential text exists only in this operation's DOM snapshot, never in controller state.
      const fields = Object.fromEntries(PCSettingsPanel.fields.map(id => [id, this.node(id).value]));
      const questions = fields['quick-questions'].split(/\r?\n/).map(q => q.trim()).filter(Boolean);
      if (questions.length > 30 || questions.some(q => q.length > 2000)) throw new Error('最多 30 个问题，每个最多 2000 字符。');
      const prompts = this.promptValues(), vocabulary = this.vocabularyValues();
      await this.ports.saveSettings({ chatProvider: fields['default-provider'], chatDeepseekModel: fields['chat-deepseek-model'],
        translationProvider: fields.translator, deepseekModel: fields['deepseek-model'], language: fields.language,
        quickQuestions: questions, ...prompts, ...vocabulary }, fields['deepseek-key'].trim() || undefined); committed();
      if (this.destroyed) return;
      for (const id of PCSettingsPanel.fields) if (this.node(id).value === fields[id]) {
        this.dirtyFields.delete(id); if (id === 'deepseek-key') this.node(id).value = '';
      }
      this.vocabularyDirty = JSON.stringify(vocabulary) !== JSON.stringify(this.vocabularyValues());
      this.promptsSaved(prompts); this.refresh(); this.refreshVocabulary(); this.ports.vocabularyChanged();
      await this.refreshSavedKeyState();
      if (!this.destroyed) {
        this.ports.notice('设置已保存。');
        try { await this.ports.afterSaved(); }
        catch (error) { this.report(error); }
      }
    });
  }

  destroy() {
    this.destroyed = true; this.keyRevision++;
    for (const remove of this.listeners) remove(); this.listeners.length = 0;
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = PCSettingsPanel;
