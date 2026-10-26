const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const PCore=require('../addon/content/core.js');
function setup(initial) {
  const files=initial||new Map(),calls=[],events=[],opened=[];let serial=0,failWrite=false,pdfReads=0;
  const doc={getPage:async()=>({getTextContent:async()=>{pdfReads++;return {items:[{str:'The controller reduced spill risk.',transform:[12,0,0,12,10,50],height:12,width:160}]};}})};
  const api={settings:{translationProvider:'deepseek',deepseekModel:'deepseek-flash',translationEffort:'none',language:'简体中文',vocabularyReminderEnabled:true,vocabularyReminderMinutes:60},
    readJSON:async(p,f)=>files.has(p)?JSON.parse(files.get(p)):f,
    writeText:async(p,t)=>{if(failWrite)throw Error('disk full');files.set(p,t);},
    writeJSON:async(p,v)=>{if(failWrite)throw Error('disk full');files.set(p,JSON.stringify(v));},
    emit:t=>events.push(t),launchLocalDocument:p=>opened.push(p),
    saveSettings:async s=>Object.assign(api.settings,s),
    paperInfo:async id=>({id,key:'1_'+id,title:'Paper '+id,link:'zotero://open-pdf/library/items/ITEM'+id}),
    allReaders:()=>[{itemID:1},{itemID:2}],pdf:()=>({doc}),
    gateway:{snapshot:config=>Object.freeze({...config}),generate:async opts=>{calls.push(opts);return JSON.stringify({defaultMeaning:'控制器；管理者',meaning:'控制器',sentenceTranslation:'控制器降低了溢出风险。'});}}};
  const context={PCore,AbortController,Zotero:{DataDirectory:{dir:'/data'}},PathUtils:{join:(...s)=>s.join('/')},Services:{uuid:{generateUUID:()=>'{id-'+(++serial)+'}'}},IOUtils:{exists:async p=>files.has(p),readUTF8:async p=>files.get(p),makeDirectory:async()=>{}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../addon/content/vocabulary.js'),'utf8'),context);
  return {book:new context.PCVocabulary(api),Class:context.PCVocabulary,api,files,calls,events,opened,setFail:v=>failWrite=v,get pdfReads(){return pdfReads;}};
}
const action=(text='controller',id=1)=>({text,readerID:id,page:1});

test('self-test feedback schedules locally without inflating encounters and preserves old resume semantics',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const first=await s.book.add(action()),second=await s.book.add(action('risk'));
 assert.equal(s.book.find(s.book.data,first.id).encounter.practice,undefined);
 await s.book.edit(first.id,{meaning:'控制器',sentenceTranslation:'语境译文'});
 const now=Date.parse('2026-10-26T12:00:00Z');assert.equal(await s.book.feedback(first.id,'remembered',{now}),true);
 const saved=s.book.find(s.book.data,first.id).encounter;
 assert.equal(saved.practice.grade,'remembered');assert.equal(saved.practice.count,1);assert.equal(saved.practice.streak,1);assert.equal(Date.parse(saved.practice.dueAt),now+86400000);
 assert.equal(s.book.data.reviewedThrough,first.seq);assert.equal(s.book.pending()[0].id,second.id);assert.equal(s.book.stats().encounters,2);assert.equal(s.calls.length,0);
 assert(s.book.markdown().includes('**复习反馈：** 记住'));assert(s.book.markdown().includes('**下次复习：**'));
});
test('fixed practice intervals reset on difficulty and cap a remembered streak without pretending mastery',()=>{
 const s=setup(),now=Date.parse('2026-10-26T12:00:00Z');let current;
 for(const days of [1,3,7,14,30,60,60]){current=s.Class.practice(current,'remembered',now);assert.equal(Date.parse(current.dueAt)-now,days*86400000);}
 assert.equal(current.streak,6);assert.equal(current.count,7);
 const again=s.Class.practice(current,'again',now),uncertain=s.Class.practice(current,'uncertain',now);
 assert.equal(again.streak,0);assert.equal(Date.parse(again.dueAt)-now,600000);assert.equal(uncertain.streak,0);assert.equal(Date.parse(uncertain.dueAt)-now,86400000);
 assert.throws(()=>s.Class.practice(current,'mastered',now),/有效/);
});
test('due feedback never advances new-word progress or resets the original reminder clock',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const first=await s.book.add(action()),second=await s.book.add(action('risk'));await s.book.edit(first.id,{meaning:'控制器'});
 const now=Date.parse('2026-10-26T12:00:00Z');await s.book.feedback(first.id,'again',{now});
 const cursor=s.book.data.reviewedThrough,reminder=s.book.data.lastReviewedAt;
 assert.equal(s.book.due(now+599999).length,0);assert.equal(s.book.due(now+600000)[0].id,first.id);
 await s.book.feedback(first.id,'uncertain',{advance:false,now:now+600000});
 assert.equal(s.book.data.reviewedThrough,cursor);assert.equal(s.book.data.lastReviewedAt,reminder);assert.equal(s.book.pending()[0].id,second.id);
 assert.equal(s.book.due(now+600001).length,0);assert.equal(s.calls.length,0);assert.equal(s.book.stats().encounters,2);
});
test('practice feedback is atomic on disk failure and rejects grading an unknown definition',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const first=await s.book.add(action());
 await assert.rejects(s.book.feedback(first.id,'remembered'),/释义尚未补全/);assert.equal(s.book.data.reviewedThrough,0);
 await s.book.edit(first.id,{meaning:'控制器'});const before=JSON.stringify(s.book.snapshot()),disk=s.files.get(s.book.path);s.setFail(true);
 await assert.rejects(s.book.feedback(first.id,'remembered'),/disk full/);assert.equal(JSON.stringify(s.book.snapshot()),before);assert.equal(s.files.get(s.book.path),disk);
 s.setFail(false);await s.book.feedback(first.id,'remembered');assert.equal(s.book.find(s.book.data,first.id).encounter.practice.count,1);
});
test('parallel or stale feedback cannot overwrite newer results or skip an unreviewed encounter',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const first=await s.book.add(action()),second=await s.book.add(action('risk'));await s.book.edit(first.id,{meaning:'控制器'});await s.book.edit(second.id,{meaning:'风险'});
 await assert.rejects(s.book.feedback(second.id,'remembered'),/上次复习/);
 const results=await Promise.all([s.book.feedback(first.id,'again'),s.book.feedback(first.id,'remembered')]);assert.equal(results.filter(Boolean).length,1);
 const saved=s.book.find(s.book.data,first.id).encounter.practice;assert.equal(saved.count,1);assert.equal(saved.grade,'again');assert.equal(s.book.data.reviewedThrough,first.seq);
 assert.equal(await s.book.feedback(first.id,'remembered',{advance:false,expectedCount:0}),false);assert.equal(s.book.find(s.book.data,first.id).encounter.practice.grade,'again');
});
test('practice survives backup restore and removal without changing encounter counts',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const first=await s.book.add(action());await s.book.edit(first.id,{meaning:'控制器'});
 const now=Date.parse('2026-10-26T12:00:00Z');await s.book.feedback(first.id,'again',{now});const backup=s.book.backupDocument();
 await s.book.removeEncounter(first.id);assert.equal(s.book.due(now+600000).length,0);await s.book.restoreEncounter(first.id);assert.equal(s.book.due(now+600000).length,1);
 const plan=s.book.previewImport(backup);await s.book.importBackup(plan,'restore');assert.equal(s.book.find(s.book.data,first.id).encounter.practice.grade,'again');assert.equal(s.book.stats().encounters,1);
 const resumed=setup(s.files);await resumed.book.init();assert.equal(resumed.book.find(resumed.book.data,first.id).encounter.practice.count,1);
 const malformed=s.book.backupDocument();malformed.data.entries[0].encounters[0].practice.dueAt='invalid';assert.throws(()=>s.book.previewImport(malformed),/复习反馈/);
 delete malformed.data.entries[0].encounters[0].practice;assert.equal(s.book.previewImport(malformed).records,1);
});

test('full vocabulary backups include restorable progress and removed data, never credentials',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const a=await s.book.add(action()),b=await s.book.add(action('risk'));await s.book.reviewed(a.seq);await s.book.removeEncounter(b.id);
 const backup=s.book.backupDocument();assert.equal(backup.format,'paper-companion-vocabulary');assert.equal(backup.data.reviewedThrough,a.seq);assert.equal(backup.data.entries.length,2);assert(backup.data.entries.flatMap(e=>e.encounters).some(c=>c.removedAt));backup.data.entries[0].word='changed';assert.equal(s.book.data.entries[0].word,'controller');assert(!JSON.stringify(backup).includes('credentials'));assert.equal(s.calls.length,0);
});
test('import preview is read-only and distinguishes duplicate records from conflicts',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();await s.book.add(action());const backup=s.book.backupDocument(),before=s.files.get(s.book.path);
 assert.equal(s.book.previewImport(backup).duplicates,1);backup.data.entries[0].encounters[0].meaning='different';const plan=s.book.previewImport(backup);assert.equal(plan.conflicts,1);assert.equal(plan.additions,0);assert.equal(plan.samples[0].word,'controller');assert.equal(s.files.get(s.book.path),before);assert.equal(s.calls.length,0);assert.throws(()=>s.book.previewImport({...backup,version:2}),/不支持/);assert.throws(()=>s.book.previewImport({version:1}),/损坏/);
});
test('merge preserves local definitions and progress, skips ID conflicts and adds records in source sequence',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const old=await s.book.add(action());await s.book.reviewed(old.seq);const backup=s.book.backupDocument(),base=backup.data.entries[0].encounters[0];
 backup.data.entries[0].defaultMeaning='should not replace local meaning';base.meaning='conflicting imported meaning';backup.data.entries.push({word:'risk',key:'risk',defaultMeaning:'风险',encounters:[{...base,id:'new-3',seq:3,meaning:'risk'}]});backup.data.entries[0].encounters.push({...base,id:'new-2',seq:2,meaning:'controller again'});backup.data.nextSequence=4;
 const oldFile=s.files.get(s.book.path),plan=s.book.previewImport(backup);assert.equal(plan.additions,2);assert.equal(plan.conflicts,1);const result=await s.book.importBackup(plan);assert.equal(s.files.get(result.backup),oldFile);assert.equal(s.book.data.reviewedThrough,old.seq);assert.notEqual(s.book.data.entries[0].defaultMeaning,'should not replace local meaning');assert.notEqual(s.book.find(s.book.data,old.id).encounter.meaning,'conflicting imported meaning');assert.deepEqual(Array.from(s.book.pending(),c=>c.id),['new-2','new-3']);assert.equal(s.book.previewImport(backup).additions,0);assert.equal(s.calls.length,0);
});
test('explicit restoration preserves backup review state and retains exact previous primary data',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const a=await s.book.add(action());await s.book.reviewed(a.seq);const backup=s.book.backupDocument();await s.book.add(action('risk'));const oldFile=s.files.get(s.book.path),result=await s.book.importBackup(s.book.previewImport(backup),'restore');assert.equal(s.files.get(result.backup),oldFile);assert.equal(s.book.stats().words,1);assert.equal(s.book.data.reviewedThrough,a.seq);assert.equal(s.book.stats().pending,0);assert.equal(s.book.lastAddedID,null);assert.equal(s.calls.length,0);
});
test('import rejects stale previews after review changes and while background jobs are active',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const a=await s.book.add(action()),plan=s.book.previewImport(s.book.backupDocument());await s.book.reviewed(a.seq);await assert.rejects(s.book.importBackup(plan),/预览后发生变化/);const fresh=s.book.previewImport(s.book.backupDocument());s.book.jobs.set('active',Promise.resolve());await assert.rejects(s.book.importBackup(fresh),/请等/);s.book.jobs.clear();assert.equal(s.calls.length,0);
});
test('failed import writes preserve the committed in-memory and on-disk vocabulary',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();await s.book.add(action());const before=s.files.get(s.book.path),plan=s.book.previewImport(s.book.backupDocument());s.setFail(true);await assert.rejects(s.book.importBackup(plan,'restore'),/disk full/);assert.equal(s.files.get(s.book.path),before);assert.equal(JSON.stringify(s.book.snapshot()),JSON.stringify(JSON.parse(before)));s.setFail(false);await s.book.importBackup(s.book.previewImport(plan.source),'restore');assert.equal(s.book.stats().words,1);
});
test('restore can repair corrupt primary data only after preserving the exact corrupt file',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();await s.book.add(action());const backup=s.book.backupDocument();s.files.set(s.book.path,'CORRUPT_PRIMARY');s.book.problem='bad primary';assert.throws(()=>s.book.backupDocument(),/主数据/);await assert.rejects(s.book.importBackup(s.book.previewImport(backup)),/当前主数据/);const result=await s.book.importBackup(s.book.previewImport(backup),'restore');assert.equal(s.files.get(result.backup),'CORRUPT_PRIMARY');assert.equal(s.book.problem,'');assert.equal(s.book.stats().words,1);
});

test('removal is reversible across restart and active counts, markdown and review skip removed encounters',async()=>{
 const s=setup();await s.book.init();const a=await s.book.add(action()),b=await s.book.add(action('controller',2));
 await s.book.removeEncounter(a.id);assert.equal(s.book.stats().encounters,1);assert.equal(s.book.stats().pending,1);assert.equal(s.book.removed().length,1);assert(!s.book.markdown().includes('Paper 1'));
 await s.book.reviewed(b.seq);assert.equal(s.book.stats().pending,0);
 const resumed=new s.Class(s.api);await resumed.init();await resumed.restoreEncounter(a.id);assert.equal(resumed.stats().pending,1);assert.equal(resumed.pending()[0].id,a.id);
 await resumed.reviewed(a.seq);assert.equal(resumed.stats().pending,0);assert.equal(resumed.data.reviewedThrough,b.seq);assert.equal(resumed.stats().encounters,2);assert.equal(s.calls.length,1);
});
test('word correction merges by normalized key without changing encounter IDs or review sequence and creates a backup',async()=>{
 const s=setup();await s.book.init();const a=await s.book.add(action('controler')),b=await s.book.add(action());
 await s.book.edit(b.id,{meaning:'目标语境',defaultMeaning:'目标常用义',sentence:b.sentence,sentenceTranslation:'目标句译'});
 await s.book.edit(a.id,{word:'controller',meaning:'更正后的语境',defaultMeaning:'源常用义',sentence:'The controller reduced spill risk.',sentenceTranslation:'句译'});
 assert.equal(s.book.stats().words,1);assert.equal(s.book.stats().encounters,2);assert.equal(s.book.find(s.book.data,a.id).entry.defaultMeaning,'目标常用义');assert.deepEqual(Array.from(s.book.occurrences(),c=>c.seq),[a.seq,b.seq]);
 const backup=[...s.files].find(([p])=>p.includes('词头更正前'));assert(backup);assert.equal(JSON.parse(backup[1]).entries.length,2);
});
test('failed removal or correction keeps original state and a new word correction accepts its common definition',async()=>{
 const s=setup();await s.book.init();const a=await s.book.add(action());s.setFail(true);
 await assert.rejects(s.book.removeEncounter(a.id),/disk full/);assert.equal(s.book.stats().encounters,1);await assert.rejects(s.book.edit(a.id,{word:'controllers'}),/disk full/);assert.equal(s.book.find(s.book.data,a.id).entry.word,'controller');
 s.setFail(false);await s.book.edit(a.id,{word:'controllers',defaultMeaning:'新的常用义'});assert.equal(s.book.find(s.book.data,a.id).entry.defaultMeaning,'新的常用义');
});
test('late completion cannot update a removed record and restoring never counts as a new encounter',async()=>{
 const s=setup();await s.book.init();s.api.settings.vocabularyGenerateOnAdd=false;const a=await s.book.add(action());let finish;
 s.api.gateway.generate=()=>new Promise(resolve=>finish=resolve);const job=s.book.enrich(a.id);await Promise.resolve();await s.book.removeEncounter(a.id);
 finish(JSON.stringify({meaning:'LATE',sentenceTranslation:'LATE'}));await job;assert.equal(s.book.find(s.book.data,a.id).encounter.meaning,'');await s.book.restoreEncounter(a.id);assert.equal(s.book.data.nextSequence,2);assert.equal(s.book.stats().encounters,1);
});
test('seven-day defaults migrate the former default but preserve custom intervals and disabled reminders',()=>{
 const {Class}=setup();assert.equal(Class.reminderSettings().vocabularyReminderMinutes,10080);
 assert.equal(Class.reminderSettings({vocabularyReminderMinutes:1440}).vocabularyReminderMinutes,10080);
 assert.equal(Class.reminderSettings({vocabularyReminderMinutes:60}).vocabularyReminderMinutes,60);
 assert.equal(Class.reminderSettings({vocabularyReminderMinutes:1440,vocabularyReminderCustomized:true}).vocabularyReminderMinutes,1440);
 assert.equal(Class.reminderSettings({vocabularyReminderMinutes:1440,vocabularyDefaultsVersion:2}).vocabularyReminderMinutes,1440);
 assert.equal(Class.reminderSettings({vocabularyReminderEnabled:false}).vocabularyReminderEnabled,false);
});
test('default reminder becomes due at seven days rather than after the former one-day interval',async()=>{
 const s=setup();Object.assign(s.api.settings,s.Class.reminderSettings());await s.book.init();await s.book.add(action());
 const at=Date.parse(s.book.occurrences()[0].at);assert.equal(s.book.stats(at+86400000).due,false);
 assert.equal(s.book.stats(at+7*86400000-1).due,false);assert.equal(s.book.stats(at+7*86400000).due,true);
});
test('vocabulary startup is local and lazy; explicit additions share one global book and count clicks',async()=>{
 const s=setup();await s.book.init();assert.equal(s.files.size,0);assert.equal(s.calls.length,0);
 const a=await s.book.add(action()),b=await s.book.add(action('Controller',2));
 assert.equal(s.book.data.entries.length,1);assert.equal(b.count,2);assert.equal(a.count,1);assert.equal(s.calls.length,1);assert.equal(b.cached,true);
 assert(s.calls.every(c=>c.usageFeature==='vocabulary'&&c.model==='deepseek-flash'&&c.effort==='none'));
 assert.equal(s.book.data.entries[0].encounters[1].title,'Paper 2');
 assert.equal(b.sentence,'The controller reduced spill risk.');
 assert(s.files.get(s.book.markdownPath).includes('Paper 2'));assert(s.book.markdownPath.startsWith('/data/'));
 const resumed=new s.Class(s.api);await resumed.init();assert.equal(resumed.stats().encounters,2);assert.equal(s.calls.length,1);
 await resumed.openFile();assert.equal(s.calls.length,1);assert.equal(s.opened.at(-1),resumed.markdownPath);
});
test('terms normalize casing and edge punctuation but do not collapse unrelated forms or accept entire passages',()=>{
 const {Class}=setup();assert.equal(Class.term(' “Controller,” ').key,'controller');assert.equal(Class.term('ＮＬＰ').key,'nlp');
 assert.notEqual(Class.term('models').key,Class.term('model').key);
 assert.equal(Class.valid('a '.repeat(9)),false);assert.equal(Class.valid('<script>'),false);assert.equal(Class.valid('123'),false);
});
test('PDF context is extracted without changing chat attachments, ambiguous repeated words remain unclaimed',()=>{
 const {Class}=setup(),items=[{str:'First controller works.',transform:[10,0,0,10,0,90],width:150,height:10},{str:'Second controller failed.',transform:[10,0,0,10,0,30],width:150,height:10}];
 assert.equal(Class.sentence(items,'controller'),'');
 assert.equal(Class.sentence(items,'controller',[[0,30,150,40]]),'Second controller failed.');
 assert.equal(Class.sentence(items,'missing'),'');assert.equal(Class.sentence([{str:'Controllers vary.'}],'controller'),'');
 assert.equal(Class.sentence([{str:'The basic idea'},{str:'works well.'}],'basic idea'),'The basic idea works well.');
});
test('review resumes per encounter and only advances on explicit contiguous confirmation, including repeats',async()=>{
 const {book,calls}=setup();await book.init();await book.add(action());await book.add(action('risk'));
 assert.equal(book.stats().pending,2);await assert.rejects(book.reviewed(2),/位置/);assert.equal(book.data.reviewedThrough,0);
 await book.reviewed(1);assert.equal(book.stats().pending,1);await book.reviewed(1);assert.equal(book.data.reviewedThrough,1);
 await book.reviewed(2);await book.add(action('controller',2));assert.equal(book.stats().pending,1);assert.equal(book.occurrences().at(-1).word,'controller');
 assert.equal(calls.length,2);assert.equal(book.data.reviewedThrough,2);
});
test('reminder uses configurable interval after earliest pending encounter or last review and never calls a model',async()=>{
 const {book,api,calls}=setup();await book.init();await book.add(action());
 const start=Date.parse(book.occurrences()[0].at);assert.equal(book.stats(start+3599999).due,false);assert.equal(book.stats(start+3600000).due,true);
 api.settings.vocabularyReminderEnabled=false;assert.equal(book.stats(start+99999999).due,false);api.settings.vocabularyReminderEnabled=true;
 await book.reviewed(1);assert.equal(book.stats(start+99999999).due,false);assert.equal(calls.length,1);
});
test('unavailable model still saves word and provenance; retry fills without inflating count or silently changing providers',async()=>{
 const {book,api,calls}=setup();await book.init();api.settings.translationProvider='chatgpt';api.settings.translationChatGPTModel='explicit-model';
 api.gateway.generate=async opts=>{calls.push(opts);throw Error('请连接所选账号');};
 const saved=await book.add(action());assert.equal(saved.status,'pending');assert(saved.error.includes('账号'));assert.equal(book.stats().encounters,1);
 assert.equal(calls[0].provider,'chatgpt');assert.equal(calls[0].model,'explicit-model');
 api.gateway.generate=async()=>JSON.stringify({meaning:'人工确认过的控制器',sentenceTranslation:'译文'});await book.enrich(saved.id);
 assert.equal(book.stats().encounters,1);assert.equal(book.occurrences()[0].status,'complete');
 await book.edit(saved.id,{meaning:'手写释义',sentence:saved.sentence,sentenceTranslation:'手写句意'});assert.equal(book.occurrences()[0].meaning,'手写释义');
});
test('manual edits survive late model completion and malformed JSON never overwrites content',async()=>{
 const s=setup();await s.book.init();let release,entered;const ready=new Promise(r=>entered=r);
 s.api.gateway.generate=()=>{entered();return new Promise(r=>release=r);};const adding=s.book.add(action());await ready;
 const id=s.book.occurrences()[0].id;await s.book.edit(id,{meaning:'my edit',sentence:'my sentence',sentenceTranslation:'my translation'});
 release(JSON.stringify({meaning:'late',sentenceTranslation:'late'}));await adding;assert.equal(s.book.occurrences()[0].meaning,'my edit');
 s.api.gateway.generate=async()=>'<p>bad result</p>';await s.book.enrich(id);assert.equal(s.book.occurrences()[0].meaning,'my edit');assert.equal(s.book.stats().encounters,1);
});
test('serial saves preserve concurrent clicks; failed canonical write never mutates in-memory book',async()=>{
 const s=setup();await s.book.init();await Promise.all([s.book.add(action()),s.book.add(action('risk'))]);assert.equal(s.book.stats().encounters,2);
 s.setFail(true);await assert.rejects(s.book.add(action('liquid')),/disk full/);assert.equal(s.book.stats().encounters,2);
 s.setFail(false);await s.book.add(action('liquid'));assert.equal(s.book.stats().encounters,3);
});
test('external Markdown edits are backed up exactly and corrupt ledger is preserved without disabling the rest of plugin',async()=>{
 const s=setup();await s.book.init();await s.book.add(action());s.files.set(s.book.markdownPath,'EXTERNAL NOTES');await s.book.reviewed(1);
 assert([...s.files.entries()].some(([p,v])=>p.includes('外部修改备份')&&v==='EXTERNAL NOTES'));
 const original=s.files.get(s.book.path);s.files.set(s.book.path,'BROKEN');const corrupt=new s.Class(s.api);await corrupt.init();assert(corrupt.problem);
 await assert.rejects(corrupt.add(action()));assert.equal(s.files.get(s.book.path),'BROKEN');assert.notEqual(original,'BROKEN');
});
test('relocating copies a global notebook without removing prior files and resumes from saved directory',async()=>{
 const s=setup();await s.book.init();await s.book.add(action());const old=s.book.path;await s.book.relocate('/custom');
 assert(s.files.has(old));assert(s.files.has('/custom/论文伴读单词本/单词本.md'));
 const resumed=new s.Class(s.api);await resumed.init();assert.equal(resumed.stats().words,1);assert.equal(resumed.dir,'/custom/论文伴读单词本');
});
test('cancelling vocabulary generation keeps the committed encounter and allows retry',async()=>{
 const s=setup();await s.book.init();let entered;const ready=new Promise(r=>entered=r);
 s.api.gateway.generate=opts=>{entered();return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('abort'))));};
 const adding=s.book.add(action());await ready;s.book.cancel();await adding;assert.equal(s.book.stats().encounters,1);assert(s.book.occurrences()[0].error.includes('停止'));
});
test('a repaired Markdown write clears the sync error and opens the real file on retry',async()=>{
 const s=setup();await s.book.init();const write=s.api.writeText;s.api.writeText=async(p,t)=>{if(p.endsWith('.md'))throw Error('locked Markdown');return write(p,t);};
 await s.book.add(action());assert.equal(s.book.stats().encounters,1);assert(s.book.notice.includes('同步失败'));
 s.api.writeText=write;await s.book.openFile();assert(!s.book.notice.includes('同步失败'));assert.equal(s.opened.at(-1),s.book.markdownPath);
});
test('shutdown during PDF lookup cannot start a late model call or create an encounter after unload',async()=>{
 const s=setup();await s.book.init();let release,entered;const ready=new Promise(r=>entered=r),paperInfo=s.api.paperInfo;
 s.api.paperInfo=id=>{entered();return new Promise(r=>release=()=>paperInfo(id).then(r));};
 const adding=s.book.add(action());await ready;await s.book.destroy();release();await assert.rejects(adding,/关闭/);
 assert.equal(s.calls.length,0);assert.equal(s.book.stats().encounters,0);
});

test('local lookup is mandatory for every fallback setting and a rendered selection avoids page extraction',async()=>{
 for(const fallback of ['manual','automatic','none']){
  const s=setup();s.api.settings.vocabularyContextFallback=fallback;await s.book.init();await s.book.add(action());assert.equal(s.pdfReads,1);assert.equal(s.book.occurrences()[0].contextMode,'local');
 }
 const s=setup();await s.book.init();const sentence='The controller works.',hint={term:'controller',readerID:1,page:1,sentence,wordOffset:4};
 await s.book.add({...action(),contextHint:hint});assert.equal(s.pdfReads,0);assert.equal(s.book.occurrences()[0].sentence,sentence);
 await s.book.add({...action(),contextHint:{...hint,readerID:2}});assert.equal(s.pdfReads,1,'stale hints are not trusted');
});

test('same-page text extraction is coalesced and the local page cache is bounded',async()=>{
 const s=setup();await s.book.init();await Promise.all([s.book.add(action()),s.book.add(action('risk'))]);assert.equal(s.pdfReads,1);
 for(let page=2;page<=20;page++)await s.book.pageItems({itemID:1},page);
 assert.equal(s.book.pageCache.size,16);await s.book.pageItems({itemID:1},1);assert.equal(s.pdfReads,21);
});

test('sentence boundaries retain academic abbreviations, decimals and line-end hyphenation',()=>{
 const {Class}=setup();
 assert.equal(Class.sentence([{str:'See Fig. 2. The controller uses 1.5 m/s, e.g. in flight. Next sentence.'}],'controller'),'The controller uses 1.5 m/s, e.g. in flight.');
 assert.equal(Class.sentence([{str:'The con-',hasEOL:true},{str:'troller works well.'}],'controller'),'The controller works well.');
 assert.equal(Class.sentence([{str:'The con-',hasEOL:true},{str:'troller works well.'}],'con-troller'),'The con-troller works well.');
 assert.equal(Class.sentence([{str:'controller'}],'controller'),'');
 const long=Class.locate([{str:'prefix '.repeat(200)+'controller '+'suffix '.repeat(200)}],'controller');assert(long.sentence.length<=900);assert.equal(long.contextClipped,true);assert.equal(long.sentence.slice(long.wordOffset,long.wordOffset+10),'controller');
});

test('same-line repeated terms use the selected character position rather than selecting the first occurrence',()=>{
 const {Class}=setup(),text='A bank borders the river; the bank approved a loan.',item={str:text,width:text.length*10,height:10,transform:[10,0,0,10,0,50]},offset=text.lastIndexOf('bank');
 assert.equal(Class.sentence([item],'bank'),'');
 const found=Class.locate([item],'bank',[[offset*10,50,(offset+4)*10,60]]);assert.equal(found.sentence,'the bank approved a loan.');assert.equal(found.wordOffset,4);
});

test('common definitions and contextual meanings stay separate, config changes invalidate automatic reuse',async()=>{
 const s=setup();await s.book.init();const first=await s.book.add(action());assert.equal(s.book.data.entries[0].defaultMeaning,'控制器；管理者');assert.equal(first.meaning,'控制器');
 await s.book.add(action());assert.equal(s.calls.length,1);
 s.api.settings.deepseekModel='deepseek-pro';await s.book.add(action());assert.equal(s.calls.length,2);s.api.settings.language='English';await s.book.add(action());assert.equal(s.calls.length,3);
 await s.book.enrich(first.id);assert.equal(s.calls.length,4,'explicit refresh is not silently skipped');
 const md=s.files.get(s.book.markdownPath);assert(md.includes('常用释义')&&md.includes('本句词义'));
});

test('concurrent identical additions share one model completion without combining encounter counts',async()=>{
 const s=setup();await s.book.init();let release;const generate=s.api.gateway.generate;s.api.gateway.generate=opts=>new Promise(r=>{release=()=>generate(opts).then(r);});
 const a=s.book.add(action()),b=s.book.add(action());while(!release)await new Promise(r=>setImmediate(r));release();await Promise.all([a,b]);assert.equal(s.calls.length,1);assert.equal(s.book.stats().encounters,2);
});

test('manual fallback prompts without a model call and captures a reselected sentence without another encounter',async()=>{
 const s=setup(),prompts=[];s.api.requestVocabularyContext=(p,m)=>prompts.push([p,m]);await s.book.init();const missing=await s.book.add(action('missing'));
 assert.equal(s.calls.length,0);assert.equal(s.book.pendingContext.id,missing.id);assert.equal(prompts.length,1);
 assert.equal(await s.book.acceptSelection({text:'A missing value is expected.',readerID:2,page:1}),false);
 assert.equal(await s.book.acceptSelection({text:'A missing value is expected.',readerID:1,page:2}),false);
 assert.equal(await s.book.acceptSelection({text:'A missing value is expected.',readerID:1,page:1}),true);
 assert.equal(s.book.stats().encounters,1);assert.equal(s.calls.length,1);assert.equal(s.book.pendingContext,null);assert.equal(s.book.occurrences()[0].contextMode,'manual');
});

test('only-collect and no-fallback options still perform local lookup and never request paid assistance automatically',async()=>{
 const s=setup();Object.assign(s.api.settings,{vocabularyGenerateOnAdd:false,vocabularyContextFallback:'automatic'});await s.book.init();await s.book.add(action());await s.book.add(action('missing'));
 assert.equal(s.pdfReads,1);assert.equal(s.calls.length,0);assert(s.book.pendingContext);
 s.api.settings.vocabularyContextFallback='none';s.book.cancelManual();await s.book.add(action('unknown'));assert.equal(s.book.pendingContext,null);assert.equal(s.calls.length,0);
 assert(!s.files.get(s.book.path).includes('Brevity'),'display examples must not become original sentences');
});

test('opted automatic fallback follows local failure and commits source and meanings in one result',async()=>{
 const s=setup();Object.assign(s.api.settings,{vocabularyContextFallback:'automatic',vocabularyContextMethod:'model'});await s.book.init();let localFirst=false;
 s.book.assistContext=async(id,kind)=>{localFirst=s.pdfReads===1;assert.equal(kind,'model');return [{sentence:'A missing value is expected.',defaultMeaning:'缺失的',meaning:'缺失的',sentenceTranslation:'预期会有缺失值。'}];};
 const added=await s.book.add(action('missing'));assert(localFirst);assert.equal(added.contextMode,'model');assert.equal(added.status,'complete');assert.equal(s.book.data.entries[0].defaultMeaning,'缺失的');assert.equal(s.book.stats().encounters,1);
});

test('manual fallback can opt into automatic assistance after an invalid re-selection',async()=>{
 const s=setup();await s.book.init();const c=await s.book.add(action('missing'));let assisted=0;s.book.assistContext=async()=>{assisted++;return [{sentence:'A missing value is expected.',defaultMeaning:'缺失的',meaning:'缺失的',sentenceTranslation:'预期会有缺失值。'}];};
 await s.book.acceptSelection({text:'unrelated sentence',readerID:1,page:1});assert.equal(assisted,0);assert.equal(s.book.pendingContext.id,c.id);
 s.api.settings.vocabularyManualAssist=true;await s.book.acceptSelection({text:'unrelated sentence',readerID:1,page:1});assert.equal(assisted,1);assert.equal(s.book.stats().encounters,1);assert.equal(s.book.occurrences()[0].contextMode,'ocr');
});

test('late automatic context cannot overwrite a manual re-selection or restart an obsolete prompt',async()=>{
 const s=setup();await s.book.init();const c=await s.book.add(action('missing'));let release;s.book.assistContext=()=>new Promise(r=>release=r);const task=s.book.autoContext(c.id);
 await s.book.setContext(c.id,'This missing word was manually chosen.');release([{sentence:'A missing value is expected.',defaultMeaning:'缺失的',meaning:'缺失的',sentenceTranslation:'预期会有缺失值。'}]);assert.equal(await task,false);assert.equal(s.book.occurrences()[0].sentence,'This missing word was manually chosen.');assert.equal(s.book.pendingContext,null);
});

test('text-assisted candidates must be actual bounded source text and ambiguous occurrences are rejected without inference',async()=>{
 const s=setup();await s.book.init();s.api.settings.vocabularyGenerateOnAdd=false;const c=await s.book.add(action());
 s.api.gateway.generate=async opts=>{s.calls.push(opts);return JSON.stringify({candidates:[{sentence:'The controller flew to Mars.',defaultMeaning:'控制器',meaning:'控制器',sentenceTranslation:'虚构译文'}]});};
 await assert.rejects(s.book.assistContext(c.id,'model'),/没有找到/);assert.equal(s.calls.length,1);assert(s.calls[0].text.length<2000);
 s.book.pageCache.clear();s.api.pdf=()=>({doc:{getPage:async()=>({getTextContent:async()=>({items:[{str:'The controller controlled another controller.'}]})})}});
 await assert.rejects(s.book.assistContext(c.id,'model'),/多个同词/);assert.equal(s.calls.length,1);
});

test('OCR automatically crops around the stored selection and uses the configured multimodal provider',async()=>{
 const s=setup();await s.book.init();s.api.settings.vocabularyGenerateOnAdd=false;const c=await s.book.add({...action('missing'),rects:[[10,400,40,412]]});let rendered;
 s.api.settings.formulaProvider='deepseek';s.api.formula={render:async(...args)=>{rendered=args;return 'data:image/png;base64,FAKE';},models:()=>[]};
 s.api.pdf=()=>({win:{},app:{pdfViewer:{pagesRotation:0}},doc:{getPage:async()=>({rotate:0,getViewport:()=>({width:600,height:800,convertToViewportRectangle:r=>[r[0],800-r[3],r[2],800-r[1]]})})}});
 s.api.gateway.generate=async opts=>{s.calls.push(opts);return JSON.stringify({candidates:[{sentence:'A missing value is expected.',defaultMeaning:'缺失的',meaning:'缺失的',sentenceTranslation:'预期会有缺失值。'}]});};
 assert.equal(await s.book.autoContext(c.id),true);assert(rendered[3].height<.25);assert.equal(rendered[5].length,1);assert.equal(s.calls[0].images.length,1);assert.equal(s.calls[0].model,'deepseek-flash');assert.equal(s.book.stats().encounters,1);
});

test('catalog search reuses an index until content changes and review does not rebuild it',async()=>{
 const s=setup();await s.book.init();const c=await s.book.add(action());assert.equal(s.book.catalog('管理者').length,1);const cached=s.book.catalogCache;
 s.book.catalog('controller',true);assert.equal(s.book.catalogCache,cached);await s.book.reviewed(1);s.book.catalog();assert.equal(s.book.catalogCache,cached);
 await s.book.edit(c.id,{meaning:'新词义',sentence:c.sentence,sentenceTranslation:'新句意',defaultMeaning:'新的常用释义'});assert.equal(s.book.catalog('新的常用').length,1);assert.notEqual(s.book.catalogCache,cached);
});

test('switching to manual while OCR prepares a crop aborts before a paid request starts',async()=>{
 const s=setup();await s.book.init();s.api.settings.vocabularyGenerateOnAdd=false;const c=await s.book.add({...action('missing'),rects:[[10,400,40,412]]});let release;
 s.api.settings.formulaProvider='deepseek';s.api.formula={render:()=>new Promise(r=>release=r),models:()=>[]};
 s.api.pdf=()=>({win:{},app:{pdfViewer:{pagesRotation:0}},doc:{getPage:async()=>({rotate:0,getViewport:()=>({width:600,height:800,convertToViewportRectangle:r=>[r[0],800-r[3],r[2],800-r[1]]})})}});
 const task=s.book.autoContext(c.id);while(!release)await new Promise(r=>setImmediate(r));s.book.stopContext(c.id);release('data:image/png;base64,FAKE');assert.equal(await task,false);assert.equal(s.calls.length,0);assert.equal(s.book.pendingContext.id,c.id);
});

test('a temporary prompt method survives failed attempts without changing the saved default',async()=>{
 const s=setup();await s.book.init();s.api.settings.vocabularyContextMethod='ocr';const c=await s.book.add(action('missing'));s.book.assistContext=async()=>{throw Error('Cannot identify source');};
 await s.book.autoContext(c.id,{...s.api.settings,vocabularyContextMethod:'model'});assert.equal(s.book.pendingContext.method,'model');assert.equal(s.api.settings.vocabularyContextMethod,'ocr');
});

test('paper vocabulary filters contexts and search locally while retaining personal encounter totals',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();
 const first=await s.book.add(action('controller',1)),second=await s.book.add(action('controller',2));await s.book.add(action('risk',2));
 await s.book.edit(first.id,{meaning:'本章释义',defaultMeaning:'控制器',sentence:'This controller is local.',sentenceTranslation:'本章句意'});
 await s.book.edit(second.id,{meaning:'其他论文专有释义',sentence:'A foreign controller context.',sentenceTranslation:'其他论文句意'});
 const chapter=s.book.paperCatalog('1_1');assert.equal(chapter.length,1);assert.equal(chapter[0].totalCount,2);assert.equal(chapter[0].encounters.length,1);assert.equal(chapter[0].encounters[0].id,first.id);
 assert.equal(s.book.paperCatalog('1_1','其他论文专有').length,0);assert.equal(s.book.paperCatalog('1_1','本章释义').length,1);
 assert.equal(s.book.catalog('其他论文专有',true).length,1);assert.equal(s.book.catalog().length,2);assert.equal(s.book.active().find(e=>e.key==='controller').encounters.length,2);
 assert.equal(s.book.paperCatalog(null).length,0);assert.equal(s.book.paperCatalog('missing').length,0);assert.equal(s.book.stats().encounters,3);assert.equal(s.calls.length,0);
});

test('paper vocabulary cache follows committed edits, removals and restoration without changing review progress',async()=>{
 const s=setup();s.api.settings.vocabularyGenerateOnAdd=false;await s.book.init();const a=await s.book.add(action('controller',1)),b=await s.book.add(action('risk',2));
 const rows=s.book.paperCatalog('1_1');assert.equal(s.book.paperCatalog('1_1'),rows);await s.book.reviewed(a.seq);assert.equal(s.book.paperCatalog('1_1'),rows);
 await s.book.removeEncounter(a.id);assert.equal(s.book.paperCatalog('1_1').length,0);assert.equal(s.book.paperCatalog('1_2')[0].encounters[0].id,b.id);
 await s.book.restoreEncounter(a.id);assert.equal(s.book.paperCatalog('1_1').length,1);assert.equal(s.book.data.reviewedThrough,a.seq);assert.equal(s.book.stats().encounters,2);assert.equal(s.calls.length,0);
});
