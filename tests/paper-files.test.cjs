const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path').posix;
function setup() {
  const files = new Map([['/papers/source.pdf', '%PDF fake source']]), dirs = new Set(['/papers','/profile','/legacy/notes','/legacy/highlights','/custom']);
  const paper = {key:'1_PAPER',id:1,title:'Article A',link:'zotero://open-pdf/library/items/PAPER'};
  const io = {
    exists:async p=>files.has(p)||dirs.has(p),
    makeDirectory:async(p,o={})=>{if(dirs.has(p)&&o.ignoreExisting===false)throw new Error('exists');dirs.add(p);},
    copy:async(a,b)=>{if(!files.has(a))throw new Error('missing source');if(files.has(b))throw new Error('overwrite forbidden');if(!dirs.has(path.dirname(b)))throw new Error('missing parent');files.set(b,files.get(a));},
    getChildren:async p=>[...files.keys(),...dirs].filter(f=>path.dirname(f)===p)
  };
  const api={dir:'/profile',notesDir:'/legacy/notes',insights:{dir:'/legacy/highlights',document:p=>'# '+p.title+' · 聊天重点\n'},
    pdfSource:async()=>'/papers/source.pdf',
    readJSON:async(p,f)=>files.has(p)?JSON.parse(files.get(p)):f,
    writeJSON:async(p,v)=>files.set(p,JSON.stringify(v)),writeText:async(p,v)=>files.set(p,v)};
  const context={PathUtils:{join:path.join,parent:path.dirname,filename:path.basename},IOUtils:io,Zotero:{isWin:false}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../addon/content/paper-files.js'),'utf8'),context);
  const storage=new context.PCPaperFiles(api);return {files,dirs,io,api,paper,storage};
}

test('default paper folder colocates PDF and all Markdown, preserves original and remains stable across restart',async()=>{
  const {files,api,paper,storage}=setup();await storage.init();
  const [a,b]=await Promise.all([storage.ensure(paper),storage.ensure(paper)]);
  assert.equal(a.dir,'/papers/Article A');assert.equal(a.dir,b.dir);
  assert.equal(files.get(a.note),'# Article A\n\n');
  for(const kind of ['pdf','note','summary','review'])assert(files.has(a[kind]));
  assert.equal(files.get(a.pdf),files.get('/papers/source.pdf'));assert.equal(path.dirname(a.note),path.dirname(a.pdf));
  const resumed=new storage.constructor(api);await resumed.init();assert.equal((await resumed.ensure({...paper,title:'Changed metadata title'})).dir,a.dir);
});

test('moving the paper folder also preserves extracted source text and its reading index',async()=>{
 const {files,paper,storage}=setup();await storage.init();const before=await storage.ensure(paper);
 files.set(before.sourceText,'# Original PDF text\n');files.set(before.readingData,'{"version":1,"chunks":[]}');
 const after=await storage.relocate(paper,'/custom');
 for(const kind of ['sourceText','readingData']){assert.equal(files.get(after[kind]),files.get(before[kind]));assert(files.has(before[kind]));}
});

test('legacy notes, summaries, reviews, metadata and matching backups migrate byte for byte without deletion',async()=>{
  const {files,dirs,paper,storage}=setup();
  const originals={
    '/legacy/notes/1_PAPER.md':'', '/legacy/highlights/1_PAPER.md':'# exact summary\r\n',
    '/legacy/highlights/1_PAPER.json':'{"entries":[{"id":"dedupe","markdown":"point"}]}',
    '/legacy/highlights/1_PAPER.review.md':'# existing review', '/legacy/highlights/1_PAPER.review.json':'{"text":"# existing review","sourceHash":"original","promptHash":"kept"}',
    '/legacy/notes/backups/1_PAPER-123.md':'backup', '/legacy/notes/backups/1_OTHER-123.md':'other backup'};
  for(const [p,v]of Object.entries(originals))files.set(p,v);dirs.add('/legacy/notes/backups');await storage.init();const p=await storage.ensure(paper);
  assert.equal(files.get(p.note),'');assert.equal(files.get(p.summary),'# exact summary\r\n');
  assert(files.get(p.summaryData).includes('dedupe'));assert(files.get(p.reviewData).includes('promptHash'));
  assert.equal(files.get(path.join(p.backups,'1_PAPER-123.md')),'backup');assert(!files.has(path.join(p.backups,'1_OTHER-123.md')));
  for(const [name,value]of Object.entries(originals))assert.equal(files.get(name),value);
});

test('custom relocation copies current documents and backups, preserves old folders, and persists future location',async()=>{
  const {files,api,paper,storage}=setup();await storage.init();const a=await storage.ensure(paper);
  files.set(a.note,'written note');files.set(a.summary,'current summary');files.set(a.review,'current review');files.set(a.summaryData,'{"entries":[]}');files.set(a.reviewData,'{"text":"current review"}');
  files.set(path.join(a.backups,'manual.md'),'backup');const b=await storage.relocate(paper,'/custom');
  assert.equal(b.dir,'/custom/Article A');for(const kind of ['pdf','note','summary','review','summaryData','reviewData'])assert.equal(files.get(b[kind]),files.get(a[kind]));
  assert.equal(files.get(path.join(b.backups,'manual.md')),'backup');
  files.set((await storage.ensure(paper)).note,'new note');assert.equal(files.get(a.note),'written note');
  const resumed=new storage.constructor(api);await resumed.init();assert.equal((await resumed.ensure(paper)).dir,b.dir);
  assert.equal((await storage.relocate(paper,'/custom')).dir,b.dir);
});

test('existing same-title folders and different papers are never merged or overwritten',async()=>{
  const {files,dirs,paper,storage}=setup();dirs.add('/papers/Article A');files.set('/papers/Article A/阅读笔记.md','unrelated');await storage.init();
  const a=await storage.ensure(paper),b=await storage.ensure({...paper,key:'1_OTHER'});
  assert.notEqual(a.dir,'/papers/Article A');assert.notEqual(a.dir,b.dir);assert.equal(files.get('/papers/Article A/阅读笔记.md'),'unrelated');
});

test('new papers start with only their own title while saved and deliberately empty notes remain intact',async()=>{
  const {files,paper,storage}=setup();await storage.init();const a=await storage.ensure(paper);
  files.set(a.note,'# My own heading\n\nHandwritten $x_1$ notes.');
  const other={...paper,key:'1_OTHER',title:'Article B'},b=await storage.ensure(other);
  assert.equal(files.get(b.note),'# Article B\n\n');
  assert.equal(files.get((await storage.ensure(paper)).note),'# My own heading\n\nHandwritten $x_1$ notes.');
  files.set(b.note,'');assert.equal(files.get((await storage.ensure(other)).note),'');
});

test('failed relocation leaves old location authoritative and an explicit retry preserves all data',async()=>{
  const {files,io,paper,storage}=setup();await storage.init();const a=await storage.ensure(paper);files.set(a.note,'latest');
  const copy=io.copy;io.copy=async(s,d)=>{if(d.endsWith('阅读笔记.md'))throw new Error('permission denied');return copy(s,d);};
  await assert.rejects(storage.relocate(paper,'/custom'),/permission denied/);assert.equal((await storage.ensure(paper)).dir,a.dir);assert.equal(files.get(a.note),'latest');
  io.copy=copy;const b=await storage.relocate(paper,'/custom');assert.equal(files.get(b.note),'latest');assert.notEqual(b.dir,'/custom/Article A');
});

test('parallel first-paper creation preserves every location entry; missing saved folders fail explicitly',async()=>{
  const {files,api,paper,storage,dirs}=setup();await storage.init();
  const [a,b]=await Promise.all([storage.ensure(paper),storage.ensure({...paper,key:'1_OTHER',title:'Other'})]);
  const saved=JSON.parse(files.get('/profile/paper-folders.json'));assert.equal(saved['1_PAPER'].dir,a.dir);assert.equal(saved['1_OTHER'].dir,b.dir);
  dirs.delete(a.dir);const resumed=new storage.constructor(api);await resumed.init();await assert.rejects(resumed.ensure(paper),/不存在/);
});

test('folder names sanitize Windows forbidden characters, reserved device names and trailing dots',()=>{
  const {storage}=setup(),name=storage.constructor.folderName;
  assert.equal(name('Article: A/B?'),'Article_ A_B_');assert.equal(name('CON'),'_CON');assert.equal(name('name.  '),'name');assert(name('x'.repeat(200)).length<=100);
});
