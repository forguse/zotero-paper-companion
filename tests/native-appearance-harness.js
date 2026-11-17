// Disposable registered-sidebar regression, including restartless upgrade.
function startup() {
 (async()=>{
  const output='__OUTPUT__',results=[],shots=[],states=[],metrics=[],resizes=[],geometryWaits=[];let diagnostics={};
  const check=(ok,label,detail)=>{if(!ok)throw Error(label+' '+JSON.stringify(detail||''));results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('Timeout '+label);};
  const pause=ms=>Zotero.Promise.delay(ms??200);
  const capture=async(win,name)=>{
   const c=win.document.createElement('canvas'),scale=win.devicePixelRatio;c.width=Math.round(win.innerWidth*scale);c.height=Math.round(win.innerHeight*scale);c.getContext('2d').scale(scale,scale);c.getContext('2d').drawWindow(win,0,0,win.innerWidth,win.innerHeight,'white');
   const path=PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),x=>x.charCodeAt(0)));shots.push(path);return c;
  };
  const inspect=win=>{const doc=win.document,s=n=>win.getComputedStyle(n),header=doc.querySelector('.workspace-header');return {version:Zotero.PaperCompanion.publicState().version,uri:doc.documentURI,width:win.innerWidth,height:win.innerHeight,dpr:win.devicePixelRatio,theme:doc.documentElement.dataset.pcTheme,header:win.getComputedStyle(header,':before').backgroundImage,body:s(doc.body).backgroundImage,tabs:s(doc.querySelector('.tabs')).backgroundImage,composerBorder:s(doc.querySelector('.composer')).borderTopColor,composerBackground:s(doc.querySelector('.composer')).backgroundColor,toggleBackground:s(doc.getElementById('theme-toggle')).backgroundColor,animations:doc.getAnimations().slice(0,12).map(a=>({target:a.effect?.target?.id||a.effect?.target?.className,property:a.transitionProperty,playState:a.playState,currentTime:a.currentTime})),motion:win.pcTheme.motion,enabled:win.pcTheme.edgeEnabled,reduce:win.matchMedia('(prefers-reduced-motion:reduce)').matches,sheets:Array.from(doc.styleSheets).map(sheet=>({href:sheet.href,rules:sheet.cssRules.length,hasMist:Array.from(sheet.cssRules).some(r=>r.cssText.includes('url("theme-cloud-mist.webp")'))}))};};
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
   let pc=Zotero.PaperCompanion;const main=Zotero.getMainWindow();main.resizeTo(1700,1100);let requests=0;pc.request=async()=>{requests++;throw Error('Appearance stays offline');};
   const parent=new Zotero.Item('journalArticle');parent.setField('title','具身智能中的主动感知：研究方法与实验依据');await parent.saveTx();const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});await Zotero.Reader.open(item.id);
   const paper=await pc.paperInfo(item.id),session=await pc.session(paper.key);session.messages=[{role:'user',text:'观测越多，理解就越好吗？',status:'complete',at:1},{role:'assistant',provider:'deepseek',text:'不一定。理解取决于信息质量、任务相关性与模型的归纳能力。\n\n### 阅读时重点核对\n\n1. 如何定义有用的信息？\n2. 是否设计了替代方案进行对照？\n3. 实验是否提供足够的证据？',status:'complete',at:2}];await pc.saveSession(paper.key);
   await pc.saveAppearance({theme:'blue',appearanceMotion:'standard',edgeLight:true});await pc.saveSettings({chatProvider:'deepseek',smartReading:false,headerCollapsed:false});await pc.openPanel({readerID:item.id});await wait(()=>pc.panel?.document?.body?.dataset.ready==='true','registered sidebar');
   states.push({stage:'initial',...inspect(pc.panel)});await capture(pc.panel,'initial-native-sidebar');
   if(pc.publicState().version!=='__EXPECTED_VERSION__') {
    const before=pc,manager=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs').AddonManager;
    const installer=await manager.getInstallForURL(PathUtils.toFileURI('__PACKAGE__'));
    await installer.install();await wait(()=>Zotero.PaperCompanion&&Zotero.PaperCompanion!==before,'upgraded plugin');pc=Zotero.PaperCompanion;pc.request=async()=>{requests++;throw Error('Appearance stays offline');};
    await pc.openPanel({readerID:item.id});await wait(()=>pc.panel?.document?.body?.dataset.ready==='true','upgraded sidebar');states.push({stage:'after-upgrade',...inspect(pc.panel)});await capture(pc.panel,'upgraded-native-sidebar');
   }
   const win=pc.panel,doc=win.document,$=id=>doc.getElementById(id),composer=doc.querySelector('.composer');check(pc.sidebar.frames.has(win.frameElement),'uses the actual registered Zotero sidebar');
   let resizeVersion=0;
   const geometry=()=>({viewport:[win.innerWidth,win.innerHeight,doc.documentElement.clientWidth,doc.documentElement.clientHeight],frame:win.frameElement.getBoundingClientRect().toJSON(),host:win.frameElement.parentElement.getBoundingClientRect().toJSON(),composer:composer.getBoundingClientRect().toJSON()});
   win.addEventListener('resize',event=>{resizeVersion++;resizes.push({version:resizeVersion,at:win.performance.now(),surface:'frame',target:event.target===win?'window':event.target.localName,...geometry()});});
   main.addEventListener('resize',()=>resizes.push({version:resizeVersion,at:win.performance.now(),surface:'host',hostViewport:[main.innerWidth,main.innerHeight],...geometry()}));
   const nativePaint=async()=>{doc.documentElement.getBoundingClientRect();let frame;const native=await Promise.race([new Promise(resolve=>{frame=win.requestAnimationFrame(()=>resolve(true));}),pause(120).then(()=>false)]);if(!native)win.cancelAnimationFrame(frame);const c=doc.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawWindow(win,0,0,1,1,'white');await pause(20);};
   const stableGeometry=async label=>{const began=Date.now();let previous='',version=resizeVersion,since=began,paints=0;while(Date.now()-began<6000){await nativePaint();const now=JSON.stringify(geometry());if(now!==previous||version!==resizeVersion){previous=now;version=resizeVersion;since=Date.now();paints=0;}else paints++;if(paints>=2&&Date.now()-since>=450){geometryWaits.push({label,elapsed:Date.now()-began,version,paints,geometry:geometry()});return;}}diagnostics={...inspect(win),resizeVersion,resizes:resizes.slice(-12),geometry:geometry()};throw Error('Native viewport geometry did not settle: '+label);};
   Services.prefs.setIntPref('ui.prefersReducedMotion',0);await pc.saveAppearance({appearanceMotion:'standard',edgeLight:true});await pause();
   // Keep a person's concurrent desktop input out of this disposable fixture.
   for(const type of ['pointerdown','click','keydown'])doc.addEventListener(type,e=>{e.preventDefault();e.stopImmediatePropagation();},true);
   let trusted=0,events=[],expectedPointer;doc.addEventListener('pointermove',e=>{if(expectedPointer&&Math.hypot(e.clientX-expectedPointer.x,e.clientY-expectedPointer.y)>1){e.stopImmediatePropagation();return;}if(e.isTrusted)trusted++;events.push({type:e.type,x:e.clientX,y:e.clientY,buttons:e.buttons,pointerType:e.pointerType});if(events.length>16)events.shift();},true);
   const pointer=async(x,y,delay=110)=>{expectedPointer={x,y};win.windowUtils.sendMouseEvent('mousemove',x,y,-1,0,0);await pause(delay);};
   for(const theme of ['cloud','blue','warm','dark']) {
    await pc.saveAppearance({theme,appearanceMotion:'off'});
    // A hidden Gecko view can coalesce two wall-clock preference updates into
    // one style update. Resolve surfaces while transitions are actually off,
    // otherwise a stale light border contaminates the dark pixel baseline.
    for(const node of doc.querySelectorAll('button,select,input,textarea,.composer,.tabs,.workspace-header')){const style=win.getComputedStyle(node);style.backgroundColor;style.borderTopColor;}
    const palette=win.PCore.surfacePalette(theme),rgb=value=>{const n=doc.createElement('span');n.style.color=value;return n.style.color;};
    check(win.getComputedStyle(composer).borderTopColor===rgb(palette.rule)&&win.getComputedStyle($('theme-toggle')).backgroundColor===rgb(palette.paper),theme+' resting surface colors settle before decorative motion resumes',inspect(win));
    await pause(100);await pc.saveAppearance({appearanceMotion:'standard'});await pause(100);states.push({stage:'final-'+theme,...inspect(win)});check(doc.documentElement.dataset.pcTheme===theme,theme+' remains the selected theme during native capture');await capture(win,'native-'+theme+'-rest');
    await stableGeometry(theme+' border contact');const edge=win.pcTheme.edgeLight,r=$('send').getBoundingClientRect(),cr=composer.getBoundingClientRect();
    // The first pointer move over a button is intentionally ignored before
    // geometry collection. Enter a real surface first, then verify exclusion.
    await pointer(cr.left+.2,cr.top+25);check(edge.overlay.dataset.active==='true'&&edge.overlay.dataset.target==='composer',theme+' native surface contact initializes border geometry');
    await pointer(r.left+r.width/2,r.top+.3);
    diagnostics={...inspect(win),trusted,events,rect:r.toJSON(),frames:edge.frames,edgeEnabled:edge.enabled,destroyed:edge.destroyed,active:edge.overlay.dataset.active,target:edge.overlay.dataset.target,pointer:edge.pointer,targets:edge.targets?.length,style:edge.overlay.style.cssText,lastClear:edge.lastClear};
    check(edge.overlay.dataset.target!=='send'&&!edge.targets.some(t=>t.node===$('send')),theme+' ordinary send button has no decorative tracking',diagnostics);await capture(win,'native-'+theme+'-edge');
    const state=states.at(-1);check(state.header!=='none'&&state.body!=='none'&&state.tabs!=='none',theme+' registered sidebar keeps all material backgrounds',state);
    edge.setEnabled(false);await pointer(cr.left+.2,cr.top+25);const before=await capture(win,'native-'+theme+'-border-before');edge.setEnabled(true);
    for(let y=cr.top+26;y<cr.bottom-25;y+=12)await pointer(cr.left+.2,y,20);await pause(80);
    check(edge.overlay.dataset.active==='true'&&edge.overlay.dataset.target==='composer',theme+' a native sweep follows the actual composer border');const after=await capture(win,'native-'+theme+'-border-after');
    const a=before.getContext('2d').getImageData(0,0,before.width,before.height).data,b=after.getContext('2d').getImageData(0,0,after.width,after.height).data,scale=win.devicePixelRatio;let strong=0,bodyChanges=0,max=0;
    for(let y=Math.ceil((cr.top+20)*scale);y<Math.floor((cr.bottom-20)*scale);y++)for(let x=Math.floor(cr.left*scale);x<Math.ceil((cr.left+2)*scale);x++){const i=(y*before.width+x)*4,d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));max=Math.max(max,d);if(d>=24)strong++;}
    for(let y=Math.ceil((cr.top+58)*scale);y<Math.floor((cr.bottom-38)*scale);y++)for(let x=Math.ceil((cr.left+50)*scale);x<Math.floor((cr.left+100)*scale);x++){const i=(y*before.width+x)*4;if([0,1,2].some(c=>a[i+c]!==b[i+c]))bodyChanges++;}
    metrics.push({theme,strongBorderPixels:strong,maxChannelDelta:max,bodyChanges,dpr:scale});check(strong>=24&&max>=35&&bodyChanges===0,theme+' native border is visibly contrasted and its interior pixels stay unchanged',metrics.at(-1));
    const boundary=$('workspace-frame');
    check(boundary&&boundary.getBoundingClientRect().width===win.innerWidth&&boundary.getBoundingClientRect().height===win.innerHeight,theme+' outer boundary fills the registered sidebar viewport');
    for(const side of ['top','right','bottom','left']){
     edge.setEnabled(false);await stableGeometry(theme+' outer '+side);
     // Keep native input within the border's 36px contact radius, beyond the
     // native scrollbar/resizer's hit zone at the iframe's extreme perimeter.
     const before=await capture(win,'native-'+theme+'-outer-'+side+'-before'),vertical=side==='left'||side==='right',x=side==='left'?4:side==='right'?win.innerWidth-4:win.innerWidth/2,y=side==='top'?4:side==='bottom'?win.innerHeight-4:win.innerHeight/2;
     edge.setEnabled(true);await pointer(x,y);
     const fr=win.frameElement.getBoundingClientRect(),hostHit=win.frameElement.ownerDocument.elementFromPoint(fr.left+x,fr.top+y);diagnostics={...inspect(win),outer:{side,x,y,pointer:edge.pointer,active:edge.model.active?.id,target:edge.overlay.dataset.target,edge:edge.head.dataset.edge,lastClear:edge.lastClear,hit:doc.elementFromPoint(x,y)?.outerHTML?.slice(0,300),hostHit:hostHit?.outerHTML?.slice(0,300),events:events.slice(-3)}};
     check(edge.model.active===boundary&&edge.head.dataset.edge===side,theme+' outer '+side+' responds on the actual sidebar perimeter',diagnostics.outer);
     const after=await capture(win,'native-'+theme+'-outer-'+side+'-after'),a=before.getContext('2d').getImageData(0,0,before.width,before.height).data,b=after.getContext('2d').getImageData(0,0,after.width,after.height).data,lineX=side==='left'?0:side==='right'?win.innerWidth:x,lineY=side==='top'?0:side==='bottom'?win.innerHeight:y;let painted=0,inside=0;
     const changed=(x,y)=>{const i=(y*after.width+x)*4;return [0,1,2].some(k=>Math.abs(a[i+k]-b[i+k])>5);};
     for(let py=Math.max(0,Math.floor((lineY-(vertical?18:2))*scale));py<Math.min(after.height,Math.ceil((lineY+(vertical?19:3))*scale));py++)for(let px=Math.max(0,Math.floor((lineX-(vertical?2:18))*scale));px<Math.min(after.width,Math.ceil((lineX+(vertical?3:19))*scale));px++)if(changed(px,py))painted++;
     for(let py=Math.floor((lineY+(side==='top'?12:side==='bottom'?-16:-4))*scale);py<Math.floor((lineY+(side==='top'?16:side==='bottom'?-12:4))*scale);py++)for(let px=Math.floor((lineX+(side==='left'?12:side==='right'?-16:-4))*scale);px<Math.floor((lineX+(side==='left'?16:side==='right'?-12:4))*scale);px++)if(px>=0&&py>=0&&px<after.width&&py<after.height&&changed(px,py))inside++;
     metrics.push({theme,boundary:side,painted,inside,dpr:scale});check(painted>=8*scale&&inside===0,theme+' outer '+side+' paints only its thin border',metrics.at(-1));edge.clear();
    }
    // The screenshot writes and pixel analysis above have no fixed duration.
    // Establish a fresh trusted contact before timing an actual departure.
    let measured=false;
    for(let attempt=0;attempt<3&&!measured;attempt++){
     await stableGeometry(theme+' timed departure '+attempt);const version=resizeVersion,fresh=composer.getBoundingClientRect();await pointer(fresh.left+.2,fresh.top+25);
     if(version!==resizeVersion){metrics.push({theme,stage:'fresh contact interrupted by native resize',attempt,version,nextVersion:resizeVersion});continue;}
     check(edge.overlay.dataset.active==='true'&&edge.model.active===composer,theme+' afterglow starts from a fresh native composer contact',{active:edge.overlay.dataset.active,target:edge.overlay.dataset.target,lastClear:edge.lastClear});
     const started=edge.now();await pointer(doc.documentElement.clientWidth/2,doc.querySelector('.messages').getBoundingClientRect().bottom-60,900);
     const departed=edge.model.states.get(composer)?.departedAt;diagnostics={...inspect(win),trusted,events,resizes:resizes.slice(-12),geometry:geometry(),afterglow:{active:edge.overlay.dataset.active,afterglow:edge.overlay.dataset.afterglow,target:edge.overlay.dataset.target,modelActive:edge.model.active?.className,departed,elapsed:edge.now()-started,age:Number.isFinite(departed)?edge.now()-departed:null,pointer:edge.pointer,dots:edge.dots.size,lastClear:edge.lastClear}};
     if(version!==resizeVersion){metrics.push({theme,stage:'timed departure interrupted by native resize',attempt,version,nextVersion:resizeVersion,afterglow:diagnostics.afterglow});continue;}
     check(edge.overlay.dataset.afterglow==='true'&&Number.isFinite(departed),theme+' leaving keeps a bounded afterglow',diagnostics.afterglow);await capture(win,'native-'+theme+'-afterglow');await pause(1850);check(!edge.overlay.dataset.active&&edge.dots.size===0,theme+' native afterglow clears',{active:edge.overlay.dataset.active,target:edge.overlay.dataset.target,pointer:edge.pointer,dots:edge.dots.size});measured=true;
    }
    check(measured,theme+' completes the afterglow measurement without a native viewport resize',diagnostics);
   }
   check(trusted>=4,'native hover uses trusted Gecko pointer input');check(requests===0,'opening, upgrading and switching stay offline');
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,results,shots,states,diagnostics,metrics,resizes,geometryWaits},null,2));
  } catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,results,shots,states,diagnostics,metrics,resizes,geometryWaits},null,2));}
  finally{Services.prefs.clearUserPref('ui.prefersReducedMotion');Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){}function install(){}function uninstall(){}
