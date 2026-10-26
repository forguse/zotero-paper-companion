// Geometry and hit testing in disposable Zotero. No real account/model requests.
var polishChrome;
function startup({rootURI}){polishChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup).registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-audit','content/']]);(async()=>{
 const output='__OUTPUT__',results=[],shots=[],metrics=[],typeIssues=[];let debug=()=>({});
 const check=(v,label,detail)=>{if(!v)throw Error(label+' '+JSON.stringify(detail||''));results.push(label);};
 const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('Timeout '+label);};
 try{
  await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');const pc=Zotero.PaperCompanion,main=Zotero.getMainWindow();main.restore();main.resizeTo(1400,1000);Services.prefs.setIntPref('ui.prefersReducedMotion',1);let requests=0;pc.request=async()=>{requests++;throw Error('Polish suite stays offline');};
  await pc.saveSettings({chatProvider:'deepseek',smartReading:false,headerCollapsed:true,chatOptionsCollapsed:true,materialsCollapsed:true,pageFormat:'text',vocabularyGenerateOnAdd:false,vocabularyContextFallback:'none'});
  const parent=new Zotero.Item('journalArticle');parent.setField('title','Long source title: embodied intelligence, context dependent autonomy, and reproducible evidence '.repeat(5));await parent.saveTx();const attachment=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});await Zotero.Reader.open(attachment.id);const paper=await pc.paperInfo(attachment.id);await pc.openPanel({readerID:paper.id});await wait(()=>pc.panel?.document?.body.dataset.ready==='true','sidebar');
  const holder=main.openDialog('chrome://paper-companion-audit/content/viewport.xhtml','','chrome,dialog=no,resizable,width=600,height=850');await wait(()=>holder.document?.readyState==='complete'&&!!holder.document.body,'viewport');holder.focus();const frame=holder.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');frame.style.cssText='display:block;border:0;width:340px;height:760px';Cu.waiveXrays(frame).paperCompanionArgs={api:pc,embedded:true,readerID:paper.id};frame.src='chrome://paper-companion/content/panel.xhtml';holder.document.body.append(frame);debug=()=>({url:frame.contentDocument?.URL,initError:frame.contentDocument?.body?.dataset.initError,notice:frame.contentDocument?.getElementById('notice')?.textContent});await wait(()=>frame.contentDocument?.body.dataset.ready==='true','frame');const win=frame.contentWindow,ui=win.document,el=id=>ui.getElementById(id),pause=()=>Zotero.Promise.delay(180),tab=name=>el('nav-'+name).click();
  debug=()=>({notice:el('notice').textContent,active:ui.activeElement?.id,scale:win.devicePixelRatio,viewport:[win.innerWidth,win.innerHeight],dialogs:[...ui.querySelectorAll('dialog[open]')].map(n=>n.id)});
  const point=(node,doc=ui)=>{const view=doc.defaultView,r=node.getBoundingClientRect();let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(view.innerWidth,r.right),bottom=Math.min(view.innerHeight,r.bottom);for(let a=node.parentElement;a;a=a.parentElement){const s=view.getComputedStyle(a),b=a.getBoundingClientRect();if(['hidden','auto','scroll','clip'].includes(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(['hidden','auto','scroll','clip'].includes(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}if(right-left<8||bottom-top<8)return null;const x=(left+right)/2,y=(top+bottom)/2,hit=doc.elementFromPoint(x,y);return node===hit||node.contains(hit)?{x,y,width:right-left,height:bottom-top}:null;};
  const click=async(node,label,doc=ui)=>{const p=point(node,doc);check(!!p,label+' has an unclipped, unobscured click target',node.getBoundingClientRect().toJSON());doc.defaultView.windowUtils.sendMouseEvent('mousedown',p.x,p.y,0,1,0);doc.defaultView.windowUtils.sendMouseEvent('mouseup',p.x,p.y,0,1,0);await pause();};
  const capture=async(name,doc=ui)=>{await pause();await doc.fonts.ready;const v=doc.defaultView,c=doc.createElement('canvas');c.width=v.innerWidth;c.height=v.innerHeight;c.getContext('2d').drawWindow(v,0,0,c.width,c.height,'white');const path=PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),x=>x.charCodeAt(0)));shots.push({name,path,dpr:v.devicePixelRatio});};

  const session=await pc.session(paper.key);
  session.messages=[];
  for(let i=0;i<12;i++){session.messages.push({role:'user',text:'研究问题 '+i,status:'complete',at:i*2});session.messages.push({role:'assistant',text:'## 已完成回答 '+i+'\n\n'+('这是需要回看的稳定原文，用户会选择复制和核对来源。\n\n').repeat(6),status:'complete',provider:'deepseek',at:i*2+1,references:i===0?[{title:paper.title,page:1,key:paper.key,paperID:paper.id,text:'原文证据',link:paper.link+'?page=1'}]:[]});}
  const originalAsk=pc.ask.bind(pc);
  let stream,finish,streamAnswer;
  pc.ask=async(key,prompt,context,onDelta)=>{const s=await pc.session(key);streamAnswer={role:'assistant',provider:'deepseek',text:'正在形成的新回答。',status:'pending',at:1000};s.messages.push({role:'user',text:prompt,status:'pending',at:999},streamAnswer);pc.chatBusy=true;pc.emit('busy');stream=()=>{streamAnswer.text+=' 新增的研究解释。';onDelta(streamAnswer.text);};onDelta('');await new Promise(r=>finish=r);streamAnswer.status='complete';pc.chatBusy=false;pc.emit('busy');return streamAnswer.text;};
  el('prompt').value='测试连续阅读';el('send').click();await wait(()=>stream&&el('messages').children.length===26,'stream initialized');await pause();
  const log=el('messages'),first=log.querySelector('.assistant'),firstBody=first.querySelector('.message-body'),sources=first.querySelector('details');sources.open=true;
  const selection=win.getSelection(),range=ui.createRange();range.selectNodeContents(firstBody.querySelector('p'));selection.removeAllRanges();selection.addRange(range);const selected=selection.toString();
  log.scrollTop=0;log.dispatchEvent(new win.Event('scroll'));await pause();
  const core=Cu.waiveXrays(win).PCore,originalMarkdown=core.markdown;let parses=0;core.markdown=(...args)=>{parses++;return originalMarkdown.apply(core,args);};
  for(let i=0;i<40;i++)stream();await Zotero.Promise.delay(260);
  check(log.querySelector('.assistant')===first&&first.querySelector('.message-body')===firstBody,'streaming preserves completed message DOM');
  check(selection.toString()===selected&&selected.length>0,'streaming preserves selected historical text');
  check(sources.open,'streaming preserves expanded source evidence');
  check(log.scrollTop<20&&!el('chat-latest').hidden,'streaming respects upward reading and offers latest');
  check(parses<=6,'forty chunks coalesce without reparsing conversation history',{parses});
  await capture('01-reading-while-streaming');
  selection.removeAllRanges();const activeBody=log.lastElementChild.querySelector('.message-body'),activeRange=ui.createRange();activeRange.selectNodeContents(activeBody);selection.addRange(activeRange);stream();await Zotero.Promise.delay(200);
  check(log.lastElementChild.querySelector('.message-body')===activeBody,'selection in streaming text defers replacing that message');
  selection.removeAllRanges();await wait(()=>log.lastElementChild.querySelector('.message-body').textContent.includes(streamAnswer.text),'deferred text flushes');
  await click(el('chat-latest'),'latest reading shortcut');check(log.scrollHeight-log.scrollTop-log.clientHeight<65,'latest resumes following at the bottom');
  finish();await wait(()=>!el('chat-live-status').textContent.includes('正在'),'completion announcement');
  check(el('chat-live-status').getBoundingClientRect().height===1,'live announcements do not take reading space');
  check(el('chat-live-status').textContent==='回答已完成','completion is announced without replaying all live tokens');
  await pc.saveSettings({chatOptionsCollapsed:false});tab('chat');await pause();await capture('02-reading-tools');
  check(el('chat-engine-hint').closest('details')&&!el('chat-engine-hint').closest('details').open,'engine explanation is available without displacing initial tools');
  check(['reading-open','compare-open','chat-history-open','smart-reading'].every(id=>!el(id).disabled),'all reading and history entrances remain available');

  const otherParent=new Zotero.Item('journalArticle');otherParent.setField('title','Second paper for draft isolation');await otherParent.saveTx();const otherAttachment=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:otherParent.id});const other=await pc.paperInfo(otherAttachment.id);await Zotero.Reader.open(other.id);
  const originalExtract=pc.extract;pc.extract=async()=>({id:'local-draft-material',key:paper.key,title:paper.title,mode:'fulltext',text:'Synthetic draft material',label:'甲篇尚未发送的材料'});
  el('prompt').value='甲篇尚未发送的问题与思考';el('prompt').dispatchEvent(new win.Event('input'));el('prompt').setSelectionRange(2,6);el('fulltext').click();await wait(()=>el('preview-context').textContent.includes('甲篇尚未发送'),'draft material');
  await win.paperCompanionActivate({readerID:other.id});check(el('prompt').value==='','a different paper starts without another paper question');el('prompt').value='乙篇独立的新问题';
  await win.paperCompanionActivate({readerID:paper.id});check(el('prompt').value==='甲篇尚未发送的问题与思考','returning restores the paper question draft');check(el('prompt').selectionStart===2&&el('prompt').selectionEnd===6,'returning preserves the question selection');check(el('preview-context').textContent.includes('甲篇尚未发送'),'returning restores unsent materials to the correct paper');
  await capture('03-paper-draft-restored');
  let rejectLate;pc.ask=async()=>{await new Promise((resolve,reject)=>rejectLate=reject);};el('prompt').value='甲篇等待中失败的问题';el('send').click();await wait(()=>rejectLate,'late failure setup');
  await win.paperCompanionActivate({readerID:other.id});el('prompt').value='乙篇正在写的更新草稿';rejectLate(Error('synthetic delayed failure'));await Zotero.Promise.delay(250);
  check(el('prompt').value==='乙篇正在写的更新草稿','a late failure never overwrites the currently open paper');
  await win.paperCompanionActivate({readerID:paper.id});check(el('prompt').value==='甲篇等待中失败的问题','a late failure restores its submitted question on its original paper');
  await win.paperCompanionActivate({readerID:other.id});check(el('prompt').value==='乙篇正在写的更新草稿','the newer other-paper draft remains recoverable');check(el('prompt').title.includes('关闭窗口后不保留'),'draft lifetime is disclosed instead of claiming disk persistence');
  pc.extract=originalExtract;

  pc.ask=originalAsk;pc.readSecrets=async()=>({deepseek:'fake-native-test-key'});let inferences=0;
  const answerText=('本轮实际完成的回答，保存失败后仍可阅读、选择和复制。\n\n').repeat(30);
  pc.infer=async(url,options)=>{inferences++;options.onChunk('data: '+JSON.stringify({choices:[{delta:{content:answerText},finish_reason:'stop'}]})+'\n\n');};
  const originalWriteText=pc.writeText.bind(pc),sessionPath=PathUtils.join(pc.chatsDir,other.key+'.json');let failSessionSave=true;
  pc.writeText=async(path,value)=>{if(path===sessionPath&&failSessionSave)throw Error('synthetic disk full');return originalWriteText(path,value);};
  const previousDebug=debug;debug=()=>({...previousDebug(),provider:pc.settings.chatProvider,model:pc.settings.chatDeepseekModel,busy:pc.chatBusy,sendDisabled:el('send').disabled,activeTab:ui.querySelector('.tab-pane.active')?.id,noticeText:el('notice-text').textContent,inferences,wantedKey:other.key,unsaved:[...pc.unsavedSessions],sessionPath,messages:el('messages').textContent.slice(-500)});
  el('prompt').value='生成成功但本机保存失败';el('send').click();await wait(()=>pc.unsavedSessions.has(other.key)&&!pc.chatBusy,'unsaved chat warning');await pause();
  check(!el('chat-save-warning').hidden&&el('prompt').value==='','save failures keep the answer and do not reinsert a duplicate question');
  check(el('messages').lastElementChild.textContent.includes('本轮实际完成的回答'),'the completed answer remains readable after a disk failure');
  frame.style.width='260px';await pause();check(!!point(el('chat-save-retry'))&&el('chat-save-retry').getBoundingClientRect().height>=30,'save recovery remains reachable at 260px');check(el('chat-focus').getBoundingClientRect().width>=30&&el('chat-focus').getAttribute('aria-label')==='专注阅读','narrow focus keeps an accessible labeled target');check(el('chat-options-toggle').querySelector('.chat-options-short').scrollWidth<=el('chat-options-toggle').querySelector('.chat-options-short').clientWidth,'narrow tool label remains readable instead of clipped',{label:el('chat-options-toggle').textContent,width:el('chat-options-toggle').getBoundingClientRect().width,text:el('chat-options-toggle').querySelector('.pc-control-label').getBoundingClientRect().width,scroll:el('chat-options-toggle').querySelector('.pc-control-label').scrollWidth});await capture('04-chat-save-recovery');
  failSessionSave=false;await click(el('chat-save-retry'),'retry local conversation save');await wait(()=>!pc.unsavedSessions.has(other.key),'save recovered');check(inferences===1&&el('chat-save-warning').hidden,'retry saves locally without a second model request');
  const saved=JSON.parse(await IOUtils.readUTF8(sessionPath));check(saved.messages.at(-1).status==='complete'&&saved.messages.at(-1).text===answerText,'retry persists the complete answer');
  const logNow=el('messages');logNow.scrollTop=0;logNow.dispatchEvent(new win.Event('scroll'));el('new-chat').click();await wait(()=>!!logNow.querySelector('.empty-chat'),'new session empty');el('prompt').value='新会话应重新跟随';el('send').click();await wait(()=>inferences===2&&!pc.chatBusy,'new session completed');await pause();check(logNow.scrollHeight-logNow.scrollTop-logNow.clientHeight<65&&el('chat-latest').hidden,'a new conversation restores following instead of inheriting paused history');
  frame.style.width='340px';const paths=await pc.files.ensure(other);await pc.note(other);await IOUtils.writeUTF8(paths.note,'EXTERNAL_EDITOR_VERSION\n外部软件修改的笔记');tab('notes');el('toggle-note-source').click();el('note-editor').value='# 插件当前编辑\n保留两份内容';el('note-editor').dispatchEvent(new win.Event('input',{bubbles:true}));await pc.flushNote(other.key);await pause();
  check((await IOUtils.readUTF8(paths.note)).includes('插件当前编辑'),'the active Markdown contains the plugin draft');const backups=await IOUtils.getChildren(paths.backups);let externalFound=false;for(const path of backups)if(PathUtils.filename(path).startsWith('阅读笔记-外部修改-')&&(await IOUtils.readUTF8(path)).includes('EXTERNAL_EDITOR_VERSION'))externalFound=true;
  check(externalFound,'external editor content is preserved in a separate on-disk Markdown backup');check(el('notice-text').textContent.includes('backups'),'the external backup is explained in the current paper interface');await capture('05-external-note-backup');
  core.markdown=originalMarkdown;
  await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:pc.publicState().version,results,shots},null,2));
 }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:String(e),stack:e.stack,results,shots,debug:debug()},null,2));}
 finally{polishChrome?.destruct();Services.startup.quit(Ci.nsIAppStartup.eForceQuit);}
})();}
function shutdown(){}
function install(){}
function uninstall(){}
