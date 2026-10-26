const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const core = require('../addon/content/core.js');
const Gateway = require('../addon/content/model-gateway.js');
function setup() {
  const files = new Map(), calls = [], paper = { key:'1_PAPER',title:'Paper',link:'zotero://open-pdf/library/items/PAPER' };
  const api = {
    settings:{ chatProvider:'deepseek',summaryEnabledPapers:{},summaryProvider:'deepseek',summaryDeepseekModel:'deepseek-flash',summaryChatGPTModel:'',summaryEffort:'none',summaryChatGPTEffort:'default' },
    state:'online',models:[{id:'chat-one'},{id:'chat-two'}],meta:{active:'test'},
    readSecrets:async()=>({deepseek:'fake-test-key'}),auth:{access:async()=>'fake-plan-token'},
    saveSettings:async function(s){Object.assign(this.settings,s);}, emit(){},
    readJSON:async(p,f)=>JSON.parse(JSON.stringify(files.has(p)?JSON.parse(files.get(p)):f)),
    writeJSON:async(p,v)=>files.set(p,JSON.stringify(v)),writeText:async(p,v)=>files.set(p,v),
    paperFromKey:async key=>({...paper,key}),session:async()=>({messages:[]}),
    request:async(url,opts)=>{calls.push({url,...opts,body:JSON.parse(opts.body)});if(opts.onChunk){opts.onChunk('data: {"type":"response.output_text.delta","delta":"Chat output"}\n\n');opts.onChunk('data: {"type":"response.completed","response":{"status":"completed"}}\n\n');return;}return {choices:[{message:{content:'- Important scientific result'},finish_reason:'stop'}]};}
  };
  api.gateway=new Gateway({connection:()=>({state:api.state,active:api.meta.active,epoch:api.epoch,models:api.models}),readDeepseekKey:async()=>(await api.readSecrets()).deepseek,accessToken:(account,signal)=>api.auth.access(account,signal),request:(url,options)=>api.request(url,options)});
  const context={PCore:core,crypto:webcrypto,TextEncoder,AbortController,PathUtils:{join:(...p)=>p.join('/')},Zotero:{DataDirectory:{dir:'/data'}},IOUtils:{makeDirectory:async()=>{}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../addon/content/insights.js'),'utf8'),context);
  const insights=new context.PCInsights(api);return {api,insights,files,calls,paper};
}
test('highlights remain off and issue no request until explicitly enabled; missing key never falls back',async()=>{
  const {api,insights,files,calls,paper}=setup();await insights.init();
  assert.equal(await insights.enqueue(paper.key,{question:'q',answer:'a'}),false);assert.equal(calls.length,0);assert.equal(files.size,0);
  api.readSecrets=async()=>({deepseek:''});await assert.rejects(insights.setEnabled(paper,true),/DeepSeek API Key/);
  assert.equal(insights.enabled(paper.key),false);assert.equal(calls.length,0);
});

test('manual highlights include archived turns, reset questions at session boundaries and deduplicate snapshots',async()=>{
 const {api,insights,paper,calls}=setup();await insights.init();
 const exchange=[{role:'user',text:'Archived research question',status:'complete',at:1},{role:'assistant',text:'Archived result',status:'complete',at:2}];
 api.summaryMessages=async()=>[...exchange,{role:'boundary'},{role:'assistant',text:'Orphan answer',status:'complete',at:3},{role:'boundary'},...exchange];
 await insights.collectNative(paper.key,{manual:true});assert.equal(calls.length,1);assert(calls[0].body.messages[1].content.includes('Archived research question'));assert(!calls[0].body.messages[1].content.includes('Orphan answer'));
});
test('translation-style requests honor selected provider, model, and effort without using chat model defaults',async()=>{
  const {insights,calls,api}=setup();await insights.init();
  await insights.generate({provider:'deepseek',model:'deepseek-flash',effort:'none',instructions:'translate',text:'selected'});
  assert.equal(calls[0].body.thinking.type,'disabled');assert(!('reasoning_effort' in calls[0].body));
  await insights.generate({provider:'deepseek',model:'deepseek-v4-pro',effort:'max',instructions:'translate',text:'selected'});
  assert.equal(calls[1].body.model,'deepseek-v4-pro');assert.equal(calls[1].body.reasoning_effort,'max');assert.equal(calls[1].body.thinking.type,'enabled');
  await insights.generate({provider:'chatgpt',model:'chat-one',effort:'high',instructions:'translate',text:'selected'});
  assert.equal(calls[2].body.model,'chat-one');assert.equal(calls[2].body.reasoning.effort,'high');assert.equal(calls[2].body.instructions,'translate');
  await assert.rejects(insights.generate({provider:'chatgpt',model:'',effort:'default',text:'q'}),/单独选择/);
  api.state='offline';await assert.rejects(insights.generate({provider:'chatgpt',model:'chat-one',effort:'default',text:'q'}),/手动连接/);assert.equal(calls.length,3);
});
test('image generation sends images to both chosen providers and rejects unsupported models before requesting', async () => {
  const {insights,calls} = setup(), image = 'data:image/png;base64,YQ==';
  await insights.generate({provider:'deepseek',model:'deepseek-flash',effort:'none',instructions:'OCR',text:'formula',images:[image]});
  assert.equal(calls[0].body.messages[1].content[1].image_url.url,image);
  await insights.generate({provider:'chatgpt',model:'chat-one',effort:'default',instructions:'OCR',text:'formula',images:[image]});
  assert(calls[1].body.input.some(m => m.content.some(c => c.type === 'input_image' && c.image_url === image)));
  await assert.rejects(insights.generate({provider:'deepseek',model:'deepseek-v4-pro',images:[image]}),/不会自动切换/);
  assert.equal(calls.length,2);
});

test('concurrent duplicate turns generate once and independent papers keep distinct Markdown documents',async()=>{
  const {insights,files,calls,paper}=setup();await insights.init();await insights.setEnabled(paper,true);
  const turn={question:'Question',answer:'Answer',id:'one',source:'deepseek'};
  await Promise.all([insights.enqueue(paper.key,turn),insights.enqueue(paper.key,turn),insights.enqueue(paper.key,turn)]);
  assert.equal(calls.length,1);const first=files.get('/data/paper-companion/highlights/1_PAPER.md');assert(first.includes('Important scientific result'));assert(!first.includes('Question'));
  const other={...paper,key:'1_OTHER',title:'Other'};await insights.setEnabled(other,true);await insights.enqueue(other.key,turn);
  assert.equal(calls.length,2);assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.md'),first);assert(files.has('/data/paper-companion/highlights/1_OTHER.md'));
  await insights.setEnabled(paper,false);await insights.enqueue(paper.key,{...turn,id:'two'});assert.equal(calls.length,2);assert(files.has('/data/paper-companion/highlights/1_PAPER.md'));
});
test('incomplete generation does not mark a turn as processed or overwrite saved highlights',async()=>{
  const {api,insights,files,paper}=setup();await insights.init();await insights.setEnabled(paper,true);
  const before=files.get('/data/paper-companion/highlights/1_PAPER.md');api.request=async()=>({choices:[{message:{content:'truncated'},finish_reason:'length'}]});
  await assert.rejects(insights.enqueue(paper.key,{question:'q',answer:'a',id:'partial',source:'deepseek'}),/完整结果/);
  assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.md'),before);assert(!files.has('/data/paper-companion/highlights/1_PAPER.json'));
});
test('disabling during generation aborts the request and preserves the previous Markdown',async()=>{
  const {api,insights,files,paper}=setup();await insights.init();await insights.setEnabled(paper,true);
  const before=files.get('/data/paper-companion/highlights/1_PAPER.md');let started;const running=new Promise(r=>started=r);
  api.request=async(_,{signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});started();});
  const pending=insights.enqueue(paper.key,{question:'q',answer:'a',id:'abort',source:'deepseek'});await running;await insights.setEnabled(paper,false);await assert.rejects(pending,/cancelled/);
  assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.md'),before);
});
test('opt-in web watcher waits for stable complete content and does not repeatedly generate or read while off',async()=>{
  const {api,insights,calls,paper}=setup();await insights.init();api.settings.chatProvider='chatgpt-web';let poll,reads=0,cleared=false;
  const win={setInterval(fn){poll=fn;return 1;},clearInterval(){cleared=true;}};
  api.web={views:new Map([[win,{opened:true}]]),query:async()=>{reads++;return {streaming:false,conversation:'/c/test',turns:[{id:'web-one',question:'Question',answer:'Answer'}]};}};
  insights.watchWeb(win,paper);assert.equal(poll,undefined);await insights.setEnabled(paper,true);insights.watchWeb(win,paper);
  await poll();assert.equal(calls.length,0);await poll();assert.equal(calls.length,1);await poll();assert.equal(calls.length,1);
  await insights.setEnabled(paper,false);insights.watchWeb(win,paper);assert(cleared);const before=reads;await poll();assert.equal(reads,before);
});

test('manual chat summary works with automation off, skips processed turns across restart, and never updates review',async()=>{
  const {api,insights,calls,files,paper}=setup();await insights.init();
  api.session=async()=>({messages:[
    {role:'user',text:'Question',status:'complete'}, {role:'assistant',text:'Answer',status:'complete',at:1,provider:'deepseek'},
    {role:'user',text:'Unfinished question',status:'complete'}, {role:'assistant',text:'Partial',status:'failed',at:2}
  ]});
  await Promise.all([insights.manualUpdate(paper),insights.manualUpdate(paper)]);
  assert.equal(calls.length,1);assert.equal(insights.enabled(paper.key),false);
  assert(files.get('/data/paper-companion/highlights/1_PAPER.md').includes('Important scientific result'));
  assert(!files.has('/data/paper-companion/highlights/1_PAPER.review.md'));
  const resumed=new insights.constructor(api);await resumed.init();await resumed.manualUpdate(paper);
  assert.equal(calls.length,1);assert.equal(resumed.manualJobs.size,0);
});

test('manual web summary reads completed loaded turns only on click without enabling a watcher or sending',async()=>{
  const {api,insights,calls,paper}=setup();await insights.init();api.settings.chatProvider='chatgpt-web';
  const win={},actions=[];
  api.web={views:new Map([[win,{opened:true}]]),query:async(_,action)=>{actions.push(action);return {streaming:false,conversation:'/c/manual',turns:[{id:'web',question:'q',answer:'a'}]};}};
  insights.watchWeb(win,paper);assert.equal(insights.watches.size,0);assert.equal(actions.length,0);
  await insights.manualUpdate(paper,win);await insights.manualUpdate(paper,win);
  assert.deepEqual(actions,['conversation','conversation']);assert.equal(calls.length,1);assert(!insights.enabled(paper.key));
  api.web.query=async()=>({streaming:true,turns:[]});await assert.rejects(insights.manualUpdate(paper,win),/等待网页回答完成/);
  assert.equal(calls.length,1);
});

test('review requires a first document and uses only its concise summary, coalescing clicks and skipping unchanged input',async()=>{
  const {api,insights,calls,files,paper}=setup();await insights.init();
  await assert.rejects(insights.review(paper),/先点击/);assert.equal(calls.length,0);
  await insights.enqueue(paper.key,{id:'one',source:'deepseek',question:'RAW_QUESTION',answer:'RAW_ANSWER'},{manual:true});
  const first=files.get('/data/paper-companion/highlights/1_PAPER.md');
  await Promise.all([insights.review(paper),insights.review(paper),insights.review(paper)]);
  assert.equal(calls.length,2);const body=calls[1].body;
  assert.equal(body.messages[1].content,first);assert(!body.messages[1].content.includes('RAW_QUESTION'));
  assert(body.messages[0].content.includes('合并重复'));assert(files.get('/data/paper-companion/highlights/1_PAPER.review.md').includes('重点再整理'));
  assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.md'),first);
  assert.equal((await insights.readReview(paper)).stale,false);
  const resumed=new insights.constructor(api);await resumed.init();await resumed.review(paper);
  assert.equal(calls.length,2);assert(resumed.reviewStatus.get(paper.key).text.includes('未调用模型'));
});

test('new first-document entries mark review stale but never regenerate it until clicked; papers stay independent',async()=>{
  const {insights,calls,files,paper}=setup();await insights.init();
  const turn={id:'one',source:'deepseek',question:'q',answer:'a'};
  await insights.setEnabled(paper,true);await insights.enqueue(paper.key,turn);await insights.review(paper);
  const path='/data/paper-companion/highlights/1_PAPER.review.md',before=files.get(path);
  await insights.enqueue(paper.key,{...turn,id:'two'});
  assert.equal(calls.length,3);assert.equal(files.get(path),before);assert.equal((await insights.readReview(paper)).stale,true);
  await insights.review(paper);assert.equal(calls.length,4);assert.equal((await insights.readReview(paper)).stale,false);
  const other={...paper,key:'1_OTHER',title:'Other'};
  await assert.rejects(insights.review(other),/先点击/);assert.equal(calls.length,4);
  await insights.enqueue(other.key,turn,{manual:true});await insights.review(other);
  assert(files.get('/data/paper-companion/highlights/1_OTHER.review.md').includes('Other'));
  assert.equal((await insights.readReview(paper)).stale,false);
});

test('failed review preserves both documents and snapshot marker, and an explicit retry can succeed',async()=>{
  const {api,insights,calls,files,paper}=setup();await insights.init();
  await insights.enqueue(paper.key,{id:'one',source:'deepseek',question:'q',answer:'a'},{manual:true});await insights.review(paper);
  await insights.enqueue(paper.key,{id:'two',source:'deepseek',question:'q2',answer:'a2'},{manual:true});
  const first=files.get('/data/paper-companion/highlights/1_PAPER.md'),review=files.get('/data/paper-companion/highlights/1_PAPER.review.md'),meta=files.get('/data/paper-companion/highlights/1_PAPER.review.json');
  const request=api.request;api.request=async()=>({choices:[{message:{content:'partial'},finish_reason:'length'}]});
  await assert.rejects(insights.review(paper),/完整结果/);
  assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.md'),first);
  assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.review.md'),review);assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.review.json'),meta);
  assert.equal(insights.reviewJobs.size,0);assert.equal((await insights.readReview(paper)).stale,true);
  api.request=request;await insights.review(paper);assert.equal((await insights.readReview(paper)).stale,false);assert.equal(calls.length,4);
});

test('review waits for an already requested summary and does not start a second summary itself',async()=>{
  const {api,insights,calls,files,paper}=setup();await insights.init();
  api.session=async()=>({messages:[{role:'user',text:'q',status:'complete'},{role:'assistant',text:'a',at:1,status:'complete',provider:'deepseek'}]});
  const request=api.request;let release,started;const running=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  api.request=async(u,o)=>{if(calls.length===0){started();await gate;}return request(u,o);};
  const first=insights.manualUpdate(paper);await running;const second=insights.review(paper);
  release();await Promise.all([first,second]);assert.equal(calls.length,2);
  assert.equal(calls[1].body.messages[1].content,files.get('/data/paper-companion/highlights/1_PAPER.md'));
  assert.equal(insights.enabled(paper.key),false);
});

test('review rejects oversized first documents without truncation or provider calls',async()=>{
  const {insights,calls,files,paper}=setup();await insights.init();
  files.set('/data/paper-companion/highlights/1_PAPER.json',JSON.stringify({entries:[{markdown:'x'.repeat(200001),at:'date',model:'m',source:'s'}]}));
  await assert.rejects(insights.review(paper),/20 万字符/);assert.equal(calls.length,0);assert(!files.has('/data/paper-companion/highlights/1_PAPER.review.md'));
});

test('shutdown cancels review and preserves the previous saved version',async()=>{
  const {api,insights,files,paper}=setup();await insights.init();
  await insights.enqueue(paper.key,{id:'one',source:'deepseek',question:'q',answer:'a'},{manual:true});
  let started;const running=new Promise(r=>started=r);
  api.request=async(_,{signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});started();});
  const pending=insights.review(paper);await running;insights.destroy();await assert.rejects(pending,/cancelled/);
  assert(!files.has('/data/paper-companion/highlights/1_PAPER.review.md'));assert(files.has('/data/paper-companion/highlights/1_PAPER.md'));
});

test('separate default and custom summary prompts reach DeepSeek system messages and ChatGPT instructions',async()=>{
  const {api,insights,calls,paper}=setup();await insights.init();
  assert(insights.prompt('summary').includes('学术阅读重点整理助手'));
  assert(insights.prompt('review').includes('合并重复观点'));
  const turn={id:'one',source:'deepseek',question:'q',answer:'a'};
  await insights.enqueue(paper.key,turn,{manual:true});
  assert.equal(calls[0].body.messages[0].content,insights.defaultPrompt('summary'));
  api.settings.summaryPrompt='用三句话回答：关注研究假设。';api.settings.reviewPrompt='按概念关系重新整理，不按时间排序。';
  await insights.enqueue(paper.key,{...turn,id:'two'},{manual:true});
  assert.equal(calls[1].body.messages[0].content,api.settings.summaryPrompt);
  api.settings.summaryProvider='chatgpt';api.settings.summaryChatGPTModel='chat-two';
  await insights.review(paper);
  assert.equal(calls[2].body.instructions,api.settings.reviewPrompt);assert.equal(calls[2].body.model,'chat-two');
  assert.notEqual(calls[2].body.instructions,api.settings.summaryPrompt);
});

test('saving a review prompt marks its document stale without a request; only clicking regenerates unchanged source',async()=>{
  const {api,insights,calls,files,paper}=setup();await insights.init();
  api.session=async()=>({messages:[{role:'user',text:'q',status:'complete'},{role:'assistant',text:'a',status:'complete',at:1,provider:'deepseek'}]});
  await insights.manualUpdate(paper);await insights.review(paper);
  const first=files.get('/data/paper-companion/highlights/1_PAPER.md'),second=files.get('/data/paper-companion/highlights/1_PAPER.review.md');
  await api.saveSettings(insights.validatePrompts({summaryPrompt:'提炼方法。'}));
  await insights.manualUpdate(paper);assert.equal(calls.length,2);assert.equal((await insights.readReview(paper)).stale,false);
  await api.saveSettings(insights.validatePrompts({reviewPrompt:'集中分析疑点与适用条件。'}));
  assert.equal((await insights.readReview(paper)).stale,true);assert.equal(calls.length,2);
  assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.review.md'),second);
  await insights.review(paper);assert.equal(calls.length,3);assert.equal(calls[2].body.messages[0].content,api.settings.reviewPrompt);
  assert.equal(files.get('/data/paper-companion/highlights/1_PAPER.md'),first);assert.equal((await insights.readReview(paper)).stale,false);
  const restarted=new insights.constructor(api);await restarted.init();await restarted.review(paper);assert.equal(calls.length,3);
});

test('prompt validation rejects empty, nontext and oversized settings, while normalizing valid text',()=>{
  const {insights}=setup();
  for(const name of ['summaryPrompt','reviewPrompt']) {
    for(const value of ['', '  \n ',null,42]) assert.throws(()=>insights.validatePrompts({[name]:value}),/不能为空/);
    assert.throws(()=>insights.validatePrompts({[name]:'x'.repeat(12001)}),/12000/);
    assert.equal(insights.validatePrompts({[name]:'  首行\n第二行  '})[name],'首行\n第二行');
  }
  assert.equal(Object.keys(insights.validatePrompts({language:'English'})).length,0);
});

test('changing review prompt during generation preserves its snapshot and leaves a pending update',async()=>{
  const {api,insights,calls,paper}=setup();await insights.init();
  await insights.enqueue(paper.key,{id:'one',source:'deepseek',question:'q',answer:'a'},{manual:true});
  api.settings.reviewPrompt='旧版省察要求';const request=api.request;let release,started;
  const running=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  api.request=async(u,o)=>{started();await gate;return request(u,o);};
  const pending=insights.review(paper);await running;api.settings.reviewPrompt='新版省察要求';release();await pending;
  assert.equal(calls[1].body.messages[0].content,'旧版省察要求');assert.equal((await insights.readReview(paper)).stale,true);
  api.request=request;await insights.review(paper);assert.equal(calls[2].body.messages[0].content,'新版省察要求');assert.equal((await insights.readReview(paper)).stale,false);
});

test('legacy review metadata stays readable and upgrades its prompt fingerprint only on explicit update',async()=>{
  const {insights,calls,files,paper}=setup();await insights.init();
  await insights.enqueue(paper.key,{id:'one',source:'deepseek',question:'q',answer:'a'},{manual:true});
  const source=await insights.reviewSource(paper),legacy='Existing legacy review';
  files.set('/data/paper-companion/highlights/1_PAPER.review.json',JSON.stringify({text:legacy,sourceHash:source.hash}));
  files.set('/data/paper-companion/highlights/1_PAPER.review.md',legacy);
  const value=await insights.readReview(paper);assert.equal(value.text,legacy);assert.equal(value.stale,true);assert.equal(calls.length,1);
  await insights.review(paper);assert.equal(calls.length,2);
  assert(JSON.parse(files.get('/data/paper-companion/highlights/1_PAPER.review.json')).promptHash);
  await insights.review(paper);assert.equal(calls.length,2);
});
