/* SPDX-License-Identifier: MIT — Zotero 7+ platform adapter. No startup network. */
var PaperCompanion = new (class {
  constructor() {
    this.state = "offline"; this.epoch = 0; this.listeners = new Set(); this.windows = new Map();
    this.requests = new Set(); this.inferences = new Set(); this.tasks = new PCKeyedQueue(); this.fileWrites = new PCKeyedQueue();
    this.sessionStore = new PCSessionStore({
      read: (name, fallback) => this.readJSON(PathUtils.join(this.chatsDir, name), fallback),
      write: (name, text) => this.writeText(PathUtils.join(this.chatsDir, name), text),
      exists: name => IOUtils.exists(PathUtils.join(this.chatsDir, name)), list: () => IOUtils.getChildren(this.chatsDir),
      basename: path => PathUtils.filename(path), busy: () => this.chatBusy,
      emit: (type, data) => this.emit(type, data), safeError: message => PCore.safeError(message)
    });
    this.sessions = this.sessionStore.sessions; this.unsavedSessions = this.sessionStore.unsaved;
    this.noteWrites = new Map(); this.noteBaselines = new Map();
    this.selectionPopups = new Set(); this.readerSelections = new Map(); this.translations = new Map(); this.popupNoteDrafts = new Map();
    this.panels = new Set(); this.inferenceVerified = false; this.panel = null; this.readerID = null; this.models = [];
    this.settings = { chatProvider: "", chatDeepseekModel: "deepseek-flash", selectionTranslation: "click", popupTranslation: true, pageFormat: "both", excerptStyle: "quote", autoRecord: false, autoRecordOptIn: false, quickQuestions: ["这篇论文为什么要做？", "最本质的 motivation 是什么？", "basic idea 是怎么来的？", "方法为什么这么设计？", "实验到底支撑了什么？", "这篇论文真实价值在哪，水分在哪？"], deepseekModel: "deepseek-flash", translationProvider: "deepseek", translationEffort: "none", translationChatGPTModel: "", translationChatGPTEffort: "default", summaryEnabledPapers: {}, summaryProvider: "deepseek", summaryDeepseekModel: "deepseek-flash", summaryChatGPTModel: "", summaryEffort: "none", summaryChatGPTEffort: "default", language: "简体中文", model: "" };
    this.settings.summaryPrompt = PCInsights.defaultPrompts.summary; this.settings.reviewPrompt = PCInsights.defaultPrompts.review;
    this.settings.formulaProvider = 'deepseek'; this.settings.formulaChatGPTModel = '';
    this.settings.smartReading = true;
    this.settings.webCompactComposer = true;
    this.settings.headerCollapsed = true;
    this.settings.chatOptionsCollapsed = true; this.settings.materialsCollapsed = true;
    this.settings.translationExcerptStyle = 'markdown';
    this.settings.vocabularyReminderEnabled = true; this.settings.vocabularyReminderMinutes = 10080;
    this.settings.vocabularyContextFallback='manual';this.settings.vocabularyContextMethod='ocr';this.settings.vocabularyManualAssist=false;this.settings.vocabularyGenerateOnAdd=true;
    this.settings.quickQuestionsVersion = 2;
    this.settings.chatGPTEffort = 'default';
    this.settings.screenshotCopy = false;
    this.settings.theme='cloud';this.settings.appearanceMotion='standard';this.settings.edgeLight=true;
    this.settings.actionGuidePins = []; this.settings.actionGuideDismissed = false;
    this.clearUndo = Zotero.PaperCompanionClearUndo ||= new Map();
    this.clearRestores = new Map();
    this.folderChanges = new Map();
    this.nativeOperations = new Map(); this.maintenanceMethods = new Map(); this.maintenance = null;
    this.guardMaintenance(this, ['saveSettings','saveAppearance','setAccount','setToken','connect','chooseAccount','logout','request','infer','extract','appendExcerpt','appendPaperNote','exportMaterials','clearContext','newSession','restoreSession','ask','previewReading','searchPapers','translate','note','saveNote','rememberClear','restoreClearedNote','backupNote','exportNote','addZoteroNote','openPaperDocument','choosePaperFolder','changePaperFolder','chooseVocabularyFolder','vocabularyBackupFile','openPanel','activatePanel','openVocabulary']);
  }
  async init() {
    this.dir = PathUtils.join(Zotero.Profile.dir, "paper-companion");
    this.notesDir = PathUtils.join(Zotero.DataDirectory.dir, "paper-companion", "notes");
    this.chatsDir = PathUtils.join(Zotero.DataDirectory.dir, "paper-companion", "chats");
    for (const dir of [this.dir, this.notesDir, this.chatsDir]) await IOUtils.makeDirectory(dir, { ignoreExisting: true, createAncestors: true, permissions: 0o700 });
    this.meta = await this.readJSON(PathUtils.join(this.dir, "accounts.json"), { hostID: "urn:uuid:" + Services.uuid.generateUUID().toString().slice(1, -1), accounts: [], active: null });
    await this.writeJSON(PathUtils.join(this.dir, "accounts.json"), this.meta);
    const savedSettings = await this.readJSON(PathUtils.join(this.dir, "settings.json"), {});
    Object.assign(this.settings, savedSettings);
    const guideIDs = ['questions','screenshot','formula','notes','highlights','vocabulary','practice'];
    this.settings.actionGuidePins = [...new Set(Array.isArray(savedSettings.actionGuidePins) ? savedSettings.actionGuidePins.filter(id => guideIDs.includes(id)) : [])].slice(0, 2);
    this.settings.actionGuideDismissed = savedSettings.actionGuideDismissed === true;
    if(!PCore.themeIDs().includes(this.settings.theme))this.settings.theme='cloud';
    if(!['standard','reduced','off'].includes(this.settings.appearanceMotion))this.settings.appearanceMotion='standard';
    if(typeof this.settings.edgeLight!=='boolean')this.settings.edgeLight=true;
    Object.assign(this.settings, PCVocabulary.reminderSettings(savedSettings));
    if(!['manual','automatic','none'].includes(this.settings.vocabularyContextFallback))this.settings.vocabularyContextFallback='manual';
    if(!['model','ocr'].includes(this.settings.vocabularyContextMethod))this.settings.vocabularyContextMethod='ocr';
    for(const name of ['vocabularyManualAssist','vocabularyGenerateOnAdd'])if(typeof this.settings[name]!=='boolean')this.settings[name]=name==='vocabularyGenerateOnAdd';
    this.settings.chatOptionsCollapsed = true; // Start compact; expand explicitly when choosing a model.
    if (!['markdown','plain','quote','code'].includes(this.settings.translationExcerptStyle)) this.settings.translationExcerptStyle = 'markdown';
    if (savedSettings.compactLayoutVersion !== 1) {
      this.settings.headerCollapsed = true; this.settings.chatOptionsCollapsed = true; this.settings.materialsCollapsed = true;
    }
    this.settings.compactLayoutVersion = 1;
    const oldQuestions = ["概括研究问题、方法和结论。", "用直观的例子解释核心方法。", "这段论证有哪些假设与局限？"];
    if (savedSettings.quickQuestionsVersion !== 2 && JSON.stringify(this.settings.quickQuestions) === JSON.stringify(oldQuestions)) this.settings.quickQuestions = ["这篇论文为什么要做？", "最本质的 motivation 是什么？", "basic idea 是怎么来的？", "方法为什么这么设计？", "实验到底支撑了什么？", "这篇论文真实价值在哪，水分在哪？"];
    this.settings.quickQuestionsVersion = 2;
    // Earlier versions enabled answer recording by default. Require an explicit
    // choice under the new personal-notes default, without changing saved notes.
    if (!this.settings.autoRecordOptIn) this.settings.autoRecord = false;
    this.usage = new PCUsage(this); await this.usage.init();
    this.auth = new ChatGPTAuth({ crypto,
      json: (u, o) => this.json(u, o), form: (u, p, s, empty) => this.form(u, p, s, empty),
      launch: u => Zotero.launchURL(u), createCallback: s => this.createCallback(s),
      readMeta: async () => this.meta, readSecrets: () => this.readSecrets(),
      setAccount: (a, t) => this.setAccount(a, t), setToken: (id, t) => this.setToken(id, t)
    });
    this.web = new PCWebView(this); this.web.init();
    this.insights = new PCInsights(this); await this.insights.init();
    this.formula = new PCFormula(this);
    this.reading = new PCReading(this);
    this.preread = new PCPreRead(this);
    this.files = new PCPaperFiles(this); await this.files.init();
    this.vocabulary = new PCVocabulary(this); await this.vocabulary.init();
    this.sidebar = new PCSidebar(this); this.sidebar.init();
    this.selectionHandler = event => this.selectionPopup(event);
    this.toolbarHandler = event => {
      const button = event.doc.createElement("button"); button.type = "button"; button.textContent = "伴读";
      button.title = "Paper Companion · 论文伴读"; button.className = "toolbar-button";
      button.style.cssText = "font-size:12px;min-width:42px;padding:3px 8px;color:inherit;";
      button.addEventListener("click", () => { this.readerID = event.reader.itemID; this.openPanel(); });
      event.append(button);
      const formula = event.doc.createElement('button'); formula.type = 'button'; formula.textContent = '复制公式'; formula.className = 'toolbar-button'; formula.title = '拖框截图 → 识别 TeX → 自动复制';
      const formulaTitle=()=>{formula.title=PCore.featureModel(this.settings,'formula').label+' · 拖框识别 TeX 并复制';};formula.addEventListener('mouseenter',formulaTitle);formula.addEventListener('focus',formulaTitle);formulaTitle();
      formula.addEventListener('click', () => this.openPanel({ readerID: event.reader.itemID, action: 'formula-copy' }).catch(e => this.emit('error', { message: PCore.safeError(e.message) })));
      event.append(formula);
    };
    Zotero.Reader.registerEventListener("renderTextSelectionPopup", this.selectionHandler, pluginID);
    Zotero.Reader.registerEventListener("renderToolbar", this.toolbarHandler, pluginID);
    this.guardMaintenanceServices();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) { try { fn({ type, ...data }); } catch (_) {} } }
  async readJSON(path, fallback) {
    if (!await IOUtils.exists(path)) return fallback;
    return JSON.parse(await IOUtils.readUTF8(path)); // Corruption must not silently overwrite notes/credentials.
  }
  async writeText(path, value) {
    if (this.maintenance === 'locked') throw new Error('正在卸载清理，已暂停文件写入。');
    const key = Zotero.isWin ? path.replace(/\\/g, '/').toLowerCase() : path;
    await this.fileWrites.run(key, () => IOUtils.writeUTF8(path, value, { tmpPath: path + ".tmp", mode: "overwrite", permissions: 0o600 }));
  }
  async writeJSON(path, value) { return this.writeText(path, JSON.stringify(value, null, 2)); }
  queue(fn, scope = 'preferences') { if (this.maintenance === 'locked') return Promise.reject(new Error('正在卸载清理，已暂停保存。')); return this.tasks.run(scope, fn); }
  get serial() { return this.tasks.drain(); }
  get sessionSaves() { return this.sessionStore.saving; }
  get sessionChanging() { return this.sessionStore.changing; }
  get sessionRestoring() { return this.sessionStore.restoring; }
  // Created only when an insertion receipt is used. Keep one store across pane
  // recreation, without making unrelated platform/VM entry points load it.
  get noteInsertions() { return this._noteInsertions ||= new PCNoteInsertions(); }
  get uninstallReview() {
    return this._uninstallReview ||= new PCUninstall({ inventory: () => this.uninstallInventory(),
      fingerprint: path => this.uninstallFingerprint(path), inspectFile: path => this.inspectUninstallFile(path),
      revalidate: (plan, context) => this.revalidateUninstall(plan, context), quiesce: () => this.quiesceUninstall(),
      removeFile: (path, row) => this.removeUninstallFile(path, row), invalidate: () => this.invalidateUninstall(), finalize: () => this.finalizeUninstall() });
  }
  guardMaintenance(object, names) {
    if (!object) return;
    let originals = this.maintenanceMethods.get(object);
    if (!originals) this.maintenanceMethods.set(object, originals = new Map());
    for (const name of names) {
      if (originals.has(name) || typeof object[name] !== 'function') continue;
      const original = object[name], api = this; originals.set(name, original);
      object[name] = function (...args) {
        if (api.maintenance) {
          const error = new Error('正在卸载前清理，请先完成清理或取消尚未执行的操作。');
          if (original.constructor.name === 'AsyncFunction') return Promise.reject(error);
          throw error;
        }
        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') {
          api.nativeOperations.set(result, name);
          const done = () => api.nativeOperations.delete(result); result.then(done, done);
        }
        return result;
      };
    }
  }
  guardMaintenanceServices() {
    for (const [object, names] of [
      [this.files,['ensure','relocate','create']],
      [this.vocabulary,['add','edit','removeEncounter','restoreEncounter','enrich','beginManual','setContext','acceptSelection','autoContext','assistContext','reviewed','feedback','openFile','relocate','importBackup']],
      [this.reading,['load','prepare','search']], [this.preread,['plan','run']],
      [this.insights,['setEnabled','manualUpdate','enqueue','review','watchWeb']],
      [this.formula,['capture','recognize','insert']], [this.web,['open','fill','preread','attach','reload']],
      [this.usage,['setRate','queryBalance']]
    ]) this.guardMaintenance(object, names);
  }
  async quiesceUninstall() {
    if (this.closing) throw new Error('Zotero 正在关闭，不能开始清理。');
    if (this.maintenance === 'locked') return () => this.resumeUninstall();
    if (this.maintenance) throw new Error('卸载清理正在准备，请等待。');
    // Set the gate synchronously, before any asynchronous operation can admit
    // another save, model request, picker, vocabulary action or reader task.
    this.maintenance = 'draining'; this.guardMaintenanceServices();
    this.uninstallState = { changed: false, removed: new Set(), sourceRevision: 0, checkedRevision: null,
      readingClosing: this.reading?.closing, insightsDestroyed: this.insights?.destroyed, inert: [], watches: [...(this.insights?.watches || new Map()).entries()] };
    const state = this.uninstallState;
    try {
      if ([...this.nativeOperations.values()].some(name => ['exportMaterials','exportNote','choosePaperFolder','chooseVocabularyFolder','vocabularyBackupFile','changePaperFolder','relocate','create','importBackup','appendExcerpt','appendPaperNote'].includes(name))) throw new Error('请先完成正在进行的资料保存、搬迁或文件选择操作，再重新核对清单。');
      state.observer = Zotero.Notifier.registerObserver({ notify: () => { state.sourceRevision++; } }, ['item'], 'paper-companion-uninstall');
      for (const win of new Set([...this.panels, this.vocabularyWindow].filter(Boolean))) if (!win.closed) {
        for (const node of win.document.body?.children || []) if (!node.classList.contains('pc-uninstall-review')) { state.inert.push([node, node.inert]); node.inert = true; }
      }
      for (const popup of this.selectionPopups) { popup.timer?.cancel(); if (popup.box) { state.inert.push([popup.box, popup.box.inert]); popup.box.inert = true; } }
      for (const record of this.noteWrites.values()) record.timer?.cancel();
      this.disconnect(); this.preread?.destroy(); this.insights?.destroy(); this.formula?.destroy();
      this.vocabulary?.cancel(); for (const controller of this.vocabulary?.contextControllers?.values() || []) controller.abort(); this.vocabulary?.cancelManual();
      this.usage?.balanceController?.abort();
      const readingDrain = this.reading?.destroy();
      this.emit('maintenance', { active: true, phase: 'draining' });
      await this.chatCompletion; await readingDrain;
      while (this.nativeOperations.size || this.inferences.size) await Promise.allSettled([...this.nativeOperations.keys(), ...this.inferences]);
      await Promise.allSettled([...(this.preread?.jobs?.values() || []), ...(this.insights?.jobs?.values() || []), ...(this.insights?.manualJobs?.values() || []), ...(this.insights?.reviewJobs?.values() || []), ...(this.vocabulary?.jobs?.values() || []), ...(this.vocabulary?.contextJobs?.values() || []), this.vocabulary?.serial, this.usage?.balanceJob, this.usage?.serial].filter(Boolean));
      await this.flushNotes(); await this.sessionStore.drain(); await this.serial; await this.fileWrites.drain();
      if (this.noteWrites.size || this.unsavedSessions.size) throw new Error('仍有未保存的笔记或对话，请先重试保存，再开始清理。');
      this.maintenance = 'locked'; this.emit('maintenance', { active: true, phase: 'locked' });
      return () => this.resumeUninstall();
    } catch (error) { this.resumeUninstall(); throw error; }
  }
  resumeUninstall() {
    const state = this.uninstallState;
    if (!state || state.changed || this._uninstallReview?.partial) return false;
    if (state.observer != null) Zotero.Notifier.unregisterObserver(state.observer);
    for (const [node, inert] of state.inert) if (node.isConnected) node.inert = inert;
    if (this.reading) this.reading.closing = state.readingClosing;
    if (this.insights) this.insights.destroyed = state.insightsDestroyed;
    if (state.memory) { this.meta = state.memory.meta; this.models = state.memory.models; this.lastSelection = state.memory.lastSelection; this.lastFormulaCopy = state.memory.lastFormulaCopy; this.inferenceVerified = state.memory.inferenceVerified; for (const [key,value] of state.memory.sessions) this.sessions.set(key,value); for (const [key,value] of state.memory.translations) this.translations.set(key,value); }
    this.maintenance = null; this.uninstallState = null;
    for (const [win, watch] of state.watches) if (!win.closed && this.insights && !this.insights.destroyed) this.paperFromKey(watch.key).then(paper => { if (!this.maintenance) this.insights.watchWeb(win, paper); }).catch(() => {});
    this.emit('maintenance', { active: false }); return true;
  }
  async inspectUninstallFile(path) {
    const io = this.uninstallIO(); try { return await io.inspectFile(path); } finally { io.close(); }
  }
  async uninstallFingerprint(path) {
    const io = this.uninstallIO();
    try {
      const before = await io.inspectFile(path); if (!before) return null;
      if (!before.regular) throw new Error('待清理项目不是普通文件，请重新核对。');
      let hash;
      if (typeof IOUtils.computeHexDigest === 'function') hash = await IOUtils.computeHexDigest(path, 'sha256');
      else {
        const digest = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash); digest.init(digest.SHA256);
        for (let offset = 0; offset < before.size;) {
          const bytes = await IOUtils.read(path, { offset, maxBytes: Math.min(1048576, before.size - offset) });
          if (!bytes.length) throw new Error('文件在核对期间发生变化，请重新生成清单。');
          digest.update(bytes, bytes.length); offset += bytes.length;
        }
        hash = [...digest.finish(false)].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      }
      const after = await io.inspectFile(path);
      if (!after || after.size !== before.size || after.modified !== before.modified || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('文件在核对期间发生变化，请重新生成清单。');
      return { ...after, hash };
    } finally { io.close(); }
  }
  async revalidateUninstall(plan, { removed = [], categories = [], final = false } = {}) {
    const state = this.uninstallState;
    if (this.maintenance !== 'locked' || !state || this.closing) throw new Error('清理尚未准备完成或 Zotero 正在关闭。');
    if (state.planID === plan.id && state.checkedRevision !== null && state.sourceRevision !== state.checkedRevision) throw new Error('Zotero 文献附件在清理期间发生变化，请重新核对清单。');
    const normalized = path => Zotero.isWin ? path.replace(/\\/g, '/').toLowerCase() : path;
    if (state.planID !== plan.id || final) {
      const revision = state.sourceRevision, live = await this.uninstallInventory(), known = new Map(plan.files.map(row => [normalized(row.path), row])), gone = new Set(removed.map(normalized));
      if (state.sourceRevision !== revision) throw new Error('Zotero 文献附件在清理期间发生变化，请重新核对清单。');
      for (const row of live.files) if (categories.includes(row.category) && !known.has(normalized(row.path))) throw new Error('发现清单外的新插件文件，请重新生成清单后确认。');
      const livePaths = new Set(live.files.map(row => normalized(row.path)));
      for (const row of plan.files) if (categories.includes(row.category) && !gone.has(normalized(row.path)) && !livePaths.has(normalized(row.path)) && await IOUtils.exists(row.path)) throw new Error('文件归属或原始附件保护状态已改变，请重新核对。');
      state.planID = plan.id; state.checkedRevision = state.sourceRevision; state.protectedPaths = new Set((this.lastUninstallProtectedPaths || []).map(normalized));
      state.plan = plan; state.categories = [...categories];
    }
    state.removed = new Set(removed); return true;
  }
  async removeUninstallFile(path, row) {
    const state = this.uninstallState;
    if (!state || this.maintenance !== 'locked' || this.closing || !state.plan?.files.includes(row) || row.path !== path || !state.categories.includes(row.category)) throw new Error('文件不在已确认的清理范围内。');
    await this.revalidateUninstall(state.plan, { removed: [...state.removed], categories: state.categories });
    const normalized = Zotero.isWin ? path.replace(/\\/g, '/').toLowerCase() : path;
    if (state.protectedPaths.has(normalized)) throw new Error('这是 Zotero 原始附件，已保留。');
    // A paper's identity must still match its registered ownership. The core
    // deletes identity and registry files last so partial retries retain proof.
    const paper = this.files?.locations?.[row.owner];
    const identityPath = paper && PathUtils.join(paper.dir, '.paper-companion', 'identity.json');
    if (identityPath && !state.removed.has(identityPath)) {
      const io = this.uninstallIO();
      try { const identity = await io.readJSON(identityPath); if (identity?.key !== row.owner || identity.source !== paper.source || identity.version !== 1) throw new Error('论文资料归属已改变，文件已保留。'); }
      finally { io.close(); }
    }
    const current = await this.uninstallFingerprint(path);
    if (!current || current.hash !== row.hash || current.size !== row.size || current.modified !== row.modified) throw new Error('文件在确认后已修改，请重新生成清单。');
    if (state.sourceRevision !== state.checkedRevision) throw new Error('Zotero 附件已改变，文件已保留。');
    await IOUtils.remove(path, { recursive: false, ignoreAbsent: false });
    state.changed = true; state.removed.add(path);
  }
  invalidateUninstall() {
    if (this.maintenance !== 'locked') throw new Error('尚未完成清理准备。');
    const state = this.uninstallState;
    if (!state.memory) state.memory = { meta: this.meta, models: this.models, lastSelection: this.lastSelection, lastFormulaCopy: this.lastFormulaCopy, inferenceVerified: this.inferenceVerified, sessions: new Map(this.sessions), translations: new Map(this.translations) };
    this._noteInsertions?.clear(); this.clearUndo.clear(); this.clearRestores.clear(); this.popupNoteDrafts.clear(); this.noteBaselines.clear();
    this.sessions.clear(); this.translations.clear(); this.models = []; this.inferenceVerified = false;
    this.meta = { hostID: '', accounts: [], active: null }; this.lastSelection = null; this.lastFormulaCopy = '';
  }
  async finalizeUninstall() {
    const state = this.uninstallState;
    if (!state || this.maintenance !== 'locked') throw new Error('卸载清理尚未完成。');
    await this.revalidateUninstall(state.plan, { removed: [...state.removed], categories: state.categories, final: true });
    let AddonManager;
    try { ({ AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs')); }
    catch (_) { ({ AddonManager } = ChromeUtils.import('resource://gre/modules/AddonManager.jsm')); }
    const addon = await AddonManager.getAddonByID(pluginID); if (!addon) throw new Error('插件管理器未找到当前插件，请在 Zotero 中检查安装状态。');
    this.uninstallFinalizing = true;
    await addon.uninstall();
    if (await AddonManager.getAddonByID(pluginID)) throw new Error('数据清理已完成，插件仍待 Zotero 完成卸载；请重启后检查插件管理器。');
  }
  uninstallIO() {
    // Windows nsIFile.isSymlink() cannot detect NTFS junctions. This optional
    // read-only adapter checks every component's reparse bit before traversing.
    let library, attributes;
    if (Zotero.isWin) {
      let ctypes;
      try { ({ ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs')); }
      catch (_) { ({ ctypes } = ChromeUtils.import('resource://gre/modules/ctypes.jsm')); }
      library = ctypes.open('kernel32.dll');
      try {
        const getAttributes = library.declare('GetFileAttributesW', ctypes.winapi_abi, ctypes.uint32_t, ctypes.char16_t.ptr);
        attributes = path => {
          const value = Number(getAttributes(path)) >>> 0;
          if (value === 0xffffffff) {
            const code = ctypes.winLastError;
            if (code === 2 || code === 3) return null;
            throw new Error('无法安全核对文件属性。');
          }
          return value;
        };
      } catch (error) { library.close(); throw error; }
    }
    const safePath = async path => {
      if (typeof path !== 'string' || /[\x00-\x1f]/.test(path)) return false;
      try {
        if (Zotero.isWin) {
          const value = path.replace(/\//g, '\\');
          if (!/^[a-z]:\\/i.test(value)) return false; // UNC/device paths require manual review.
          const parts = value.slice(3).split('\\').filter(Boolean);
          if (parts.some(part => /[<>:"|?*]/.test(part) || part === '.' || part === '..' || /[. ]$/.test(part))) return false;
          let current = value.slice(0, 3), result = attributes(current);
          if (result === null || (result & 0x400) || !(result & 0x10)) return false;
          for (let index = 0; index < parts.length; index++) {
            current += (current.endsWith('\\') ? '' : '\\') + parts[index]; result = attributes(current);
            if (result === null) return true;
            if ((result & 0x400) || (index < parts.length - 1 && !(result & 0x10))) return false;
          }
          return true;
        }
        if (!path.startsWith('/')) return false;
        const parts = path.split('/').filter(Boolean);
        if (parts.some(part => part === '.' || part === '..')) return false;
        let current = '';
        for (let index = 0; index < parts.length; index++) {
          current += '/' + parts[index];
          const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(current);
          if (file.isSymlink()) return false;
          if (!file.exists()) return true;
          if (index < parts.length - 1 && !file.isDirectory()) return false;
        }
        return true;
      } catch (_) { return false; }
    };
    const stat = async path => {
      if (!await safePath(path)) throw new Error('该路径包含链接或不能安全核对，请手动检查。');
      try { return await IOUtils.stat(path); }
      catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
    };
    return { join: (...parts) => PathUtils.join(...parts), parent: path => PathUtils.parent(path), basename: path => PathUtils.filename(path), safePath,
      inspectFile: async path => { const info = await stat(path); return info && { regular: info.type === 'regular', size: info.size, modified: info.lastModified }; },
      children: async path => { const info = await stat(path); if (!info) return []; if (info.type !== 'directory') throw new Error('待核对的位置不是普通文件夹。'); return IOUtils.getChildren(path); },
      readJSON: async path => {
        const info = await stat(path);
        if (!info || info.type !== 'regular' || info.size > 65536) throw new Error('论文身份标识无法安全读取。');
        if (!await safePath(path)) throw new Error('论文身份标识路径已改变。');
        return JSON.parse(await IOUtils.readUTF8(path));
      }, close: () => { library?.close(); } };
  }
  async uninstallInventory() {
    if (!this.files?.locations || !this.dir) throw new Error('插件尚未完成初始化，请稍后核对。');
    const io = this.uninstallIO();
    try {
      // Protect current Zotero attachment locations even when the user has
      // relinked an attachment to one of the plugin's formerly copied PDFs.
      const rows = await Zotero.DB.columnQueryAsync('SELECT itemID FROM itemAttachments'), protectedPaths = [];
      for (let from = 0; from < rows.length; from += 128) {
        for (const item of await Zotero.Items.getAsync(rows.slice(from, from + 128))) {
          if (item?.isFileAttachment()) { const path = await item.getFilePathAsync(); if (path) protectedPaths.push(path); }
        }
      }
      this.lastUninstallProtectedPaths = protectedPaths;
      const papers = Object.entries(this.files.locations).map(([key, record]) => ({ ...record, key }));
      return await PCUninstallInventory.collect({ profileRoot: this.dir, dataRoot: PathUtils.join(Zotero.DataDirectory.dir, 'paper-companion'),
        vocabularyRoot: this.vocabulary?.dir, windows: !!Zotero.isWin, protectedPaths, papers }, io);
    } finally { io.close(); }
  }
  async revealUninstallPath(path) {
    if (!this._uninstallReview?.plan?.files.some(file => file.path === path)) throw new Error('请先重新核对清单中的明确文件。');
    const io = this.uninstallIO();
    try {
      if (!await io.safePath(path) || !await IOUtils.exists(path)) throw new Error('文件路径已改变，请重新核对清单。');
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(path); file.reveal();
    } finally { io.close(); }
  }
  async readSecrets() {
    const path = PathUtils.join(this.dir, "credentials.enc");
    if (!await IOUtils.exists(path)) return { openai: {}, deepseek: "" };
    const sdr = Cc["@mozilla.org/security/sdr;1"].getService(Ci.nsISecretDecoderRing);
    return JSON.parse(sdr.decryptString(await IOUtils.readUTF8(path)));
  }
  async writeSecrets(data) {
    const sdr = Cc["@mozilla.org/security/sdr;1"].getService(Ci.nsISecretDecoderRing);
    await this.writeText(PathUtils.join(this.dir, "credentials.enc"), sdr.encryptString(JSON.stringify(data)));
  }
  async setAccount(account, token) {
    await this.queue(async () => {
      const secrets = await this.readSecrets(); secrets.openai ||= {}; secrets.openai[account.clientID] = token;
      await this.writeSecrets(secrets);
      const next = { ...this.meta, accounts: [...this.meta.accounts.filter(a => a.clientID !== account.clientID), account], active: account.clientID };
      await this.writeJSON(PathUtils.join(this.dir, "accounts.json"), next); this.meta = next;
    });
  }
  async setToken(id, token) {
    return this.queue(async () => { const secrets = await this.readSecrets(); secrets.openai ||= {}; if (token) secrets.openai[id] = token; else delete secrets.openai[id]; await this.writeSecrets(secrets); });
  }
  async saveSettings(settings, key) {
    if ('actionGuidePins' in settings) {
      const ids = ['questions','screenshot','formula','notes','highlights','vocabulary','practice'];
      if (!Array.isArray(settings.actionGuidePins) || settings.actionGuidePins.some(id => !ids.includes(id))) throw new Error('请选择有效的固定入口。');
      settings = { ...settings, actionGuidePins: [...new Set(settings.actionGuidePins)] };
      if (settings.actionGuidePins.length > 2) throw new Error('最多固定两个常用入口。');
    }
    if ('actionGuideDismissed' in settings && typeof settings.actionGuideDismissed !== 'boolean') throw new Error('请选择是否隐藏操作提示。');
    if ('theme' in settings && !PCore.themeIDs().includes(settings.theme)) throw new Error('请选择有效的外观主题。');
    if ('vocabularyContextFallback' in settings && !['manual','automatic','none'].includes(settings.vocabularyContextFallback)) throw new Error('请选择有效的本地取句失败处理方式。');
    if ('vocabularyContextMethod' in settings && !['model','ocr'].includes(settings.vocabularyContextMethod)) throw new Error('请选择模型文字或 OCR 补采。');
    if ('vocabularyManualAssist' in settings && typeof settings.vocabularyManualAssist!=='boolean')throw new Error('请选择是否允许补划失败后自动兜底。');
    if ('vocabularyGenerateOnAdd' in settings && typeof settings.vocabularyGenerateOnAdd!=='boolean')throw new Error('请选择是否在加入时补全释义。');
    if ('vocabularyReminderMinutes' in settings && (!Number.isInteger(settings.vocabularyReminderMinutes) || settings.vocabularyReminderMinutes < 5 || settings.vocabularyReminderMinutes > 525600)) throw new Error('复习间隔请输入 5–525600 分钟之间的整数。');
    if ('vocabularyReminderEnabled' in settings && typeof settings.vocabularyReminderEnabled !== 'boolean') throw new Error('请选择是否开启复习提醒。');
    if ('vocabularyReminderMinutes' in settings) settings = { ...settings, vocabularyReminderCustomized: true };
    if ('translationExcerptStyle' in settings && !['markdown','plain','quote','code'].includes(settings.translationExcerptStyle)) throw new Error('请选择有效的译文保存格式。');
    this.formula?.validateSettings(settings);
    settings = { ...settings, ...this.insights.validatePrompts(settings) };
    if (Object.prototype.hasOwnProperty.call(settings, 'autoRecord')) settings.autoRecordOptIn = true;
    await this.queue(async()=>{
      const next={...this.settings,...settings};await this.writeJSON(PathUtils.join(this.dir,'settings.json'),next);this.settings=next;
      if(key!==undefined){const secrets=await this.readSecrets();secrets.deepseek=key.trim();await this.writeSecrets(secrets);await this.usage?.invalidateBalance();}
    });
    this.emit("settings");
    // Persistence has committed. A detached selection popup must not turn that
    // success into a failed-save report or make the user retry a saved Key.
    try { this.refreshSelectionPopups(); }
    catch (error) {
      try { Zotero.logError(error); } catch (_) {}
      this.emit('settingsRefreshError', { message: '设置已保存，划词浮窗刷新失败；重新划词后生效。' });
    }
  }
  publicState() {
    return { state: this.state, inferenceVerified: this.inferenceVerified, accounts: this.meta.accounts, activeAccount: this.meta.active, models: this.models,
      selection: this.lastSelection, settings: this.settings, version: pluginVersion, notesDir: this.notesDir, chatBusy: this.chatBusy, maintenance: !!this.maintenance };
  }
  async saveAppearance(patch) {
    if(!patch||Object.keys(patch).some(k=>!['theme','appearanceMotion','edgeLight'].includes(k)))throw new Error('无效的外观设置。');
    if('theme' in patch&&!PCore.themeIDs().includes(patch.theme))throw new Error('请选择有效的外观主题。');
    if('appearanceMotion' in patch&&!['standard','reduced','off'].includes(patch.appearanceMotion))throw new Error('请选择有效的动效设置。');
    if('edgeLight' in patch&&typeof patch.edgeLight!=='boolean')throw new Error('请选择是否开启边框追光。');
    await this.queue(async()=>{const next={...this.settings,...patch};await this.writeJSON(PathUtils.join(this.dir,'settings.json'),next);this.settings=next;});
    this.emit('appearance');
  }
  async chooseAccount(clientID) {
    this.disconnect();
    await this.queue(async () => {
      if (!this.meta.accounts.some(a => a.clientID === clientID)) throw new Error("没有这个已保存账号。");
      const next = { ...this.meta, active: clientID };
      await this.writeJSON(PathUtils.join(this.dir, "accounts.json"), next); this.meta = next;
    });
    this.emit("connection");
  }
  async connect({ addAccount = false, reauthorize = false } = {}) {
    if (this.closing || this.state !== "offline") return;
    const epoch = ++this.epoch;
    this.inferenceVerified = false; this.state = "connecting"; this.connectController = new AbortController(); this.emit("connection");
    const signal = this.connectController.signal;
    try {
      let clientID = addAccount ? null : this.meta.active;
      let access;
      if (!clientID || reauthorize || !(await this.readSecrets()).openai?.[clientID]) {
        const r = await this.auth.login(clientID, signal); clientID = r.clientID; access = r.token;
      } else access = await this.auth.access(clientID, signal);
      const data = await this.json(PCore.OPENAI + "/models", { signal, headers: { Authorization: "Bearer " + access } });
      if (epoch !== this.epoch || signal.aborted) return;
      const list = data.models || data.data || [];
      this.models = list.filter(m => m.visibility === undefined || m.visibility === "list").map(m => ({ id: m.slug || m.id, name: m.display_name || m.slug || m.id, inputModalities: Array.isArray(m.input_modalities) ? m.input_modalities : [], reasoningEfforts: m.supported_reasoning_efforts || m.supported_reasoning_levels })).filter(m => m.id);
      if (!this.models.length) throw new Error("账号没有返回可用模型，请检查 ChatGPT 套餐授权。");
      if (!this.models.some(m => m.id === this.settings.model)) this.settings.model = this.models[0].id;
      await this.queue(async () => {
        if (epoch !== this.epoch || signal.aborted) return;
        const next = { ...this.meta, active: clientID };
        await this.writeJSON(PathUtils.join(this.dir, "accounts.json"), next); this.meta = next;
      });
      if (epoch !== this.epoch || signal.aborted) return;
      this.state = "online";
      this.emit("connection");
    } catch (e) {
      if (epoch === this.epoch) { this.state = "offline"; this.emit("connection"); if (!signal.aborted) throw e; }
    }
  }
  disconnect() {
    this.vocabulary?.cancel();
    this.formula?.destroy();
    this.readingSearchController?.abort(); this.readingDraftController?.abort();
    ++this.epoch; this.state = "offline"; this.connectController?.abort(); this.chatController?.abort();
    this.translationController?.abort(); this.extractController?.abort();
    for (const xhr of this.requests) { try { xhr.abort(); } catch (_) {} }
    this.emit("connection");
  }
  async logout() {
    this.disconnect();
    if (!this.meta.active) return "尚未登录。";
    const controller = new AbortController();
    return this.auth.logout(this.meta.active, controller.signal);
  }
  request(url, { method = "GET", headers = {}, body = null, signal, onChunk, empty = false, provider = "ChatGPT" } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("已取消请求。")); return; }
      const xhr = new XMLHttpRequest();
      let offset = 0, done = false;
      const abort = () => xhr.abort();
      const finish = (err, value) => { if (done) return; done = true; this.requests.delete(xhr); signal?.removeEventListener("abort", abort); if (err) reject(err); else resolve(value); };
      try {
        xhr.open(method, url, true); xhr.timeout = onChunk ? 240000 : 90000;
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) { finish(PCore.apiError(xhr.status, xhr.responseText, provider)); return; }
          try {
            if (onChunk) { if (xhr.responseText.length > offset) onChunk(xhr.responseText.slice(offset)); finish(null, null); }
            else if (empty || !xhr.responseText) finish(null, null);
            else finish(null, JSON.parse(xhr.responseText));
          } catch (e) { finish(e); }
        };
        xhr.onprogress = () => {
          if (!onChunk || xhr.status < 200 || xhr.status >= 300) return;
          try { const chunk = xhr.responseText.slice(offset); offset = xhr.responseText.length; if (chunk) onChunk(chunk); }
          catch (e) { finish(e); xhr.abort(); }
        };
        xhr.onerror = () => finish(new Error(`${provider} 网络连接失败，请检查 Zotero 的网络或代理设置。`));
        xhr.ontimeout = () => finish(new Error(`${provider} 请求超时。`));
        xhr.onabort = () => finish(new Error("已取消请求。"));
        this.requests.add(xhr); signal?.addEventListener("abort", abort, { once: true }); xhr.send(body);
      } catch (e) { finish(new Error("请求无法启动：" + PCore.safeError(e.message))); }
    });
  }
  json(url, options = {}) { return this.request(url, options); }
  infer(url, options, meta) {
    if (this.closing) return Promise.reject(new Error('插件正在关闭，请稍后重新打开。'));
    const task = this.usage.run({ ...meta, model: JSON.parse(options.body).model }, options, opts => this.request(url, opts));
    this.inferences.add(task);
    const clear = () => this.inferences.delete(task); task.then(clear, clear);
    return task;
  }
  form(url, params, signal, empty = false) {
    return this.request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString(), signal, empty });
  }
  createCallback(signal) {
    const server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
    server.init(-1, true, -1); // A dedicated ephemeral loopback port; never bound to the LAN.
    const port = server.port, redirectURI = `http://127.0.0.1:${port}/auth/callback`;
    let settled = false, resolveWait, rejectWait, transaction, timer;
    const sockets = new Set();
    const stop = () => { try { server.close(); } catch (_) {} for (const s of sockets) s(); sockets.clear(); if (timer) timer.cancel(); signal.removeEventListener("abort", cancel); };
    const cancel = () => { if (!settled) { settled = true; rejectWait?.(new Error("已取消登录。")); } stop(); };
    const listener = {
      onSocketAccepted: (_, transport) => {
        const input = transport.openInputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncInputStream);
        const output = transport.openOutputStream(Ci.nsITransport.OPEN_BLOCKING, 0, 0);
        const reader = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream); reader.init(input);
        let buffer = "";
        let closing = false, cleanupTimer;
        const close = () => {
          if (closing) return; closing = true;
          try { output.flush(); } catch (_) {}
          try { output.close(); } catch (_) {}
          // Closing the transport immediately can discard its asynchronous output buffer.
          cleanupTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
          cleanupTimer.initWithCallback(() => {
            try { reader.close(); } catch (_) {}
            try { transport.close(0); } catch (_) {}
            sockets.delete(close); cleanupTimer = null;
          }, 250, Ci.nsITimer.TYPE_ONE_SHOT);
        };
        sockets.add(close);
        const reply = (code, msg) => {
          // Static response; never reflect authorization codes or tokens.
          const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>论文伴读 · 登录授权</title><body style="font:16px/1.8 system-ui;background:#f1f5f0;color:#264b3d;margin:0;padding:12vh 8vw"><main style="max-width:520px;margin:auto;background:white;padding:32px;border-radius:18px"><h1 style="font-size:25px">论文伴读</h1><p>${msg}</p><p>请返回 Zotero 查看连接状态。本页面可以关闭。</p></main></body></html>`;
          const bytes = new TextEncoder().encode(html), raw = Array.from(bytes, b => String.fromCharCode(b)).join("");
          const data = `HTTP/1.1 ${code}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\nContent-Length: ${raw.length}\r\n\r\n${raw}`;
          const binary = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
          binary.setOutputStream(output);
          try { binary.writeByteArray(Array.from(data, c => c.charCodeAt(0))); } finally { close(); }
        };
        const ready = { onInputStreamReady: stream => {
          try {
            const count = stream.available(); if (!count) { close(); return; }
            buffer += reader.read(Math.min(count, 32768));
            if (buffer.length > 16384) { reply("431 Request Header Fields Too Large", "Request too large."); return; }
            if (!buffer.includes("\r\n\r\n")) { stream.asyncWait(ready, 0, 0, Services.tm.currentThread); return; }
            const first = /^GET (\S+) HTTP\/1\.[01]\r\n/.exec(buffer);
            const host = /\r\nhost:\s*([^\r\n]+)/i.exec(buffer)?.[1]?.trim();
            if (!first || host !== `127.0.0.1:${port}` || !first[1].startsWith("/auth/callback?") || !transaction) { reply("404 Not Found", "Not found."); return; }
            const callbackURL = `http://127.0.0.1:${port}` + first[1];
            const parsed = new URL(callbackURL);
            // Ignore unrelated or forged callbacks without consuming the pending login.
            if (parsed.searchParams.get("state") !== transaction.state) { reply("400 Bad Request", "Invalid sign-in state."); return; }
            if (settled) { reply("200 OK", "已收到本次登录授权。重新打开回调页不会重复登录。"); return; }
            try {
              const result = PCore.validateCallback(callbackURL, transaction);
              settled = true; reply("200 OK", "已收到登录授权，Zotero 正在验证账号。"); resolveWait(result);
            } catch (e) { settled = true; reply("400 Bad Request", "Authorization was not completed."); rejectWait(e); stop(); }
          } catch (_) { close(); }
        } };
        input.asyncWait(ready, 0, 0, Services.tm.currentThread);
      }, onStopListening() {}
    };
    server.asyncListen(listener);
    signal.addEventListener("abort", cancel, { once: true });
    return { redirectURI, wait: t => { transaction = t; return new Promise((resolve, reject) => {
      resolveWait = resolve; rejectWait = reject;
      timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(() => { if (!settled) { settled = true; reject(new Error("登录等待超时，请重新连接。")); } stop(); }, 300000, Ci.nsITimer.TYPE_ONE_SHOT);
      if (signal.aborted) cancel();
    }); }, close: () => { if (settled && !signal.aborted) { timer?.cancel(); timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer); timer.initWithCallback(stop, 45000, Ci.nsITimer.TYPE_ONE_SHOT); } else stop(); } };
  }
  addWindow(window) {
    if (this.windows.has(window)) return;
    const doc = window.document, nodes = [];
    const toolsMenu = doc.getElementById("menu_ToolsPopup");
    if (toolsMenu) {
      const item = doc.createXULElement("menuitem"); item.id = "paper-companion-menu"; item.setAttribute("label", "Paper Companion · 论文伴读");
      item.addEventListener("command", () => { this.followCurrentReader(); this.openPanel(); }); toolsMenu.append(item); nodes.push(item);
    }
    const keys = doc.querySelector("keyset");
    if (keys) { const key = doc.createXULElement("key"); key.setAttribute("key", "J"); key.setAttribute("modifiers", "accel,shift"); key.addEventListener("command", () => { this.followCurrentReader(); this.openPanel(); }); keys.append(key); nodes.push(key); }
    this.windows.set(window, nodes);
  }
  removeWindow(window) { for (const node of this.windows.get(window) || []) node.remove(); this.windows.delete(window); }
  followCurrentReader() {
    const win = Zotero.getMainWindow();
    const reader = win?.Zotero_Tabs ? Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID) : null;
    if (reader) this.readerID = reader.itemID;
    return reader;
  }
  allReaders() { return Zotero.Reader._readers || []; }
  reader() {
    const r = this.allReaders().find(r => r.itemID === this.readerID);
    return r || this.followCurrentReader();
  }
  async papers() {
    const seen = new Set(), list = [];
    for (const r of this.allReaders()) {
      if (seen.has(r.itemID)) continue; seen.add(r.itemID);
      const item = await Zotero.Items.getAsync(r.itemID);
      if (item?.isPDFAttachment()) list.push({ id: r.itemID, title: (item.parentItem || item).getField("title") || "未命名论文" });
    }
    return list;
  }
  async paper(id) {
    if (id) this.readerID = Number(id);
    const reader = this.reader(); if (!reader) return null;
    return this.paperInfo(reader.itemID);
  }
  async paperInfo(id) {
    const item = await Zotero.Items.getAsync(Number(id));
    if (!item?.isPDFAttachment()) throw new Error("请先在 Zotero 内置阅读器中打开 PDF。");
    const parent = item.parentItem || item;
    const prefix = item.libraryID === Zotero.Libraries.userLibraryID ? "library" : "groups/" + Zotero.Groups.getGroupIDFromLibraryID(item.libraryID);
    return { id: item.id, key: item.libraryID + "_" + item.key, itemKey: item.key, title: parent.getField("title") || "未命名论文", authors: (parent.getCreators?.() || []).map(c => [c.firstName, c.lastName].filter(Boolean).join(' ')).join(', '), date: parent.getField('date') || '', doi: parent.getField('DOI') || '', link: `zotero://open-pdf/${prefix}/items/${item.key}` };
  }
  pdf(reader) {
    const internal = reader?._internalReader;
    const secondary = internal?._lastViewPrimary === false;
    const view = (secondary ? internal?._secondaryView : internal?._primaryView) || internal?._primaryView;
    const win = view?._iframeWindow?.wrappedJSObject || view?._iframeWindow;
    const app = win?.PDFViewerApplication;
    if (!app?.pdfDocument) throw new Error("PDF 尚未加载完成，请稍等后重试。");
    return { win, app, doc: app.pdfDocument, page: app.pdfViewer?.currentPageNumber || 1 };
  }
  pdfPageInfo(readerID) {
    const reader = this.allReaders().find(r => r.itemID === Number(readerID));
    const { doc, page } = this.pdf(reader); return { current: page, total: doc.numPages };
  }
  async extract(mode, format = "both", readerID, range = null) {
    const reader = readerID ? this.allReaders().find(r => r.itemID === Number(readerID)) : this.reader();
    if (!reader) throw new Error("请先打开一篇 PDF。");
    const paper = await this.paper(reader.itemID); if (!paper) throw new Error("请先打开一篇 PDF。");
    const { win, doc, page } = this.pdf(reader);
    if (!['pdf','fulltext','page','range'].includes(mode)) throw new Error("无效的材料范围。");
    let numbers;
    if (mode === 'range') {
      const from = Number(range?.from), to = Number(range?.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > doc.numPages) throw new Error(`请输入 1–${doc.numPages} 之间的整数页码，起始页不能大于结束页。页码按 PDF 物理页计算。`);
      numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    } else numbers = mode === 'page' ? [page] : Array.from({ length: doc.numPages }, (_, i) => i + 1);
    this.extractController?.abort(); const controller = new AbortController(); this.extractController = controller;
    const context = { ...paper, id: paper.key + ":" + mode + ":" + Date.now(), mode, page, text: "", label: "", link: paper.link + "?page=" + page };
    if (mode === "pdf") {
      const item = await Zotero.Items.getAsync(paper.id), path = await item.getFilePathAsync();
      if (!path) throw new Error("PDF 文件不在本机，请先下载附件。");
      const stat = await IOUtils.stat(path);
      if (stat.size > 20 * 1024 * 1024) throw new Error("原始 PDF 超过本版 20 MB 限制，请用全文文字或当前页。");
      const bytes = await IOUtils.read(path); let raw = "";
      for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
      context.file = "data:application/pdf;base64," + btoa(raw); context.filename = "paper.pdf";
      context.label = `原始 PDF · ${doc.numPages} 页 · ${(stat.size / 1048576).toFixed(1)} MB`;
      context.text = "附件为用户当前阅读的完整 PDF。请阅读全文，引用物理页码；如果无法解析附件请明确说明。";
    } else {
      context.pageNumbers = numbers; context.page = numbers[0]; context.endPage = numbers.at(-1); context.link = paper.link + "?page=" + numbers[0];
      const pages = [], emptyPages = [], images = []; let total = 0;
      if (!['text','image','both'].includes(format)) throw new Error("请选择文字、图片或两者。");
      if (format !== 'text' && numbers.length > 30) throw new Error("一次最多读取 30 页图片；请缩小页码范围、改用文字或原始 PDF。");
      for (const n of numbers) {
        if (controller.signal.aborted) throw new Error("已取消读取。");
        const pdfPage = Cu.waiveXrays(await doc.getPage(n));
        if (format !== 'image') {
          const content = Cu.waiveXrays(await pdfPage.getTextContent());
          const text = PCore.pdfText(content.items); total += text.length;
          if (total > 200000) throw new Error("文字超过 20 万字符，请改用当前页或原始 PDF。");
          if (text.length < 20) emptyPages.push(n);
          pages.push(`--- PDF 第 ${n} 页 ---\n${text || "[未提取到文字]"}`);
        }
        if (format !== 'text') {
          const viewport0 = pdfPage.getViewport(Cu.cloneInto({ scale: 1 }, win));
          const viewport = pdfPage.getViewport(Cu.cloneInto({ scale: Math.min(2, 1600 / Math.max(viewport0.width, viewport0.height)) }, win));
          const canvas = win.document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const options = Cu.cloneInto({ background: "rgb(255,255,255)" }, win);
          options.canvasContext = canvas.getContext("2d"); options.viewport = viewport;
          const render = pdfPage.render(options), cancel = () => render.cancel();
          controller.signal.addEventListener("abort", cancel, { once: true });
          try { await render.promise; images.push(canvas.toDataURL("image/png")); }
          finally { controller.signal.removeEventListener("abort", cancel); canvas.width = canvas.height = 0; }
          if (images.reduce((n, i) => n + i.length, 0) > 32 * 1048576) throw new Error("页面图片总量过大，请缩小页数或改传文字。");
        }
        this.emit("extraction", { current: numbers.indexOf(n) + 1, total: numbers.length });
      }
      const fmt = { text: "文字", image: "图片", both: "文字＋图片" }[format];
      const scope = mode === 'page' ? `第 ${page} 页` : mode === 'range' ? (numbers.length === 1 ? `第 ${numbers[0]} 页` : `第 ${numbers[0]}–${numbers.at(-1)} 页`) : `全文 ${doc.numPages} 页`;
      context.text = pages.join("\n\n") || `PDF ${scope}，内容见图片；图片按页码顺序排列。`;
      context.label = scope + " · " + fmt;
      context.format = format;
      if (images.length) { context.images = images; if (images.length === 1) context.image = images[0]; }
      if (emptyPages.length) context.warning = `第 ${emptyPages.join("、")} 页文字较少，可选图片或原始 PDF。`;
    }
    if (controller.signal.aborted) throw new Error("已取消读取。");
    return context;
  }
  refreshSelectionPopups() {
    this.vocabularyContextRefresh?.();
    for (const popup of this.selectionPopups) {
      if (!popup.box.isConnected) { popup.timer?.cancel();popup.appearance?.destroy(); this.selectionPopups.delete(popup); }
      else popup.update();
    }
  }
  clearVocabularyContext() { this.vocabularyContextAppearance?.destroy();this.vocabularyContextAppearance=null;this.vocabularyContextToast?.remove();this.vocabularyContextToast=null;this.vocabularyContextRefresh=null; }
  requestVocabularyContext(pending,message='') {
    this.clearVocabularyContext();
    try {
      const reader=this.allReaders().find(r=>r.itemID===pending.readerID);if(!reader)return;
      const pdfWin=this.pdf(reader).win,doc=Cu.unwaiveXrays(pdfWin.document),box=doc.createElement('div'),dark=pdfWin.matchMedia('(prefers-color-scheme:dark)').matches;
      const colors=PCore.surfacePalette(this.settings.theme);box.className='pc-context-toast';
      PCTheme.installStyle(doc, this);
      box.id='paper-companion-context-toast';box.setAttribute('role','status');
      box.style.cssText=`position:fixed;right:16px;bottom:20px;z-index:2147483000;width:310px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:14px 16px;border:1px solid ${colors.rule};border-top:2px solid #899d85;border-radius:8px;background:${colors.paper};color:${colors.ink};box-shadow:0 6px 28px #15261b24;font:12px/1.6 system-ui,sans-serif;pointer-events:none;`;
      const title=doc.createElement('strong');title.textContent='补充「'+pending.word+'」的原句';title.style.cssText='font-size:13px;font-weight:600;';
      const hint=doc.createElement('p');hint.style.cssText=`margin:5px 0 11px;overflow-wrap:anywhere;font-size:11px;color:${colors.muted};`;hint.textContent=message||'本地未取到完整原句。直接补划短句，松手即录入；也可自动补采。';
      const actions=doc.createElement('div');actions.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:7px;pointer-events:none';
      const footer=doc.createElement('div');footer.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;pointer-events:none';
      const button=(label,fn,parent=actions)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.style.cssText=`pointer-events:auto;appearance:none;padding:5px 8px;min-height:32px;border:1px solid ${colors.rule};border-radius:5px;background:${colors.button};color:${colors.ink};font:11px system-ui;cursor:pointer;`;b.addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>{hint.textContent=PCore.safeError(e.message);}));parent.append(b);return b;};
      button('手动补划',()=>{this.vocabulary.stopContext(pending.id);hint.textContent='请直接划出包含「'+pending.word+'」一次的短句，松手即保存；此提醒不会抢焦点。';});
      const method=doc.createElement('select');method.setAttribute('aria-label','自动补采方式');method.style.cssText=`pointer-events:auto;min-width:0;max-width:100%;min-height:28px;padding:3px;border:0;border-bottom:1px solid ${colors.rule};border-radius:0;background:${colors.paper};color:${colors.muted};font:10px system-ui;`;
      const modelRow=doc.createElement('div');modelRow.style.cssText='margin-top:7px;pointer-events:none';
      const modelChoice=button('',()=>this.openPanel({readerID:pending.readerID,action:'model-settings',feature:method.value==='ocr'?'formula':'translation'}),modelRow);modelChoice.dataset.action='context-model-config';modelChoice.style.cssText+=`;width:100%;height:auto;white-space:normal;text-align:left;font-size:11.5px;background:transparent;border:0;padding:2px 0;color:${colors.muted}`;
      const modelLabel=()=>{modelChoice.textContent=PCore.featureModel(this.settings,method.value==='ocr'?'vocabulary-ocr':'vocabulary-context').label+' · 设置';};
      for(const [value,label]of [['ocr','OCR · 消耗用量'],['model','模型文字 · 消耗用量']]){const o=doc.createElement('option');o.value=value;o.textContent=label;method.append(o);}method.value=pending.method||this.settings.vocabularyContextMethod;method.addEventListener('change',()=>{pending.method=method.value;modelLabel();});footer.append(method);modelLabel();
      const auto=button('自动补采',async()=>{auto.disabled=true;hint.textContent='正在自动补采，可继续划句；先完成的人工补划会保留。';try{const ok=await this.vocabulary.autoContext(pending.id,{...this.settings,vocabularyContextMethod:method.value});if(ok&&this.vocabularyContextToast===box)this.clearVocabularyContext();}finally{auto.disabled=false;}});auto.dataset.action='context-auto';auto.title='使用所选模型或 OCR 自动读取附近材料，会消耗用量';
      const later=button('暂不补充',()=>{this.vocabulary.stopContext(pending.id);this.vocabulary.cancelManual();},footer);later.style.background='transparent';later.style.border='0';later.style.padding='0';later.style.fontSize='10px';later.style.color=colors.muted;
      box.append(title,hint,actions,footer,modelRow);doc.documentElement.append(box);this.vocabularyContextToast=box;this.vocabularyContextRefresh=modelLabel;this.vocabularyContextAppearance=new PCTheme({api:this,root:box,scope:box});
    }catch(_){this.emit('vocabulary');}
  }
  selectionPopup({ reader, doc, params, append }) {
    if (this.maintenance) return;
    const text = params.annotation?.text?.trim(); if (!text) return;
    // The real reader customEvent passes a waived document. Re-wrap DOM calls
    // so ShadowRootInit and other dictionaries are read in the caller realm.
    doc = Cu.unwaiveXrays(doc);
    this.refreshSelectionPopups();
    const action = { text, page: (params.annotation?.position?.pageIndex ?? 0) + 1, readerID: reader.itemID, id: Services.uuid.generateUUID().toString(), rects: Array.from(params.annotation?.position?.rects || [], r => Array.from(r)) };
    action.contextHint=this.vocabulary.renderedContext(reader,action);
    this.lastSelection = action; this.readerSelections.set(reader.itemID, action); this.emit("selection", { selection: action });
    const box = doc.createElement("div"); box.className = "paper-companion-selection";
    box.style.cssText = "box-sizing:border-box;display:block;width:100%;max-width:100%;min-width:0;";
    const shadow = box.attachShadow({ mode: "open" }), css = doc.createElement("style");
    css.textContent = `:host{display:block;min-width:0}*{box-sizing:border-box}[hidden]{display:none!important}.pc-body{padding:6px 0;font:12px/1.6 system-ui,sans-serif;color:CanvasText;color-scheme:light dark;min-width:0}.pc-row,.pc-excerpt-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;min-width:0}.pc-excerpt-row{margin-top:6px}button,select{display:block;position:static;float:none;min-width:0;max-width:100%;width:100%;height:30px;margin:0;padding:4px;font:12px/1.5 system-ui,sans-serif;border:1px solid #8aaba0;border-radius:6px;background:Field;color:FieldText;text-align:center}button{cursor:pointer;white-space:nowrap}select{appearance:auto;text-align:start}button:hover{background:ButtonFace}button:focus-visible,select:focus-visible{outline:2px solid #5f987f;outline-offset:1px}.pc-popup-toggle{display:flex;align-items:center;gap:5px;font-size:11px;margin-top:7px}.pc-popup-toggle input{margin:0}.pc-selection-result,.pc-selection-feedback{max-height:190px;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;margin-top:7px;user-select:text;font-size:12px}.pc-selection-result{border-top:1px solid #8aaba055;padding-top:6px}.pc-selection-result:empty,.pc-selection-feedback:empty{display:none}`;
    const body = doc.createElement("div"); body.className = "pc-body";
    css.textContent += `.pc-body{max-height:min(480px,70vh);overflow-y:auto;overscroll-behavior:contain;padding:6px 2px 8px;scrollbar-width:thin}button,select{border-color:#c6d2e4}button:hover:not(:disabled){background:#edf2fb;color:#284ca9}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #365fc6;outline-offset:1px}.pc-note-actions{margin-top:8px;padding-top:7px;border-top:1px solid #c6d2e455}.pc-note-editor{margin-top:8px;padding:8px 0 0;border-top:1px solid #c6d2e455}.pc-note-editor label{display:block;font-size:12px}.pc-note-editor textarea{display:block;box-sizing:border-box;width:100%;min-width:0;min-height:76px;max-height:180px;resize:vertical;padding:6px;margin:5px 0 7px;border:1px solid #c6d2e4;border-radius:6px;background:Field;color:FieldText;font:12px/1.65 system-ui,sans-serif}.pc-draft-hint{margin:5px 0 0;font-size:10px;opacity:.8}@media(prefers-color-scheme:dark){button,select,.pc-note-editor textarea{border-color:#50617c}button:hover:not(:disabled){background:#293a54;color:#d7e3ff}}`;
    css.textContent += `.pc-write-thought{margin-top:8px;background:transparent;border-style:dashed;font-size:11px}.pc-note-actions>.pc-excerpt-row{margin-top:0}`;
    const light=PCore.surfacePalette(),dark=PCore.surfacePalette(true);
    css.textContent+=`:host{--paper:${light.paper};--ink:${light.ink};--rule:${light.rule};--muted:${light.muted};--accent:${light.accent};--soft:${light.button}}.pc-body{background:var(--paper);color:var(--ink);font-family:"Segoe UI","Microsoft YaHei",sans-serif}button,select,.pc-note-editor textarea{border-color:var(--rule);background:var(--paper);color:var(--ink)}button:hover:not(:disabled){background:var(--soft);color:var(--accent)}button:focus-visible,select:focus-visible,textarea:focus-visible{outline-color:var(--accent)}.pc-note-actions,.pc-note-editor,.pc-selection-result{border-color:var(--rule)}.pc-model-link{height:auto;min-height:28px;border:0;background:transparent;padding:5px 2px;text-align:left;white-space:normal;font-size:11.5px;color:var(--muted)}.pc-draft-hint{font-size:11.5px;color:var(--muted)}@media(prefers-color-scheme:dark){:host{--paper:${dark.paper};--ink:${dark.ink};--rule:${dark.rule};--muted:${dark.muted};--accent:${dark.accent};--soft:${dark.button}}}`;
    const row = doc.createElement("div"); row.className = "pc-row";
    const excerpts = doc.createElement("div"); excerpts.className = "pc-excerpt-row";
    const result = doc.createElement("div"); result.className = "pc-selection-result"; result.setAttribute('role','status');
    const feedback = doc.createElement("div"); feedback.className = "pc-selection-feedback"; feedback.setAttribute('role','status');
    const button = (label, fn, parent = row, actionName = "") => { const b = doc.createElement("button"); b.textContent = label; b.type = "button"; b.dataset.action = actionName; b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); Promise.resolve().then(fn).catch(e => { feedback.textContent = PCore.safeError(e.message); }); }); parent.append(b); return b; };
    let busy = false, writing = false, completedTranslation = '';
    const updateNoteActions = () => { originalNote.disabled = writing; translatedNote.disabled = writing || !completedTranslation; saveDraft.disabled = writing || !noteInput.value.trim(); cancelDraft.disabled = writing; };
    const current = () => this.readerSelections.get(action.readerID)?.id === action.id;
    const publish = (value, status, error = '') => {
      if (!current()) return;
      const record = { selection: action, text: value, status, error };
      this.translations.set(action.readerID, record); this.emit('translation', record);
    };
    const translate = async () => {
      if (busy) return; busy = true; completedTranslation = ''; updateNoteActions(); translationButton.disabled = true; feedback.textContent = ''; result.textContent = '正在翻译…'; publish('', 'pending');
      try {
        const value = await this.translate(text, value => { if (box.isConnected) result.textContent = value; publish(value, 'streaming'); }, (await this.paperInfo(action.readerID)).key);
        if (box.isConnected) { result.textContent = value; if (!this.settings.popupTranslation) feedback.textContent = '译文已同步到翻译页。'; }
        publish(value, 'complete');
        completedTranslation = value;
      } catch (e) { const error = PCore.safeError(e.message); result.textContent = '翻译未完成：' + error; feedback.textContent = error; publish('', 'error', error); }
      finally { busy = false; translationButton.disabled = false; updateNoteActions(); }
    };
    const translationButton = button('翻译', translate, row, 'translate');
    button('引入问答 ↗', async () => { feedback.textContent = '正在引入…'; await this.openPanel({ ...action, action: 'ask' }); feedback.textContent = '已处理选文，请查看当前对话输入框。'; }, row, 'ask');
    const style = doc.createElement('select'); style.setAttribute('aria-label', '原文保存格式'); style.dataset.action = 'original-note-style';
    for (const [value,label] of [['plain','普通文字'],['code','代码块'],['quote','引用']]) { const o = doc.createElement('option'); o.value = value; o.textContent = label; style.append(o); }
    excerpts.append(style); style.addEventListener('pointerdown', e => e.stopPropagation());
    style.addEventListener('change', () => this.saveSettings({ excerptStyle: style.value }).catch(e => { feedback.textContent = PCore.safeError(e.message); }));
    const savePopupNote = async markdown => {
      if (writing) return false;
      writing = true; updateNoteActions(); feedback.textContent = '正在保存到本篇笔记…';
      try { await this.appendPaperNote(action.readerID, markdown); feedback.textContent = '已自动保存到这篇论文的 Markdown 笔记。'; return true; }
      finally { writing = false; updateNoteActions(); }
    };
    const originalNote = button('保存原文', () => savePopupNote(PCore.excerpt(action.text, null, style.value)), excerpts, 'note'); originalNote.title = '按左侧格式将所选原文存入本篇笔记';
    const noteActions = doc.createElement('div'); noteActions.className = 'pc-note-actions';
    const translationRow = doc.createElement('div'); translationRow.className = 'pc-excerpt-row';
    const translationStyle = doc.createElement('select'); translationStyle.dataset.action = 'translation-note-style'; translationStyle.setAttribute('aria-label','译文保存格式');
    for (const [value,label] of [['markdown','保留排版'],['plain','普通文字'],['quote','引用'],['code','代码块']]) { const o=doc.createElement('option'); o.value=value; o.textContent=label; translationStyle.append(o); }
    translationStyle.addEventListener('pointerdown', e => e.stopPropagation());
    translationStyle.addEventListener('change', () => this.saveSettings({ translationExcerptStyle: translationStyle.value }).catch(e => { feedback.textContent=PCore.safeError(e.message); }));
    translationRow.append(translationStyle); noteActions.append(translationRow);
    const translatedNote = button('保存译文', () => { if (!completedTranslation) throw new Error('请先完成翻译。'); return savePopupNote(PCore.excerpt(completedTranslation, null, translationStyle.value)); }, translationRow, 'translation-note');
    translatedNote.title = '按左侧格式将已完成的译文存入本篇笔记';
    const editor = doc.createElement('div'); editor.className = 'pc-note-editor'; editor.hidden = true;
    const noteLabel = doc.createElement('label'); noteLabel.textContent = '写下自己的理解与想法';
    const noteInput = doc.createElement('textarea'); noteInput.rows = 3; noteInput.maxLength = 30000; noteInput.placeholder = '直接写笔记，支持 Markdown 和公式…'; noteInput.setAttribute('aria-label','本篇笔记草稿'); noteInput.dataset.action = 'note-draft';
    noteInput.value = this.popupNoteDrafts.get(action.readerID) || ''; noteLabel.append(noteInput);
    const writeNote = button('写想法', () => { editor.hidden = !editor.hidden; writeNote.setAttribute('aria-expanded',String(!editor.hidden)); if (!editor.hidden) noteInput.focus(); }, noteActions, 'write-note'); writeNote.className = 'pc-write-thought'; writeNote.title = '展开输入框，记录自己的理解；不自动复制译文'; writeNote.setAttribute('aria-expanded','false');
    editor.id = 'pc-note-editor-' + action.id.replace(/[^a-zA-Z0-9-]/g,''); writeNote.setAttribute('aria-controls',editor.id);
    const draftActions = doc.createElement('div'); draftActions.className = 'pc-row';
    const saveDraft = button('保存想法', async () => {
      const value = noteInput.value; if (!value.trim()) throw new Error('请先输入笔记。');
      if (!await savePopupNote('\n\n' + value + '\n\n')) return;
      if (this.popupNoteDrafts.get(action.readerID) === value) this.popupNoteDrafts.delete(action.readerID);
      if (noteInput.value === value) { noteInput.value = ''; editor.hidden = true; writeNote.setAttribute('aria-expanded','false'); writeNote.focus(); }
      else feedback.textContent = '已保存；新输入的草稿尚未保存。';
      updateNoteActions();
    }, draftActions, 'save-note-draft');
    const cancelDraft = button('取消', () => { noteInput.value = ''; this.popupNoteDrafts.delete(action.readerID); editor.hidden = true; writeNote.setAttribute('aria-expanded','false'); updateNoteActions(); writeNote.focus(); }, draftActions, 'cancel-note-draft');
    noteInput.addEventListener('input', () => { this.popupNoteDrafts.set(action.readerID,noteInput.value); updateNoteActions(); });
    noteInput.addEventListener('paste', e => {
      const text = e.clipboardData?.getData('text/plain'); if (!text) return;
      const value = PCMath.preparePaste(text,text.trim() === this.lastFormulaCopy); if (value === text) return;
      e.preventDefault(); noteInput.setRangeText(value,noteInput.selectionStart,noteInput.selectionEnd,'end');
      this.popupNoteDrafts.set(action.readerID,noteInput.value); updateNoteActions();
    });
    for (const type of ['pointerdown','mousedown','mouseup','click','keydown','paste']) editor.addEventListener(type, e => e.stopPropagation());
    noteInput.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!saveDraft.disabled) saveDraft.click(); }
      if (e.key === 'Escape') { e.preventDefault(); editor.hidden = true; writeNote.setAttribute('aria-expanded','false'); writeNote.focus(); }
    });
    const draftHint = doc.createElement('p'); draftHint.className = 'pc-draft-hint'; draftHint.textContent = '点击保存写入本篇笔记 · Ctrl+Enter 保存';
    editor.append(noteLabel,draftActions,draftHint);
    if (noteInput.value) { editor.hidden = false; writeNote.setAttribute('aria-expanded','true'); }
    const toggleLabel = doc.createElement('label'); toggleLabel.className = 'pc-popup-toggle';
    const toggle = doc.createElement('input'); toggle.type = 'checkbox'; toggle.dataset.action = 'popup-translation'; toggle.setAttribute('aria-label','浮窗显示译文');
    toggle.addEventListener('change', () => this.saveSettings({ popupTranslation: toggle.checked }).catch(e => { feedback.textContent = PCore.safeError(e.message); }));
    toggleLabel.append(toggle, doc.createTextNode('浮窗显示译文'));
    const vocabularyRow = doc.createElement('div'); vocabularyRow.className = 'pc-excerpt-row';
    const pendingContext=this.vocabulary.pendingContext;
    if(pendingContext?.readerID===reader.itemID && pendingContext.page===action.page && text.toLowerCase()!==pendingContext.word.toLowerCase())this.vocabulary.acceptSelection(action).then(saved=>{if(saved)feedback.textContent='已作为「'+pendingContext.word+'」的原句自动录入，没有增加次数。';}).catch(e=>{feedback.textContent=PCore.safeError(e.message);});
    let addingWord = false;
    const addWord = button('加入单词本', async () => {
      if (addingWord) return; addingWord = true; addWord.disabled = true; feedback.textContent = this.settings.vocabularyGenerateOnAdd?'正在保存并补全释义…':'正在收藏（不调用模型）…';
      try {
        const saved = await this.vocabulary.add(action);
        if(saved.removed){feedback.textContent='本次加入已撤销，可在单词本的已移除记录中恢复。';return;}
        addWord.textContent = '再次记录 +1';
        feedback.textContent = `已记录「${saved.word}」· 遇到 ${saved.count} 次。` + (!this.settings.vocabularyGenerateOnAdd?'仅收藏，未调用模型。':saved.cached?'复用了已存释义。':saved.error?'原句或释义待补充，请打开单词本。':'释义已保存。');
      } finally { addingWord = false; addWord.disabled = false; }
    }, vocabularyRow, 'vocabulary-add');
    addWord.title = '仅点击时累计次数；使用翻译设置中的模型补全释义，会消耗用量';
    addWord.disabled = !PCVocabulary.valid(text);
    if (addWord.disabled) addWord.title = '请划选单词或短语，再加入个人单词本';
    button('打开单词本', () => this.openVocabulary(), vocabularyRow, 'vocabulary-open');
    const modelRow=doc.createElement('div'),modelLink=button('',()=>this.openPanel({readerID:action.readerID,action:'model-settings',feature:'translation'}),modelRow,'translation-model-config');modelLink.className='pc-model-link';
    const ocrLink=button('',()=>this.openPanel({readerID:action.readerID,action:'model-settings',feature:'formula'}),modelRow,'ocr-model-config');ocrLink.className='pc-model-link';
    const themeStyle=doc.createElement('link');themeStyle.rel='stylesheet';themeStyle.href=this.resourceURL('appearance.css');
    const preferences=doc.createElement('details'),preferencesTitle=doc.createElement('summary');preferences.className='pc-popup-preferences';preferencesTitle.textContent='摘录格式与模型';preferences.append(preferencesTitle);
    excerpts.replaceChildren();for(const [caption,select]of [['原文格式',style],['译文格式',translationStyle]]){const label=doc.createElement('label');label.textContent=caption;label.append(select);excerpts.append(label);}
    translationRow.prepend(originalNote);preferences.append(excerpts,toggleLabel,modelRow);PCUI.disclosures(preferences);PCUI.label(writeNote,'写想法','chevron',{disclosure:true});
    const ask=row.querySelector('[data-action=ask]');PCUI.label(ask,'引入问答','popout');(PCVocabulary.valid(text)?addWord:translationButton).classList.add('pc-popup-primary');
    body.append(row,result,noteActions,editor,vocabularyRow,preferences,feedback);shadow.append(css,themeStyle,body);append(box);updateNoteActions();
    const appearance=new PCTheme({api:this,root:box,scope:shadow});
    const record = { box, appearance, timer: null, update: () => {
      result.hidden = !this.settings.popupTranslation; toggle.checked = !!this.settings.popupTranslation;
      translationButton.hidden = this.settings.selectionTranslation === 'off'; style.value = this.settings.excerptStyle;
      translationStyle.value = this.settings.translationExcerptStyle;
      modelLink.textContent='翻译 / 词义：'+PCore.featureModel(this.settings,'translation').label+' · 设置';
      ocrLink.hidden=!PCVocabulary.valid(text)||!this.settings.vocabularyGenerateOnAdd||this.settings.vocabularyContextFallback!=='automatic'||this.settings.vocabularyContextMethod!=='ocr';ocrLink.textContent='自动补句：'+PCore.featureModel(this.settings,'vocabulary-ocr').label+' · 设置';
      if (this.settings.popupTranslation && feedback.textContent === '译文已同步到翻译页。') feedback.textContent = '';
    } };
    this.selectionPopups.add(record); record.update();
    if (this.settings.selectionTranslation === 'auto') {
      record.timer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
      record.timer.initWithCallback(() => { record.timer = null; if (box.isConnected && current() && this.settings.selectionTranslation === 'auto') translate(); }, 450, Ci.nsITimer.TYPE_ONE_SHOT);
    }
  }
  async appendExcerpt(action, style = this.settings.excerptStyle) {
    return this.appendPaperNote(action.readerID, PCore.excerpt(action.text, null, style));
  }
  async appendPaperNote(readerID, markdown) {
    const paper = await this.paperInfo(readerID);
    if (this.files.changing.has(paper.key)) throw new Error('请等待资料文件夹更改完成。');
    const saved = await this.note(paper);
    const text = (this.noteWrites.get(paper.key)?.text ?? saved) + markdown;
    this.saveNote(paper.key, text); await this.flushNote(paper.key);
    const stored = await this.note(paper);
    const latest = this.noteWrites.get(paper.key)?.text ?? stored;
    this.emit("noteUpdated", { key: paper.key, text: latest }); return latest;
  }
  resourceURL(path) {
    if (!/^[a-z0-9][a-z0-9_./-]*$/i.test(path) || path.split('/').includes('..')) throw new Error('无效的插件资源路径。');
    return (typeof uiRootURI === 'string' ? uiRootURI : 'chrome://paper-companion/content/') + path;
  }
  registerPanel(win, embedded = false) { this.panels.add(win); this.panel = win; win.pcEmbedded = embedded; }
  async activatePanel(win, action) {
    if (typeof win.paperCompanionActivate !== "function") throw new Error("对话面板仍在加载，请稍后重试。");
    return win.paperCompanionActivate(action);
  }
  async openPanel(action = null) {
    if (action?.readerID) this.readerID = action.readerID;
    if (await this.sidebar.open(action)) return;
    const existing = [...this.panels].find(w => !w.closed && !w.pcEmbedded);
    if (existing) { existing.focus(); this.panel = existing; await this.activatePanel(existing, action); return; }
    const win = Zotero.getMainWindow(); if (!win) return;
    this.panel = win.openDialog(this.resourceURL('panel.xhtml'), "paper-companion", "chrome,dialog=no,resizable,centerscreen,width=510,height=800", { api: this, action });
  }
  panelClosed(win) {
    this.web.close(win); this.panels.delete(win); if (this.panel === win) this.panel = [...this.panels].find(w => !w.closed) || null;
    if (!this.panels.size) this.disconnect(); this.flushNotes().catch(e => Zotero.logError(e));
  }
  webChat(prompt, context) {
    this.copy((context ? `论文：${context.title}\n${context.label}\n\n${context.text}\n\n` : "") + prompt);
    this.openURL("https://chatgpt.com/");
    return !!(context?.image || context?.images?.length || context?.file);
  }
  async exportMaterials(context) {
    if (!context) throw new Error("请先附加材料。");
    let FilePicker; try { ({ FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs")); } catch (_) { ({ FilePicker } = ChromeUtils.import("chrome://zotero/content/modules/filePicker.jsm")); }
    const fp = new FilePicker(); fp.init(Zotero.getMainWindow(), "选择导出材料的文件夹", fp.modeGetFolder);
    if (await fp.show() !== fp.returnOK) return false;
    const dir = fp.file.path || fp.file, prefix = "paper-" + Date.now();
    const write = async (name, url) => { const raw = atob(url.slice(url.indexOf(",") + 1)); await IOUtils.write(PathUtils.join(dir, name), Uint8Array.from(raw, c => c.charCodeAt(0)), { mode: "create", permissions: 0o600 }); };
    if (context.file) await write(prefix + ".pdf", context.file);
    const images = context.images || (context.image ? [context.image] : []);
    for (let i = 0; i < images.length; i++) await write(prefix + "-page-" + (context.pageNumbers?.[i] ?? (context.mode === "page" ? context.page : i + 1)) + ".png", images[i]);
    if (context.text) await this.writeText(PathUtils.join(dir, prefix + ".txt"), context.text);
    return true;
  }
  session(key) { return this.sessionStore.load(key); }
  saveSession(key) { return this.sessionStore.save(key); }
  async clearContext(key) {
    const session = await this.session(key);
    delete session.lastContextID;
    await this.saveSession(key);
  }
  newSession(key) { return this.sessionStore.reset(key); }
  chatArchives(key) { return this.sessionStore.archives(key); }
  archivedSession(key, id) { return this.sessionStore.archived(key, id); }
  summaryMessages(key) { return this.sessionStore.summary(key); }
  restoreSession(key, id) { return this.sessionStore.restore(key, id); }
  get gateway() {
    if (!this._gateway) this._gateway = new PCModelGateway({
      connection: () => ({ state: this.state, active: this.meta.active, epoch: this.epoch, models: this.models, closing: this.closing }),
      readDeepseekKey: async () => (await this.readSecrets()).deepseek,
      accessToken: (account, signal) => this.auth.access(account, signal),
      request: (url, options, meta) => this.infer(url, options, meta)
    });
    return this._gateway;
  }
  getChatService() {
    if (!this.chatService) this.chatService = new PCChatService({
      runtime: () => ({ closing: this.closing, changing: this.sessionRestoring || this.sessionChanging,
        settings: this.settings, online: this.state === 'online', models: this.models, prereading: !!this.preread?.jobs.size }),
      snapshotModel: config => this.gateway.snapshot(config), openModel: (selection, signal) => this.gateway.open(selection, signal),
      session: key => this.session(key), save: key => this.saveSession(key),
      prepare: async (key, query, options) => this.reading.prepare((await this.paperFromKey(key)).id, query, options),
      cite: (text, references) => PCReadingIndex.cite(text, references), verified: () => { this.inferenceVerified = true; },
      record: async (key, prompt, answer) => {
        const paper = await this.paperFromKey(key), note = await this.note(paper) + `\n\n### 问答记录\n\n**问：** ${prompt}\n\n${answer}\n`;
        this.saveNote(key, note); this.emit('noteUpdated', { key, text: note });
      },
      organize: (key, turn) => { if (this.insights.enabled(key)) this.insights.enqueue(key, turn).catch(() => {}); },
      emit: (type, data) => this.emit(type, data)
    });
    return this.chatService;
  }
  get chatBusy() { return this.chatService?.busy || false; }
  set chatBusy(value) { this.getChatService().busy = !!value; } // Compatibility bridge for existing integrations.
  get chatController() { return this.chatService?.controller; }
  get chatCompletion() { return this.chatService?.completion; }
  async ask(key, prompt, context, onDelta, readingOptions = {}) {
    return this.getChatService().ask(key, prompt, context, onDelta, readingOptions);
  }
  stop() { this.preread.destroy(); this.chatService?.stop(); this.translationController?.abort(); this.extractController?.abort(); this.readingSearchController?.abort(); this.readingDraftController?.abort(); }
  async previewReading(id, query, ids = []) {
    if (this.chatBusy) throw new Error('请等待当前回答完成后再预览。');
    this.readingSearchController?.abort(); const controller = new AbortController(); this.readingSearchController = controller;
    try { return await this.reading.prepare(id, query, { ids, signal: controller.signal }); }
    finally { if (this.readingSearchController === controller) this.readingSearchController = null; }
  }
  async searchPapers(ids, query, rebuild = false) {
    if (this.chatBusy) throw new Error('请等待当前回答完成后再检索或重建索引。');
    if (ids.length > 5) throw new Error('一次最多选择 5 篇论文。');
    this.readingSearchController?.abort(); const controller = new AbortController(); this.readingSearchController = controller;
    try { if (rebuild) await this.reading.load(ids[0], controller.signal, true); return await this.reading.search(ids, query, controller.signal); }
    finally { if (this.readingSearchController === controller) this.readingSearchController = null; }
  }
  async openReference(reference) {
    if(!Number.isInteger(reference?.page)||reference.page<1||typeof reference.key!=='string')throw new Error('无效的原文位置。');
    let id=reference.paperID,paper=Number.isInteger(id)?await this.paperInfo(id).catch(()=>null):null;
    if(paper?.key!==reference.key){const match=/^(\d+)_([A-Z0-9]{8})$/.exec(reference.key);id=match?await Zotero.DB.valueQueryAsync('SELECT itemID FROM items WHERE libraryID=? AND key=?',[Number(match[1]),match[2]]):null;if(!id)throw new Error('当前 Zotero 中没有这篇来源论文，请先同步或导入对应 PDF。');paper=await this.paperInfo(id);}
    if (reference.key !== paper.key) throw new Error('原文文献标识不匹配。');
    const reader = await Zotero.Reader.open(id, { pageIndex: reference.page - 1 });
    await reader.navigate({ pageIndex: reference.page - 1 });
  }
  async translate(text, onDelta, paperKey = '') {
    if (!text.trim()) throw new Error("请先选中需要翻译的文字。");
    if (text.length > 16000) throw new Error("单次翻译最多 16000 字符，请分段选择。");
    this.translationController?.abort(); const controller = new AbortController(); this.translationController = controller;
    this.emit('translationBusy', {busy:true});
    const s = this.settings, provider = s.translationProvider;
    try { return await this.gateway.generate({ provider, model: provider === 'deepseek' ? s.deepseekModel : s.translationChatGPTModel, effort: provider === 'deepseek' ? s.translationEffort : s.translationChatGPTEffort,
      instructions: PCore.translationBody('', '', s.language).messages[0].content, text, signal: controller.signal, onDelta, maxTokens: 4096, usageFeature: 'translation', usageKey: paperKey });
    } finally { if (this.translationController === controller) { this.translationController = null; this.emit('translationBusy', {busy:false}); } }
  }
  async paperFromKey(key) { const item = await Zotero.Items.getByLibraryAndKeyAsync(Number(key.split("_")[0]), key.split("_")[1]); if (!item) throw new Error("找不到论文附件。"); return this.paperInfo(item.id); }
  async pdfSource(paper) {
    const item = await Zotero.Items.getAsync(paper.id), path = await item.getFilePathAsync();
    if (!path || !await IOUtils.exists(path)) throw new Error('找不到本地 PDF，请先在 Zotero 下载或定位附件，再选择资料文件夹。');
    return path;
  }
  async note(paper) {
    if (this.noteWrites.has(paper.key)) return this.noteWrites.get(paper.key).text;
    const path = (await this.files.ensure(paper)).note;
    const text = await IOUtils.exists(path) ? await IOUtils.readUTF8(path) : PCPaperFiles.initialNote(paper);
    this.noteBaselines.set(paper.key, text); return text;
  }
  saveNote(key, text) {
    const previous = this.noteWrites.get(key); previous?.timer?.cancel();
    const record = { text, timer: Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer) };
    this.noteWrites.set(key, record);
    record.timer.initWithCallback(() => this.flushNote(key).catch(e => this.emit("error", { message: "笔记保存失败：" + PCore.safeError(e.message) })), 500, Ci.nsITimer.TYPE_ONE_SHOT);
  }
  async flushNote(key, allowFolderChange = false) {
    const record = this.noteWrites.get(key); if (!record) return;
    record.timer.cancel();
    if (record.flushing) return record.flushing;
    record.flushing = (async () => {
      if (!allowFolderChange && this.folderChanges.has(key)) await this.folderChanges.get(key);
      const ensure = this.maintenance === 'draining' ? this.maintenanceMethods.get(this.files)?.get('ensure') || this.files.ensure : this.files.ensure;
      const paths = await ensure.call(this.files, await this.paperFromKey(key));
      await this.queue(async () => {
        let externalBackup;
        if (this.noteBaselines.has(key) && await IOUtils.exists(paths.note)) {
          const disk = await IOUtils.readUTF8(paths.note);
          if (disk !== this.noteBaselines.get(key) && disk !== record.text) {
            await IOUtils.makeDirectory(paths.backups, { ignoreExisting: true, createAncestors: true, permissions: 0o700 });
            externalBackup = PathUtils.join(paths.backups, '阅读笔记-外部修改-' + Date.now() + '-' + Services.uuid.generateUUID().toString().slice(1, 9) + '.md');
            await this.writeText(externalBackup, disk);
          }
        }
        await this.writeText(paths.note, record.text); this.noteBaselines.set(key, record.text);
        if (externalBackup) this.emit('noteExternalBackup', { key, path: externalBackup });
      }, 'note:' + key);
    })();
    try {
      await record.flushing;
      if (this.noteWrites.get(key) === record) { this.noteWrites.delete(key); this.emit("noteSaved", { key }); }
    } finally { record.flushing = null; }
  }
  async flushNotes() { for (const key of [...this.noteWrites.keys()]) await this.flushNote(key); }
  confirmClear(paper, win = Zotero.getMainWindow()) {
    return Services.prompt.confirmEx(win, '清空本篇笔记', `确定清空「${paper.title}」的笔记？\n本次运行中可撤销，真正退出 Zotero 后不再提供清空撤销。原文件会先备份。`, Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING | Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL | Services.prompt.BUTTON_POS_1_DEFAULT, '清空笔记', null, null, null, {}) === 0;
  }
  rememberClear(key, text) {
    const stack = this.clearUndo.get(key) || []; stack.push(String(text)); this.clearUndo.set(key, stack); this.emit('noteClear', { key });
  }
  restoreClearedNote(paper) {
    if (this.clearRestores.has(paper.key)) return this.clearRestores.get(paper.key);
    const job = this.restoreClearedNoteNow(paper); this.clearRestores.set(paper.key, job);
    const cleanup = () => { this.clearRestores.delete(paper.key); this.emit('noteClear', { key: paper.key }); };
    job.then(cleanup, cleanup); this.emit('noteClear', { key: paper.key }); return job;
  }
  async restoreClearedNoteNow(paper) {
    if (this.files.changing.has(paper.key)) throw new Error('请等待资料文件夹更改完成。');
    const stack = this.clearUndo.get(paper.key); if (!stack?.length) return false;
    const previous = stack.at(-1), current = await this.note(paper);
    const text = !current ? previous : current === previous || current.startsWith(previous + '\n\n') ? current : previous + '\n\n' + current;
    this.saveNote(paper.key, text); await this.flushNote(paper.key);
    stack.pop(); if (!stack.length) this.clearUndo.delete(paper.key);
    this.emit('noteUpdated', { key: paper.key, text }); this.emit('noteClear', { key: paper.key }); return true;
  }
  copyImage(dataURL) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataURL)) throw new Error('无效的 PNG 截图。');
    const bytes = Uint8Array.from(atob(dataURL.split(',')[1]), c => c.charCodeAt(0));
    const image = Cc['@mozilla.org/image/tools;1'].getService(Ci.imgITools).decodeImageFromArrayBuffer(bytes.buffer, 'image/png');
    const transfer = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable); transfer.init(null);
    transfer.addDataFlavor('application/x-moz-nativeimage'); transfer.setTransferData('application/x-moz-nativeimage', image);
    Cc['@mozilla.org/widget/clipboard;1'].getService(Ci.nsIClipboard).setData(transfer, null, Ci.nsIClipboard.kGlobalClipboard);
  }
  async backupNote(paper) {
    if (this.files.changing.has(paper.key)) throw new Error('请等待资料文件夹更改完成后再清空笔记。');
    const text = await this.note(paper), dir = (await this.files.ensure(paper)).backups;
    await IOUtils.makeDirectory(dir, { ignoreExisting: true, createAncestors: true, permissions: 0o700 });
    const path = PathUtils.join(dir, paper.key + '-' + Date.now() + '.md'); await this.writeText(path, text);
    return { path, text };
  }
  async exportNote(paper, text) {
    let FilePicker;
    try { ({ FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs")); }
    catch (_) { ({ FilePicker } = ChromeUtils.import("chrome://zotero/content/modules/filePicker.jsm")); }
    const fp = new FilePicker(); fp.init(Zotero.getMainWindow(), "导出 Markdown 笔记", fp.modeSave);
    fp.appendFilter("Markdown", "*.md"); fp.defaultString = PCore.filename(paper.title) + ".md";
    const result = await fp.show();
    if (result === fp.returnOK || result === fp.returnReplace) { await this.writeText(fp.file.path || fp.file, text); return true; }
    return false;
  }
  async addZoteroNote(paper, text) {
    const item = await Zotero.Items.getAsync(paper.id), note = new Zotero.Item("note"); note.libraryID = item.libraryID;
    if (item.parentID) note.parentID = item.parentID;
    note.setNote(PCore.markdown(text)); await note.saveTx(); return note.id;
  }
  async revealNotes(paper) {
    const path = (await this.files.ensure(paper)).dir, file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path); file.launch();
  }
  launchLocalDocument(path) {
    const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(path);
    try { file.launch(); return false; } catch (_) { file.reveal(); return true; }
  }
  async openPaperDocument(paper, kind) {
    if (!paper) throw new Error('请先打开 PDF。');
    if (!['note', 'summary', 'review', 'preread'].includes(kind)) throw new Error('未知的论文文档。');
    if (this.folderChanges.has(paper.key)) await this.folderChanges.get(paper.key);
    if (kind === 'note') await this.flushNote(paper.key);
    const path = (await this.files.ensure(paper))[kind];
    if (!await IOUtils.exists(path)) throw new Error('文档不存在，请检查本篇资料文件夹：' + path);
    const revealed = this.launchLocalDocument(path); return { path, revealed };
  }
  async choosePaperFolder(paper, useDefault = false) {
    if (!paper) throw new Error('请先打开 PDF。');
    let parent;
    if (useDefault) parent = PathUtils.parent(await this.pdfSource(paper));
    else {
      let FilePicker; try { ({ FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs')); } catch (_) { ({ FilePicker } = ChromeUtils.import('chrome://zotero/content/modules/filePicker.jsm')); }
      const fp = new FilePicker(); fp.init(Zotero.getMainWindow(), '选择存放位置（将在其中创建论文同名文件夹）', fp.modeGetFolder);
      if (await fp.show() !== fp.returnOK) return null;
      parent = fp.file.path || fp.file;
    }
    return this.changePaperFolder(paper, parent);
  }
  async changePaperFolder(paper, parent) {
    if (!paper) throw new Error('请先打开 PDF。');
    if (this.files.changing.has(paper.key) || this.chatBusy || this.preread.jobs.has(paper.key) || this.readingSearchController || this.readingDraftController || this.insights.jobs.has(paper.key) || this.insights.manualJobs.has(paper.key) || this.insights.reviewJobs.has(paper.key)) throw new Error('请等待当前问答、预读、原文读取、整理或文件夹更改完成，再修改保存位置。');
    let release; this.folderChanges.set(paper.key, new Promise(resolve => { release = resolve; }));
    this.files.changing.add(paper.key); this.emit('paperFolder', { key: paper.key });
    try {
      await this.flushNote(paper.key, true);
      const paths = await this.files.relocate(paper, parent);
      this.reading.memory.delete(paper.key);
      this.emit('paperFolderUpdated', { key: paper.key, path: paths.dir }); return paths;
    } finally { this.files.changing.delete(paper.key); this.folderChanges.delete(paper.key); release(); this.emit('paperFolder', { key: paper.key }); }
  }
  openVocabulary({ review = false,wordKey='',paper } = {}) {
    const getPaper=async()=>{const reader=this.followCurrentReader();return reader?this.paperInfo(reader.itemID):null;};
    const args={api:this,review,wordKey,getPaper};if(paper!==undefined)args.paper=paper;this.vocabularyRequest=args;
    if (this.vocabularyWindow && !this.vocabularyWindow.closed) {
      const win=this.vocabularyWindow;win.paperCompanionArgs=args;win.focus();
      win.pcVocabularyStart?.(args);
      return win;
    }
    const owner=Zotero.getMainWindow();if(!owner)throw Error('请从 Zotero 主窗口打开单词本。');
    const url=this.resourceURL('vocabulary.xhtml');
    const win = owner.openDialog(url, 'paper-companion-vocabulary', 'chrome,dialog=no,resizable,centerscreen,width=920,height=760', args);
    if(!win)throw Error('单词本窗口未能打开，请重试。');
    this.vocabularyWindow = win;
    win.paperCompanionArgs=args;
    const start=()=>{
      if(win.closed)return;
      const pending=this.vocabularyWindow===win?this.vocabularyRequest:args;
      win.paperCompanionArgs=pending;win.pcVocabularyStart?.(pending);
    };
    win.addEventListener('DOMContentLoaded',start);win.addEventListener('load',start,{once:true});start();
    // A failed chrome resource/navigation can leave even the XHTML shell absent.
    // Keep this watchdog in the owner, so a broken target script cannot hide it.
    const watch=owner.setTimeout(()=>{
      win.removeEventListener('DOMContentLoaded',start);
      if(win.closed||win.pcVocabularyUI||win.document.body?.dataset.vocabularyError)return;
      const doc=win.document,ns='http://www.w3.org/1999/xhtml';
      let body=doc.body;if(!body){body=doc.createElementNS(ns,'body');doc.documentElement.append(body);}
      doc.title='我的单词本 · 论文伴读';body.replaceChildren();
      const palette=PCore.surfacePalette(this.settings.theme);
      body.style.cssText=`margin:0;padding:40px;font:14px/1.8 system-ui;color:${palette.ink};background:${palette.bg}`;
      const title=doc.createElementNS(ns,'h1');title.textContent='单词本窗口未能载入';
      const message=doc.createElementNS(ns,'p');message.setAttribute('role','alert');message.textContent='请关闭后重新打开。若刚更新过插件安装包，请重新启动 Zotero 后再试；词库仍保存在本机。';
      const retry=doc.createElementNS(ns,'button');retry.textContent='重试';retry.style.cssText=`padding:8px 16px;margin-right:12px;font:inherit;color:${palette.ink};background:${palette.paper};border:1px solid ${palette.rule};border-radius:6px`;
      retry.addEventListener('click',()=>{const pending=this.vocabularyRequest;win.close();this.openVocabulary({review:pending?.review,wordKey:pending?.wordKey,paper:pending?.paper});});
      const close=doc.createElementNS(ns,'button');close.textContent='关闭窗口';close.style.cssText=retry.style.cssText;close.addEventListener('click',()=>win.close());body.append(title,message,retry,close);
    },4000);
    win.addEventListener('load',()=>{if(win.pcVocabularyUI)owner.clearTimeout(watch);},{once:true});
    return win;
  }
  async chooseVocabularyFolder() {
    let FilePicker; try { ({ FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs')); } catch (_) { ({ FilePicker } = ChromeUtils.import('chrome://zotero/content/modules/filePicker.jsm')); }
    const fp = new FilePicker(); fp.init(Zotero.getMainWindow(), '选择单词本存放位置（复制到新文件夹，旧文件保留）', fp.modeGetFolder);
    if (await fp.show() !== fp.returnOK) return null;
    return this.vocabulary.relocate(fp.file.path || fp.file);
  }
  async vocabularyBackupFile(importing=false) {
    let FilePicker;try{({FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs'));}catch(_){({FilePicker}=ChromeUtils.import('chrome://zotero/content/modules/filePicker.jsm'));}
    const fp=new FilePicker();fp.init(Zotero.getMainWindow(),importing?'选择单词本 JSON 备份（先预览）':'保存完整单词本备份',importing?fp.modeOpen:fp.modeSave);fp.appendFilter('JSON 词库备份','*.json');if(!importing)fp.defaultString='单词本备份-'+new Date().toISOString().slice(0,10)+'.json';
    const result=await fp.show();if(result!==fp.returnOK&&result!==fp.returnReplace)return null;const path=fp.file.path||fp.file;
    if(importing){const stat=await IOUtils.stat(path);if(stat.size>20*1048576)throw new Error('备份超过20 MB，请拆分后导入。');return {...this.vocabulary.previewImport(JSON.parse(await IOUtils.readUTF8(path))),filename:PathUtils.filename(path)};}
    await this.vocabulary.serial;await this.writeJSON(path,this.vocabulary.backupDocument());return path;
  }
  openURL(url) { const safe = PCore.safeURL(url); if (safe) Zotero.launchURL(safe); }
  copy(text) { Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text); }
  copyFormula(tex) { this.copy(tex); this.lastFormulaCopy = tex.trim(); }
  async shutdown() {
    this.closing = true; this.disconnect(); this.preread?.destroy(); this.insights?.destroy();
    this.vocabularyWindow?.close(); await this.vocabulary?.destroy();
    this.formula?.destroy();
    const readingDrain = this.reading?.destroy();
    for (const popup of this.selectionPopups) {popup.timer?.cancel();popup.appearance?.destroy();} this.selectionPopups.clear(); this.popupNoteDrafts.clear();this.clearVocabularyContext();
    this.web?.destroy(); this.sidebar?.destroy(); for (const win of this.panels) if (!win.closed && !win.pcEmbedded) win.close();
    Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", this.selectionHandler);
    Zotero.Reader.unregisterEventListener("renderToolbar", this.toolbarHandler);
    for (const win of [...this.windows.keys()]) this.removeWindow(win);
    await this.chatCompletion; await readingDrain;
    while (this.inferences.size) await Promise.allSettled([...this.inferences]);
    // A confirmed cleanup already drained all writes. Saving again here would
    // recreate settings/notes after a partial cleanup or self-uninstallation.
    if (this.maintenance !== 'locked') await this.flushNotes();
    await this.sessionStore.drain(); await this.usage?.destroy(); await this.serial; await this.fileWrites.drain();
    this._noteInsertions?.clear();
    if (!this._uninstallReview?.running) this._uninstallReview?.cancel();
    if (this.uninstallState?.observer != null) Zotero.Notifier.unregisterObserver(this.uninstallState.observer);
    this.listeners.clear();
  }
})();
