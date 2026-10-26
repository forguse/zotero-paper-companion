// Two real launches of ONE DISPOSABLE profile. First launch confirms runtime
// cleanup through the UI and native AddonManager; second proves no resurrection.
// No source PDFs, profiles, credentials or accounts from a daily profile are used.
var uninstallTestChrome;
function startup({ rootURI }) {
 uninstallTestChrome = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup)
  .registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [['content', 'paper-companion-uninstall-test', 'content/']]);
 (async () => {
  const base = PathUtils.parent('__OUTPUT__'), phasePath = PathUtils.join(base, 'uninstaller-phase.json'), productID = 'paper-companion@local';
  const results = [], requests = [], diagnostics = {}, screenshots = []; let stage = 'uninstall', resultFile, pc, observer, holder, debug = () => ({});
  const check = (ok, label, detail) => { if (!ok) throw new Error(label + (detail ? ' ' + JSON.stringify(detail) : '')); results.push(label); };
  const wait = async (fn, label) => { for (let i = 0; i < 400; i++) { if (await fn()) return; await Zotero.Promise.delay(50); } throw new Error('Timeout: ' + label); };
  const hash = async path => {
   const digest = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash); digest.init(digest.SHA256);
   const bytes = await IOUtils.read(path); digest.update(bytes, bytes.length); return [...digest.finish(false)].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  };
  const normalized = path => Zotero.isWin ? path.replace(/\\/g, '/').toLowerCase() : path;
  try {
   stage = await IOUtils.exists(phasePath) ? 'restart' : 'uninstall'; resultFile = PathUtils.join(base, stage + '-result.json');
   if (await IOUtils.exists(resultFile)) throw new Error('This stage already has evidence; start a fresh disposable profile.');
   await Zotero.uiReadyPromise; await Zotero.initializationPromise; await Zotero.Libraries.userLibrary.waitForDataLoad('item');
   // Refuse any invocation against a daily/custom profile before creating even
   // the synthetic files. The smoke preparer owns these two exact directories.
   check(normalized(Zotero.Profile.dir) === normalized(PathUtils.join(base, 'profile')) && normalized(Zotero.DataDirectory.dir) === normalized(PathUtils.join(base, 'data')), stage + ' uses only the smoke preparer dedicated profile and data directory');
   const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
   const registry = async () => { const path = PathUtils.join(Zotero.Profile.dir, 'extensions.json'); return await IOUtils.exists(path) ? JSON.parse(await IOUtils.readUTF8(path)).addons?.find(row => row.id === productID) : null; };
   observer = { observe(channel) { if (['api.deepseek.com', 'api.openai.com', 'chatgpt.com', 'auth.openai.com'].includes(channel.URI?.host)) { requests.push({ host: channel.URI.host }); channel.QueryInterface(Ci.nsIRequest).cancel(Components.results.NS_BINDING_ABORTED); } } };
   Services.obs.addObserver(observer, 'http-on-modify-request');
   const productFile = PathUtils.join(Zotero.Profile.dir, 'extensions', productID + '.xpi');
   if (stage === 'restart') {
    const phase = JSON.parse(await IOUtils.readUTF8(phasePath)); diagnostics.phase = phase.phase;
    check(phase.phase === 'uninstalled' && Array.isArray(phase.removedPaths), 'cold restart reads completed first-launch cleanup evidence outside plugin directories');
    check(!await AddonManager.getAddonByID(productID) && !await IOUtils.exists(productFile), 'cold restart has no product registration or installed XPI');
    await Zotero.Promise.delay(600);
    check(!Zotero.PaperCompanion && !await registry(), 'cold restart does not load or re-register the removed plugin');
    for (const path of phase.removedPaths) check(!await IOUtils.exists(path), 'cold restart does not recreate selected file: ' + PathUtils.filename(path));
    const item = await Zotero.Items.getAsync(phase.itemID);
    check(item?.isPDFAttachment() && await item.getFilePathAsync() === phase.source && await hash(phase.source) === phase.sourceHash, 'cold restart preserves the original library attachment and its exact bytes');
    for (const row of phase.keptFiles) check(await IOUtils.exists(row.path) && await hash(row.path) === row.hash, 'cold restart preserves unrelated or unknown file: ' + PathUtils.filename(row.path));
    check((await Zotero.Items.getAsync(phase.parentID))?.getField('title') === phase.title, 'cold restart retains the synthetic Zotero parent bibliographic item');
    // Only after proving absence, genuinely reinstall the fixed package in this
    // same disposable profile. Freshly created defaults are expected now; they
    // must contain none of the old fake credentials or personal fixture data.
    const installer = await AddonManager.getInstallForURL(PathUtils.toFileURI('__PACKAGE__')); await installer.install();
    await wait(() => Zotero.PaperCompanion, 'fresh product initialization after complete uninstall'); pc = Zotero.PaperCompanion;
    pc.request = async () => { requests.push({ via: 'reinstalled plugin request' }); throw new Error('Reinstall verification stays offline.'); };
    const registered = await AddonManager.getAddonByID(productID);
    check(registered?.isActive && registered.temporarilyInstalled === false && pc.state === 'offline', 'subsequent genuine reinstall starts normally and offline in the already cleaned disposable profile');
    const secrets = await pc.readSecrets();
    check(!secrets.deepseek && Object.keys(secrets.openai || {}).length === 0, 'subsequent reinstall has no previous fake API Key or authorization tokens');
    check(pc.meta.accounts.length === 0 && pc.meta.active === null && pc.settings.chatProvider === '', 'subsequent reinstall does not remember the previous fake account or selected provider');
    check(pc.vocabulary.stats().words === 0 && pc.vocabulary.stats().encounters === 0 && pc.vocabulary.data.reviewedThrough === 0, 'subsequent reinstall starts with a clean personal vocabulary book and review position');
    const cleanPaper = await pc.paperInfo(phase.itemID), freshNote = await pc.note(cleanPaper), cleanSession = await pc.session(cleanPaper.key);
    check(freshNote === '# ' + phase.title + '\n\n' && !freshNote.includes('UNINSTALL_NOTE_MARKER') && !freshNote.includes('EXTERNAL_EDIT_AFTER_PREVIEW'), 'subsequent reinstall creates only the requested paper-title note without restoring deleted note content');
    check(cleanSession.messages.length === 0 && pc.usage.data.records.length === 0 && Object.keys(pc.usage.data.rates).length === 0, 'subsequent reinstall has no previous conversations, usage records or custom prices');
    check(await hash(phase.source) === phase.sourceHash && (await Zotero.Items.getAsync(phase.itemID))?.isPDFAttachment(), 'fresh reinstall still preserves the original library PDF and attachment');
    for (const row of phase.keptFiles) check(await IOUtils.exists(row.path) && await hash(row.path) === row.hash, 'fresh reinstall preserves previously retained unrelated file: ' + PathUtils.filename(row.path));
    diagnostics.reinstall = { verified: true, freshConfigurationCreated: true, previousProfileDataAbsentBeforeInstallation: true, version: pc.publicState().version };
   } else {
    await wait(() => Zotero.PaperCompanion, 'product startup'); pc = Zotero.PaperCompanion;
    pc.request = async () => { requests.push({ via: 'plugin request' }); throw new Error('Uninstall tests stay offline.'); };
    check((await AddonManager.getAddonByID(productID))?.isActive && pc.state === 'offline', 'disposable product is genuinely installed and starts offline');
    const title = '完全卸载隔离合成资料：原文保留，插件文件清理', parent = new Zotero.Item('journalArticle'); parent.setField('title', title); await parent.saveTx();
    const item = await Zotero.Attachments.importFromFile({ file: '__PDF__', parentItemID: parent.id }); const reader = await Zotero.Reader.open(item.id);
    await wait(() => { try { return !!pc.pdf(reader).doc; } catch (_) { return false; } }, 'PDF ready');
    const paper = await pc.paperInfo(item.id), paths = await pc.files.ensure(paper), source = await pc.pdfSource(paper), sourceHash = await hash(source);
    await pc.saveSettings({ chatProvider: 'deepseek', smartReading: false, vocabularyGenerateOnAdd: false, vocabularyContextFallback: 'none', autoRecord: false }, 'fake-disposable-uninstall-key');
    await pc.setAccount({ clientID: 'fake-disposable-uninstall-account', email: 'offline-fixture@example.invalid', label: 'Offline fixture' }, { access_token: 'fake-disposable-token', refresh_token: 'fake-disposable-refresh', expires_at: Date.now() + 3600000 });
    pc.saveNote(paper.key, '# 可删除的合成笔记\n\nUNINSTALL_NOTE_MARKER\n'); await pc.flushNotes(); await pc.backupNote(paper); await pc.reading.load(paper.id);
    const session = await pc.session(paper.key); session.messages = [{ role: 'user', text: 'Synthetic uninstall question', status: 'complete', at: 1 }, { role: 'assistant', text: 'Synthetic saved reply without model call.', status: 'complete', provider: 'deepseek', model: 'deepseek-flash', at: 2 }]; await pc.saveSession(paper.key);
    await pc.usage.setRate('deepseek', 'deepseek-flash', { currency: 'CNY', input: 1, cached: .1, write: 1, output: 1 });
    const word = await pc.vocabulary.add({ text: 'spill', readerID: paper.id, page: 2, rects: [] }); await pc.vocabulary.edit(word.id, { meaning: '溢出', sentence: word.sentence || 'The controller reduced spill risk.', sentenceTranslation: '控制器降低了溢出风险。', defaultMeaning: '溢出' });
    await pc.vocabulary.serial; await pc.sessionStore.drain(); await pc.fileWrites.drain();
    const keptPaths = [PathUtils.join(paths.dir, 'USER_OWNED_KEEP.txt'), PathUtils.join(pc.dir, 'UNKNOWN_KEEP.txt'), PathUtils.join(base, 'UNRELATED_KEEP.txt'), '__PDF__'];
    for (const path of keptPaths.slice(0, 3)) await IOUtils.writeUTF8(path, 'KEEP_SYNTHETIC_' + PathUtils.filename(path));
    const keptFiles = []; for (const path of keptPaths) keptFiles.push({ path, hash: await hash(path) });
    const review = pc.uninstallReview, first = await review.preview();
    diagnostics.initialFiles = first.files.map(row => ({ path: row.path, category: row.category }));
    check(first.verified && first.files.every(row => /^[a-f0-9]{64}$/.test(row.hash)), 'native preview hashes every exact candidate before granting a confirmation ticket');
    check(first.files.some(row => row.path === paths.note) && first.files.some(row => row.category === 'chat') && first.files.some(row => row.category === 'usage') && first.files.some(row => row.category === 'vocabulary'), 'preview covers real synthetic notes, chats, usage and vocabulary files');
    check(first.files.some(row => row.path.endsWith('credentials.enc')) && first.files.some(row => row.path.endsWith('accounts.json')) && first.files.some(row => row.path === paths.pdf), 'preview includes encrypted fake credentials, fake account metadata and plugin PDF copy');
    check(!first.files.some(row => row.path === source || keptPaths.includes(row.path)), 'preview excludes the actual Zotero source and all unrelated or unknown files');
    review.cancel();
    for (const row of first.files) check(await IOUtils.exists(row.path) && await hash(row.path) === row.hash, 'cancelled preview leaves exact candidate unchanged: ' + PathUtils.filename(row.path));
    check(!pc.maintenance && requests.length === 0, 'cancelled preview changes no connection or maintenance state');
    const changedPlan = await review.preview(), originalNote = await IOUtils.readUTF8(paths.note); await IOUtils.writeUTF8(paths.note, originalNote + '\nEXTERNAL_EDIT_AFTER_PREVIEW\n');
    let rejected; try { await review.execute({ id: changedPlan.id, confirmation: '完全卸载', acknowledged: true, categories: changedPlan.categories.map(row => row.id) }); } catch (error) { rejected = error; }
    check(!!rejected && !pc.maintenance && !review.partial && (await AddonManager.getAddonByID(productID))?.isActive, 'changed file refuses the confirmed attempt before deletion, resumes writes and retains the installed plugin');
    for (const row of changedPlan.files) check(await IOUtils.exists(row.path), 'changed-file refusal retains candidate: ' + PathUtils.filename(row.path));
    check((await IOUtils.readUTF8(paths.note)).includes('EXTERNAL_EDIT_AFTER_PREVIEW'), 'changed-file refusal preserves the new external note content');
    holder = Zotero.getMainWindow().openDialog('chrome://paper-companion-uninstall-test/content/viewport.xhtml', 'paper-companion-uninstall-test', 'chrome,dialog=no,resizable,width=780,height=980');
    await wait(() => holder.document?.documentURI === 'chrome://paper-companion-uninstall-test/content/viewport.xhtml' && holder.document.readyState === 'complete', 'test viewport');
    const frame = holder.document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe'); frame.style.cssText = 'width:620px;height:900px;display:block;border:0'; Cu.waiveXrays(frame).paperCompanionArgs = { api: pc, embedded: true, readerID: paper.id }; frame.src = pc.resourceURL('panel.xhtml'); holder.document.body.append(frame);
    debug = () => ({ panelURL: frame.contentDocument?.documentURI, panelReady: frame.contentDocument?.body?.dataset.ready, initError: frame.contentDocument?.body?.dataset.initError, maintenance: pc.maintenance, state: review.state, planFiles: review.plan?.files?.length, notice: frame.contentDocument?.getElementById('notice')?.textContent });
    await wait(() => frame.contentDocument?.body?.dataset.ready === 'true', 'panel');
    const win = frame.contentWindow, doc = win.document; doc.getElementById('nav-settings').click(); doc.getElementById('uninstall-review-open').focus({ preventScroll: true }); doc.getElementById('uninstall-review-open').click();
    await wait(() => doc.querySelector('.pc-uninstall-review')?.open && review.plan?.verified && doc.querySelector('.pc-uninstall-confirmation')?.hidden === false, 'confirmed-cleanup UI');
    const dialog = doc.querySelector('.pc-uninstall-review'), deleteButton = dialog.querySelector('.pc-uninstall-delete'), acknowledgement = dialog.querySelector('.pc-uninstall-acknowledgement input'), typed = dialog.querySelector('.pc-uninstall-confirmation-label input');
    check(deleteButton.disabled && !acknowledgement.checked && !typed.value, 'real cleanup dialog starts with destructive action blocked and no prefilled consent');
    const selected = [...dialog.querySelectorAll('.pc-uninstall-category-choice input')];
    check(selected.length >= 5 && selected.every(input => input.checked), 'real cleanup dialog defaults to all identified categories while showing each independently');
    typed.value = '完全卸载'; typed.dispatchEvent(new win.Event('input', { bubbles: true })); check(deleteButton.disabled, 'typing the phrase alone cannot authorize personal-data deletion');
    acknowledgement.click(); check(!deleteButton.disabled && deleteButton.textContent === '完全卸载', 'explicit personal-data acknowledgement plus exact phrase enables one final cleanup action');
    const header = dialog.querySelector('.pc-uninstall-header'), close = dialog.querySelector('.pc-uninstall-close'), headerTop = header.getBoundingClientRect().top;
    check(dialog.scrollHeight > dialog.clientHeight, 'real cleanup confirmation exercises a long inventory that requires scrolling');
    dialog.scrollTop = dialog.scrollHeight; await Zotero.Promise.delay(160);
    const closeRect = close.getBoundingClientRect(), closeHit = doc.elementFromPoint(closeRect.left + closeRect.width / 2, closeRect.top + closeRect.height / 2), deleteRect = deleteButton.getBoundingClientRect(), deleteHit = doc.elementFromPoint(deleteRect.left + deleteRect.width / 2, deleteRect.top + deleteRect.height / 2);
    check(Math.abs(header.getBoundingClientRect().top - headerTop) < 1 && (closeHit === close || close.contains(closeHit)), 'real cleanup dialog retains a fixed clickable close header at the end of its inventory');
    check(deleteRect.top >= header.getBoundingClientRect().bottom && deleteRect.bottom <= dialog.getBoundingClientRect().bottom && (deleteHit === deleteButton || deleteButton.contains(deleteHit)), 'real final cleanup button is fully visible and hit-testable beside the reached confirmation controls');
    const visual = node => { const style = win.getComputedStyle(node); return { opacity: style.opacity, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, filter: style.filter, backdropFilter: style.backdropFilter, transform: style.transform, animationName: style.animationName, animationDuration: style.animationDuration }; };
    const animationState = () => dialog.getAnimations({ subtree: true }).map(animation => ({ state: animation.playState, currentTime: animation.currentTime, timing: animation.effect?.getComputedTiming() }));
    diagnostics.dialogBeforeCapture = { dialog: visual(dialog), header: visual(header), body: visual(doc.body), root: visual(doc.documentElement), paper: win.getComputedStyle(dialog).getPropertyValue('--paper'), animations: animationState() };
    // drawWindow can capture a background window's reveal animation mid-frame.
    // Wait for the actual dialog/subtree animations, never infer completion
    // from an arbitrary 160 ms sleep or force a product style in the fixture.
    await Promise.race([Promise.allSettled(dialog.getAnimations({ subtree: true }).map(animation => animation.finished)), Zotero.Promise.delay(3000)]); await doc.fonts.ready;
    diagnostics.dialogAfterAnimations = { dialog: visual(dialog), header: visual(header), body: visual(doc.body), root: visual(doc.documentElement), animations: animationState() };
    check(Number(diagnostics.dialogAfterAnimations.dialog.opacity) >= .999 && !/^rgba\([^)]*,\s*(?:0|0\.\d+)\)$/.test(diagnostics.dialogAfterAnimations.dialog.backgroundColor) && !diagnostics.dialogAfterAnimations.animations.some(animation => animation.state === 'running' || animation.state === 'pending'), 'settled cleanup confirmation has full dialog opacity and an opaque paper background');
    const canvas = doc.createElement('canvas'); canvas.width = win.innerWidth; canvas.height = win.innerHeight; canvas.getContext('2d').drawWindow(win, 0, 0, canvas.width, canvas.height, 'white'); const screenshot = PathUtils.join(base, 'uninstall-confirmation.png'); await IOUtils.write(screenshot, Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), value => value.charCodeAt(0))); screenshots.push(screenshot);
    const finalPlan = review.plan, removedPaths = finalPlan.files.map(row => row.path); let nativeRemovalEvents = 0;
    const addonListener = { onUninstalled(addon) { if (addon.id === productID) nativeRemovalEvents++; } }; AddonManager.addAddonListener(addonListener);
    try { deleteButton.click(); await wait(async () => review.completed && !await AddonManager.getAddonByID(productID), 'native full cleanup and AddonManager removal'); }
    finally { AddonManager.removeAddonListener(addonListener); }
    check(nativeRemovalEvents === 1 && review.completed && !review.partial, 'one explicit UI confirmation completes cleanup and triggers genuine AddonManager uninstall exactly once');
    for (const path of removedPaths) check(!await IOUtils.exists(path), 'confirmed selected file is absent after cleanup: ' + PathUtils.filename(path));
    check(await hash(source) === sourceHash && (await Zotero.Items.getAsync(item.id))?.isPDFAttachment() && (await Zotero.Items.getAsync(parent.id))?.getField('title') === title, 'cleanup preserves original PDF bytes and Zotero attachment and parent item');
    for (const row of keptFiles) check(await IOUtils.exists(row.path) && await hash(row.path) === row.hash, 'cleanup preserves unrelated or unknown exact bytes: ' + PathUtils.filename(row.path));
    await wait(async () => !await IOUtils.exists(productFile), 'profile product XPI removed');
    await wait(async () => !await registry(), 'profile product registration removed');
    check(!await IOUtils.exists(productFile) && !await registry(), 'genuine uninstall removes both profile XPI and persisted product registration');
    const phase = { phase: 'uninstalled', itemID: item.id, parentID: parent.id, title, source, sourceHash, keptFiles, removedPaths, version: pc.publicState().version };
    await IOUtils.writeUTF8(phasePath, JSON.stringify(phase, null, 2));
   }
   check(requests.length === 0, stage + ' preview, cleanup, retained files and startup never make a model or authentication request');
   await IOUtils.writeUTF8(resultFile, JSON.stringify({ ok: true, stage, results, diagnostics, requests, screenshots }, null, 2));
  } catch (error) {
   diagnostics.runtime = debug(); resultFile ||= PathUtils.join(base, stage + '-result.json');
   await IOUtils.writeUTF8(resultFile, JSON.stringify({ ok: false, stage, error: error.message, stack: error.stack, results, diagnostics, requests, screenshots }, null, 2));
  } finally {
   holder?.close(); if (observer) Services.obs.removeObserver(observer, 'http-on-modify-request'); Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  }
 })();
}
function shutdown() { uninstallTestChrome?.destruct(); uninstallTestChrome = null; }
function install() {} function uninstall() {}
