// Disposable Zotero integration test. All model responses are fake.
function startup() {
 Components.utils.importGlobalProperties(['File']);
 (async () => {
  const results = [], output = '__OUTPUT__'; let debug = () => ({});
  const progress = label => IOUtils.writeUTF8(output + '.progress', JSON.stringify({ label, results })).catch(() => {});
  const check = (value, label) => { if (!value) throw new Error(label); results.push(label); progress(label); };
  const wait = async (fn, label) => { progress(label); for (let i = 0; i < 400; i++) { if (fn()) return; await Zotero.Promise.delay(50); } throw new Error('Timeout: ' + label); };
  try {
   await Zotero.uiReadyPromise; await Zotero.initializationPromise; await Zotero.Libraries.userLibrary.waitForDataLoad('item');
   await wait(() => Zotero.PaperCompanion, 'startup'); const pc = Zotero.PaperCompanion;
   let requests = 0, mode = 'success', payload;
   pc.request = async (_, opts) => {
    requests++; payload = JSON.parse(opts.body);
    if (mode === 'failure') throw new Error('FAKE_MODEL_FAILURE');
    if (mode === 'pending') return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('已取消请求。')), { once: true }));
    return { choices: [{ finish_reason: 'stop', message: { content: '```latex\nE = mc^{2}\n```' } }] };
   };
   const parent = new Zotero.Item('journalArticle'); parent.setField('title', 'Formula integration sample'); await parent.saveTx();
   const item = await Zotero.Attachments.importFromFile({ file: '__PDF__', parentItemID: parent.id });
   const reader = await Zotero.Reader.open(item.id); pc.readerID = item.id;
   await pc.openPanel(); await wait(() => pc.panel?.document?.body?.dataset?.ready === 'true', 'sidebar');
   const panel = pc.panel, ui = panel.document, el = id => ui.getElementById(id), paper = await pc.paper(item.id);
   await wait(() => { try { return !!pc.pdf(reader).app.pdfViewer.getPageView(0)?.div; } catch (_) { return false; } }, 'PDF page');
   check(requests === 0 && pc.state === 'offline', 'opening PDF and sidebar makes no model request');
   el('formula-open').click(); await wait(() => el('formula-dialog').open, 'formula dialog');
   check(requests === 0 && el('formula-insert').disabled, 'opening formula tool is local and cannot insert empty output');
   await pc.saveSettings({}, 'fake-formula-test-key');
   const pdf = pc.pdf(reader), dom = Components.utils.unwaiveXrays(pdf.win.document);
   debug = () => ({ status: el('formula-status').textContent, notice: el('notice').textContent, requests, note: el('note-editor').value.slice(-800), editable: el('note-preview').contentEditable, active: ui.activeElement?.id, overlay: dom.getElementById('paper-companion-formula-capture')?.outerHTML });
   const drag = async () => {
    await wait(() => dom.getElementById('paper-companion-formula-capture'), 'capture overlay');
    const overlay = dom.getElementById('paper-companion-formula-capture');
    const rect = pdf.app.pdfViewer.getPageView(0).div.getBoundingClientRect();
    const left = Math.max(15, rect.left + 50), top = Math.max(55, rect.top + 80);
    const width = Math.min(160, rect.right - left - 5), height = Math.min(80, rect.bottom - top - 5);
    check(width > 8 && height > 8, 'PDF has a visible region for screenshot selection');
    for (const [type, x, y] of [['pointerdown', left, top], ['pointermove', left + width, top + height], ['pointerup', left + width, top + height]]) overlay.dispatchEvent(new pdf.win.PointerEvent(type, Components.utils.cloneInto({ bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y }, pdf.win)));
   };
   el('formula-capture').click(); await drag();
   await wait(() => el('formula-tex').value.includes('E = mc') && !el('formula-copy').disabled, 'capture OCR');
   check(requests === 1 && payload.model === 'deepseek-flash' && payload.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'), 'real PDF crop is sent as an image to the chosen model');
   const image = el('formula-image'); await wait(() => image.complete, 'image preview');
   check(image.naturalWidth > 20 && image.naturalHeight > 20 && image.naturalWidth < 2401, 'cropped image has valid bounded resolution');
   check(!(await pc.note(paper)).includes('E = mc'), 'recognize-only does not write notes');
   el('formula-tex').value = String.raw`E = mc^{2} + \epsilon`; el('formula-tex').dispatchEvent(new panel.Event('input', { bubbles: true }));
   const oldCopy = pc.copy; let copied; pc.copy = text => { copied = text; };
   el('formula-copy').click(); await wait(() => !!copied, 'copy TeX'); check(copied.includes('\epsilon') && !copied.includes('$$'), 'copy TeX preserves edited code without delimiters');
   el('formula-copy-math').click(); await wait(() => copied.startsWith('$$'), 'copy Markdown'); check(copied.endsWith('$$'), 'copy math adds Markdown delimiters'); pc.copy = oldCopy;
   el('formula-insert').click(); el('formula-insert').click(); await wait(() => el('formula-status').textContent.includes('已保存到'), 'insert note');
   const paths = await pc.files.ensure(paper), saved = await IOUtils.readUTF8(paths.note);
   check(saved.includes('$$\nE = mc^{2} + \\epsilon\n$$') && !/PDF 第|zotero:\/\/|公式摘记/.test(saved), 'edited formula saves to colocated Markdown without generated source metadata');
   check(saved.split('E = mc^{2} + \\epsilon').length === 2 && el('formula-insert').disabled, 'repeated click cannot insert the same result twice');
   const before = requests; el('formula-capture').click(); await wait(() => !!pc.formula.cancelCapture, 'capture cancel'); pc.formula.cancelCapture();
   await wait(() => el('formula-dialog').open, 'cancel returns to dialog'); check(requests === before, 'cancelling screenshot does not call a model');
   el('formula-capture-note').click(); await drag(); await wait(() => el('formula-status').textContent.includes('已保存到') && !el('formula-copy').disabled, 'screenshot direct note');
   check((await IOUtils.readUTF8(paths.note)).split('$$\nE = mc^{2}\n$$').length === 2, 'screenshot-and-note mode automatically writes one recognized formula');
   const count = requests; mode = 'failure'; const noteBefore = await pc.note(paper); el('formula-recognize').click();
   await wait(() => el('formula-status').textContent.includes('FAKE_MODEL_FAILURE'), 'model failure');
   check(await pc.note(paper) === noteBefore && requests === count + 1, 'model failure preserves note and never falls back');
   mode = 'pending'; const pendingCount = requests; el('formula-recognize').click(); await wait(() => requests > pendingCount, 'in-flight request'); el('formula-stop').click();
   await wait(() => el('formula-stop').hidden, 'request stopped'); check(await pc.note(paper) === noteBefore, 'cancelled OCR never writes a partial formula');
   check((await pc.session(paper.key)).messages.length === 0, 'formula OCR does not pollute paper conversation history');
   const pasteBefore = requests, transfer = new panel.DataTransfer();
   const png = Uint8Array.from(atob(el('formula-image').src.split(',')[1]), c => c.charCodeAt(0));
   transfer.items.add(new File([png], 'formula.png', { type: 'image/png' }));
   const paste = new panel.Event('paste', { bubbles: true });
   Object.defineProperty(Components.utils.waiveXrays(paste), 'clipboardData', { value: transfer });
   check(transfer.files.length === 1 && transfer.files[0].type === 'image/png', 'synthetic paste fixture carries a native PNG file');
   el('formula-dialog').dispatchEvent(paste);
   await wait(() => el('formula-source').textContent.includes('外部截图') && !el('formula-recognize').disabled, 'paste image');
   check(requests === pasteBefore && !el('formula-tex').value && !el('formula-image').hidden, 'pasting screenshot previews it locally and clears stale TeX without requesting');
   mode = 'success'; el('formula-recognize').click(); await wait(() => !el('formula-copy').disabled, 'recognize pasted image');
   el('formula-insert').click(); await wait(() => el('formula-status').textContent.includes('已保存到'), 'insert external screenshot');
   check(!(await pc.note(paper)).includes('外部截图')&&(await pc.note(paper)).split('$$\nE = mc^{2}\n$$').length===3, 'pasted screenshot saves the equation without an external-source marker');
   check(!!ui.querySelector('#note-preview .katex') && panel.PCMath.source(ui.querySelector('#note-preview .pc-math')).includes('$$'), 'saved formula renders locally while retaining its original TeX');
   el('formula-close').click();
   const surface = el('note-preview'), source = el('note-editor');
   const pasteFormula = async () => {
    const p = ui.createElement('p'); surface.append(p); surface.focus();
    const range = ui.createRange(); range.setStart(p, 0); range.collapse(true); ui.getSelection().removeAllRanges(); ui.getSelection().addRange(range);
    ui.execCommand('paste');
    await pc.flushNotes();
   };
   pc.copyFormula('a+b'); const networkBeforeMath = requests; await pasteFormula();
   check(source.value.includes('$$\na+b\n$$') && [...surface.querySelectorAll('.pc-math .katex')].length >= 4, 'plain TeX from formula clipboard pastes as a typeset equation and saves delimiters');
   check(requests === networkBeforeMath && !source.value.includes('katex-html'), 'math rendering is offline and generated markup never enters the Markdown file');
   source.value += '\n\nInline $x_1^2$ and display:\n\n\\[\\frac{a}{b}\\]\n'; source.dispatchEvent(new panel.Event('input', { bubbles: true }));
   check(surface.querySelectorAll('.pc-math .katex').length >= 6, 'Markdown source edits immediately render inline and display math');
   const paragraph = ui.createElement('p'); paragraph.textContent = 'NEIGHBOR'; surface.append(paragraph); panel.focus(); surface.focus();
   const editRange = ui.createRange(); editRange.setStart(paragraph.firstChild, 8); editRange.collapse(true); ui.getSelection().removeAllRanges(); ui.getSelection().addRange(editRange);
   check(ui.execCommand('insertText', false, '-EDIT'), 'native text edit remains available beside typeset equations');
   check(source.value.includes('$$\na+b\n$$') && source.value.includes('\\frac{a}{b}') && source.value.includes('NEIGHBOR-EDIT'), 'editing adjacent prose keeps formula TeX intact');
   el('note-query').value = 'x_1'; el('note-query').dispatchEvent(new panel.Event('input', { bubbles: true }));
   check(el('note-find-count').textContent.endsWith('/1'), 'formula find counts TeX once instead of duplicating rendered and accessibility text');
   el('note-replacement').value = 'x_2'; el('note-replace-all').click();
   check(source.value.includes('$x_2^2$') && !!surface.querySelector('.katex'), 'formula find and replace edits TeX and rerenders without damaging Markdown');
   await ui.fonts.ready;
   check([...ui.fonts].some(font => font.family.includes('KaTeX') && font.status === 'loaded'), 'bundled math fonts load successfully without remote font requests');
   el('review-document').innerHTML = panel.PCore.markdown('$$\\frac{x_1}{y^2}$$');
   await wait(() => !!el('review-document').querySelector('.katex'), 'review math rendering');
   check(requests === networkBeforeMath, 'math in review documents also renders without model requests');
   const originalModels = pc.models; pc.models = [{ id: 'vision-only', name: 'Vision', inputModalities: ['text', 'image'] }, { id: 'text-only', name: 'Text', inputModalities: ['text'] }, { id: 'unknown', name: 'Unknown' }];
   await pc.saveSettings({ formulaProvider: 'chatgpt' });
   check([...el('formula-model').options].map(o => o.value).join(',') === ',vision-only', 'formula settings offer only models explicitly declaring image capability');
   let rejected = false; try { await pc.saveSettings({ formulaChatGPTModel: 'text-only' }); } catch (_) { rejected = true; }
   check(rejected && requests === networkBeforeMath, 'text-only formula model is rejected without network requests');
   await pc.saveSettings({ formulaChatGPTModel: 'vision-only' }); await pc.saveSettings({ formulaProvider: 'deepseek' }); pc.models = originalModels;
   mode = 'success'; const copyJob = pc.openPanel({ readerID: item.id, action: 'formula-copy' }); await drag(); await copyJob;
   await wait(() => el('formula-status').textContent.includes('已自动复制'), 'screenshot auto copy');
   check(pc.lastFormulaCopy === 'E = mc^{2}', 'PDF shortcut screenshots, recognizes and automatically copies pure TeX');
   check(!el('formula-dialog').open, 'quick copy returns to reading without an extra close action');
   el('formula-close').click(); await pasteFormula();
   check(source.value.includes('$$\nE = mc^{2}\n$$'), 'automatically copied screenshot TeX pastes into notes as rendered math');
   el('formula-open').click(); await wait(() => el('formula-dialog').open, 'reopen formula tool');
   for (const width of [260, 420]) {
    el('formula-dialog').style.width = width + 'px'; await Zotero.Promise.delay(60);
    check(el('formula-dialog').scrollWidth <= el('formula-dialog').clientWidth + 1, 'formula tool fits width ' + width);
    const bottom = el('formula-dialog').getBoundingClientRect().bottom;
    check(el('formula-insert').getBoundingClientRect().bottom <= bottom, 'copy and insert actions remain visible at width ' + width);
   }
   el('formula-dialog').style.width = ''; el('formula-status').textContent = '演示：公式已识别，可修改并复制。';
   const canvas = ui.createElement('canvas'); canvas.width = panel.innerWidth; canvas.height = panel.innerHeight;
   canvas.getContext('2d').drawWindow(panel, 0, 0, canvas.width, canvas.height, 'white');
   await IOUtils.write('__SCREENSHOT__', Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)));
   el('formula-dialog').close(); surface.scrollTop = 0;
   canvas.getContext('2d').drawWindow(panel, 0, 0, canvas.width, canvas.height, 'white');
   await IOUtils.write('__NOTES_SCREENSHOT__', Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)));
   await IOUtils.writeUTF8(output, JSON.stringify({ ok: true, results }, null, 2));
  } catch (e) { await IOUtils.writeUTF8(output, JSON.stringify({ ok: false, error: e.message, stack: e.stack, debug: debug(), results }, null, 2)); }
  finally { Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); }
 })();
}
function shutdown() {}
function install() {}
function uninstall() {}
