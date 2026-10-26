// Disposable native experience checks. Synthetic PDFs, fake provider responses,
// local settings only. Does not open, clear, or authenticate a daily profile.
var experienceChrome;
function startup({ rootURI }) {
 experienceChrome = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup)
  .registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [['content', 'paper-companion-experience-test', 'content/']]);
 (async () => {
  const output = '__OUTPUT__', results = [], screenshots = [], metrics = [];
  let debug = () => ({}), holder;
  const check = (ok, label, detail) => { if (!ok) throw new Error(label + (detail ? ' ' + JSON.stringify(detail) : '')); results.push(label); };
  const wait = async (fn, label) => { for (let i = 0; i < 300; i++) { if (fn()) return; await Zotero.Promise.delay(45); } throw new Error('Timeout: ' + label); };
  const pause = () => Zotero.Promise.delay(160);
  try {
   await Zotero.uiReadyPromise; await Zotero.initializationPromise; await Zotero.Libraries.userLibrary.waitForDataLoad('item');
   await wait(() => Zotero.PaperCompanion, 'plugin startup');
   const pc = Zotero.PaperCompanion, main = Zotero.getMainWindow(); let requests = 0, lastBody, preparations = [];
   pc.request = async (_, { body, onChunk }) => {
    requests++; lastBody = JSON.parse(body);
    const text = lastBody.messages?.[0]?.content?.includes('翻译') ? 'TRANSLATED_EXPERIENCE_RESULT' : '### 合成回答\n\n' + Array.from({ length: 18 }, (_, i) => '阅读证据 ' + (i + 1) + '：先核对研究问题、方法和实验范围，再判断结论。 This is a synthetic offline answer.').join('\n\n');
    onChunk?.('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 60, total_tokens: 160, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 } }) + '\n\n');
    return { choices: [{ message: { content: text }, finish_reason: 'stop' }] };
   };
   const originalPrepare = pc.reading.prepare.bind(pc.reading);
   pc.reading.prepare = async (id, query, options = {}) => { preparations.push({ id, query, first: options.first, includePrimary: options.includePrimary }); return originalPrepare(id, query, options); };
   await pc.saveSettings({ chatProvider: 'deepseek', smartReading: true, headerCollapsed: true, chatOptionsCollapsed: true, materialsCollapsed: true, autoRecord: false }, 'fake-experience-key');
   await pc.saveAppearance({ theme: 'cloud', appearanceMotion: 'off' });
   const parent = new Zotero.Item('journalArticle'); parent.setField('title', '产品体验合成资料：阅读范围、摘记与操作反馈'); await parent.saveTx();
   const item = await Zotero.Attachments.importFromFile({ file: '__PDF__', parentItemID: parent.id }); await Zotero.Reader.open(item.id);
   const paper = await pc.paperInfo(item.id); pc.readerID = item.id;
   await wait(() => { try { return pc.pdf(pc.allReaders().find(reader => reader.itemID === item.id)).doc.numPages === 2; } catch (_) { return false; } }, 'PDF ready');
   holder = main.openDialog('chrome://paper-companion-experience-test/content/viewport.xhtml', 'paper-companion-experience-test', 'chrome,dialog=no,resizable,width=980,height=1000');
   await wait(() => holder.document?.documentURI === 'chrome://paper-companion-experience-test/content/viewport.xhtml' && holder.document.readyState === 'complete' && holder.document.body, 'viewport');
   const outer = holder.document.createElementNS('http://www.w3.org/1999/xhtml', 'div'); outer.style.cssText = 'width:900px;height:820px;overflow:auto'; holder.document.body.append(outer);
   const frame = holder.document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe'); frame.style.cssText = 'display:block;border:0;width:520px;height:900px';
   Cu.waiveXrays(frame).paperCompanionArgs = { api: pc, embedded: true, readerID: paper.id }; frame.src = pc.resourceURL('panel.xhtml'); outer.append(frame);
   debug = () => ({ requests, preparations, holderURL: holder.document?.documentURI, holderReady: holder.document?.readyState, connected: frame.isConnected,
    panelURL: frame.contentDocument?.documentURI, panelReady: frame.contentDocument?.readyState, bodyReady: frame.contentDocument?.body?.dataset?.ready,
    initError: frame.contentDocument?.body?.dataset?.initError, panelText: frame.contentDocument?.body?.textContent?.slice(-1400) });
   await wait(() => frame.contentDocument?.body?.dataset.ready === 'true', 'panel');
   const win = frame.contentWindow, doc = win.document, $ = id => doc.getElementById(id), tab = name => $('nav-' + name).click();
   const active = name => $('tab-' + name).classList.contains('active'), rect = node => node.getBoundingClientRect().toJSON();
   const trigger = (node, type = 'change') => node.dispatchEvent(new win.Event(type, { bubbles: true }));
   const capture = async name => { await pause(); await doc.fonts.ready; const c = doc.createElement('canvas'); c.width = win.innerWidth; c.height = win.innerHeight; c.getContext('2d').drawWindow(win, 0, 0, c.width, c.height, 'white'); const path = PathUtils.join(PathUtils.parent(output), name + '.png'); await IOUtils.write(path, Uint8Array.from(atob(c.toDataURL().split(',')[1]), value => value.charCodeAt(0))); screenshots.push(path); };
   debug = () => ({ requests, preparations, notice: $('notice').textContent, initError: doc.body.dataset.initError, tab: doc.querySelector('.tabs').dataset.active,
    scope: $('reading-scope-host').textContent, receipt: doc.querySelector('.message-note-receipt')?.textContent, note: $('note-editor').value,
    statuses: [...doc.querySelectorAll('[data-settings-save-group]')].map(node => [node.dataset.settingsSaveGroup, node.dataset.saveStatus]), dialogs: [...doc.querySelectorAll('dialog[open]')].map(node => node.className || node.id) });
   check(requests === 0 && pc.state === 'offline', 'opening all new experience controllers makes no inference or connection');
   check($('guide-shortcuts').hidden && !pc.settings.actionGuidePins?.length, 'optional shortcuts start absent rather than taking reading space');
   check(!$('guide-empty-hint').hidden && $('quick-toggle').textContent.includes('常用问题'), 'empty conversation offers a dismissible hint and common questions have a visible label');
   check($('reading-scope-host').textContent.includes('本篇智能检索') && !$('reading-scope-host').querySelector('input'), 'planned default reading scope is visible without pretending materials are already read');
   check(doc.querySelectorAll('.tabs button').length === 6, 'all six existing primary feature entrances remain at the same navigation level');

   // E04: discover tools without triggering them; pin at most two, retain all
   // original entrances, and let the user dismiss the single empty-chat hint.
   $('guide-empty-hint').querySelector('button').click(); await wait(() => pc.settings.actionGuideDismissed === true, 'hint preference');
   check($('guide-empty-hint').hidden && requests === 0, 'dismissing the empty-chat hint persists locally without contacting a model');
   tab('settings'); $('action-guide-open').click(); await wait(() => doc.querySelector('.pc-action-guide')?.open, 'guide');
   const guide = doc.querySelector('.pc-action-guide'), pageSelect = guide.querySelector('select'); pageSelect.value = 'chat'; trigger(pageSelect);
   const guideRow = label => [...guide.querySelectorAll('.pc-guide-action-row')].find(row => row.querySelector('button').textContent === label);
   guideRow('常用问题').querySelector('input').click(); await wait(() => pc.settings.actionGuidePins?.includes('questions'), 'first shortcut');
   guideRow('阅读笔记').querySelector('input').click(); await wait(() => pc.settings.actionGuidePins?.length === 2, 'second shortcut');
   check(guideRow('截图提问').querySelector('input').disabled, 'guide explicitly caps pinned shortcuts at two');
   guide.querySelector('.pc-guide-reset').click(); await wait(() => pc.settings.actionGuideDismissed === false, 'hint reset');
   const cancel = new win.Event('cancel', { cancelable: true }); guide.dispatchEvent(cancel); await pause();
   check(!guide.open && doc.activeElement === $('action-guide-open') && requests === 0, 'guide escape restores focus and all guide edits remain offline');
   tab('chat'); check(!$('guide-shortcuts').hidden && $('guide-shortcuts').querySelectorAll('button').length === 2, 'only explicitly pinned entrances occupy the compact shortcut strip');
   $('guide-shortcuts').querySelectorAll('button')[1].click(); check(active('notes') && requests === 0, 'pinned notes shortcut opens the existing directly editable note without inference'); tab('chat');

   // E01: manually selected text keeps priority. Current-paper evidence is an
   // explicit local choice, and recorded actual scope differs from next plan.
   $('materials-toggle').click(); $('input-format').value = 'text'; trigger($('input-format')); $('fulltext').click();
   await wait(() => !$('attachment').hidden && !$('fulltext').disabled, 'manual text attachment');
   check($('preview-context').textContent.includes('文字') && !$('preview-context').textContent.includes('图片'), 'rapid format selection followed immediately by extraction keeps the explicitly chosen text-only attachment label');
   const scope = $('reading-scope-host').querySelector('details'), scopeSummary = scope.querySelector('summary'); scope.open = true; await pause();
   let checkbox = scope.querySelector('input[type=checkbox]');
   check(checkbox && !checkbox.checked && scope.textContent.includes('手动材料默认不额外读取本篇'), 'manual attachment defaults to its explicit selected material and offers current-paper opt-in');
   const heightBeforeScope = rect(doc.querySelector('.composer')).height; scope.open = false; await pause(); const heightClosedScope = rect(doc.querySelector('.composer')).height;
   check(Math.abs(heightBeforeScope - heightClosedScope) < 1, 'reading-scope details float above the input and never increase composer height');
   scope.open = true; checkbox.click(); await pause(); checkbox = scope.querySelector('input[type=checkbox]');
   check(checkbox.checked && scopeSummary.textContent.includes('本篇智能检索') && requests === 0 && preparations.length === 0, 'current-paper opt-in changes only the planned scope until explicit sending');
   scope.open = false; $('prompt').value = 'Experimental spill risk results'; trigger($('prompt'), 'input'); $('send').click();
   await wait(() => !pc.chatBusy && $('messages').querySelector('.message.assistant') && requests === 1, 'combined answer'); await pause();
   const session = await pc.session(paper.key), answer = session.messages.at(-1), paths = await pc.files.ensure(paper);
   const manualMaterial = session.materials?.[session.lastContextID];
   check(manualMaterial?.format === 'text' && !manualMaterial.image && !manualMaterial.images?.length && !manualMaterial.file && answer.readingScope.sources.manualKind === 'text' && !JSON.stringify(lastBody).includes('"image_url"'), 'rapid text-only material action remains text in persisted context, scope and actual fake model payload without image bytes');
   check(preparations.length === 1 && preparations[0].includePrimary === true && preparations[0].first === false, 'opt-in supplements manual material with bounded question evidence rather than first-turn whole-paper upload');
   check(answer.readingScope.phase === 'prepared' && answer.readingScope.sources.manual && answer.readingScope.sources.primaryActual === true, 'actual response records manual material and verifiable current-paper evidence');
   check(JSON.stringify(lastBody).includes('PAGE_TWO_MARKER') && answer.readingScope.coverage.some(row => row.kind === 'lexical'), 'actual scope corresponds to the real local query-selected evidence supplied to the fake request');
   const diskSession = JSON.parse(await IOUtils.readUTF8(PathUtils.join(pc.chatsDir, paper.key + '.json')));
   check(diskSession.messages.at(-1).readingScope.sources.primaryActual === true, 'actual scope survives conversation persistence instead of existing only in transient UI');
   const assistant = () => [...$('messages').querySelectorAll('.message.assistant')].at(-1), detailsButton = () => [...assistant().querySelectorAll('.message-actions button')].find(node => node.textContent.includes('详情'));
   detailsButton().click(); check(!assistant().querySelector('.message-model-info').hidden && assistant().querySelector('.message-reading-detail').textContent.includes('本轮实际依据'), 'answer details disclose the recorded scope on the same response');
   await capture('experience-reading-scope');

   // E02: saving excerpts is not navigation. Undo is guarded by the exact
   // inserted source range and preserves what the user writes afterwards.
   const before = $('note-editor').value, noteAction = () => [...assistant().querySelectorAll('.message-actions button')].find(node => node.textContent === '记入笔记');
   noteAction().click(); await wait(() => assistant().querySelector('.note-receipt')?.dataset.status === 'saved', 'chat note receipt');
   const inserted = $('note-editor').value.slice(before.length);
   check(active('chat') && inserted.includes('合成回答') && assistant().querySelector('.note-receipt-status').textContent === '已记入笔记', 'chat excerpt stays in conversation with explicit persisted receipt');
   check(await IOUtils.readUTF8(paths.note) === $('note-editor').value, 'chat excerpt is actually saved to its per-paper Markdown');
   tab('notes'); const later = '\n\nLATER_PERSONAL_NOTE'; $('note-editor').value += later; trigger($('note-editor'), 'input'); await pc.flushNotes(); tab('chat');
   assistant().querySelector('.note-receipt-undo').click(); await wait(() => assistant().querySelector('.note-receipt-status')?.textContent === '已撤销', 'safe undo');
   check(active('chat') && $('note-editor').value === before + later && await IOUtils.readUTF8(paths.note) === before + later, 'receipt undo removes only that excerpt and preserves later personal writing on disk');
   noteAction().click(); await wait(() => assistant().querySelector('.note-receipt')?.dataset.status === 'saved', 'second receipt');
   outer.scrollTop = 35; const outerBeforeView = outer.scrollTop; assistant().querySelector('.note-receipt-view').click(); await pause();
   check(active('notes') && !!$('note-preview').querySelector('.note-located'), 'only explicit View navigates to notes and locates the inserted Markdown blocks');
   check(Math.abs(outer.scrollTop - outerBeforeView) < 1, 'viewing a located note scrolls only the editor, preserving the outer Zotero-like host position');
   await capture('experience-note-receipt-view');

   tab('translate'); $('translation-input').value = 'Original phrase for an explicit translation excerpt.'; $('translate').click();
   await wait(() => $('translation-result').textContent.includes('TRANSLATED_EXPERIENCE_RESULT') && !$('translate').disabled && !$('translation-note').disabled, 'translation completed with enabled note action');
   const translationBefore = $('note-editor').value, beforeTranslationSaveRequests = requests; $('translation-note').click();
   await wait(() => $('translation-note-receipt').querySelector('.note-receipt')?.dataset.status === 'saved', 'translation receipt');
   check(active('translate') && $('note-editor').value.includes('TRANSLATED_EXPERIENCE_RESULT') && requests === beforeTranslationSaveRequests, 'translation save stays on the translation page and does not call another model');
   $('translation-note-receipt').querySelector('.note-receipt-undo').click(); await wait(() => $('translation-note-receipt').querySelector('.note-receipt-status')?.textContent === '已撤销', 'translation undo');
   check($('note-editor').value === translationBefore && active('translate'), 'translation receipt undo restores exact prior Markdown without navigating');
   await capture('experience-translation-receipt');

   // E03: manual and instant settings communicate different saving semantics,
   // and a post-commit display problem cannot misreport a failed persistence.
   tab('settings'); await pause();
   check($('save-settings').disabled && $('settings-translation').dataset.saveStatus === 'clean' && $('settings-translation').textContent.includes('修改后需点击保存'), 'unchanged manual settings disable Save and explain submission semantics');
   $('language').value = 'English'; trigger($('language'), 'input'); trigger($('language'));
   check(!$('save-settings').disabled && $('settings-translation').dataset.saveStatus === 'dirty' && pc.settings.language === '简体中文', 'editing a manual field marks only its group pending without applying prematurely');
   $('save-settings').click(); await wait(() => pc.settings.language === 'English' && $('save-settings').disabled && $('settings-translation').dataset.saveStatus === 'clean', 'manual settings saved');
   check((await pc.readSecrets()).deepseek === 'fake-experience-key', 'saving an unrelated group preserves the existing encrypted API Key');
   $('summary-prompt').value += '\n\nNATIVE_PROMPT_MARKER'; trigger($('summary-prompt'), 'input');
   check($('settings-prompts').dataset.saveStatus === 'dirty' && !$('save-summary-prompts').disabled && !pc.settings.summaryPrompt.includes('NATIVE_PROMPT_MARKER'), 'prompt changes keep their separate pending state until explicit prompt Save');
   $('save-summary-prompts').click(); await wait(() => pc.settings.summaryPrompt.includes('NATIVE_PROMPT_MARKER') && $('save-summary-prompts').disabled, 'prompt saved');
   const edge = $('appearance-settings').querySelector('input[type=checkbox]'); edge.click(); await wait(() => pc.settings.edgeLight === false && $('settings-appearance').dataset.saveStatus === 'clean', 'automatic appearance save');
   check($('settings-appearance').textContent.includes('自动保存') && $('save-settings').disabled, 'instant appearance change reports automatic save without creating unrelated manual pending changes');
   const originalRefresh = pc.refreshSelectionPopups.bind(pc); pc.refreshSelectionPopups = () => { throw new Error('synthetic popup refresh error'); };
   tab('chat'); $('screenshot-options-toggle').click(); $('screenshot-copy').click(); await wait(() => pc.settings.screenshotCopy === true && $('screenshot-options').dataset.saveStatus === 'clean', 'postcommit display failure'); pc.refreshSelectionPopups = originalRefresh;
   check(JSON.parse(await IOUtils.readUTF8(PathUtils.join(pc.dir, 'settings.json'))).screenshotCopy === true && !$('screenshot-options').textContent.includes('自动保存失败'), 'post-commit popup refresh failure retains honest saved status and committed file');

   $('clear-context').click(); await pc.saveSettings({ smartReading: false }); await pause();
   check(/会话|连续问答/.test($('reading-scope-host').querySelector('summary').textContent) && $('reading-scope-host').textContent.includes('上轮实际依据'), 'next plain follow-up distinguishes retained chat history from the previous actual reading evidence');
   // Geometry at real Gecko widths. New disclosures use floating space; all
   // essential controls remain reachable and the main reply remains scrollable.
   for (const width of [260, 340, 520]) {
    frame.style.width = width + 'px'; await pause();
    const composer = doc.querySelector('.composer'), closed = rect(composer), reading = rect(doc.querySelector('.chat-log')); scope.open = true; await pause();
    const opened = rect(composer), disclosure = rect(scope.querySelector('.reading-scope-details')), send = rect($('send'));
    check(Math.abs(opened.height - closed.height) < 1 && disclosure.left >= -1 && disclosure.right <= win.innerWidth + 1, width + 'px reading disclosure floats within the panel without resizing the input', { closed, opened, disclosure });
    check(reading.height >= 40 && send.bottom <= win.innerHeight + 1 && send.width >= 44, width + 'px preserves the readable reply and reachable Send control', { reading, send });
    scope.open = false; $('quick-toggle').click(); await pause();
    check(Math.abs(rect(composer).height - closed.height) < 1 && !$('quick-menu').hidden, width + 'px labelled common questions remain a floating menu rather than expanding the composer');
    $('quick-toggle').click(); metrics.push({ width, composer: rect(composer), reading, scope: disclosure }); await capture('experience-chat-' + width);
   }
   // E06 preview stage is always read-only. This experience harness never
   // confirms cleanup; the separate disposable uninstall harness verifies it.
   // Original attachments and unknown user files stay outside the inventory.
   const unknownPath = PathUtils.join(paths.dir, 'USER_OWNED_KEEP.txt'); await IOUtils.writeUTF8(unknownPath, 'USER_OWNED_KEEP');
   const realSource = await pc.pdfSource(paper), sourceBefore = await IOUtils.stat(realSource), noteBeforeInventory = await IOUtils.readUTF8(paths.note);
   const inventory = await pc.uninstallReview.preview();
   check(inventory.files.some(row => row.path === PathUtils.join(pc.dir, 'credentials.enc')) && inventory.files.some(row => row.path === paths.note), 'native uninstall review identifies exact encrypted credentials and per-paper note paths');
   check(!inventory.files.some(row => row.path === realSource || row.path === unknownPath) && pc.uninstallReview.available, 'uninstall review excludes source attachments and unknown user files before any explicit cleanup consent');
   pc.uninstallReview.cancel();
   check((await IOUtils.stat(realSource)).size === sourceBefore.size && await IOUtils.readUTF8(paths.note) === noteBeforeInventory && await IOUtils.readUTF8(unknownPath) === 'USER_OWNED_KEEP', 'cancelling the native uninstall inventory leaves source PDF, personal Markdown and unknown files unchanged');
   frame.style.width = '520px'; tab('settings'); await pause(); $('uninstall-review-open').focus({ preventScroll: true }); $('uninstall-review-open').click();
   await wait(() => doc.querySelector('.pc-uninstall-review')?.open && doc.querySelector('.pc-uninstall-review .pc-uninstall-status')?.textContent.includes('仅预览'), 'read-only uninstall dialog');
   const uninstallDialog = doc.querySelector('.pc-uninstall-review');
   check(uninstallDialog.textContent.includes('打开本页不会清理数据') && [...uninstallDialog.querySelectorAll('.pc-uninstall-path')].some(node => node.textContent === paths.note), 'settings uninstall entry opens the real native inventory with a clear preview explanation and exact known note path');
   check(uninstallDialog.querySelector('.pc-uninstall-delete')?.disabled && uninstallDialog.querySelector('.pc-uninstall-copy') && uninstallDialog.querySelector('.pc-uninstall-reveal'), 'uninstall review keeps destructive action disabled until typed confirmation and personal-data acknowledgement');
   const uninstallHeader = uninstallDialog.querySelector('.pc-uninstall-header'), uninstallClose = uninstallDialog.querySelector('.pc-uninstall-close'), uninstallHeaderTop = rect(uninstallHeader).top;
   check(uninstallDialog.scrollHeight > uninstallDialog.clientHeight, 'uninstall preview exercises a genuinely overflowing multi-file inventory');
   uninstallDialog.scrollTop = uninstallDialog.scrollHeight; await pause();
   const uninstallCloseRect = rect(uninstallClose), uninstallCloseHit = doc.elementFromPoint(uninstallCloseRect.left + uninstallCloseRect.width / 2, uninstallCloseRect.top + uninstallCloseRect.height / 2), uninstallConfirmation = rect(uninstallDialog.querySelector('.pc-uninstall-confirmation'));
   check(Math.abs(rect(uninstallHeader).top - uninstallHeaderTop) < 1 && (uninstallCloseHit === uninstallClose || uninstallClose.contains(uninstallCloseHit)), 'uninstall preview keeps its opaque close header fixed and clickable while scrolling to final confirmation');
   check(uninstallConfirmation.top >= rect(uninstallHeader).bottom && uninstallConfirmation.bottom <= rect(uninstallDialog).bottom, 'uninstall preview reaches the complete final confirmation without losing its close action');
   await capture('experience-uninstall-review'); uninstallDialog.dispatchEvent(new win.Event('cancel', { cancelable: true }));
   check(!doc.querySelector('.pc-uninstall-review') && doc.activeElement === $('uninstall-review-open') && await IOUtils.exists(PathUtils.join(pc.dir, 'credentials.enc')), 'Escape closes the native uninstall review, restores its launch focus and leaves the encrypted credential file intact');
   check(requests === 2, 'all local scope, guide, excerpt, settings and geometry operations added no model requests beyond one chat and one translation');
   await IOUtils.writeUTF8(output, JSON.stringify({ ok: true, version: Zotero.version, results, metrics, screenshots }, null, 2));
  } catch (error) {
   await IOUtils.writeUTF8(output, JSON.stringify({ ok: false, error: error.message, stack: error.stack, debug: debug(), results, metrics, screenshots }, null, 2));
  } finally { holder?.close(); Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); }
 })();
}
function shutdown() { experienceChrome?.destruct(); experienceChrome = null; }
function install() {} function uninstall() {}
