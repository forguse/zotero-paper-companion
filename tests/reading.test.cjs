const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {PCReadingIndex: Index} = require('../addon/content/reading.js'), core = require('../addon/content/core.js');
const paper = {id:1,key:'1_A',title:'Control',link:'zotero://open-pdf/library/items/A'};
test('local retrieval ranks the actual page, expands academic Chinese terms, and returns no invented match', () => {
  const index = Index.build(paper,[{page:1,text:'Introduction: vision classification and neural representations.'},{page:2,text:'Experimental results: the controller reduced liquid spill risk with robust control.'},{page:3,text:'Limitations: small dataset and limited hardware.'}]);
  assert.equal(index.search('liquid spill risk')[0].page,2);
  assert.equal(index.search('溢出风险 控制')[0].page,2);
  assert.equal(index.search('局限')[0].page,3);
  assert.deepEqual(index.search('zzzznomatch'),[]);
});
test('page chunks preserve physical page attribution and use overlap without unbounded length', () => {
  const text = 'Repeated sample text and structure.\n'.repeat(150), index = Index.build(paper,[{page:7,text}]);
  assert(index.data.chunks.length>1); assert(index.data.chunks.every(c=>c.page===7&&c.text.length<=1600));
  for (let i=1;i<index.data.chunks.length;i++) assert(index.data.chunks[i-1].text.includes(index.data.chunks[i].text.slice(0,120)));
  assert.equal(index.search('sample',8).length,2);
});
test('citations link only supplied source IDs and preserve code examples', () => {
  const references=[{page:3,link:paper.link+'?page=3'}];
  const text=Index.cite('Answer [S1] and [S99]. `example [S1]`',references);
  assert(text.includes('[来源 1 · 第 3 页]('+paper.link+'?page=3)')); assert(text.includes('未核实来源 S99')); assert(text.includes('`example [S1]`'));
  for (const literal of ['$$x=[S1]$$','$x=[S1]$','\\[x=[S1]\\]','~~~text\n[S1]\n~~~']) assert.equal(Index.cite(literal,references),literal);
});
function setup(options = {}) {
  const files=new Map(), counts={reads:0,requests:0,writes:0,cacheReads:0}, source={modified:1}, events=[], state={beforePage:async()=>{},beforeCacheRead:async()=>{}};
  const api={models:[],queue:async fn=>fn(),paperInfo:async id=>({...paper,id,key:'1_'+id,title:'Paper '+id}),pdfSource:async p=>source.path||'/pdf/'+p.id,
    allReaders:()=>[{itemID:1},{itemID:2},{itemID:3}],emit:(type,data)=>events.push({type,...data}),files:{changing:new Set(),ensure:async p=>({dir:source.dir||'/papers/'+p.id,meta:(source.dir||'/papers/'+p.id)+'/.paper-companion'})},
    readJSON:async(p,f)=>{counts.cacheReads++;await state.beforeCacheRead(p);return files.has(p)?JSON.parse(files.get(p)):f;},writeJSON:async(p,v)=>{counts.writes++;files.set(p,JSON.stringify(v));},writeText:async(p,v)=>{counts.writes++;files.set(p,v);},
    pdf:reader=>({page:1,doc:{numPages:2,fingerprints:[source.fingerprint||'pdf-'+reader.itemID],getPage:async n=>{counts.reads++;await state.beforePage(reader.itemID,n,counts.reads);return{getTextContent:async()=>({items:[{str:`Paper ${reader.itemID}, physical page ${n}: `+(n===1?'Introduction and research motivation.':'Experimental control reduced spill risk and improved stability.'),hasEOL:true}]})};}}})};
  const context={PCore:core,AbortController,IOUtils:{stat:async()=>({size:100,lastModified:source.modified})},Cu:{waiveXrays:v=>v},PathUtils:{join:(...p)=>p.join('/')}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../addon/content/reading.js'),'utf8'),context);
  return{reading:new context.PCReading(api,options),api,files,counts,source,events,state};
}
function deferred() { let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve}; }
const turn = () => new Promise(setImmediate);
test('reading is lazy, persists alongside paper files, reuses disk cache and invalidates changed PDFs',async()=>{
  const {reading,files,counts,source}=setup();assert.equal(counts.reads,0);
  await reading.load(1); assert.equal(counts.reads,2); assert(files.get('/papers/1/论文原文.md').includes('PDF 第 2 页'));
  reading.memory.clear();await reading.load(1);assert.equal(counts.reads,2);
  source.modified=2;await reading.load(1);assert.equal(counts.reads,4);
  const before=files.get('/papers/1/.paper-companion/reading-index.json'),controller=new AbortController();controller.abort();
  await assert.rejects(reading.load(1,controller.signal,true),/停止/);assert.equal(files.get('/papers/1/.paper-companion/reading-index.json'),before);
});
test('inspecting reading state never extracts pages and detects stale saved text after restart',async()=>{
  const {reading,counts,source}=setup(),current={...paper,key:'1_1'};
  assert.equal((await reading.inspect(current)).state,'unprepared');assert.equal(counts.reads,0);
  await reading.load(1);reading.memory.clear();const before=counts.reads;
  assert.equal((await reading.inspect(current)).state,'extracted');assert.equal(counts.reads,before);
  source.modified++;assert.equal((await reading.inspect(current)).state,'stale');assert.equal(counts.reads,before);
});
test('multi-paper context keeps provenance separate and sends bounded query evidence rather than stale full materials',async()=>{
  const {reading}=setup(), evidence=await reading.prepare(1,'spill risk',{ids:[2],first:true});
  assert.equal(new Set(evidence.references.map(r=>r.key)).size,2);assert(evidence.references.every(r=>r.link.endsWith('?page='+r.page)));
  const body=core.responsesBody({model:'selected',history:[{role:'user',text:'Prior question',status:'complete'}],evidence,prompt:'Compare'});
  assert(body.input.some(m=>Array.isArray(m.content)&&m.content[0].text.includes('[S1]')));
  await assert.rejects(reading.prepare(1,'q',{ids:[2,3,4,5,6]}),/最多/);
  await assert.rejects(reading.prepare(1,'q',{ids:[999]}),/保持/);
});

test('reading coverage distinguishes extracted full text, lexical hits and overview fallback without matches',async()=>{
 const {reading}=setup();const full=await reading.prepare(1,'spill',{first:true});assert.equal(full.coverage[0].kind,'full-text');assert(full.label.includes('全文文字'));
 const hit=await reading.prepare(1,'spill');assert.equal(hit.coverage[0].kind,'lexical');assert.equal(hit.coverage[0].zeroMatches,false);
 const fallback=await reading.prepare(1,'zzzznomatch');assert.equal(fallback.coverage[0].kind,'overview');assert.equal(fallback.coverage[0].zeroMatches,true);assert(fallback.label.includes('无词汇命中'));assert.equal(fallback.coverage[0].snippets,fallback.references.length);
});

test('parallel readers share extraction and receive the same derived index',async()=>{
  const s=setup(); const [first,second]=await Promise.all([s.reading.load(1),s.reading.load(1)]);
  assert.equal(first,second);assert.equal(s.counts.reads,2);assert.equal(s.counts.cacheReads,1);assert.equal(s.counts.writes,2);
  assert.equal(s.events.filter(e=>e.type==='readingReady').length,1);assert.equal(s.reading.inflight.size,0);assert.equal(s.reading.operations.size,0);
});
test('one consumer cancellation never cancels another consumer of the same extraction',async()=>{
  const s=setup(),entered=deferred(),gate=deferred(),one=new AbortController(),two=new AbortController();
  s.state.beforePage=async(_id,_page,read)=>{if(read===1){entered.resolve();await gate.promise;}};
  const first=s.reading.load(1,one.signal),second=s.reading.load(1,two.signal);await entered.promise;
  one.abort();await assert.rejects(first,/停止/);assert.equal(two.signal.aborted,false);
  gate.resolve();const index=await second;assert.equal(index.data.pages.length,2);assert.equal(s.counts.reads,2);assert.equal(s.counts.writes,2);
});
test('all consumers cancelling releases the identity for retry while shutdown still drains the abandoned PDF call',async()=>{
  const s=setup(),entered=deferred(),gate=deferred(),one=new AbortController(),two=new AbortController();
  s.state.beforePage=async(_id,_page,read)=>{if(read===1){entered.resolve();await gate.promise;}};
  const first=s.reading.load(1,one.signal),second=s.reading.load(1,two.signal);await entered.promise;
  one.abort();two.abort();await Promise.all([assert.rejects(first,/停止/),assert.rejects(second,/停止/)]);
  assert.equal(s.reading.inflight.size,0);assert.equal(s.reading.operations.size,1);
  const retry=await s.reading.load(1);assert.equal(retry.data.pages.length,2);assert.equal(s.counts.reads,3);assert.equal(s.counts.writes,2);
  let closed=false;const closing=s.reading.destroy().then(()=>{closed=true;});await turn();assert.equal(closed,false);
  gate.resolve();await closing;assert.equal(s.counts.writes,2);assert.equal(s.reading.operations.size,0);assert.equal(s.reading.latest.size,0);assert.equal(s.reading.memory.size,0);
  await assert.rejects(s.reading.load(1),/关闭/);
});
test('a shared extraction failure is reported to every consumer and does not poison retries',async()=>{
  const s=setup();s.state.beforePage=async()=>{throw Error('PDF extraction unavailable');};
  const results=await Promise.allSettled([s.reading.load(1),s.reading.load(1)]);
  assert(results.every(r=>r.status==='rejected'&&/extraction unavailable/.test(r.reason.message)));
  assert.equal(s.reading.inflight.size,0);assert.equal(s.counts.writes,0);
  s.state.beforePage=async()=>{};await s.reading.load(1);assert.equal(s.counts.reads,3);
});
test('an explicit rebuild upgrades a pending disk-cache read rather than accepting the old cache or duplicating extraction',async()=>{
  const s=setup();await s.reading.load(1);s.reading.memory.clear();const entered=deferred(),gate=deferred();
  s.state.beforeCacheRead=async()=>{entered.resolve();await gate.promise;};
  const first=s.reading.load(1);await entered.promise;const forced=s.reading.load(1,undefined,true);await turn();
  assert.equal([...s.reading.inflight.values()][0].rebuild,true);gate.resolve();
  const [normal,rebuilt]=await Promise.all([first,forced]);assert.equal(normal,rebuilt);assert.equal(s.counts.reads,4);assert.equal(s.counts.writes,4);
});
test('a source edit, attachment move, folder move or active folder migration cannot commit stale extracted files',async()=>{
  for(const change of [s=>s.source.modified++,s=>{s.source.fingerprint='reloaded-pdf';},s=>{s.source.path='/moved/paper.pdf';},s=>{s.source.dir='/moved/paper';},s=>s.api.files.changing.add('1_1')]){
    const s=setup(),entered=deferred(),gate=deferred();s.files.set('/papers/1/阅读笔记.md','my unchanged note');
    s.state.beforePage=async(_id,_page,read)=>{if(read===1){entered.resolve();await gate.promise;}};
    const pending=s.reading.load(1);await entered.promise;change(s);gate.resolve();await assert.rejects(pending,/变更/);
    assert.equal(s.counts.writes,0);assert.equal(s.files.get('/papers/1/阅读笔记.md'),'my unchanged note');assert.equal(s.reading.memory.size,0);assert.equal(s.reading.inflight.size,0);
  }
});
test('a newer PDF identity supersedes an old in-flight extraction without mixing results or overwriting the current cache',async()=>{
  const s=setup(),entered=deferred(),gate=deferred();s.state.beforePage=async(_id,_page,read)=>{if(read===1){entered.resolve();await gate.promise;}};
  const old=s.reading.load(1);await entered.promise;s.source.modified=2;s.source.fingerprint='new-pdf';
  const current=await s.reading.load(1);const saved=s.files.get('/papers/1/.paper-companion/reading-index.json');
  gate.resolve();await assert.rejects(old,/变更/);assert.equal(s.files.get('/papers/1/.paper-companion/reading-index.json'),saved);
  assert.equal(s.reading.memory.get('1_1'),current);assert(current.data.fingerprint.includes('new-pdf'));assert.equal(s.counts.writes,2);
});
test('the bounded read-only cache evicts least recently used derived indices without deleting files or touching notes',async()=>{
  const s=setup({maxEntries:2});s.files.set('/papers/2/阅读笔记.md','keep this personal note');
  await s.reading.load(1);await s.reading.load(2);await s.reading.load(1);await s.reading.load(3);
  assert.deepEqual([...s.reading.memory.keys()],['1_1','1_3']);assert(s.reading.memoryBytes<=s.reading.maxBytes);
  const before=s.counts.reads;await s.reading.load(2);assert.equal(s.counts.reads,before);assert(s.files.has('/papers/2/.paper-companion/reading-index.json'));assert.equal(s.files.get('/papers/2/阅读笔记.md'),'keep this personal note');
});
test('an index larger than the cache budget is usable without being retained and can be reopened from its disk cache',async()=>{
  const s=setup({maxEntries:6,maxBytes:1}),index=await s.reading.load(1);
  assert.equal(index.data.pages.length,2);assert.equal(s.reading.memory.size,0);assert.equal(s.reading.memoryBytes,0);
  await s.reading.load(1);assert.equal(s.counts.reads,2);assert.equal(s.reading.memory.size,0);
});
test('shutdown cancels an active shared extraction, waits for its PDF call and does not write a cancelled result',async()=>{
  const s=setup(),entered=deferred(),gate=deferred();s.state.beforePage=async(_id,_page,read)=>{if(read===1){entered.resolve();await gate.promise;}};
  const pending=s.reading.load(1);await entered.promise;let closed=false;const close=s.reading.destroy().then(()=>{closed=true;});
  await turn();assert.equal(closed,false);gate.resolve();await assert.rejects(pending,/停止/);await close;
  assert.equal(s.counts.writes,0);assert.equal(s.reading.inflight.size,0);assert.equal(s.reading.operations.size,0);assert.equal(s.reading.latest.size,0);
});
