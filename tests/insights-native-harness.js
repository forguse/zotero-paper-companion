// Disposable native test only. Uses fake model responses and an isolated profile.
function startup() {
 (async () => {
  const results=[], output='__OUTPUT__';
  const check=(value,label)=>{if(!value)throw new Error(label);results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw new Error('Timeout: '+label);};
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');
   await wait(()=>Zotero.PaperCompanion,'plugin startup');const pc=Zotero.PaperCompanion;
   let requests=0,reviewRequests=0,reviewInput='';const instructions=[];
   pc.request=async(_,{body})=>{requests++;const data=JSON.parse(body),review=data.messages[0].content===pc.insights.prompt('review');instructions.push(data.messages[0].content);if(review){reviewRequests++;reviewInput=data.messages[1].content;}return {choices:[{message:{content:review?'- REVIEW_MARKER: grouped concepts and open questions.':'- SUMMARY_MARKER: concise scientific result.'},finish_reason:'stop'}]};};
   const parent=new Zotero.Item('journalArticle');parent.setField('title','Two-stage summary test');await parent.saveTx();
   const attachment=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});const reader=await Zotero.Reader.open(attachment.id);pc.readerID=reader.itemID;
   await pc.openPanel();await wait(()=>pc.panel?.document?.body?.dataset?.ready==='true','sidebar ready');
   const paper=await pc.paper(),ui=pc.panel.document;
   check(requests===0&&pc.state==='offline','startup and sidebar do not request a model');
   check(!pc.insights.enabled(paper.key)&&!ui.getElementById('highlights-now').disabled,'manual summary button available while automation is off');
   ui.querySelector('[data-tab="highlights"]').click();
   await pc.saveSettings({chatProvider:'deepseek'},'fake-native-test-key');
   const session=await pc.session(paper.key);
   session.messages.push({role:'user',text:'RAW_QUESTION',status:'complete',at:1},{role:'assistant',text:'RAW_ANSWER',status:'complete',at:2,provider:'deepseek'});await pc.saveSession(paper.key);
   ui.getElementById('jump-highlights').click();ui.getElementById('highlights-now').click();
   await wait(()=>requests===1&&!pc.insights.jobs.has(paper.key)&&!pc.insights.manualJobs.has(paper.key)&&ui.getElementById('highlights-document').textContent.includes('SUMMARY_MARKER'),'manual first document');
   const first=await IOUtils.readUTF8((await pc.files.ensure(paper)).summary);
   check(first.includes('SUMMARY_MARKER')&&!pc.insights.enabled(paper.key),'manual summary persists without enabling automation');
   check(!(await IOUtils.readUTF8((await pc.files.ensure(paper)).review)).includes('REVIEW_MARKER')&&reviewRequests===0,'first update never generates the review');
   check(!ui.getElementById('highlights-now').disabled,'manual button becomes available after completion');
   ui.getElementById('jump-review').click();ui.getElementById('review-now').click();
   await wait(()=>reviewRequests===1&&!pc.insights.reviewJobs.has(paper.key)&&ui.getElementById('review-document').textContent.includes('REVIEW_MARKER'),'review button');
   check(reviewInput===first&&!reviewInput.includes('RAW_QUESTION')&&!reviewInput.includes('RAW_ANSWER'),'review receives only first-document content');
   const second=await IOUtils.readUTF8((await pc.files.ensure(paper)).review);
   check(second.includes('REVIEW_MARKER')&&(await IOUtils.readUTF8((await pc.files.ensure(paper)).summary))===first,'review persists separately without changing first document');
   ui.getElementById('jump-review').click();ui.getElementById('review-now').click();await wait(()=>!pc.insights.reviewJobs.has(paper.key)&&ui.getElementById('review-status').textContent.includes('未调用模型'),'unchanged review');
   check(requests===2,'unchanged first document skips model request');
   session.messages.push({role:'user',text:'NEW_QUESTION',status:'complete',at:3},{role:'assistant',text:'NEW_ANSWER',status:'complete',at:4,provider:'deepseek'});await pc.saveSession(paper.key);
   ui.getElementById('jump-highlights').click();ui.getElementById('highlights-now').click();await wait(()=>requests===3&&!pc.insights.manualJobs.has(paper.key)&&!ui.getElementById('review-stale').hidden,'stale review notice');
   check(reviewRequests===1&&(await IOUtils.readUTF8((await pc.files.ensure(paper)).review))===second,'new chat summary marks review stale without regenerating it');
   ui.getElementById('jump-review').click();ui.getElementById('review-now').click();await wait(()=>reviewRequests===2&&!pc.insights.reviewJobs.has(paper.key)&&ui.getElementById('review-stale').hidden,'refresh stale review');
   check(!pc.insights.enabled(paper.key),'both manual operations leave automatic maintenance disabled');
   ui.getElementById('highlights-enabled').click();await wait(()=>pc.insights.enabled(paper.key),'enable automatic maintenance');
   const before=requests;
   session.messages.push({role:'user',text:'AUTO_QUESTION',status:'complete',at:5},{role:'assistant',text:'AUTO_ANSWER',status:'complete',at:6,provider:'deepseek'});
   await pc.insights.enqueue(paper.key,{id:'6',source:'deepseek',question:'AUTO_QUESTION',answer:'AUTO_ANSWER'});
   check(requests===before+1&&reviewRequests===2,'automatic maintenance updates only the first document');
   ui.getElementById('highlights-enabled').click();await wait(()=>!pc.insights.enabled(paper.key),'disable automatic maintenance');
   const parent2=new Zotero.Item('journalArticle');parent2.setField('title','Other paper');await parent2.saveTx();
   const attachment2=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent2.id});await Zotero.Reader.open(attachment2.id);pc.readerID=attachment2.id;
   await pc.openPanel({readerID:attachment2.id});const other=await pc.paper(attachment2.id);
   check(!pc.insights.enabled(other.key)&&!(await pc.insights.readReview(other)).text.includes('REVIEW_MARKER'),'another paper has its own documents and automatic setting');
   await pc.openPanel({readerID:attachment.id});await wait(()=>pc.panel.document.getElementById('review-document').textContent.includes('REVIEW_MARKER'),'return to first paper');
   const doc=pc.panel.document;doc.querySelector('[data-tab="highlights"]').click();
   doc.getElementById('tab-highlights').style.width='260px';
   await Zotero.Promise.delay(100);
   const pane=doc.getElementById('tab-highlights'),bounds=pane.getBoundingClientRect();
   for(const [jump,ids] of [['jump-highlights',['highlights-now','highlights-export']],['jump-review',['review-now','review-export']]]){doc.getElementById(jump).click();await Zotero.Promise.delay(100);check(ids.every(id=>{const r=doc.getElementById(id).getBoundingClientRect();return r.width>0&&r.left>=bounds.left&&r.right<=bounds.right;}),'visible '+jump+' action row fits a 260px sidebar');}
   await pc.insights.review(paper);
   await wait(()=>doc.getElementById('review-stale').hidden,'latest review before prompt edits');
   doc.querySelector('[data-tab="settings"]').click();
   check(doc.getElementById('summary-prompt').value===pc.insights.defaultPrompt('summary')&&doc.getElementById('review-prompt').value===pc.insights.defaultPrompt('review'),'settings show two separate editable default prompts');
   const promptCount=requests,customSummary='CUSTOM_SUMMARY_PROMPT：只总结研究假设和结论。',customReview='你是论文阅读省察助手。CUSTOM_REVIEW_PROMPT：按概念关系整理。';
   const edit=(id,value)=>{doc.getElementById(id).value=value;doc.getElementById(id).dispatchEvent(new pc.panel.Event('input',{bubbles:true}));};
   edit('summary-prompt',customSummary);edit('review-prompt',customReview);
   await pc.saveSettings({language:'English'});
   check(doc.getElementById('summary-prompt').value===customSummary&&doc.getElementById('review-prompt').value===customReview,'unrelated setting updates preserve unsaved prompt drafts');
   doc.getElementById('save-summary-prompts').click();await wait(()=>pc.settings.summaryPrompt===customSummary&&pc.settings.reviewPrompt===customReview&&doc.getElementById('summary-prompts-status').textContent.includes('当前提示词已生效'),'save prompts');
   const saved=await pc.readJSON(PathUtils.join(pc.dir,'settings.json'),{});
   check(saved.summaryPrompt===customSummary&&saved.reviewPrompt===customReview&&requests===promptCount,'both custom prompts persist in settings without model calls');
   await wait(()=>!doc.getElementById('review-stale').hidden,'prompt stale marker');
   check((await pc.insights.readReview(paper)).stale,'changing the review prompt alone marks saved review stale');
   const reviewBefore=reviewRequests;doc.querySelector('[data-tab="highlights"]').click();doc.getElementById('jump-review').click();doc.getElementById('review-now').click();
   await wait(()=>reviewRequests===reviewBefore+1&&!pc.insights.reviewJobs.has(paper.key)&&doc.getElementById('review-stale').hidden,'custom review prompt');
   check(instructions.at(-1)===customReview,'review button sends saved custom review prompt even when source is unchanged');
   const summaryBefore=requests;
   session.messages.push({role:'user',text:'PROMPT_QUESTION',status:'complete',at:7},{role:'assistant',text:'PROMPT_ANSWER',status:'complete',at:8,provider:'deepseek'});await pc.saveSession(paper.key);
   doc.getElementById('jump-highlights').click();doc.getElementById('highlights-now').click();await wait(()=>requests===summaryBefore+1&&!pc.insights.manualJobs.has(paper.key),'custom first prompt');
   check(instructions.at(-1)===customSummary&&reviewRequests===reviewBefore+1,'first-document update uses only its own custom prompt and preserves the review');
   doc.querySelector('[data-tab="settings"]').click();
   doc.getElementById('summary-prompt-reset').click();doc.getElementById('review-prompt-reset').click();
   check(doc.getElementById('summary-prompt').value===pc.insights.defaultPrompt('summary')&&doc.getElementById('review-prompt').value===pc.insights.defaultPrompt('review')&&pc.settings.summaryPrompt===customSummary&&pc.settings.reviewPrompt===customReview,'restore default buttons change drafts only until saved');
   const resetCount=requests;doc.getElementById('save-settings').click();await wait(()=>pc.settings.summaryPrompt===pc.insights.defaultPrompt('summary')&&pc.settings.reviewPrompt===pc.insights.defaultPrompt('review'),'save default prompts');
   check(requests===resetCount&&(await pc.readJSON(PathUtils.join(pc.dir,'settings.json'),{})).reviewPrompt===pc.insights.defaultPrompt('review'),'general save settings also saves both prompt fields without a model call');
   edit('summary-prompt','   ');doc.getElementById('save-summary-prompts').click();await wait(()=>doc.getElementById('notice').textContent.includes('提示词不能为空'),'reject blank prompt');
   check(pc.settings.summaryPrompt===pc.insights.defaultPrompt('summary')&&requests===resetCount,'blank prompt is rejected without replacing saved settings or requesting a model');
   doc.getElementById('summary-prompt-reset').click();doc.getElementById('save-summary-prompts').click();await wait(()=>doc.getElementById('summary-prompts-status').textContent.includes('当前提示词已生效'),'restore after validation');
   doc.getElementById('tab-settings').style.width='260px';await Zotero.Promise.delay(80);
   const settingsBounds=doc.getElementById('tab-settings').getBoundingClientRect();
   check(['summary-prompt','review-prompt','summary-prompt-reset','review-prompt-reset','save-summary-prompts'].every(id=>{const r=doc.getElementById(id).getBoundingClientRect();return r.left>=settingsBounds.left&&r.right<=settingsBounds.right;}),'prompt editors and buttons fit a 260px sidebar');
   doc.querySelector('.summary-prompts').scrollIntoView();
   try { const win=pc.panel,canvas=doc.createElement('canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;canvas.getContext('2d').drawWindow(win,0,0,canvas.width,canvas.height,'white');await IOUtils.write('__SCREENSHOT__',Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0))); } catch(e) { results.push('Screenshot unavailable: '+e.message); }
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:Zotero.version,platform:Zotero.isWin?'Windows':'other',results},null,2));
  } catch(e) { await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,results},null,2)); }
  finally { Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); }
 })();
}
function shutdown(){}
function install(){}
function uninstall(){}
