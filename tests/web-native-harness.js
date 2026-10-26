// Disposable remote browser fixture. No real account or website submission.
var testChrome;
function startup({rootURI}) {
 testChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup).registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-test','content/']]);
 (async()=>{
  const results=[],output='__OUTPUT__';let debug=()=>({});
  const check=(v,label)=>{if(!v)throw new Error(label);results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw new Error('Timeout: '+label);};
  try{
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'startup');
   const pc=Zotero.PaperCompanion;let network=0;pc.request=()=>{network++;throw new Error('Unexpected model request');};
   const parent=new Zotero.Item('journalArticle');parent.setField('title','Web input fixture');await parent.saveTx();const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});
   await Zotero.Reader.open(item.id);await pc.openPanel({readerID:item.id});await wait(()=>pc.panel?.document?.body?.dataset?.ready==='true','panel');
   const win=pc.panel,ui=win.document,el=id=>ui.getElementById(id);
   await pc.saveSettings({chatProvider:'chatgpt-web',smartReading:false});
   const view=pc.web.create(win,el('web-host'));check(!view.opened&&!view.presentationTimer&&network===0,'opening the sidebar and selecting webpage mode do not connect or start a presentation watcher');
   ChromeUtils.importESModule('chrome://paper-companion-test/content/WebTestChild.sys.mjs');
   ChromeUtils.registerWindowActor('PaperCompanionWebTest',{allFrames:false,matches:['file:///*'],child:{esModuleURI:'chrome://paper-companion-test/content/WebTestChild.sys.mjs'}});
   const {E10SUtils}=ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs');
   const fixture=Zotero.File.pathToFileURI('__WEB_FIXTURE__'),rt=E10SUtils.getRemoteTypeForURI(fixture,true,false,E10SUtils.DEFAULT_REMOTE_TYPE,null,E10SUtils.predictOriginAttributes({browser:view.browser}));
   if(view.browser.remoteType!==rt){view.browser.setAttribute('remote','true');view.browser.setAttribute('remoteType',rt);view.browser.changeRemoteness({remoteType:rt});view.browser.construct();}
   view.browser.loadURI(Services.io.newURI(fixture),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
   await wait(()=>view.browser.browsingContext.currentWindowGlobal?.documentURI?.spec===fixture,'remote fixture');
   const actor=view.browser.browsingContext.currentWindowGlobal.getActor('PaperCompanionWebTest');await actor.sendQuery('status');
   let denied=false;try{pc.web.actor(win);}catch(_){denied=true;}check(denied,'production bridge continues rejecting non-ChatGPT pages');
   const actualActor=pc.web.actor.bind(pc.web);pc.web.actor=()=>actor;view.opened=true;pc.web.watchPresentation(win);
   await wait(()=>view.presentedCompact===true,'compact preference');let inspected=await actor.sendQuery('inspect');
   debug=()=>({network,notice:el('notice').textContent,prompt:el('prompt').value,toggle:el('web-composer-toggle').textContent,inspected});
   for(let i=0;!inspected.collapsed&&i<40;i++){await Zotero.Promise.delay(50);inspected=await actor.sendQuery('inspect');}
   check(inspected.collapsed&&inspected.compactHeight===0&&inspected.sendVisible,'webpage text field is collapsed by default while its native Send control remains visible');
   check(el('web-composer-toggle').textContent==='展开输入'&&el('prompt').placeholder.includes('传入网页草稿'),'plugin input remains primary and the webpage input can be expanded');
   el('prompt').value='PLUGIN_TEXTAREA_DRAFT';el('send').click();await wait(()=>!el('send').disabled&&!el('prompt').value,'plugin draft transfer');inspected=await actor.sendQuery('inspect');
   check(inspected.draft.includes('Existing draft')&&inspected.draft.includes('PLUGIN_TEXTAREA_DRAFT')&&inspected.collapsed,'plugin button appends to the hidden webpage textarea and clears only confirmed local text');
   check(inspected.sends==='0','transferring a question never clicks the website Send button');
   el('web-composer-toggle').click();await wait(()=>!pc.settings.webCompactComposer&&view.presentedCompact===false,'expand webpage input');
   inspected=await actor.sendQuery('inspect');check(!inspected.collapsed&&inspected.draft.includes('PLUGIN_TEXTAREA_DRAFT'),'expanding restores the webpage editor and its staged draft');
   el('web-composer-toggle').click();await wait(()=>pc.settings.webCompactComposer&&view.presentedCompact===true,'collapse webpage input');
   await actor.sendQuery('modern');await pc.web.syncPresentation(win);inspected=await actor.sendQuery('inspect');
   check(inspected.editorID==='modern-web-editor'&&inspected.collapsed&&inspected.sendVisible,'editor detection skips a hidden disabled legacy textarea and finds the current rich-text composer');
   el('prompt').value='MODERN_PLUGIN_QUESTION';el('prompt').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>!el('send').disabled&&!el('prompt').value,'modern Enter transfer');
   inspected=await actor.sendQuery('inspect');check(inspected.draft.includes('MODERN_EXISTING_DRAFT')&&inspected.draft.includes('MODERN_PLUGIN_QUESTION')&&inspected.hiddenDraft==='HIDDEN_LEGACY_DRAFT','Enter writes to the live rich-text editor and preserves the hidden legacy control');
   await actor.sendQuery('replace-editor');await Zotero.Promise.delay(150);inspected=await actor.sendQuery('inspect');
   check(inspected.collapsed&&inspected.draft.includes('SPA_DRAFT'),'a webpage editor replaced during navigation keeps the compact presentation');
   await pc.web.fill(win,'FOLLOWUP_AFTER_REPLACEMENT',null);inspected=await actor.sendQuery('inspect');check(inspected.draft.includes('FOLLOWUP_AFTER_REPLACEMENT')&&inspected.collapsed,'draft handoff recovers after the webpage replaces its editor');
   const context=await pc.extract('page','both',item.id);await pc.web.attach(win,context);inspected=await actor.sendQuery('inspect');
   check(inspected.files.length===1&&inspected.files[0].type==='image/png'&&Number(inspected.changes)>0&&inspected.sendVisible,'collapsing the text area retains native attachment handoff and Send controls');
   await actor.sendQuery('blocked');el('prompt').value='PRESERVED_WHILE_UNAVAILABLE';el('send').click();await wait(()=>!el('send').disabled&&el('notice').textContent.includes('暂未找到'),'blocked editor feedback');
   check(el('prompt').value==='PRESERVED_WHILE_UNAVAILABLE'&&!el('notice').textContent.includes('请先在网页登录'),'an unavailable composer keeps the local question and does not incorrectly report a login failure');
   await actor.sendQuery('unblocked');el('send').click();await wait(()=>!el('send').disabled&&!el('prompt').value,'recovered composer');inspected=await actor.sendQuery('inspect');
   check(inspected.draft.includes('PRESERVED_WHILE_UNAVAILABLE')&&inspected.sends==='0'&&network===0,'retrying after editor recovery transfers the preserved question without website submission or model requests');
   el('tab-chat').style.width='260px';await Zotero.Promise.delay(80);const bounds=el('tab-chat').getBoundingClientRect();
   check(['web-start','web-reload','web-attach','web-composer-toggle','web-more-toggle'].every(id=>{const r=el(id).getBoundingClientRect();return r.width>0&&r.left>=bounds.left&&r.right<=bounds.right;}),'primary webpage controls including the expand and more toggles fit a 260px chat panel');
   el('web-more-toggle').click();await Zotero.Promise.delay(80);
   check(!el('web-more-menu').hidden&&['web-external','web-focus','web-close'].every(id=>{const r=el(id).getBoundingClientRect();return r.width>0&&r.left>=bounds.left&&r.right<=bounds.right;}),'all secondary webpage controls remain visible and within bounds through the more menu');
   ui.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
   check(el('web-more-menu').hidden&&ui.activeElement===el('web-more-toggle'),'webpage more menu closes on Escape and restores its entry focus');
   el('tab-chat').style.width='';
   const canvas=ui.createElement('canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;canvas.getContext('2d').drawWindow(win,0,0,canvas.width,canvas.height,'white');await IOUtils.write('__SCREENSHOT__',Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));
   const timer=view.presentationTimer;pc.web.close(win);check(!!timer&&!pc.web.views.has(win),'closing the embedded webpage clears its document presentation watcher');pc.web.actor=actualActor;
   ChromeUtils.unregisterWindowActor('PaperCompanionWebTest');
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:Zotero.version,results},null,2));
  }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results},null,2));}
  finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){}
function install(){}
function uninstall(){}
