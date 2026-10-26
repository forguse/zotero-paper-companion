const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path').posix;
function setup(){
 const files=new Map();let fail='';
 const scope={PCore:require('../addon/content/core.js'),PCInsights:{defaultPrompts:{}},Zotero:{},PathUtils:{join:path.join,filename:path.basename},IOUtils:{exists:async p=>files.has(p),getChildren:async dir=>[...files.keys()].filter(p=>path.dirname(p)===dir)}};
 vm.createContext(scope);for(const name of ['persistence.js','sessions.js','model-gateway.js','reading-scope.js','chat-service.js','native.js'])vm.runInContext(fs.readFileSync(require.resolve('../addon/content/'+name),'utf8'),scope);
 const api=scope.PaperCompanion;api.chatsDir='/chats';api.writeText=async(p,v)=>{if(p===fail)throw Error('disk full');files.set(p,v);};api.readJSON=async(p,f)=>files.has(p)?JSON.parse(files.get(p)):f;
 return {api,files,fail:p=>fail=p};
}
const messages=(q,at)=>[{role:'user',text:q,at,status:'complete'},{role:'assistant',text:q+' answer',at:at+1,status:'complete'}];
test('archive lookup is paper scoped, rejects paths, and restoring preserves the current conversation',async()=>{
 const {api,files}=setup();api.sessions.set('1_A',{messages:messages('old',10)});await api.newSession('1_A');const first=(await api.chatArchives('1_A'))[0];
 api.sessions.set('1_A',{messages:messages('new',20)});await api.restoreSession('1_A',first.id);
 assert.equal((await api.session('1_A')).messages[0].text,'old');assert.equal((await api.chatArchives('1_A')).length,2);
 assert.equal((await api.chatArchives('1_B')).length,0);await assert.rejects(api.archivedSession('1_A','../secrets.json'),/不存在/);
 assert([...files.values()].some(s=>JSON.parse(s).messages[0]?.text==='new'));
 const collected=await api.summaryMessages('1_A');assert(collected.some(m=>m.text==='old'));assert(collected.some(m=>m.text==='new'));assert(collected.some(m=>m.role==='boundary'));
});
test('archive creation failure and current-file failure preserve the in-memory conversation',async()=>{
 const {api,fail}=setup();const original={messages:messages('keep',10)};api.sessions.set('1_A',original);fail('/chats/1_A.json');
 await assert.rejects(api.newSession('1_A'),/disk full/);assert.equal(await api.session('1_A'),original);assert.equal(api.sessionChanging,false);assert.equal((await api.chatArchives('1_A')).length,1);
});
test('restoring rejects malformed archives and cannot run while a response is active',async()=>{
 const {api,files}=setup();files.set('/chats/1_A-123.json','{"messages":[{"role":"user","text":5}]}');
 await assert.rejects(api.restoreSession('1_A','1_A-123.json'),/格式无效/);assert.equal(api.sessionRestoring,false);
 api.chatBusy=true;await assert.rejects(api.newSession('1_A'),/停止/);await assert.rejects(api.restoreSession('1_A','1_A-123.json'),/等待/);
});
