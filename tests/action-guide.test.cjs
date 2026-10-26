const { test } = require('node:test');
const assert = require('node:assert/strict');
const PCActionGuide = require('../addon/content/action-guide.js');
const turn = () => new Promise(resolve => setImmediate(resolve));
function gate() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }

test('guide preferences normalize known ids and remain read-only until an explicit change', () => {
  const writes=[];const prefs=new PCActionGuide.Prefs({readPrefs:()=>({pins:['missing','a','a','b','c'],dismissed:1}),savePrefs:value=>writes.push(value),ids:['a','b','c']});
  assert.deepEqual(prefs.draft,{pins:['a','b'],dismissed:false});assert.equal(writes.length,0);
  assert.throws(()=>prefs.setPin('missing',true),/不可用/);assert.throws(()=>prefs.setPin('c',true),/最多/);
  assert.throws(()=>prefs.change({unknown:1}),/字段/);assert.throws(()=>prefs.change({dismissed:'yes'}),/无效/);assert.equal(writes.length,0);
});

test('preference writes serialize changed fields and retain newer intents after an older failure', async () => {
  const first=gate(),writes=[],errors=[];let stored={pins:['a'],dismissed:false};
  const prefs=new PCActionGuide.Prefs({readPrefs:()=>stored,ids:['a','b'],notify:error=>errors.push(error),savePrefs:async patch=>{writes.push(patch);if(writes.length===1)await first.promise;stored={...stored,...patch};}});
  const save=prefs.setPin('b',true);await turn();assert.deepEqual(writes,[{pins:['a','b']}]);
  prefs.change({dismissed:true});prefs.setPin('a',false);assert.deepEqual(prefs.draft,{pins:['b'],dismissed:true});
  stored={pins:['a'],dismissed:false};assert.equal(prefs.refresh(),false);first.reject(new Error('synthetic disk failure'));
  assert.equal(await save,false);assert.equal(writes.length,2);assert.deepEqual(writes[1],{pins:['b'],dismissed:true});assert.deepEqual(stored,{pins:['b'],dismissed:true});
  assert.equal(errors.length,1);assert.equal(prefs.error,'');assert.equal(prefs.saving,false);
});

test('failed preference write restores committed state and can be explicitly retried', async () => {
  let fail=true;const writes=[];const prefs=new PCActionGuide.Prefs({readPrefs:()=>({pins:[],dismissed:false}),ids:['a'],savePrefs:async patch=>{writes.push(patch);if(fail)throw new Error('synthetic failure');}});
  assert.equal(await prefs.change({dismissed:true}),false);assert.equal(prefs.draft.dismissed,false);assert.match(prefs.error,/failure/);
  fail=false;assert.equal(await prefs.change({dismissed:true}),true);assert.deepEqual(writes,[{dismissed:true},{dismissed:true}]);assert.equal(prefs.draft.dismissed,true);
  prefs.detach();await assert.rejects(prefs.change({dismissed:false}),/已关闭/);
});

test('unchanged preferences do not cause disk writes and source refresh waits for pending changes', async () => {
  const writes=[];let stored={pins:['a'],dismissed:false};const prefs=new PCActionGuide.Prefs({readPrefs:()=>stored,ids:['a','b'],savePrefs:async patch=>{writes.push(patch);stored={...stored,...patch};}});
  assert.equal(await prefs.setPin('a',true),true);assert.equal(writes.length,0);stored={pins:['b'],dismissed:true};assert.equal(prefs.refresh(),true);assert.deepEqual(prefs.draft,stored);
});

class Node extends EventTarget {
  constructor(document,tag='div') { super();this.ownerDocument=document;this.tagName=tag;this.children=[];this.attributes={};this.className='';this.textContent='';this.hidden=false;this.disabled=false;this.open=false; }
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){this.ownerDocument.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);}
  click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
function fixture() {
  const document={createElement:tag=>new Node(document,tag)};document.body=new Node(document,'body');const openButton=new Node(document,'button'),shortcutsHost=new Node(document),hintHost=new Node(document),runs=[],writes=[],errors=[];
  let state={page:'chat',empty:true,paperAvailable:false},prefs={pins:[],dismissed:false};
  const guide=new PCActionGuide({document,openButton,shortcutsHost,hintHost,getState:()=>state,readPrefs:()=>prefs,savePrefs:async patch=>{writes.push(patch);prefs={...prefs,...patch};},notify:error=>errors.push(error),actions:[
    {id:'questions',label:'常用问题',description:'先填入草稿，不自动发送',pages:['chat'],run:()=>runs.push('questions')},
    {id:'notes',label:'阅读笔记',pages:['chat','notes'],available:value=>value.paperAvailable,run:()=>runs.push('notes')},
    {id:'vocabulary',label:'单词本',run:()=>runs.push('vocabulary')}]});
  return {guide,document,openButton,shortcutsHost,hintHost,runs,writes,errors,state:patch=>{state={...state,...patch};guide.update(state);}};
}

test('guide shows local page help and optional empty hint without running actions or saving on startup', async () => {
  const f=fixture();assert.equal(f.writes.length,0);assert.equal(f.runs.length,0);assert.equal(f.shortcutsHost.hidden,true);assert.equal(f.hintHost.hidden,false);
  assert.equal(f.guide.rows.get('notes').button.disabled,true);f.openButton.click();assert.equal(f.guide.dialog.open,true);assert.equal(f.document.activeElement,f.guide.pageSelect);
  await assert.rejects(f.guide.invoke('notes'),/不可用/);assert.equal(f.runs.length,0);f.state({paperAvailable:true});await f.guide.invoke('notes');
  assert.deepEqual(f.runs,['notes']);assert.equal(f.guide.dialog.open,false);assert.equal(f.document.activeElement,f.openButton);assert.equal(f.writes.length,0);
});

test('pinned actions are opt-in and availability updates without changing the persisted choice', async () => {
  const f=fixture();await f.guide.prefs.setPin('notes',true);assert.deepEqual(f.writes,[{pins:['notes']}]);assert.equal(f.shortcutsHost.hidden,false);assert.equal(f.guide.shortcuts.get('notes').disabled,true);
  f.state({page:'notes',paperAvailable:true,empty:false});assert.equal(f.guide.shortcuts.get('notes').disabled,false);assert.equal(f.guide.rows.get('questions').row.hidden,true);assert.equal(f.hintHost.hidden,true);
  f.guide.shortcuts.get('notes').click();await turn();assert.deepEqual(f.runs,['notes']);assert.equal(f.writes.length,1);
});

test('empty help can be dismissed and reset, and destroying the guide detaches actions', async () => {
  const f=fixture();f.guide.dismissButton.click();await turn();assert.equal(f.hintHost.hidden,true);assert.deepEqual(f.writes,[{dismissed:true}]);
  f.guide.resetButton.click();await turn();assert.equal(f.hintHost.hidden,false);assert.deepEqual(f.writes.at(-1),{dismissed:false});
  const row=f.guide.rows.get('questions').button;f.guide.destroy();row.click();await turn();assert.equal(f.runs.length,0);assert.equal(f.guide.open(),false);assert.equal(f.shortcutsHost.hidden,true);assert.equal(f.hintHost.hidden,true);
});
