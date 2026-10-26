/* SPDX-License-Identifier: MIT — per-paper PDF and Markdown folders. Never deletes files. */
var PCPaperFiles = class {
  constructor(api) { this.api = api; this.locations = {}; this.pending = new Map(); this.changing = new Set(); this.indexWrites = Promise.resolve(); }
  async init() {
    this.indexPath = PathUtils.join(this.api.dir, 'paper-folders.json');
    this.locations = await this.api.readJSON(this.indexPath, {});
  }
  static folderName(title) {
    let name = Array.from(String(title || '未命名论文').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()).slice(0, 100).join('').replace(/[. ]+$/g, '');
    if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + (name || '未命名论文');
    return name;
  }
  static initialNote(paper) { return `# ${String(paper.title || '未命名论文').replace(/[\r\n]+/g, ' ')}\n\n`; }
  paths(record) {
    const dir = record.dir, meta = PathUtils.join(dir, '.paper-companion');
    return { dir, pdf: PathUtils.join(dir, record.pdfName), note: PathUtils.join(dir, '阅读笔记.md'),
      summary: PathUtils.join(dir, '聊天重点.md'), review: PathUtils.join(dir, record.reviewName || '重点省察.md'),
      summaryData: PathUtils.join(meta, 'highlights.json'), reviewData: PathUtils.join(meta, 'review.json'),
      preread: PathUtils.join(dir, '论文预读.md'), prereadData: PathUtils.join(meta, 'preread.json'), prereadProgress: PathUtils.join(meta, 'preread-progress.json'),
      sourceText: PathUtils.join(dir, '论文原文.md'), readingData: PathUtils.join(meta, 'reading-index.json'),
      backups: PathUtils.join(dir, 'backups'), meta };
  }
  ensure(paper) {
    if (!paper?.key || paper.key === 'general') return Promise.reject(new Error('请先打开 PDF。'));
    if (this.pending.has(paper.key)) return this.pending.get(paper.key);
    const job = this.resolve(paper); this.pending.set(paper.key, job);
    const cleanup = () => { if (this.pending.get(paper.key) === job) this.pending.delete(paper.key); };
    job.then(cleanup, cleanup); return job;
  }
  async resolve(paper) {
    const record = this.locations[paper.key];
    if (record) {
      if (!await IOUtils.exists(record.dir)) throw new Error('本篇资料文件夹不存在，请恢复原位置或在设置中更改保存位置：' + record.dir);
      const owner = await this.api.readJSON(PathUtils.join(record.dir, '.paper-companion', 'identity.json'), null);
      if (owner?.key !== paper.key) throw new Error('资料文件夹标识不匹配，请在设置中选择新的存放位置。');
      return this.paths(record);
    }
    const source = await this.api.pdfSource(paper);
    return this.create(paper, PathUtils.parent(source), source, null);
  }
  async uniqueFolder(paper, parent) {
    const name = PCPaperFiles.folderName(paper.title);
    // Claim only a new directory. Existing folders and their contents remain untouched.
    for (let i = 0; i < 1000; i++) {
      const suffix = i === 0 ? '' : ` [${paper.key}${i === 1 ? '' : '-' + i}]`;
      const dir = PathUtils.join(parent, name + suffix);
      if (await IOUtils.exists(dir)) continue;
      try { await IOUtils.makeDirectory(dir, { ignoreExisting: false, permissions: 0o700 }); return dir; }
      catch (e) { if (!await IOUtils.exists(dir)) throw e; }
    }
    throw new Error('同名资料文件夹过多，请选择其他位置。');
  }
  async copyIfPresent(source, target) {
    if (source && await IOUtils.exists(source)) { await IOUtils.copy(source, target, { noOverwrite: true }); return true; }
    return false;
  }
  async create(paper, parent, source, previous) {
    if (!source || !await IOUtils.exists(source)) throw new Error('找不到本地 PDF，请先在 Zotero 下载或定位附件。');
    const dir = await this.uniqueFolder(paper, parent);
    const record = { dir, pdfName: PathUtils.filename(source), source, reviewName: '重点再整理.md' }, paths = this.paths(record);
    await IOUtils.makeDirectory(paths.meta, { permissions: 0o700 });
    await IOUtils.copy(source, paths.pdf, { noOverwrite: true });
    const legacy = previous || {
      note: PathUtils.join(this.api.notesDir, paper.key + '.md'),
      summary: PathUtils.join(this.api.insights.dir, paper.key + '.md'),
      summaryData: PathUtils.join(this.api.insights.dir, paper.key + '.json'),
      review: PathUtils.join(this.api.insights.dir, paper.key + '.review.md'),
      reviewData: PathUtils.join(this.api.insights.dir, paper.key + '.review.json'),
      backups: PathUtils.join(this.api.notesDir, 'backups')
    };
    for (const kind of ['note', 'summary', 'summaryData', 'review', 'reviewData', 'sourceText', 'readingData', 'preread', 'prereadData', 'prereadProgress']) await this.copyIfPresent(legacy[kind], paths[kind]);
    if (!await IOUtils.exists(paths.note)) await this.api.writeText(paths.note, PCPaperFiles.initialNote(paper));
    if (!await IOUtils.exists(paths.summary)) await this.api.writeText(paths.summary, this.api.insights.document(paper, await this.api.readJSON(paths.summaryData, { entries: [] })));
    if (!await IOUtils.exists(paths.review)) {
      const review = await this.api.readJSON(paths.reviewData, null);
      await this.api.writeText(paths.review, review?.text || `# ${paper.title} · 重点再整理\n\n先更新聊天重点，再点击「更新重点再整理」。\n`);
    }
    await IOUtils.makeDirectory(paths.backups, { permissions: 0o700 });
    if (await IOUtils.exists(legacy.backups)) {
      for (const file of await IOUtils.getChildren(legacy.backups)) {
        const name = PathUtils.filename(file);
        if ((previous || name.startsWith(paper.key + '-')) && name.endsWith('.md')) await IOUtils.copy(file, PathUtils.join(paths.backups, name), { noOverwrite: true });
      }
    }
    await this.api.writeJSON(PathUtils.join(paths.meta, 'identity.json'), { key: paper.key, source, version: 1 });
    // Commit the new location only after every copy succeeded. Old files remain available.
    const writeIndex = this.indexWrites.then(async () => {
      const updated = { ...this.locations, [paper.key]: record };
      await this.api.writeJSON(this.indexPath, updated); this.locations = updated;
    });
    this.indexWrites = writeIndex.catch(() => {}); await writeIndex;
    return paths;
  }
  async relocate(paper, parent) {
    // A saved but missing directory must never silently fall back to stale legacy notes.
    const existing = this.locations[paper.key];
    const previous = existing ? await this.ensure(paper) : null;
    const normalized = path => { const value = String(path).replace(/[\\/]+$/g, ''); return Zotero.isWin ? value.toLowerCase() : value; };
    if (previous && normalized(PathUtils.parent(previous.dir)) === normalized(parent)) return previous;
    const source = existing && await IOUtils.exists(previous.pdf) ? previous.pdf : await this.api.pdfSource(paper);
    const job = this.create(paper, parent, source, previous); this.pending.set(paper.key, job);
    try { return await job; } finally { if (this.pending.get(paper.key) === job) this.pending.delete(paper.key); }
  }
};
if (typeof module === 'object' && module.exports) module.exports = PCPaperFiles;
