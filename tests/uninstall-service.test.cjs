const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path').posix;
const { PCUninstall, PCUninstallInventory } = require('../addon/content/uninstall-service.js');

function fixture() {
  const config = { profileRoot: '/profile/paper-companion', dataRoot: '/data/paper-companion', vocabularyRoot: '/data/paper-companion/单词本', protectedPaths: ['/library/article.pdf'], papers: [{ key: '1_ABCDEFGH', dir: '/papers/article', source: '/library/article.pdf', pdfName: 'article.pdf' }] };
  const files = new Map(), identities = new Map(), reads = [], stats = [], unsafe = new Set();
  const add = (name, type = 'regular') => { files.set(name, { regular: type === 'regular', size: 50, modified: 123 }); return name; };
  const identity = '/papers/article/.paper-companion/identity.json'; add(identity); identities.set(identity, { version: 1, key: '1_ABCDEFGH', source: '/library/article.pdf' });
  const io = { join: path.join, parent: path.dirname, basename: path.basename,
    safePath: async name => ![...unsafe].some(value => name === value || name.startsWith(value + '/')),
    inspectFile: async name => { stats.push(name); return files.get(name) || null; },
    readJSON: async name => { reads.push(name); return identities.get(name); },
    children: async dir => [...files.keys()].filter(name => path.dirname(name) === dir) };
  return { config, io, files, add, identities, reads, stats, unsafe, collect: () => PCUninstallInventory.collect(config, io) };
}

test('inventory recognizes only exact private configuration, usage, chat and vocabulary formats without decrypting credentials', async () => {
  const f = fixture();
  for (const name of ['accounts.json', 'credentials.enc', 'settings.json.tmp', 'usage-index.json', 'usage-records-m3-a-abc.json']) f.add(path.join(f.config.profileRoot, name));
  f.add('/data/paper-companion/chats/1_ABCDEFGH.json'); f.add('/data/paper-companion/chats/general-123.json');
  f.add('/data/paper-companion/单词本/vocabulary.json'); f.add('/data/paper-companion/单词本/单词本.md');
  f.add('/data/paper-companion/单词本/单词本-词头更正前-123-123456ab.json');
  f.add('/profile/paper-companion/user-important.txt');
  const plan = await f.collect();
  assert.equal(plan.files.length, 11); assert.equal(plan.categories.find(c => c.id === 'usage').count, 2);
  assert.equal(plan.categories.find(c => c.id === 'chat').count, 2); assert.equal(plan.categories.find(c => c.id === 'vocabulary').count, 3);
  assert.ok(plan.kept.some(row => row.path.endsWith('user-important.txt')));
  assert.deepEqual(f.reads, ['/papers/article/.paper-companion/identity.json']); assert.ok(!f.reads.some(row => row.endsWith('credentials.enc')));
  assert.equal(plan.bytes, 550); assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.files[0]));
});

test('matching paper identity includes generated notes, cache, backup and PDF copy but never source', async () => {
  const f = fixture();
  for (const name of ['阅读笔记.md', '聊天重点.md', '重点省察.md', '重点再整理.md', '论文预读.md', '论文原文.md', 'article.pdf']) f.add('/papers/article/' + name);
  f.add('/papers/article/.paper-companion/reading-index.json'); f.add('/papers/article/.paper-companion/preread.json.tmp');
  f.add('/papers/article/backups/1_ABCDEFGH-123.md'); f.add('/papers/article/backups/阅读笔记-外部修改-123-123456ab.md');
  const plan = await f.collect(); assert.equal(plan.files.length, 12);
  assert.equal(plan.files.filter(row => row.category === 'copies').length, 1);
  assert.ok(plan.files.every(row => row.path !== '/library/article.pdf'));
});

test('actual Zotero source attachment in a registered folder remains protected even if it has the copied-PDF filename', async () => {
  const f = fixture(); f.config.protectedPaths.push('/papers/article/article.pdf'); f.add('/papers/article/article.pdf');
  const plan = await f.collect(); assert.ok(plan.kept.some(row => row.path === '/papers/article/article.pdf' && /原始论文/.test(row.reason)));
  assert.ok(!plan.files.some(row => row.path === '/papers/article/article.pdf'));
});

test('mismatched, corrupt or missing paper identity preserves whole registered folder', async () => {
  const f = fixture(); f.add('/papers/article/阅读笔记.md'); f.identities.set('/papers/article/.paper-companion/identity.json', { version: 1, key: '1_OTHERKEY', source: '/library/article.pdf' });
  let plan = await f.collect(); assert.equal(plan.files.length, 0); assert.match(plan.kept[0].reason, /标识/);
  f.identities.clear(); plan = await f.collect(); assert.equal(plan.files.length, 0);
  f.io.readJSON = async () => { throw new Error('corrupt'); }; plan = await f.collect(); assert.equal(plan.files.length, 0);
});

test('link components are never followed for private roots, configured vocabulary or paper identity', async () => {
  const f = fixture(); f.add('/profile/paper-companion/credentials.enc'); f.add('/data/paper-companion/单词本/vocabulary.json'); f.add('/papers/article/阅读笔记.md');
  f.unsafe.add('/profile'); f.unsafe.add('/data/paper-companion/单词本'); f.unsafe.add('/papers/article');
  const plan = await f.collect(); assert.equal(plan.files.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.stats.length, 0);
});

test('individual link-like or nonregular file stays out of recognized list', async () => {
  const f = fixture(); f.add('/profile/paper-companion/settings.json', 'directory'); f.add('/profile/paper-companion/credentials.enc'); f.unsafe.add('/profile/paper-companion/credentials.enc');
  const plan = await f.collect(); assert.ok(plan.kept.some(row => /不是可核对/.test(row.reason))); assert.ok(plan.kept.some(row => /路径包含链接/.test(row.reason)));
  assert.ok(!plan.files.some(row => row.category === 'settings'));
});

test('enumeration outside exact known directory is retained and private-root/path traversal is rejected', async () => {
  const f = fixture(); const children = f.io.children; f.io.children = async dir => dir === f.config.profileRoot ? ['/library/secret.json'] : children(dir);
  const plan = await f.collect(); assert.ok(plan.kept.some(row => /枚举越界/.test(row.reason))); assert.ok(!f.stats.includes('/library/secret.json'));
  f.config.profileRoot = '/profile'; await assert.rejects(f.collect, /私有目录/);
  f.config.profileRoot = '/profile/../paper-companion'; await assert.rejects(f.collect, /绝对路径/);
});

test('unexpected vocabulary names, malformed PDF filename and unknown backup are retained', async () => {
  const f = fixture(); f.config.papers[0].pdfName = '../article.pdf';
  f.add('/papers/article/backups/my-work.md'); f.add('/data/paper-companion/单词本/other.json');
  const plan = await f.collect(); assert.equal(plan.files.length, 1); assert.equal(plan.kept.length, 3);
});

test('Windows case normalization protects originals and deduplicates equivalent configured files', async () => {
  const f = fixture(); f.config.windows = true;
  f.config.profileRoot = 'C:/profile/paper-companion'; f.config.dataRoot = 'C:/data/paper-companion'; f.config.vocabularyRoot = null;
  f.config.papers = [{ key: '1_ABCDEFGH', dir: 'C:/papers/article', source: 'C:/library/article.pdf', pdfName: 'article.pdf' }];
  f.identities.set('C:/papers/article/.paper-companion/identity.json', { key: '1_ABCDEFGH', source: 'c:/LIBRARY/Article.pdf', version: 1 });
  f.config.protectedPaths = ['c:/PAPERS/ARTICLE/article.pdf']; f.add('C:/papers/article/article.pdf');
  const plan = await f.collect(); assert.equal(plan.files.length, 0); assert.ok(plan.kept.some(row => /原始论文/.test(row.reason)));
});

test('metadata-only review cannot execute cleanup and cancel invalidates late preview', async () => {
  const f = fixture(); let release; const hold = new Promise(resolve => { release = resolve; });
  const review = new PCUninstall({ inventory: async () => { await hold; return f.collect(); } });
  const preview = review.preview(); review.cancel(); release(); await assert.rejects(preview, /更新/);
  assert.equal(review.plan, null); assert.equal(review.available, false); assert.equal(review.remove, undefined); assert.equal(review.uninstall, undefined);
  await assert.rejects(() => review.execute({}), /不可用/);
  const plan = await review.preview(); assert.equal(plan.files.length, 1); assert.equal(plan.verified, false); assert.match(review.text(), /执行前须确认/); assert.match(review.text(), /identity\.json/);
  review.cancel(); assert.equal(review.text(), '');
});

function runtime() {
  const files = new Map([
    ['/profile/paper-companion/settings.json', { regular: true, size: 20, modified: 1, hash: 'a'.repeat(64), category: 'settings', label: '设置' }],
    ['/papers/article/阅读笔记.md', { regular: true, size: 30, modified: 2, hash: 'b'.repeat(64), category: 'papers', label: '论文笔记' }],
    ['/papers/article/.paper-companion/identity.json', { regular: true, size: 10, modified: 3, hash: 'c'.repeat(64), category: 'papers', label: '论文笔记' }],
    ['/profile/paper-companion/paper-folders.json', { regular: true, size: 10, modified: 4, hash: 'd'.repeat(64), category: 'settings', label: '设置' }]
  ]);
  const events = [], actions = []; let hashes = 0, hook = null, validation = null, remove = null, finalize = null;
  const io = {
    inventory: async () => ({ version: 1, files: [...files].map(([path, row]) => ({ path, ...row })), categories: [{ id: 'settings', count: 2 }, { id: 'papers', count: 2 }], kept: [{ path: '/user/untouched', reason: '原始文件' }], limitations: [], bytes: 70 }),
    fingerprint: async path => { hashes++; await hook?.(path, hashes); const row = files.get(path); return row ? { ...row } : null; },
    inspectFile: async path => files.get(path) || null,
    quiesce: async () => { actions.push('quiesce'); return async () => actions.push('resume'); },
    revalidate: async (plan, context) => { actions.push('revalidate'); await validation?.(plan, context); },
    removeFile: async (path, row) => { actions.push('remove:' + path); if (remove) await remove(path, row); else files.delete(path); },
    invalidate: async () => actions.push('invalidate'),
    finalize: async () => { actions.push('finalize'); await finalize?.(); },
    progress: state => events.push(state)
  };
  const review = new PCUninstall(io), confirm = () => ({ id: review.plan.id, confirmation: '完全卸载', acknowledged: true, categories: ['settings', 'papers'] });
  return { files, io, review, confirm, events, actions, hook(fn) { hook = fn; }, validation(fn) { validation = fn; }, remove(fn) { remove = fn; }, finalize(fn) { finalize = fn; } };
}

test('runtime confirmation binds typed text, personal-data acknowledgement, explicit categories and the exact verified inventory id', async () => {
  const f = runtime(); const plan = await f.review.preview(); assert.equal(plan.verified, true); assert.equal(plan.files[0].hash.length, 64); assert.ok(Object.isFrozen(plan.files[0]));
  for (const patch of [{ id: 'stale' }, { confirmation: '' }, { acknowledged: false }, { categories: [] }, { categories: ['unknown'] }, { categories: ['papers', 'papers'] }]) {
    await assert.rejects(() => f.review.execute({ ...f.confirm(), ...patch }));
  }
  assert.deepEqual(f.actions, []); assert.equal(f.files.size, 4);
});

test('same-size and same-time content changes invalidate consent before any deletion and resume ordinary writes', async () => {
  const f = runtime(); await f.review.preview(); f.files.get('/papers/article/阅读笔记.md').hash = 'f'.repeat(64);
  await assert.rejects(() => f.review.execute(f.confirm()), /发生变化/);
  assert.equal(f.files.size, 4); assert.ok(f.actions.includes('resume')); assert.ok(!f.actions.includes('finalize')); assert.equal(f.review.partial, false);
});

test('fresh ownership or source protection failure refuses cleanup without touching even the first selected file', async () => {
  const f = runtime(); await f.review.preview(); f.validation(async () => { throw new Error('now an original PDF'); });
  await assert.rejects(() => f.review.execute(f.confirm()), /original PDF/); assert.equal(f.files.size, 4); assert.ok(f.actions.includes('resume'));
});

test('successful confirmed cleanup removes individual exact files, keeps ownership records until last, and uninstalls only after invalidation', async () => {
  const f = runtime(); await f.review.preview(); const result = await f.review.execute(f.confirm());
  assert.equal(result.complete, true); assert.equal(f.files.size, 0); assert.equal(result.kept[0].path, '/user/untouched');
  const removals = f.actions.filter(row => row.startsWith('remove:'));
  assert.ok(removals[0].endsWith('阅读笔记.md')); assert.ok(removals[1].endsWith('identity.json')); assert.ok(removals[2].endsWith('paper-folders.json')); assert.ok(removals[3].endsWith('settings.json'));
  assert.deepEqual(f.actions.slice(-2), ['invalidate', 'finalize']); assert.ok(!f.actions.includes('resume')); assert.equal(f.review.completed, true); assert.equal(f.events.at(-1).stage, 'complete');
});

test('unchecked categories are retained explicitly while only selected exact files are processed', async () => {
  const f = runtime(); await f.review.preview(); const result = await f.review.execute({ ...f.confirm(), categories: ['settings'] });
  assert.equal(f.files.size, 2); assert.ok(f.files.has('/papers/article/阅读笔记.md')); assert.equal(result.kept.filter(row => row.category === 'papers').length, 2); assert.ok(f.actions.includes('finalize'));
});

test('partial removal failure does not uninstall or resume writers; explicit retry handles only remaining paths', async () => {
  const f = runtime(); await f.review.preview(); let count = 0;
  f.remove(async path => { if (++count === 2) throw new Error('synthetic removal failure'); f.files.delete(path); });
  await assert.rejects(() => f.review.execute(f.confirm()), /synthetic/); assert.equal(f.review.partial, true); assert.equal(f.files.size, 3);
  assert.ok(!f.actions.includes('resume')); assert.ok(!f.actions.includes('finalize')); assert.equal(f.events.at(-1).partial, true);
  f.remove(async path => f.files.delete(path)); const result = await f.review.execute(f.confirm());
  assert.equal(result.complete, true); assert.equal(f.files.size, 0); assert.equal(f.actions.filter(row => row.endsWith('阅读笔记.md')).length, 1);
});

test('indeterminate removal outcome keeps the maintenance lock even if the first delete throws after taking effect', async () => {
  const f = runtime(); await f.review.preview(); f.remove(async path => { f.files.delete(path); throw new Error('after native operation'); });
  await assert.rejects(() => f.review.execute(f.confirm()), /after native/); assert.equal(f.review.partial, true); assert.ok(!f.actions.includes('resume')); assert.ok(!f.actions.includes('finalize'));
});

test('a recreated previously removed path cannot be skipped or deleted under old consent and is reconsidered only in a fresh preview', async () => {
  const f = runtime(); await f.review.preview(); let count = 0; const old = { ...f.files.get('/papers/article/阅读笔记.md') };
  f.remove(async path => { if (++count === 2) throw new Error('stop second file'); f.files.delete(path); });
  await assert.rejects(() => f.review.execute(f.confirm()), /stop second/);
  f.files.set('/papers/article/阅读笔记.md', { ...old, hash: 'f'.repeat(64) }); f.remove(async path => f.files.delete(path));
  await assert.rejects(() => f.review.execute(f.confirm()), /出现新文件/); assert.ok(f.files.has('/papers/article/阅读笔记.md'));
  await f.review.preview(); await f.review.execute(f.confirm()); assert.equal(f.files.size, 0);
});

test('a content change during cleanup stops before the next mutation and requires a refreshed consent', async () => {
  const f = runtime(); await f.review.preview(); let validations = 0;
  f.validation(async () => { if (++validations === 3) f.files.get('/papers/article/.paper-companion/identity.json').hash = 'e'.repeat(64); });
  await assert.rejects(() => f.review.execute(f.confirm()), /发生变化/); assert.equal(f.files.size, 3); assert.equal(f.review.partial, true); assert.ok(!f.actions.includes('finalize'));
  const oldID = f.review.plan.id; await f.review.preview(); assert.notEqual(f.review.plan.id, oldID);
  await assert.rejects(() => f.review.execute({ ...f.confirm(), id: oldID }), /核对/);
  f.validation(null); await f.review.execute(f.confirm()); assert.equal(f.files.size, 0);
});

test('missing previewed files are idempotent and native uninstall failure never reports complete', async () => {
  const f = runtime(); await f.review.preview(); f.files.delete('/papers/article/阅读笔记.md'); f.finalize(async () => { throw new Error('addon manager failure'); });
  await assert.rejects(() => f.review.execute(f.confirm()), /addon manager/); assert.equal(f.review.completed, false); assert.equal(f.events.at(-1).stage, 'error'); assert.equal(f.files.size, 0);
  f.finalize(null); await f.review.execute(f.confirm()); assert.equal(f.review.completed, true);
});

test('concurrent execution, cancellation and replacement preview are blocked while cleanup is in progress', async () => {
  const f = runtime(); await f.review.preview(); let release; const hold = new Promise(resolve => { release = resolve; }); f.io.quiesce = async () => { await hold; };
  const task = f.review.execute(f.confirm()); assert.equal(f.review.cancel(), false); await assert.rejects(() => f.review.preview(), /正在执行/); await assert.rejects(() => f.review.execute(f.confirm()), /正在执行/);
  release(); await task; assert.equal(f.review.completed, true);
});

test('preview refuses metadata drift during fingerprinting and observer errors cannot interrupt a confirmed operation', async () => {
  const f = runtime(); f.hook(async path => { f.files.get(path).modified++; }); await assert.rejects(() => f.review.preview(), /生成清单时发生变化/); assert.equal(f.review.plan, null);
  f.hook(null); await f.review.preview(); f.review.subscribe(() => { throw new Error('view disconnected'); }); await f.review.execute(f.confirm()); assert.equal(f.review.completed, true);
});

test('late older preview cannot overwrite newest inventory and invalid metadata never produces a usable plan', async () => {
  const f = fixture(); let release, count = 0; const hold = new Promise(resolve => { release = resolve; });
  const review = new PCUninstall({ inventory: async () => { if (++count === 1) await hold; return f.collect(); } });
  const old = review.preview(); const current = await review.preview(); release(); await assert.rejects(old, /更新/); assert.equal(review.plan, current);
  review.inventory = async () => ({ version: 1, files: [{ path: '/x', size: -1, modified: 12 }] }); await assert.rejects(() => review.preview(), /不完整/);
});
