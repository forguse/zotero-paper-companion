// Four theme materials in actual Gecko, with synthetic papers and no network.
var themeTestChrome;
function startup({rootURI}){
 themeTestChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup).registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-audit','content/']]);
 (async()=>{
  const output='__OUTPUT__',results=[],shots=[],samples={};let debug=()=>({});
  const check=(ok,label,detail)=>{if(!ok)throw Error(label+' '+JSON.stringify(detail||''));results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('Timeout '+label);};
  const pause=()=>Zotero.Promise.delay(100);
  const capture=async(win,name,region)=>{
   await pause();await win.document.fonts.ready;const r=region||{x:0,y:0,width:win.innerWidth,height:win.innerHeight};
   const canvas=win.document.createElement('canvas');canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);canvas.getContext('2d').drawWindow(win,r.x,r.y,canvas.width,canvas.height,'white');
   const path=PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),x=>x.charCodeAt(0)));shots.push(path);return canvas;
  };
  try{
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
   const pc=Zotero.PaperCompanion,main=Zotero.getMainWindow();let network=0;pc.request=async()=>{network++;throw Error('Theme tests stay offline');};
   check(pc.settings.theme==='cloud','fresh installation defaults to cloud without overwriting an old theme identity');
   Services.prefs.setIntPref('ui.prefersReducedMotion',1);
   await pc.saveSettings({chatProvider:'deepseek',headerCollapsed:false,chatOptionsCollapsed:true,materialsCollapsed:false,smartReading:false,vocabularyGenerateOnAdd:false,vocabularyContextFallback:'none'});
   const parent=new Zotero.Item('journalArticle');parent.setField('title','具身智能中的主动感知：研究方法与实验依据');await parent.saveTx();const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});const reader=await Zotero.Reader.open(item.id),paper=await pc.paperInfo(item.id);
   const session=await pc.session(paper.key);session.messages=[{role:'user',text:'观测越多，理解就越好吗？',status:'complete',at:1},{role:'assistant',provider:'deepseek',text:'不一定。观测增加通常能带来更多信息，但理解的提升取决于信息的质量、任务相关性以及模型的归纳能力。过多的观测也可能引入噪声，反而干扰真正有用的规律。\n\n### 阅读时重点核对\n\n1. 作者如何定义“有用的信息”？\n2. 是否设计了简单的替代方案进行对照？\n3. 实验是否提供了足够的证据支持结论？',status:'complete',at:2}];await pc.saveSession(paper.key);
   for(const [word,meaning]of [['inference','推断；推理'],['robustness','稳健性'],['constraint','约束；限制'],['baseline','基线；对照方法'],['feedback','反馈'],['autonomy','自主性']]){const c=await pc.vocabulary.add({text:word,readerID:item.id,page:1});await pc.vocabulary.edit(c.id,{meaning,defaultMeaning:meaning,sentence:'Local synthetic context for '+word+'.',sentenceTranslation:'合成原句，仅用于界面验证。'});}
   const holder=main.openDialog('chrome://paper-companion-audit/content/viewport.xhtml','','chrome,dialog=no,resizable,width=1000,height=950');await wait(()=>holder.document?.documentURI==='chrome://paper-companion-audit/content/viewport.xhtml'&&holder.document.readyState==='complete','holder');
   const frame=holder.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');frame.style.cssText='display:block;border:0;width:380px;height:820px';Cu.waiveXrays(frame).paperCompanionArgs={api:pc,embedded:true,readerID:item.id};frame.src='chrome://paper-companion/content/panel.xhtml';holder.document.body.append(frame);await wait(()=>frame.contentDocument?.body?.dataset.ready==='true','panel');
   const win=frame.contentWindow,doc=win.document,$=id=>doc.getElementById(id);debug=()=>({notice:$('notice').textContent,theme:pc.settings.theme,initError:doc.body.dataset.initError});
   const material=new win.Image();material.src='chrome://paper-companion/content/theme-cloud-mist.webp';await wait(()=>material.complete&&material.naturalWidth>0,'local mist material');check(material.naturalWidth>=1280&&material.naturalHeight>=640,'the packaged cloud material decodes locally before capture');
   const choices=Array.from(doc.querySelectorAll('#theme-toggle + .appearance-menu [data-theme-choice]'));check(choices.length===4&&choices.map(b=>b.textContent).join('|')==='云岚瓷白|晴空湛蓝|暖砂霞光|静夜墨蓝','compact menu contains four named themes in the intended order');
   $('theme-toggle').click();const menu=doc.querySelector('#theme-toggle + .appearance-menu');
   doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));check(doc.activeElement.dataset.themeChoice==='dark','Up wraps from cloud to the fourth theme');
   doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));check(doc.activeElement.dataset.themeChoice==='cloud','Down wraps from the fourth theme to cloud');
   doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true}));check(doc.activeElement.dataset.themeChoice==='dark','End selects the fourth theme');
   doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Home',bubbles:true}));check(doc.activeElement.dataset.themeChoice==='cloud','Home selects cloud');
   doc.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(menu.hidden&&doc.activeElement===$('theme-toggle'),'Escape closes the menu and restores the trigger');
   // Focus must never scroll the enclosing host, for either Gecko popovers or
   // the body portal used when that API is unavailable.
   const picker=win.pcTheme.pickers[0],frameStyle=frame.style.cssText,bodyStyle=holder.document.body.style.cssText;
   holder.document.body.style.minHeight='2400px';frame.style.marginTop='1200px';holder.scrollTo(0,0);await pause();
   check(holder.document.documentElement.scrollHeight>holder.innerHeight,'host focus fixture has an independently scrollable ancestor');
   for(const fallback of [false,true]){
    if(fallback)Object.defineProperty(menu,'showPopover',{value:undefined,configurable:true});
    const before=holder.scrollY;win.pcTheme.open(picker);doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true}));await pause();
    const focusDiagnostic={fallback,before,after:holder.scrollY,active:doc.activeElement?.id,choice:doc.activeElement?.dataset.themeChoice,menuHidden:menu.hidden,menuDisplay:win.getComputedStyle(menu).display,popover:menu.getAttribute('popover'),rect:menu.getBoundingClientRect().toJSON(),portal:picker.portal,topLayer:picker.topLayer};
    check(holder.scrollY===before&&doc.activeElement.dataset.themeChoice==='dark',(fallback?'portal':'popover')+' menu focus keeps the outer host scroll unchanged',focusDiagnostic);
    doc.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();
    check(holder.scrollY===before&&doc.activeElement===$('theme-toggle'),(fallback?'portal':'popover')+' menu exit preserves host scroll and trigger focus',{before,after:holder.scrollY,active:doc.activeElement?.id,menuHidden:menu.hidden});
    if(fallback)delete menu.showPopover;
   }
   frame.style.cssText=frameStyle;holder.document.body.style.cssText=bodyStyle;holder.scrollTo(0,0);await pause();
   $('prompt').value='这篇论文最关键的证据是什么？';$('prompt').dispatchEvent(new win.Event('input'));$('deepseek-key').value='FAKE_UNSAVED_DRAFT';$('deepseek-key').dispatchEvent(new win.Event('input'));
   const noteNode=$('note-preview').firstChild,host=holder.document.createElement('div');host.style.cssText='position:absolute;left:440px;top:80px;width:260px';holder.document.body.append(host);
   pc.selectionPopup({reader,doc:holder.document,params:{annotation:{text:'feedback',position:{pageIndex:0}}},append:n=>host.append(n)});const popupHost=host.firstElementChild,popup=popupHost.shadowRoot;popup.querySelector('.pc-selection-result').textContent='反馈：行动结果被用于调整下一步的观察和决策。';popup.querySelector('[data-action=write-note]').click();await pause();const popupInput=popup.querySelector('textarea');popupInput.value='这里需要区分观测数量与信息质量。';popupInput.dispatchEvent(new holder.Event('input'));
   await pc.openVocabulary();await wait(()=>pc.vocabularyWindow?.pcVocabularyUI,'book');const book=pc.vocabularyWindow;
   const rgb=hex=>{const n=doc.createElement('span');n.style.backgroundColor=hex;return n.style.backgroundColor;};
   for(const theme of ['cloud','blue','warm','dark']){
    await pc.saveAppearance({theme});await wait(()=>doc.documentElement.dataset.pcTheme===theme&&book.document.documentElement.dataset.pcTheme===theme,'synchronized '+theme);await pause();const p=win.PCore.surfacePalette(theme);
    check($('theme-toggle').textContent.includes(p.label)&&popupHost.dataset.pcTheme===theme,theme+' synchronizes the native ShadowRoot and theme name');
    check(win.getComputedStyle($('messages')).backgroundColor===rgb(p.paper)&&win.getComputedStyle($('prompt')).backgroundColor===rgb(p.paper),theme+' keeps messages and the question field on opaque reading paper');
    check(holder.getComputedStyle(popupInput).backgroundColor===rgb(p.paper)&&holder.getComputedStyle(popup.querySelector('.pc-body')).backgroundImage!=='none',theme+' shares material tokens while keeping the popup editor opaque');
    check(win.getComputedStyle(doc.querySelector('.workspace-header'),':before').backgroundImage!=='none'&&win.getComputedStyle(doc.body).backgroundImage!=='none',theme+' paints the header and overall atmosphere');
    check(book.getComputedStyle(book.document.querySelector('.vocab-heading')).backgroundImage!=='none'&&book.getComputedStyle(book.document.querySelector('.vocab-content')).backgroundColor===rgb(p.paper),theme+' gives the book a coordinated header and opaque word area');
    if(win.CSS.supports('backdrop-filter','blur(1px)'))check(win.getComputedStyle(doc.querySelector('.composer')).backdropFilter!=='none'&&holder.getComputedStyle(popup.querySelector('.pc-body')).backdropFilter!=='none',theme+' applies supported glass blur only to the composer shell and popup frame');
    check($('prompt').value==='这篇论文最关键的证据是什么？'&&$('deepseek-key').value==='FAKE_UNSAVED_DRAFT'&&popupInput.value==='这里需要区分观测数量与信息质量。'&&$('note-preview').firstChild===noteNode,theme+' preserves all open drafts and the editable note DOM');
    check(doc.querySelectorAll('.tabs [role=tab]').length===6&&['send','screenshot-ask','nav-notes','nav-vocabulary','nav-settings'].every(id=>!!$(id)),theme+' retains workspace and common task entrances');
    $('messages').scrollTop=0;
    const shot=await capture(win,'theme-'+theme+'-chat'),ctx=shot.getContext('2d'),lower=Math.floor(doc.querySelector('.workspace-header').getBoundingClientRect().bottom)-3;samples[theme]={left:Array.from(ctx.getImageData(6,6,1,1).data),center:Array.from(ctx.getImageData(Math.floor(win.innerWidth/2),6,1,1).data),right:Array.from(ctx.getImageData(win.innerWidth-6,6,1,1).data),lowerLeft:Array.from(ctx.getImageData(6,lower,1,1).data),lowerRight:Array.from(ctx.getImageData(win.innerWidth-6,lower,1,1).data)};
    check([0,1,2].some(i=>{const values=Object.values(samples[theme]).map(v=>v[i]);return Math.max(...values)-Math.min(...values)>5;}),theme+' has a visible native header gradient including any middle light peak');
    await capture(book,'theme-'+theme+'-book');await capture(holder,'theme-'+theme+'-popup',host.getBoundingClientRect());
   }
   check(samples.cloud.right.slice(0,3).some((v,i)=>Math.abs(v-samples.blue.right[i])>12),'cloud and cobalt blue are visibly different at the native painted header edge');
   await pc.saveAppearance({theme:'cloud'});Services.prefs.setIntPref('ui.systemUsesDarkTheme',1);await pause();check(doc.documentElement.dataset.pcTheme==='cloud'&&win.getComputedStyle($('prompt')).backgroundColor===rgb('#FAFAF7'),'cloud remains light when the OS chooses dark');Services.prefs.setIntPref('ui.systemUsesDarkTheme',0);
   doc.getElementById('nav-vocabulary').click();await pause();await capture(win,'theme-cloud-vocabulary-inline');
   const saved=JSON.parse(await IOUtils.readUTF8(PathUtils.join(pc.dir,'settings.json')));check(saved.theme==='cloud'&&network===0,'four-theme settings persist locally without model calls');
   book.close();holder.close();await IOUtils.writeUTF8(output,JSON.stringify({ok:true,results,shots,samples},null,2));
  }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results,shots,samples},null,2));}
  finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){themeTestChrome?.destruct();}function install(){}function uninstall(){}
