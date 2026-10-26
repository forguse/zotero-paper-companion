/* SPDX-License-Identifier: MIT — bounded border-only particles and afterglow. */
(function(root){
const Core=typeof module==='object'&&module.exports?require('./core.js'):root.PCore;

class PCEdgeTrail {
  static radius=36;
  static duration=2500;
  constructor({duration=2500,spacing=12,maxPoints=96,maxSurfaces=8}={}) {
    this.duration=duration;this.spacing=spacing;this.maxPoints=maxPoints;this.maxSurfaces=maxSurfaces;
    this.states=new Map();this.points=[];this.active=null;this.serial=0;
  }
  static project(rect,point,side=null,edges={top:true,right:true,bottom:true,left:true},corner=0) {
    const x=point.x-rect.left,y=point.y-rect.top,r=Math.min(corner,rect.width/2,rect.height/2);
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),candidates=[];
    if(edges.top&&(!side||side==='top'))candidates.push({x:clamp(x,r,rect.width-r),y:0,edge:'top'});
    if(edges.bottom&&(!side||side==='bottom'))candidates.push({x:clamp(x,r,rect.width-r),y:rect.height,edge:'bottom'});
    if(edges.left&&(!side||side==='left'))candidates.push({x:0,y:clamp(y,r,rect.height-r),edge:'left'});
    if(edges.right&&(!side||side==='right'))candidates.push({x:rect.width,y:clamp(y,r,rect.height-r),edge:'right'});
    return candidates.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0]||null;
  }
  touch(key,point,edge,now,strength=1) {
    this.prune(now);
    if(this.active!==key)this.depart(now);
    let state=this.states.get(key);
    const entered=!state||state.departedAt!==null||this.active!==key;
    if(!state){state={key,last:null,anchor:null,departedAt:null,pulseAt:-Infinity};this.states.set(key,state);}
    if(entered)state.anchor=null;
    const pulse=entered&&now-state.pulseAt>=240;if(pulse)state.pulseAt=now;
    state.departedAt=null;state.edge=edge;state.strength=strength;state.last={...point};this.active=key;
    this.append(state,point,now,now+this.duration,entered);
    while(this.states.size>this.maxSurfaces){const old=[...this.states.keys()].find(k=>k!==this.active);this.drop(old);}
    return {state,pulse};
  }
  append(state,point,now,expires,force=false) {
    const previous=state.anchor||point,distance=Math.hypot(point.x-previous.x,point.y-previous.y);
    if(!force&&distance<this.spacing/2)return;
    const count=Math.max(1,Math.min(32,Math.ceil(distance/this.spacing)));
    for(let i=1;i<=count;i++)this.points.push({id:++this.serial,key:state.key,x:previous.x+(point.x-previous.x)*i/count,y:previous.y+(point.y-previous.y)*i/count,edge:state.edge,strength:state.strength,at:now,expires});
    state.anchor={...point};if(this.points.length>this.maxPoints)this.points.splice(0,this.points.length-this.maxPoints);
  }
  depart(now) {
    const state=this.states.get(this.active);
    if(state&&state.departedAt===null){state.departedAt=now;for(const point of this.points)if(point.key===state.key)point.expires=now+this.duration;}
    return state||null;
  }
  extend(point,now) {
    const state=this.states.get(this.active);if(!state||state.departedAt===null||now>=state.departedAt+this.duration)return null;
    state.last={...point};this.append(state,point,now,state.departedAt+this.duration);return state;
  }
  prune(now) {
    this.points=this.points.filter(p=>p.expires>now);
    const active=this.states.get(this.active);
    if(active&&active.departedAt!==null&&now>=active.departedAt+this.duration)this.active=null;
    const retained=new Set(this.points.map(p=>p.key));
    for(const key of this.states.keys())if(key!==this.active&&!retained.has(key))this.states.delete(key);
  }
  drop(key) {this.states.delete(key);this.points=this.points.filter(p=>p.key!==key);if(this.active===key)this.active=null;}
  nextExpiry() {
    const state=this.states.get(this.active),times=this.points.map(p=>p.expires);
    if(state&&state.departedAt!==null)times.push(state.departedAt+this.duration);
    return times.length?Math.min(...times):null;
  }
  clear(){this.states.clear();this.points=[];this.active=null;}
}

class PCEdgeLight {
  static targets='.composer,.composer textarea,.paper-row,.chat-log,.message.user .message-body,.vocab-card,dialog[open],.pc-body,.pc-context-toast,.workspace-header,.tabs,.translation-result,.note-toolbar,.note-footer,.note-render-label,#note-preview,.note-source,.insight-stage>article,.appearance-edge-preview';
  static menus='.appearance-menu:not([hidden]),.quick-menu:not([hidden]),.web-more-menu:not([hidden]),.screenshot-options:not([hidden]),.organization-menu[open] .highlights-bar,.note-manage[open] .note-manage-menu,.reading-scope[open] .reading-scope-details';
  constructor({root,scope}) {
    this.root=root;this.doc=root.ownerDocument;this.win=this.doc.defaultView;this.scope=scope||this.doc;this.leaveRoot=this.scope.host||this.scope;
    this.model=new PCEdgeTrail();this.surfaces=new Map();this.dots=new Map();this.layers=new Set();this.blockers=new Set();this.frames=0;this.dirty=true;this.enabled=false;
    this.overlay=this.surface();this.overlay.style.opacity='0';this.head=this.dot('pc-edge-head');this.overlay.append(this.head);
    // Buttons never become light targets. Their event path must still be able
    // to reach a nearby enclosing container edge (for example the tab strip).
    this.move=e=>{if(e.pointerType==='touch'||e.buttons||!this.enabled||this.blockers.size){this.clear();return;}this.pointer={x:e.clientX,y:e.clientY};this.schedule();};
    this.leave=()=>{this.pointer=null;const state=this.model.depart(this.now());if(state)this.departHead(state);this.sync();};
    this.invalidate=()=>{if(!this.root.isConnected){this.destroy();return;}this.dirty=true;if(this.pointer||this.model.points.length)this.schedule();};
    this.clearLayout=e=>{this.lastClear=e?.type||'layout';this.clear();this.dirty=true;};
    this.scroll=()=>{this.pointer=null;const state=this.model.depart(this.now());if(state)this.departHead(state);this.dirty=true;if(this.model.points.length)this.schedule();};
    this.scope.addEventListener('pointermove',this.move,{passive:true});this.leaveRoot.addEventListener('pointerleave',this.leave,{passive:true});
    this.scope.addEventListener('pointerdown',this.clearLayout);this.scope.addEventListener('click',this.invalidate);
    this.scope.addEventListener('input',this.invalidate);this.scope.addEventListener('animationend',this.invalidate);
    this.scope.addEventListener('focusin',this.invalidate);this.scope.addEventListener('focusout',this.invalidate);
    this.doc.addEventListener('scroll',this.scroll,{capture:true,passive:true});this.win.addEventListener('resize',this.clearLayout);this.win.addEventListener('blur',this.clearLayout);
    this.mutations=new this.win.MutationObserver(records=>{
      if(records.some(r=>!this.inLayer(r.target)&&(r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>!this.inLayer(n))))){if(this.occluded())this.clear();this.invalidate();}
    });
    this.mutations.observe(this.scope===this.doc?this.doc.body:this.scope,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});
  }
  now(){return this.win.performance.now();}
  inLayer(node){return !!(node?.nodeType===1&&node.classList.contains('pc-edge-light'))||[...this.layers].some(layer=>layer===node||layer.contains(node));}
  setEnabled(value){this.enabled=!!value;if(!this.enabled)this.clear();this.dirty=true;}
  suspend(owner){this.blockers.add(owner);this.clear();}
  resume(owner){this.blockers.delete(owner);this.dirty=true;}
  occluded(){return this.blockers.size>0||[...this.scope.querySelectorAll(PCEdgeLight.menus)].some(n=>n.getClientRects().length>0);}
  surface() {
    const node=this.doc.createElement('div');node.className='pc-edge-light';node.setAttribute('aria-hidden','true');this.layers.add(node);
    (this.scope===this.doc?this.doc.body:this.scope).append(node);return node;
  }
  dot(className='') {
    const node=this.doc.createElement('span');node.className='pc-edge-dot '+className;
    const particles=this.doc.createElement('i');particles.className='pc-edge-particles';node.append(particles);return node;
  }
  dispose(node){for(const a of node.getAnimations({subtree:true}))a.cancel();node.remove();}
  placeDot(node,point,width=1) {
    node.style.left=point.x-PCEdgeTrail.radius+'px';node.style.top=point.y-PCEdgeTrail.radius+'px';node.dataset.edge=point.edge;
    // Every sample reveals the same target-anchored color field. Overlapping
    // samples therefore build intensity without averaging different hues into
    // one flat tint. The 144px field repeats smoothly; its 72px reveal stays local.
    node.style.setProperty('--edge-field-x',(PCEdgeTrail.radius-point.x)+'px');
    node.style.setProperty('--edge-field-y',(PCEdgeTrail.radius-point.y)+'px');
    node.style.setProperty('--particle-cross',(PCEdgeTrail.radius+(['right','bottom'].includes(point.edge)?-1:1)*width/2)+'px');
  }
  geometry(layer,target) {
    const r=target.rect,c=target.clip,key=[r.left,r.top,r.width,r.height,target.radius,...Object.values(target.widths),c.top,c.right,c.bottom,c.left].join('|');
    if(layer._pcGeometry!==key){
      Object.assign(layer.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',borderRadius:target.radius});
      for(const side of ['Top','Right','Bottom','Left'])layer.style['padding'+side]=target.widths[side.toLowerCase()]+'px';
      layer.style.clipPath=`inset(${Math.max(0,c.top-r.top)}px ${Math.max(0,r.left+r.width-c.right)}px ${Math.max(0,r.top+r.height-c.bottom)}px ${Math.max(0,c.left-r.left)}px)`;
      layer._pcGeometry=key;
    }
    const parent=target.node.closest('dialog[open]')||(this.scope===this.doc?this.doc.body:this.scope);if(layer.parentNode!==parent)parent.append(layer);
    layer.dataset.target=target.node.id||target.node.className||target.node.localName;
    // Choose the local surface's contrast polarity without widening its mask.
    layer.dataset.tone=target.tone;
  }
  measureTargets() {
    const clips=new Map(),viewport={left:0,top:0,right:this.win.innerWidth,bottom:this.win.innerHeight};
    const parent=n=>n.parentElement||n.getRootNode()?.host;
    const clipFor=node=>{
      if(!node)return viewport;if(clips.has(node))return clips.get(node);
      const c={...clipFor(parent(node))},s=this.win.getComputedStyle(node),r=node.getBoundingClientRect();
      if(/hidden|auto|scroll|clip/.test(s.overflowX)){c.left=Math.max(c.left,r.left);c.right=Math.min(c.right,r.right);}
      if(/hidden|auto|scroll|clip/.test(s.overflowY)){c.top=Math.max(c.top,r.top);c.bottom=Math.min(c.bottom,r.bottom);}
      clips.set(node,c);return c;
    };
    this.targets=[];this.lookup=new Map();
    for(const node of this.scope.querySelectorAll(PCEdgeLight.targets)){
      if(node.hidden||!node.getClientRects().length)continue;
      const r=node.getBoundingClientRect(),s=this.win.getComputedStyle(node);if(s.visibility!=='visible'||!r.width||!r.height)continue;
      // A transparent border still owns its original box-model area. Several
      // reading surfaces reserve such side borders; dropping them made only
      // the horizontal rules light up. Never invent a width for border:none.
      const widths={};for(const side of ['Top','Right','Bottom','Left'])widths[side.toLowerCase()]=['none','hidden'].includes(s['border'+side+'Style'])?0:parseFloat(s['border'+side+'Width'])||0;
      if(node.id==='note-preview'&&node.matches(':focus')&&s.boxShadow.includes('inset')){
        const [x=0,y=0,blur=0,spread=0]=(s.boxShadow.match(/-?[\d.]+px/g)||[]).map(parseFloat);
        if(!blur){if(spread>0)for(const side of ['top','right','bottom','left'])widths[side]=Math.max(widths[side],spread);else{if(x)widths[x>0?'left':'right']=Math.max(widths[x>0?'left':'right'],Math.abs(x));if(y)widths[y>0?'top':'bottom']=Math.max(widths[y>0?'top':'bottom'],Math.abs(y));}}
      }
      if(!Object.values(widths).some(Boolean))continue;
      const clip=clipFor(parent(node));if(clip.right<=clip.left||clip.bottom<=clip.top)continue;
      const rgba=s.backgroundColor.match(/[\d.]+/g)?.map(Number),dark=rgba?.length>=3&&(rgba[3]??1)>.45?rgba[0]*.2126+rgba[1]*.7152+rgba[2]*.0722<110:this.root.dataset.pcTheme==='dark';
      const target={node,rect:{left:r.left,top:r.top,width:r.width,height:r.height},corner:parseFloat(s.borderTopLeftRadius)||0,radius:s.borderRadius,widths,clip,tone:dark?'dark':'light'};this.targets.push(target);this.lookup.set(node,target);
    }
  }
  schedule(){
    if(this.frame||this.destroyed)return;
    const flush=()=>{if(!this.frame)return;this.win.cancelAnimationFrame(this.frame);this.win.clearTimeout(this.fallback);this.frame=0;this.fallback=null;this.paint();};
    this.frame=this.win.requestAnimationFrame(flush);
    // Some embedded Gecko documents throttle rAF despite receiving pointer input.
    // One bounded input fallback keeps the first contact visible; it never loops.
    this.fallback=this.win.setTimeout(flush,32);
  }
  visibleAt(target,point) {
    const inset=Math.max(.01,Math.min(.5,target.widths[point.edge]/2));
    const x=target.rect.left+point.x+(point.edge==='left'?inset:point.edge==='right'?-inset:0),y=target.rect.top+point.y+(point.edge==='top'?inset:point.edge==='bottom'?-inset:0);
    const hit=typeof this.scope.elementFromPoint==='function'?this.scope.elementFromPoint(x,y):this.doc.elementFromPoint(x,y);
    return !!hit&&(hit===target.node||target.node.contains(hit)||hit===this.scope.host);
  }
  paint() {
    this.frames++;if(!this.enabled||this.occluded()){this.clear();return;}if(this.dirty){this.dirty=false;this.measureTargets();}
    const now=this.now(),radius=PCEdgeTrail.radius;this.model.prune(now);let best;
    if(this.pointer)for(const t of this.targets){
      const {x,y}=this.pointer,r=t.rect,c=t.clip;
      if(x<c.left||x>c.right||y<c.top||y>c.bottom||x<r.left-radius||x>r.left+r.width+radius||y<r.top-radius||y>r.top+r.height+radius)continue;
      const hit=Core.borderLight(r,this.pointer,radius,t.corner,t.widths);
      if(hit&&(!best||hit.distance<best.hit.distance||(hit.distance===best.hit.distance&&r.width*r.height<best.target.rect.width*best.target.rect.height))){
        const projected=PCEdgeTrail.project(r,this.pointer,null,t.widths,t.corner);if(projected&&this.visibleAt(t,projected))best={target:t,hit};
      }
    }
    if(best){
      const t=best.target,point=PCEdgeTrail.project(t.rect,this.pointer,null,t.widths,t.corner);
      const {state,pulse}=this.model.touch(t.node,point,point.edge,now,.28+.72*best.hit.strength);this.showHead(state,t,pulse);
    }else{
      let state=this.model.depart(now);const t=state&&this.lookup.get(state.key);
      if(state&&t&&this.pointer){const projected=PCEdgeTrail.project(t.rect,this.pointer,state.edge,t.widths,t.corner);if(projected)state=this.model.extend(projected,now);}
      if(state&&t){this.geometry(this.overlay,t);this.placeDot(this.head,{...state.last,edge:state.edge},t.widths[state.edge]);this.departHead(state);}else this.hideHead();
    }
    this.sync(now);
  }
  showHead(state,target,pulse) {
    this.headFade?.cancel();this.headFade=null;this.departure=null;
    this.geometry(this.overlay,target);this.placeDot(this.head,{...state.last,edge:state.edge},target.widths[state.edge]);
    this.overlay.style.opacity=String(state.strength);this.overlay.dataset.active='true';delete this.overlay.dataset.afterglow;
    this.overlay.style.setProperty('--edge-x',state.last.x+'px');this.overlay.style.setProperty('--edge-y',state.last.y+'px');
    if(pulse){this.entryAnimation?.cancel();this.entryAnimation=this.head.animate([{opacity:.45},{opacity:1,offset:.3},{opacity:.9}],{duration:160,easing:'ease-out'});}
  }
  departHead(state) {
    delete this.overlay.dataset.active;this.overlay.dataset.afterglow='true';
    if(this.departure===state.departedAt)return;this.departure=state.departedAt;
    this.headFade?.cancel();const duration=Math.max(1,state.departedAt+this.model.duration-this.now());
    this.headFade=this.overlay.animate([{opacity:state.strength},{opacity:0}],{duration,easing:'ease-out',fill:'forwards'});
  }
  hideHead(){this.headFade?.cancel();this.entryAnimation?.cancel();this.headFade=null;this.departure=null;this.overlay.style.opacity='0';delete this.overlay.dataset.active;delete this.overlay.dataset.afterglow;}
  fadeDot(node,point,now,preserve=false) {
    const remaining=Math.max(1,point.expires-now),strength=preserve?parseFloat(this.win.getComputedStyle(node).opacity):point.strength*Math.min(1,remaining/this.model.duration)*.7;
    for(const animation of node.getAnimations({subtree:true}))animation.cancel();
    node.animate([{opacity:strength},{opacity:0}],{duration:remaining,easing:'ease-out',fill:'forwards'});
    const drift=['top','bottom'].includes(point.edge)?'translateX(7px)':'translateY(7px)';
    node.firstElementChild.animate([{opacity:1,transform:'translate(0)'},{opacity:.15,transform:drift}],{duration:remaining,easing:'linear',fill:'forwards'});
  }
  sync(now=this.now()) {
    this.model.prune(now);
    for(const key of this.model.states.keys())if(!key.isConnected||!this.lookup?.has(key))this.model.drop(key);
    const live=new Set(this.model.points.map(p=>p.id));
    for(const [id,dot]of this.dots)if(!live.has(id)){this.dispose(dot.node);this.dots.delete(id);}
    for(const point of this.model.points){
      const existing=this.dots.get(point.id);
      if(existing){if(existing.expires!==point.expires){this.fadeDot(existing.node,point,now,true);existing.expires=point.expires;}continue;}
      const target=this.lookup?.get(point.key);if(!target||!point.key.isConnected)continue;
      let layer=this.surfaces.get(point.key);if(!layer){layer=this.surface();layer.classList.add('pc-edge-history');layer.style.opacity='1';this.surfaces.set(point.key,layer);}
      this.geometry(layer,target);const node=this.dot('pc-edge-stamp');this.placeDot(node,point,target.widths[point.edge]);layer.append(node);
      this.fadeDot(node,point,now);this.dots.set(point.id,{node,key:point.key,expires:point.expires});
    }
    for(const [key,layer]of this.surfaces){if(!this.model.points.some(p=>p.key===key)){this.dispose(layer);this.layers.delete(layer);this.surfaces.delete(key);}else{const t=this.lookup?.get(key);if(t)this.geometry(layer,t);}}
    if(!this.model.states.has(this.model.active))this.hideHead();this.scheduleCleanup(now);
  }
  scheduleCleanup(now) {
    const at=this.model.nextExpiry();if(at===this.timerAt)return;
    this.win.clearTimeout(this.timer);this.timer=null;this.timerAt=at;
    if(at!==null)this.timer=this.win.setTimeout(()=>{this.timer=null;this.timerAt=null;this.sync();},Math.max(24,at-now+24));
  }
  preview(node) {
    if(!this.enabled)return false;this.clear();this.measureTargets();this.dirty=false;
    const t=this.lookup.get(node);if(!t)return false;const now=this.now(),edge=t.widths.top?'top':'left';
    const first={x:edge==='top'?14:0,y:edge==='left'?Math.min(14,t.rect.height/3):0},last={x:edge==='left'?0:t.rect.width-14,y:edge==='left'?t.rect.height-14:0};
    this.model.touch(node,first,edge,now,1);const {state}=this.model.touch(node,last,edge,now,1);this.showHead(state,t,true);this.model.depart(now);this.departHead(state);this.sync(now);return true;
  }
  clear() {
    this.model.clear();this.pointer=null;this.win.clearTimeout(this.timer);this.timer=null;this.timerAt=null;
    if(this.frame)this.win.cancelAnimationFrame(this.frame);this.win.clearTimeout(this.fallback);this.frame=0;this.fallback=null;this.hideHead();
    for(const {node}of this.dots.values())this.dispose(node);this.dots.clear();
    for(const layer of this.surfaces.values()){this.dispose(layer);this.layers.delete(layer);}this.surfaces.clear();
  }
  destroy() {
    if(this.destroyed)return;this.destroyed=true;this.clear();this.mutations.disconnect();
    this.scope.removeEventListener('pointermove',this.move);this.leaveRoot.removeEventListener('pointerleave',this.leave);this.scope.removeEventListener('pointerdown',this.clearLayout);
    for(const type of ['click','input','animationend','focusin','focusout'])this.scope.removeEventListener(type,this.invalidate);
    this.doc.removeEventListener('scroll',this.scroll,true);this.win.removeEventListener('resize',this.clearLayout);this.win.removeEventListener('blur',this.clearLayout);
    this.dispose(this.overlay);this.layers.clear();
  }
}
root.PCEdgeTrail=PCEdgeTrail;root.PCEdgeLight=PCEdgeLight;
if(typeof module==='object'&&module.exports)module.exports={PCEdgeTrail,PCEdgeLight};
})(this);
