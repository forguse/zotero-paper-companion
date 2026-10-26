// Disposable Gecko rendering test: synthetic paper, no model or account access.
var edgeChrome;
function startup({ rootURI }) {
  edgeChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup).registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-edge-test','content/']]);
  (async()=>{
    const output='__OUTPUT__',results=[],shots=[],metrics=[],resizes=[],geometryWaits=[],pointerRetries=[],mediaActivations=[],activationRestores=[];let debug=()=>({});
    const check=(value,label,details)=>{if(!value)throw Error(label+' '+JSON.stringify(details||''));results.push(label);};
    const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('Timeout: '+label);};
    try {
      await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
      const pc=Zotero.PaperCompanion;let requests=0;pc.request=async()=>{requests++;throw Error('No network in edge-light test');};
      Services.prefs.setIntPref('ui.prefersReducedMotion',0);
      await pc.saveAppearance({theme:'blue',appearanceMotion:'standard',edgeLight:true});
      await pc.saveSettings({chatProvider:'deepseek',smartReading:false,headerCollapsed:false,chatOptionsCollapsed:true,materialsCollapsed:true});
      const parent=new Zotero.Item('journalArticle');parent.setField('title','边框追光 · 交互演示');await parent.saveTx();
      const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});await Zotero.Reader.open(item.id);const paper=await pc.paperInfo(item.id);
      const session=await pc.session(paper.key);session.messages=[{role:'user',text:'请概括这篇论文的研究问题、方法与结论。',status:'complete',at:1},{role:'assistant',text:Array.from({length:12},(_,i)=>`### 研究依据 ${i+1}\n\n先核对论文提供的证据，再判断结论适用的范围。`).join('\n\n'),status:'complete',at:2}];await pc.saveSession(paper.key);
      const holder=Zotero.getMainWindow().openDialog('chrome://paper-companion-edge-test/content/viewport.xhtml','paper-companion-edge-test','chrome,dialog=no,resizable,width=540,height=940');
      await wait(()=>holder.document?.readyState==='complete'&&holder.document.body,'holder');holder.focus();
      const frame=holder.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');frame.style.cssText='display:block;border:0;width:480px;height:820px';
      Cu.waiveXrays(frame).paperCompanionArgs={api:pc,embedded:true,readerID:paper.id};frame.src='chrome://paper-companion/content/panel.xhtml';holder.document.body.append(frame);
      await wait(()=>frame.contentDocument?.body?.dataset.ready==='true','panel');
      const win=frame.contentWindow,doc=frame.contentDocument,$=id=>doc.getElementById(id),theme=win.pcTheme,light=theme.overlay,pause=()=>Zotero.Promise.delay(220);
      let resizeVersion=0;
      const geometry=()=>({viewport:[win.innerWidth,win.innerHeight,doc.documentElement.clientWidth,doc.documentElement.clientHeight],frame:frame.getBoundingClientRect().toJSON(),host:frame.parentElement.getBoundingClientRect().toJSON(),composer:doc.querySelector('.composer').getBoundingClientRect().toJSON()});
      win.addEventListener('resize',event=>{resizeVersion++;resizes.push({version:resizeVersion,at:win.performance.now(),surface:'frame',target:event.target===win?'window':event.target.localName,...geometry()});});
      holder.addEventListener('resize',()=>resizes.push({version:resizeVersion,at:win.performance.now(),surface:'host',hostViewport:[holder.innerWidth,holder.innerHeight],...geometry()}));
      const nativePaint=async()=>{doc.documentElement.getBoundingClientRect();let frame;const native=await Promise.race([new Promise(resolve=>{frame=win.requestAnimationFrame(()=>resolve(true));}),Zotero.Promise.delay(120).then(()=>false)]);if(!native)win.cancelAnimationFrame(frame);const c=doc.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawWindow(win,0,0,1,1,'white');await Zotero.Promise.delay(20);};
      const stableGeometry=async label=>{const began=Date.now();let previous='',version=resizeVersion,since=began,paints=0;while(Date.now()-began<6000){await nativePaint();const now=JSON.stringify(geometry());if(now!==previous||version!==resizeVersion){previous=now;version=resizeVersion;since=Date.now();paints=0;}else paints++;if(paints>=2&&Date.now()-since>=180){geometryWaits.push({label,elapsed:Date.now()-began,version,paints});return;}}throw Error('Native viewport geometry did not settle: '+label);};
      await doc.fonts.ready;await pause();
      const errors=[];win.addEventListener('error',e=>errors.push({message:e.message,file:e.filename,line:e.lineno}));
      const mediaState=()=>({pref:Services.prefs.getIntPref('ui.prefersReducedMotion',-1),cachedReduce:theme.reduce.matches,freshReduce:win.matchMedia('(prefers-reduced-motion:reduce)').matches,cachedContrast:theme.contrast.matches,freshContrast:win.matchMedia('(forced-colors:active),(prefers-contrast:more)').matches,hidden:doc.hidden,visibility:doc.visibilityState,hostHidden:holder.document.hidden,hostActive:holder.browsingContext?.isActive,forcedHostActive:holder.browsingContext?.forceAppWindowActive,focused:doc.hasFocus(),display:win.getComputedStyle(light).display});
      debug=()=>({motion:theme.motion,enabled:theme.edgeEnabled,media:mediaState(),geometry:geometry(),resizes:resizes.slice(-12),resizeVersion,controller:{enabled:theme.edgeLight.enabled,frames:theme.frames,frame:theme.edgeLight.frame,destroyed:theme.edgeLight.destroyed,error:errors},active:light.dataset.active,target:light.dataset.target,overlay:light.style.cssText,targets:theme.targets?.length,notice:$('notice').textContent,tab:doc.querySelector('.tabs').dataset.active,translationRect:$('translation-result').getBoundingClientRect().toJSON(),translationVisible:win.getComputedStyle($('tab-translate')).display,pointer:theme.pointer,note:[$('note-preview').getAttribute('contenteditable'),doc.activeElement?.id,win.getComputedStyle($('note-preview')).boxShadow]});
      const activateFixture=async label=>{
        const before=mediaState(),methods=[];
        holder.restore();holder.focus();
        // The Windows runner may occlude this disposable app window. Gecko
        // intentionally defers MQL change delivery for hidden documents. Use
        // its chrome-app visibility API, never rewrite the product's MQL or
        // invoke apply(). The modern isActive setter is NOT for HTML iframes.
        // https://searchfox.org/mozilla-central/source/docshell/base/CanonicalBrowsingContext.cpp
        const context=holder.browsingContext;
        if(doc.hidden&&context&&typeof context.forceAppWindowActive==='boolean'){
          if(!context.forceAppWindowActive){activationRestores.push({object:context,key:'forceAppWindowActive',value:context.forceAppWindowActive});context.forceAppWindowActive=true;methods.push('top chrome forceAppWindowActive');}
        }else if(doc.hidden&&holder.docShell&&'isActive'in holder.docShell){
          const shell=holder.docShell;if(!shell.isActive){activationRestores.push({object:shell,key:'isActive',value:shell.isActive});shell.isActive=true;methods.push('legacy top docshell activation');}
        }
        await nativePaint();await nativePaint();
        const activation={label,before,methods,after:mediaState()};mediaActivations.push(activation);
        await wait(()=>{doc.documentElement.getBoundingClientRect();return !holder.document.hidden&&!doc.hidden;},'visible disposable media-query document: '+label);
        activation.after=mediaState();
        check(!doc.hidden&&doc.visibilityState==='visible',label+' tests system preferences in a genuinely visible Gecko document',mediaState());
      };
      const systemMotion=async(reduced,label)=>{
        await activateFixture(label);
        Services.prefs.setIntPref('ui.prefersReducedMotion',reduced?1:0);
        // Query actual Gecko media/style state while waiting. Reading only a
        // cached JS controller flag can leave a hidden frame's style update
        // pending indefinitely; never invoke the product's apply() ourselves.
        await wait(()=>{doc.documentElement.getBoundingClientRect();const media=mediaState();return media.freshReduce===reduced&&media.cachedReduce===reduced&&theme.edgeEnabled===!reduced;},label);
      };
      const pointer=(x,y)=>{(doc.elementFromPoint(x,y)||doc).dispatchEvent(new win.PointerEvent('pointermove',{clientX:x,clientY:y,pointerType:'mouse',bubbles:true,composed:true}));};
      const hover=async(node,side='top',offset=.3)=>{for(let attempt=0;attempt<3;attempt++){await stableGeometry((node.id||node.className)+' '+side);const version=resizeVersion,r=node.getBoundingClientRect(),vertical=side==='left'||side==='right',x=side==='left'?r.left+offset:side==='right'?r.right-offset:r.left+r.width/2,y=vertical?Math.max(r.top+20,Math.min(r.bottom-20,win.innerHeight/2)):side==='bottom'?r.bottom-offset:r.top+offset;pointer(x,y);await pause();if(version===resizeVersion)return{x,y,rect:r};pointerRetries.push({node:node.id||node.className,side,attempt,version,nextVersion:resizeVersion,lastClear:theme.edgeLight.lastClear});}throw Error('Native viewport resized during each contact: '+(node.id||node.className)+' '+side);};
      const canvas=()=>{const c=doc.createElement('canvas');c.width=win.innerWidth;c.height=win.innerHeight;c.getContext('2d').drawWindow(win,0,0,c.width,c.height,'white');return c;};
      const capture=async name=>{const c=canvas(),path=PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),x=>x.charCodeAt(0)));shots.push({name,path});};
      // Preserve the physical one-pixel border at fractional CSS coordinates.
      // A CSS-sized screenshot can round an entire 0.667px bottom edge away.
      const dpr=win.devicePixelRatio,nativePixels=()=>{const c=doc.createElement('canvas');c.width=Math.round(win.innerWidth*dpr);c.height=Math.round(win.innerHeight*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.drawWindow(win,0,0,win.innerWidth,win.innerHeight,'white');return ctx.getImageData(0,0,c.width,c.height);};
      const savePixels=async(name,pixels)=>{const c=doc.createElement('canvas');c.width=pixels.width;c.height=pixels.height;c.getContext('2d').putImageData(pixels,0,0);const path=PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),x=>x.charCodeAt(0)));shots.push({name,path});};
      const tab=async name=>{$('nav-'+name).click();await pause();};
      await hover($('send'));check(!theme.targets.some(t=>t.node===$('send'))&&light.dataset.target!=='send','ordinary send buttons stay outside decorative tracking',debug());
      check(win.getComputedStyle(light).pointerEvents==='none'&&win.getComputedStyle(light).maskComposite==='exclude','light remains a non-interactive masked border');
      theme.hide();await hover(doc.querySelector('.tabs'),'bottom');check(light.dataset.active==='true','navigation boundary can trigger the light');
      const controller=theme.edgeLight,navigation=doc.querySelector('.tabs'),navButton=$('nav-translate');
      const nb=navButton.getBoundingClientRect();theme.hide();navButton.dispatchEvent(new win.PointerEvent('pointermove',{clientX:nb.left+nb.width/2,clientY:nb.top+.3,pointerType:'mouse',bubbles:true,composed:true}));await pause();
      check(controller.model.active===navigation&&!theme.targets.some(t=>t.node===navButton),'a button event near the navigation perimeter lights only its enclosing strip',debug());
      $('messages').scrollTop=0;await pause();
      const bubble=doc.querySelector('.message.user .message-body'),reading=doc.querySelector('.chat-log'),entry=$('prompt');
      const containers=[['paper',doc.querySelector('.paper-row')],['navigation',navigation],['reading',reading],['question',bubble],['input',entry],['composer',doc.querySelector('.composer')]];
      const diff=(before,after,x,y)=>{const i=(y*after.width+x)*4;return [0,1,2].some(k=>Math.abs(after.data[i+k]-before.data[i+k])>5);};
      for(const [name,node]of containers){
        for(const side of ['top','right','bottom','left']){
          let point,before,stablePair=false;for(let attempt=0;attempt<3;attempt++){controller.setEnabled(false);point=await hover(node,side);const version=resizeVersion;before=nativePixels();controller.setEnabled(true);const next=await hover(node,side);if(version===resizeVersion&&JSON.stringify(point.rect.toJSON())===JSON.stringify(next.rect.toJSON())){point=next;stablePair=true;break;}pointerRetries.push({node:name,side,attempt,stage:'pixel pair interrupted by geometry change',version,nextVersion:resizeVersion});}if(!stablePair)throw Error('Native viewport never stabilized for pixel pair: '+name+' '+side);
          check(controller.model.active===node&&light.dataset.active==='true'&&controller.head.dataset.edge===side,name+' '+side+' uses its own container boundary',{active:controller.model.active?.className,target:light.dataset.target,point});
          const after=nativePixels();let painted=0,inside=0;const vertical=side==='left'||side==='right';
          for(let y=Math.max(0,Math.floor((point.y-(vertical?18:2))*dpr));y<Math.min(after.height,Math.ceil((point.y+(vertical?19:3))*dpr));y++)for(let x=Math.max(0,Math.floor((point.x-(vertical?2:18))*dpr));x<Math.min(after.width,Math.ceil((point.x+(vertical?3:19))*dpr));x++)if(diff(before,after,x,y))painted++;
          const r=node.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
          for(let y=Math.max(0,Math.floor((cy-4)*dpr));y<Math.min(after.height,Math.ceil((cy+4)*dpr));y++)for(let x=Math.max(0,Math.floor((cx-6)*dpr));x<Math.min(after.width,Math.ceil((cx+6)*dpr));x++)if(diff(before,after,x,y))inside++;
          const sample={container:name,side,painted,inside,dpr,point,rule:win.getComputedStyle(node).borderBottomWidth,overlay:light.style.cssText};metrics.push(sample);
          if(painted<8*dpr||inside!==0){await savePixels('failure-'+name+'-'+side+'-before',before);await savePixels('failure-'+name+'-'+side+'-after',after);}
          check(painted>=8*dpr&&inside===0,name+' '+side+' paints its line without tinting the text surface',sample);
        }
        check(win.getComputedStyle(light).borderRadius===win.getComputedStyle(node).borderRadius,name+' mask copies the actual corner radii');await savePixels('edge-container-'+name,nativePixels());
      }
      // The question bubble has an intentionally different bottom-right radius.
      // Check the curve itself, including untouched pixels outside its top corner.
      controller.setEnabled(false);const br=bubble.getBoundingClientRect(),radius=parseFloat(win.getComputedStyle(bubble).borderTopLeftRadius),arc=radius*(1-1/Math.sqrt(2));pointer(br.left+arc,br.top+arc);await pause();
      const cornerBefore=nativePixels();controller.setEnabled(true);pointer(br.left+arc,br.top+arc);await pause();
      const cornerAfter=nativePixels();let curve=0,outside=0;
      for(let y=Math.floor(br.top*dpr);y<Math.ceil((br.top+radius+2)*dpr);y++)for(let x=Math.floor(br.left*dpr);x<Math.ceil((br.left+radius+2)*dpr);x++)if(diff(cornerBefore,cornerAfter,x,y)){curve++;if((x+.5)/dpr<br.left+1&&(y+.5)/dpr<br.top+1)outside++;}
      check(controller.model.active===bubble&&curve>=2*dpr&&outside===0,'rounded question corners receive light only on their original curve',{curve,outside,radius,dpr,rect:br.toJSON()});await savePixels('edge-question-corner',cornerAfter);theme.hide();
      await tab('translate');$('translation-source').open=false;$('translation-result').textContent='把光留在边缘，让阅读保持安静。';await pause();
      for(const color of ['cloud','blue','warm','dark']){
        // Hidden native windows may pause theme transitions; establish each still
        // without a color transition, then restore standard particle motion.
        await pc.saveAppearance({theme:color,appearanceMotion:'off'});await pause();await pc.saveAppearance({appearanceMotion:'standard'});doc.activeElement?.blur();theme.hide();theme.pointer=null;await pause();
        const before=canvas().getContext('2d').getImageData(0,0,win.innerWidth,win.innerHeight),point=await hover($('translation-result'));
        await capture('edge-'+color+'-diagnostic');check(light.dataset.target==='translation-result'&&light.dataset.active==='true',color+' translation result border is reachable',debug());
        const after=canvas().getContext('2d').getImageData(0,0,win.innerWidth,win.innerHeight);let borderPixels=0,centerPixels=0;
        for(let y=Math.max(0,Math.floor(point.y)-2);y<Math.min(after.height,Math.ceil(point.y)+3);y++)for(let x=Math.floor(point.x)-18;x<=Math.ceil(point.x)+18;x++){
          const i=(y*after.width+x)*4;if([0,1,2].some(k=>Math.abs(after.data[i+k]-before.data[i+k])>5))borderPixels++;
        }
        for(let y=Math.floor(point.rect.top)+24;y<Math.min(after.height,Math.floor(point.rect.top)+44);y++)for(let x=Math.floor(point.x)-12;x<Math.floor(point.x)+12;x++){
          const i=(y*after.width+x)*4;if([0,1,2].some(k=>Math.abs(after.data[i+k]-before.data[i+k])>5))centerPixels++;
        }
        metrics.push({color,borderPixels,centerPixels});check(borderPixels>=8,color+' edge effect paints visible pixels in Gecko',{borderPixels});check(centerPixels===0,color+' effect does not paint the text surface',{centerPixels});await capture('edge-'+color);
      }
      // Compare actual edge colors after several overlapping samples. Removing
      // the neutral/brightness component from each before/after delta prevents
      // mere opacity variation from passing as a multicolor gradient.
      const gradientFixture=doc.createElement('div');gradientFixture.id='edge-gradient-fixture';gradientFixture.className='appearance-edge-preview';gradientFixture.textContent='颜色沿边缘自然过渡，正文保持原样。';gradientFixture.style.cssText='position:fixed;left:92px;top:245px;width:280px;height:240px;margin:0;border:1px solid var(--border);border-radius:10px;background:var(--paper);color:var(--ink);z-index:60';doc.body.append(gradientFixture);
      for(const color of ['cloud','blue','warm','dark']){
        await pc.saveAppearance({theme:color,appearanceMotion:'off'});await pause();await pc.saveAppearance({appearanceMotion:'standard'});await pause();
        for(const side of ['top','left']){
          theme.hide();controller.setEnabled(false);const before=nativePixels(),rect=gradientFixture.getBoundingClientRect(),vertical=side==='left';controller.setEnabled(true);
          for(const offset of [20,32,44,56,68,80,68,56,44]){pointer(vertical?rect.left+.3:rect.left+offset,vertical?rect.top+offset:rect.top+.3);await Zotero.Promise.delay(45);}
          await pause();const after=nativePixels(),samples=[];let interior=0;
          for(let along=20;along<=94;along+=2){
            const coordinate=Math.round(((vertical?rect.top:rect.left)+along)*dpr),start=Math.max(0,Math.floor(((vertical?rect.left:rect.top)-1)*dpr)),end=Math.ceil(((vertical?rect.left:rect.top)+3)*dpr);let best=null;
            for(let cross=start;cross<end;cross++){
              const x=vertical?cross:coordinate,y=vertical?coordinate:cross;if(x<0||y<0||x>=after.width||y>=after.height)continue;
              const at=(y*after.width+x)*4,delta=[0,1,2].map(k=>after.data[at+k]-before.data[at+k]),magnitude=Math.hypot(...delta),mean=delta.reduce((n,v)=>n+v,0)/3,chroma=delta.map(v=>v-mean),length=Math.hypot(...chroma);
              if(magnitude>15&&length>4&&(!best||magnitude>best.magnitude))best={along,magnitude,chroma:chroma.map(v=>v/length),before:[...before.data.slice(at,at+3)],after:[...after.data.slice(at,at+3)]};
            }
            if(best)samples.push(best);
          }
          let chromaticDifference=0;for(const one of samples)for(const two of samples)if(Math.abs(one.along-two.along)>=12)chromaticDifference=Math.max(chromaticDifference,Math.hypot(...one.chroma.map((v,i)=>v-two.chroma[i])));
          for(let y=Math.ceil((rect.top+12)*dpr);y<Math.floor((rect.bottom-12)*dpr);y++)for(let x=Math.ceil((rect.left+12)*dpr);x<Math.floor((rect.right-12)*dpr);x++)if(diff(before,after,x,y))interior++;
          const detail={color,side,samples:samples.length,chromaticDifference,interior,colors:samples.filter((_,i)=>i%5===0)};metrics.push(detail);
          if(samples.length<16||chromaticDifference<.35||interior!==0){await savePixels('failure-gradient-'+color+'-'+side+'-before',before);await savePixels('failure-gradient-'+color+'-'+side+'-after',after);}
          check(controller.model.active===gradientFixture&&controller.head.dataset.edge===side,color+' '+side+' gradient uses the real allocated border');
          check(samples.length>=16&&chromaticDifference>=.35,color+' '+side+' overlapping stamps retain visible chromatic variation rather than brightness alone',detail);
          check(interior===0,color+' '+side+' gradient leaves every interior sample unchanged',detail);await savePixels('edge-gradient-'+color+'-'+side,after);
        }
      }
      gradientFixture.remove();theme.hide();
      // Verify both vertical sides of the real reading result, including its
      // intentionally transparent allocated borders. Do not create a new frame.
      for(const side of ['left','right']){
        theme.hide();await pause();const before=canvas().getContext('2d').getImageData(0,0,win.innerWidth,win.innerHeight),point=await hover($('translation-result'),side);
        check(light.dataset.active==='true'&&light.dataset.target==='translation-result'&&theme.edgeLight.head.dataset.edge===side,side+' reading border is reachable');
        const after=canvas().getContext('2d').getImageData(0,0,win.innerWidth,win.innerHeight);let painted=0;
        for(let y=Math.max(0,Math.floor(point.y)-26);y<Math.min(after.height,Math.ceil(point.y)+27);y++)for(let x=Math.max(0,Math.floor(point.x)-2);x<Math.min(after.width,Math.ceil(point.x)+3);x++){const i=(y*after.width+x)*4;if([0,1,2].some(k=>Math.abs(after.data[i+k]-before.data[i+k])>5))painted++;}
        check(painted>=12,side+' reading border has visible native pixels',{painted,point});metrics.push({side,painted});await capture('edge-reading-'+side);
      }
      const tones=win.getComputedStyle(light);check(new Set(['--edge-a','--edge-b','--edge-c'].map(k=>tones.getPropertyValue(k).trim())).size===3,'the border receives three distinct theme-matched colors');
      theme.hide();$('theme-toggle').click();await pause();const picker=theme.pickers[0],menu=picker.menu;
      check(!menu.hidden&&theme.edgeLight.blockers.has(picker)&&theme.edgeLight.dots.size===0&&!light.dataset.active,'opening the theme menu clears and suspends particles');
      const mr=menu.getBoundingClientRect(),choice=menu.querySelector('button'),qr=choice.getBoundingClientRect(),hit=doc.elementFromPoint(qr.left+qr.width/2,qr.top+qr.height/2);
      check(mr.left>=0&&mr.right<=win.innerWidth&&mr.top>=0&&mr.bottom<=win.innerHeight&&(hit===choice||choice.contains(hit)),'theme choices stay above navigation and within the viewport');
      check(!$('theme-toggle').hasAttribute('title'),'theme trigger has no delayed tooltip over its open choices');await capture('edge-menu-unobstructed');theme.close(picker);theme.hide();
      const r=$('translation-result').getBoundingClientRect();pointer(r.left+r.width/2,r.top+8);await pause();const softer=Number(light.style.opacity);pointer(r.left+r.width/2,r.top+.3);await pause();check(Number(light.style.opacity)>softer,'strength varies with actual proximity');
      const previous=light.style.getPropertyValue('--edge-x');pointer(r.left+r.width/2+20,r.top+.3);await pause();check(light.style.getPropertyValue('--edge-x')!==previous,'gradient position tracks horizontal movement');
      pointer(r.left+r.width/2,r.top+r.height/2);await pause();check(!light.dataset.active,'the center does not light the whole card');
      const frames=theme.frames;await pause();check(theme.frames===frames,'stationary pointer creates no continuous rendering loop');
      theme.hide();const trail=doc.createElement('div');trail.id='edge-trail-fixture';trail.className='appearance-edge-preview';trail.style.cssText='position:fixed;left:92px;top:240px;width:280px;height:350px;margin:0;border:1px solid var(--border);border-radius:10px;background:var(--paper);z-index:60';
      const caption=doc.createElement('p');caption.textContent='边框上的渐变粒子与余辉';trail.append(caption);doc.body.append(trail);await pause();
      const tr=trail.getBoundingClientRect(),traceBefore=canvas().getContext('2d').getImageData(0,0,win.innerWidth,win.innerHeight);
      for(const offset of [30,90,160,230]){pointer(tr.left+.3,tr.top+offset);await Zotero.Promise.delay(55);}
      check(controller.head.getBoundingClientRect().width===72&&controller.head.querySelector('.pc-edge-particles'),'a 72px particle field remains inside the original border mask');
      check(controller.entryAnimation?.effect.getTiming().duration===160,'contact has one short entry pulse');await capture('edge-particles-contact');
      pointer(tr.left+110,tr.top+270);await pause();const departed=controller.model.states.get(trail)?.departedAt;
      check(Number.isFinite(departed)&&controller.model.points.some(p=>p.key===trail&&p.y>245),'leaving projects the current height onto the touched side',debug());
      const traceAfter=canvas().getContext('2d').getImageData(0,0,win.innerWidth,win.innerHeight);let tracePixels=0,bodyPixels=0;const shades=new Set();
      for(let y=Math.floor(tr.top)+20;y<Math.floor(tr.top)+295;y++){const x=Math.floor(tr.left),i=(y*traceAfter.width+x)*4;if([0,1,2].some(k=>Math.abs(traceAfter.data[i+k]-traceBefore.data[i+k])>3)){tracePixels++;shades.add([...traceAfter.data.slice(i,i+3)].join(','));}}
      for(let y=Math.floor(tr.top)+30;y<Math.floor(tr.bottom)-20;y++)for(let x=Math.floor(tr.left)+25;x<Math.floor(tr.right)-25;x++){const i=(y*traceAfter.width+x)*4;if([0,1,2].some(k=>Math.abs(traceAfter.data[i+k]-traceBefore.data[i+k])>3))bodyPixels++;}
      metrics.push({tracePixels,particleShades:shades.size,bodyPixels});check(tracePixels>=140&&shades.size>=12,'the border shows a continuous path with varied particle intensities',{tracePixels,shades:shades.size});check(bodyPixels===0,'particles never fill the card or change its text',{bodyPixels});await capture('edge-particle-trail');
      await Zotero.Promise.delay(850);pointer(tr.left+130,tr.top+305);await pause();check(controller.model.states.get(trail)?.departedAt===departed,'continued off-border movement does not extend the departure deadline');
      check([...controller.dots.values()].some(d=>d.key===trail&&parseFloat(win.getComputedStyle(d.node).opacity)>.01),'afterglow is still visible more than one second after leaving');await capture('edge-afterglow-1s');
      await Zotero.Promise.delay(Math.max(1,departed+2500-controller.now()+240));
      check(!controller.model.states.has(trail)&&controller.dots.size===0&&controller.surfaces.size===0&&!controller.timer,'afterglow clears at its bounded 2.5 second lifetime');
      const finishedFrames=theme.frames;await pause();check(theme.frames===finishedFrames&&!controller.frame,'expired particles leave no JavaScript animation loop');trail.remove();theme.hide();
      await tab('notes');await hover($('note-preview'));check(light.dataset.target==='note-preview'&&Math.abs(parseFloat(light.style.paddingTop)-parseFloat(win.getComputedStyle($('note-preview')).borderTopWidth))<.001,'the note editing highlight preserves its actual border width',debug());await capture('edge-note');
      const single=doc.createElement('div');single.id='edge-single';single.className='appearance-edge-preview';single.textContent='单侧边线测试';single.style.cssText='position:fixed;left:100px;top:300px;width:200px;height:120px;border:0;border-left:1px solid #526883;border-radius:0;z-index:50';doc.body.append(single);
      await hover(single,'left');check(light.dataset.target==='edge-single'&&Math.abs(parseFloat(light.style.paddingLeft)-parseFloat(win.getComputedStyle(single).borderLeftWidth))<.001&&light.style.paddingTop==='0px','a single-side border paints only its allocated edge',debug());single.remove();
      const clipper=doc.createElement('div'),clipped=doc.createElement('div');clipped.className='appearance-edge-preview';clipper.style.cssText='position:fixed;left:80px;top:250px;width:200px;height:50px;overflow:hidden;z-index:50';clipped.id='edge-clipped';clipped.style.cssText='position:absolute;top:80px;left:0;width:150px;height:50px;border:1px solid #526883';clipper.append(clipped);doc.body.append(clipper);
      await hover(clipped);check(light.dataset.target!=='edge-clipped'||!light.dataset.active,'clipped controls cannot paint through their scroll boundary');clipper.remove();
      theme.hide();const shadowHost=doc.createElement('div');shadowHost.id='edge-shadow-host';shadowHost.style.cssText='position:fixed;left:100px;top:300px;width:240px;height:100px;z-index:80';doc.body.append(shadowHost);
      const shadow=shadowHost.attachShadow({mode:'open'}),sheet=doc.createElement('link');sheet.rel='stylesheet';sheet.href='chrome://paper-companion/content/appearance.css';shadow.append(sheet);
      const shadowButton=doc.createElement('div');shadowButton.id='edge-shadow-button';shadowButton.className='pc-body';shadowButton.textContent='浮窗边框';shadowButton.style.cssText='width:220px;height:70px;border:1px solid var(--border);border-radius:8px;background:var(--paper);color:var(--ink)';shadow.append(shadowButton);
      await wait(()=>sheet.sheet,'shadow appearance');const ShadowTheme=Cu.waiveXrays(win).PCTheme,shadowTheme=new ShadowTheme({api:pc,root:shadowHost,scope:shadow});await pause();
      const sr=shadowButton.getBoundingClientRect();shadowButton.dispatchEvent(new win.PointerEvent('pointermove',{clientX:sr.left+sr.width/2,clientY:sr.top+.3,pointerType:'mouse',bubbles:true,composed:true}));await pause();
      check(shadowTheme.overlay.dataset.active==='true'&&win.getComputedStyle(shadowTheme.overlay).maskComposite==='exclude','shadow-root popup frames render their own border particles');
      shadowHost.dispatchEvent(new win.PointerEvent('pointerleave',{pointerType:'mouse',bubbles:false}));await pause();
      check(!shadowTheme.overlay.dataset.active&&shadowTheme.overlay.dataset.afterglow==='true','leaving a popup host starts its bounded afterglow');shadowTheme.destroy();check(shadowTheme.edgeLight.layers.size===0&&!shadowTheme.edgeLight.timer,'destroying a popup cleans its particles and listeners');shadowHost.remove();
      await tab('settings');const settings=$('tab-settings'),preview=$('edge-light-preview');settings.scrollTop+=preview.getBoundingClientRect().top-settings.getBoundingClientRect().top-50;await pause();$('edge-light-demo').click();await pause();
      check(controller.model.states.has($('edge-light-preview'))&&controller.dots.size>2,'settings can explicitly play a local particle-trail preview',{states:[...controller.model.states.keys()].map(n=>n.id),dots:controller.dots.size,lastClear:controller.lastClear,enabled:controller.enabled});await capture('edge-settings-preview');
      await pc.saveAppearance({appearanceMotion:'reduced'});check(!theme.edgeEnabled&&win.getComputedStyle(light).display==='none'&&theme.status.textContent.includes('减少动效'),'reduced mode hides light and explains why');
      check(controller.dots.size===0&&controller.surfaces.size===0&&!controller.timer,'reducing motion immediately removes particles and timers');
      await pc.saveAppearance({appearanceMotion:'standard',edgeLight:false});check(!theme.edgeEnabled&&theme.status.textContent.includes('已关闭'),'edge toggle off has an explicit explanation');
      await pc.saveAppearance({edgeLight:true});await systemMotion(true,'system reduced motion');check(theme.status.textContent.includes('系统当前要求')&&win.getComputedStyle(light).display==='none','system reduction is visible in the setting status and hides particles');
      await systemMotion(false,'restore standard motion');
      // Gecko chrome documents expose native accessibility contrast through
      // prefers-contrast, even when forced-colors is content-only.
      await activateFixture('native high contrast');
      Services.prefs.setIntPref('ui.useAccessibilityTheme',1);await wait(()=>{doc.documentElement.getBoundingClientRect();const media=mediaState();return media.freshContrast&&media.cachedContrast;},'native high contrast');await pause();
      check(!theme.edgeEnabled&&win.getComputedStyle(light).display==='none','native high contrast removes the decorative particles');
      check(win.getComputedStyle(doc.querySelector('.workspace-header'),':before').display==='none','native high contrast removes the header pigment layer');await capture('edge-high-contrast');
      check(requests===0,'all appearance work stays local with no model requests');
      await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:pc.publicState().version,results,shots,metrics,resizes,geometryWaits,pointerRetries,mediaActivations},null,2));
    }catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results,shots,metrics,resizes,geometryWaits,pointerRetries,mediaActivations},null,2));}
    finally{for(const saved of activationRestores.reverse())try{saved.object[saved.key]=saved.value;}catch(_){}Services.prefs.clearUserPref('ui.useAccessibilityTheme');Services.prefs.clearUserPref('ui.prefersReducedMotion');Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
  })();
}
function shutdown(){edgeChrome?.destruct();}function install(){}function uninstall(){}
