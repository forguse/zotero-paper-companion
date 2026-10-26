const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../addon/content/core.js');
function setup(){
 const files=new Map(),calls=[],paper={id:1,key:'1_PAPER',title:'Article',link:'zotero://open-pdf/library/items/PAPER'};
 const index={data:{paper,fingerprint:'first',pages:[{page:1,text:'INTRODUCTION_MARKER '+ 'a'.repeat(60000)},{page:2,text:'EXPERIMENT_MARKER '+ 'b'.repeat(60000)},{page:3,text:''}],characters:120000}};
 const paths={preread:'/papers/论文预读.md',prereadData:'/papers/.paper-companion/preread.json',prereadProgress:'/papers/.paper-companion/preread-progress.json'};
 const api={settings:{chatProvider:'deepseek',chatDeepseekModel:'deepseek-flash',chatGPTEffort:'default'},models:[],chatBusy:false,
  reading:{load:async()=>index},files:{changing:new Set(),ensure:async()=>paths},emit(){},queue:fn=>fn(),
  readJSON:async(p,f)=>files.has(p)?JSON.parse(files.get(p)):f,writeJSON:async(p,v)=>files.set(p,JSON.stringify(v)),writeText:async(p,v)=>files.set(p,v),
  gateway:{snapshot:config=>Object.freeze({...config}),generate:async options=>{calls.push(options);return 'BRIEF: sections and evidence, PDF pages 1–3.';}}
 };
 const context={PCore:core,AbortController};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../addon/content/preread.js'),'utf8'),context);
 return {read:new context.PCPreRead(api),api,files,calls,paper,index,paths};
}
test('manual preread sends all extracted text with page positions, then persists only a bounded reusable brief',async()=>{
 const {read,calls,paper,files,paths}=setup();assert.equal(calls.length,0);const a=read.run(paper),b=read.run(paper);assert.equal(a,b);const saved=await a;
 assert(calls.some(c=>c.text.includes('INTRODUCTION_MARKER'))&&calls.some(c=>c.text.includes('EXPERIMENT_MARKER')));
 assert.equal(calls.filter(c=>c.text.includes("这是全文第")).map(c=>(c.text.match(/a/g)||[]).length).reduce((a,b)=>a+b,0),60000);
 assert.equal(calls.filter(c=>c.text.includes("这是全文第")).map(c=>(c.text.match(/b/g)||[]).length).reduce((a,b)=>a+b,0),60000);
 assert(calls.every(c=>c.usageFeature==='preread'&&c.usageKey===paper.key&&c.model==='deepseek-flash'));
 assert.equal(saved.emptyPages[0],3);assert(files.get(paths.preread).includes('未提取到文字的页：3'));assert((await read.context(paper)).includes('不是服务器永久记忆'));
 const count=calls.length;await read.run(paper);assert.equal(calls.length,count);
});

test('preflight prepares only local data, reports segments and unknown pricing honestly, and rejects stale plans',async()=>{
 const {read,paper,index,calls}=setup();const plan=await read.plan(paper);assert.equal(calls.length,0);assert.equal(plan.pages,3);assert(plan.batches>1&&plan.requests>plan.batches);assert.equal(plan.emptyPages,1);assert.equal(plan.cost,null);
 index.data.fingerprint='changed';await assert.rejects(read.run(paper,{expected:plan}),/重新查看/);assert.equal(calls.length,0);
 const fresh=await read.plan(paper);await read.run(paper,{expected:fresh});const reusable=await read.plan(paper);assert.equal(reusable.reusable,true);
});
test('local reading status distinguishes preparation, extraction, saved brief and changed PDF without model calls',async()=>{
 const {read,api,paper,calls}=setup(),inspection={state:'unprepared',fingerprint:'first',pages:0};api.reading.inspect=async()=>inspection;
 assert.equal((await read.describe(paper)).state,'unprepared');inspection.state='extracted';assert.equal((await read.describe(paper)).state,'extracted');assert.equal(calls.length,0);
 await read.run(paper);const before=calls.length,restarted=new read.constructor(api);assert.equal((await restarted.describe(paper)).state,'ready');
 inspection.fingerprint='changed';assert.equal((await restarted.describe(paper)).state,'stale');assert.equal(calls.length,before);
 inspection.fingerprint='';assert.equal((await restarted.describe(paper)).state,'unchecked');
});
test('cancelled preread retains completed segment progress and resumes without retransmitting completed segments',async()=>{
 const {read,api,paper,calls,files,paths}=setup();let count=0;
 api.gateway.generate=async o=>{calls.push(o);if(++count===2){read.stop(paper.key);throw Error('cancelled');}return 'PART_ONE_SAVED';};
 await assert.rejects(read.run(paper),/cancelled/);assert.equal(JSON.parse(files.get(paths.prereadProgress)).parts.length,1);assert(!files.has(paths.prereadData));
 const completed=calls[0].text;calls.length=0;api.gateway.generate=async o=>{calls.push(o);return 'RESUMED_BRIEF';};await read.run(paper);
 assert(!calls.some(c=>c.text===completed));assert(files.has(paths.prereadData));
});
test('a changed PDF invalidates brief reuse; failed refresh preserves the previous completed brief',async()=>{
 const {read,paper,index,files,paths,api}=setup();await read.run(paper);const original=files.get(paths.prereadData);index.data.fingerprint='changed';assert.equal(await read.context(paper,index),'');
 api.gateway.generate=async()=>{throw Error('provider unavailable');};await assert.rejects(read.run(paper),/provider unavailable/);assert.equal(files.get(paths.prereadData),original);
});
test('preread refuses unavailable providers, unsupported effort, folder moves, and overlong model output without substitution',async()=>{
 const {read,api,paper,calls}=setup();api.settings.chatProvider='chatgpt-web';assert.throws(()=>read.run(paper),/预读草稿/);assert.equal(calls.length,0);
 api.settings.chatProvider='chatgpt';api.settings.model='gpt-6.1-sol';api.settings.chatGPTEffort='none';assert.throws(()=>read.run(paper),/不支持/);
 api.settings.chatProvider='deepseek';api.files.changing.add(paper.key);await assert.rejects(read.run(paper),/文件夹/);api.files.changing.clear();api.gateway.generate=async()=> 'x'.repeat(16001);await assert.rejects(read.run(paper),/过长/);
});
test('reasoning capabilities prefer explicit model metadata and preserve selected effort in Responses',()=>{
 assert.deepEqual(core.reasoningEfforts('gpt-6.1-sol'),['default','low','medium','high','xhigh','max']);assert.deepEqual(core.reasoningEfforts('unknown'),['default']);assert.deepEqual(core.reasoningEfforts('unknown',[{effort:'low'},{effort:'high'},'invalid']),['default','low','high']);
 assert.equal(core.responsesBody({model:'selected',prompt:'p',effort:'high'}).reasoning.effort,'high');assert(!core.responsesBody({model:'selected',prompt:'p'}).reasoning);assert.throws(()=>core.responsesBody({model:'selected',effort:'ultra'}),/无效/);
});
