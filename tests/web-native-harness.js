// Disposable remote-browser integration: synthetic papers and local HTML only.
// Real ChatGPT accounts, network submission and the system clipboard are unused.
var testChrome;
function startup({ rootURI }) {
 testChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup).registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-test','content/']]);
 (async()=>{
  const results=[],output='__OUTPUT__',shots=[],navigations=[],events=[];let debug=()=>({}),captureFailure=async()=>{};
  const check=(value,label,detail)=>{if(!value)throw Error(label+' '+JSON.stringify(detail||''));results.push(label);};
  const pause=ms=>Zotero.Promise.delay(ms??120);
  const wait=async(fn,label,timeout=15000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await fn())return;await pause(50);}throw Error('Timeout: '+label);};
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'startup');
   const pc=Zotero.PaperCompanion;Zotero.getMainWindow().resizeTo(1300,1050);let network=0,copied='';pc.request=()=>{network++;throw Error('Unexpected model request');};pc.copy=text=>{copied=text;};
   const parent=new Zotero.Item('journalArticle');parent.setField('title','Background webpage conversation fixture');await parent.saveTx();
   const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id}),reader=await Zotero.Reader.open(item.id),paper=await pc.paperInfo(item.id),key=paper.key;
   await wait(()=>{try{return !!pc.pdf(reader).doc;}catch(_){return false;}},'real PDF document ready');
   await pc.openPanel({readerID:item.id});await wait(()=>pc.panel?.document?.body?.dataset.ready==='true','panel');
   const win=pc.panel,ui=win.document,el=id=>ui.getElementById(id);check(pc.panels.has(win),'the native conversation window is registered with the platform');
   const frame=win.frameElement,auditWidth=Math.min(380,win.innerWidth);if(frame){frame.style.width=auditWidth+'px';await wait(()=>win.innerWidth===auditWidth,'native audit viewport');}
   const capture=async(name)=>{await ui.fonts.ready;await pause(40);const c=ui.createElement('canvas');c.width=win.innerWidth;c.height=win.innerHeight;c.getContext('2d').drawWindow(win,0,0,c.width,c.height,'white');const path=name==='panel'?'__SCREENSHOT__':PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),character=>character.charCodeAt(0)));shots.push(path);};
   captureFailure=()=>capture('failure-state');
   await pc.saveSettings({smartReading:false,autoRecord:false,chatOptionsCollapsed:true});el('provider').value='chatgpt-web';el('provider').dispatchEvent(new win.Event('change',{bubbles:true}));await wait(()=>pc.settings.chatProvider==='chatgpt-web'&&!el('messages').querySelector('.engine-choice'),'native webpage provider selection');
   const view=pc.web.create(win,el('web-host'));check(!view.opened&&!view.presentationTimer&&network===0,'selecting webpage mode does not open a website or start a watcher');
   check(!el('messages').hidden&&!el('web-connection-bar').hidden&&el('send').textContent.includes('发送'),'webpage mode starts with the same native messages and Send control as API mode');
   await capture('01-native-before-website-open');
   ChromeUtils.importESModule('chrome://paper-companion-test/content/WebTestChild.sys.mjs');
   ChromeUtils.registerWindowActor('PaperCompanionWebTest',{allFrames:false,matches:['file:///*'],child:{esModuleURI:'chrome://paper-companion-test/content/WebTestChild.sys.mjs'}});
   const {E10SUtils}=ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs');
   const fixture=Zotero.File.pathToFileURI('__WEB_FIXTURE__'),remoteType=E10SUtils.getRemoteTypeForURI(fixture,true,false,E10SUtils.DEFAULT_REMOTE_TYPE,null,E10SUtils.predictOriginAttributes({browser:view.browser}));
   if(view.browser.remoteType!==remoteType){view.browser.setAttribute('remote','true');view.browser.setAttribute('remoteType',remoteType);view.browser.changeRemoteness({remoteType});view.browser.construct();}
   view.browser.loadURI(Services.io.newURI(fixture),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
   await wait(()=>view.browser.browsingContext.currentWindowGlobal?.documentURI?.spec===fixture,'remote fixture');
   const actor=view.browser.browsingContext.currentWindowGlobal.getActor('PaperCompanionWebTest');await actor.sendQuery('status');
   let denied=false;try{pc.web.actor(win);}catch(_){denied=true;}check(denied,'production bridge still rejects non-ChatGPT origins');
   const actualActor=pc.web.actor.bind(pc.web);pc.web.actor=target=>target===win?actor:actualActor(target);view.opened=true;pc.web.watchPresentation(win);
   const inspect=()=>actor.sendQuery('inspect'),status=()=>actor.sendQuery('status');let inspected=await inspect();
   debug=async()=>({bridge:await actor.sendQuery('bridge-debug'),inspected:await inspect(),network,notice:el('notice').textContent,webDetail:el('web-status-message')?.textContent,prompt:el('prompt').value,inspector:el('web-pane').dataset.inspect,chatBusy:pc.chatBusy,webState:el('web-bridge-status').textContent,inspected,events:events.slice(-8),navigations});
   pc.subscribe(event=>{if(['webStatus','webReplyComplete','error'].includes(event.type)){events.push({type:event.type,key:event.key,state:event.state,message:event.message});if(events.length>40)events.shift();}});
   // Preserve the explicit manual handoff, including older and modern editors.
   await pc.web.syncPresentation(win);await wait(async()=>{inspected=await inspect();return inspected.collapsed;},'compact text branch');
   await pc.web.fill(win,'MANUAL_DRAFT_ONLY',null);inspected=await inspect();
   check(inspected.draft.includes('Existing draft')&&inspected.draft.includes('MANUAL_DRAFT_ONLY')&&inspected.sends==='0','manual draft action appends without submitting');
   await actor.sendQuery('modern');await pc.web.syncPresentation(win);await pc.web.fill(win,'MODERN_MANUAL_DRAFT',null);inspected=await inspect();
   check(inspected.editorID==='modern-web-editor'&&inspected.hiddenDraft==='HIDDEN_LEGACY_DRAFT'&&inspected.draft.includes('MODERN_MANUAL_DRAFT'),'manual handoff finds the modern editor while preserving a hidden legacy field');
   await actor.sendQuery('replace-editor');await pause();await pc.web.fill(win,'AFTER_EDITOR_REPLACEMENT',null);inspected=await inspect();
   check(inspected.draft.includes('SPA_DRAFT')&&inspected.draft.includes('AFTER_EDITOR_REPLACEMENT'),'manual handoff recovers when the website replaces its editor');
   const image=await pc.extract('page','both',item.id);await pc.web.attach(win,image);inspected=await inspect();
   check(inspected.files.length===1&&inspected.files[0].type==='image/png'&&inspected.sends==='0','explicit manual attachment staging also remains non-submitting');
   // All navigation now stays in the disposable file fixture. Production
   // new/resume methods still execute and their exact target URLs are checked.
   const actualLoad=view.browser.loadURI.bind(view.browser);
   view.browser.loadURI=(uri,options)=>{
    navigations.push(uri.spec);
    if(uri.spec==='https://chatgpt.com/'){actor.sendQuery('bridge-reset',{mode:'stream'}).catch(()=>{});return;}
    if(uri.spec.startsWith('https://chatgpt.com/c/')){actor.sendQuery('bridge-path',{path:uri.spec.slice('https://chatgpt.com'.length).split(/[?#]/)[0]}).catch(()=>{});return;}
    throw Error('Fixture prevented unexpected navigation: '+uri.spec);
   };
   await actor.sendQuery('bridge-reset',{mode:'stream',streamDelay:1100,dynamicSend:true,sendDelay:350});await pc.web.syncPresentation(win);
   inspected=await inspect();check((await status()).composer&&inspected.sendCandidateCount===0&&inspected.voiceVisible,'an empty modern composer exposes only Voice until an actual input event reveals Send');
   const current=()=>pc.session(key),sendQuestion=async(text,{enter=false}={})=>{
    await wait(()=>!pc.chatBusy&&!el('send').disabled,'idle before question');el('prompt').value=text;
    if(enter)el('prompt').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));else el('send').click();
   };
   const complete=async(count,label)=>{await wait(async()=>{const s=await current();return !pc.chatBusy&&s.messages.length===count&&s.messages.at(-1)?.status==='complete';},label);await wait(()=>!el('send').disabled,'UI idle after '+label);return current();};
   const nativeVisible=()=>{const pane=el('web-pane'),style=win.getComputedStyle(pane);return pane.dataset.inspect==='false'&&pane.hasAttribute('inert')&&style.opacity==='0'&&style.pointerEvents==='none'&&!el('messages').hidden&&el('messages').getBoundingClientRect().height>40;};
   const checkStrip=async(label)=>{if(!frame)return;for(const width of [auditWidth,260]){frame.style.width=width+'px';await wait(()=>win.innerWidth===width,width+'px '+label+' viewport');await pause(200);const strip=el('web-connection-bar'),buttons=[...strip.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().width>0);check(strip.scrollWidth<=strip.clientWidth+1&&ui.documentElement.scrollWidth<=win.innerWidth+1&&buttons.every(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=win.innerWidth+1;}),label+' status actions stay inside the '+width+'px sidebar without horizontal overflow');}};
   // Reproduce a missing installed archive without deleting any file. Its
   // chrome alias resolves to one explicitly nonexistent disposable XPI.
   const missingPackage=PathUtils.join(PathUtils.parent(output),'missing-product.xpi');
   check(!await IOUtils.exists(missingPackage),'missing-install fixture begins without an archive and deletes no files');
   const missingChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup).registerChrome(
    Services.io.newURI('jar:'+PathUtils.toFileURI(missingPackage)+'!/manifest.json'),[['content','paper-companion-missing-test','content/']]);
   const originalResourceURL=pc.resourceURL,originalFixtureActor=pc.web.actor;let missingRPCs=0;
   try {
    pc.resourceURL=name=>name==='WebBridgeChild.sys.mjs'?'chrome://paper-companion-missing-test/content/'+name:originalResourceURL.call(pc,name);
    pc.web.actor=target=>{missingRPCs++;return originalFixtureActor(target);};
    const failedAt=Date.now();await sendQuestion('MISSING_INSTALL_UNSENT_QUESTION');
    await wait(()=>!pc.chatBusy&&!el('send').disabled&&el('web-status-message').textContent.includes('重新安装'),'missing archive fails promptly',2000);
    check(Date.now()-failedAt<2000&&missingRPCs===0&&Number((await inspect()).sends)===0,'a missing installed archive fails before website RPC instead of waiting for an acknowledgement');
    check(el('web-bridge-status').textContent.includes('重新安装')&&!el('web-connection-bar').hidden,'the installation repair instruction is visible without opening error details or the website');
    check(el('prompt').value==='MISSING_INSTALL_UNSENT_QUESTION'&&(await current()).messages.length===0&&!el('stop').getBoundingClientRect().height,'missing-install failure restores Send and preserves the unsent question with no local pending turn');
    await capture('00-native-missing-install');
   } finally {pc.resourceURL=originalResourceURL;pc.web.actor=originalFixtureActor;missingChrome.destruct();el('prompt').value='';}
   // Reproduce a cold browser whose status IPC has no reply. The production
   // query timer/cancellation and native Send/Stop handlers still execute.
   const fixtureActor=pc.web.actor;let heldStatus=0,releaseStatus;
   pc.web.actor=target=>target===win?{sendQuery:(action,data)=>action==='status'?(heldStatus++,new Promise(resolve=>{releaseStatus=resolve;})):actor.sendQuery(action,data)}:fixtureActor(target);
   await sendQuestion('COLD_CONNECTION_QUESTION');await wait(()=>pc.web.busy&&heldStatus>0,'cold connection status pending');
   check(el('prompt').value==='COLD_CONNECTION_QUESTION'&&(await current()).messages.length===0&&!el('stop').hidden,'unaccepted cold-start question stays visibly in the native composer');
   await capture('00-native-cold-connection');const stopAt=Date.now();el('stop').click();await wait(()=>!pc.chatBusy&&!el('send').disabled,'Stop cancels pending status IPC',1500);
   check(Date.now()-stopAt<1500&&el('prompt').value==='COLD_CONNECTION_QUESTION'&&(await current()).messages.length===0&&Number((await inspect()).sends)===0,'Stop promptly restores Send and preserves the unsent cold-start draft without website submission');
   releaseStatus(await status());await pause(100);
   check(!pc.chatBusy&&Number((await inspect()).sends)===0,'a late cancelled status reply cannot resume an old Send');
   heldStatus=0;await sendQuestion('COLD_ORIGINAL_QUESTION');await wait(()=>pc.web.busy&&heldStatus>0,'cold connection before next draft');
   el('prompt').value='NEXT_QUESTION_DRAFT';el('prompt').dispatchEvent(new win.Event('input',{bubbles:true}));pc.web.actor=fixtureActor;releaseStatus(await status());
   await complete(2,'accepted original cold question');
   check(el('prompt').value==='NEXT_QUESTION_DRAFT'&&(await current()).messages[0].text==='COLD_ORIGINAL_QUESTION'&&Number((await inspect()).sends)===1,'accepting the original turn preserves newer text typed during webpage preparation');
   el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'reset cold connection test');el('prompt').value='';
   const beforeInspectorSends=Number((await inspect()).sends);
   check(nativeVisible(),'web automation remains rendered in the background without displacing native reading space',debug());
   el('nav-settings').click();el('settings-configure-engine').click();await wait(()=>el('tab-chat').classList.contains('active')&&el('web-pane').dataset.inspect==='true','settings opens actual website inspector');
   check(ui.activeElement===el('web-return')&&!el('web-return').closest('[inert]'),'settings login entry opens a usable website inspector with focused return action');
   const selectionHost=ui.createElement('div');ui.body.append(selectionHost);pc.selectionPopup({reader,doc:ui,params:{annotation:{text:'NATIVE_SELECTED_QUESTION',position:{pageIndex:0}}},append:node=>selectionHost.append(node)});
   selectionHost.firstElementChild.shadowRoot.querySelector('[data-action="ask"]').click();await wait(()=>nativeVisible()&&el('prompt').value.includes('NATIVE_SELECTED_QUESTION'),'selected text returns to native question');
   check(ui.activeElement===el('prompt')&&!el('prompt').closest('[inert]')&&Number((await inspect()).sends)===beforeInspectorSends,'selection Ask reveals and focuses the native draft without submitting behind the inspector');selectionHost.remove();el('prompt').value='';
   await actor.sendQuery('bridge-configure',{mode:'stream',challenge:true});el('chat-preread-open').click();await wait(()=>el('reading-dialog').open,'preread modal');el('preread-start').click();
   await wait(()=>!pc.chatBusy&&!el('reading-dialog').open&&el('web-pane').dataset.inspect==='true','preread interaction returns to website');
   check(!el('reading-dialog').open&&ui.activeElement===el('web-return')&&Number((await inspect()).sends)===beforeInspectorSends,'preread verification failure closes its modal and offers the same usable website inspector');
   el('web-return').click();await actor.sendQuery('bridge-reset',{mode:'stream',streamDelay:1100,dynamicSend:true,sendDelay:350});await pc.web.syncPresentation(win);
   const firstSends=Number((await inspect()).sends);await sendQuestion('PLUGIN_NATIVE_QUESTION');
   await wait(async()=>{const s=await current();return s.messages.at(-1)?.status==='pending'&&s.messages.at(-1)?.text.includes('BRIDGE_STREAM_PARTIAL');},'visible streaming partial');
   check(!el('stop').hidden&&el('prompt').value===''&&nativeVisible(),'pending website reply uses native stop and reading UI without exposing automation');
   const stableControls=['provider','model','account'].map(id=>({node:el(id),options:[...el(id).children]}));el('prompt').focus();
   for(let i=0;i<5;i++)pc.emit('webStatus',{key,state:'streaming',submitted:true});
   check(stableControls.every(({node,options})=>options.length===node.children.length&&options.every((option,index)=>node.children[index]===option))&&ui.activeElement===el('prompt'),'repeated streaming phases preserve option nodes and native typing focus');
   await capture('02-native-streaming');
   let session=await complete(2,'first native webpage answer');inspected=await inspect();const firstAnswer=session.messages[1];
   check(Number(inspected.sends)===firstSends+1&&inspected.lastSubmission.text==='PLUGIN_NATIVE_QUESTION','native Send submits exactly the typed question once');
   check(inspected.voiceClicks==='0'&&inspected.sendCandidateCount===0&&inspected.voiceVisible,'the bridge waits for delayed Send and never clicks Voice; the empty composer returns to Voice after completion');
   check(firstAnswer.provider==='chatgpt-web'&&firstAnswer.webVerified&&session.messages[0].webVerified&&session.webConversation.path==='/c/fixture-conversation'&&!session.webPending,'completed webpage turn is verified and bound to this local paper');
   check(firstAnswer.text.includes('```python')&&firstAnswer.text.includes('answer = 42\n\nprint(answer)')&&firstAnswer.text.includes('$E=mc^2$'),'website DOM returns Markdown lists, code whitespace and TeX source');
   await wait(()=>el('messages').querySelector('.message.assistant pre'),'native rendered answer');
   check(!!el('messages').querySelector('.message.assistant .pc-math .katex'),'website TeX is compiled in the native answer rather than left as delimiters');
   const nativeAnswer=el('messages').querySelector('.message.assistant'),actions=[...nativeAnswer.querySelectorAll('.message-actions button')],copy=actions.find(button=>button.textContent==='复制'),note=actions.find(button=>button.textContent==='记入笔记');
   check(!!copy&&!!note,'web replies provide the same native copy and note actions');copy.click();check(copied===firstAnswer.text,'native Copy receives Markdown rather than webpage UI text');
   note.click();await wait(async()=>(await pc.note(paper)).includes('BRIDGE_FINAL'),'native note insertion');
   check(el('tab-chat').classList.contains('active'),'saving a website answer to notes preserves the chat reading page');
   await capture('03-native-complete-answer');
   await sendQuestion('FOLLOWUP_ONLY',{enter:true});session=await complete(4,'continuous second answer');inspected=await inspect();
   check(Number(inspected.sends)===firstSends+2&&inspected.lastSubmission.text==='FOLLOWUP_ONLY'&&!inspected.lastSubmission.files.length,'Enter continues the bound website chat without re-uploading local history');
   check(session.webConversation.userCount===2&&session.messages[3].webVerified,'continuous turns retain website context and local verified replies');
   // Real local PDF extraction supplies a user-selected page and image. Nothing
   // is handed to the remote fixture until the native Send action.
   const previousExtract=pc.extract.bind(pc);pc.extract=async(mode,...args)=>mode==='page'?image:previousExtract(mode,...args);
   const beforeMaterial=await inspect();el('page').click();await wait(()=>!el('attachment').hidden&&!el('page').disabled,'selected page staged locally');
   inspected=await inspect();check(inspected.changes===beforeMaterial.changes&&inspected.sends===beforeMaterial.sends,'choosing a page keeps its text and image local until Send');
   await actor.sendQuery('bridge-configure',{mode:'stream',uploadDelay:450,streamDelay:900});await sendQuestion('USE_SELECTED_PAGE');session=await complete(6,'selected page answer');inspected=await inspect();
   check(Number(inspected.changes)===Number(beforeMaterial.changes)+1&&inspected.lastSubmission.files.length===1&&inspected.lastSubmission.files[0].type==='image/png','selected image upload is handed off once and completes before sending');
   check(inspected.lastSubmission.text.includes('PAGE_ONE_MARKER')&&!inspected.lastSubmission.text.includes('PAGE_TWO_MARKER'),'automatic materials contain only the selected page text');
   const afterPageChanges=inspected.changes;await sendQuestion('REUSE_SELECTED_PAGE');session=await complete(8,'material reuse answer');inspected=await inspect();
   check(inspected.changes===afterPageChanges&&!inspected.lastSubmission.files.length&&!inspected.lastSubmission.text.includes('PAGE_ONE_MARKER'),'unchanged material is reused from website context without retransmission');
   el('pdf').click();await wait(()=>!el('pdf').disabled&&!el('attachment').hidden&&el('preview-context').textContent.includes('PDF'),'PDF selected locally');
   const beforePDF=await inspect();await sendQuestion('USE_SELECTED_PDF');session=await complete(10,'selected PDF answer');inspected=await inspect();
   check(Number(inspected.changes)===Number(beforePDF.changes)+1&&inspected.lastSubmission.files.length===1&&inspected.lastSubmission.files[0].type==='application/pdf'&&inspected.lastSubmission.files[0].size>100,'explicit original PDF uploads once through the same native question flow');
   pc.extract=previousExtract;
   await capture('panel');
   // A changed website path and a different local paper are never silently bound.
   const beforeWrong=Number(inspected.sends);await actor.sendQuery('bridge-path',{path:'/c/unrelated'});await sendQuestion('DO_NOT_MIX_PATH');
   await wait(()=>!pc.chatBusy&&!el('send').disabled&&el('web-status-message').textContent.includes('切换'),'wrong path feedback');inspected=await inspect();
   check(Number(inspected.sends)===beforeWrong&&el('prompt').value==='DO_NOT_MIX_PATH','a website path mismatch preserves the local question without sending');
   await capture('04-native-conversation-mismatch');
   el('web-resume').click();await wait(async()=>(await status()).conversation==='/c/fixture-conversation'&&!pc.chatBusy&&!el('web-resume').disabled,'resume bound path and finish read-only verification');
   check(navigations.at(-1)==='https://chatgpt.com/c/fixture-conversation','Restore paper invokes only the saved webpage conversation URL');el('prompt').value='';
   const otherParent=new Zotero.Item('journalArticle');otherParent.setField('title','Unrelated paper fixture');await otherParent.saveTx();const other=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:otherParent.id}),otherPaper=await pc.paperInfo(other.id);let mixed=false;
   try{await pc.ask(otherPaper.key,'DO_NOT_MIX_PAPER',null,()=>{},{webWindow:win});}catch(error){mixed=/其他对话|新对话/.test(error.message);}
   check(mixed&&Number((await inspect()).sends)===beforeWrong&&(await pc.session(otherPaper.key)).messages.length===0,'a different paper cannot silently reuse the current website conversation');
   // Inspector is an explicit optional view. Its model/login and return controls
   // are retained even in a narrow sidebar, and return restores native reading.
   await checkStrip('website');
   await pc.saveSettings({webCompactComposer:false});await pc.web.syncPresentation(win);
   el('web-inspect').click();await wait(()=>el('web-pane').dataset.inspect==='true','explicit inspector');
   const back=el('web-return').getBoundingClientRect();check(back.width>0&&back.left>=0&&back.right<=win.innerWidth&&el('web-pane').getAttribute('aria-hidden')==='false','webpage return control is visible and within narrow sidebar bounds');
   if(frame){frame.style.width=auditWidth+'px';await wait(()=>win.innerWidth===auditWidth,'inspector audit viewport');await pause(200);}
   await capture('05-narrow-website-inspector');
   // Optional compositor capture gate: drawWindow cannot include every remote
   // browser surface. Only an explicitly prepared local audit run pauses here.
   const captureGate=PathUtils.join(PathUtils.parent(output),'inspector-capture-gate.txt');
   if(await IOUtils.exists(captureGate)){await IOUtils.writeUTF8(captureGate,'ready');await wait(async()=>(await IOUtils.readUTF8(captureGate))==='continue','inspector compositor capture',90000);}
   el('web-return').click();await wait(nativeVisible,'return native mode');check(ui.activeElement===el('web-inspect'),'returning from the webpage restores the native inspector entry focus');
   if(frame){frame.style.width=auditWidth+'px';await wait(()=>win.innerWidth===auditWidth,'restore audit viewport');await pause();}await pc.saveSettings({webCompactComposer:true});await pc.web.syncPresentation(win);
   el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'native new conversation');
   check(navigations.at(-1)==='https://chatgpt.com/'&&!(await current()).webConversation,'New conversation resets both local and explicit webpage context');
   await actor.sendQuery('bridge-configure',{mode:'stream',streamDelay:600});const beforePreread=Number((await inspect()).sends);await pc.web.preread(win,paper);
   check(Number((await inspect()).sends)===beforePreread+1&&await pc.web.hasPreread(win,paper)&&(await current()).messages.at(-1)?.webVerified&&nativeVisible(),'explicit full-text preread completes in the background and binds reusable context');
   el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'new after preread');
   await actor.sendQuery('bridge-configure',{mode:'stream',draft:'UNSENT_WEBSITE_DRAFT'});await sendQuestion('PRESERVE_LOCAL_QUESTION');await wait(()=>!pc.chatBusy&&!el('send').disabled&&el('web-status-message').textContent.includes('草稿'),'existing draft guard');inspected=await inspect();
   check(el('prompt').value==='PRESERVE_LOCAL_QUESTION'&&inspected.draft==='UNSENT_WEBSITE_DRAFT'&&Number(inspected.sends)===beforePreread+1,'webpage preflight failure preserves both local and unrelated website drafts');
   check(el('web-pane').dataset.inspect==='true','a genuine login/draft interaction problem exposes the inspector rather than losing the question');await capture('06-website-draft-conflict');el('web-return').click();await capture('07-native-preserved-question');el('prompt').value='';
   await actor.sendQuery('bridge-reset',{mode:'stream',dynamicSend:true,missingSend:true});const beforeStage=Number((await inspect()).sends);await sendQuestion('STAGED_ORIGINAL_QUESTION');
   await wait(async()=>!pc.chatBusy&&!!(await current()).webStaged&&!el('send').disabled,'owned unsent stage',25000);session=await current();inspected=await inspect();
   if(el('web-pane').dataset.inspect==='true')el('web-return').click();
   check(Number(inspected.sends)===beforeStage&&inspected.draft==='STAGED_ORIGINAL_QUESTION'&&el('web-connection-bar').dataset.state==='staged'&&!el('web-status-detail').hidden&&!el('web-status-message').hidden&&el('web-resume').textContent==='继续本轮发送'&&!el('web-new-chat').hidden,'a failed pre-Send stage keeps its original draft with persistent Continue and New chat recovery actions');
   await checkStrip('staged recovery');if(frame){frame.style.width=auditWidth+'px';await wait(()=>win.innerWidth===auditWidth,'owned stage audit viewport');}await capture('08-native-owned-unsent-stage');
   el('prompt').value='NEW_UNSENT_LOCAL_DRAFT';await actor.sendQuery('bridge-configure',{mode:'stream',streamDelay:600,dynamicSend:true});el('web-resume').click();session=await complete(2,'explicit owned stage continuation');await wait(()=>!el('web-resume').disabled,'stage recovery controls settled');inspected=await inspect();
   check(Number(inspected.sends)===beforeStage+1&&inspected.lastSubmission.text==='STAGED_ORIGINAL_QUESTION'&&session.messages.length===2&&!session.webStaged&&!session.webPending&&el('prompt').value==='NEW_UNSENT_LOCAL_DRAFT','explicit Continue submits the original owned stage once, updates its existing pair and preserves a different current draft');el('prompt').value='';
   el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'new after stage recovery');
   await actor.sendQuery('bridge-reset',{mode:'never-finish',streamDelay:500});await sendQuestion('STOP_THIS_TURN');await wait(async()=>(await current()).messages.at(-1)?.text.includes('BRIDGE_STREAM_PARTIAL'),'partial before Stop');
   el('stop').click();await wait(()=>!pc.chatBusy&&!el('send').disabled,'stop completion');session=await current();inspected=await inspect();
   check(session.messages.at(-1).status==='cancelled'&&session.messages.at(-1).text.includes('BRIDGE_STREAM_PARTIAL')&&Number(inspected.stops)===1,'native Stop cancels only the matched webpage generation and retains its partial text');
   await capture('09-native-stopped-reply');const sendsAfterStop=Number(inspected.sends);el('web-resume').click();
   await wait(async()=>{const s=await current();return !pc.chatBusy&&!s.webPending&&!s.webConversation?.uncertain&&!el('web-resume').disabled;},'read-only stopped turn reconciliation');
   check(Number((await inspect()).sends)===sendsAfterStop&&(await current()).messages.at(-1).status==='cancelled','checking a stopped matched turn unlocks continuation without resending or promoting the partial answer');
   await actor.sendQuery('bridge-configure',{mode:'stream',streamDelay:600,dynamicSend:true});await sendQuestion('CONTINUE_AFTER_STOP');session=await complete(4,'same website chat after Stop');
   check(Number((await inspect()).sends)===sendsAfterStop+1&&session.messages.at(-1).webVerified,'a new question continues the reconciled website chat without forcing New chat');
   el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'new after recovered continuation');
   // Run the production producer against the newer transcript rows rather
   // than adding legacy role attributes to an otherwise modern fixture.
   await actor.sendQuery('bridge-mobile',{mode:'stream',streamDelay:600,sendDelay:6500});inspected=await inspect();
   check(inspected.mobileComposer&&inspected.editorTag==='textarea'&&inspected.editorInForm&&!inspected.sendDOMPresent&&inspected.sendCandidateCount===0&&inspected.voiceVisible&&(await status()).composer,'empty modern mobile textarea is recognized even though Send is physically absent from the DOM');
   const beforeModern=Number(inspected.sends),modernStart=Date.now();await sendQuestion('MODERN_ROLE_QUESTION_ONE');session=await complete(2,'modern transcript first answer');inspected=await inspect();
   check(Date.now()-modernStart>=6500&&Number(inspected.sends)===beforeModern+1&&inspected.lastSubmission.text==='MODERN_ROLE_QUESTION_ONE','a six-and-a-half-second mobile Send initialization keeps the exact draft and submits only once instead of failing after five seconds');
   await actor.sendQuery('bridge-configure',{mode:'stream',streamDelay:600,dynamicSend:true,modernRoles:true,sendDelay:350});
   check(inspected.legacyRows===0&&inspected.modernRows.length===2&&inspected.modernRows.map(row=>row.role).join(',')==='user,assistant'&&inspected.modernRows.every(row=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id))&&inspected.modernRows[1].complete,'the modern fixture uses only UUID transcript roles and its explicit completion marker');
   check(Number(inspected.sends)===beforeModern+1&&session.webConversation.lastAssistantID===inspected.modernRows[1].id&&session.messages[1].webVerified,'modern transcript identities bind the verified first reply after exactly one Send');
   check(!inspected.sendDOMPresent&&inspected.voiceVisible&&inspected.voiceClicks==='0','the mobile empty composer returns to Voice after the sole delayed Send without retaining a hidden Send fixture');
   await wait(()=>el('messages').querySelector('.message.assistant .message-actions button')&&el('messages').querySelector('.message.assistant pre'),'modern native Markdown');const modernAnswer=session.messages[1],modernCopy=[...el('messages').querySelectorAll('.message.assistant .message-actions button')].find(button=>button.textContent==='复制');modernCopy.click();
   const modernConversation=await actor.sendQuery('conversation');check(copied===modernAnswer.text&&copied.includes('```python')&&copied.includes('$E=mc^2$')&&modernConversation.turns.length===1&&modernConversation.turns[0].question==='MODERN_ROLE_QUESTION_ONE'&&!modernConversation.turns[0].question.includes('Fixture user toolbar'),'modern source text and Markdown copy exclude row toolbar text while preserving code and TeX');
   await sendQuestion('MODERN_ROLE_QUESTION_TWO');session=await complete(4,'modern transcript followup');inspected=await inspect();const modernFollowup=await actor.sendQuery('conversation');
   check(Number(inspected.sends)===beforeModern+2&&inspected.modernRows.length===4&&session.webConversation.userCount===2&&session.webConversation.lastAssistantID===inspected.modernRows[3].id&&session.messages[3].webVerified&&modernFollowup.turns.length===2&&modernFollowup.turns[1].question==='MODERN_ROLE_QUESTION_TWO','modern transcript followup retains the same website context, exact turn pairing and no duplicate Send');
   el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'new after modern transcript checks');
   // This shape was observed in the actual authorized test: there are no
   // legacy role rows, only scoped search units with UUID message identities.
   await actor.sendQuery('bridge-mobile',{mode:'stream',searchUnits:true,streamDelay:2400,sendDelay:350,reply:'SEARCH_UNIT_FINAL'});
   const beforeUnits=Number((await inspect()).sends);await sendQuestion('SEARCH_UNIT_QUESTION');
   await wait(async()=>(await current()).messages.at(-1)?.text.includes('BRIDGE_STREAM_PARTIAL'),'search-unit visible partial');
   const unitCheckpoint=JSON.parse(JSON.stringify((await current()).webPending));
   let unitInfo=await actor.sendQuery('bridge-unit-inspect');
   check(unitInfo.legacy===0&&unitInfo.modern===0&&unitInfo.rows.length===2&&unitInfo.rows[1].copy&&(await status()).streaming,'search-unit partials expose only their real scope, unique UUIDs and turn state even when Copy already exists');
   await pause(1350);check(pc.chatBusy&&(await current()).messages[1].status==='pending','an early Copy control and stable partial do not complete an unfinished search-unit turn');
   session=await complete(2,'search-unit completed answer');unitInfo=await actor.sendQuery('bridge-unit-inspect');
   check(Number((await inspect()).sends)===beforeUnits+1&&session.messages[1].webVerified&&session.webConversation.lastAssistantID===unitInfo.rows[1].id&&unitInfo.rows[1].state==='complete','search-unit Send completes once with the actual assistant identity rather than a synthetic row index');
   check(session.messages[1].text.includes('SEARCH_UNIT_FINAL')&&session.messages[1].text.includes('```python')&&session.messages[1].text.includes('$E=mc^2$')&&!/ChatGPT said:|You said:|Copy/.test(session.messages[1].text),'search-unit Markdown excludes speaker headings and tools while preserving the real response, code and TeX');
   await capture('11-native-search-unit-complete');
   // Reproduce an old reader that persisted the sent path but never found a
   // user ID. Clearing the actor cache must not require another website Send.
   delete unitCheckpoint.userID;unitCheckpoint.conversation='/c/fixture-conversation';
   session.webPending=unitCheckpoint;delete session.webConversation;
   for(const message of session.messages){message.status='failed';delete message.webVerified;}
   session.messages[1].text='';session.messages[1].webUncertain=true;
   await pc.saveSession(key);await actor.sendQuery('bridge-drop-requests');pc.web.chat.status(key,'uncertain',{submitted:true,recoverable:true,error:'Fixture old message discovery failed'});
   const delayedHistory=await actor.sendQuery('bridge-defer-history',{delay:1200});el('web-resume').click();await pause(250);
   check(delayedHistory.userCount===0&&delayedHistory.composer&&pc.web.busy&&(await current()).webPending,'recovery waits for delayed history even when its saved path and composer are already ready');
   session=await complete(2,'read-only search-unit recovery');
   check(Number((await inspect()).sends)===beforeUnits+1&&!session.webPending&&session.messages[1].text.includes('SEARCH_UNIT_FINAL')&&session.messages.every(message=>message.webVerified),'a same-path exact old checkpoint without user ID recovers its existing reply read-only with no second Send');
   await actor.sendQuery('bridge-configure',{mode:'stream',searchUnits:true,streamDelay:650,dynamicSend:true});await sendQuestion('SEARCH_UNIT_FOLLOWUP');session=await complete(4,'search-unit continuous followup');
   check(Number((await inspect()).sends)===beforeUnits+2&&session.webConversation.userCount===2&&session.messages[3].webVerified&&(await actor.sendQuery('conversation')).turns.length===2,'search-unit followups remain bound to the same verified website conversation without duplicate submissions');
   el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'new after search-unit checks');
   // These controls deliberately omit every old id/data-testid. Resolve the
   // current chat form rather than assuming its text branch owns the toolbar.
   for(const variant of [{layout:'sibling',sendLabel:'Send'},{layout:'associated',sendLabel:'Send'},{layout:'associated',semanticOnly:true}]){
    await actor.sendQuery('bridge-owned-send',{mode:'stream',...variant,streamDelay:600,dynamicSend:false});inspected=await inspect();
    check(inspected.sendDOMPresent&&inspected.sendFormOwned&&!inspected.sendInsideNarrowComposer&&inspected.sendID!=='send'&&!inspected.sendTestID&&inspected.sendType==='submit'&&inspected.sendCandidateCount===1&&(variant.semanticOnly?!inspected.sendLabel:inspected.sendLabel==='Send'),'the '+variant.layout+(variant.semanticOnly?' unlabeled':' English')+' fixture exposes one form-owned Send without legacy markers');
    const beforeOwned=Number(inspected.sends),ownedPrompt='OWNED_FORM_'+variant.layout+(variant.semanticOnly?'_SEMANTIC':'_SEND');
    await sendQuestion(ownedPrompt);session=await complete(2,'form-owned first '+ownedPrompt);inspected=await inspect();
    check(Number(inspected.sends)===beforeOwned+1&&inspected.lastSubmission.text===ownedPrompt&&inspected.voiceClicks==='0'&&session.messages[1].webVerified,'form-owned '+ownedPrompt+' submits the exact question once and never clicks Voice');
    const withPDF=variant.layout==='sibling',beforeOwnedChanges=Number(inspected.changes);
    if(withPDF){el('pdf').click();await wait(()=>!el('pdf').disabled&&!el('attachment').hidden&&el('preview-context').textContent.includes('PDF'),'owned form selected PDF');}
    await sendQuestion(ownedPrompt+'_FOLLOWUP');session=await complete(4,'form-owned followup '+ownedPrompt);inspected=await inspect();
    check(Number(inspected.sends)===beforeOwned+2&&inspected.lastSubmission.text.endsWith(ownedPrompt+'_FOLLOWUP')&&session.webConversation.userCount===2&&session.messages[3].webVerified,'form-owned '+ownedPrompt+' continues the same verified website conversation');
    if(withPDF)check(Number(inspected.changes)===beforeOwnedChanges+1&&inspected.lastSubmission.files.length===1&&inspected.lastSubmission.files[0].type==='application/pdf','a PDF upload in the sibling chat toolbar is observed and submitted once with the selected followup');
    el('new-chat').click();await wait(async()=>(await current()).messages.length===0&&(await status()).conversation==='/'&&!pc.chatBusy,'new after '+ownedPrompt);
   }
   await actor.sendQuery('bridge-configure',{mode:'no-ack'});const beforeNoAck=Number((await inspect()).sends);await sendQuestion('NO_ACK_QUESTION');
   await wait(async()=>!pc.chatBusy&&(await current()).messages.at(-1)?.status==='failed','ambiguous acknowledgement',32000);session=await current();inspected=await inspect();
   check(Number(inspected.sends)===beforeNoAck+1&&session.webPending&&session.messages.at(-1).webUncertain&&el('prompt').value==='','lost acknowledgement preserves an uncertainty lock and never automatically resubmits');
   await capture('10-native-unconfirmed-submission');
   await sendQuestion('NO_ACK_QUESTION');await wait(()=>!pc.chatBusy&&!el('send').disabled&&el('web-status-message').textContent.includes('上次'),'uncertain retry guard');
   check(Number((await inspect()).sends)===beforeNoAck+1&&el('prompt').value==='NO_ACK_QUESTION','a later Send cannot bypass the pending website submission lock');
   check(network===0,'all native webpage tests remain offline with no real account or model request');
   el('web-inspect').click();await wait(()=>el('web-pane').dataset.inspect==='true','inspector before zoom check');el('web-more-toggle').click();el('web-focus').click();
   check(ui.body.classList.contains('web-focus')&&el('web-focus').getAttribute('aria-pressed')==='true','website zoom has a matching pressed state');el('web-return').click();
   await wait(nativeVisible,'native after zoomed inspector');check(!ui.body.classList.contains('web-focus')&&el('web-focus').getAttribute('aria-pressed')==='false'&&el('web-focus').textContent.includes('放大网页'),'returning to native chat resets website zoom state and its action label');
   el('web-inspect').click();await wait(()=>el('web-pane').dataset.inspect==='true','inspector before close');el('web-more-toggle').click();const timer=view.presentationTimer;el('web-close').click();await wait(()=>!pc.web.views.has(win),'closed website view');
   check(!!timer&&!pc.web.views.has(win),'closing the background browser clears its watcher and native view registration');check(nativeVisible()&&ui.activeElement===el('web-inspect')&&!el('web-inspect').closest('[inert]'),'closing the website restores focus to its visible native entry rather than the hidden More menu');
   pc.web.actor=actualActor;view.browser.loadURI=actualLoad;ChromeUtils.unregisterWindowActor('PaperCompanionWebTest');
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:pc.publicState().version,results,shots,navigations,events},null,2));
  } catch(error) {try{await captureFailure();}catch(_){}await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:error.message,stack:error.stack,results,shots,navigations,debug:await debug()},null,2));}
  finally {Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){testChrome?.destruct();}function install(){}function uninstall(){}
