// Disposable native integration: synthetic papers and fake provider responses only.
function startup() {
 Components.utils.importGlobalProperties(['AbortController']);
 (async () => {
  const results=[],output='__OUTPUT__'; let debug=()=>({});
  const check=(v,label)=>{if(!v)throw new Error(label);results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw new Error('Timeout: '+label);};
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');
   await wait(()=>Zotero.PaperCompanion,'startup');const pc=Zotero.PaperCompanion;let requests=0,lastBody;
   pc.request=async(_,{body,onChunk})=>{requests++;lastBody=JSON.parse(body);const text='The controller reduced spill risk [S2]. Unverified [S999].';onChunk('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\n');};
   const add=async(title,path)=>{const parent=new Zotero.Item('journalArticle');parent.setField('title',title);parent.setField('DOI','10.0000/test');await parent.saveTx();const item=await Zotero.Attachments.importFromFile({file:path,parentItemID:parent.id});await Zotero.Reader.open(item.id);return item;};
   const item=await add('Active cup transport','__PDF__');pc.readerID=item.id;await pc.openPanel({readerID:item.id});await wait(()=>pc.panel?.document?.body?.dataset?.ready==='true','sidebar');
   const panel=pc.panel,ui=panel.document,el=id=>ui.getElementById(id),paper=await pc.paperInfo(item.id);
   debug=()=>({requests,notice:el('notice').textContent,reading:el('reading-status').textContent,busy:pc.chatBusy});
   check(requests===0&&pc.reading.memory.size===0&&pc.state==='offline','opening sidebar does not index papers or request a model');
   await pc.saveSettings({chatProvider:'deepseek',autoRecord:false},'fake-reading-test-key');
   await pc.ask(paper.key,'Which controller reduced spill risk?',null);
   let session=await pc.session(paper.key),answer=session.messages.at(-1),body=JSON.stringify(lastBody);
   check(requests===1&&body.includes('PAGE_ONE_MARKER')&&body.includes('PAGE_TWO_MARKER'),'first question automatically reads the short current paper with one model request');
   check(answer.references.length===2&&answer.text.includes(paper.link+'?page=2')&&answer.text.includes('未核实来源 S999'),'answer citations use verified physical pages and unknown source IDs cannot become links');
   const paths=await pc.files.ensure(paper),rawPath=PathUtils.join(paths.dir,'论文原文.md');
   check(await IOUtils.exists(rawPath)&&(await IOUtils.readUTF8(rawPath)).includes('PAGE_TWO_MARKER'),'readable extracted paper text is stored alongside PDF and notes');
   const realPDF=pc.pdf.bind(pc);pc.reading.memory.clear();
   pc.pdf=reader=>{const state=realPDF(reader);return{...state,doc:{numPages:state.doc.numPages,fingerprints:state.doc.fingerprints,getPage(){throw new Error('Unexpected PDF re-extraction');}}};};
   const cached=await pc.reading.load(item.id);check(cached.data.pages.length===2,'unchanged PDF reuses persisted local index without re-extracting pages');pc.pdf=realPDF;
   await pc.ask(paper.key,'Experimental spill risk results',null);
   body=JSON.stringify(lastBody);check(body.includes('PAGE_TWO_MARKER')&&!body.includes('PAGE_ONE_MARKER'),'follow-up sends focused evidence without replaying the old full paper');
   const beforeSearch=requests;const hits=await pc.searchPapers([item.id],'溢出风险');
   check(hits.some(h=>h.page===2)&&requests===beforeSearch,'Chinese academic keywords retrieve matching English source pages without an extra model request');
   check((await pc.searchPapers([item.id],'zzzznomatch')).length===0,'unmatched query reports no source instead of fabricating evidence');
   const before=pc.readerID;await pc.openReference(hits.find(h=>h.page===2));
   await wait(()=>realPDF(pc.allReaders().find(r=>r.itemID===item.id)).page===2,'source navigation');check(pc.readerID===before,'verified reference jumps to its actual Zotero PDF page');
   const other=await add('Passive cup alternative','__OTHER_PDF__');await pc.openPanel({readerID:item.id});await wait(()=>el('paper').value===String(item.id),'return main paper');
   await pc.ask(paper.key,'Compare the two spill control approaches',null,null,{ids:[other.id]});
   session=await pc.session(paper.key);answer=session.messages.at(-1);body=JSON.stringify(lastBody);
   check(body.includes('ALTERNATIVE_STUDY_MARKER')&&new Set(answer.references.map(r=>r.key)).size===2,'multi-paper question includes separately identified evidence from both real attachments');
   const otherPaper=await pc.paperInfo(other.id);check((await pc.session(otherPaper.key)).messages.length===0,'comparison does not merge or overwrite the other paper conversation');
   const manual={id:'manual-reading-test',title:paper.title,label:'Selected original text',text:'MANUAL_CONTEXT_MARKER',mode:'selection'};
   await pc.ask(paper.key,'Explain my selected excerpt',manual);
   body=JSON.stringify(lastBody);check(body.includes('MANUAL_CONTEXT_MARKER')&&!body.includes('ALTERNATIVE_STUDY_MARKER'),'explicit manual material keeps priority and is not replaced by automatic retrieval');
   answer=(await pc.session(paper.key)).messages.at(-1);check(answer.readingScope.sources.manual&&answer.readingScope.sources.primaryActual===false&&answer.readingScope.phase==='prepared','manual-only scope is recorded on the actual response rather than inheriting the local preread or smart-reading setting');
   const beforeCombined=requests;await pc.ask(paper.key,'Experimental spill risk results',manual,null,{includePrimary:true});body=JSON.stringify(lastBody);answer=(await pc.session(paper.key)).messages.at(-1);
   check(requests===beforeCombined+1&&body.includes('MANUAL_CONTEXT_MARKER')&&body.includes('PAGE_TWO_MARKER')&&!body.includes('PAGE_ONE_MARKER'),'explicitly combining this paper keeps the manual excerpt and adds bounded question evidence with only one model request');
   check(answer.readingScope.sources.primaryActual===true&&answer.readingScope.coverage.some(row=>row.kind==='lexical')&&answer.readingScope.sources.preread==='not-used','recorded source scope reflects the actual retrieved page and does not invent a model preread');
   await pc.ask(paper.key,'Compare this excerpt with the other paper',manual,null,{ids:[other.id]});body=JSON.stringify(lastBody);
   check(body.includes('MANUAL_CONTEXT_MARKER')&&body.includes('ALTERNATIVE_STUDY_MARKER'),'manual context and selected comparison papers can be used together');
   answer=(await pc.session(paper.key)).messages.at(-1);check(answer.readingScope.sources.primaryActual===false&&answer.readingScope.sources.actualComparisonIDs.includes(other.id),'manual plus comparison scope identifies the selected other paper without silently adding the current primary');
   el('reading-open').click();await wait(()=>el('reading-dialog').open,'reading dialog');
   check(el('reading-papers').querySelectorAll('input').length===2,'reading dialog lists current and other open PDFs');
   const extra=[...el('reading-papers').querySelectorAll('input')].find(n=>!n.disabled);extra.click();
   check(el('reading-scope').textContent.includes('2'),'comparison scope is visible before sending');
   el('reading-query').value='passive cup';el('reading-search').click();await wait(()=>el('reading-results').textContent.includes('passive cup lid'),'local source search UI');
   check(el('reading-results').querySelectorAll('.source-card').length>0,'source search displays original excerpts with jump and note actions');
   const notesBefore=await pc.note(paper);const sourceCard=[...el('reading-results').querySelectorAll('.source-card')].find(card=>card.textContent.includes('passive cup lid'));sourceCard.querySelector(':scope > button:nth-of-type(2)').click();await wait(()=>el('note-editor').value.includes('passive cup lid')&&sourceCard.querySelector('.note-receipt')?.dataset.status==='saved','excerpt notes');
   check(el('reading-dialog').open&&sourceCard.querySelector('.note-receipt-view')&&sourceCard.querySelector('.note-receipt-undo'),'source excerpt preserves reading dialog and exposes saved view and safe undo actions');
   check((await pc.note(paper)).startsWith(notesBefore)&&el('note-editor').value.includes('passive cup lid')&&!el('note-editor').value.includes(otherPaper.link),'cross-paper excerpt appends the selected content without automatic source text');
   el('reading-close').click();ui.querySelector('[data-tab="chat"]').click();el('prompt').value='Compare both papers briefly';el('send').click();await wait(()=>!pc.chatBusy&&el('messages').textContent.includes('本轮提供的原文'),'comparison send UI');
   check(el('messages').querySelector('.message-sources .source-card'),'answers expose their actual supplied original passages');
   const citation=[...el('messages').querySelectorAll('.message-body a')].find(a=>a.getAttribute('href')===paper.link+'?page=2');
   check(!!citation,'inline source links retain valid Zotero URLs in the native renderer');citation.click();await wait(()=>realPDF(pc.allReaders().find(r=>r.itemID===item.id)).page===2,'inline citation navigation');
   check(requests===7,'clicking an inline citation jumps locally without requesting a model');
   const modelRequests=requests,realPrepare=pc.reading.prepare.bind(pc.reading);let pending=false;
   pc.reading.prepare=(_id,_q,{signal})=>new Promise((_resolve,reject)=>{pending=true;signal.addEventListener('abort',()=>reject(new Error('已停止论文读取。')),{once:true});});
   el('clear-context').click();el('prompt').value='CANCEL_READING_MARKER';el('send').click();await wait(()=>pending,'reading in progress');el('stop').click();await wait(()=>!pc.chatBusy&&el('prompt').value==='CANCEL_READING_MARKER','cancel preserves draft');
   check(requests===modelRequests,'stopping local reading preserves the question and makes no model request');pc.reading.prepare=realPrepare;
   const originalIndex=await IOUtils.readUTF8(PathUtils.join(paths.meta,'reading-index.json'));
   pc.pdf=reader=>{const state=realPDF(reader);return{...state,doc:{numPages:2,fingerprints:state.doc.fingerprints,getPage:async()=>({getTextContent:async()=>({items:[]})})}};};
   let scanError=false;try{await pc.reading.load(item.id,undefined,true);}catch(e){scanError=e.message.includes('扫描 PDF');}pc.pdf=realPDF;
   check(scanError&&(await IOUtils.readUTF8(PathUtils.join(paths.meta,'reading-index.json')))===originalIndex,'unreadable scan fails clearly and preserves previous index without provider fallback');
   el('reading-open').click();await wait(()=>el('reading-dialog').open,'reopen reading');
   el('reading-dialog').style.width='260px';await Zotero.Promise.delay(250);
   check(el('reading-dialog').scrollWidth<=el('reading-dialog').clientWidth+1,'reading controls fit a 260px panel');
   const canvas=ui.createElement('canvas');canvas.width=panel.innerWidth;canvas.height=panel.innerHeight;canvas.getContext('2d').drawWindow(panel,0,0,canvas.width,canvas.height,'white');await IOUtils.write('__SCREENSHOT__',Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,results},null,2));
  }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results},null,2));}
  finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){}
function install(){}
function uninstall(){}
