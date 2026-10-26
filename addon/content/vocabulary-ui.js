/* SPDX-License-Identifier: MIT — shared local book and review UI. */
var PCVocabularyUI = class {
  constructor({ api, container, standalone = false, inline = false, review = false, getPaper = null, paper = null }) {
    this.api = api; this.book = api.vocabulary; this.root = container; this.doc = container.ownerDocument;
    this.win = this.doc.defaultView; this.standalone = standalone; this.inline = inline; this.mode = review ? 'review' : 'list'; this.page = 0; this.drafts = new Map();
    this.presentation = 'minimal'; this.study = 'display'; this.reviewMode = 'test'; this.reviewQueue = 'new'; this.reviewCutoff = Date.now(); this.reviewSkipped = new Set();
    this.view='cards';this.contextSerial=0;this.expanded = new Set(); this.collapsed = new Set(); this.answers = new Set();
    this.paper=paper;this.getPaper=getPaper;this.paperRevision=0;
    this.build();
    // Match the search field to the actual content scrollport. The stable gutter
    // keeps every disclosure arrow in place when contexts create a scrollbar.
    this.syncGutter=()=>{const width=Math.max(0,this.content.offsetWidth-this.content.clientWidth);if(width!==this.scrollbarWidth){this.scrollbarWidth=width;this.root.style.setProperty('--vocab-scrollbar',width+'px');}};
    this.resizeObserver=new this.win.ResizeObserver(this.syncGutter);this.resizeObserver.observe(this.content);this.syncGutter();
    this.onKey = e => {
      if (e.key !== 'Escape' || !this.standalone) return;
      e.preventDefault();
      if (this.editing) { this.editing = null; this.render(); this.all.focus({preventScroll:true}); }
      else if(this.selectedKey)this.back();else this.win.close();
    };
    this.render();
    this.win.addEventListener('keydown', this.onKey);
    this.unsubscribe = api.subscribe(e => { if (['vocabulary','settings'].includes(e.type)) this.render(); });
    this.onFocus=()=>this.refreshPaper();
    if(this.standalone)this.win.addEventListener('focus',this.onFocus);
    this.refreshPaper();
  }
  el(tag, cls, text) { const node = this.doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  revealWithin(node, scroller) {
    const item=node.getBoundingClientRect(),box=scroller.getBoundingClientRect();
    if(item.top<box.top||item.height>scroller.clientHeight)scroller.scrollTop+=item.top-box.top;
    else if(item.bottom>box.bottom)scroller.scrollTop+=item.bottom-box.bottom;
  }
  button(label, fn, parent, cls = '') {
    const b = this.el('button', cls, label); b.type = 'button';PCUI.action(b,label);
    b.addEventListener('click', () => this.run(async () => { b.disabled = true; try { await fn(); } finally { if (b.isConnected) b.disabled = false; } })); parent.append(b); return b;
  }
  async run(fn) { try { await fn(); } catch (e) { this.status.textContent = e.message; this.status.classList.add('error'); } }
  currentStudy() { return this.mode === 'review' ? this.reviewMode === 'test' ? 'recall' : 'display' : this.study; }
  setReviewQueue(value) {
    this.reviewQueue = value; this.batchEnd = this.book.data.nextSequence - 1; this.reviewCutoff = Date.now();
    this.reviewSkipped.clear(); this.answers.clear(); this.render(); this.content.scrollTop = 0;
  }
  build() {
    this.root.classList.add('vocab-root');
    const heading = this.el('div', 'vocab-heading'), title = this.el('strong', '', '我的单词本'); title.id = 'vocabulary-title';
    const brand = this.el('div', 'vocab-brand');
    if (this.standalone) brand.title='Paper Companion · 个人词库';
    brand.append(title); heading.append(brand);
    const actions = this.el('div', 'vocab-actions');
    this.undoAdd=this.button('撤销最近加入',async()=>{await this.book.removeEncounter(this.book.lastAddedID);this.render();},actions,'small');this.undoAdd.dataset.action='undo-add';
    if (!this.standalone) { const popout = this.button('弹出单词本 ↗', () => this.api.openVocabulary({ review: this.mode === 'review', paper: this.paper }), actions); popout.dataset.action = 'vocabulary-popout'; popout.title = '打开可调整大小的完整浮窗';PCUI.label(popout,'弹出单词本','popout'); }
    else { const version = this.el('span', 'vocab-version', 'v' + this.api.publicState().version); actions.append(version); }
    if (!this.inline) { this.close = this.button('×', () => this.standalone ? this.win.close() : this.root.close(), actions, 'icon-button'); this.close.setAttribute('aria-label', '关闭单词本'); }
    heading.append(actions); this.root.append(heading);
    const overview=this.el('div','vocab-overview');
    this.summary = this.el('p', 'vocab-summary');overview.append(this.summary);
    this.scope = this.el('p', 'vocab-scope');this.scope.setAttribute('role','status');overview.append(this.scope);this.root.append(overview);
    const tabs = this.el('div', 'vocab-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '单词本视图');
    this.all = this.button('本章单词', () => {this.view='cards';this.page=0;this.open(false);}, tabs);this.all.title='只看当前论文中加入的词；个人词库仍跨论文共用';this.rows=this.button('所有单词',()=>{this.view='rows';this.page=0;this.open(false);},tabs);this.rows.title='个人完整词库，按字母排列，可搜索单词、释义和出处'; this.review = this.button('继续复习', () => this.open(true), tabs);this.review.title='跨论文按新增遇词从上次位置继续；不代表已掌握，返回列表可再次自测';
    const tabButtons=[this.all,this.rows,this.review];tabButtons.forEach((b, i) => { b.setAttribute('role', 'tab'); b.id = 'vocab-tab-' + i; b.setAttribute('aria-controls', 'vocab-content'); b.addEventListener('keydown', e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:-1)+3)%3;tabButtons[next].click();tabButtons[next].focus({preventScroll:true}); } }); });
    this.root.append(tabs);
    this.controls = this.el('div', 'vocab-controls');
    const group = (label, pairs) => {
      const box = this.el('div', 'vocab-control-group'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', label);
      for (const [name, value, text] of pairs) {
        const button = this.button(text, () => {
          this.editing = null; // Switching study modes leaves manual drafts saved in memory, never exposed behind a cover.
          if (name === 'study') { this.study = value; this.answers.clear(); }
          else { this.presentation = value; this.expanded.clear(); this.collapsed.clear(); }
          this.render(); this.content.scrollTop = 0;
        }, box); button.dataset.action = name + '-' + value;
      }
      this.controls.append(box);
    };
    group('释义显示方式', [['study','display','展示模式'],['study','recall','背诵模式']]);
    group('详情展开程度', [['presentation','minimal','极简'],['presentation','full','完整']]); this.root.append(this.controls);
    this.modeHint = this.el('p', 'vocab-mode-hint');this.modeHint.id='vocab-mode-hint';this.controls.setAttribute('aria-describedby',this.modeHint.id); this.modeHint.setAttribute('role', 'status'); this.root.append(this.modeHint);
    this.reviewControls = this.el('div', 'vocab-review-controls'); this.reviewControls.hidden = this.mode !== 'review';
    const queues = this.el('div', 'vocab-control-group'); queues.setAttribute('role','group'); queues.setAttribute('aria-label','复习队列');
    this.reviewNew = this.button('新增遇词', () => this.setReviewQueue('new'), queues); this.reviewNew.dataset.action='review-queue-new';
    this.reviewDue = this.button('到期复习', () => this.setReviewQueue('due'), queues); this.reviewDue.dataset.action='review-queue-due';
    const modes = this.el('div','vocab-control-group'); modes.setAttribute('role','group'); modes.setAttribute('aria-label','复习方式');
    for(const [value,label]of [['test','自测'],['browse','浏览']]) {
      const button=this.button(label,()=>{this.reviewMode=value;this.answers.clear();this.render();},modes);button.dataset.action='review-mode-'+value;
    }
    this.reviewControls.append(queues,modes); this.root.append(this.reviewControls);
    this.searchRow = this.el('label', 'vocab-search'); this.searchRow.append(this.el('span', '', '搜索单词、释义或出处'));
    this.search = this.el('input'); this.search.type = 'search'; this.search.placeholder = '输入单词 / 释义 / 论文标题…';
    this.search.setAttribute('aria-label', '搜索单词、释义或出处'); this.search.addEventListener('input', () => { this.page = 0; this.renderContent(); }); this.searchRow.append(this.search); this.root.append(this.searchRow);
    this.content = this.el('div', 'vocab-content'); this.content.id = 'vocab-content'; this.content.setAttribute('role', 'tabpanel'); this.root.append(this.content);
    this.status = this.el('p', 'vocab-status'); this.status.setAttribute('role', 'status'); this.root.append(this.status);
    const footer = this.el('details', 'vocab-files'), summary = this.el('summary', '', '文件与保存位置'); footer.append(summary);
    const fileActions = this.el('div', 'vocab-actions');
    this.button('打开 .md', () => this.book.openFile(), fileActions); this.button('打开文件夹', () => this.book.openFile(true), fileActions);
    this.button('更改位置…', () => this.api.chooseVocabularyFolder(), fileActions); footer.append(fileActions);
    const backup=this.button('完整备份 .json',async()=>{const path=await this.api.vocabularyBackupFile();if(path){this.status.textContent='完整备份已保存，可用来迁移或恢复。';}},fileActions);backup.dataset.action='vocabulary-backup';
    this.button('导入 / 恢复备份',async()=>{const plan=await this.api.vocabularyBackupFile(true);if(plan)this.importPreview(plan);},fileActions).dataset.action='vocabulary-import';
    this.importArea=this.el('section','vocab-import-preview');this.importArea.hidden=true;footer.append(this.importArea);
    this.path = this.el('p', 'vocab-path'); footer.append(this.path, this.el('p','vocab-help','单词本跨论文共用、自动保存。Markdown 是可阅读的副本，主数据另存为 JSON；请在插件内改释义，外部修改会在同步前备份。复习按新增遇词从上次位置继续，七天提醒不是记忆掌握计划。'));
    this.root.append(footer);PCUI.disclosures(this.root);
    this.trash=this.el('details','vocab-removed');this.trashTitle=this.el('summary');this.trashBody=this.el('div','vocab-removed-body');this.trash.append(this.trashTitle,this.trashBody);footer.append(this.trash);
    this.trashLimit=50;this.trash.addEventListener('toggle',()=>{if(this.trash.open)this.renderRemoved();});
  }
  renderRemoved() {
    this.trashBody.replaceChildren();const rows=this.book.removed();
    for(const c of rows.slice(0,this.trashLimit)){
      const line=this.el('div','vocab-removed-row');line.append(this.el('span','',c.word+' · '+c.title+' · '+new Date(c.removedAt).toLocaleDateString()));
      this.button('恢复',async()=>{await this.book.restoreEncounter(c.id);this.render();},line);this.trashBody.append(line);
    }
    if(rows.length>this.trashLimit)this.button('再显示50条',()=>{this.trashLimit+=50;this.renderRemoved();},this.trashBody);
  }
  importPreview(plan) {
    const area=this.importArea;area.replaceChildren();area.hidden=false;
    area.append(this.el('h3','','核对备份内容'),this.el('p','vocab-help',(plan.filename||'JSON 备份')+' · '+plan.words+' 个词 / '+plan.records+' 次遇词'),this.el('p','vocab-help','合并将新增 '+plan.additions+' 条，跳过 '+plan.duplicates+' 条重复；'+plan.conflicts+' 条同 ID 冲突保留当前记录。当前释义不会被合并覆盖。'));
    for(const sample of plan.samples)area.append(this.el('p','vocab-import-sample',sample.word+' · '+(sample.meaning||'释义待补全').slice(0,180)+' · '+sample.title.slice(0,180)));
    const label=this.el('label','','导入方式'),mode=this.el('select');mode.setAttribute('aria-label','词库导入方式');for(const [value,text]of [['merge','合并到当前词库'],['restore','恢复为此备份（替换当前词库）']]){const option=this.el('option','',text);option.value=value;mode.append(option);}label.append(mode);area.append(label);
    const hint=this.el('p','vocab-help','合并保留当前复习位置，新导入的遇词进入待复习。两种方式都会先完整备份当前主数据，不调用模型。');area.append(hint);const actions=this.el('div','vocab-actions');
    const apply=this.button('备份当前词库并合并',async()=>{await this.book.importBackup(plan,mode.value);area.hidden=true;this.render();this.search.focus({preventScroll:true});},actions,'primary');apply.dataset.action='vocabulary-import-apply';
    mode.addEventListener('change',()=>{apply.textContent=mode.value==='restore'?'备份当前词库并恢复':'备份当前词库并合并';hint.textContent=mode.value==='restore'?'当前内容会替换为备份中的词条和复习位置；导入前的主数据另存为 JSON，仍可恢复。':'合并保留当前复习位置，新导入的遇词进入待复习。冲突保留当前记录；导入前完整备份，不调用模型。';});
    this.button('取消',()=>{area.hidden=true;this.root.querySelector('[data-action=vocabulary-import]')?.focus({preventScroll:true});},actions);area.append(actions);this.revealWithin(mode,area.closest('.vocab-files'));mode.focus({preventScroll:true});
  }
  async refreshPaper(paper) {
    if(arguments.length===0&&!this.getPaper)return;
    const revision=++this.paperRevision;
    try { paper=await (arguments.length ? paper : this.getPaper()); }
    catch (_) { paper=null; }
    if(this.destroyed||revision!==this.paperRevision)return;
    const next=paper?.key?paper:null,changed=next?.key!==this.paper?.key,titleChanged=next?.title!==this.paper?.title;
    this.paper=next;
    if(changed&&this.mode==='list'&&this.view==='cards'&&!this.selectedKey&&!this.editing){
      this.page=0;this.expanded.clear();this.collapsed.clear();this.content.scrollTop=0;
    }
    if(changed||titleChanged)this.render();
  }
  open(review = false) {
    this.editing = null;this.selectedKey=null;
    this.mode = review ? 'review' : 'list';
    if (review) { this.batchEnd = this.book.data.nextSequence - 1; this.reviewMode = 'test'; this.reviewQueue = 'new'; this.reviewCutoff = Date.now(); this.reviewSkipped.clear(); this.answers.clear(); }
    if (!this.standalone && !this.inline && !this.root.open) this.root.showModal();
    this.render();
    this.refreshPaper();
    if (review) this.review.focus({preventScroll:true}); else this.search.focus({preventScroll:true});
  }
  render() {
    const stats = this.book.stats();
    this.undoAdd.disabled=!this.book.lastAddedID||!!this.book.find(this.book.data,this.book.lastAddedID).encounter.removedAt;
    const removed=this.book.removed();PCUI.summary(this.trashTitle,'已移除记录 · '+removed.length+'（可恢复）');this.trash.hidden=!removed.length;if(this.trash.open)this.renderRemoved();
    this.summary.textContent = `个人词库 · ${stats.words} 个单词 · ${stats.encounters} 次遇词 · ${stats.pending} 条待复习`;
    this.scope.hidden=this.mode==='review'||this.view==='rows'||!!this.selectedKey;
    const chapter=this.paper?this.book.paperCatalog(this.paper.key):[];
    this.scope.textContent=this.paper?`${chapter.length} 个本章单词 · ${this.paper.title}`:'本章单词跟随当前打开的论文';this.scope.title=this.scope.textContent;
    this.path.textContent = this.book.markdownPath;
    for (const [b, active] of [[this.all, this.mode === 'list'&&this.view==='cards'],[this.rows,this.mode==='list'&&this.view==='rows'], [this.review, this.mode === 'review']]) { b.setAttribute('aria-selected', String(active)); b.classList.toggle('active', active); b.tabIndex = active ? 0 : -1; }
    this.content.setAttribute('aria-labelledby', this.mode === 'review' ? this.review.id : this.view==='rows'?this.rows.id:this.all.id);
    this.searchRow.hidden = this.mode === 'review'||!!this.selectedKey;
    this.root.dataset.study = this.currentStudy(); this.root.dataset.presentation = this.presentation;
    this.controls.hidden = this.mode === 'review'; this.reviewControls.hidden = this.mode !== 'review';
    this.reviewDue.textContent = '到期复习 · ' + this.book.due().length;
    this.reviewNew.setAttribute('aria-pressed',String(this.reviewQueue==='new'));this.reviewDue.setAttribute('aria-pressed',String(this.reviewQueue==='due'));
    for(const button of this.reviewControls.querySelectorAll('[data-action^="review-mode-"]'))button.setAttribute('aria-pressed',String(button.dataset.action==='review-mode-'+this.reviewMode));
    for (const b of this.controls.querySelectorAll('button')) {
      const [type, value] = b.dataset.action.split('-'); b.setAttribute('aria-pressed', String((type === 'study' ? this.study : this.presentation) === value));
      b.disabled = type === 'presentation' && this.mode === 'review';
      b.title = b.disabled ? '顺序复习每次显示一条；回到单词列表可切换详情布局' : '';
    }
    this.modeHint.textContent = this.mode==='review' ? (this.reviewMode==='test'?'先回想，再揭示和反馈；仅本地安排下次复习，不调用模型。':'浏览直接显示答案，不记录掌握反馈。')
      : this.study === 'recall' ? '先回想，再点击显示中文；每条独立揭示。' : this.view==='rows'?'所有单词按字母排列，可搜索或进入详情。':'本章单词只显示当前论文的遇词与语境；次数按个人词库累计。';
    this.controls.title=this.modeHint.textContent;
    this.status.classList.remove('error'); this.status.textContent = this.book.problem || this.book.notice || (this.book.pendingContext?'等待补划「'+this.book.pendingContext.word+'」的原句：请回到原论文划句，或在小提醒切换自动补采。':'');
    if (this.book.problem) this.status.classList.add('error');
    // Keep form focus, selection and unsaved text through background completions.
    if (!this.editing) this.renderContent();
  }
  renderContent() {
    if (this.editing) return;
    const scroll = this.content.scrollTop;
    this.content.replaceChildren();
    this.content.classList.remove('vocab-grid','vocab-rows');
    if (this.book.problem) { this.content.append(this.el('p', 'vocab-empty', this.book.problem)); return; }
    if (this.mode === 'review') return this.renderReview();
    if(this.selectedKey)return this.renderWord();
    const query = this.search.value.trim().toLocaleLowerCase(),entries=this.view==='rows'?this.book.catalog(query,true):this.book.paperCatalog(this.paper?.key,query),size=this.view==='rows'?100:60;
    const pages = Math.max(1, Math.ceil(entries.length / size)); this.page = Math.min(this.page, pages - 1);
    this.content.classList.add(this.view==='cards'?'vocab-grid':'vocab-rows');
    if (!entries.length) {
      const missingPaper=this.view==='cards'&&!this.paper;
      const message=missingPaper?'还没有选择论文。打开一篇 PDF 后，这里会显示在这篇论文中加入的单词。':query?'没有匹配的单词或出处。':this.view==='cards'?'这篇论文还没有收录单词。在 PDF 中划选单词，点击「加入单词本」。':'个人词库还没有单词。在 PDF 中划选单词，点击「加入单词本」。';
      const empty=this.el('div','vocab-empty');empty.append(this.el('p','',message));
      if(this.view==='cards')this.button('查看所有单词',()=>{this.view='rows';this.page=0;this.search.value='';this.open(false);},empty);
      this.content.append(empty);
    }
    for (const e of entries.slice(this.page * size, this.page * size + size)) {
      this.content.append(this.card(e));
    }
    if (entries.length > size) {
      const pager = this.el('div', 'vocab-actions vocab-pager'); const prev = this.button('上一页', () => { this.page--; this.renderContent(); this.content.scrollTop = 0; }, pager); prev.disabled = this.page === 0;
      pager.append(this.el('span', '', `${this.page + 1} / ${pages}`)); const next = this.button('下一页', () => { this.page++; this.renderContent(); this.content.scrollTop = 0; }, pager); next.disabled = this.page >= pages - 1; this.content.append(pager);
    }
    this.content.scrollTop = scroll;
  }
  common(e) { return e.defaultMeaning || e.encounters.find(c=>c.meaning)?.meaning || '释义待补全'; }
  commonAnswer(e) { return this.answer({id:'entry:'+e.key,meaning:this.common(e)},'summary'); }
  card(e) {
    const card=this.el('article','vocab-entry vocab-card');card.dataset.key=e.key;
    const recent=e.encounters.at(-1);card.dataset.paper=recent.paperKey;card.style.borderLeftColor=this.book.colorFor(recent.paperKey);card.title='色标代表最近遇到的论文：'+recent.title;
    const main=this.el('div','vocab-card-main');card.append(main);
    const open=this.button('',()=>this.showWord(e.key),main,'vocab-card-open');open.dataset.key=e.key;open.setAttribute('aria-label','查看详情：'+e.word);open.title=e.word+' · 进入单词详情';open.append(this.el('strong','vocab-word',e.word));
    main.append(this.commonAnswer(e));
    const total=e.totalCount??e.encounters.length,trail=this.el('span','vocab-card-trail'),count=this.el('span','vocab-count','×'+total);count.title='个人词库累计 '+total+' 次遇词'+(e.totalCount!==undefined?' · 本章 '+e.encounters.length+' 次':'');count.setAttribute('aria-label',count.title);trail.append(count);main.append(trail);
    const details=this.el('details','vocab-details'),summary=this.el('summary'),contexts=this.el('div','vocab-contexts');
    details.open=this.presentation==='full'?!this.collapsed.has(e.key):this.expanded.has(e.key);
    contexts.id='vocab-context-'+(++this.contextSerial);summary.setAttribute('aria-controls',contexts.id);
    details.append(summary,contexts);card.append(details);
    const populate=()=>{
      if(contexts.dataset.loadedOpen!==String(details.open)){
        contexts.replaceChildren();
        if(details.open){
          this.button('查看全部 '+total+' 次遇词 →',()=>this.showWord(e.key),contexts,'vocab-detail-link');
          for(const c of e.encounters.slice(-30).reverse())contexts.append(this.context({...c,word:e.word}));
          if(e.encounters.length>30)contexts.append(this.el('p','vocab-help','这里显示最近 30 次，进入单词详情可翻阅全部语境。'));
        }
        contexts.dataset.loadedOpen=String(details.open);
      }
      const label=(details.open?'收起':'展开')+' '+e.word+' 的 '+e.encounters.length+' 次语境';
      PCUI.label(summary,label,'chevron',{only:true,disclosure:true});summary.title=label;summary.setAttribute('aria-expanded',String(details.open));
    };
    populate();details.addEventListener('toggle',()=>{
      if(!details.isConnected)return;
      if(details.open){this.expanded.add(e.key);this.collapsed.delete(e.key);}else{this.expanded.delete(e.key);this.collapsed.add(e.key);}
      populate();
    });
    return card;
  }
  showWord(key) {
    if(!this.book.active().some(e=>e.key===key))return;
    if(!this.selectedKey)this.returnScroll=this.content.scrollTop;
    this.mode='list';this.selectedKey=key;this.editing=null;this.contextPage=0;this.render();this.content.scrollTop=0;this.content.querySelector('.vocab-back')?.focus({preventScroll:true});
  }
  focusEntry(key) { const row=[...this.content.querySelectorAll('.vocab-entry')].find(n=>n.dataset.key===key);row?.querySelector(this.view==='rows'?'.vocab-details>summary':'.vocab-card-open')?.focus({preventScroll:true}); }
  back() {const key=this.selectedKey;this.selectedKey=null;this.editing=null;this.render();this.content.scrollTop=this.returnScroll||0;this.focusEntry(key);}
  renderWord() {
    const e=this.book.active().find(e=>e.key===this.selectedKey);if(!e){this.selectedKey=null;return this.renderContent();}
    const top=this.el('div','vocab-detail-top');this.button('← 返回'+(this.view==='rows'?'列表':'卡片'),()=>this.back(),top,'vocab-back');
    if(!this.standalone)this.button('独立窗口 ↗',()=>this.api.openVocabulary({wordKey:e.key,paper:this.paper}),top);
    this.content.append(top,this.el('h2','vocab-detail-word',e.word),this.el('span','vocab-count','所有论文 · '+e.encounters.length+' 次遇词'),this.el('p','vocab-help',e.defaultMeaning?'常用释义':e.encounters.some(c=>c.meaning)?'已有语境释义 · 可编辑常用释义':'尚无释义 · 可手动填写或补全'),this.commonAnswer(e));
    const encounters=e.encounters.slice().reverse(),start=(this.contextPage||0)*30;
    for(const c of encounters.slice(start,start+30)){
      const d=this.el('details','vocab-encounter-details');d.open=!this.collapsed.has(c.id)&&(this.presentation==='full'||encounters.length===1||this.expanded.has(c.id));
      const summary=this.el('summary','',new Date(c.at).toLocaleDateString()+' · '+c.title);PCUI.summary(summary);d.append(summary);const body=this.el('div');d.append(body);
      const populate=()=>{body.replaceChildren();if(d.open)body.append(this.context({...c,word:e.word}));};populate();d.addEventListener('toggle',()=>{if(!d.isConnected)return;if(d.open){this.expanded.add(c.id);this.collapsed.delete(c.id);}else{this.expanded.delete(c.id);this.collapsed.add(c.id);}populate();});this.content.append(d);
    }
    if(encounters.length>30){const pager=this.el('div','vocab-actions');const prev=this.button('较新的语境',()=>{this.contextPage--;this.renderContent();},pager);prev.disabled=start===0;const next=this.button('更早的语境',()=>{this.contextPage++;this.renderContent();},pager);next.disabled=start+30>=encounters.length;this.content.append(pager);}
  }
  answer(c, scope) {
    const box = this.el('div', 'vocab-answer'); box.dataset.answer = c.id;
    const study = this.currentStudy(), hidden = study === 'recall' && !this.answers.has(c.id);
    if (!hidden && !(scope==='summary'&&study==='recall')) {
      box.append(this.el('p', scope === 'summary' ? 'vocab-definition' : 'vocab-meaning', c.meaning || (scope==='summary'?'释义待补全':'释义待补全 · 可手动填写或使用下方模型补全')));
      if (scope !== 'summary'&&c.sentence) box.append(this.el('p', 'vocab-translation', c.sentenceTranslation || '句意待补全'));
    }
    if (study === 'recall') {
      const cover = this.button(hidden ? (scope === 'review' ? '查看释义与句意' : '点击显示中文') : '重新遮住中文', () => {
        if (hidden) this.answers.add(c.id); else this.answers.delete(c.id);
        this.renderContent();
        [...this.content.querySelectorAll('.vocab-cover')].find(b => b.dataset.encounter === c.id && b.dataset.scope === scope)?.focus({preventScroll:true});
      }, box, 'vocab-cover');
      if(scope==='summary'){
        // Keep the action on one line even in a narrow sidebar. The accessible
        // label and tooltip below spell out the complete reveal action.
        if(hidden)cover.textContent='释义';
        else {cover.replaceChildren(this.el('span','vocab-definition',c.meaning||'释义待补全'));cover.classList.add('is-revealed');}
      }
      cover.dataset.encounter = c.id; cover.dataset.scope = scope; cover.setAttribute('aria-expanded', String(!hidden));
      cover.setAttribute('aria-label',scope==='summary'&&!hidden?'中文释义：'+(c.meaning||'释义待补全')+'；再次点击遮住':(hidden?'显示':'遮住')+' '+(scope==='summary'?'中文释义':'本次语境的释义与句意'));
      cover.title = hidden ? '点击揭示本次语境的释义和句意' : '再次遮挡，继续回想';
      if (hidden) box.classList.add('is-covered');
    }
    return box;
  }
  context(c, review = false) {
    const box = this.el('section', 'vocab-context'); box.dataset.encounter = c.id;
    const source = this.el('div', 'vocab-source');
    source.style.backgroundColor = this.book.colorFor(c.paperKey);
    const link = this.el('button', '', c.title); link.type = 'button'; link.title = '打开来源论文';
    link.addEventListener('click', () => this.run(() => this.api.openReference({ paperID: c.paperID, page: c.page, key: c.paperKey }))); source.append(link);
    const origin={local:'本地取句',manual:'补划录入',ocr:'OCR 自动补采',model:'模型自动补采'}[c.contextMode]||'';
    box.append(source, this.el('p', 'vocab-meta', new Date(c.at).toLocaleString() + ' · 第 ' + c.seq + ' 次记录'+(origin?' · '+origin:'')));
    if(c.sentence)box.append(this.el('blockquote', 'vocab-sentence', c.sentence));
    else {
      // Display-only placeholders: never copied into the ledger or model input.
      const quotes=[['Brevity is the soul of wit.','William Shakespeare · Hamlet'],['There is no charm equal to tenderness of heart.','Jane Austen · Emma'],['A little learning is a dangerous thing.','Alexander Pope · An Essay on Criticism']];
      box.append(this.el('p','vocab-missing-source','原句待补充 · 可补划短句或自动补采。'));
      const quote=quotes[c.seq%quotes.length],placeholder=this.el('div','vocab-placeholder');placeholder.append(this.el('span','','示例名言 · 非论文原句'),this.el('blockquote','',quote[0]),this.el('cite','',quote[1]));box.append(placeholder);
    }
    box.append(this.answer(c, review ? 'review' : 'context'));
    if (this.currentStudy() === 'display' || this.answers.has(c.id)) {
      const settings=this.api.settings,method=this.book.pendingContext?.id===c.id?this.book.pendingContext.method:settings.vocabularyContextMethod;
      if (c.error) box.append(this.el('p', 'vocab-help', c.error));
      const tools=review?this.el('details','vocab-review-tools'):box;
      if(review){const summary=this.el('summary','','编辑与补全');PCUI.summary(summary);tools.append(summary);box.append(tools);}
      const actions = this.el('div', 'vocab-actions'); this.button('编辑释义与原句', () => this.editor(c), actions);
      if(!c.sentence){this.button('补划原句',async()=>{await this.api.openReference({paperID:c.paperID,page:c.page,key:c.paperKey});this.book.beginManual(c.id);},actions);const auto=this.button(this.book.contextJobs.has(c.id)?'自动补采中…':'自动补采 · 耗用量',()=>{this.book.beginManual(c.id);return this.book.autoContext(c.id,{...this.api.settings,vocabularyContextMethod:method});},actions);auto.disabled=this.book.contextJobs.has(c.id);}
      const fill = this.button(this.book.jobs.has(c.id) ? '正在补全…' : '补全释义', () => this.book.enrich(c.id), actions); fill.disabled = this.book.jobs.has(c.id); fill.title = '使用翻译设置中的模型，会消耗用量；不会增加遇到次数';
      this.button('移除此条遇词',async()=>{await this.book.removeEncounter(c.id);this.render();},actions,'danger-quiet');
      this.button('释义：'+PCore.featureModel(settings,'vocabulary').label+' · 设置',()=>this.api.openPanel({readerID:c.paperID,action:'model-settings',feature:'translation'}),tools,'vocab-model-link');
      if(!c.sentence)this.button('自动补句：'+PCore.featureModel(settings,method==='ocr'?'vocabulary-ocr':'vocabulary-context').label+' · 设置',()=>this.api.openPanel({readerID:c.paperID,action:'model-settings',feature:method==='ocr'?'formula':'translation'}),tools,'vocab-model-link');
      tools.append(actions);
    }
    return box;
  }
  renderReview() {
    this.batchEnd ??= this.book.data.nextSequence - 1;
    const cursor = this.book.data.reviewedThrough, due=this.reviewQueue==='due';
    const pending=due?this.book.due(this.reviewCutoff).filter(c=>!this.reviewSkipped.has(c.id)):this.book.pending().filter(c=>c.seq<=this.batchEnd),next=pending[0];
    if (!next) {
      this.content.append(this.el('p', 'vocab-empty', due ? '本批到期词已看完。略过的记录仍会保留，下次可再次复习。' : cursor >= this.batchEnd ? '这批新增遇词已看完。新收词后从这里继续；也可查看到期复习。' : '目前没有待复习单词。'));
      if(due)this.button('刷新到期队列',()=>this.setReviewQueue('due'),this.content,'primary');
      else if (this.book.stats().pending) this.button('复习刚加入的单词', () => { this.batchEnd = this.book.data.nextSequence - 1; this.render(); }, this.content, 'primary');
      return;
    }
    const card = this.el('section', 'vocab-review-card');
    card.append(this.el('p', 'vocab-meta', `${due?'到期复习':'新增遇词复习'} · 本批还剩 ${pending.length} 条`), this.el('h2', 'vocab-review-word', next.word), this.el('span', 'vocab-count', `遇到 ${next.count} 次 · 重遇 ${next.count - 1} 次`));
    const revealed = this.currentStudy() === 'display' || this.answers.has(next.id), context=this.context(next, true);card.append(context);
    const focusNext = () => {const target=this.content.querySelector('.vocab-cover')||this.content.querySelector('.vocab-review-card>.primary');if(target)this.revealWithin(target,this.content);(target||this.review).focus({preventScroll:true});};
    if(revealed&&this.reviewMode==='test'){
      const feedback=this.el('div','vocab-review-feedback');feedback.setAttribute('role','group');feedback.setAttribute('aria-label','本次回想情况');
      if(next.meaning.trim()){
        for(const [grade,label]of [['again','不会'],['uncertain','模糊'],['remembered','记住']]){
          const button=this.button(label,async()=>{
            for(const item of feedback.querySelectorAll('button'))item.disabled=true;
            try {await this.book.feedback(next.id,grade,{advance:!due,expectedCount:next.practice?.count||0});this.answers.delete(next.id);this.render();focusNext();}
            finally{for(const item of feedback.querySelectorAll('button'))if(item.isConnected)item.disabled=false;}
          },feedback);button.dataset.grade=grade;
          button.title='下次：'+new Date(this.book.constructor.practice(next.practice,grade).dueAt).toLocaleString();
        }
        const note=this.el('p','vocab-help','仅记录这次回想，按固定间隔安排下次；不代表长期掌握。');feedback.append(note);
      }else{
        feedback.append(this.el('p','vocab-help','这条释义尚未补全。先在「编辑与补全」填写或补全释义，再自测；也可切换浏览。'));
        this.button('切换到浏览',()=>{this.reviewMode='browse';this.answers.clear();this.render();},feedback);
      }
      const tools=context.querySelector('.vocab-review-tools');context.insertBefore(feedback,tools);
    }else if(revealed){
      this.button(due?'本次略过':'已复习，下一条',async()=>{if(due)this.reviewSkipped.add(next.id);else await this.book.reviewed(next.seq);this.answers.delete(next.id);this.render();focusNext();},card,'primary');
    }
    if(next.practice)card.append(this.el('p','vocab-help','上次：'+{again:'不会',uncertain:'模糊',remembered:'记住'}[next.practice.grade]+' · 下次 '+new Date(next.practice.dueAt).toLocaleString()));
    this.content.append(card);
  }
  editor(c) {
    this.editing = c.id;
    const form = this.el('form', 'vocab-editor'); form.addEventListener('submit', e => e.preventDefault());
    form.append(this.el('h3', '', '编辑 · ' + c.word));
    const fields = {}, draft = this.drafts.get(c.id) || {},entry=this.book.find(this.book.data,c.id).entry;
    const wordLabel=this.el('label','','词头 · 更正时会合并同名词条'),wordInput=this.el('input');wordInput.type='text';wordInput.maxLength=80;wordInput.value=draft.word??entry.word;wordLabel.append(wordInput);form.append(wordLabel,this.el('p','vocab-help','更正应用于此词的全部语境；同名词合并并保留其常用释义。更正前自动保存完整备份，不调用模型。'));fields.word=wordInput;
    wordInput.addEventListener('input',()=>{this.drafts.set(c.id,Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])));});
    for (const [name, label] of [['meaning','这次遇到的释义'],['sentence','论文原句'],['sentenceTranslation','原句意思'],['defaultMeaning','卡片上的常用释义（跨论文共用）']]) {
      const row = this.el('label', '', label), input = this.el('textarea'); input.rows = name === 'meaning'||name==='defaultMeaning' ? 2 : 3; input.maxLength = name==='defaultMeaning'?1000:8000; input.value = draft[name] ?? (name==='defaultMeaning'?entry.defaultMeaning||'':c[name]);
      input.addEventListener('input', () => { this.drafts.set(c.id, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value]))); }); fields[name] = input; row.append(input); form.append(row);
    }
    const actions = this.el('div', 'vocab-actions');
    this.button('保存修改', async () => {
      const values = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value]));
      // Lock this small form while its atomic local save completes.
      Object.values(fields).forEach(f => f.disabled = true);
      try { await this.book.edit(c.id, values); this.drafts.delete(c.id);if(this.selectedKey)this.selectedKey=this.book.find(this.book.data,c.id).entry.key; this.editing = null; this.render(); }
      finally { Object.values(fields).forEach(f => f.disabled = false); }
    }, actions, 'primary');
    this.button('返回（保留草稿）', () => { this.editing = null; this.render(); }, actions); form.append(actions);
    this.content.replaceChildren(form);this.revealWithin(fields.meaning,this.content);fields.meaning.focus({preventScroll:true});
  }
  destroy() { this.destroyed=true;this.paperRevision++;this.resizeObserver?.disconnect();this.unsubscribe?.();this.win.removeEventListener('keydown',this.onKey);this.win.removeEventListener('focus',this.onFocus); }
};

// Both DOM readiness and the native opener may deliver the local API. Starting is
// idempotent, including when arguments arrive after DOMContentLoaded.
if (typeof window !== 'undefined') {
  window.pcVocabularyStart = function (args = window.paperCompanionArgs || window.arguments?.[0]) {
    const container=document.getElementById('vocabulary-window');
    if(!container)return false; // panel.xhtml also loads this shared UI module.
    if(window.pcVocabularyUI){
      if(args!==window.pcVocabularyAppliedRequest){
        const ui=window.pcVocabularyUI;
        if(args?.getPaper)ui.getPaper=args.getPaper;
        if(args&&Object.hasOwn(args,'paper'))ui.refreshPaper(args.paper);else ui.refreshPaper();
        if(args?.wordKey)ui.showWord(args.wordKey);
        else if(args?.review)ui.open(true);
        window.pcVocabularyAppliedRequest=args;
      }
      return true;
    }
    let ui,appearance;
    try{
      if(!args?.api?.vocabulary)throw Error('无法连接本机单词本，请从 Zotero 重新打开。');
      container.replaceChildren();
      ui=new PCVocabularyUI({api:args.api,container,standalone:true,review:args.review,paper:args.paper||null,getPaper:args.getPaper||(()=>args.api.paper())});
      appearance=new PCTheme({api:args.api,root:document.documentElement});
      const picker=appearance.picker(container.querySelector('.vocab-heading .vocab-actions'));ui.close.before(picker);
      ui.open(!!args.review);if(args.wordKey)ui.showWord(args.wordKey);
      window.pcVocabularyUI=ui;window.pcTheme=appearance;window.pcVocabularyAppliedRequest=args;
      document.body.dataset.vocabularyReady='true';delete document.body.dataset.vocabularyError;
      window.addEventListener('unload',()=>{appearance.destroy();ui.destroy();},{once:true});
      return true;
    }catch(error){
      appearance?.destroy();ui?.destroy();container.replaceChildren();
      const shell=document.createElement('section');shell.className='vocab-startup';
      const title=document.createElement('h1');title.textContent='单词本暂时无法打开';
      const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message;
      const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.addEventListener('click',()=>window.pcVocabularyStart());
      const close=document.createElement('button');close.type='button';close.textContent='关闭';close.addEventListener('click',()=>window.close());
      shell.append(title,message,retry,close);container.append(shell);document.body.dataset.vocabularyError='true';
      return false;
    }
  };
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',()=>window.pcVocabularyStart(),{once:true});
  else window.pcVocabularyStart();
}
