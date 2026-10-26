// Disposable Zotero integration: real local files, fake PDF and model responses.
function startup() {
 (async()=>{
  const results=[],output='__OUTPUT__';
  const check=(v,label)=>{if(!v)throw new Error(label);results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw new Error('Timeout: '+label);};
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
   const pc=Zotero.PaperCompanion;let requests=0;
   pc.request=async()=>{requests++;return {choices:[{message:{content:'- NEW_SUMMARY_REVIEW_MARKER'},finish_reason:'stop'}]};};
   const parent=new Zotero.Item('journalArticle');parent.setField('title','Article A');await parent.saveTx();
   const attachment=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});
   const paper=await pc.paperFromKey(attachment.libraryID+'_'+attachment.key),source=await pc.pdfSource(paper);
   const legacyNote=PathUtils.join(pc.notesDir,paper.key+'.md'),legacySummary=PathUtils.join(pc.insights.dir,paper.key+'.md'),legacyReview=PathUtils.join(pc.insights.dir,paper.key+'.review.md');
   await pc.writeText(legacyNote,'# LEGACY_NOTE\r\n\r\nOriginal note.');await pc.writeText(legacySummary,'# LEGACY_SUMMARY');await pc.writeText(legacyReview,'# LEGACY_REVIEW');
   await pc.writeJSON(PathUtils.join(pc.insights.dir,paper.key+'.json'),{entries:[{id:'legacy-entry',at:'2026-10-20',source:'test',model:'fake',markdown:'LEGACY_POINT'}]});
   await pc.writeJSON(PathUtils.join(pc.insights.dir,paper.key+'.review.json'),{text:'# LEGACY_REVIEW',sourceHash:'old',promptHash:'old'});
   const oldBackups=PathUtils.join(pc.notesDir,'backups');await IOUtils.makeDirectory(oldBackups,{ignoreExisting:true});await pc.writeText(PathUtils.join(oldBackups,paper.key+'-old.md'),'BACKUP_MARKER');
   await Zotero.Reader.open(attachment.id);await pc.openPanel({readerID:attachment.id});await wait(()=>pc.panel?.document?.body?.dataset?.ready==='true','sidebar');
   const ui=pc.panel.document,original=await pc.files.ensure(paper);
   check(requests===0,'folder creation and legacy migration never request a model');
   check(PathUtils.parent(original.dir)===PathUtils.parent(source)&&PathUtils.filename(original.dir)==='Article A','default folder is named after paper beside original PDF');
   const bytes=await IOUtils.read(source),copy=await IOUtils.read(original.pdf);check(bytes.length===copy.length&&bytes.every((b,i)=>b===copy[i]),'folder contains byte-identical PDF copy and original stays in place');
   check((await IOUtils.readUTF8(original.note))===(await IOUtils.readUTF8(legacyNote))&&(await IOUtils.readUTF8(original.summary))==='# LEGACY_SUMMARY'&&(await IOUtils.readUTF8(original.review))==='# LEGACY_REVIEW','all three legacy Markdown files migrate exactly');
   check((await pc.readJSON(original.summaryData,{})).entries[0].id==='legacy-entry'&&(await pc.readJSON(original.reviewData,{})).promptHash==='old','migration preserves per-paper dedupe and review metadata');
   check((await IOUtils.readUTF8(PathUtils.join(original.backups,paper.key+'-old.md')))==='BACKUP_MARKER','legacy note backup moves with paper by copying');
   check(ui.getElementById('note-preview').textContent.includes('LEGACY_NOTE'),'migrated note remains directly readable and editable in sidebar');
   ui.getElementById('note-editor').value='# EDITED_BEFORE_MOVE';ui.getElementById('note-editor').dispatchEvent(new pc.panel.Event('input',{bubbles:true}));await pc.flushNotes();
   check((await IOUtils.readUTF8(original.note)).includes('EDITED_BEFORE_MOVE'),'direct edits save in paper folder');
   const custom=PathUtils.join(PathUtils.parent(output),'custom');await IOUtils.makeDirectory(custom,{ignoreExisting:true});
   const choose=pc.choosePaperFolder.bind(pc);pc.choosePaperFolder=(p)=>pc.changePaperFolder(p,custom);
   ui.querySelector('[data-tab="settings"]').click();ui.getElementById('paper-folder-change').click();await wait(()=>pc.files.locations[paper.key].dir.startsWith(custom)&&!pc.files.changing.has(paper.key),'change location button');
   pc.choosePaperFolder=choose;const moved=await pc.files.ensure(paper);await wait(()=>ui.getElementById('paper-folder-path').textContent===moved.dir,'location display');
   check((await IOUtils.readUTF8(moved.note))===(await IOUtils.readUTF8(original.note))&&(await IOUtils.readUTF8(moved.review))==='# LEGACY_REVIEW','settings change-location action copies all current documents');
   check(await IOUtils.exists(original.pdf)&&await IOUtils.exists(legacyNote)&&await IOUtils.exists(original.note),'relocation deletes no original PDF, legacy note, or previous folder');
   const another=PathUtils.join(PathUtils.parent(output),'another');await IOUtils.makeDirectory(another,{ignoreExisting:true});
   const create=pc.files.create.bind(pc.files);let release,started;const gate=new Promise(r=>release=r),running=new Promise(r=>started=r);
   pc.files.create=async(...args)=>{started();await gate;return create(...args);};
   const moving=pc.changePaperFolder(paper,another);await running;
   ui.getElementById('note-editor').value='# TYPED_DURING_MOVE';ui.getElementById('note-editor').dispatchEvent(new pc.panel.Event('input',{bubbles:true}));const writing=pc.flushNote(paper.key);
   let blocked=false;try{await pc.insights.enqueue(paper.key,{question:'q',answer:'a'},{manual:true});}catch(e){blocked=e.message.includes('正在更改');}
   check(blocked&&requests===0,'new model summarization is blocked during folder change');release();await moving;await writing;pc.files.create=create;
   const current=await pc.files.ensure(paper);check((await IOUtils.readUTF8(current.note)).includes('TYPED_DURING_MOVE')&&!(await IOUtils.readUTF8(moved.note)).includes('TYPED_DURING_MOVE'),'typing during relocation waits and persists to new location without losing edits');
   await pc.saveSettings({chatProvider:'deepseek'},'fake-local-storage-key');const session=await pc.session(paper.key);session.messages.push({role:'user',text:'new question',status:'complete',at:1},{role:'assistant',text:'new answer',status:'complete',at:2,provider:'deepseek'});await pc.saveSession(paper.key);
   await pc.insights.manualUpdate(paper);await pc.insights.review(paper);
   check((await IOUtils.readUTF8(current.summary)).includes('NEW_SUMMARY_REVIEW_MARKER')&&(await IOUtils.readUTF8(current.review)).includes('NEW_SUMMARY_REVIEW_MARKER'),'both model-maintained Markdown files continue writing at selected location');
   check(!(await IOUtils.readUTF8(moved.summary)).includes('NEW_SUMMARY_REVIEW_MARKER'),'previous folder stops receiving later summary changes');
   const restored=await pc.choosePaperFolder(paper,true);
   check(PathUtils.parent(restored.dir)===PathUtils.parent(source)&&restored.dir!==original.dir&&(await IOUtils.readUTF8(restored.note)).includes('TYPED_DURING_MOVE'),'restore-default action returns beside source PDF while preserving existing same-name folder');
   const resumed=new pc.files.constructor(pc);await resumed.init();check((await resumed.ensure(paper)).dir===restored.dir,'saved per-paper folder survives storage reinitialization');
   const defaultPicker=pc.choosePaperFolder;pc.choosePaperFolder=async()=>null;const prior=pc.files.locations[paper.key].dir;ui.getElementById('paper-folder-change').click();await Zotero.Promise.delay(100);pc.choosePaperFolder=defaultPicker;check(pc.files.locations[paper.key].dir===prior,'cancelling location picker preserves current path');
   await wait(()=>ui.getElementById('paper-folder-path').textContent===restored.dir,'restored path display');ui.getElementById('tab-settings').style.width='260px';await Zotero.Promise.delay(50);
   const box=ui.getElementById('tab-settings').getBoundingClientRect();check(['paper-folder-change','paper-folder-open','paper-folder-default'].every(id=>{const r=ui.getElementById(id).getBoundingClientRect();return r.left>=box.left&&r.right<=box.right;}),'folder controls fit a 260px sidebar');
   const parent2=new Zotero.Item('journalArticle');parent2.setField('title','Unreadable folder test');await parent2.saveTx();const attachment2=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent2.id});
   const blockedKey=attachment2.libraryID+'_'+attachment2.key,ensure=pc.files.ensure.bind(pc.files);pc.files.ensure=p=>p.key===blockedKey?Promise.reject(new Error('Simulated folder permission error')):ensure(p);
   await Zotero.Reader.open(attachment2.id);try{await pc.openPanel({readerID:attachment2.id});}catch(_){}
   const blockedUI=pc.panel.document;check(blockedUI.getElementById('note-preview').getAttribute('contenteditable')==='false'&&!blockedUI.getElementById('note-preview').textContent.includes('TYPED_DURING_MOVE'),'failed paper-folder read clears and disables previous paper note to prevent accidental overwrite');
   pc.files.ensure=ensure;const recover=pc.choosePaperFolder.bind(pc);pc.choosePaperFolder=p=>pc.changePaperFolder(p,custom);blockedUI.querySelector('[data-tab="settings"]').click();blockedUI.getElementById('paper-folder-change').click();await wait(()=>!!pc.files.locations[blockedKey]&&!pc.files.changing.has(blockedKey)&&blockedUI.getElementById('note-preview').getAttribute('contenteditable')==='true','recover through folder settings');pc.choosePaperFolder=recover;
   check(!blockedUI.getElementById('note-editor').disabled&&blockedUI.getElementById('note-preview').textContent.includes('Unreadable folder test'),'choosing a writable location restores direct editing after initial location error');
   try{const win=pc.panel,canvas=ui.createElement('canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;ui.getElementById('tab-settings').scrollTop=0;canvas.getContext('2d').drawWindow(win,0,0,canvas.width,canvas.height,'white');await IOUtils.write('__SCREENSHOT__',Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));}catch(e){results.push('Screenshot unavailable: '+e.message);}
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:Zotero.version,platform:'Windows',results},null,2));
  }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,results},null,2));}
  finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){}
function install(){}
function uninstall(){}
