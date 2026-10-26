/* SPDX-License-Identifier: MIT — local appearance, no model or network access. */
var PCTheme = class {
  static installStyle(doc,api){const href=api.resourceURL('appearance.css');let link=doc.getElementById('paper-companion-appearance-style');if(link){if(link.getAttribute('href')!==href)link.setAttribute('href',href);return;}link=doc.createElement('link');link.id='paper-companion-appearance-style';link.rel='stylesheet';link.href=href;doc.documentElement.append(link);}
  static seed(root,settings) {
    const p=PCore.surfacePalette(settings?.theme||'cloud');root.dataset.pcTheme=p.id;root.style.colorScheme=p.id==='dark'?'dark':'light';
    const vars={bg:p.bg,paper:p.paper,ink:p.ink,muted:p.muted,border:p.rule,rule:p.rule,green:p.accent,'green-hover':p.accentHover,accent:p.accent,soft:p.button,hover:p.button,glass:p.glass,chrome:p.top,'theme-top':p.top,'theme-fill':p.fill,'theme-fill-hover':p.fillHover,'edge-color':p.glow,'edge-spark':p.spark,'theme-shadow':p.shadow,'theme-atmosphere':p.atmosphere,'theme-header':p.header,'theme-wash':p.wash,'theme-popup':p.popup,'theme-glass-solid':p.glassSolid,'theme-highlight':p.highlight,'theme-blur':p.blur,error:p.id==='dark'?'#EEB7AF':'#A13B40','error-bg':p.id==='dark'?'#39292E':'#F9ECEB','notice-bg':p.id==='dark'?'#332F27':'#F7F1E6','notice-ink':p.id==='dark'?'#E6D3B2':'#725924'};
    vars['edge-bright']=p.id==='warm'?'#FFF0D8':'#E5F5FF';
    // Palette variables are inherited; layer-local --edge-a/b/c choose the
    // correct contrast polarity without shadowing those inherited colors.
    for(const channel of ['A','B','C'])vars['edge-'+channel.toLowerCase()+'-tone']=p['edge'+channel];
    for(const key of ['edgeBrightA','edgeBrightB','edgeBrightC'])vars[key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())]=p[key];
    for(const [name,value]of Object.entries(vars))root.style.setProperty('--'+name,value);
  }
  constructor({api,root,scope}) {
    this.api=api;this.root=root;this.doc=root.ownerDocument;this.win=this.doc.defaultView;this.scope=scope||this.doc;
    this.pickers=[];this.pending=0;this.sequence=0;this.edgeLight=new PCEdgeLight({root,scope:this.scope});
    this.reduce=this.win.matchMedia('(prefers-reduced-motion:reduce)');
    this.contrast=this.win.matchMedia('(forced-colors:active),(prefers-contrast:more)');
    this.motionChange=()=>this.apply(this.theme,false);this.reduce.addEventListener('change',this.motionChange);
    this.contrast.addEventListener('change',this.motionChange);
    this.apply(api.settings.theme||'cloud',false);
    this.unsubscribe=api.subscribe(e=>{if(['appearance','settings'].includes(e.type)&&!this.pending)this.apply(api.settings.theme||'cloud');});
    this.outside=e=>{for(const p of this.pickers)if(!e.composedPath().includes(p.box)&&!e.composedPath().includes(p.menu))this.close(p);};
    this.escape=e=>{if(e.key==='Escape')for(const p of this.pickers)if(!p.menu.hidden){e.preventDefault();e.stopPropagation();this.close(p);p.button.focus({preventScroll:true});}};
    this.doc.addEventListener('pointerdown',this.outside);this.doc.addEventListener('keydown',this.escape);
    this.menuLayout=()=>{for(const p of this.pickers)if(!p.menu.hidden)this.position(p);};this.menuBlur=()=>{for(const p of this.pickers)this.close(p);};
    this.win.addEventListener('resize',this.menuLayout);this.doc.addEventListener('scroll',this.menuLayout,true);this.win.addEventListener('blur',this.menuBlur);
  }
  apply(theme,animate=true) {
    const p=PCore.surfacePalette(theme),motion=this.api.settings.appearanceMotion||'standard';
    const reduced=this.reduce.matches||motion!=='standard';this.motion=reduced?'reduced':'standard';
    this.edgeEnabled=!reduced&&!this.contrast.matches&&this.api.settings.edgeLight!==false;
    const changed=this.theme&&this.theme!==p.id;this.theme=p.id;
    if(changed&&animate&&!reduced){this.root.setAttribute('data-theme-changing','');this.win.getComputedStyle(this.root).color;this.win.clearTimeout(this.changeTimer);this.changeTimer=this.win.setTimeout(()=>this.root.removeAttribute('data-theme-changing'),220);}
    else if(reduced)this.root.removeAttribute('data-theme-changing');
    this.root.dataset.pcTheme=p.id;this.root.dataset.pcMotion=this.motion;this.root.style.colorScheme=p.id==='dark'?'dark':'light';
    PCTheme.seed(this.root,{theme:p.id});
    for(const picker of this.pickers){PCUI.label(picker.button,p.label,'chevron',{disclosure:true});picker.button.removeAttribute('title');picker.button.setAttribute('aria-label','外观：'+p.label+'，切换主题');for(const b of picker.menu.querySelectorAll('[data-theme-choice]'))b.setAttribute('aria-checked',String(b.dataset.themeChoice===p.id));}
    for(const config of this.configs||[]){config.motion.value=motion;config.edge.checked=this.api.settings.edgeLight!==false;for(const b of config.box.querySelectorAll('[data-theme-choice]'))b.setAttribute('aria-pressed',String(b.dataset.themeChoice===p.id));}
    if(this.status)this.status.textContent=this.reduce.matches?'系统当前要求减少动态效果，边框追光暂不显示。':this.contrast.matches?'系统高对比度模式下，边框追光暂不显示。':motion==='off'?'动效已关闭，边框追光不显示。':motion==='reduced'?'减少动效已开启，边框追光不显示。':this.api.settings.edgeLight===false?'边框追光已关闭；外观选择会立即保存。':'边框流光已开启：沿边框移动可看到渐变粒子，离开后余辉约2.5秒。';
    this.edgeLight.setEnabled(this.edgeEnabled);if(this.previewButton)this.previewButton.disabled=!this.edgeEnabled;
  }
  async change(patch) {
    const revision=++this.sequence;this.pending=revision;this.apply(patch.theme||this.theme);
    try{await this.api.saveAppearance(patch);}
    catch(e){if(revision===this.sequence){this.apply(this.api.settings.theme||'cloud');this.report(e.message);}throw e;}
    finally{if(revision===this.sequence){this.pending=0;this.apply(this.api.settings.theme||'cloud');}}
  }
  report(message){if(this.status)this.status.textContent=message;else this.api.emit('error',{message});}
  focusItem(p,item){
    item.focus({preventScroll:true});
    // Move only this menu when a short viewport clips its focused option.
    // Native focus scrolling would also move the enclosing Zotero sidebar.
    const r=item.getBoundingClientRect(),m=p.menu.getBoundingClientRect();
    if(r.top<m.top+5)p.menu.scrollTop-=m.top+5-r.top;
    else if(r.bottom>m.bottom-5)p.menu.scrollTop+=r.bottom-(m.bottom-5);
  }
  position(p){const r=p.button.getBoundingClientRect(),w=Math.max(120,Math.min(170,this.win.innerWidth-16));p.menu.style.width=w+'px';const h=p.menu.getBoundingClientRect().height;p.menu.style.left=Math.max(8,Math.min(this.win.innerWidth-w-8,r.right-w))+'px';p.menu.style.top=Math.max(8,r.bottom+6+h<=this.win.innerHeight-8?r.bottom+6:r.top-h-6)+'px';}
  open(p){
    for(const other of this.pickers)this.close(other);
    this.edgeLight.suspend(p);p.menu.hidden=false;p.button.setAttribute('aria-expanded','true');
    // Top-layer popovers are outside the header's blur/stacking context. The
    // portal fallback supports older Gecko without trapping the menu in it.
    if(typeof p.menu.showPopover==='function'){p.menu.setAttribute('popover','manual');try{p.menu.showPopover();p.topLayer=true;}catch(_){p.menu.removeAttribute('popover');}}
    if(!p.topLayer){p.menu.removeAttribute('popover');(this.scope===this.doc?this.doc.body:this.scope).append(p.menu);p.portal=true;}
    this.position(p);this.focusItem(p,p.menu.querySelector('[aria-checked=true]'));
  }
  close(p){if(p.topLayer){try{p.menu.hidePopover();}catch(_){}p.topLayer=false;}p.menu.hidden=true;if(p.portal){p.box.append(p.menu);p.portal=false;}p.button.setAttribute('aria-expanded','false');this.edgeLight.resume(p);}
  picker(parent,id='') {
    const box=this.doc.createElement('div');box.className='appearance-picker';
    const button=this.doc.createElement('button');button.type='button';button.className='appearance-toggle';button.setAttribute('aria-label','切换外观');button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');if(id)button.id=id;
    const menu=this.doc.createElement('div');menu.className='appearance-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','外观主题');
    const picker={box,button,menu};
    for(const name of PCore.themeIDs()){const p=PCore.surfacePalette(name),b=this.doc.createElement('button'),dot=this.doc.createElement('span');b.type='button';b.dataset.themeChoice=name;b.setAttribute('aria-label',p.label+(name==='cloud'?' · 默认主题':''));b.setAttribute('role','menuitemradio');dot.className='appearance-swatch';dot.style.background=p.fill;dot.setAttribute('aria-hidden','true');b.append(dot,this.doc.createTextNode(p.label));b.addEventListener('click',()=>{this.close(picker);button.focus({preventScroll:true});this.change({theme:name}).catch(()=>{});});menu.append(b);}
    button.addEventListener('click',()=>{if(menu.hidden)this.open(picker);else this.close(picker);});
    menu.addEventListener('keydown',e=>{const items=[...menu.querySelectorAll('button')],i=items.indexOf(this.doc.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();this.focusItem(picker,items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]);}else if(e.key==='Tab'){this.close(picker);button.focus({preventScroll:true});}});
    box.append(button,menu);parent.append(box);this.pickers.push(picker);this.apply(this.theme,false);return box;
  }
  config(parent) {
    const box=this.doc.createElement('div');box.className='appearance-config';box.setAttribute('role','group');box.setAttribute('aria-label','外观主题');
    for(const name of PCore.themeIDs()){const b=this.doc.createElement('button');b.type='button';b.dataset.themeChoice=name;b.textContent=PCore.surfacePalette(name).label;b.title=name==='cloud'?'默认主题 · 云白柔雾与乳白玻璃':PCore.surfacePalette(name).label;b.addEventListener('click',()=>this.change({theme:name}).catch(()=>{}));box.append(b);}
    const label=this.doc.createElement('label');label.textContent='动效';const motion=this.doc.createElement('select');motion.setAttribute('aria-label','外观动效');
    for(const [value,text]of [['standard','标准 · 快速柔和'],['reduced','减少动效'],['off','关闭动效']]){const o=this.doc.createElement('option');o.value=value;o.textContent=text;motion.append(o);}label.append(motion);
    motion.addEventListener('change',()=>this.change({appearanceMotion:motion.value}).catch(()=>{}));
    const edgeLabel=this.doc.createElement('label'),edge=this.doc.createElement('input');edge.type='checkbox';edge.addEventListener('change',()=>this.change({edgeLight:edge.checked}).catch(()=>{}));edgeLabel.append(edge,this.doc.createTextNode('局部边框追光'));
    const preview=this.doc.createElement('div');preview.id='edge-light-preview';preview.className='appearance-edge-preview';
    const text=this.doc.createElement('p');text.textContent='沿这张卡片的边框划过，观察渐变粒子和余辉。';
    this.previewButton=this.doc.createElement('button');this.previewButton.id='edge-light-demo';this.previewButton.type='button';this.previewButton.textContent='播放一次';
    this.previewButton.addEventListener('click',()=>{if(!this.edgeLight.preview(preview))this.report('追光暂未启用，请查看下方动效说明。');});preview.append(text,this.previewButton);
    this.status=this.doc.createElement('p');this.status.className='fine-print';this.status.setAttribute('role','status');this.status.textContent='外观立即保存，所有论文和插件浮窗共用；系统减少动态效果时同步减弱。';
    parent.append(box,label,edgeLabel,preview,this.status);(this.configs||=[]).push({box,motion,edge});this.apply(this.theme,false);
  }
  // Compatibility for existing diagnostic callers; state belongs to edgeLight.
  get overlay(){return this.edgeLight.overlay;}
  get frames(){return this.edgeLight.frames;}
  get targets(){return this.edgeLight.targets;}
  get pointer(){return this.edgeLight.pointer;}
  set pointer(value){this.edgeLight.pointer=value;}
  hide(){this.edgeLight.clear();}
  destroy(){
    if(this.destroyed)return;this.destroyed=true;this.unsubscribe?.();for(const p of this.pickers)this.close(p);this.edgeLight.destroy();
    this.reduce.removeEventListener('change',this.motionChange);this.contrast.removeEventListener('change',this.motionChange);
    this.win.clearTimeout(this.changeTimer);this.doc.removeEventListener('pointerdown',this.outside);this.doc.removeEventListener('keydown',this.escape);
    this.win.removeEventListener('resize',this.menuLayout);this.doc.removeEventListener('scroll',this.menuLayout,true);this.win.removeEventListener('blur',this.menuBlur);
  }
};

if(typeof document!=='undefined'){const a=window.arguments?.[0]||window.frameElement?.paperCompanionArgs;if(a?.api)PCTheme.seed(document.documentElement,a.api.settings);}
