// Two real launches of one disposable profile. Never use a daily profile.
// First launch starts WITHOUT the product XPI and installs it permanently via
// AddonManager; second launch verifies that exact installation and saved data.
function startup() {
  (async () => {
    const output = '__OUTPUT__', base = PathUtils.parent(output);
    const phaseFile = PathUtils.join(base, 'phase.json');
    const productID = 'paper-companion@local';
    const productFile = PathUtils.join(Zotero.Profile.dir, 'extensions', productID + '.xpi');
    const results = [], diagnostics = {}, requests = [];
    let stage = 'install', resultFile, pc, observer;
    const check = (ok, label, detail) => {
      if (!ok) throw Error(label + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
      results.push(label);
    };
    const wait = async (fn, label) => {
      for (let i = 0; i < 400; i++) {
        if (await fn()) return;
        await Zotero.Promise.delay(50);
      }
      throw Error('Timeout: ' + label);
    };
    const addonState = addon => addon && ({
      id: addon.id, version: addon.version, active: addon.isActive,
      temporarilyInstalled: addon.temporarilyInstalled,
      pendingOperations: addon.pendingOperations,
      resourceURI: addon.getResourceURI('').spec,
      sourceURI: addon.sourceURI?.spec || null
    });
    const registryEntry = async () => {
      const file = PathUtils.join(Zotero.Profile.dir, 'extensions.json');
      if (!await IOUtils.exists(file)) return null;
      return JSON.parse(await IOUtils.readUTF8(file)).addons?.find(a => a.id === productID) || null;
    };
    const capture = async win => {
      await win.document.fonts.ready;
      const canvas = win.document.createElement('canvas');
      const scale = win.devicePixelRatio;
      canvas.width = Math.round(win.innerWidth * scale);
      canvas.height = Math.round(win.innerHeight * scale);
      const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
      ctx.drawWindow(win, 0, 0, win.innerWidth, win.innerHeight, 'white');
      const path = PathUtils.join(base, stage + '-panel.png');
      await IOUtils.write(path, Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0)));
      diagnostics.screenshot = path;
    };
    try {
      const hasPhase = await IOUtils.exists(phaseFile);
      stage = hasPhase ? 'restart' : 'install';
      resultFile = PathUtils.join(base, stage + '-result.json');
      // Preserve the two stages even if someone accidentally launches a third time.
      if (await IOUtils.exists(resultFile)) {
        resultFile = PathUtils.join(base, stage + '-repeat-' + Date.now() + '.json');
        throw Error('This stage already has evidence; previous results were preserved.');
      }
      diagnostics.stage = stage;
      diagnostics.profile = Zotero.Profile.dir;
      await Zotero.uiReadyPromise;
      await Zotero.initializationPromise;
      await Zotero.Libraries.userLibrary.waitForDataLoad('item');
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      observer = { observe(channel) {
        const host = channel.URI?.host;
        if (['api.deepseek.com', 'api.openai.com', 'chatgpt.com', 'auth.openai.com'].includes(host)) {
          requests.push({ host, path: channel.URI.pathQueryRef?.split('?')[0] });
          channel.QueryInterface(Ci.nsIRequest).cancel(Components.results.NS_BINDING_ABORTED);
        }
      } };
      Services.obs.addObserver(observer, 'http-on-modify-request');
      let phase;
      if (stage === 'install') {
        const before = await AddonManager.getAddonByID(productID);
        diagnostics.before = addonState(before);
        check(!before && !await IOUtils.exists(productFile), 'first launch starts without a product registration or profile XPI');
        const installer = await AddonManager.getInstallForURL(PathUtils.toFileURI('__PACKAGE__'));
        await installer.install();
        await wait(() => Zotero.PaperCompanion, 'permanently installed plugin startup');
        pc = Zotero.PaperCompanion;
        pc.request = async () => { requests.push({ via: 'plugin request' }); throw Error('Install/restart tests stay offline.'); };
        check(pc.state === 'offline', 'permanent installation starts without connecting a model');
        const parent = new Zotero.Item('journalArticle');
        parent.setField('title', '永久安装与冷重启：合成研究资料');
        await parent.saveTx();
        const item = await Zotero.Attachments.importFromFile({ file: '__PDF__', parentItemID: parent.id });
        const paper = await pc.paperInfo(item.id);
        const note = '# 冷重启保存检查\n\n这是一份合成笔记，重启后仍应可直接编辑。\n';
        const messages = [
          { role: 'user', text: '重启后是否还保留本篇的阅读记录？', status: 'complete', at: 1 },
          { role: 'assistant', provider: 'deepseek', model: 'deepseek-flash', text: '这条合成回答用于检查会话保存，不调用在线模型。', status: 'complete', at: 2 }
        ];
        await pc.saveAppearance({ theme: 'warm', appearanceMotion: 'standard', edgeLight: true });
        await pc.saveSettings({ chatProvider: 'deepseek', smartReading: false, headerCollapsed: false });
        pc.saveNote(paper.key, note); await pc.flushNotes();
        const session = await pc.session(paper.key); session.messages = messages;
        await pc.saveSession(paper.key); await pc.sessionStore.drain(); await pc.fileWrites.drain();
        phase = { phase: 'installed', paperID: item.id, paperKey: paper.key, theme: 'warm', note, messages, version: pc.publicState().version };
        check(await pc.note(paper) === note, 'synthetic note is flushed to its paper folder before exit');
        check(JSON.stringify((await pc.session(paper.key)).messages) === JSON.stringify(messages), 'synthetic conversation is flushed before exit');
      } else {
        phase = JSON.parse(await IOUtils.readUTF8(phaseFile));
        check(phase.phase === 'installed' && Number.isInteger(phase.paperID), 'second launch uses the first launch phase and original synthetic paper');
        const registered = await AddonManager.getAddonByID(productID);
        diagnostics.before = addonState(registered);
        check(!!registered, 'permanent product registration survives a full Zotero restart');
        check(await IOUtils.exists(productFile), 'installed profile XPI survives a full Zotero restart');
        await wait(() => Zotero.PaperCompanion, 'plugin after full process restart');
        pc = Zotero.PaperCompanion;
        pc.request = async () => { requests.push({ via: 'plugin request' }); throw Error('Install/restart tests stay offline.'); };
        check(pc.state === 'offline', 'cold restart does not reconnect a model');
        check(pc.publicState().version === phase.version, 'cold restart uses the permanently installed version');
        const paper = await pc.paperInfo(phase.paperID);
        check(paper.key === phase.paperKey, 'cold restart preserves the per-paper data key');
        check(pc.settings.theme === phase.theme, 'saved warm theme survives cold restart');
        check(await pc.note(paper) === phase.note, 'exact note Markdown survives cold restart');
        check(JSON.stringify((await pc.session(paper.key)).messages) === JSON.stringify(phase.messages), 'exact saved conversation survives cold restart');
      }
      const addon = await AddonManager.getAddonByID(productID);
      diagnostics.addon = addonState(addon);
      check(!!addon?.isActive && addon.temporarilyInstalled === false, stage + ' product is active and is not a temporary installation');
      check(!(addon.pendingOperations & AddonManager.PENDING_UNINSTALL), stage + ' product is not marked for uninstall');
      check(await IOUtils.exists(productFile), stage + ' product XPI is stored inside the disposable profile');
      await wait(async () => !!await registryEntry(), 'persisted extensions registry');
      const entry = await registryEntry();
      diagnostics.registry = { id: entry.id, version: entry.version, location: entry.location, path: entry.path, active: entry.active };
      check(entry.location === 'app-profile' && entry.version === pc.publicState().version, stage + ' registry persists the same installed version in app-profile');
      await Zotero.Reader.open(phase.paperID);
      await pc.openPanel({ readerID: phase.paperID });
      await wait(() => pc.panel?.document?.body?.dataset.ready === 'true', 'actual registered sidebar');
      const win = pc.panel, doc = win.document;
      diagnostics.panel = { uri: doc.documentURI, ready: doc.body.dataset.ready, initError: doc.body.dataset.initError, width: win.innerWidth, height: win.innerHeight };
      check(pc.panel.pcEmbedded && pc.sidebar.frames.has(win.frameElement), stage + ' opens the actual registered Zotero sidebar');
      check(doc.documentElement.dataset.pcTheme === 'warm' && doc.getElementById('theme-toggle').textContent.includes('暖砂霞光'), stage + ' sidebar renders the saved warm theme');
      check(doc.getElementById('messages').textContent.includes(phase.messages[0].text) && doc.getElementById('messages').textContent.includes(phase.messages[1].text), stage + ' sidebar renders the saved synthetic conversation');
      doc.getElementById('nav-notes').click();
      await wait(() => doc.getElementById('note-preview').textContent.includes('这是一份合成笔记'), 'editable saved note');
      check(doc.getElementById('note-preview').getAttribute('contenteditable') === 'true', stage + ' retained note is directly editable');
      await capture(win);
      check(requests.length === 0, stage + ' installation, startup and restored content make no model request');
      if (stage === 'install') await IOUtils.writeUTF8(phaseFile, JSON.stringify(phase, null, 2));
      await IOUtils.writeUTF8(resultFile, JSON.stringify({ ok: true, stage, results, diagnostics, requests }, null, 2));
    } catch (e) {
      diagnostics.panel ||= pc?.panel && { uri: pc.panel.document?.documentURI, ready: pc.panel.document?.body?.dataset.ready, initError: pc.panel.document?.body?.dataset.initError };
      resultFile ||= PathUtils.join(base, stage + '-result.json');
      await IOUtils.writeUTF8(resultFile, JSON.stringify({ ok: false, stage, error: e.message, stack: e.stack, results, diagnostics, requests }, null, 2));
    } finally {
      if (observer) Services.obs.removeObserver(observer, 'http-on-modify-request');
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    }
  })();
}
function shutdown() {} function install() {} function uninstall() {}
