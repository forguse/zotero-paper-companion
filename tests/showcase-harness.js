// Capture actual Zotero UI using example content; never packaged in the plugin.
var showcaseChrome;
function startup({rootURI}) {
 showcaseChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup).registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-showcase','content/']]);
 (async()=>{
  const output='__OUTPUT__',dir='__ASSETS__',shots=[],debug={};
  const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw new Error('Timeout: '+label);};
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
   const pc=Zotero.PaperCompanion,main=Zotero.getMainWindow();main.resizeTo(1500,1050);
   let networkCalls=0;pc.request=async()=>{networkCalls++;throw new Error('Showcase capture must remain offline');};
   const parent=new Zotero.Item('journalArticle');parent.setField('title','注意力机制阅读示例');parent.setField('abstractNote','仅用于插件界面演示，不是真实发表论文。');await parent.saveTx();
   const attachment=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id}),reader=await Zotero.Reader.open(attachment.id);pc.readerID=attachment.id;
   await wait(()=>{try{return !!pc.pdf(reader).doc;}catch(_){return false;}},'PDF');
   await pc.saveSettings({chatProvider:'deepseek',selectionTranslation:'click',autoRecord:false});
   const paper=await pc.paper(),session=await pc.session(paper.key);
   session.messages=[{role:'user',text:'Q、K、V 分别是什么？能用一个直观的例子解释吗？',status:'complete',at:1},
    {role:'assistant',text:'可以把注意力理解为一次“查资料”。\n\n- **Q（查询）**：你现在想找什么。\n- **K（键）**：每条资料的索引，供你判断相关性。\n- **V（值）**：真正取出来、用于回答的内容。\n\nQ 与 K 计算匹配分数，分数归一化后作为权重，再加权汇总 V。上面的例子只用于帮助理解，具体定义仍以原文为准。',status:'complete',provider:'deepseek',at:2}];await pc.saveSession(paper.key);
   const note='# 注意力机制 · 阅读笔记\n\n## 今天读懂了什么\n\n**Q 决定我要找什么，K 用于匹配，V 提供内容。**\n\n> Attention assigns different weights to different parts of an input.\n\n[原文 · 第 1 页]('+paper.link+'?page=1)\n\n## 还想继续问\n\n- 为什么要除以 sqrt(d)？\n- 注意力权重能否直接当作解释？\n\n随手记下理解，之后再回到原文核对。\n';pc.saveNote(paper.key,note);await pc.flushNotes();
   const paths=await pc.files.ensure(paper);
   const data={entries:[{id:'demo-one',at:'阅读摘记',source:'示例对话',model:'Flash',markdown:'### 核心概念\n\n- Q、K、V 分别承担查询、匹配和内容聚合。\n- 权重用于组合输入信息，不等同于因果解释。\n\n### 待核对\n\n- 归一化与缩放的作用，需要结合公式继续理解。'}]};
   await pc.writeJSON(paths.summaryData,data);await pc.writeText(paths.summary,pc.insights.document(paper,data));
   const review='# 注意力机制 · 重点省察\n\n## 先抓住一条主线\n\n**匹配相关性 → 分配权重 → 汇总信息。**\n\n## 把零散问题连起来\n\n1. Q 和 K 回答“应该关注哪里”。\n2. V 决定“最终带回什么内容”。\n3. 缩放和归一化影响权重的分布。\n\n## 下次阅读带着这两个问题\n\n- 高注意力权重是否意味着重要原因？\n- 这个直观例子有哪些不成立的边界？\n\n以上为示例整理，仍需核对原文。';
   await pc.writeJSON(paths.reviewData,{text:review,sourceHash:(await pc.insights.reviewSource(paper)).hash,promptHash:await pc.insights.digest(pc.insights.prompt('review'))});await pc.writeText(paths.review,review);
   await pc.openPanel({readerID:attachment.id});await wait(()=>pc.panel?.document?.body?.dataset?.ready==='true','panel');
   const embedded=pc.panel,embeddedFrame=embedded.frameElement;
   let win=embedded,ui=win.document;
   const shellChecks=[];
   const capture=async(name,target=win,rect=null)=>{await Zotero.Promise.delay(180);const canvas=ui.createElement('canvas');const r=rect||{left:0,top:0,width:target.innerWidth,height:target.innerHeight};canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);canvas.getContext('2d').drawWindow(target,r.left,r.top,canvas.width,canvas.height,'white');const file=PathUtils.join(dir,name+'.png');await IOUtils.write(file,Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));shots.push({name,path:file,width:canvas.width,height:canvas.height});};
   await capture('01-zotero-reading',main);
   const rail=main.document.getElementById('zotero-context-pane-sidenav');
   embeddedFrame.style.width='700px';await Zotero.Promise.delay(150);
   shellChecks.push({ok:embeddedFrame.getBoundingClientRect().right<=rail.getBoundingClientRect().left+1,name:'wide content stays left of native navigation rail'});
   const originalRailStyle=rail.getAttribute('style'),host=embeddedFrame.parentElement.getBoundingClientRect();
   rail.style.cssText='position:fixed;left:'+(host.left+Math.min(230,host.width-35))+'px;top:'+host.top+'px;width:34px;height:400px;z-index:9999';main.dispatchEvent(new main.Event('resize'));await Zotero.Promise.delay(200);
   shellChecks.push({ok:embeddedFrame.getBoundingClientRect().right<=rail.getBoundingClientRect().left+1,name:'overlaid native rail reserves actual width'});
   if(originalRailStyle===null)rail.removeAttribute('style');else rail.setAttribute('style',originalRailStyle);
   embeddedFrame.style.width='100%';main.dispatchEvent(new main.Event('resize'));await Zotero.Promise.delay(150);
   shellChecks.push({ok:Math.abs(embedded.innerWidth-embeddedFrame.parentElement.clientWidth)<=1,name:'restoring native rail restores usable width'});
   // Test other widths in the production standalone window, never by stretching
   // an embedded frame under Zotero's navigation rail.
   const holder=main.openDialog('chrome://paper-companion-showcase/content/viewport.xhtml','paper-companion-layout','chrome,dialog=no,resizable,width=650,height=1000');
   await wait(()=>holder.document?.documentURI==='chrome://paper-companion-showcase/content/viewport.xhtml'&&holder.document.readyState==='complete'&&!!holder.document.body,'layout holder');holder.document.body.style.margin='0';
   const viewport=holder.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');viewport.style.cssText='display:block;border:0;width:520px;height:900px';
   Components.utils.waiveXrays(viewport).paperCompanionArgs={api:pc,embedded:true,readerID:attachment.id};viewport.src='chrome://paper-companion/content/panel.xhtml';holder.document.body.append(viewport);
   await wait(()=>{const d=viewport.contentWindow?.document;debug.layout={url:d?.URL,body:d?.body?.textContent?.slice(0,180),ready:d?.body?.dataset?.ready};return d?.body?.dataset?.ready==='true';},'layout window');win=viewport.contentWindow;ui=win.document;
   const resize=async(width,height)=>{viewport.style.width=width+'px';viewport.style.height=height+'px';await wait(()=>win.innerWidth===width&&win.innerHeight===height,'viewport '+width);await Zotero.Promise.delay(120);};
   await resize(520,900);
   ui.querySelector('[data-tab="chat"]').click();await capture('02-chat');
   const internal=reader._internalReader,realDoc=reader._iframeWindow.document;
   internal._updateState(Components.utils.cloneInto({primaryViewSelectionPopup:{rect:[75,130,290,160],annotation:{text:'Attention assigns different weights to different parts of an input.',position:{pageIndex:0,rects:[[75,130,290,160]]}}}},reader._iframeWindow));
   await wait(()=>!!realDoc.querySelector('.selection-popup .paper-companion-selection')?.shadowRoot,'selection popup');const popup=realDoc.querySelector('.selection-popup'),r=popup.getBoundingClientRect();await capture('03-selection-popup',reader._iframeWindow,{left:Math.max(0,r.left-8),top:Math.max(0,r.top-8),width:r.width+16,height:r.height+16});internal._updateState(Components.utils.cloneInto({primaryViewSelectionPopup:null},reader._iframeWindow));
   pc.emit('translation',{selection:{readerID:paper.id,text:'Attention assigns different weights to different parts of an input.',page:1},text:'注意力机制会为输入的不同部分分配不同的权重。',status:'complete'});ui.querySelector('[data-tab="translate"]').click();await capture('04-translation');
   ui.querySelector('[data-tab="notes"]').click();await capture('05-notes');
   ui.querySelector('[data-tab="highlights"]').click();await capture('06-chat-highlights');ui.getElementById('review-now').scrollIntoView({block:'start'});await capture('07-review');
   ui.querySelector('[data-tab="settings"]').click();ui.getElementById('tab-settings').scrollTop=0;await capture('08-folder-settings');
   ui.querySelector('.summary-prompts').scrollIntoView({block:'start'});await capture('09-prompt-settings');
   let layout=null;
   if (__LAYOUT_CAPTURE__) {
    const checks=[...shellChecks],inventory=[];
    const check=(ok,name,detail=null)=>checks.push({ok:!!ok,name,detail});
    const expected=__EXPECTED_CONTROLS__;
    for(const [id,tag] of Object.entries(expected)) check(ui.getElementById(id)?.localName===tag,'original control retained: '+id);
    for(const [width,height] of [[340,760],[260,430],[520,900]]) {
     await resize(width,height);
     for(const name of ['chat','translate','notes','highlights','settings']) {
      ui.querySelector('[data-tab="'+name+'"]').click();const pane=ui.getElementById('tab-'+name);pane.scrollTop=0;await Zotero.Promise.delay(60);
      const controls=[...pane.querySelectorAll('button,select,input,textarea,summary')];
      const rects=controls.filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {id:el.id||el.textContent.trim().slice(0,30),left:r.left,right:r.right,width:r.width};});
      check(rects.every(r=>r.width>0&&r.left>=-1&&r.right<=width+1),width+' '+name+' controls fit horizontally',rects.filter(r=>r.width<=0||r.left< -1||r.right>width+1));
      check(pane.scrollWidth<=width+1,width+' '+name+' no horizontal scrolling',{scroll:pane.scrollWidth,width});
      if(width===340){inventory.push(...controls.map(el=>({id:el.id,tag:el.localName,label:el.getAttribute('aria-label')||el.textContent.trim().slice(0,70),tab:name})));await capture('layout-'+name);}
      if(name==='chat') {const send=ui.getElementById('send').getBoundingClientRect(),box=ui.getElementById('prompt').getBoundingClientRect();check(send.bottom<=height&&box.height>=30,width+' composer accessible',{sendBottom:send.bottom,height,promptHeight:box.height});}
      if(name==='notes') {const r=ui.getElementById('note-preview').getBoundingClientRect();check(r.height>=60&&r.bottom<=height,width+' editable note has space',{height:r.height,bottom:r.bottom});}
     }
    }
    await resize(340,760);holder.focus();
    if(ui.getElementById('settings-jump')) {
     ui.querySelector('[data-tab="chat"]').click();ui.getElementById('nav-chat').focus();
     ui.getElementById('nav-chat').dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
     check(ui.getElementById('tab-translate').classList.contains('active')&&ui.activeElement.id==='nav-translate','arrow keys switch and focus tabs');
     ui.getElementById('nav-translate').dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true}));
     check(ui.getElementById('tab-settings').classList.contains('active')&&ui.activeElement.id==='nav-settings','End key reaches settings');
     const picker=ui.getElementById('settings-jump');picker.value='settings-deepseek';picker.dispatchEvent(new win.Event('change',{bubbles:true}));
     await Zotero.Promise.delay(700);
     const heading=ui.querySelector('#settings-deepseek h3').getBoundingClientRect(),locator=ui.querySelector('.settings-locator').getBoundingClientRect();
     check(ui.activeElement===ui.querySelector('#settings-deepseek h3')&&heading.top>=locator.bottom-1&&heading.bottom<win.innerHeight,'settings locator reaches visible heading with focus',{heading:heading.top,locator:locator.bottom});
     ui.querySelector('[data-tab="highlights"]').click();ui.getElementById('jump-review').click();await Zotero.Promise.delay(700);
     const reviewHeading=ui.getElementById('heading-review').getBoundingClientRect(),jump=ui.querySelector('.document-jump').getBoundingClientRect();
     check(ui.activeElement.id==='heading-review'&&reviewHeading.top>=jump.bottom-1&&reviewHeading.bottom<win.innerHeight,'review shortcut reaches second document with focus',{heading:reviewHeading.top,jump:jump.bottom});
     ui.getElementById('jump-prompts').click();await Zotero.Promise.delay(700);
     check(ui.getElementById('tab-settings').classList.contains('active')&&ui.activeElement===ui.querySelector('.summary-prompts h3'),'prompt shortcut reaches settings without changing drafts');
     Services.prefs.setIntPref('ui.prefersReducedMotion',0);
     await wait(()=>!win.matchMedia('(prefers-reduced-motion:reduce)').matches,'normal motion preference');
     ui.querySelector('[data-tab="chat"]').click();await Zotero.Promise.delay(300);
     const bar=ui.querySelector('.tabs'),start=win.getComputedStyle(bar,'::before').transform;
     ui.querySelector('[data-tab="notes"]').click();await Zotero.Promise.delay(70);const middle=win.getComputedStyle(bar,'::before').transform;
     await Zotero.Promise.delay(300);const end=win.getComputedStyle(bar,'::before').transform;
     check(start!==middle&&middle!==end&&bar.dataset.active==='notes','tab indicator animates through intermediate positions without changing layout',{start,middle,end});
     if(__MOTION_CAPTURE__) {
      const movie=ui.createElement('canvas');movie.width=340;movie.height=760;const ctx=movie.getContext('2d'),frameDir=PathUtils.join(dir,'motion-frames');await IOUtils.makeDirectory(frameDir,{ignoreExisting:true});let index=0;const timing=[];
      for(const name of ['chat','notes','highlights','chat']){
       ui.querySelector('[data-tab="'+name+'"]').click();
       for(let i=0;i<18;i++){
        timing.push(Date.now());ctx.drawWindow(win,0,0,340,760,'white');
        await IOUtils.write(PathUtils.join(frameDir,String(index++).padStart(3,'0')+'.png'),Uint8Array.from(atob(movie.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));
        await Zotero.Promise.delay(45);
       }
      }
      await IOUtils.writeUTF8(PathUtils.join(frameDir,'timing.json'),JSON.stringify(timing));
      check(index===72,'native motion preview records actual interface frames');
     }
     const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
     for(const dark of [false,true]) {
      Services.prefs.setIntPref('ui.systemUsesDarkTheme',dark?1:0);await wait(()=>win.matchMedia('(prefers-color-scheme:dark)').matches===dark,'theme applied');
      check(win.matchMedia('(prefers-color-scheme:dark)').matches===dark,(dark?'dark':'light')+' system theme applied');
      const rootStyle=win.getComputedStyle(ui.documentElement),probe=ui.createElement('span');probe.style.color=rootStyle.getPropertyValue('--muted');probe.style.backgroundColor=rootStyle.getPropertyValue('--bg');ui.body.append(probe);
      const cs=win.getComputedStyle(probe),a=luminance(cs.color),b=luminance(cs.backgroundColor),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);probe.remove();
      check(ratio>=4.5,(dark?'dark':'light')+' secondary text contrast meets 4.5:1',{ratio});
      if(dark){ui.querySelector('[data-tab="chat"]').click();await capture('layout-chat-dark');ui.querySelector('[data-tab="notes"]').click();await capture('layout-notes-dark');}
     }
     Services.prefs.setIntPref('ui.systemUsesDarkTheme',0);Services.prefs.setIntPref('ui.prefersReducedMotion',1);await wait(()=>win.matchMedia('(prefers-reduced-motion:reduce)').matches,'reduced motion preference');
     ui.querySelector('[data-tab="translate"]').click();
     check(win.matchMedia('(prefers-reduced-motion:reduce)').matches&&win.getComputedStyle(ui.getElementById('tab-translate')).animationName==='none'&&win.getComputedStyle(ui.getElementById('translate')).transitionDuration==='0s'&&win.getComputedStyle(ui.getElementById('tab-settings')).scrollBehavior==='auto','reduced motion disables animation, transitions and smooth scrolling');
     Services.prefs.clearUserPref('ui.prefersReducedMotion');
    }
    ui.querySelector('[data-tab="settings"]').click();ui.querySelector('.summary-prompts').scrollIntoView({block:'start'});await capture('layout-prompt-settings');
    ui.querySelector('[data-tab="highlights"]').click();ui.getElementById('review-now').scrollIntoView({block:'center'});await capture('layout-review');
    check(networkCalls===0,'navigation, theme and capture make zero network requests',{networkCalls});layout={checks,inventory};
   }
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,exampleOnly:true,shots,layout},null,2));
  }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,shots,debug},null,2));}
  finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){showcaseChrome?.destruct();}
function install(){}
function uninstall(){}
