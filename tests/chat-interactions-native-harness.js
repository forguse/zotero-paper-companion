// Native Gecko interaction regressions. Synthetic paper and messages, no accounts.
var interactionsChrome;
function startup({rootURI}) {
 interactionsChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup)
  .registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-audit','content/']]);
 (async()=>{
  const output='__OUTPUT__',results=[],shots=[],metrics=[],chatTrace=[],activationRestores=[];let debug=()=>({}),stopTracing=()=>{};
  const check=(ok,label,detail)=>{if(!ok)throw Error(label+' '+JSON.stringify(detail||''));results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<240;i++){if(fn())return;await Zotero.Promise.delay(40);}throw Error('Timeout '+label);};
  const pause=()=>Zotero.Promise.delay(190);
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
   const pc=Zotero.PaperCompanion,main=Zotero.getMainWindow();let requests=0;
   pc.request=async()=>{requests++;throw Error('Interaction checks stay offline');};
   Services.prefs.setIntPref('ui.prefersReducedMotion',0);
   await pc.saveSettings({chatProvider:'deepseek',headerCollapsed:false,chatOptionsCollapsed:true,materialsCollapsed:true,smartReading:false});
   await pc.saveAppearance({theme:'cloud',appearanceMotion:'off'});
   const parent=new Zotero.Item('journalArticle');parent.setField('title','交互回归：阅读、输入与设置导航');await parent.saveTx();
   const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});await Zotero.Reader.open(item.id);const paper=await pc.paperInfo(item.id),session=await pc.session(paper.key);
   const longQuestion='请解释这篇论文的方法，并说明哪些实验支持核心结论。 Compare the evidence, assumptions and limitations before making a claim. '.repeat(3);
   const readingSection=i=>`### 阅读段落 ${i+1}\n\n先核对证据，再判断方法的适用范围。保留当前阅读位置，不应被滚动条或输入区挡住。 Evidence should connect the research question, experimental comparison and stated limitations.\n\n- 列表中的长句也应留在阅读内容区内，不能伸进最右侧的滚动轨道。 Reproducible evidence needs a clear comparison.\n\n> 这是用于布局验证的原文引用。 The quoted evidence remains readable beside an independently reserved scrolling track.\n\n\`\`\`text\nscore = evaluate_evidence(assumptions, comparisons, limitations)\nreading_marker_${i+1}_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n\`\`\``;
   session.messages=[{role:'user',text:longQuestion,status:'complete',at:1},{role:'assistant',provider:'deepseek',model:'deepseek-flash',text:Array.from({length:16},(_,i)=>readingSection(i)).join('\n\n'),status:'complete',at:2}];await pc.saveSession(paper.key);
   pc.saveNote(paper.key,'# 直接编辑的笔记\n\nLOCAL_MATCH 是开头的待核对内容。\n\n'+Array.from({length:45},(_,i)=>`阅读记录 ${i+1}：核对实验设置、证据范围和待验证的问题。`).join('\n\n')+'\n\nLOCAL_MATCH 是末尾的待核对内容。\n');await pc.flushNotes();
   const holder=main.openDialog('chrome://paper-companion-audit/content/viewport.xhtml','paper-companion-interactions','chrome,dialog=no,resizable,width=920,height=1000');
   await wait(()=>holder.document?.readyState==='complete'&&holder.document.body,'viewport');holder.focus();
   // An independently scrolling host recreates Zotero's outer item-pane scroll.
   const outer=holder.document.createElementNS('http://www.w3.org/1999/xhtml','div');outer.style.cssText='height:620px;overflow:auto;width:780px';holder.document.body.append(outer);
   const frame=holder.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');frame.style.cssText='display:block;border:0;width:520px;height:820px';Cu.waiveXrays(frame).paperCompanionArgs={api:pc,embedded:true,readerID:paper.id};frame.src=pc.resourceURL('panel.xhtml');outer.append(frame);
   await wait(()=>frame.contentDocument?.body?.dataset.ready==='true','panel');const win=frame.contentWindow,doc=win.document,$=id=>doc.getElementById(id),tab=name=>$('nav-'+name).click();
   const rect=node=>node.getBoundingClientRect().toJSON(),bottom=()=>Math.abs($('messages').scrollHeight-$('messages').clientHeight-$('messages').scrollTop)<=2;
   // Transparent observation only: collect the real view's state at its normal
   // method boundaries and real DOM input events. Never set follow/visibility.
   let observedView=null;
   const trace=(phase,event=null)=>{
    const scroller=$('messages'),view=observedView;
    chatTrace.push({phase,at:win.performance.now(),width:win.innerWidth,active:doc.querySelector('.tabs').dataset.active,
     event:event?{type:event.type,trusted:event.isTrusted,target:event.target?.id||event.target?.localName,current:event.currentTarget?.id||event.currentTarget?.localName,defaultPrevented:event.defaultPrevented,phase:event.eventPhase}:null,
     rootConnected:scroller.isConnected,top:scroller.scrollTop,height:scroller.clientHeight,total:scroller.scrollHeight,latestHidden:$('chat-latest').hidden,
     view:view?{sameRoot:view.root===scroller,sameLatest:view.latest===$('chat-latest'),closed:!!view.closed,follow:view.follow,scope:view.scope,entries:view.entries.size,
      anchor:view.layoutAnchor?{bottom:!!view.layoutAnchor.bottom,offset:view.layoutAnchor.offset,scrollTop:view.layoutAnchor.scrollTop}:null,layoutUntil:view.layoutUntil,layoutTimer:!!view.layoutTimer,
      reconcilesGesture:String(view.interruptLayout).includes('root.clientHeight > 0')}:null});
    if(chatTrace.length>240)chatTrace.shift();
   };
   // A hidden Gecko document may never schedule rAF. Each paint attempt has an
   // independent timer bound, then flushes native layout and yields normally.
   const nativePaint=async label=>{
    doc.documentElement.getBoundingClientRect();let frameID;
    const native=await Promise.race([new Promise(resolve=>{frameID=win.requestAnimationFrame(()=>resolve(true));}),Zotero.Promise.delay(120).then(()=>false)]);
    if(!native)win.cancelAnimationFrame(frameID);
    const canvas=doc.createElement('canvas');canvas.width=canvas.height=1;canvas.getContext('2d').drawWindow(win,0,0,1,1,'white');
    await Zotero.Promise.delay(20);metrics.push({kind:'bounded-native-paint',label,native,hidden:doc.hidden,hostHidden:holder.document.hidden});trace('paint:'+label+(native?':raf':':drawWindow-fallback'));
   };
   const nativeInputReady=async label=>{
    holder.restore();holder.focus();
    const context=holder.browsingContext;
    if(doc.hidden&&context&&typeof context.forceAppWindowActive==='boolean'&&!context.forceAppWindowActive){
     activationRestores.push({object:context,key:'forceAppWindowActive',value:context.forceAppWindowActive});context.forceAppWindowActive=true;
    }else if(doc.hidden&&holder.docShell&&'isActive'in holder.docShell&&!holder.docShell.isActive){
     activationRestores.push({object:holder.docShell,key:'isActive',value:holder.docShell.isActive});holder.docShell.isActive=true;
    }
    await nativePaint(label+':first');await nativePaint(label+':second');
    await wait(()=>!holder.document.hidden&&!doc.hidden,'visible disposable input document '+label);
   };
   const proto=Cu.waiveXrays(win).PCChatView.prototype,originalMethods=new Map();
   for(const name of ['controls','reset','update','layout']){
    const original=proto[name];originalMethods.set(name,original);
    proto[name]=function(...args){const owned=this.root===$('messages');if(owned){observedView=this;trace(name+':before');}try{return original.apply(this,args);}finally{if(owned)trace(name+':after');}};
   }
   const eventListeners=[];
   for(const type of ['wheel','scroll','pointerdown','keydown'])for(const capture of [true,false]){
    const listener=event=>trace(type+(capture?':capture':':bubble'),event);
    $('messages').addEventListener(type,listener,{capture,passive:true},true);eventListeners.push([type,listener,capture]);
   }
   const mutations=new win.MutationObserver(records=>{for(const record of records)trace(record.target===$('chat-latest')?'latest:hidden-mutation':'messages:children-mutation');});
   mutations.observe($('messages'),{childList:true});mutations.observe($('chat-latest'),{attributes:true,attributeFilter:['hidden']});
   stopTracing=()=>{mutations.disconnect();for(const [type,listener,capture]of eventListeners)$('messages').removeEventListener(type,listener,capture);for(const [name,original]of originalMethods)proto[name]=original;};
   const capture=async name=>{await pause();await doc.fonts.ready;const c=doc.createElement('canvas');c.width=win.innerWidth;c.height=win.innerHeight;c.getContext('2d').drawWindow(win,0,0,c.width,c.height,'white');const path=PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),v=>v.charCodeAt(0)));shots.push(path);};
   const readingGap=label=>{
    const shell=rect(doc.querySelector('.chat-log')),composer=rect(doc.querySelector('.composer')),gap=composer.top-shell.bottom;
    check(gap>=6-.5&&gap<=10+.5,label+' retains a distinct 6–10px gap between the reading shell and composer',{shell,composer,gap});return gap;
   };
   const scrollbarSafety=(width,scale)=>{
    const scroller=$('messages'),shell=doc.querySelector('.chat-log'),bounds=rect(scroller),viewport={left:bounds.left+scroller.clientLeft,top:bounds.top+scroller.clientTop,right:bounds.left+scroller.clientLeft+scroller.clientWidth,bottom:bounds.top+scroller.clientTop+scroller.clientHeight};
    check(scroller.scrollHeight>scroller.clientHeight+1,`${scale}x ${width} safety check exercises actual vertical overflow`,{clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight});
    check(scroller.scrollWidth<=scroller.clientWidth+1,`${scale}x ${width} long prose and code do not force horizontal conversation scrolling`,{clientWidth:scroller.clientWidth,scrollWidth:scroller.scrollWidth});
    const bubbles=[...scroller.querySelectorAll('.message.user>.message-body')].map(node=>({right:rect(node).right,text:node.textContent.slice(0,36)}));
    check(bubbles.length>0&&bubbles.every(b=>viewport.right-b.right>=9),`${scale}x ${width} user bubbles leave at least 10px for the scrolling track`,{viewport,bubbles});
    const visible=[],types=new Set(),walker=doc.createTreeWalker(scroller,win.NodeFilter.SHOW_TEXT);
    for(let node;node=walker.nextNode();){
     if(!node.textContent.trim()||!node.parentElement.closest('.message-body'))continue;
     const range=doc.createRange();range.selectNodeContents(node);
     for(const fragment of range.getClientRects()){
      if(fragment.height<=0||fragment.bottom<=viewport.top||fragment.top>=viewport.bottom)continue;
      // Text inside a horizontally scrollable code block is clipped by that
      // block. Measure the part that is actually paintable, not hidden glyphs.
      let right=fragment.right,left=fragment.left;
      for(let ancestor=node.parentElement;ancestor&&ancestor!==scroller;ancestor=ancestor.parentElement){
       if(/^(auto|scroll|hidden|clip)$/.test(win.getComputedStyle(ancestor).overflowX)){
        const clip=rect(ancestor);right=Math.min(right,clip.left+ancestor.clientLeft+ancestor.clientWidth);left=Math.max(left,clip.left+ancestor.clientLeft);
       }
      }
      if(right<=left||right<=viewport.left||left>=viewport.right)continue;
      const parent=node.parentElement,type=parent.closest('.message.user')?'user':parent.closest('pre')?'code':parent.closest('blockquote')?'quote':parent.closest('li')?'list':'paragraph';types.add(type);
      visible.push({right,clearance:viewport.right-right,type,text:node.textContent.trim().slice(0,42)});
     }
    }
    check(visible.length>0,`${scale}x ${width} scrollbar check measures painted text ranges`);
    check(visible.every(fragment=>fragment.clearance>=9),`${scale}x ${width} visible text stays at least 10px clear of the scrolling track`,{viewport,violations:visible.filter(fragment=>fragment.clearance<9)});
    metrics.push({kind:'scrollbar-safety',width,scale,viewport,shell:rect(shell),gap:readingGap(`${scale}x ${width}`),minimumTextClearance:Math.min(...visible.map(fragment=>fragment.clearance)),minimumBubbleClearance:Math.min(...bubbles.map(b=>viewport.right-b.right)),types:[...types]});
    return types;
   };
   debug=()=>({outerScroll:outer.scrollTop,paneScroll:$('tab-settings').scrollTop,nav:rect(doc.querySelector('.tabs')),notice:$('notice').textContent,active:doc.querySelector('.tabs').dataset.active,width:win.innerWidth,height:win.innerHeight,composer:rect(doc.querySelector('.composer')),messages:{top:$('messages').scrollTop,height:$('messages').clientHeight,total:$('messages').scrollHeight,latestHidden:$('chat-latest').hidden,latest:rect($('chat-latest'))},chatTrace});
   check(doc.querySelectorAll('.tabs>button').length===6,'all six workspaces still exist');
   for(const [width,height]of [[260,430],[340,760],[520,900]]) {
    frame.style.width=width+'px';frame.style.height=height+'px';await wait(()=>win.innerWidth===width&&win.innerHeight===height,'resize');outer.scrollTop=0;tab('highlights');await pause();const navBefore=rect(doc.querySelector('.tabs'));
    $('jump-prompts').click();await pause();
    const settings=$('tab-settings'),locator=doc.querySelector('.settings-locator'),control=$('settings-jump'),sr=rect(settings),lr=rect(locator),cr=rect(control),navAfter=rect(doc.querySelector('.tabs'));
    metrics.push({width,height,settings:sr,locator:lr,control:cr,outerScroll:outer.scrollTop});
    check(settings.classList.contains('active')&&settings.scrollTop>0,`${width} prompt shortcut navigates inside settings`);
    check(outer.scrollTop===0&&Math.abs(navBefore.top-navAfter.top)<1&&navAfter.top>=0,`${width} prompt shortcut never moves the Zotero host or hides navigation`,{outer:outer.scrollTop,navBefore,navAfter});
    check(lr.top>=sr.top-1&&cr.top>=sr.top+4,`${width} sticky locator and its focused control remain inside the settings scrollport`,{sr,lr,cr});
    check(Math.abs(lr.top-sr.top)<1,`${width} scrolled locator covers the settings scrollport from its very top`,{sr,lr});
    // Gecko's overlay scrollbar can occupy the last few CSS pixels without
    // reducing clientWidth. Probe the locator's content, then inspect the whole
    // band separately: the scrollframe itself is a legal scrollbar hit, but a
    // previous card or any of its text-bearing descendants is never legal.
    const topHits=[.08,.5,.9].map(f=>({x:lr.left+lr.width*f,node:doc.elementFromPoint(lr.left+lr.width*f,sr.top+2)}));
    check(topHits.every(({node})=>locator===node||locator.contains(node)),`${width} sticky locator content covers the top band`,topHits.map(({x,node})=>({x,hit:node?.id||node?.className||node?.localName})));
    const bandHits=[];for(let x=lr.left+1;x<lr.right;x+=4)for(const y of [sr.top+2,sr.top+6])bandHits.push({x,y,node:doc.elementFromPoint(x,y)});
    check(bandHits.every(({node})=>node===settings||node===locator||locator.contains(node)),`${width} no previous settings card leaks above the sticky locator`,bandHits.filter(({node})=>node!==settings&&node!==locator&&!locator.contains(node)).map(({x,y,node})=>({x,y,hit:node?.id||node?.className||node?.localName})));
    metrics[metrics.length-1].topBand=bandHits.map(({x,y,node})=>({x,y,hit:node?.id||node?.className||node?.localName}));
    check(cr.left>=sr.left+4&&cr.right<=sr.right-4&&control.scrollWidth<=control.clientWidth+1&&settings.scrollWidth<=settings.clientWidth+1,`${width} locator retains both horizontal gutters without overflow`,{sr,cr});
    settings.scrollTo({top:0,behavior:'instant'});await pause();
    check(settings.scrollTop===0&&rect(settings.querySelector('.section-heading')).top>=rect(settings).top&&outer.scrollTop===0,`${width} settings can return fully to the top`);
    for(const target of ['settings-folder','settings-deepseek','settings-prompts','settings-questions']){$('settings-jump').value=target;$('settings-jump').dispatchEvent(new win.Event('change'));await pause();check(outer.scrollTop===0&&$('settings-jump').value===''&&rect(doc.querySelector('.tabs')).top>=0,`${width} ${target} quick jump stays local and resets the select`);}
    tab('chat');await pause();const scrollport=$('messages');
    await wait(()=>scrollport.clientHeight>0&&$('tab-chat').classList.contains('active')&&!$('composer-fields').getAnimations().some(a=>a.playState==='running'),'chat layout ready '+width);
    await nativeInputReady('backread-'+width);trace('backread:layout-settled');
    check(scrollport.scrollHeight>scrollport.clientHeight+64,`${width} menu overlap fixture has enough real history to leave the latest answer`);
    // Backreading is a user gesture: interrupt any still-settling tab-layout
    // anchor before scrolling. A programmatic scroll alone during that anchor
    // is deliberately restored by the product's reading-position protection.
    const wheelBounds=rect(scrollport),wheelX=wheelBounds.left+wheelBounds.width/2,wheelY=wheelBounds.top+Math.min(wheelBounds.height/2,40),wheelHit=doc.elementFromPoint(wheelX,wheelY);
    check(scrollport===wheelHit||scrollport.contains(wheelHit),`${width} native backreading wheel targets the actual conversation viewport`,{wheelBounds,wheelX,wheelY,hit:wheelHit?.id||wheelHit?.localName});
    trace('backread:before-native-wheel');
    // nsIDOMWindowUtils supplies a trusted Gecko input event. dispatchEvent's
    // untrusted WheelEvent is not equivalent in a privileged chrome document.
    win.windowUtils.sendWheelEvent(wheelX,wheelY,0,-120,0,0,0,0,-3,0);trace('backread:after-native-wheel');
    scrollport.scrollTo({top:0,behavior:'instant'});trace('backread:after-scroll-to-history');
    await nativePaint('history-top-'+width+':first');await nativePaint('history-top-'+width+':second');
    check(scrollport.scrollTop<=1,`${width} continued backreading starts at the actual history top`);
    // In an offscreen native iframe APZ can defer scroll notifications after a
    // programmatic position change. Continue with a second trusted user wheel
    // at the now-established history top. Its zero-movement gesture must let
    // the production handler reconcile follow without a fabricated scroll.
    trace('backread:before-continued-native-wheel');win.windowUtils.sendWheelEvent(wheelX,wheelY,0,-120,0,0,0,0,-3,0);trace('backread:after-continued-native-wheel');
    await wait(()=>scrollport.scrollTop<=1&&!$('chat-latest').hidden&&rect($('chat-latest')).height>0,'visible return-to-latest before menu '+width);
    check(scrollport.scrollHeight-scrollport.clientHeight-scrollport.scrollTop>64&&!$('chat-latest').hidden,`${width} manual backreading exposes the real return-to-latest control before opening menus`);
    const composer=doc.querySelector('.composer'),before=rect(composer),promptHeight=rect($('prompt')).height;
    $('quick-toggle').click();await pause();check(!$('quick-menu').hidden&&Math.abs(rect(composer).height-before.height)<1&&Math.abs(rect($('prompt')).height-promptHeight)<1,`${width} frequent questions float without growing the composer`);
    check(win.getComputedStyle($('quick-menu')).position==='absolute'&&rect($('quick-menu')).bottom<=rect(composer).top,`${width} frequent questions appear above the input`);
    const menuRect=rect($('quick-menu')),latestRect=rect($('chat-latest')),overlap={left:Math.max(menuRect.left,latestRect.left),right:Math.min(menuRect.right,latestRect.right),top:Math.max(menuRect.top,latestRect.top),bottom:Math.min(menuRect.bottom,latestRect.bottom)};
    check(!$('chat-latest').hidden&&overlap.right>overlap.left&&overlap.bottom>overlap.top,`${width} overlap regression exercises a visible return-to-latest control behind the menu`,{menuRect,latestRect,overlap});
    const hit=doc.elementFromPoint((overlap.left+overlap.right)/2,(overlap.top+overlap.bottom)/2);
    check($('quick-menu').contains(hit),`${width} frequent-question menu wins the actual hit test over return-to-latest`,{hit:hit?.id||hit?.localName,overlap});$('quick-toggle').click();
    const reading=rect(doc.querySelector('.chat-log'));check(Math.abs(reading.left-before.left)<1&&Math.abs(reading.right-before.right)<1,`${width} reading and composer share the same left and right edges`,{reading,before});
    readingGap(`${width} expanded composer`);
    const cs=win.getComputedStyle(composer);check(['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].every(k=>parseFloat(cs[k])===14),`${width} composer retains four matching rounded corners`);
    // This phase tests resumed follow, separately from the backreading phase
    // above. Use the actual user action that resumes follow synchronously;
    // changing scrollTop alone does not establish that conversation state.
    $('chat-latest').click();await wait(()=>bottom()&&$('chat-latest').hidden,'return to latest resumes follow '+width);await pause();
    check(bottom()&&$('chat-latest').hidden,`${width} returning to latest explicitly restores follow before testing composer changes`);
    const toggleBefore=rect($('composer-toggle')),foldState=()=>({expanded:$('composer-toggle').getAttribute('aria-expanded'),fieldsHidden:$('composer-fields').hidden,fieldsHeight:$('composer-fields').getBoundingClientRect().height,animations:$('composer-fields').getAnimations().map(a=>a.playState),scrollTop:$('messages').scrollTop,scrollHeight:$('messages').scrollHeight,clientHeight:$('messages').clientHeight,bottomDistance:$('messages').scrollHeight-$('messages').clientHeight-$('messages').scrollTop,latestHidden:$('chat-latest').hidden});
    $('composer-toggle').click();await pause();await wait(()=>$('composer-fields').hidden&&$('composer-toggle').getAttribute('aria-expanded')==='false'&&!$('composer-fields').getAnimations().some(a=>a.playState==='running'),'composer collapse settled '+width);const toggleFolded=rect($('composer-toggle'));metrics.push({kind:'composer-collapse',width,state:foldState()});check(bottom()&&Math.abs(toggleBefore.right-toggleFolded.right)<1&&Math.abs(toggleBefore.width-toggleFolded.width)<1,`${width} collapse keeps the same right-hand target and the last answer visible`,{toggleBefore,toggleFolded,state:foldState()});
    readingGap(`${width} collapsed composer`);
    $('composer-toggle').click();await pause();await wait(()=>!$('composer-fields').hidden&&$('composer-toggle').getAttribute('aria-expanded')==='true'&&!$('composer-fields').getAnimations().some(a=>a.playState==='running'),'composer reopen settled '+width);const toggleAfter=rect($('composer-toggle'));metrics.push({kind:'composer-reopen',width,state:foldState()});check(bottom()&&Math.abs(toggleBefore.right-toggleAfter.right)<1&&Math.abs(toggleBefore.width-toggleAfter.width)<1,`${width} reopen retains the same target and bottom reading anchor`,{toggleBefore,toggleAfter,state:foldState()});
    readingGap(`${width} reopened composer`);
   }
   // Windows/Gecko may draw an overlay scrollbar without subtracting its width
   // from clientWidth. Actual text ranges and bubble edges must still leave a
   // clear strip, independently of the operating-system scrollbar preference.
   const originalScale=win.devicePixelRatio;
   for(const scale of [1,1.5,2]){
    Services.prefs.setCharPref('layout.css.devPixelsPerPx',String(scale));await wait(()=>Math.abs(win.devicePixelRatio-scale)<.03,'scrollbar render scale '+scale);holder.resizeTo(960,1000);
    for(const [width,height]of [[260,430],[340,760],[520,900]]){
     frame.style.width=width+'px';frame.style.height=height+'px';await wait(()=>win.innerWidth===width&&win.innerHeight===height,'scrollbar viewport');outer.scrollTop=0;tab('chat');await pause();
     const scroller=$('messages'),assistant=scroller.querySelector('.message.assistant>.message-body'),samples=[scroller.querySelector('.message.user>.message-body'),...['p','li','blockquote','pre'].map(selector=>assistant.querySelector(selector)),assistant.lastElementChild],covered=new Set();
     for(const sample of samples){scroller.scrollTop+=sample.getBoundingClientRect().top-scroller.getBoundingClientRect().top-6;for(const type of scrollbarSafety(width,scale))covered.add(type);}
     check(['user','paragraph','list','quote','code'].every(type=>covered.has(type)),`${scale}x ${width} safety check covers user text, prose, list, quote and code`,[...covered]);
     scroller.scrollTop=scroller.scrollHeight;await pause();check(bottom(),`${scale}x ${width} the final answer remains reachable above the separated composer`);
     if(width===340)await capture('scrollbar-space-'+String(scale).replace('.','-'));
    }
   }
   Services.prefs.clearUserPref('layout.css.devPixelsPerPx');await wait(()=>Math.abs(win.devicePixelRatio-originalScale)<.03,'restore original native render scale');
   frame.style.width='260px';frame.style.height='430px';await wait(()=>win.innerWidth===260&&win.innerHeight===430,'fully expanded short viewport');
   await pc.saveSettings({headerCollapsed:false,chatOptionsCollapsed:false,materialsCollapsed:false});tab('chat');await pause();
   const shortSend=rect($('send')),shortLog=rect(doc.querySelector('.chat-log')),fields=$('composer-fields');
   check($('messages').clientHeight>=40&&shortLog.height>=40,'fully expanded 260 by 430 viewport reserves at least 40px for replies',{replyHeight:$('messages').clientHeight,shortLog});
   check(shortSend.top>=0&&shortSend.bottom<=win.innerHeight&&$('send').contains(doc.elementFromPoint((shortSend.left+shortSend.right)/2,(shortSend.top+shortSend.bottom)/2)),'fully expanded short viewport keeps the actual send button visible and clickable',shortSend);
   check(fields.clientHeight>0&&fields.scrollHeight>fields.clientHeight&&win.getComputedStyle(fields).overflowY==='auto','fully expanded short viewport scrolls material and prompt fields instead of clipping replies');
   readingGap('fully expanded short viewport');
   fields.scrollTop=fields.scrollHeight;await capture('short-window-expanded-controls');
   await pc.saveSettings({chatOptionsCollapsed:true,materialsCollapsed:true});frame.style.width='520px';frame.style.height='900px';await wait(()=>win.innerWidth===520&&win.innerHeight===900,'restore after short viewport');await pause();
   outer.scrollTop=37;tab('highlights');await pause();const hostPosition=rect(frame);$('jump-prompts').click();await pause();
   check(outer.scrollTop===37&&Math.abs(rect(frame).top-hostPosition.top)<1,'prompt shortcut preserves an already-scrolled outer Zotero host',{scroll:outer.scrollTop,hostPosition,after:rect(frame)});
   tab('notes');await pause();outer.scrollTop=37;const noteHost=rect(frame);$('note-find-toggle').click();await pause();
   check(outer.scrollTop===37&&Math.abs(rect(frame).top-noteHost.top)<1,'opening note search preserves the outer Zotero host');
   $('note-query').value='LOCAL_MATCH';$('note-query').dispatchEvent(new win.Event('input'));const editor=$('note-preview');
   for(const [index,action]of [[0,'note-find-next'],[1,'note-find-next'],[0,'note-find-prev']]){
    $(action).click();await pause();const selection=win.getSelection(),range=selection.getRangeAt(0),hit=range.getBoundingClientRect(),box=editor.getBoundingClientRect();
    check(selection.toString()==='LOCAL_MATCH'&&$('note-find-count').textContent===`${index+1}/2`,'note search selects the exact '+(index?'last':'first')+' match');
    check(hit.height>0&&hit.top>=box.top+editor.clientTop-1&&hit.bottom<=box.top+editor.clientTop+editor.clientHeight+1,'note search brings the '+(index?'last':'first')+' selected match inside its editor viewport',{hit:hit.toJSON(),box:box.toJSON(),scroll:editor.scrollTop});
    check(outer.scrollTop===37&&Math.abs(rect(frame).top-noteHost.top)<1,'note search scrolls only its editor for match '+(index+1));
   }
   await capture('note-search-local-scroll');$('note-find-toggle').click();
   frame.style.width='520px';frame.style.height='900px';await wait(()=>win.innerWidth===520,'motion viewport');outer.scrollTop=0;tab('chat');await pc.saveAppearance({appearanceMotion:'standard'});await pause();
   $('messages').scrollTop=$('messages').scrollHeight;await pause();$('materials-toggle').click();const materialAnimation=$('material-options').getAnimations().find(a=>a.effect?.target===$('material-options'));
   check(!!materialAnimation&&materialAnimation.effect.getTiming().duration<=160,'material expansion starts a short native height animation immediately');await pause();check(!$('material-options').hidden&&bottom(),'material expansion keeps the final answer above the composer');
   $('materials-toggle').click();await pause();check($('material-options').hidden&&bottom(),'material collapse finishes cleanly and retains the bottom anchor');
   // A delayed disk write must not delay visual acknowledgment of a disclosure.
   const save=pc.saveSettings.bind(pc);let release;pc.saveSettings=async patch=>{if('chatOptionsCollapsed'in patch)await new Promise(resolve=>{release=resolve;});return save(patch);};
   $('chat-options-toggle').click();check($('chat-options-toggle').getAttribute('aria-expanded')==='true'&&!!release,'model selector responds before its preference finishes saving');release();await pause();pc.saveSettings=save;
   await save({chatOptionsCollapsed:true});await pause();pc.saveSettings=async patch=>{if('chatOptionsCollapsed'in patch)throw Error('SIMULATED_LAYOUT_SAVE_FAILURE');return save(patch);};$('chat-options-toggle').click();await pause();pc.saveSettings=save;
   check($('chat-options').hidden&&$('notice').textContent.includes('SIMULATED_LAYOUT_SAVE_FAILURE'),'failed disclosure preference rolls back and reports the save failure');$('notice-dismiss').click();
   tab('translate');check($('tab-translate').classList.contains('active'),'workspace switches synchronously without waiting for provider or disk work');const pageAnimation=$('tab-translate').getAnimations().find(a=>a.effect?.target===$('tab-translate'));check(!!pageAnimation&&pageAnimation.effect.getTiming().duration<=120,'workspace reveal uses a short native opacity animation');
   await pc.saveAppearance({appearanceMotion:'reduced'});tab('chat');$('materials-toggle').click();check(!$('material-options').hidden&&!$('material-options').getAnimations().length,'reduced motion opens controls immediately without a height animation');$('materials-toggle').click();await pause();check($('material-options').hidden,'reduced motion closes controls immediately');
   // A manual scroll during a layout change takes precedence over automatic follow.
   await pc.saveAppearance({appearanceMotion:'standard'});$('messages').scrollTop=$('messages').scrollHeight;await pause();$('materials-toggle').click();$('messages').dispatchEvent(new win.WheelEvent('wheel',{bubbles:true,deltaY:-120}));$('messages').scrollTop=0;await pause();check($('messages').scrollTop===0,'manual backreading interrupts a pending layout anchor');
   await pc.saveAppearance({appearanceMotion:'off'});tab('highlights');$('jump-prompts').click();await capture('settings-prompt-shortcut');$('tab-settings').scrollTo({top:0,behavior:'instant'});await capture('settings-top-reachable');tab('chat');$('quick-toggle').click();await capture('floating-frequent-questions');
   check(requests===0,'navigation, disclosures and appearance checks make no model requests');
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,results,shots,metrics,chatTrace},null,2));
  }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results,shots,metrics},null,2));}
  finally{try{stopTracing();}catch(_){}for(const restore of activationRestores.reverse())try{restore.object[restore.key]=restore.value;}catch(_){}Services.prefs.clearUserPref('layout.css.devPixelsPerPx');Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){interactionsChrome?.destruct();}function install(){}function uninstall(){}
