const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../addon/content/native.js'),'utf8');
const methods=vm.runInNewContext('(class{'+source.slice(source.indexOf('  async saveSettings('),source.indexOf('  async chooseAccount('))+'}).prototype',{PathUtils:{join:(...parts)=>parts.join('/')},PCore:require('../addon/content/core.js')});
function setup(){
 let serial=Promise.resolve(),release,blocked=true;const gate=new Promise(r=>release=r),writes=[],events=[];
 const api={settings:{theme:'blue',language:'简体中文'},dir:'/profile',formula:{validateSettings(){}},insights:{validatePrompts:()=>({})},
  queue(fn){const task=serial.then(fn);serial=task.catch(()=>{});return task;},
  async writeJSON(path,value){writes.push(JSON.parse(JSON.stringify(value)));if(blocked&&writes.length===1)await gate;api.disk=JSON.parse(JSON.stringify(value));},
  emit:type=>events.push(type),refreshSelectionPopups(){},async readSecrets(){return{deepseek:'fake-existing'};},async writeSecrets(value){api.secrets=value;},usage:{async invalidateBalance(){}}};
 Object.setPrototypeOf(api,methods);return{api,writes,events,release:()=>{blocked=false;release();}};
}
test('a theme write and a later full settings save preserve both choices on disk and in memory',async()=>{
 const s=setup(),theme=s.api.saveAppearance({theme:'dark'});await new Promise(setImmediate);const prefs=s.api.saveSettings({language:'English'});await new Promise(setImmediate);s.release();await Promise.all([theme,prefs]);assert.equal(s.api.settings.theme,'dark');assert.equal(s.api.settings.language,'English');assert.equal(s.api.disk.theme,'dark');assert.equal(s.api.disk.language,'English');assert.equal(s.writes.length,2);
});
test('full settings, credentials and later appearance changes share one committed settings order',async()=>{
 const s=setup(),prefs=s.api.saveSettings({language:'English'},'fake-next-key');await new Promise(setImmediate);const theme=s.api.saveAppearance({theme:'warm'});s.release();await Promise.all([prefs,theme]);assert.equal(s.api.settings.theme,'warm');assert.equal(s.api.disk.language,'English');assert.equal(s.api.secrets.deepseek,'fake-next-key');assert.equal(s.events.filter(x=>x==='settings').length,1);
});
test('a failed settings file write leaves the last committed in-memory values intact',async()=>{
 const s=setup();s.api.writeJSON=async()=>{throw Error('synthetic disk failure');};await assert.rejects(s.api.saveSettings({language:'English'}),/synthetic disk/);assert.equal(s.api.settings.language,'简体中文');assert.equal(s.events.length,0);
});
test('the new cloud choice saves and an invalid appearance cannot alter committed settings',async()=>{
 const s=setup();s.release();await s.api.saveAppearance({theme:'cloud'});assert.equal(s.api.settings.theme,'cloud');assert.equal(s.api.disk.theme,'cloud');const count=s.writes.length;
 await assert.rejects(s.api.saveAppearance({theme:'invalid'}),/有效/);await assert.rejects(s.api.saveSettings({theme:'invalid'}),/有效/);assert.equal(s.writes.length,count);assert.equal(s.api.settings.theme,'cloud');
});
