const {test}=require('node:test');
const assert=require('node:assert/strict');
const Gateway=require('../addon/content/model-gateway.js');

function setup(){
  const calls=[],auth=[],state={state:'online',active:'account-A',epoch:1,closing:false,models:[
    {id:'gpt-5',reasoningEfforts:['default','high'],inputModalities:['text','image']},{id:'chat-one'}]};
  const io={key:async()=> 'fake-key',access:async account=>{auth.push(account);return 'fake-token';},request:async(url,options,meta)=>{
    const body=JSON.parse(options.body);calls.push({url,options,meta,body});
    if(!options.onChunk)return {model:'actual-deepseek',choices:[{finish_reason:'stop',message:{content:'complete result'}}]};
    if(url.includes('deepseek')){
      options.onChunk('data: {"model":"actual-deepseek","choices":[{"delta":{"content":"complete result"},"finish_reason":null}]}\n\n');
      options.onChunk('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    }else{
      options.onChunk('data: {"type":"response.output_text.delta","delta":"complete result"}\n\n');
      options.onChunk('data: {"type":"response.completed","response":{"status":"completed","model":"actual-chatgpt"}}\n\n');
    }
  }};
  const gateway=new Gateway({connection:()=>state,readDeepseekKey:()=>io.key(),accessToken:(account,signal)=>io.access(account,signal),request:(...args)=>io.request(...args)});
  return {gateway,state,io,calls,auth};
}
const selected={provider:'chatgpt',model:'gpt-5',effort:'high'};
const standalone={instructions:'instruction',text:'source',usageFeature:'translation',usageKey:'1_PAPER'};
const chat={prompt:'question',history:[],materials:{}};
const gate=()=>{let release;return {promise:new Promise(resolve=>release=resolve),release:(...args)=>release(...args)};};

test('construction and snapshot are local, freeze selection metadata and preserve snapshot identity',()=>{
  const s=setup(),snapshot=s.gateway.snapshot(selected);
  s.state.models[0].inputModalities.length=0;s.state.models[0].reasoningEfforts.length=0;
  assert(Object.isFrozen(snapshot));assert(Object.isFrozen(snapshot.modelInfo));assert(Object.isFrozen(snapshot.modelInfo.inputModalities));
  assert.deepEqual(snapshot.modelInfo.inputModalities,['text','image']);assert.deepEqual(snapshot.modelInfo.reasoningEfforts,['default','high']);
  assert.equal(s.gateway.snapshot(snapshot),snapshot);assert.equal(s.auth.length,0);assert.equal(s.calls.length,0);
});
test('availability checks do not renew ChatGPT authorization or send inference',async()=>{
  const s=setup();assert.equal(await s.gateway.available(selected),true);
  assert.equal(await s.gateway.available({provider:'deepseek',model:'deepseek-flash'}),true);
  assert.equal(s.auth.length,0);assert.equal(s.calls.length,0);
});
test('missing credentials or offline selections reject without switching providers',async()=>{
  const s=setup();s.io.key=async()=>'';
  await assert.rejects(s.gateway.generate({...standalone,provider:'deepseek',model:'deepseek-flash',effort:'none'}),/API Key/);
  s.state.state='offline';await assert.rejects(s.gateway.generate({...standalone,...selected}),/手动连接/);
  assert.equal(s.auth.length,0);assert.equal(s.calls.length,0);
});
test('a frozen selection rejects a later account before authentication rather than reselecting it',async()=>{
  const s=setup(),snapshot=s.gateway.snapshot(selected);s.state.active='account-B';
  await assert.rejects(s.gateway.open(snapshot),/账号已改变/);assert.equal(s.auth.length,0);assert.equal(s.calls.length,0);
});
test('an account change during token renewal cannot start the pending request',async()=>{
  const s=setup(),wait=gate();s.io.access=async account=>{s.auth.push(account);await wait.promise;return 'fake-token';};
  const pending=s.gateway.open(s.gateway.snapshot(selected));s.state.active='account-B';wait.release();
  await assert.rejects(pending,/账号已改变/);assert.deepEqual(s.auth,['account-A']);assert.equal(s.calls.length,0);
});
test('disconnect or shutdown after open prevents a prepared request from starting',async()=>{
  for(const change of [s=>s.epoch++,s=>s.closing=true,s=>s.state='offline']){
    const s=setup(),channel=await s.gateway.open(selected),prepared=channel.prepare(chat);change(s.state);
    await assert.rejects(prepared.run(),/改变|关闭|手动连接/);assert.equal(s.calls.length,0);
  }
});
test('aborting while a credential read is pending prevents inference',async()=>{
  const s=setup(),wait=gate(),controller=new AbortController();s.io.key=()=>wait.promise;
  const pending=s.gateway.generate({...standalone,provider:'deepseek',model:'deepseek-flash',effort:'none',signal:controller.signal});
  controller.abort();wait.release('fake-key');await assert.rejects(pending,/取消/);assert.equal(s.calls.length,0);
});
test('DeepSeek prepare validates incompatible PDFs before a model call and retains a historical material notice',async()=>{
  const s=setup(),channel=await s.gateway.open({provider:'deepseek',model:'deepseek-flash'});
  assert.throws(()=>channel.prepare({...chat,context:{id:'pdf',file:'data:application/pdf;base64,YQ==',title:'P',label:'PDF'}}),/完整 PDF/);
  assert.equal(s.calls.length,0);
  const handle=channel.prepare({...chat,history:[{role:'user',text:'previous',status:'complete',materialID:'pdf'}],materials:{pdf:{id:'pdf',file:'data:application/pdf;base64,YQ==',title:'P',label:'PDF'}}});
  assert.match(handle.notice,/PDF|未重传|兼容/);
});
test('prepared requests capture the body once and coalesce repeated run calls',async()=>{
  const s=setup(),channel=await s.gateway.open(selected),options={...chat,history:[],prompt:'original'};
  const handle=channel.prepare(options);options.prompt='changed';options.history.push({role:'user',text:'later',status:'complete'});
  const one=handle.run(),two=handle.run();assert.equal(one,two);assert.equal(await one,'complete result');
  assert.equal(s.calls.length,1);assert(s.calls[0].options.body.includes('original'));assert(!s.calls[0].options.body.includes('changed'));assert(!s.calls[0].options.body.includes('later'));
});
test('ChatGPT chat and generation preserve Responses restrictions and report only service-returned models',async()=>{
  const s=setup(),models=[],deltas=[],channel=await s.gateway.open(selected);
  assert.equal(await channel.chat(chat,{onModel:m=>models.push(m),onDelta:t=>deltas.push(t),usageFeature:'chat',usageKey:'1_PAPER'}),'complete result');
  assert.deepEqual(models,['actual-chatgpt']);assert.equal(deltas.at(-1),'complete result');
  const first=s.calls[0];assert.equal(first.url,'https://api.openai.com/v1/responses');assert.equal(first.body.store,false);assert.equal(first.body.stream,true);assert.equal(first.body.reasoning.effort,'high');
  assert.deepEqual(first.meta,{provider:'chatgpt',feature:'chat',paperKey:'1_PAPER'});
  assert.equal(first.body.max_output_tokens,undefined);assert(!('token' in channel));
  await s.gateway.generate({...standalone,provider:'chatgpt',model:'chat-one',effort:'high'});
  assert.equal(s.calls[1].body.reasoning.effort,'high');assert.equal(s.calls[1].body.instructions,'instruction');
});
test('unavailable chat reasoning and screenshot capabilities fail during prepare without inference',async()=>{
  const s=setup();s.state.models[0].reasoningEfforts=['default'];
  const channel=await s.gateway.open(selected);assert.throws(()=>channel.prepare(chat),/不支持已选推理强度/);
  const textOnly=await s.gateway.open({provider:'chatgpt',model:'chat-one',effort:'default'});
  assert.throws(()=>textOnly.prepare({...chat,context:{mode:'screenshot',image:'data:image/png;base64,YQ=='}}),/图片能力/);assert.equal(s.calls.length,0);
});
test('DeepSeek chat is streaming, generation keeps configured thinking and all calls use the metered port',async()=>{
  const s=setup(),channel=await s.gateway.open({provider:'deepseek',model:'deepseek-flash'}),models=[];
  await channel.chat(chat,{onModel:m=>models.push(m),usageFeature:'chat'});
  await s.gateway.generate({...standalone,provider:'deepseek',model:'deepseek-v4-pro',effort:'max',maxTokens:1000});
  assert.equal(s.calls[0].body.stream,true);assert.equal(s.calls[0].body.stream_options.include_usage,true);assert.equal(s.calls[0].body.thinking.type,'disabled');
  assert.equal(s.calls[1].body.stream,false);assert.equal(s.calls[1].body.max_tokens,32768);assert.equal(s.calls[1].body.reasoning_effort,'max');
  assert.deepEqual(s.calls[1].meta,{provider:'deepseek',feature:'translation',paperKey:'1_PAPER'});assert.deepEqual(models,['actual-deepseek']);
});
test('image requests use only the chosen provider and unsupported DeepSeek images fail before authentication',async()=>{
  const s=setup(),images=['data:image/png;base64,YQ=='];let reads=0;s.io.key=async()=>{reads++;return 'fake';};
  await assert.rejects(s.gateway.generate({...standalone,provider:'deepseek',model:'deepseek-v4-pro',effort:'none',images}),/不会自动切换/);assert.equal(reads,0);
  await s.gateway.generate({...standalone,provider:'deepseek',model:'deepseek-flash',effort:'none',images});
  assert.equal(s.calls[0].body.messages[1].content[1].image_url.url,images[0]);
  await s.gateway.generate({...standalone,...selected,images});assert(s.calls[1].body.input.some(m=>m.content.some(c=>c.type==='input_image')));
});
test('truncated or failed model output rejects instead of being treated as complete',async()=>{
  const s=setup();s.io.request=async()=>({choices:[{finish_reason:'length',message:{content:'partial'}}]});
  await assert.rejects(s.gateway.generate({...standalone,provider:'deepseek',model:'deepseek-flash',effort:'none'}),/完整结果/);
  s.io.request=async(url,opts)=>opts.onChunk('data: {"type":"response.output_text.delta","delta":"partial"}\n\n');
  await assert.rejects(s.gateway.generate({...standalone,...selected}),/提前中断/);
});
test('no response model is invented when the service omits it',async()=>{
  const s=setup(),models=[];s.io.request=async(url,opts)=>opts.onChunk('data: {"type":"response.completed","response":{"status":"completed","output":[{"content":[{"type":"output_text","text":"done"}]}]}}\n\n');
  await s.gateway.generate({...standalone,...selected,onModel:value=>models.push(value)});assert.deepEqual(models,[]);
});
test('standalone inputs and image arrays cannot change during asynchronous authorization',async()=>{
  const s=setup(),wait=gate();s.io.access=()=>wait.promise;
  const options={...standalone,...selected,images:['data:image/png;base64,YQ==']},pending=s.gateway.generate(options);
  options.text='changed source';options.instructions='changed instruction';options.images[0]='data:image/png;base64,Yg==';wait.release('fake-token');
  await pending;const body=s.calls[0].options.body;
  assert(body.includes('source'));assert(body.includes('data:image/png;base64,YQ=='));assert(!body.includes('changed'));assert(!body.includes('base64,Yg=='));
});
test('an explicit old snapshot cannot silently override a different provider or model choice',async()=>{
  const s=setup(),selection=s.gateway.snapshot(selected);
  await assert.rejects(s.gateway.generate({...standalone,provider:'deepseek',model:'deepseek-flash',effort:'none',selection}),/快照/);assert.equal(s.auth.length,0);assert.equal(s.calls.length,0);
});
test('final metadata without an SSE terminator reaches the existing collector observer exactly once',async()=>{
  for(const provider of ['chatgpt','deepseek']){
    const s=setup(),models=[];
    s.io.request=async(url,options)=>options.onChunk(provider==='chatgpt'
      ? 'data: {"type":"response.completed","response":{"status":"completed","model":"terminal-model","output":[{"content":[{"type":"output_text","text":"done"}]}]}}'
      : 'data: {"model":"terminal-model","choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}');
    const channel=await s.gateway.open(provider==='chatgpt'?selected:{provider:'deepseek',model:'deepseek-flash'});
    assert.equal(await channel.chat(chat,{onModel:value=>models.push(value)}),'done');assert.deepEqual(models,['terminal-model']);
  }
});
