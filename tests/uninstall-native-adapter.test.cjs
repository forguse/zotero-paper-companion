const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path').win32;
const PCore = require('../addon/content/core.js');
const crypto = require('node:crypto');

function fixture() {
  const files = new Map(), attrs = new Map(), attributeReads = [], contentReads = [], writes = [], revealed = [], queried = [], removed = [], observers = new Map();
  let opened = 0, closed = 0, installed = true, uninstall = async () => {};
  const normal = value => value.replace(/\//g, '\\').replace(/\\$/g, '').toLowerCase();
  const add = (name, value = '') => {
    files.set(normal(name), { name, text: value, type: 'regular', size: Buffer.byteLength(value), lastModified: 20 }); attrs.set(normal(name), 0x80);
    let parent = path.dirname(name);
    for (;;) { attrs.set(normal(parent), 0x10); if (path.dirname(parent) === parent) break; parent = path.dirname(parent); }
  };
  const ctypes = { winapi_abi: {}, uint32_t: {}, char16_t: { ptr: {} }, winLastError: 2,
    open: name => { assert.equal(name, 'kernel32.dll'); opened++; return { declare: (symbol, abi, result, parameter) => {
      assert.equal(symbol, 'GetFileAttributesW'); assert.equal(abi, ctypes.winapi_abi); assert.equal(result, ctypes.uint32_t); assert.equal(parameter, ctypes.char16_t.ptr);
      return name => { attributeReads.push(name); const result = attrs.get(normal(name)); ctypes.winLastError = result === undefined ? 2 : 0; return result === undefined ? 0xffffffff : result; };
    }, close: () => closed++ }; } };
  const AddonManager = { getAddonByID: async id => { assert.equal(id, 'paper-companion@local'); return installed ? { uninstall: async () => { await uninstall(); installed = false; } } : null; } };
  const scope = { PCore, PCInsights: { defaultPrompts: {} }, AbortController, pluginID: 'paper-companion@local',
    Zotero: { isWin: true, DataDirectory: { dir: 'D:\\data' }, DB: { columnQueryAsync: async query => { queried.push(query); return [1, 2]; } },
      Items: { getAsync: async ids => ids.map(id => ({ isFileAttachment: () => true, getFilePathAsync: async () => id === 1 ? 'D:\\papers\\article.pdf' : 'D:\\papers\\generated\\article.pdf' })) }, Reader: { unregisterEventListener() {} } },
    ChromeUtils: { importESModule: name => name.includes('AddonManager') ? { AddonManager } : ({ ctypes }) },
    Cc: { '@mozilla.org/file/local;1': { createInstance: () => ({ initWithPath(name) { this.path = name; }, reveal() { revealed.push(this.path); } }) } }, Ci: { nsIFile: {} },
    PathUtils: { join: path.join, parent: path.dirname, filename: path.basename },
    IOUtils: { exists: async name => attrs.has(normal(name)),
      computeHexDigest: async name => crypto.createHash('sha256').update(files.get(normal(name)).text).digest('hex'),
      remove: async (name, options) => { assert.equal(options.recursive, false); assert.equal(options.ignoreAbsent, false); assert(files.has(normal(name))); removed.push(name); files.delete(normal(name)); attrs.delete(normal(name)); },
      stat: async name => { const file = files.get(normal(name)); if (file) return file; if (attrs.get(normal(name)) & 0x10) return { type: 'directory', size: -1, lastModified: 20 }; const error = Error('missing'); error.name = 'NotFoundError'; throw error; },
      readUTF8: async name => { contentReads.push(name); return files.get(normal(name)).text; },
      writeUTF8: async (...args) => writes.push(args),
      getChildren: async dir => [...files.values()].filter(file => normal(path.dirname(file.name)) === normal(dir)).map(file => file.name) } };
  vm.createContext(scope);
  scope.Zotero.Notifier = { registerObserver: observer => { observers.set(1, observer); return 1; }, unregisterObserver: id => observers.delete(id) };
  for (const name of ['persistence.js','sessions.js','reading-scope.js','model-gateway.js','chat-service.js','uninstall-service.js','native.js']) vm.runInContext(fs.readFileSync(require.resolve('../addon/content/' + name), 'utf8'), scope);
  const api = scope.PaperCompanion; api.dir = 'D:\\profile\\paper-companion'; api.files = { locations: {} };
  api.insights = { validatePrompts: () => ({}), destroy() { this.destroyed = true; } }; api.meta = { hostID: 'synthetic', accounts: [], active: null };
  return { api, scope, add, attrs, files, ctypes, attributeReads, contentReads, writes, revealed, queried, normal, removed, observers,
    uninstall: fn => { uninstall = fn; }, installed: () => installed, counts: () => ({ opened, closed }) };
}

test('uninstall review is lazy and creates no filesystem or account work until explicitly previewed', () => {
  const s = fixture(), review = s.api.uninstallReview;
  assert.equal(review, s.api.uninstallReview); assert.equal(s.api._uninstallReview, review);
  assert.deepEqual(s.counts(), { opened: 0, closed: 0 }); assert.equal(s.queried.length, 0); assert.equal(s.writes.length, 0);
});

test('Windows review rejects reparse-point ancestors before asking about deeper paths', async () => {
  const s = fixture(); s.add('D:\\safe\\folder\\value.json'); s.attrs.set(s.normal('D:\\safe'), 0x410);
  const io = s.api.uninstallIO();
  assert.equal(await io.safePath('D:\\safe\\folder\\value.json'), false);
  assert.deepEqual(s.attributeReads, ['D:\\', 'D:\\safe']);
  assert.equal(s.contentReads.length, 0); assert.equal(s.writes.length, 0); io.close(); assert.deepEqual(s.counts(), { opened: 1, closed: 1 });
});

test('Windows review accepts explicit normal paths and absent leaves but rejects device, UNC, traversal and alternate streams', async () => {
  const s = fixture(); s.add('D:\\safe\\file.json'); const io = s.api.uninstallIO();
  assert.equal(await io.safePath('D:/safe/file.json'), true); assert.equal(await io.safePath('D:\\safe\\missing.json'), true);
  for (const name of ['relative\\file', '\\\\server\\share\\file', '\\\\?\\D:\\safe\\file', 'D:\\safe\\..\\file', 'D:\\safe\\file:stream', 'D:\\safe.\\file']) assert.equal(await io.safePath(name), false, name);
  io.close();
});

test('review protects all actual Zotero attachment paths without parsing PDF or decrypting credentials', async () => {
  const s = fixture(); s.add('D:\\profile\\paper-companion\\credentials.enc', 'synthetic encrypted blob');
  s.add('D:\\profile\\paper-companion\\settings.json', '{}');
  const record = { dir: 'D:\\papers\\generated', source: 'D:\\papers\\article.pdf', pdfName: 'article.pdf', reviewName: '重点再整理.md' };
  s.api.files.locations['1_ABCDEFGH'] = record;
  s.add('D:\\papers\\generated\\.paper-companion\\identity.json', JSON.stringify({ key: '1_ABCDEFGH', version: 1, source: record.source }));
  s.add('D:\\papers\\generated\\阅读笔记.md', 'synthetic notes'); s.add('D:\\papers\\generated\\article.pdf', 'synthetic PDF');
  const plan = await s.api.uninstallReview.preview();
  assert(plan.files.some(file => file.path.endsWith('credentials.enc'))); assert(plan.files.some(file => file.path.endsWith('阅读笔记.md')));
  assert(!plan.files.some(file => file.path.endsWith('article.pdf'))); assert(plan.kept.some(file => file.path.endsWith('article.pdf') && /受保护/.test(file.reason)));
  assert.deepEqual(s.contentReads, ['D:\\papers\\generated\\.paper-companion\\identity.json']);
  assert.equal(s.writes.length, 0); assert.equal(s.queried.length, 1); assert.equal(s.counts().opened, s.counts().closed);
});

test('attachment inventory failure closes its read-only attribute library and exposes no incomplete plan', async () => {
  const s = fixture(); s.scope.Zotero.DB.columnQueryAsync = async () => { throw Error('synthetic DB failure'); };
  await assert.rejects(s.api.uninstallReview.preview(), /DB failure/); assert.equal(s.api.uninstallReview.plan, null);
  assert.deepEqual(s.counts(), { opened: 1, closed: 1 }); assert.equal(s.writes.length, 0);
});

test('open-location accepts only a previously reviewed safe file and never launches file contents', async () => {
  const s = fixture(), file = 'D:\\profile\\paper-companion\\settings.json'; s.add(file, '{}');
  await assert.rejects(s.api.revealUninstallPath(file), /重新核对/); await s.api.uninstallReview.preview();
  await s.api.revealUninstallPath(file); assert.deepEqual(s.revealed, [file]);
  await assert.rejects(s.api.revealUninstallPath('D:\\unrelated.txt'), /重新核对/);
  s.attrs.set(s.normal('D:\\profile'), 0x410); await assert.rejects(s.api.revealUninstallPath(file), /已改变/);
  assert.equal(s.revealed.length, 1); assert.equal(s.writes.length, 0);
});

test('guide preferences begin empty, accept only two unique known entrances and never silently coerce invalid values', async () => {
  const s = fixture(); assert.equal(s.api.settings.actionGuidePins.length, 0); assert.equal(s.api.settings.actionGuideDismissed, false);
  s.api.refreshSelectionPopups = () => {}; s.api.writeJSON = async () => {};
  await s.api.saveSettings({ actionGuidePins: ['notes','notes','vocabulary'], actionGuideDismissed: true });
  assert.deepEqual([...s.api.settings.actionGuidePins], ['notes','vocabulary']); assert.equal(s.api.settings.actionGuideDismissed, true);
  for (const patch of [{ actionGuidePins: ['unknown'] }, { actionGuidePins: ['notes','vocabulary','practice'] }, { actionGuidePins: 'notes' }, { actionGuideDismissed: 'yes' }]) await assert.rejects(s.api.saveSettings(patch));
  assert.deepEqual([...s.api.settings.actionGuidePins], ['notes','vocabulary']);
});

const consent = plan => ({ id: plan.id, confirmation: '完全卸载', acknowledged: true, categories: plan.categories.map(row => row.id) });

test('confirmed cleanup drains prior work, removes exact files only, and uninstalls last without shutdown recreating data', async () => {
  const s = fixture(); s.add('D:\\profile\\paper-companion\\settings.json', '{}'); s.add('D:\\profile\\paper-companion\\credentials.enc', 'synthetic ciphertext'); s.add('D:\\profile\\paper-companion\\unrelated.txt', 'keep');
  const plan = await s.api.uninstallReview.preview(); let called = 0;
  s.uninstall(async () => { called++; assert.equal(s.removed.length, 2); assert.equal(s.api.maintenance, 'locked'); await s.api.shutdown(); });
  const result = await s.api.uninstallReview.execute(consent(plan));
  assert.equal(result.complete, true); assert.equal(called, 1); assert.equal(s.installed(), false);
  assert.equal(s.files.get(s.normal('D:\\profile\\paper-companion\\unrelated.txt')).text, 'keep'); assert.equal(s.writes.length, 0); assert.equal(s.observers.size, 0);
  assert(s.removed.every(name => /(?:settings\.json|credentials\.enc)$/.test(name))); assert.equal(s.api.noteWrites.size, 0);
});

test('maintenance gates new actions synchronously while an earlier file write drains, then blocks every later write', async () => {
  const s = fixture(); let release, started;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
  s.scope.IOUtils.writeUTF8 = async (name, text) => { started(); await gate; s.writes.push([name, text]); };
  const writing = s.api.writeText('D:\\earlier.txt', 'earlier'); await ready;
  const preparing = s.api.quiesceUninstall(); assert.equal(s.api.maintenance, 'draining');
  await assert.rejects(s.api.saveSettings({ language: 'English' }), /卸载前清理/); assert.throws(() => s.api.saveNote('A', 'new'), /卸载前清理/);
  release(); await writing; const resume = await preparing;
  assert.equal(s.api.maintenance, 'locked'); await assert.rejects(s.api.writeText('D:\\later.txt', 'later'), /暂停文件写入/);
  assert.equal(s.writes.length, 1); assert.equal(resume(), true); assert.equal(s.api.maintenance, null);
});

test('changed same-size files invalidate consent before deletion and safely resume normal use', async () => {
  const s = fixture(), file = 'D:\\profile\\paper-companion\\settings.json'; s.add(file, '{"a":1}');
  const plan = await s.api.uninstallReview.preview(); s.files.get(s.normal(file)).text = '{"b":2}';
  await assert.rejects(s.api.uninstallReview.execute(consent(plan)), /发生变化/);
  assert.equal(s.removed.length, 0); assert.equal(s.api.maintenance, null); assert.equal(s.installed(), true); assert.equal(s.observers.size, 0);
});

test('a newly recognized plugin file after preview is preserved and requires fresh consent', async () => {
  const s = fixture(); s.add('D:\\profile\\paper-companion\\settings.json', '{}'); const plan = await s.api.uninstallReview.preview();
  s.add('D:\\profile\\paper-companion\\accounts.json', '{}');
  await assert.rejects(s.api.uninstallReview.execute(consent(plan)), /清单外/);
  assert.equal(s.removed.length, 0); assert.equal(s.api.maintenance, null); assert.equal(s.installed(), true);
});

test('Zotero attachment changes during cleanup stop deletion before a formerly copied PDF can become an original attachment', async () => {
  const s = fixture(); s.add('D:\\profile\\paper-companion\\settings.json', '{}'); const plan = await s.api.uninstallReview.preview();
  const original = s.api.revalidateUninstall.bind(s.api); let calls = 0;
  s.api.revalidateUninstall = async (...args) => { if (++calls === 2) s.observers.get(1).notify(); return original(...args); };
  await assert.rejects(s.api.uninstallReview.execute(consent(plan)), /附件.*变化/);
  assert.equal(s.removed.length, 0); assert.equal(s.api.maintenance, null); assert.equal(s.installed(), true);
});

test('partial cleanup retains a write lock, supports a fresh remaining-file review, and never deletes unknown files', async () => {
  const s = fixture(); s.add('D:\\profile\\paper-companion\\accounts.json', '{}'); s.add('D:\\profile\\paper-companion\\settings.json', '{}'); s.add('D:\\profile\\paper-companion\\unknown.txt', 'untouched');
  const plan = await s.api.uninstallReview.preview(), remove = s.scope.IOUtils.remove; let calls = 0;
  s.scope.IOUtils.remove = async (...args) => { if (++calls === 2) throw Error('synthetic removal failure'); return remove(...args); };
  await assert.rejects(s.api.uninstallReview.execute(consent(plan)), /removal failure/);
  assert.equal(s.removed.length, 1); assert.equal(s.api.maintenance, 'locked'); assert.equal(s.api.resumeUninstall(), false); assert.equal(s.installed(), true);
  await assert.rejects(s.api.writeText('D:\\profile\\paper-companion\\accounts.json', 'recreated'), /暂停/);
  s.scope.IOUtils.remove = remove;
  const next = await s.api.uninstallReview.preview(); assert.equal(next.files.length, 1);
  const result = await s.api.uninstallReview.execute(consent(next)); assert.equal(result.complete, true); assert.equal(s.removed.length, 2);
  assert.equal(s.files.get(s.normal('D:\\profile\\paper-companion\\unknown.txt')).text, 'untouched'); assert.equal(s.writes.length, 0);
});

test('shutdown after partial cleanup skips pending autosave and cannot recreate removed files', async () => {
  const s = fixture(); s.add('D:\\profile\\paper-companion\\accounts.json', '{}'); s.add('D:\\profile\\paper-companion\\settings.json', '{}');
  const plan = await s.api.uninstallReview.preview(), remove = s.scope.IOUtils.remove; let calls = 0;
  s.scope.IOUtils.remove = async (...args) => { if (++calls === 2) throw Error('synthetic failure'); return remove(...args); };
  await assert.rejects(s.api.uninstallReview.execute(consent(plan)));
  let flushed = false; s.api.flushNotes = async () => { flushed = true; throw Error('must not save after cleanup'); };
  await s.api.shutdown(); assert.equal(flushed, false); assert.equal(s.writes.length, 0); assert.equal(s.observers.size, 0);
});

test('fresh consent after a partial failure rechecks changed Zotero attachment protection instead of permanently wedging recovery', async () => {
  const s = fixture(); s.add('D:\\profile\\paper-companion\\accounts.json', '{}'); s.add('D:\\profile\\paper-companion\\settings.json', '{}');
  const plan = await s.api.uninstallReview.preview(), remove = s.scope.IOUtils.remove; let calls = 0;
  s.scope.IOUtils.remove = async (...args) => { if (++calls === 2) throw Error('synthetic failure'); return remove(...args); };
  await assert.rejects(s.api.uninstallReview.execute(consent(plan)));
  s.observers.get(1).notify(); s.scope.IOUtils.remove = remove;
  const next = await s.api.uninstallReview.preview();
  assert.equal((await s.api.uninstallReview.execute(consent(next))).complete, true);
  assert.equal(s.removed.length, 2); assert.equal(s.queried.length >= 4, true);
});

test('independent vocabulary windows become inert during cleanup and restore their prior state before any mutation', async () => {
  const s = fixture(), node = { inert: false, isConnected: true, classList: { contains: () => false } };
  s.api.vocabularyWindow = { closed: false, document: { body: { children: [node] } } };
  const resume = await s.api.quiesceUninstall(); assert.equal(node.inert, true);
  assert.equal(resume(), true); assert.equal(node.inert, false);
});

test('older Zotero hashing fallback reads bounded one-MiB chunks instead of loading a whole PDF into memory', async () => {
  const s = fixture(), file = 'D:\\safe\\large.pdf', text = 'x'.repeat(2097152 + 17), reads = [];
  s.add(file, text); delete s.scope.IOUtils.computeHexDigest;
  s.scope.Ci.nsICryptoHash = {};
  s.scope.Cc['@mozilla.org/security/hash;1'] = { createInstance: () => {
    let digest;
    return { SHA256: 1, init: code => { assert.equal(code, 1); digest = crypto.createHash('sha256'); }, update: (bytes, length) => { assert.equal(bytes.length, length); digest.update(bytes); }, finish: base64 => { assert.equal(base64, false); return digest.digest('latin1'); } };
  } };
  s.scope.IOUtils.read = async (name, options) => { reads.push(options); return Buffer.from(s.files.get(s.normal(name)).text).subarray(options.offset, options.offset + options.maxBytes); };
  const result = await s.api.uninstallFingerprint(file);
  assert.equal(result.hash, crypto.createHash('sha256').update(text).digest('hex'));
  assert.equal(reads.length, 3); assert(reads.every(row => row.maxBytes <= 1048576)); assert.equal(s.writes.length, 0);
});
