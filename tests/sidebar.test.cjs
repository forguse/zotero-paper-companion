const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('native sidebar reserves overlapping navigation width and releases its resize observers', () => {
  const scope = vm.createContext({});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../addon/content/sidebar.js'), 'utf8'), scope);
  const callbacks = [], listeners = new Map();
  let disconnected = false, observed = 0, cancelled = false;
  const win = {
    setTimeout(fn) { callbacks.push(fn); return callbacks.length; },
    clearTimeout() { cancelled = true; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    ResizeObserver: class { constructor(fn) { this.notify = fn; } observe() { observed++; } disconnect() { disconnected = true; } }
  };
  let host = { left: 100, right: 400, top: 40, bottom: 640, width: 300 };
  let nav = { left: 400, right: 434, top: 0, bottom: 700, width: 34 };
  const rail = { getBoundingClientRect: () => nav };
  const body = { clientWidth: 300, getBoundingClientRect: () => host, ownerDocument: { defaultView: win, getElementById: () => rail } };
  const frame = { isConnected: true, style: {} }, sidebar = new scope.PCSidebar({});
  const flush = () => { while (callbacks.length) callbacks.shift()(); };
  const resize = () => { listeners.get('resize')(); flush(); };
  sidebar.fitToContent(body, frame);
  assert.equal(frame.style.maxWidth, '300px', 'normal layout does not waste the already reserved rail space');
  nav = { ...nav, left: 366, right: 400 }; resize();
  assert.equal(frame.style.maxWidth, '266px', 'overlay rail cannot cover the frame');
  nav = { ...nav, width: 0 }; resize();
  assert.equal(frame.style.maxWidth, '300px', 'hiding the rail returns space to the content');
  body.clientWidth = 220; host = { ...host, width: 220, right: 320 }; resize();
  assert.equal(frame.style.maxWidth, '220px', 'sidebar drag-resizing reflows the panel');
  assert.equal(observed, 2);
  listeners.get('resize')();
  sidebar.fitters.get(frame)();
  assert.ok(disconnected);
  assert.ok(cancelled, 'pending layout work is cancelled when the reader is destroyed');
  assert.equal(listeners.size, 0);
});

test('native reading focus borrows title space only in its visible pane and restores original styling', () => {
  const scope=vm.createContext({});vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../addon/content/sidebar.js'),'utf8'),scope);
  const pending=[],events=new Map(),scrolls=new Map(),values=new Map([['display',{value:'block',priority:'important'}]]);
  const style={getPropertyValue:k=>values.get(k)?.value||'',getPropertyPriority:k=>values.get(k)?.priority||'',setProperty:(k,value,priority)=>values.set(k,{value,priority}),removeProperty:k=>values.delete(k)};
  const header={style};let away=false;const hidden=()=>style.getPropertyValue('display')==='none';
  const win={innerHeight:800,setTimeout(fn){pending.push(fn);return pending.length;},clearTimeout(){},addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k),ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}}};
  const viewport={getBoundingClientRect:()=>({top:hidden()?40:80,bottom:800,height:hidden()?760:720}),addEventListener:(k,fn)=>scrolls.set(k,fn),removeEventListener:k=>scrolls.delete(k)};
  const pane={open:true,getBoundingClientRect:()=>({top:away?1000:hidden()?40:80})};
  const details={querySelector:s=>s==='item-pane-header'?header:viewport};
  const body={style:{},clientWidth:300,closest:s=>s==='item-details'?details:pane,getBoundingClientRect:()=>({left:0,right:300,top:away?1020:hidden()?60:100,bottom:away?1500:780,width:300}),ownerDocument:{defaultView:win,getElementById:()=>null}};
  const frame={isConnected:true,style:{}},panel={frameElement:frame},sidebar=new scope.PCSidebar({});sidebar.frames.add(frame);sidebar.fitToContent(body,frame);
  const flush=()=>{while(pending.length)pending.shift()();};const initialHeight=parseInt(body.style.height);
  sidebar.setReadingFocus(panel,true);flush();assert.equal(style.getPropertyValue('display'),'none');assert(parseInt(body.style.height)>initialHeight,'title space becomes usable panel height');
  away=true;scrolls.get('scroll')();flush();assert.equal(style.getPropertyValue('display'),'block');assert.equal(style.getPropertyPriority('display'),'important','another native section regains the exact prior title style');
  away=false;scrolls.get('scroll')();flush();assert.equal(style.getPropertyValue('display'),'none');pane.open=false;events.get('resize')();flush();assert.equal(style.getPropertyValue('display'),'block','closing the plugin section restores native chrome');
  pane.open=true;events.get('resize')();flush();win.innerHeight=600;events.get('resize')();flush();assert(parseInt(body.style.height)<initialHeight,'resizing fits the actual remaining viewport');
  sidebar.fitters.get(frame)();assert.equal(style.getPropertyValue('display'),'block');assert.equal(events.size,0);assert.equal(scrolls.size,0);assert.equal(sidebar.schedules.size,0);
});
