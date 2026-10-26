// Disposable native notes regression. Synthetic PDF and fake model replies only.
function startup() {
 (async () => {
  const results=[],output='__OUTPUT__';let debug=()=>({});
  const check=(value,label)=>{if(!value)throw new Error(label);results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw new Error('Timeout: '+label);};
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
   const pc=Zotero.PaperCompanion;let requests=0;
   pc.request=async(_,{onChunk})=>{requests++;onChunk('data: '+JSON.stringify({choices:[{delta:{content:'FAKE_ANSWER_MARKER'},finish_reason:'stop'}]})+'\n\n');};
   check(!pc.settings.autoRecord&&!new pc.constructor().settings.autoRecord,'fresh defaults and legacy default-on settings both disable automatic answer recording');
   const add=async title=>{const parent=new Zotero.Item('journalArticle');parent.setField('title',title);await parent.saveTx();const attachment=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});await Zotero.Reader.open(attachment.id);return pc.paperInfo(attachment.id);};
   const a=await add('Notes Article A');await pc.openPanel({readerID:a.id});await wait(()=>pc.panel?.document?.body?.dataset?.ready==='true','first panel');
   const win=pc.panel,ui=win.document,el=id=>ui.getElementById(id),activate=id=>win.paperCompanionActivate({readerID:id});
   debug=()=>({requests,paper:el('paper').value,note:el('note-editor').value,notice:el('notice').textContent});
   check((await pc.note(a))==='# Notes Article A\n\n'&&el('note-editor').value==='# Notes Article A\n\n','new note contains only its own article title in both file and editor');
   check(!el('auto-record').checked&&requests===0,'automatic recording switch is visible and unchecked without model requests');
   const own='# My own heading\n\nA_PERSONAL_NOTE $x_1$\n';
   el('note-editor').value=own;el('note-editor').dispatchEvent(new win.Event('input',{bubbles:true}));
   const b=await add('Notes Article B');await activate(b.id);
   check(el('note-editor').value==='# Notes Article B\n\n'&&!el('note-preview').textContent.includes('A_PERSONAL_NOTE'),'switching to an unread article shows a new independent note');
   await pc.flushNotes();check((await pc.note(a))===own,'typing before a paper switch is saved to the original article');
   await activate(a.id);check(el('note-editor').value===own,'returning to an article restores personal notes without changing their heading');
   await activate(b.id);el('note-editor').value='';el('note-editor').dispatchEvent(new win.Event('input',{bubbles:true}));await pc.flushNotes();
   await activate(a.id);await activate(b.id);check(el('note-editor').value===''&&(await pc.note(b))==='','deliberately cleared notes remain empty after switching away and back');
   await pc.saveSettings({chatProvider:'deepseek',smartReading:false},'fake-notes-test-key');await pc.ask(b.key,'Default recording test',null);
   check((await pc.note(b))===''&&requests===1,'completed answers do not write into personal notes while recording is off');
   ui.querySelector('[data-tab="notes"]').click();el('auto-record').click();await wait(()=>pc.settings.autoRecord&&pc.settings.autoRecordOptIn,'explicit recording switch');
   check(JSON.parse(await IOUtils.readUTF8(PathUtils.join(pc.dir,'settings.json'))).autoRecordOptIn===true,'manual recording choice is persisted for future launches');
   await pc.ask(b.key,'OPT_IN_QUESTION',null);await pc.flushNotes();
   check((await pc.note(b)).includes('OPT_IN_QUESTION')&&(await pc.note(b)).includes('FAKE_ANSWER_MARKER'),'explicitly enabling the switch records subsequent questions and answers');
   el('auto-record').click();await wait(()=>!pc.settings.autoRecord,'recording off');
   const before=await pc.note(b);await pc.ask(b.key,'NO_MORE_AUTO_RECORD',null);await pc.flushNotes();check((await pc.note(b))===before,'turning recording off preserves existing notes and stops further automatic additions');
   // Reuse the same real iframe as Zotero may do when its section item changes.
   const holder=ui.createElement('div');ui.body.append(holder);pc.sidebar.mount({body:holder,item:await Zotero.Items.getAsync(a.id),tabType:'reader'});
   const frame=holder.querySelector('iframe');await wait(()=>frame.contentWindow?.document?.body?.dataset?.ready==='true','reused iframe first article');
   check(frame.contentDocument.getElementById('note-editor').value===own,'new sidebar instance restores only its owning article');
   pc.sidebar.mount({body:holder,item:await Zotero.Items.getAsync(b.id),tabType:'reader'});
   await wait(()=>frame.contentDocument.getElementById('paper').value===String(b.id)&&frame.contentDocument.getElementById('note-editor').value===before,'reused iframe new article');
   check(!frame.contentDocument.getElementById('note-editor').value.includes('A_PERSONAL_NOTE'),'reused sidebar automatically changes note ownership with its PDF');
   holder.remove();pc.panel=win;await activate(a.id);await activate(b.id);
   // Delay A's read, complete B, then let the older A result arrive last.
   ui.querySelector('[data-tab="chat"]').click();const read=pc.note.bind(pc);let release,entered=false;
   pc.note=p=>p.key===a.key?new Promise(resolve=>{entered=true;release=()=>resolve(own);}):read(p);
   const stale=activate(a.id);await wait(()=>entered,'delayed note read');
   check(el('note-editor').value===''&&el('note-preview').getAttribute('contenteditable')==='false','changing paper immediately clears and disables the previous note while loading');
   const oldManual=[...el('messages').querySelectorAll('button')].find(n=>n.textContent==='记入笔记');check(!!oldManual,'the previous-paper answer action remains available to exercise the pending ownership guard');oldManual.click();await Zotero.Promise.delay(80);
   check(!pc.noteWrites.has(a.key)&&/正在读取|尚未准备好/.test(el('notice').textContent)&&el('tab-chat').classList.contains('active'),'manual append during a note load is explained and cannot write stale content or change the page');
   await activate(b.id);release();await stale;pc.note=read;
   check(el('note-editor').value===before,'late previous-paper read cannot replace the current note');
   const manual=[...el('messages').querySelectorAll('button')].find(n=>n.textContent==='记入笔记'),manualRequests=requests;check(!!manual,'the current-paper answer has a manual note action');manual.click();await wait(()=>manual.closest('.message').querySelector('.note-receipt')?.dataset.status==='saved','manual append receipt');
   const receipt=manual.closest('.message').querySelector('.note-receipt');
   check((await pc.note(b)).startsWith(before)&&!(await pc.note(b)).includes('A_PERSONAL_NOTE')&&el('tab-chat').classList.contains('active')&&!receipt.querySelector('.note-receipt-view').disabled&&!receipt.querySelector('.note-receipt-undo').disabled&&requests===manualRequests,'manual append after a late read preserves current article content and chat with local saved view and undo feedback');
   ui.querySelector('[data-tab="notes"]').click();
   const launches=[],launch=pc.launchLocalDocument.bind(pc);pc.launchLocalDocument=path=>{launches.push(path);return false;};
   const saved=await pc.files.ensure(b),countBeforeOpen=requests;
   el('note-editor').value=el('note-editor').value+'\nJUST_TYPED_BEFORE_OPEN\n';el('note-editor').dispatchEvent(new win.Event('input',{bubbles:true}));
   el('note-file-open').click();await wait(()=>launches.length===1,'open saved note');
   check(launches[0]===saved.note&&(await IOUtils.readUTF8(saved.note)).includes('JUST_TYPED_BEFORE_OPEN'),'direct note file action flushes typing to its existing Markdown without an export picker');
   el('highlights-file-open').click();await wait(()=>launches.length===2,'open saved summary');el('review-file-open').click();await wait(()=>launches.length===3,'open saved review');
   check(launches[1]===saved.summary&&launches[2]===saved.review&&requests===countBeforeOpen,'both organized document actions open their existing Markdown without generating or exporting anything');
   check(el('note-file-path').textContent===saved.note&&el('highlights-folder-path').textContent===saved.dir,'notes and organized documents expose their actual current save location');pc.launchLocalDocument=launch;
   ui.querySelector('[data-tab="notes"]').click();
   const priorWidth=el('tab-notes').style.width;el('tab-notes').style.width='260px';await Zotero.Promise.delay(80);
   const bounds=el('tab-notes').getBoundingClientRect();
   check(['note-file-open','notes-folder','native-note','export-note'].every(id=>{const r=el(id).getBoundingClientRect();return r.width>0&&r.left>=bounds.left&&r.right<=bounds.right;}),'direct Markdown, folder and copy actions remain inside a 260px notes sidebar');
   el('tab-notes').style.width=priorWidth;
   await activate(a.id);check(el('note-editor').value===own,'quick switching and answer append leave the other personal note unchanged');
   const resumed=new pc.files.constructor(pc);await resumed.init();check((await resumed.ensure(a)).note===(await pc.files.ensure(a)).note,'per-paper note locations remain stable after storage reload');
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:Zotero.version,results},null,2));
  } catch(e) {await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results},null,2));}
  finally {Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){}
function install(){}
function uninstall(){}
