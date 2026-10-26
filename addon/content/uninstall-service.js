/* SPDX-License-Identifier: MIT — explicit reviewed cleanup of identified plugin files. */
(function (root) {
'use strict';
const groups = Object.freeze({ settings: '设置与本机授权', usage: '用量记录', chat: '对话记录', vocabulary: '单词本与备份', papers: '论文笔记与整理', copies: '论文 PDF 副本' });
const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
const stamp = value => value && value.regular === true && Number.isSafeInteger(value.size) && value.size >= 0 && Number.isFinite(value.modified)
  ? { size: value.size, modified: value.modified } : null;
const signed = value => stamp(value) && typeof value.hash === 'string' && /^[a-f0-9]{64}$/i.test(value.hash) ? { ...stamp(value), hash: value.hash.toLowerCase() } : null;
const same = (a, b) => a && b && a.size === b.size && a.modified === b.modified && a.hash === b.hash;

const PCUninstallInventory = class {
  // This module cannot delete files. safePath rejects links in every existing
  // component; inspectFile reads metadata only, returns null when absent, and
  // never decrypts secrets or loads the potentially large PDF contents.
  static async collect(config, io) {
    const { join, parent, basename } = io, windows = !!config.windows;
    const normalize = path => {
      if (typeof path !== 'string' || !path || /[\x00-\x1f]/.test(path)) throw new Error('清理路径无效。');
      const value = path.replace(/\\/g, '/').replace(/\/+$/g, '');
      if (value.split('/').some(part => part === '.' || part === '..') || !(value.startsWith('/') || /^[a-z]:\//i.test(value))) throw new Error('清理路径必须为明确的绝对路径。');
      return windows ? value.toLowerCase() : value;
    };
    const files = [], kept = [], seen = new Set(), protectedPaths = new Set((config.protectedPaths || []).map(normalize));
    for (const paper of config.papers || []) if (paper?.source) protectedPaths.add(normalize(paper.source));
    const keep = (path, reason) => kept.push({ path: String(path), reason });
    const candidate = async (path, category, owner) => {
      let normalized;
      try { normalized = normalize(path); } catch (_) { keep(path, '路径不安全，保留'); return; }
      if (seen.has(normalized)) return; seen.add(normalized);
      if (protectedPaths.has(normalized)) { keep(path, '原始论文或受保护文件，保留'); return; }
      if (!await io.safePath(path)) { keep(path, '路径包含链接或无法安全确认，保留'); return; }
      const info = await io.inspectFile(path); if (info === null) return;
      const fingerprint = stamp(info);
      if (!fingerprint) { keep(path, '不是可核对的普通文件，保留'); return; }
      files.push({ path, category, label: groups[category], owner, ...fingerprint });
    };
    const children = async (dir, accept, category, owner) => {
      if (!await io.safePath(dir)) { keep(dir, '路径包含链接或无法安全确认，保留'); return; }
      const rows = await io.children(dir); if (!Array.isArray(rows) || rows.length > 100000) throw new Error('目录内容无法安全核对，请手动检查：' + dir);
      for (const path of rows) {
        if (normalize(parent(path)) !== normalize(dir)) { keep(path, '目录枚举越界，保留'); continue; }
        if (accept(basename(path))) await candidate(path, category, owner);
        else keep(path, '未确认由插件维护，保留');
      }
    };
    const privateRoot = async (path, callback) => {
      if (!path || basename(path) !== 'paper-companion') throw new Error('不能安全确认插件私有目录，清理清单已停止生成。');
      normalize(path);
      if (!await io.safePath(path)) { keep(path, '插件目录包含链接，保留'); return; }
      await callback();
    };
    const temporary = regex => name => regex.test(name.replace(/\.tmp$/, ''));
    await privateRoot(config.profileRoot, async () => {
      const known = /^(?:accounts\.json|credentials\.enc|settings\.json|paper-folders\.json|usage(?:-index)?\.json|usage-records-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.json)$/;
      await children(config.profileRoot, temporary(known), 'settings', '本机配置');
      for (const row of files) if (normalize(parent(row.path)) === normalize(config.profileRoot) && /^usage/.test(basename(row.path))) { row.category = 'usage'; row.label = groups.usage; }
    });
    await privateRoot(config.dataRoot, async () => {
      const key = '[a-zA-Z0-9_]{1,128}';
      await children(join(config.dataRoot, 'chats'), temporary(new RegExp('^' + key + '(?:-\\d+)?\\.json$')), 'chat', '本机对话');
      await children(join(config.dataRoot, 'notes'), temporary(new RegExp('^' + key + '\\.md$')), 'papers', '旧版笔记');
      await children(join(config.dataRoot, 'notes', 'backups'), temporary(new RegExp('^' + key + '-\\d+\\.md$')), 'papers', '旧版笔记备份');
      await children(join(config.dataRoot, 'highlights'), temporary(new RegExp('^' + key + '(?:\\.review)?\\.(?:json|md)$')), 'papers', '旧版重点文档');
    });
    if (config.vocabularyRoot) await children(config.vocabularyRoot, temporary(/^(?:vocabulary\.json|单词本\.md|单词本-(?:导入前|外部修改备份|词头更正前)-\d+-[a-f0-9]{8}\.(?:json|md))$/), 'vocabulary', '个人单词本');
    for (const paper of config.papers || []) {
      if (!/^[a-zA-Z0-9_]{1,128}$/.test(paper?.key) || !paper.dir || !paper.source) { keep(paper?.dir || '', '论文登记不完整，保留'); continue; }
      const identityPath = join(paper.dir, '.paper-companion', 'identity.json');
      if (!await io.safePath(identityPath)) { keep(paper.dir, '论文标识路径不安全，保留'); continue; }
      let identity;
      try { identity = await io.readJSON(identityPath); } catch (_) { keep(paper.dir, '论文标识无法读取，保留'); continue; }
      if (!identity || identity.version !== 1 || identity.key !== paper.key || typeof identity.source !== 'string' || normalize(identity.source) !== normalize(paper.source)) { keep(paper.dir, '论文标识与登记不一致，保留'); continue; }
      if (normalize(paper.dir) === normalize(parent(paper.source)) || protectedPaths.has(normalize(paper.dir))) { keep(paper.dir, '论文目录与原始附件位置冲突，保留'); continue; }
      for (const name of ['阅读笔记.md', '聊天重点.md', '重点省察.md', '重点再整理.md', '论文预读.md', '论文原文.md']) {
        await candidate(join(paper.dir, name), 'papers', paper.key); await candidate(join(paper.dir, name + '.tmp'), 'papers', paper.key);
      }
      for (const name of ['identity.json', 'highlights.json', 'review.json', 'preread.json', 'preread-progress.json', 'reading-index.json']) {
        await candidate(join(paper.dir, '.paper-companion', name), 'papers', paper.key);
        await candidate(join(paper.dir, '.paper-companion', name + '.tmp'), 'papers', paper.key);
      }
      await children(join(paper.dir, 'backups'), temporary(new RegExp('^(?:' + paper.key + '-\\d+|阅读笔记-外部修改-\\d+-[a-f0-9]{8})\\.md$')), 'papers', paper.key);
      const pdfName = paper.pdfName;
      // PathUtils.filename on Gecko requires an absolute path; pdfName is a
      // leaf name, so validate it directly before joining the owned directory.
      if (typeof pdfName === 'string' && !/[\\/\x00-\x1f:]/.test(pdfName) && /\.pdf$/i.test(pdfName)) await candidate(join(paper.dir, pdfName), 'copies', paper.key);
      else if (pdfName) keep(paper.dir, 'PDF 副本名称无效，保留');
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return freeze({ version: 1, files, kept, bytes: files.reduce((sum, row) => sum + row.size, 0), categories: Object.entries(groups).map(([id, label]) => ({ id, label, count: files.filter(f => f.category === id).length })),
      limitations: ['只列出当前配置中已登记、可核对归属的文件；旧位置、手动导出及其他配置需自行检查。', '原始 PDF、Zotero 文献条目、未知文件和目录始终保留。', '本机授权与云端 API Key 不同；共享网页和外部浏览器的登录状态需在网页退出。'] });
  }
};
const PCUninstall = class {
  // These runtime ports are used only after explicit in-product confirmation.
  // They never remove a directory or delete the add-on package directly.
  constructor(io) {
    this.io = io; this.inventory = io.inventory; this.plan = null; this.ticket = 0; this.running = false; this.partial = false; this.completed = false;
    this.removed = new Set(); this.listeners = new Set(); this.state = { stage: 'idle', removed: 0, total: 0 };
  }
  get available() { return ['inventory', 'fingerprint', 'inspectFile', 'revalidate', 'quiesce', 'removeFile', 'invalidate', 'finalize'].every(key => typeof this.io[key] === 'function'); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(stage, detail = {}) {
    this.state = freeze({ stage, removed: this.removed.size, total: this.plan?.files.length || 0, ...detail });
    for (const listener of this.listeners) { try { listener(this.state); } catch (_) {} }
    try { this.io.progress?.(this.state); } catch (_) {}
  }
  async preview() {
    if (this.running || this.completed) throw new Error('完全卸载正在执行或已经完成。');
    const ticket = ++this.ticket, inventory = await this.inventory();
    if (ticket !== this.ticket) throw new Error('清单已被更新，请重新核对。');
    if (!inventory || inventory.version !== 1 || !Array.isArray(inventory.files) || inventory.files.some(f => !stamp({ ...f, regular: true }))) throw new Error('清理清单不完整。');
    const files = [], paths = new Set();
    for (const file of inventory.files) {
      if (!file.path || !Object.hasOwn(groups, file.category) || paths.has(file.path)) throw new Error('清理清单路径或分类无效。'); paths.add(file.path);
      let fingerprint;
      if (this.available) {
        fingerprint = signed(await this.io.fingerprint(file.path));
        if (!fingerprint || fingerprint.size !== file.size || fingerprint.modified !== file.modified) throw new Error('文件在生成清单时发生变化，请重新核对：' + file.path);
      }
      if (ticket !== this.ticket) throw new Error('清单已被更新，请重新核对。');
      files.push({ ...file, ...fingerprint });
    }
    // A file externally recreated after a partial attempt needs fresh consent
    // and must not inherit an earlier path's "already removed" marker.
    for (const file of files) this.removed.delete(file.path);
    this.plan = freeze({ ...inventory, files, verified: this.available, id: 'uninstall-review-' + ticket });
    this.emit('preview'); return this.plan;
  }
  cancel() { if (this.running) return false; this.ticket++; this.plan = null; this.emit(this.partial ? 'paused' : 'idle'); return true; }
  async execute({ id, confirmation, acknowledged, categories } = {}) {
    if (this.running || this.completed) throw new Error('完全卸载正在执行或已经完成。');
    if (!this.available || !this.plan?.verified) throw new Error('自动清理当前不可用，请先核对清单。');
    if (id !== this.plan.id || confirmation !== '完全卸载' || acknowledged !== true) throw new Error('请核对清单、确认删除个人资料，并输入「完全卸载」。');
    const categoryIDs = new Set(this.plan.categories.map(row => row.id));
    if (!Array.isArray(categories) || categories.some(value => !categoryIDs.has(value)) || new Set(categories).size !== categories.length || this.plan.files.length && !categories.length) throw new Error('请明确选择清理的文件类别。');
    const plan = this.plan, selected = new Set(categories), kept = plan.files.filter(row => !selected.has(row.category));
    const priority = path => /[\\/]paper-folders\.json(?:\.tmp)?$/.test(path) ? 3 : /[\\/]settings\.json(?:\.tmp)?$/.test(path) ? 4 : /[\\/]identity\.json(?:\.tmp)?$/.test(path) ? 2 : 0;
    const files = plan.files.filter(row => selected.has(row.category)).sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
    this.running = true; let resume;
    const context = () => ({ removed: [...this.removed], categories: [...selected] });
    try {
      this.emit('preparing', { total: files.length }); resume = await this.io.quiesce();
      await this.io.revalidate(plan, context());
      // Full preflight before the first mutation. A changed file invalidates
      // consent; it is never silently accepted merely because its name matches.
      for (const row of files) {
        const current = await this.io.fingerprint(row.path);
        if (this.removed.has(row.path)) {
          if (current !== null) { const error = new Error('已清理的位置出现新文件，请重新核对：' + row.path); error.code = 'UNINSTALL_CHANGED'; throw error; }
          continue;
        }
        if (current !== null && !same(row, signed(current))) { const error = new Error('文件在预览后发生变化，请重新核对：' + row.path); error.code = 'UNINSTALL_CHANGED'; throw error; }
      }
      this.emit('removing', { total: files.length });
      for (const row of files) {
        if (this.removed.has(row.path)) continue;
        await this.io.revalidate(plan, context());
        const current = await this.io.fingerprint(row.path);
        if (current !== null) {
          if (!same(row, signed(current))) { const error = new Error('文件在清理过程中发生变化，已停止：' + row.path); error.code = 'UNINSTALL_CHANGED'; throw error; }
          // A failing native deletion may have completed before reporting an
          // error. Conservatively retain the write lock once it was attempted.
          this.partial = true; await this.io.removeFile(row.path, row);
          if (await this.io.inspectFile(row.path) !== null) throw new Error('文件未能清理，插件仍保留：' + row.path);
        }
        this.removed.add(row.path); this.emit('removing', { total: files.length, path: row.path });
      }
      await this.io.revalidate(plan, context());
      for (const row of files) if (await this.io.inspectFile(row.path) !== null) {
        const error = new Error('清理位置又出现文件，未移除插件，请重新核对：' + row.path); error.code = 'UNINSTALL_CHANGED'; throw error;
      }
      this.emit('finalizing', { total: files.length }); await this.io.invalidate(); await this.io.finalize();
      this.completed = true; this.partial = false; this.plan = null; this.emit('complete', { total: files.length, kept: kept.length + (plan.kept?.length || 0) });
      return freeze({ complete: true, removed: this.removed.size, kept: [...kept, ...(plan.kept || [])] });
    } catch (error) {
      if (!this.partial && typeof resume === 'function') { try { await resume(); } catch (_) {} }
      this.emit('error', { message: error.message || String(error), partial: this.partial, changed: error.code === 'UNINSTALL_CHANGED' });
      error.partial = this.partial; error.removed = this.removed.size; throw error;
    } finally { this.running = false; }
  }
  text() {
    if (!this.plan) return '';
    return ['论文伴读卸载前清理清单（执行前须确认）', ...this.plan.limitations, '', ...this.plan.files.map(row => '[' + row.label + '] ' + row.path), '', '保留项目：', ...this.plan.kept.map(row => row.path + ' — ' + row.reason)].join('\n');
  }
};
root.PCUninstall = PCUninstall; root.PCUninstallInventory = PCUninstallInventory;
if (typeof module === 'object' && module.exports) module.exports = { PCUninstall, PCUninstallInventory };
})(this);
