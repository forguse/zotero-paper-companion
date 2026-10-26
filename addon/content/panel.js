/* SPDX-License-Identifier: MIT */
(async function () {
  "use strict";
  if (document.readyState === "loading") await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
  const $ = id => document.getElementById(id);
  const args = window.arguments?.[0] || window.frameElement?.paperCompanionArgs;
  const api = args?.api;
  if (!api) { $("notice").hidden = false; $("notice").textContent = "请从 Zotero 中打开伴读。"; return; }
  api.registerPanel(window, !!args.embedded);
  PCUI.disclosures(document);
  for(const button of document.querySelectorAll('button'))if(button.childElementCount===0)PCUI.action(button);
  const control=(id,text,icon,options={})=>{const node=$(id),label=node.querySelector(':scope > .pc-control-label'),glyph=node.querySelector(':scope > .pc-glyph');if(label?.textContent===text&&glyph?.dataset.pcGlyph===icon&&node.classList.contains('pc-disclosure')===!!options.disclosure&&node.classList.contains('pc-icon-only')===!!options.only)return node;return PCUI.label(node,text,icon,options);};
  for(const id of ['close-preview','formula-close','reading-close','usage-close','chat-history-close','note-find-close'])if($(id))control(id,$(id).getAttribute('aria-label')||'关闭','close',{only:true});
  control('formula-open','记公式','formula');control('web-external','外部打开','external');control('web-focus','放大网页','expand',{only:true});control('screenshot-options-toggle','截图选项','chevron',{disclosure:true,only:true});
  control('note-find-toggle','查找','chevron',{disclosure:true});control('range-toggle','范围','chevron',{disclosure:true});
  control('toggle-note-source','Markdown 源码','chevron',{disclosure:true});
  const webMore=document.createElement('div'),webMoreToggle=document.createElement('button'),webMoreMenu=document.createElement('div');webMore.className='web-more';webMoreToggle.id='web-more-toggle';webMoreToggle.type='button';webMoreToggle.setAttribute('aria-expanded','false');webMoreToggle.setAttribute('aria-controls','web-more-menu');webMoreMenu.id='web-more-menu';webMoreMenu.className='web-more-menu';webMoreMenu.hidden=true;PCUI.label(webMoreToggle,'更多网页操作','more',{only:true});
  webMoreMenu.append($('web-external'),$('web-focus'),$('web-close'));webMore.append(webMoreToggle,webMoreMenu);document.querySelector('.web-tools').append(webMore);
  webMoreToggle.addEventListener('click',()=>{const open=webMoreMenu.hidden;closePopovers('web-more-menu');webMoreMenu.hidden=!open;webMoreToggle.setAttribute('aria-expanded',String(open));if(open)webMoreMenu.querySelector('button').focus();});
  webMoreMenu.addEventListener('click',event=>{if(event.target.closest('button')){closePopovers();webMoreToggle.focus();}});
  const headerGlyph=document.querySelector('.header-chevron');headerGlyph.replaceChildren(PCUI.icon(document,'chevron'));

  const appearancePorts={get settings(){return api.settings;},subscribe:fn=>api.subscribe(fn),emit:(...values)=>api.emit(...values),saveAppearance:patch=>settingsPanel.immediate('appearance',()=>api.saveAppearance(patch),Object.keys(patch).sort().join(','))};
  const appearance=new PCTheme({api:appearancePorts,root:document.documentElement});
  appearance.picker($('appearance-header'),'theme-toggle');appearance.config($('appearance-settings'));window.pcTheme=appearance;
  let paper = null, context = null, selected = null, translation = "", noteText = "", highlightsText = "", sending = false, extracting = false, revision = 0, initialized = false;
  let noteReady = false, highlightsRevision = 0;
  let comparisonIDs = new Set(), readingSearching = false, prereadPlan = null, planningRead = false, planController = null;
  let readingSnapshot = null, readingStatusRevision = 0;
  let readingCheckTimer = null, readingCheckAttempts = 0;
  let readingFocus = false, composerCollapsed = false, previousComposerCollapsed = false, focusOptionsOpen = false;
  let chatView = null, pageMotion = null, readingScopeUI = null, noteReceiptUI = null, actionGuide = null;
  let includePrimaryChoice;
  const layoutOverrides = new Map(), folding = new Map();
  const motionAllowed = () => appearance.motion === 'standard' && !appearance.reduce.matches;
  const layoutValue = name => layoutOverrides.has(name) ? layoutOverrides.get(name).value : api.settings[name];
  const readingLayout = (change, duration = 160) => chatView ? chatView.layout(change, motionAllowed() ? duration : 0) : change();
  function finishFold(node, record) { record.animation?.cancel();record.animation=null;node.style.overflow=record.overflow;node.hidden=!record.open; }
  function fold(node, open) {
    let record=folding.get(node);if(record?.open===open)return;
    const from=node.hidden?0:node.getBoundingClientRect().height,initial=!record;
    if(record)finishFold(node,record);else{record={overflow:node.style.overflow,animation:null};folding.set(node,record);}
    record.open=open;node.hidden=false;node.inert=!open;node.setAttribute('aria-hidden',String(!open));
    const to=open?node.getBoundingClientRect().height:0;
    if(initial||!motionAllowed()||Math.abs(from-to)<1){finishFold(node,record);return;}
    node.style.overflow='hidden';
    const animation=node.animate([{height:from+'px',opacity:open?.6:1},{height:to+'px',opacity:open?1:.6}],{duration:140,easing:'cubic-bezier(.2,.8,.2,1)'});
    record.animation=animation;animation.onfinish=()=>{if(record.animation===animation)finishFold(node,record);};
  }
  function settleMotions() { if(motionAllowed())return;for(const [node,record]of folding)if(record.animation)finishFold(node,record);pageMotion?.cancel();pageMotion=null; }
  appearance.reduce.addEventListener('change',settleMotions);
  async function saveLayoutPreference(name,value) {
    const pending={value};layoutOverrides.set(name,pending);workspaceLayout();
    try { await saveInstant('layout',{[name]:value}); }
    finally { if(layoutOverrides.get(name)===pending){layoutOverrides.delete(name);workspaceLayout();} }
  }
  const noteUI = new PCNoteEditor({ container: $("note-preview"), markdown: value => PCore.markdown(value), normalizePaste: value => PCMath.preparePaste(value, value.trim() === api.lastFormulaCopy), onChange: value => updateNote(value), onState: status => {
    $("note-undo").disabled = !status.undo || !paper; $("note-redo").disabled = !status.redo || !paper;
    $("note-find-count").textContent = status.matches ? `${status.index >= 0 ? status.index + 1 : '—'}/${status.matches}` : '0 处';
  } });
  const mathObserver = new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) { const node = record.target.nodeType === 1 ? record.target : record.target.parentElement; const root = node?.closest('.markdown'); if (root) roots.add(root); }
    for (const root of roots) PCMath.render(root);
  });
  mathObserver.observe(document.body, { childList: true, subtree: true });
  const key = () => paper?.key || "general";
  const usageUI = new PCUsagePanel({ api, document, getPaperKey: key });
  let noticeTimer=null,noticeFocus=null;
  const notice = (text, error = false) => {
    window.clearTimeout(noticeTimer);const box=$('notice');$('notice-text').textContent=text;box.hidden=!text;box.classList.toggle('error',error);box.setAttribute('role',error?'alert':'status');
    if(text){noticeFocus=document.activeElement;box.style.top=Math.min(Math.max(8,document.querySelector('.tabs').getBoundingClientRect().bottom+6),Math.max(8,window.innerHeight-120))+'px';if(!error)noticeTimer=window.setTimeout(()=>{box.hidden=true;},Math.max(3200,Math.min(8000,text.length*85)));}
  };
  control('notice-dismiss','关闭提示','close',{only:true});
  $('notice-dismiss').addEventListener('click',()=>{notice('');if(noticeFocus?.isConnected)noticeFocus.focus({preventScroll:true});});
  const run = async fn => { try { return await fn(); } catch (e) { notice(PCore.safeError(e.message), true); } };
  const uninstallReviewUI = new PCUninstallUI({document,button:$('uninstall-review-open'),review:api.uninstallReview,reveal:path=>api.revealUninstallPath(path),copy:text=>api.copy(text),notify:notice});
  const tab = name => { const next=$('tab-'+name),changed=!next.classList.contains('active');notice("");closePopovers();readingLayout(()=>{document.querySelector('.tabs').dataset.active=name;document.querySelectorAll('.tabs button').forEach(b=>{const active=b.dataset.tab===name;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('active',p===next));workspaceLayout();});if(changed){pageMotion?.cancel();pageMotion=motionAllowed()?next.animate([{opacity:.65},{opacity:1}],{duration:100,easing:'ease-out'}):null;}updateGuide();if(name==='notes')noteReceiptUI?.showLatest($('note-latest-receipt')); };
  const on = (id, fn) => $(id).addEventListener("click", () => run(fn));
  for(const [group,selector]of Object.entries({connection:'#settings-provider',api:'#settings-deepseek',translation:'#settings-translation',questions:'#settings-questions',prompts:'#settings-prompts',vocabulary:'#settings-vocabulary',general:'.settings-save',appearance:'#settings-appearance',formula:'#settings-formula',chat:'#chat-options','translation-options':'#translation-settings','summary-options':'.highlights-config','notes-options':'#note-insert-options,#translation-save-options',materials:'#material-options',screenshot:'#screenshot-options','web-options':'.web-tools',layout:'#settings-storage'})){
    for(const host of document.querySelectorAll(selector)){host.dataset.settingsSaveGroup=group;const status=document.createElement('span');status.className='settings-save-state';status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(status);}
  }
  const settingsPanel = new PCSettingsPanel({
    document, readSettings: () => api.publicState().settings,
    saveSettings: (values, key) => api.saveSettings(values, key),
    keyPresent: async () => !!(await api.readSecrets()).deepseek,
    readPrompt: kind => api.insights.prompt(kind), defaultPrompt: kind => api.insights.defaultPrompt(kind),
    readVocabularyState: () => ({ stats: api.vocabulary.stats(), problem: api.vocabulary.problem }),
    notice, error: error => notice(PCore.safeError(error.message), true),
    afterSaved: () => renderMessages(), vocabularyChanged: () => refreshVocabulary(),
    providerChanged: () => settingsEngineGuide(),
    instantGroups:['appearance','formula','chat','translation-options','summary-options','notes-options','materials','screenshot','web-options','layout'],
    saveState:(group,detail)=>{for(const host of document.querySelectorAll('[data-settings-save-group="'+group+'"]')){host.dataset.saveStatus=detail.status;const label=host.querySelector('.settings-save-state');if(label&&label.textContent!==detail.text)label.textContent=detail.text;}}
  });
  function saveInstant(group, values) { return settingsPanel.immediate(group,()=>api.saveSettings(values),Object.keys(values).sort().join(',')); }
  function scopeInput() { return {key:key(),paperID:paper?.id,provider:api.settings.chatProvider,model:api.settings.chatProvider==='deepseek'?api.settings.chatDeepseekModel:api.settings.model,smartReading:api.settings.smartReading,context,ids:[...comparisonIDs],includePrimary:includePrimaryChoice,preread:readingSnapshot,session:activeChatSession}; }
  function updateScope() { readingScopeUI?.update(); }
  function guideState() { return {page:document.querySelector('.tabs').dataset.active,empty:!activeChatSession?.messages?.length,paperAvailable:!!paper}; }
  function updateGuide() { actionGuide?.update(guideState()); }
  const vocabularyUI = new PCVocabularyUI({ api, container: $('tab-vocabulary'), inline: true, getPaper: () => paper });
  function openVocabularyPage(review = false) { tab('vocabulary'); vocabularyUI.open(review); }
  on('vocabulary-open', () => openVocabularyPage());
  on('vocabulary-window-open', () => api.openVocabulary());
  on('vocabulary-md-open', () => api.vocabulary.openFile());
  on('vocabulary-reminder', () => openVocabularyPage(true));
  function refreshVocabulary() {
    const stats = api.vocabulary.stats(), reminder = $('vocabulary-reminder');
    reminder.hidden = !stats.due; reminder.textContent = `复习 · ${stats.pending}`; reminder.title = `${stats.pending} 条遇词待复习，从上次确认的位置继续`;
    settingsPanel.refreshVocabulary({ stats, problem: api.vocabulary.problem });
  }
  const vocabularyUnsubscribe = api.subscribe(e => { if (['vocabulary', 'settings'].includes(e.type)) refreshVocabulary(); });
  const vocabularyTimer = window.setInterval(refreshVocabulary, 60000); refreshVocabulary();
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => tab(b.dataset.tab)));
  document.querySelectorAll('.tab-pane').forEach(p => { p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', 'nav-' + p.id.slice(4)); });
  document.querySelector('.tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('.tabs button')], current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    e.preventDefault();
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tab(tabs[index].dataset.tab); tabs[index].focus();
  });
  function locate(id, headingSelector = null) {
    const target = $(id); if (!target) return;
    // scrollIntoView crosses iframe boundaries in Gecko. Keep navigation inside
    // the nearest product scrollport so Zotero's surrounding section stays put.
    let scroller = target.parentElement;
    while (scroller && scroller !== document.body) {
      const overflow = getComputedStyle(scroller).overflowY;
      if (/^(auto|scroll)$/.test(overflow)) break;
      scroller = scroller.parentElement;
    }
    if (scroller && scroller !== document.body) {
      const bounds = scroller.getBoundingClientRect(), locator = scroller.querySelector(':scope > .settings-locator');
      const inset = locator && !locator.contains(target) ? locator.getBoundingClientRect().height + 8 : 8;
      const top = scroller.scrollTop + target.getBoundingClientRect().top - bounds.top - scroller.clientTop - inset;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    }
    (headingSelector ? target.querySelector(headingSelector) : target)?.focus({ preventScroll: true });
  }
  function insightPage(name) {
    for (const id of ['highlights', 'review']) { const active = id === name; $('stage-' + id).hidden = !active; $('jump-' + id).setAttribute('aria-selected', String(active)); $('jump-' + id).tabIndex = active ? 0 : -1; }
  }
  on('jump-highlights', () => insightPage('highlights'));
  on('jump-review', () => insightPage('review'));
  for (const name of ['highlights', 'review']) $('jump-' + name).addEventListener('keydown', e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'highlights' : e.key === 'End' ? 'review' : name === 'highlights' ? 'review' : 'highlights'; insightPage(next); $('jump-' + next).focus(); } });
  on('jump-prompts', () => { tab('settings'); locate('settings-prompts', 'h3'); });
  $('settings-jump').addEventListener('change', () => { locate($('settings-jump').value, 'h3'); $('settings-jump').value = ''; });
  on('settings-current-folder', () => locate('settings-folder', 'h3'));
  on('settings-configure-engine', () => {
    const provider = $('default-provider').value;
    if (provider === 'chatgpt-web') { if(api.settings.chatProvider!==provider){notice('请先保存问答方式，再打开网页登录。');return;} tab('chat'); $('web-start').focus(); }
    else locate(provider === 'chatgpt' ? 'settings-chatgpt' : 'settings-deepseek', 'h3');
  });
  function settingsEngineGuide() {
    const provider=$('default-provider').value;
    $('settings-engine-hint').textContent=PCore.engineGuide(provider);
    $('settings-configure-engine').disabled=!provider;
    $('settings-configure-engine').textContent=({deepseek:'设置 DeepSeek Key',chatgpt:'配置授权账号','chatgpt-web':'前往网页登录'})[provider]||'前往账号配置';
  }
  async function openModelSettings(feature) {
    const target=PCore.featureModel(api.settings,feature).target;
    if($('reading-dialog').open)$('reading-dialog').close();
    if(target==='translation'){tab('translate');$('translation-settings').open=true;locate('translation-engine');}
    else if(target==='formula'){tab('settings');locate('settings-formula','h3');}
    else if(target==='summary'){tab('highlights');document.querySelector('.highlights-config').open=true;locate('highlights-engine');}
    else {tab('chat');if(api.settings.chatProvider==='chatgpt-web'){$('web-start').focus({preventScroll:true});return;}if(readingFocus)focusOptionsOpen=true;else if(layoutValue('chatOptionsCollapsed'))await saveLayoutPreference('chatOptionsCollapsed',false);workspaceLayout();$('model').focus({preventScroll:true});}
  }
  for(const [id,feature]of [['translation-model-link','translation'],['summary-model-link','summary'],['organization-model-link','summary'],['review-model-link','review'],['preread-model-link','preread']])on(id,()=>openModelSettings(feature));
  function modelShortcuts() {
    for(const [id,feature]of [['translation-model-link','translation'],['summary-model-link','summary'],['organization-model-link','summary'],['review-model-link','review'],['preread-model-link','preread']])$(id).textContent=PCore.featureModel(api.settings,feature).label+' · 设置';
    const map=$('feature-model-map');map.replaceChildren();
    for(const [title,feature]of [['问答 / 预读','chat'],['翻译 / 单词释义 / 文字补句','translation'],['公式 / 原句 OCR','formula'],['聊天重点 / 重点再整理','summary']]){const button=document.createElement('button'),name=document.createElement('strong'),value=document.createElement('span');button.className='feature-model-row';name.textContent=title;value.textContent=PCore.featureModel(api.settings,feature).label;button.append(name,value);button.addEventListener('click',()=>run(()=>openModelSettings(feature)));map.append(button);}
  }
  function options(el, list, value) { el.replaceChildren(); for (const [id, name] of list) { const o = document.createElement("option"); o.value = id; o.textContent = name; el.append(o); } if (list.some(o => String(o[0]) === String(value))) el.value = String(value); el.title = el.selectedOptions[0]?.textContent || ''; }
  on("header-toggle", () => saveLayoutPreference('headerCollapsed',!layoutValue('headerCollapsed')));
  function resizePrompt() {
    if ($('composer-fields').hidden) return;
    readingLayout(()=>{const input=$('prompt');input.style.height='auto';input.style.height=Math.max(44,Math.min(128,input.scrollHeight))+'px';},0);
  }
  function workspaceLayout() {
    return readingLayout(()=>{
    const headerCollapsed=!!layoutValue('headerCollapsed');document.querySelector('.workspace-header').classList.toggle('collapsed',headerCollapsed);$('header-toggle').setAttribute('aria-expanded',String(!headerCollapsed));
    const webSend=api.settings.chatProvider==='chatgpt-web';control('send',webSend?(window.innerWidth<=320?'传入草稿':'传入网页草稿'):'发送',webSend?'popout':'send');$('send').setAttribute('aria-label',webSend?'传入网页草稿，之后由你在网站发送':'发送问题');
    const focused = readingFocus && $('tab-chat').classList.contains('active');
    document.body.classList.toggle('chat-focus', focused);
    $('chat-focus').setAttribute('aria-pressed', String(focused)); control('chat-focus',focused?'退出专注':'专注阅读',focused?'minimize':'expand');$('chat-focus').setAttribute('aria-label',focused?'退出专注阅读':'专注阅读');
    $('chat-focus').title = focused ? '恢复标题与导航；Esc 也可退出' : '收起标题、导航和输入区，专注阅读回复';
    const optionsOpen = readingFocus ? focusOptionsOpen : !layoutValue('chatOptionsCollapsed');
    fold($('chat-options'),optionsOpen); $('chat-options-toggle').setAttribute('aria-expanded', String(optionsOpen));
    const provider = { deepseek:'DeepSeek', chatgpt:'ChatGPT', 'chatgpt-web':'ChatGPT 网页' }[api.settings.chatProvider];
    const model = api.settings.chatProvider === 'chatgpt-web' ? '' : $('model').selectedOptions[0]?.textContent || '';
    const optionsLabel=optionsOpen?'收起模型与工具':'模型：'+(provider?provider+(model?' · '+model:''):'点击选择');
    control('chat-options-toggle',optionsLabel,'chevron',{disclosure:true});$('chat-options-toggle').title=optionsLabel;$('chat-options-toggle').setAttribute('aria-label',optionsLabel);
    let shortOptions=$('chat-options-toggle').querySelector('.chat-options-short');if(!shortOptions){shortOptions=document.createElement('span');shortOptions.className='chat-options-short';shortOptions.setAttribute('aria-hidden','true');$('chat-options-toggle').insertBefore(shortOptions,$('chat-options-toggle').querySelector('.pc-glyph'));}shortOptions.textContent=optionsOpen?'收起工具':model||provider||'选择模型';
    fold($('material-options'),!layoutValue('materialsCollapsed'));
    $('materials-toggle').setAttribute('aria-expanded', String(!layoutValue('materialsCollapsed')));
    control('materials-toggle','材料','chevron',{disclosure:true});
    document.querySelector('.composer').classList.toggle('collapsed', composerCollapsed);
    fold($('composer-fields'),!composerCollapsed);
    $('composer-toggle').setAttribute('aria-expanded', String(!composerCollapsed));
    control('composer-toggle',composerCollapsed?'继续提问':'收起输入','chevron',{disclosure:true});
    $('composer-toggle').setAttribute('aria-label',composerCollapsed&&$('prompt').value.trim()?'继续提问，保留了草稿':composerCollapsed?'继续提问':'收起输入');
    $('composer-toggle').title = composerCollapsed ? '展开输入区；当前草稿和材料均保留' : '收起输入区，保留当前草稿';
    api.sidebar?.setReadingFocus(window, focused);
    });
  }
  function setReadingFocus(value) {
    if (value === readingFocus) return;
    if (value) { previousComposerCollapsed = composerCollapsed; composerCollapsed = true; focusOptionsOpen = false; }
    else composerCollapsed = previousComposerCollapsed;
    readingFocus = value; closePopovers(); workspaceLayout(); if (!composerCollapsed) resizePrompt();
  }
  function revealComposer() { composerCollapsed = false; workspaceLayout(); resizePrompt(); }
  on('chat-focus', () => setReadingFocus(!readingFocus));
  on('chat-options-toggle', () => { if (readingFocus) { focusOptionsOpen = !focusOptionsOpen; workspaceLayout(); } else return saveLayoutPreference('chatOptionsCollapsed',!layoutValue('chatOptionsCollapsed')); });
  on('materials-toggle', () => saveLayoutPreference('materialsCollapsed',!layoutValue('materialsCollapsed')));
  on('composer-toggle', () => { composerCollapsed = !composerCollapsed; closePopovers(); workspaceLayout(); if (!composerCollapsed) { resizePrompt(); $('prompt').focus({preventScroll:true}); } });
  $('prompt').addEventListener('input', () => { resizePrompt(); });
  let retryingSession=false;
  function chatSaveControls() {
    $('chat-save-warning').hidden=!api.unsavedSessions.has(key());$('chat-save-retry').disabled=retryingSession||api.chatBusy;
  }
  on('chat-save-retry',async()=>{const current=key();retryingSession=true;chatSaveControls();try{await api.saveSession(current);if(key()===current)notice('本机对话已保存。');}finally{retryingSession=false;chatSaveControls();}});
  function state() {
    chatSaveControls();
    const collapsed = !!layoutValue('headerCollapsed');
    document.querySelector(".workspace-header").classList.toggle("collapsed", collapsed);
    $("header-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("header-toggle").title = collapsed ? "展开论文伴读顶栏" : "收起论文伴读顶栏";
    const s = api.publicState(), provider = s.settings.chatProvider;
    document.body.dataset.engine = provider;
    $('chat-engine-hint').textContent = PCore.engineGuide(provider);
    $("provider").value = provider;
    $("web-pane").hidden = provider !== "chatgpt-web"; $("messages").hidden = provider === "chatgpt-web"; document.body.classList.toggle("web-expanded", provider === "chatgpt-web");
    $("status").textContent = s.state === "online" ? (s.inferenceVerified ? "可用" : "已授权") : s.state === "connecting" ? "连接中" : "未连接";
    $("status").className = "status " + s.state;
    $("connect").hidden = provider !== "chatgpt";
    $("status").hidden = provider !== "chatgpt";
    $("connect").textContent = s.state === "online" ? "断开" : s.state === "connecting" ? "取消" : "连接 ChatGPT";
    if (provider === "deepseek") options($("model"), [["deepseek-flash", "Flash"],["deepseek-v4-pro", "Pro"]], s.settings.chatDeepseekModel);
    else if (provider === "chatgpt") options($("model"), s.models.length ? s.models.map(m => [m.id, m.name]) : [["", "连接后选择模型"]], s.settings.model);
    else options($("model"), [["", provider === "chatgpt-web" ? "网页中选模型" : "先选择引擎"]]);
    $('chat-effort').hidden = provider !== 'chatgpt';
    const efforts = PCore.reasoningEfforts(s.settings.model, api.models.find(m => m.id === s.settings.model)?.reasoningEfforts), labels = { default:'默认强度', none:'不思考', minimal:'最少', low:'低', medium:'中', high:'高', xhigh:'更高', max:'最高' };
    options($('chat-effort'), [...efforts.map(v => [v,labels[v]]), ...(!efforts.includes(s.settings.chatGPTEffort) ? [[s.settings.chatGPTEffort,'强度不受支持 · 请重选']] : [])], s.settings.chatGPTEffort);
    $('chat-effort').title = efforts.length === 1 ? '模型目录未声明推理强度；仅使用模型默认。' : '问答推理强度；较高强度可能增加耗时与用量。';
    $("model").disabled = !provider || provider === "chatgpt-web"; $("new-chat").hidden = provider === "chatgpt-web";
    options($("account"), s.accounts.length ? s.accounts.map(a => [a.clientID, a.email + " · " + a.clientID.slice(-6)]) : [["", "尚未登录"]], s.activeAccount);
    usageUI.refresh(); prereadControls(); workspaceLayout();
    document.querySelector('.conversation-hint').textContent = paper ? '本篇连续对话 · 保留当前会话上下文' : '连续对话 · 保留当前会话上下文';
    control('send',provider==='chatgpt-web'?'传入网页草稿':'发送',provider==='chatgpt-web'?'popout':'send');
    control('web-composer-toggle',s.settings.webCompactComposer?'展开输入':'收起输入','chevron',{disclosure:true}); $('web-composer-toggle').setAttribute('aria-expanded', String(!s.settings.webCompactComposer));
    $('prompt').placeholder = provider === 'chatgpt-web' ? '在这里输入问题… Enter 传入网页草稿，Shift+Enter 换行' : '输入问题… Enter 发送，Shift+Enter 换行';
    $("send").disabled = sending || s.chatBusy; $("stop").hidden = (!sending || provider === 'chatgpt-web') && !s.chatBusy && !extracting;
    $("translation-provider").textContent = s.settings.translationProvider === "chatgpt" ? "ChatGPT" : s.settings.deepseekModel === "deepseek-v4-pro" ? "DeepSeek Pro" : "DeepSeek Flash";
    $("selection-mode").value = s.settings.selectionTranslation; $("excerpt-style").value = s.settings.excerptStyle;
    $('translation-note-style').value = s.settings.translationExcerptStyle;
    $('translation-source-style').value = s.settings.excerptStyle;
    translationSaveControls();
    $("popup-translation").checked = !!s.settings.popupTranslation;
    $("auto-record").checked = !!s.settings.autoRecord; $("input-format").value = s.settings.pageFormat;
    $("version").textContent = "Paper Companion " + s.version;
    $('plugin-version').textContent = 'v' + s.version; $('plugin-version').title = '当前插件版本 ' + s.version; $('plugin-version').setAttribute('aria-label', '插件版本 ' + s.version);
    $('smart-reading').checked = !!s.settings.smartReading;
    $('reading-scope').textContent = comparisonIDs.size ? `对比 ${comparisonIDs.size + 1} 篇` : paper ? '当前论文' : '未打开 PDF';
    $('reading-open').disabled = $('compare-open').disabled = !paper;
    featureControls();
    formulaSettingsControls();
    updateScope(); updateGuide(); noteReceiptUI?.update();
  }
  function featureModelControls(prefix, provider, model, effort) {
    const s = api.settings, deepseek = provider === 'deepseek';
    $(prefix + '-engine').value = provider;
    options($(prefix + '-model'), deepseek ? [['deepseek-flash','Flash'],['deepseek-v4-pro','Pro']] : [['','请选择已授权模型'], ...api.models.map(m => [m.id,m.name])], model);
    options($(prefix + '-effort'), deepseek ? [['none','快速 · 不思考'],['low','低'],['high','高'],['max','最高']] : [['default','模型默认'],['low','低'],['medium','中'],['high','高'],['xhigh','更高'],['max','最高']], effort);
  }
  function featureControls() {
    const s = api.settings, t = s.translationProvider, h = s.summaryProvider;
    modelShortcuts();
    featureModelControls('translation', t, t === 'deepseek' ? s.deepseekModel : s.translationChatGPTModel, t === 'deepseek' ? s.translationEffort : s.translationChatGPTEffort);
    featureModelControls('highlights', h, h === 'deepseek' ? s.summaryDeepseekModel : s.summaryChatGPTModel, h === 'deepseek' ? s.summaryEffort : s.summaryChatGPTEffort);
    const enabled = !!paper && api.insights.enabled(paper.key);
    $("highlights-toggle").textContent = '聊天重点自动维护：' + (enabled ? '开' : '关'); $("highlights-toggle").setAttribute('aria-checked', String(enabled));
    $('organization-state').textContent = enabled ? '开' : '关';
    $('organization-menu').dataset.enabled = String(enabled);
    $("highlights-toggle").disabled = !paper; $("highlights-enabled").disabled = !paper; $("highlights-enabled").checked = enabled;
    const status = paper ? api.insights.status.get(paper.key) : null;
    $("highlights-status").textContent = status?.text || (enabled ? '自动维护已开启，等待完成的对话。' : '手动维护：点击「更新聊天重点」才会调用模型。');
    $("highlights-status").classList.toggle('feature-error', !!status?.error);
    $("highlights-now").disabled = !paper || api.insights.manualJobs.has(key()) || api.insights.jobs.has(key());
    $("highlights-export").disabled = !paper;
    $("review-now").disabled = !paper || api.insights.reviewJobs.has(key());
    $("review-export").disabled = !paper;
    const reviewStatus = paper ? api.insights.reviewStatus.get(paper.key) : null;
    $("review-status").textContent = reviewStatus?.text || '仅点击「更新重点再整理」时调用模型，不自动更新。';
    $("review-status").classList.toggle('feature-error', !!reviewStatus?.error);
    const changingFolder = !!paper && api.files.changing.has(key());
    for (const id of ['paper-folder-change', 'paper-folder-default', 'paper-folder-open']) $(id).disabled = !paper || changingFolder;
    $("note-clear").disabled = !paper || changingFolder;
    $("note-restore-clear").hidden = !api.clearUndo.get(key())?.length;
    $('note-manage-label').textContent=api.clearUndo.get(key())?.length?'管理 · 可撤销清空':'管理';
    $("note-restore-clear").disabled = !paper || changingFolder || !noteReady || api.clearRestores.has(key());
    $("screenshot-copy").checked = !!api.settings.screenshotCopy;
    $("screenshot-ask").disabled = !paper || extracting || sending;
    if (changingFolder) { $("highlights-now").disabled = true; $("review-now").disabled = true; $("highlights-enabled").disabled = true; $("highlights-toggle").disabled = true; }
    $("translation-config-hint").textContent = t === 'deepseek' ? '使用你的 DeepSeek API Key；默认 Flash / 快速。未配置或请求失败时不改用其他引擎。' : '需要手动连接 ChatGPT 授权并单独选择翻译模型；使用 Work/Codex 用量。强度支持范围由模型决定，不支持时会报错。';
    api.insights.watchWeb(window, paper);
  }
  async function refreshHighlights() {
    const current = key(), rev = ++highlightsRevision, value = await api.insights.read(paper), review = await api.insights.readReview(paper);
    if (key() !== current || rev !== highlightsRevision) return;
    highlightsText=value;PCUI.document($('highlights-document'),value);PCUI.document($('review-document'),review.text);
    $("review-stale").hidden = !review.stale;
  }
  async function refreshFolder() {
    const target = paper, current = key();
    const show = (folder, note = folder) => { $('paper-folder-path').textContent = folder; $('highlights-folder-path').textContent = folder; $('note-file-path').textContent = note; };
    for (const id of ['note-file-open', 'highlights-file-open', 'review-file-open', 'highlights-folder', 'notes-folder']) $(id).disabled = !target;
    if (!target) { show('打开 PDF 后显示本篇资料文件夹。'); return; }
    try {
      const paths = await api.files.ensure(target);
      if (key() === current) show(paths.dir, paths.note);
    } catch (e) { if (key() === current) show('无法打开资料文件夹：' + PCore.safeError(e.message)); }
  }
  async function changeFolder(useDefault) {
    const target = paper, paths = await api.choosePaperFolder(target, useDefault); if (!paths) return;
    if (paper?.key === target.key) {
      const rev = revision, loadedNote = await api.note(target); if (rev !== revision) return;
      noteText = loadedNote; noteReady = true; $("note-editor").value = noteText; $("note-editor").disabled = false; $("save-status").textContent = '本机自动保存'; renderNote();
      await refreshFolder(); await refreshHighlights();
    }
    notice('资料已复制到：' + paths.dir + '。旧文件保留，后续内容保存到新位置。');
  }
  function settings() { settingsPanel.refresh(); }
  function attach(value, reveal = false) { context = value; if(!value)includePrimaryChoice=undefined; $("attachment").hidden = !value; $("preview-context").textContent = value ? value.label + " · 预览" : ""; if (reveal) revealComposer(); updateScope(); }
  $('prompt').title='未发送的问题和材料按论文在当前插件窗口内暂存，关闭窗口后不保留。';
  const promptDrafts = new PCPromptDrafts();
  let activeChatSession=null,activeMaterialID=null;
  function promptDraft() {
    const input=$('prompt');return {text:input.value,start:input.selectionStart,end:input.selectionEnd,scroll:input.scrollTop,context,selected,session:activeChatSession,baseMaterial:activeMaterialID,ids:[...comparisonIDs],includePrimary:includePrimaryChoice,from:$('range-from').value,to:$('range-to').value,range:!$('page-range').hidden};
  }
  function restorePromptDraft(current) {
    const draft=promptDrafts.get(current);if(!draft)return;
    const input=$('prompt');input.value=draft.text;
    if(draft.session===activeChatSession&&draft.baseMaterial===activeMaterialID){attach(draft.context||null);includePrimaryChoice=draft.includePrimary;selected=draft.selected||null;comparisonIDs=new Set(draft.ids);updateScope();}
    $('range-from').value=draft.from||'';$('range-to').value=draft.to||'';$('page-range').hidden=!draft.range;$('range-toggle').setAttribute('aria-expanded',String(!!draft.range));document.body.classList.toggle('range-open',!!draft.range);
    resizePrompt();input.setSelectionRange(draft.start,draft.end);input.scrollTop=draft.scroll||0;
  }
  async function refreshPaper(id) {
    const rev = ++revision;
    const list = await api.papers(), next = await api.paper(id);
    if (rev !== revision) return;
    options($("paper"), list.length ? list.map(p => [p.id, p.title]) : [["", "未打开 PDF · 通用对话"]], next?.id);
    if (initialized && paper?.key === next?.key && noteReady) return;
    if(initialized)promptDrafts.remember(key(),promptDraft());
    initialized = true;
    if (sending) api.stop();
    activeChatSession=null;activeMaterialID=null;
    paper = next;vocabularyUI.refreshPaper();planController?.abort(); prereadPlan=null;readingSnapshot=null;readingStatusRevision++;window.clearTimeout(readingCheckTimer);readingCheckAttempts=0;$('preread-status').textContent='';$('preread-plan-info').textContent='先在本机准备文字，再开始预读。准备不调用模型。'; selected = null; comparisonIDs = new Set(); attach(null); $("prompt").value = ""; resizePrompt(); $("page-range").hidden = true; $("range-toggle").setAttribute("aria-expanded", "false"); document.body.classList.remove("range-open");
    if ($('reading-dialog').open) { api.readingSearchController?.abort(); $('reading-dialog').close(); }
    noteReady = false; noteText = ''; $("note-editor").value = ''; $("note-editor").disabled = true; noteUI.setDocument('loading', '', true); $("save-status").textContent = '正在读取本篇笔记…';noteReceiptUI?.setPaper();$('note-latest-receipt').replaceChildren();
    featureControls(); await refreshFolder();
    if (rev !== revision) return;
    translation = ""; $("translation-input").value = ""; $("translation-result").textContent = "译文显示在这里。";
    const current = key(), session = await api.session(current);
    if (rev !== revision) return;
    activeChatSession=session;activeMaterialID=session.lastContextID||null;
    if (session.lastContextID) attach(session.materials?.[session.lastContextID] || null);
    const loadedNote = next ? await api.note(next) : "";
    if (rev !== revision) return;
    noteText = loadedNote; noteReady = true;
    $("note-editor").value = noteText; $("note-editor").disabled = !paper;
    $("save-status").textContent = paper ? "本机自动保存" : "打开 PDF 后记笔记";
    if (paper && api.translations.has(paper.id)) showTranslation(api.translations.get(paper.id));
    restorePromptDraft(current);renderNote(); state();noteReceiptUI?.showLatest($('note-latest-receipt')); await renderMessages(); await refreshHighlights(); await refreshReadingState();
  }
  chatView = new PCChatView({root:$('messages'),latest:$('chat-latest'),refresh:()=>run(renderMessages)});
  let messageDetailSerial = 0;
  const messageReceipts = new WeakMap();
  async function renderMessages() {
    const current = key(), session = await api.session(current); if (key() !== current) return;
    const materialID=session.lastContextID||null;
    if(activeChatSession&&(activeChatSession!==session||activeMaterialID!==materialID&&(!context||context.id===activeMaterialID))){attach(session.materials?.[materialID]||null);comparisonIDs=new Set();}
    activeChatSession=session;activeMaterialID=materialID;
    let recorded=null;for(let i=session.messages.length-1;i>=0;i--){if(session.messages[i].readingScope){recorded=session.messages[i].readingScope;break;}}
    if(api.settings.chatProvider!=='chatgpt-web'){
      if(recorded&&readingScopeUI?.actual.get(current)!==recorded)readingScopeUI?.accept({key:current,scope:recorded});
      else if(!recorded&&readingScopeUI?.actual.has(current))readingScopeUI.forget(current);
    }
    const list = $("messages");
    if (!session.messages.length) {
      const box = document.createElement("div"); box.className = "empty-chat";
      const h = document.createElement("h1"); h.textContent = "边读，边问，边留下思考。"; box.append(h);
      const p = document.createElement("p"); p.textContent = api.settings.chatProvider ? paper && api.settings.smartReading ? '直接提问，会按问题准备当前论文的原文。也可手动附加选文、页面或 PDF。' : "可以直接输入问题；需要结合原文时，再附加选文、页面或截图。划词浮窗也可翻译或摘录。" : "先选择默认引擎，之后随时可以切换。"; box.append(p);
      if (!api.settings.chatProvider) for (const [value, label] of [["deepseek","DeepSeek API"],["chatgpt-web","ChatGPT 网页 · 普通 Chat ↗"],["chatgpt","ChatGPT 授权 · Work/Codex 额度"]]) { const b = document.createElement("button"); b.className = "engine-choice"; b.textContent = label;PCUI.action(b,label); b.addEventListener("click", () => run(() => chooseProvider(value))); box.append(b); }
      chatView.empty(current,box); updateScope();updateGuide();return;
    }
    chatView.update(current,session.messages,m => {
      const article = document.createElement("article"); article.className = "message " + m.role;
      article.setAttribute('aria-label', m.role === 'user' ? '你的提问' : 'AI 回答');
      const body = document.createElement("div"); body.className = "message-body markdown";
      if (m.role === "assistant") body.innerHTML = PCore.markdown(m.text || (m.status === "pending" ? "正在思考…" : "回答未完成")); else body.textContent = m.text;
      if (m.role === 'assistant') {
        const html = PCore.markdown(m.text || ''), links = [...html.matchAll(/<a href="([^"]+)"/g)];
        [...body.querySelectorAll('a')].forEach((a, i) => {
          const href = links[i]?.[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
          if (href && PCore.safeURL(href)) a.setAttribute('href', href);
          const reference = m.references?.find(r => r.link === href);
          if (reference) a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run(() => api.openReference(reference)); });
        });
      }
      if(m.role==='assistant'&&m.references?.length){
        const coverage=document.createElement('p');coverage.className='message-evidence-summary';
        coverage.textContent=m.coverage?.length?m.coverage.map(c=>(m.coverage.length>1?c.title+'：':'')+(c.kind==='full-text'?'全文可提取文字':c.kind==='lexical'?'词汇检索命中':c.zeroMatches?'无词汇命中 · 概览节选':'论文概览节选')+(c.brief?'＋预读提要':'')+' · '+c.snippets+'处').join('；'):'本轮提供 '+m.references.length+' 处原文片段 · 未记录覆盖范围';
        article.append(coverage);
      }
      article.append(body);
      if (m.role === 'assistant' && m.references?.length) {
        const details = document.createElement('details'); details.className = 'message-sources';
        const summary = document.createElement('summary'); summary.textContent = `本轮提供的原文 · ${m.references.length} 处`;PCUI.summary(summary);details.append(summary);
        m.references.forEach((reference, i) => details.append(sourceCard(reference, `S${i + 1}`, current)));
        article.append(details);
      }
      if (m.context) { const c = document.createElement("div"); c.className = "message-context"; c.textContent = m.context; article.append(c); }
      if (m.error || m.status === "cancelled") { const e = document.createElement("div"); e.className = "message-error"; e.textContent = m.error || "已停止，未完成内容不会作为后续上下文。"; article.append(e); }
      if (m.role === "assistant" && m.text) {
        const actions = document.createElement("div"); actions.className = "message-actions";
        const receiptHost=document.createElement('div');receiptHost.className='message-note-receipt';
        for (const [text, fn] of [["记入笔记", () => {const receipt=appendNote("\n\n### 问答摘记\n\n" + m.text + "\n",{host:receiptHost,ownerKey:current});if(receipt)messageReceipts.set(m,receipt.id);}],["复制", () => api.copy(m.text)]]) { const b = document.createElement("button"); b.className = "text-button"; b.textContent = text; b.addEventListener("click", () => run(fn)); actions.append(b); }
        const info = document.createElement('p'); info.className = 'message-model-info'; info.hidden = true; info.id = 'message-model-info-' + (++messageDetailSerial);
        const provider = {deepseek:'DeepSeek',chatgpt:'ChatGPT','chatgpt-web':'ChatGPT 网页'}[m.provider] || m.provider;
        info.textContent = m.model ? '模型：' + m.model + (provider ? ' · ' + provider : '（引擎未记录）') : provider ? '引擎：' + provider + '；具体模型未记录。' : '这条历史回答未记录模型信息。';
        if(m.readingScope){const detail=document.createElement('span');detail.className='message-reading-detail';detail.textContent='本轮实际依据：'+m.readingScope.label+'。 '+[...(m.readingScope.details||[]),...(m.readingScope.warnings||[])].join(' ');info.append(detail);}
        const detail = document.createElement('button'); detail.type = 'button'; detail.className = 'text-button'; detail.title = '查看本条回答的模型信息'; detail.setAttribute('aria-expanded', 'false'); detail.setAttribute('aria-controls', info.id); PCUI.label(detail, '详情', 'chevron', {disclosure:true});
        detail.addEventListener('click', () => { info.hidden = !info.hidden; detail.setAttribute('aria-expanded', String(!info.hidden)); }); actions.append(detail);
        article.append(actions, info, receiptHost);if(messageReceipts.has(m))noteReceiptUI?.show(messageReceipts.get(m),receiptHost);
      }
      return article;
    },m=>[m.text,m.status,m.error,m.context,m.provider,m.model,m.references,m.coverage,m.readingScope]);
    const last=session.messages.at(-1),status=last?.role==='assistant'?(last.status==='pending'?'正在生成回答':last.status==='complete'?'回答已完成':last.status==='cancelled'?'回答已停止':'回答未完成'):'';
    if($('chat-live-status').textContent!==status)$('chat-live-status').textContent=status;
    updateScope();updateGuide();noteReceiptUI?.update();
  }
  async function chooseProvider(value) { if (api.chatBusy) throw new Error("请先停止当前回答。"); await saveInstant('chat',{ chatProvider: value }); $("default-provider").value = value; await renderMessages(); }
  async function extract(mode, range = null) {
    if (!paper) throw new Error("请先打开 PDF。"); if (extracting) return;
    const current=key(),readerID=paper.id,format=$("input-format").value;
    extracting = true; state(); notice("正在本机准备材料…");
    try { const value = await api.extract(mode, format, readerID, range); if (key() === current) { attach(value, true); notice(value.warning || ""); if (mode === 'range') { $("page-range").hidden = true; $("range-toggle").setAttribute("aria-expanded", "false"); document.body.classList.remove("range-open"); } } }
    finally { extracting = false; state(); }
  }
  on('screenshot-options-toggle', () => { const open = $('screenshot-options').hidden; $('screenshot-options').hidden = !open; $('screenshot-options-toggle').setAttribute('aria-expanded', String(open)); });
  $('screenshot-copy').addEventListener('change', () => run(() => saveInstant('screenshot',{ screenshotCopy: $('screenshot-copy').checked })));
  on('screenshot-ask', async () => {
    if (!paper || extracting || sending) return;
    const target = paper, current = key(); extracting = true; state(); notice('在 PDF 页面内拖框选择，Esc 取消。');
    try {
      const source = await api.formula.capture(target.id); if (!source) { notice('已取消截图。'); return; }
      if (key() !== current) { notice('论文已切换，截图未加入其他论文。'); return; }
      const images = [...(context?.images || (context?.image ? [context.image] : [])), source.image];
      if (images.length > 30) throw new Error('一轮最多附加 30 张图片，请先移除部分材料。');
      const value = { ...(context || {}), id: 'screenshot-' + Date.now(), key: target.key, title: target.title, mode: 'screenshot', label: (context?.label ? context.label + ' · ' : '') + `截图 · 第 ${source.page} 页`, text: context?.text || '', images, pageNumbers: [...(context?.pageNumbers || (context?.image ? [context.page] : [])), source.page] };
      attach(value, true);
      if (api.settings.screenshotCopy) { try { api.copyImage(source.image); } catch (e) { notice('截图已附加，复制图片失败：' + PCore.safeError(e.message), true); return; } }
      if (api.settings.chatProvider === 'chatgpt-web' && api.web.views.get(window)?.opened) {
        try { await api.web.attach(window, { ...value, images: [source.image], file: null, pageNumbers: [source.page] }); }
        catch (e) { notice('截图已保留在插件；网页附加失败，可点击「附加到网页」重试：' + PCore.safeError(e.message), true); return; }
      }
      notice(api.settings.screenshotCopy ? '截图已附加并复制为图片；输入问题后发送。' : '截图已附加；输入问题后发送。'); $('prompt').focus();
    } finally { extracting = false; state(); }
  });
  async function send() {
    const prompt = $("prompt").value.trim(); if (!prompt || sending) return;
    if (api.settings.chatProvider === "chatgpt-web") {
      const current = key(), target = paper, requestScope=scopeInput(), selection=PCReadingScope.selection(requestScope); let attached = context, evidence=null; sending = true; state();
      const controller = new AbortController(); api.readingDraftController = controller;
      try {
        if (target && selection.shouldPrepare) {
          extracting = true; state();
          const session = await api.session(current);
          const webRead = await api.web.hasPreread(window, target);
          evidence = await api.reading.prepare(target.id, prompt, { ids: selection.comparisonIDs, signal: controller.signal, first: !attached && !session.messages.length && !webRead, includePrimary: selection.includePrimary, remoteRead: webRead });
          attached = attached ? { ...attached, text: evidence.text + '\n\n手动材料：\n' + attached.text, label: evidence.label + ' · ' + attached.label } : evidence;
        }
        await api.web.fill(window, prompt, attached);
        readingScopeUI.accept({key:current,scope:PCReadingScope.describe({...requestScope,evidence,phase:'draft'})});
        if (key() === current) {
          if ($("prompt").value.trim() === prompt) { $("prompt").value = ''; resizePrompt(); }
          $("prompt").focus();
          notice((attached?.file || attached?.image || attached?.images?.length) ? "草稿已传入；再附加图片或 PDF，检查后点网页发送。" : "已传入网页草稿。可展开输入查看，再点网页发送。");
        }
      } finally { sending = false; extracting = false; if (api.readingDraftController === controller) api.readingDraftController = null; state(); }
      return;
    }
    const current = key(), submitted=promptDraft(); sending = true; state(); notice(""); $("prompt").value = ""; resizePrompt();promptDrafts.remember(current,promptDraft());
    try { await api.ask(current, prompt, submitted.context, () => { if (key() === current) chatView.schedule(); }, { ids: submitted.ids,includePrimary:submitted.includePrimary }); if(key()===current)notice(''); }
    catch (e) {
      if(key()===current)promptDrafts.remember(current,promptDraft());
      if((e.code!=='CHAT_SAVE_FAILED'||!e.answerComplete)&&promptDrafts.recover(current,submitted)&&key()===current){restorePromptDraft(current);revealComposer();}
      if(e.code==='CHAT_SAVE_FAILED'){chatSaveControls();if(key()!==current)notice('先前论文的对话未保存，请回到该篇重试保存，或先复制重要内容。',true);return;}
      if(key()!==current){notice('先前论文的提问未完成，问题已保留在该篇草稿中。',true);return;}
      throw e;
    }
    finally { sending = false; chatView.cancel(); state(); if (key() === current) await renderMessages(); }
  }
  function renderNote() {
    noteUI.setDocument(key(), noteText, !paper || !noteReady);
    $("note-clear").disabled = !paper || !noteReady;
  }
  function updateNote(value) { if (!paper) throw new Error("请先打开 PDF。"); if (!noteReady) throw new Error('正在读取本篇笔记，请稍后再写入。'); noteText = value; if ($("note-editor").value !== value) $("note-editor").value = value; api.saveNote(paper.key, value); $("save-status").textContent = "保存中…"; renderNote();noteReceiptUI?.update(); }
  function appendNote(value,options={}) { return noteReceiptUI.append(value,{host:options.host||$('translation-note-receipt'),ownerKey:options.ownerKey||key()}); }
  function sourceCard(reference, label, ownerKey = key()) {
    const card = document.createElement('article'); card.className = 'source-card';
    const jump = document.createElement('button'); jump.className = 'text-button'; jump.textContent = `${label} · ${reference.title} · 第 ${reference.page} 页`;
    jump.addEventListener('click', () => run(() => api.openReference(reference)));
    const excerpt = document.createElement('p'); excerpt.textContent = reference.text;
    const note = document.createElement('button'); note.className = 'text-button'; note.textContent = '摘录到本篇笔记';
    const receiptHost=document.createElement('div');receiptHost.className='source-note-receipt';
    note.addEventListener('click', () => run(async () => {
      if (key() !== ownerKey) throw new Error('当前论文已切换，请重新选择原文。');
      const receipt=appendNote(PCore.excerpt(reference.text, reference, 'quote'),{host:receiptHost,ownerKey});const saved=receipt&&await noteReceiptUI.whenSettled(receipt.id);note.textContent='再次摘录';
      if ($('reading-dialog').open) $('reading-status').textContent = saved?'原文已保存到当前论文笔记，可在摘录下方查看或撤销。':'摘录已保留在笔记中，请在下方重试保存。';
    }));
    card.append(jump, excerpt, note,receiptHost); return card;
  }
  async function openReading() {
    if (!paper) throw new Error('请先打开 PDF。');
    const current = key(), list = await api.papers(); if (key() !== current) return;
    const available = new Set(list.map(p => p.id)); comparisonIDs = new Set([...comparisonIDs].filter(id => available.has(id)));
    $('reading-papers').replaceChildren();
    for (const item of list) {
      const label = document.createElement('label'), input = document.createElement('input'), title = document.createElement('span'); input.type = 'checkbox';
      input.checked = item.id === paper.id || comparisonIDs.has(item.id); input.disabled = item.id === paper.id; title.textContent = item.title + (input.disabled ? ' · 当前' : '');
      input.addEventListener('change', () => run(async () => { if (input.checked && comparisonIDs.size >= 4) { input.checked = false; throw new Error('最多选择当前论文和另外 4 篇。'); } if (input.checked) comparisonIDs.add(item.id); else comparisonIDs.delete(item.id);updateScope(); if (comparisonIDs.size && !api.settings.smartReading) await saveInstant('chat',{ smartReading: true }); state(); }));
      label.append(input, title); $('reading-papers').append(label);
    }
    $('reading-query').value = $('prompt').value.trim(); $('reading-results').replaceChildren(); $('reading-status').textContent = '本机检索不调用模型。默认包含当前论文，可勾选其他已打开 PDF。';
    await prereadStatus(); if (!$('reading-dialog').open) $('reading-dialog').showModal(); state();
  }
  function prereadConfigSnapshot(){const s=api.settings;return {provider:s.chatProvider,model:s.chatProvider==='deepseek'?s.chatDeepseekModel:s.model,effort:s.chatProvider==='deepseek'?'none':s.chatGPTEffort};}
  function prereadControls() {
    const busy = !!paper && api.preread.jobs.has(key());
    $('preread-plan').disabled=!paper||busy||api.chatBusy||planningRead;
    const labels = {unprepared:'未准备',extracted:'已提取',ready:'已预读',stale:'需更新',unchecked:'待核对',unavailable:'待检查'};
    const web=api.settings.chatProvider==='chatgpt-web';
    $('chat-preread-open').disabled=!paper;$('chat-preread-open').textContent=web?'网页预读':busy?'预读中':planningRead?'准备中':'预读 · '+(labels[readingSnapshot?.state]||'待核对');
    $('chat-preread-open').title = web?'将整篇文字传入网页草稿，由你在网站发送；与本机提要独立。':readingSnapshot?.text || '查看本机阅读状态，准备范围并预读整篇文字';
    $('preread-state').textContent = web?'网页预读需要你在网站发送并完成回复；网站对话上下文与本机提要独立。':readingSnapshot?.text || (paper ? '正在核对本机阅读资料，不调用模型…' : '打开 PDF 后查看阅读状态。');
    $('preread-start').disabled = $('preread-rebuild').disabled = !paper || busy || api.chatBusy || planningRead || (api.settings.chatProvider!=='chatgpt-web'&&(!prereadPlan||prereadPlan.key!==key()));
    $('preread-start').textContent = api.settings.chatProvider === 'chatgpt-web' ? '传入预读草稿' : '预读 / 复用提要';
    $('preread-stop').hidden = !busy&&!planningRead;$('preread-stop').textContent=planningRead?'停止准备':'停止预读'; $('preread-open').disabled = !paper;
    const status = paper && api.preread.status.get(key()); if (status) { $('preread-status').textContent = status.text; $('preread-status').classList.toggle('feature-error', !!status.error); }
  }
  async function refreshReadingState() {
    const target = paper, current = key(), rev = ++readingStatusRevision;
    window.clearTimeout(readingCheckTimer);
    if (!target) { readingSnapshot=null;prereadControls();updateScope();return; }
    let value;
    try { value=await api.preread.describe(target); }
    catch(e) { value={state:'unavailable',text:'暂时无法核对本机资料：'+PCore.safeError(e.message)}; }
    if(window.closed||current!==key()||rev!==readingStatusRevision)return;
    readingSnapshot=value;
    if(value.state==='unchecked'&&readingCheckAttempts++<20)readingCheckTimer=window.setTimeout(()=>run(refreshReadingState),500);
    else if(value.state!=='unchecked')readingCheckAttempts=0;
    if(value.state==='stale'&&!api.preread.jobs.has(current)&&!api.preread.status.get(current)?.error){api.preread.status.delete(current);$('preread-status').textContent='旧提要文件仍保留；后续问答不复用已失效的内容。';}
    if(prereadPlan&&value.fingerprint&&value.fingerprint!==prereadPlan.fingerprint){prereadPlan=null;$('preread-plan-info').textContent='PDF 已变化，请重新查看范围与费用。';}
    prereadControls();updateScope();
  }
  async function prereadStatus() {
    await refreshReadingState();
    if(paper&&!api.preread.status.has(key())) $('preread-status').textContent='查看范围不调用模型；点击预读才开始处理。';
  }
  async function preread(rebuild = false) {
    if (!paper) throw new Error('请先打开 PDF。'); const target = paper;
    if (api.settings.chatProvider === 'chatgpt-web') { await api.web.preread(window, target); $('preread-status').textContent = '全文预读草稿已传入，请在网页发送。发送并完成回复后，同一网页对话会继续保留原文上下文。'; return; }
    try { await api.preread.run(target, { rebuild,expected:prereadPlan });if(prereadPlan?.key===target.key)prereadPlan.reusable=true; if (key() === target.key && !api.settings.smartReading) await saveInstant('chat',{ smartReading: true }); }
    finally { await refreshReadingState(); }
  }
  on('chat-preread-open',async()=>{await openReading();locate('preread-section');$('preread-plan').focus({preventScroll:true});});
  on('preread-plan',async()=>{
    if(!paper||planningRead)return;const target=paper,current=key(),controller=new AbortController();planController=controller;planningRead=true;prereadControls();
    $('preread-plan-info').textContent='正在本机准备文字，不调用模型…';
    try{
      if(api.settings.chatProvider==='chatgpt-web'){$('preread-plan-info').textContent='网页预读只传入草稿，需自行在网页发送；插件无法估算网站的额度消耗。';return;}
      const plan=await api.preread.plan(target,{signal:controller.signal});if(key()!==current)return;if(JSON.stringify(plan.config)!==JSON.stringify(prereadConfigSnapshot()))throw new Error('模型已改变，请重新准备预读范围与费用。');prereadPlan=plan;
      const cost=plan.cost,amount=cost?(cost.equivalent?'API 等效 ':'')+(cost.currency==='USD'?'US$':'¥')+cost.low.toPrecision(3)+'–'+cost.high.toPrecision(3):'当前模型没有本机单价，费用未知';
      $('preread-plan-info').textContent=plan.config.model+' · '+plan.pages+'页 · '+plan.characters.toLocaleString()+'字符 · '+plan.batches+'段，含整合约'+plan.requests+'次请求。'+(plan.emptyPages?plan.emptyPages+'页未提取到文字。':'')+'重新预读参考估算：'+amount+'（非费用上限；推理、分词与输出会影响实际消耗）。'+(plan.reusable?'已有有效提要，点击复用不调用模型。':'')+'仅预读可提取文字，不含图表图片。';
    }catch(e){if(key()===current){prereadPlan=null;$('preread-plan-info').textContent=PCore.safeError(e.message);}throw e;}
    finally{planningRead=false;if(planController===controller)planController=null;prereadControls();}
  });
  on('preread-start', () => preread()); on('preread-rebuild', () => preread(true)); on('preread-stop', () => {if(planController)planController.abort();else api.preread.stop(key());});
  on('preread-open', async () => { if (!await api.preread.read(paper)) throw new Error('请先完成模型预读。'); await api.openPaperDocument(paper, 'preread'); });
  async function searchReading(rebuild = false, preview = false) {
    if (readingSearching || !paper) return;
    const target = paper, current = key(), query = $('reading-query').value.trim();
    if (!query && !rebuild) throw new Error('先输入检索词或问题。');
    readingSearching = true; $('reading-search').disabled = $('reading-rebuild').disabled = $('reading-preview').disabled = true; $('reading-status').textContent = '正在本机准备论文索引…';
    try {
      const ids = [target.id, ...comparisonIDs];
      const results = preview ? (await api.previewReading(target.id, query, [...comparisonIDs])).references : await api.searchPapers(rebuild ? [target.id] : ids, query || '研究问题 方法 结果 conclusion', rebuild);
      if (key() !== current || !$('reading-dialog').open) return;
      $('reading-results').replaceChildren(...results.map((ref, i) => sourceCard(ref, preview ? `S${i + 1}` : `结果 ${i + 1}`, current)));
      $('reading-status').textContent = results.length ? `${preview ? '预览' : '找到'} ${results.length} 处原文。页码为 PDF 物理页；可点击跳转或摘录。发送时会结合问题与会话准备材料，手动材料优先。` : '未找到词汇匹配的原文。可尝试英文术语、缩短关键词，或手动附加页面图片。';
    } catch (e) { if ($('reading-dialog').open) $('reading-status').textContent = PCore.safeError(e.message); }
    finally { readingSearching = false; $('reading-search').disabled = $('reading-rebuild').disabled = $('reading-preview').disabled = false; }
  }
  $('smart-reading').addEventListener('change', () => run(() => { if (!$('smart-reading').checked) comparisonIDs.clear(); return saveInstant('chat',{ smartReading: $('smart-reading').checked }); }));
  on('reading-open', openReading); on('compare-open', openReading);
  on('reading-close', () => { api.readingSearchController?.abort(); $('reading-dialog').close(); });
  $('reading-dialog').addEventListener('cancel', () => api.readingSearchController?.abort());
  on('reading-search', () => searchReading()); on('reading-rebuild', () => searchReading(true)); on('reading-preview', () => searchReading(false, true));
  $('reading-query').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(() => searchReading()); } });
  let formulaSource = null, formulaController = null, formulaCapturing = false, formulaInserted = false, formulaInserting = false;
  function formulaSettingsControls() {
    const s = api.settings;
    $('formula-engine').value = s.formulaProvider;
    options($('formula-model'), s.formulaProvider === 'deepseek' ? [['deepseek-flash', 'Flash · 支持图片']] : [['', '选择多模态模型'], ...api.formula.models().map(m => [m.id, m.name])], s.formulaChatGPTModel);
    $('formula-model-hint').textContent = s.formulaProvider === 'deepseek' ? '使用设置中保存的 API Key。Pro 为文字模型，不用于截图识别。' : '请先手动连接 ChatGPT 获取模型目录。未声明图片能力的模型不提供选择，不会自动切换。';
    $('formula-model-label').textContent = PCore.featureModel(s,'formula').label;
  }
  function formulaStatus(text, error = false) { $('formula-status').textContent = text; $('formula-status').classList.toggle('feature-error', error); }
  function formulaControls() {
    const busy = !!formulaController || formulaCapturing || formulaInserting, s = api.settings;
    formulaSettingsControls();
    const hasImage=!!formulaSource,hasResult=!!$('formula-tex').value.trim(),phase=busy?'working':hasResult?'result':hasImage?'ready':'empty';
    if($('formula-dialog').dataset.phase!==phase)$('formula-options').open=phase!=='result';$('formula-acquire').open=true;
    $('formula-dialog').dataset.phase=phase;$('formula-stage').textContent={empty:'获取公式图片',ready:'检查图片，开始识别',working:'正在处理公式',result:'检查与使用公式'}[phase];
    $('formula-result').hidden=!hasImage&&!hasResult&&$('formula-dialog').dataset.manual!=='true';$('formula-recognize').parentElement.hidden=!hasImage;
    $('formula-copy').parentElement.hidden=!hasResult;$('formula-capture-copy').classList.toggle('primary',!hasImage&&!hasResult);
    $('formula-recognize').classList.toggle('primary',hasImage&&!hasResult);$('formula-copy').classList.toggle('primary',hasResult&&!formulaSource);$('formula-insert').classList.toggle('primary',hasResult&&!!formulaSource);
    for (const id of ['formula-capture', 'formula-capture-copy', 'formula-capture-note', 'formula-file', 'formula-settings', 'formula-engine', 'formula-model']) $(id).disabled = busy;
    $('formula-recognize').disabled = busy || !formulaSource;
    $('formula-stop').hidden = !formulaController;
    $('formula-tex').disabled = busy;
    for (const id of ['formula-copy', 'formula-copy-math', 'formula-insert']) $(id).disabled = busy || !$('formula-tex').value.trim() || (id === 'formula-insert' && (!formulaSource || formulaInserted));
  }
  function openFormula() {
    if (!paper) throw new Error('请先打开 PDF，再记公式。');
    tab('notes'); formulaControls(); if (!$('formula-dialog').open) $('formula-dialog').showModal();
  }
  function formulaImage(source) {
    formulaSource = source; formulaInserted = false; $('formula-tex').value = '';
    $('formula-image').src = source.image; $('formula-image').hidden = false;
    $('formula-source').textContent = source.paper.title + (source.page ? ` · PDF 第 ${source.page} 页` : ' · 外部截图');
    $('formula-source').title=$('formula-source').textContent;formulaStatus('截图已就绪，点击「识别此图」。'); formulaControls();
    $('formula-material').open = true;
  }
  async function insertFormula() {
    if (formulaInserted || formulaInserting) return;
    formulaInserting = true; formulaControls();
    try {
      await api.formula.insert($('formula-tex').value, formulaSource);
      formulaInserted = true; formulaStatus('已保存到「' + formulaSource.paper.title + '」的 Markdown 笔记。');
    } finally { formulaInserting = false; formulaControls(); }
  }
  async function recognizeFormula(insert = false, copy = false) {
    if (formulaController || !formulaSource) return;
    const source = formulaSource, controller = new AbortController(); formulaController = controller; formulaControls(); formulaStatus('正在识别公式…');
    try {
      const tex = await api.formula.recognize(source.image, controller.signal, source.paper.key);
      if (controller.signal.aborted) return;
      $('formula-tex').value = tex; formulaInserted = false;
      $('formula-material').open = false;
      if (insert) await insertFormula();
      else if (copy) { api.copyFormula(tex); formulaStatus('TeX 已自动复制，可直接粘贴到笔记。'); $('formula-dialog').close(); notice('公式 TeX 已复制，可直接粘贴到笔记。'); }
      else formulaStatus('识别完成。可修改代码、复制或记入笔记。');
    } catch (e) { formulaStatus(controller.signal.aborted ? '已停止识别，截图保留。' : PCore.safeError(e.message), !controller.signal.aborted); }
    finally { formulaController = null; formulaControls(); }
  }
  async function captureFormula(insert = false, copy = false) {
    if (formulaCapturing || formulaController) return;
    if (!paper) throw new Error('请先打开 PDF。');
    const readerID = paper.id; formulaCapturing = true; formulaControls(); $('formula-dialog').close();
    try {
      notice(PCore.featureModel(api.settings,'formula').label+' · 拖框截取公式，Esc 取消。');
      const source = await api.formula.capture(readerID,{label:'拖框截取公式',modelLabel:PCore.featureModel(api.settings,'formula').label}); notice('');
      if (source) formulaImage(source);
      if (!$('formula-dialog').open) $('formula-dialog').showModal();
      if (source) { formulaCapturing = false; await recognizeFormula(insert, copy); }
      else formulaStatus('已取消截图，没有调用模型。');
    } catch (e) { if (!$('formula-dialog').open) $('formula-dialog').showModal(); formulaStatus(PCore.safeError(e.message), true); }
    finally { formulaCapturing = false; formulaControls(); }
  }
  async function loadFormulaFile(file) {
    if (!file || formulaController || formulaCapturing) return;
    if (!paper) throw new Error('请先打开 PDF。');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 9 * 1048576) throw new Error('请选择不超过 9 MB 的 PNG、JPEG 或 WebP 图片。');
    const target = paper;
    const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片。')); reader.readAsDataURL(file); });
    if (formulaController || formulaCapturing) return;
    formulaImage({ paper: target, image });
  }
  on('formula-open', openFormula);
  on('formula-manual',()=>{$('formula-dialog').dataset.manual='true';$('formula-manual').setAttribute('aria-expanded','true');formulaControls();$('formula-tex').focus();});
  on('formula-close', () => { formulaController?.abort(); $('formula-dialog').close(); });
  $('formula-dialog').addEventListener('cancel', () => formulaController?.abort());
  on('formula-capture', () => captureFormula()); on('formula-capture-note', () => captureFormula(true));
  on('formula-capture-copy', () => captureFormula(false, true));
  on('formula-settings', () => { $('formula-dialog').close(); tab('settings'); locate('settings-formula', 'h3'); });
  on('formula-file', () => $('formula-file-input').click());
  $('formula-file-input').addEventListener('change', () => run(async () => { const file = $('formula-file-input').files[0]; $('formula-file-input').value = ''; await loadFormulaFile(file); }));
  $('formula-dialog').addEventListener('paste', e => { const file = [...(e.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile(); if (file) { e.preventDefault(); run(() => loadFormulaFile(file)); } });
  $('formula-paste').addEventListener('click', () => $('formula-paste').focus());
  on('formula-recognize', () => recognizeFormula()); on('formula-stop', () => formulaController?.abort());
  $('formula-tex').addEventListener('input', () => { formulaInserted = false; formulaControls(); });
  on('formula-copy', () => { api.copyFormula($('formula-tex').value); formulaStatus('已复制 TeX 代码。'); });
  on('formula-copy-math', () => { api.copy('$$\n' + $('formula-tex').value.trim() + '\n$$'); formulaStatus('已复制带 $$ 的 Markdown 公式。'); });
  on('formula-insert', insertFormula);
  $('formula-engine').addEventListener('change', () => run(async () => { await saveInstant('formula',{ formulaProvider: $('formula-engine').value }); formulaControls(); }));
  $('formula-model').addEventListener('change', () => run(async () => { if (api.settings.formulaProvider === 'chatgpt') await saveInstant('formula',{ formulaChatGPTModel: $('formula-model').value }); }));
  function translationFocus() { $('translation-source').open = false; $('translation-settings').open = false; $('tab-translate').scrollTop = 0; }
  async function translate() {
    const text = $("translation-input").value.trim(); if (!text) throw new Error("先选词或粘贴文字。");
    const current = key(); translation = ""; $("translation-result").textContent = "正在翻译…"; $("translate").disabled = true;translationSaveControls();
    try { const value = await api.translate(text, value => { if (key() === current) { $("translation-result").innerHTML = PCore.markdown(value); if (value) translationFocus(); } }, current); if (key() === current) { translation = value; $("translation-result").innerHTML = PCore.markdown(value); translationFocus(); } }
    catch (e) { if (key() === current) $("translation-result").textContent = "翻译未完成。"; throw e; }
    finally { $("translate").disabled = false;if(key()===current)translationSaveControls(); }
  }
  function showTranslation(record) {
    if (!paper || paper.id !== record.selection.readerID) return;
    selected = { ...record.selection, key: paper.key, link: paper.link + '?page=' + record.selection.page };
    $("translation-input").value = record.selection.text;
    translation = record.status === 'complete' ? record.text : '';
    if (record.status === 'pending') $("translation-result").textContent = '正在翻译…';
    else if (record.status === 'error') $("translation-result").textContent = '翻译未完成：' + record.error;
    else { $("translation-result").innerHTML = PCore.markdown(record.text); if (record.text) translationFocus(); }
    translationSaveControls();
  }
  async function activate(action) {
    await refreshPaper(action?.readerID || args.readerID);
    if(action?.action==='model-settings'){await openModelSettings(action.feature);return;}
    if (!action || !paper) return;
    if (action.action === 'formula') { openFormula(); return; }
    if (action.action === 'formula-copy') { tab('notes'); await captureFormula(false, true); return; }
    selected = { ...action, key: paper.key, link: paper.link + "?page=" + action.page };
    if (action.action === "ask") {
      tab("chat");
      revealComposer();
      if (api.settings.chatProvider === "chatgpt-web" && api.web.views.get(window)?.opened) {
        try { await api.web.fill(window, action.text, null); $("prompt").focus(); notice("选文已追加到当前网页对话草稿，尚未发送。"); return; }
        catch (e) { notice("网页暂时无法写入，选文已保留在下方问题框。" + PCore.safeError(e.message), true); }
      } else notice("选文已追加到当前问题框，尚未发送。");
      document.body.classList.remove("web-focus"); $("web-focus").setAttribute("aria-pressed", "false");
      const input = $("prompt"); input.value = (input.value ? input.value + "\n\n" : "") + action.text;
      resizePrompt(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); input.scrollTop = input.scrollHeight;
    }
    if (action.action === "note") { await api.appendExcerpt(action, $("excerpt-style").value); tab("notes"); }
  }
  on("connect", async () => { if (api.state !== "offline") { api.disconnect(); return; } notice("如需授权，请在系统浏览器完成登录。"); await api.connect(); notice(api.state === "online" ? "已取得模型目录。发送成功后可确认模型可用；实际用量见设置。" : ""); });
  on("add-account", async () => { api.disconnect(); await api.connect({ addAccount: true }); });
  on("reauthorize", async () => { api.disconnect(); await api.connect({ reauthorize: true }); });
  on("logout", async () => notice(await api.logout()));
  $("account").addEventListener("change", () => run(() => api.chooseAccount($("account").value)));
  on("web-start", () => { api.web.open(window, $("web-host")); $("web-hint").textContent = "请在网页完成登录并使用 Chat 模式；下方「传入网页草稿」不会自动发送。"; state(); });
  on("web-focus", () => { const focused = document.body.classList.toggle("web-focus"); $("web-focus").setAttribute("aria-pressed", String(focused));control('web-focus',focused?'恢复网页大小':'放大网页',focused?'minimize':'expand',{only:true}); });
  on("web-reload", () => api.web.reload(window));
  on('web-composer-toggle', async () => { await saveInstant('web-options',{ webCompactComposer: !api.settings.webCompactComposer }); if (api.web.views.get(window)?.opened) await api.web.syncPresentation(window); });
  on("web-close", () => { document.body.classList.remove("web-focus"); $("web-focus").setAttribute("aria-pressed", "false");control("web-focus","放大网页","expand",{only:true}); api.web.close(window); $("web-host").textContent = "网页已关闭。有效登录通常会保留在 Zotero 中；点击「打开网页」恢复。"; });
  on("web-external", () => { api.webChat($("prompt").value.trim(), context); notice("已复制文字并打开外部浏览器。图片或 PDF 可从材料预览导出后附加。"); });
  on("web-attach", async () => { const result = await api.web.attach(window, context); notice(`已把 ${result.count} 个文件交给网页附件控件，请等网页显示上传完成后再发送。`); });
  on("usage", () => api.usage.openPlanUsage()); on("web-open", () => api.openURL("https://chatgpt.com/"));
  on("follow", async () => { api.followCurrentReader(); await refreshPaper(api.readerID); });
  $("paper").addEventListener("change", () => run(() => refreshPaper($("paper").value)));
  $("provider").addEventListener("change", () => run(() => chooseProvider($("provider").value)));
  $('chat-effort').addEventListener('change', () => run(() => saveInstant('chat',{ chatGPTEffort: $('chat-effort').value })));
  $("model").addEventListener("change", () => run(() => saveInstant('chat',api.settings.chatProvider === "deepseek" ? { chatDeepseekModel: $("model").value } : { model: $("model").value })));
  $("input-format").addEventListener("change", () => run(async () => {
    const ownerKey=key(),previous=context,format=$("input-format").value;
    await saveInstant('materials',{ pageFormat:format });
    if(key()===ownerKey&&previous&&context===previous&&previous.mode!=='selection'&&previous.mode!=='pdf'){
      attach(null);await api.clearContext(ownerKey);if(key()===ownerKey&&!context)notice("格式已切换，请重新附加材料。");
    }
  }));
  on("fulltext", () => extract("fulltext")); on("page", () => extract("page")); on("pdf", () => extract("pdf"));
  on("range-toggle", () => {
    if (!paper) throw new Error("请先打开 PDF。");
    const hidden = !$("page-range").hidden;
    if (!hidden) {
      const info = api.pdfPageInfo(paper.id);
      if ($("page-range").dataset.paper !== paper.key) { $("range-from").value = info.current; $("range-to").value = info.current; $("page-range").dataset.paper = paper.key; }
      $("range-from").max = $("range-to").max = info.total; $("range-info").textContent = `共 ${info.total} 页 · PDF 物理页码，包含起止页`;
    }
    $("page-range").hidden = hidden; $("range-toggle").setAttribute("aria-expanded", String(!hidden)); document.body.classList.toggle("range-open", !hidden);
  });
  on("read-range", () => extract("range", { from: Number($("range-from").value), to: Number($("range-to").value) }));
  on("clear-context", async () => { attach(null); await api.clearContext(key()); notice("已移除本轮材料；历史问答与材料记录仍保留。"); });
  on("preview-context", () => { if (!context) return; $("context-title").textContent = context.label; $("context-text").textContent = context.text; $("context-images").replaceChildren(); for (const url of context.images || (context.image ? [context.image] : [])) { const img = document.createElement("img"); img.src = url; img.alt = "PDF 页面"; $("context-images").append(img); } $("context-dialog").showModal(); });
  on("export-material", async () => { if (await api.exportMaterials(context)) notice("材料已导出，可在 ChatGPT 网页附加。"); });
  on("close-preview", () => $("context-dialog").close());
  on("send", send); $("prompt").addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault(); if (!e.repeat) run(send);
  });
  on("stop", () => api.stop()); on("translation-stop", () => api.translationController?.abort());
  on("new-chat", async () => { await api.newSession(key()); attach(null); await renderMessages(); });
  let historyKey = '', historyID = '', historyRevision = 0;
  on('chat-history-open', async () => {
    historyKey = key(); historyID = ''; const rev = ++historyRevision;
    $('chat-history-list').replaceChildren(); $('chat-history-preview').replaceChildren(); $('chat-history-restore').hidden = true;
    $('chat-history-dialog').showModal();
    const rows = await api.chatArchives(historyKey);
    if (rev !== historyRevision || !$('chat-history-dialog').open) return;
    if (!rows.length) $('chat-history-list').textContent = '暂无历史对话。点击新对话后，当前会话会保存在这里。';
    for (const row of rows) {
      const button = document.createElement('button'); button.textContent = new Date(row.at).toLocaleString(); button.dataset.archive = row.id;
      button.addEventListener('click', () => run(async () => {
        const current = ++historyRevision; const saved = await api.archivedSession(historyKey,row.id);
        if (current !== historyRevision || !$('chat-history-dialog').open) return;
        historyID = row.id; $('chat-history-preview').replaceChildren();
        for (const m of saved.messages) { const section=document.createElement('section');const label=document.createElement('strong');label.textContent=m.role==='user'?'你':'回答';const body=document.createElement('div');body.innerHTML=PCore.markdown(m.text);section.append(label,body);$('chat-history-preview').append(section); }
        $('chat-history-restore').hidden = false;
      })); $('chat-history-list').append(button);
    }
  });
  on('chat-history-close', () => $('chat-history-dialog').close());
  $('chat-history-dialog').addEventListener('close', () => { historyRevision++; $('chat-history-open').focus(); });
  on('chat-history-restore', async () => {
    if (historyKey !== key()) throw new Error('当前论文已改变，请重新打开历史对话。');
    const button=$('chat-history-restore');button.disabled=true;
    try { await api.restoreSession(historyKey,historyID); if(historyKey===key()){attach(null);await renderMessages();} $('chat-history-dialog').close();notice('已继续历史对话，刚才的会话也已归档。'); }
    finally {button.disabled=false;}
  });
  on("translate", translate);
  $("selection-mode").addEventListener("change", () => run(() => saveInstant('translation-options',{ selectionTranslation: $("selection-mode").value })));
  $("popup-translation").addEventListener('change', () => run(() => saveInstant('translation-options',{ popupTranslation: $("popup-translation").checked })));
  $("translation-engine").addEventListener('change', () => run(async () => { await saveInstant('translation-options',{ translationProvider: $("translation-engine").value }); settings(); }));
  $("translation-model").addEventListener('change', () => run(async () => { await saveInstant('translation-options',api.settings.translationProvider === 'deepseek' ? { deepseekModel: $("translation-model").value } : { translationChatGPTModel: $("translation-model").value }); settings(); }));
  $("translation-effort").addEventListener('change', () => run(() => saveInstant('translation-options',api.settings.translationProvider === 'deepseek' ? { translationEffort: $("translation-effort").value } : { translationChatGPTEffort: $("translation-effort").value })));
  $("highlights-engine").addEventListener('change', () => run(() => saveInstant('summary-options',{ summaryProvider: $("highlights-engine").value })));
  $("highlights-model").addEventListener('change', () => run(() => saveInstant('summary-options',api.settings.summaryProvider === 'deepseek' ? { summaryDeepseekModel: $("highlights-model").value } : { summaryChatGPTModel: $("highlights-model").value })));
  $("highlights-effort").addEventListener('change', () => run(() => saveInstant('summary-options',api.settings.summaryProvider === 'deepseek' ? { summaryEffort: $("highlights-effort").value } : { summaryChatGPTEffort: $("highlights-effort").value })));
  async function setHighlights(enabled) { await settingsPanel.immediate('summary-options',()=>api.insights.setEnabled(paper,enabled),'autoHighlights'); await refreshHighlights(); }
  on('highlights-toggle', () => setHighlights(!api.insights.enabled(key())));
  $("highlights-enabled").addEventListener('change', () => run(async () => { try { await setHighlights($("highlights-enabled").checked); } finally { featureControls(); } }));
  on('view-highlights', async () => { tab('highlights'); insightPage('highlights'); await refreshHighlights(); });
  on('highlights-now', async () => {
    await api.insights.manualUpdate(paper, window);
    await refreshHighlights();
  });
  on('highlights-export', async () => { if (!paper) throw new Error('请先打开 PDF。'); const target = paper; await api.exportNote({ ...target, title: target.title + '-聊天重点' }, await api.insights.read(target)); });
  on('review-now', async () => { await api.insights.review(paper); await refreshHighlights(); });
  on('review-export', async () => { if (!paper) throw new Error('请先打开 PDF。'); const target = paper, value = await api.insights.readReview(target); await api.exportNote({ ...target, title: target.title + '-重点再整理' }, value.text); });
  on("translation-copy", () => api.copy(translation));
  function translationSaveControls() {
    const scope=$('translation-save-scope').value,labels={source:'原文',translation:'译文',both:'双语'},formats={plain:'普通文字',quote:'引用',code:'代码块',markdown:'保留排版'};
    $('translation-source-style-label').hidden=scope==='translation';$('translation-note-style-label').hidden=scope==='source';
    $('translation-note').textContent='保存'+labels[scope];
    $('translation-note').disabled=!paper||(scope!=='source'&&!translation)||(scope!=='translation'&&!$('translation-input').value.trim());
    const format=(scope==='translation'?'':('原文 · '+formats[$('translation-source-style').value]))+(scope==='both'?'；':'')+(scope==='source'?'':'译文 · '+formats[$('translation-note-style').value]);
    $('translation-save-summary').textContent='保存格式 · '+format;
    $('translation-save-hint').textContent='只写入所选内容。原文格式与笔记页、划词浮窗的摘录偏好同步；译文格式独立保存。';
  }
  on("translation-note", () => { const scope=$('translation-save-scope').value;appendNote(PCore.translationExcerpt({source:$('translation-input').value,translation,scope,sourceStyle:$('translation-source-style').value,translationStyle:$('translation-note-style').value}),{host:$('translation-note-receipt')}); });
  $('translation-save-scope').addEventListener('change',translationSaveControls);
  $('translation-input').addEventListener('input',translationSaveControls);
  $('translation-source-style').addEventListener('change',()=>run(()=>saveInstant('notes-options',{excerptStyle:$('translation-source-style').value})));
  $('translation-note-style').addEventListener('change', () => run(() => saveInstant('notes-options',{ translationExcerptStyle: $('translation-note-style').value })));
  $("note-editor").addEventListener("input", () => run(() => noteUI.source($("note-editor").value)));
  $("excerpt-style").addEventListener("change", () => run(() => saveInstant('notes-options',{ excerptStyle: $("excerpt-style").value })));
  $("auto-record").addEventListener("change", () => run(() => saveInstant('notes-options',{ autoRecord: $("auto-record").checked })));
  on("insert-quote", async () => { const value = selected || api.lastSelection; if (!paper || !value || value.readerID !== paper.id) throw new Error("请先在当前 PDF 中划选一段原文。"); await api.appendExcerpt(value, $("excerpt-style").value); });
  function noteSource(open) { $('note-source').hidden=!open;$('note-preview').hidden=open;document.querySelector('.note-render-label').hidden=open;control('toggle-note-source',open?'收起源码':'Markdown 源码','chevron',{disclosure:true});$('toggle-note-source').setAttribute('aria-expanded',String(open)); }
  on("toggle-note-source", () => {const open=$('note-source').hidden;if(open)findNote(true);noteSource(open);(open?$('note-editor'):$('note-preview')).focus({preventScroll:true});});
  on('note-undo', () => { noteUI.undo(); notice('已撤销笔记修改。'); }); on('note-redo', () => { noteUI.redo(); notice('已重做笔记修改。'); });
  on('note-clear', async () => {
    if (!paper) throw new Error('请先打开 PDF。'); if (!noteText) { notice('这篇笔记已经为空。'); return; }
    const target = paper, current = key();
    if (!api.confirmClear(target, window)) return;
    if (key() !== current) return;
    const backup = await api.backupNote(target);
    if (key() !== current || noteText !== backup.text) throw new Error('笔记在备份期间发生变化，已保留内容，请重新清空。');
    api.rememberClear(current, backup.text); noteUI.clear(); notice('已清空本篇笔记，可撤销；原内容已保存到本机备份文件夹。');
  });
  on('note-restore-clear', () => api.restoreClearedNote(paper));
  function findNote(open = !$("note-find").hidden) {
    $("note-find").hidden = open; $("note-find-toggle").setAttribute('aria-expanded', String(!open));
    if (!open) { noteSource(false); $("note-query").focus({preventScroll:true}); $("note-query").select(); }
  }
  on('note-find-toggle', () => findNote());
  $("note-query").addEventListener('input', () => noteUI.search($("note-query").value, $("note-case").checked));
  $("note-case").addEventListener('change', () => noteUI.search($("note-query").value, $("note-case").checked));
  $("note-query").addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(() => noteUI.next(e.shiftKey ? -1 : 1)); } });
  on('note-find-next', () => noteUI.next()); on('note-find-prev', () => noteUI.next(-1));
  on('note-replace-one', () => noteUI.replaceOne($("note-replacement").value));
  on('note-replace-all', () => { const count = noteUI.replaceAll($("note-replacement").value); notice(`已替换 ${count} 处，可撤销。`); });
  $("tab-notes").addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.isComposing) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); e.stopPropagation(); findNote(false); }
    if (k === 's') { e.preventDefault(); e.stopPropagation(); run(() => api.flushNotes()); }
    if (['z', 'y'].includes(k) && !e.target.matches('textarea,input')) { e.preventDefault(); e.stopPropagation(); run(() => e.shiftKey || k === 'y' ? noteUI.redo() : noteUI.undo()); }
  });
  on("export-note", async () => { if (!paper) throw new Error("先打开 PDF。"); await api.exportNote(paper, noteText); });
  async function openDocument(kind) {
    const result = await api.openPaperDocument(paper, kind);
    notice(result.revealed ? '已在文件夹中定位原文件，可选择 Markdown 编辑器打开。' : '已打开自动保存的 Markdown 文件。');
  }
  on('note-file-open', () => openDocument('note'));
  on('highlights-file-open', () => openDocument('summary'));
  on('review-file-open', () => openDocument('review'));
  on('highlights-folder', () => api.revealNotes(paper));
  on("native-note", async () => { if (!paper) throw new Error("先打开 PDF。"); await api.addZoteroNote(paper, noteText); notice("已另存为 Zotero 子笔记。"); });
  on("notes-folder", () => api.revealNotes(paper));
  on('paper-folder-open', () => api.revealNotes(paper));
  on('paper-folder-change', () => changeFolder(false));
  on('paper-folder-default', () => changeFolder(true));
  function closePopovers(except = '') {
    $('note-manage').open=false;
    for (const [content, toggle] of [['quick-menu','quick-toggle'],['screenshot-options','screenshot-options-toggle'],['web-more-menu','web-more-toggle']]) {
      if (content === except) continue;
      $(content).hidden = true; $(toggle).setAttribute('aria-expanded','false');
    }
    if (except !== 'organization-menu') $('organization-menu').open = false;
    if(except!=='reading-scope'&&readingScopeUI)readingScopeUI.disclosure.open=false;
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    const active = !$('quick-menu').hidden ? 'quick-toggle' : !$('screenshot-options').hidden ? 'screenshot-options-toggle' : !$('web-more-menu').hidden ? 'web-more-toggle' : $('organization-menu').open ? 'organization-menu' : readingScopeUI?.disclosure.open?'reading-scope': '';
    if (!active) { if (readingFocus) { e.preventDefault(); setReadingFocus(false); $('chat-focus').focus(); } return; }
    e.preventDefault(); closePopovers(); (active==='reading-scope'?readingScopeUI.summary:active === 'organization-menu' ? $(active).querySelector('summary') : $(active)).focus({preventScroll:true});
  });
  document.addEventListener('click', e => {
    const keep = e.target.closest?.('#quick-menu,#quick-toggle') ? 'quick-menu' : e.target.closest?.('#screenshot-options,#screenshot-options-toggle') ? 'screenshot-options' : e.target.closest?.('#web-more-menu,#web-more-toggle') ? 'web-more-menu' : e.target.closest?.('#organization-menu') ? 'organization-menu' : e.target.closest?.('.reading-scope')?'reading-scope': '';
    closePopovers(keep);
  });
  on("quick-toggle", () => { const hidden=!$('quick-menu').hidden;$('quick-menu').hidden=hidden;$('quick-toggle').setAttribute('aria-expanded',String(!hidden));if(hidden)return;const room=document.querySelector('.composer').getBoundingClientRect().top-$('tab-chat').getBoundingClientRect().top-8;$('quick-menu').style.maxHeight=Math.max(48,Math.min(320,room))+'px';$('quick-list').replaceChildren();for(const question of api.settings.quickQuestions){const b=document.createElement('button');b.textContent=question;b.addEventListener('click',()=>{$('prompt').value=question;$('quick-menu').hidden=true;$('quick-toggle').setAttribute('aria-expanded','false');resizePrompt();$('prompt').focus({preventScroll:true});});$('quick-list').append(b);} });
  on("edit-questions", () => { tab("settings"); locate('settings-questions','h3'); $("quick-questions").focus({preventScroll:true}); });
  document.addEventListener("click", e => { const link = e.target.closest?.("a"); if (link) { e.preventDefault(); api.openURL(link.getAttribute("href")); } });
  control('quick-toggle','常用问题','sparkles');
  readingScopeUI=new PCReadingScopeUI({document,host:$('reading-scope-host'),input:scopeInput,onChange:value=>{includePrimaryChoice=value;}});
  noteReceiptUI=new PCNoteReceiptUI({document,insertions:api.noteInsertions,current:()=>({key:key(),text:noteText,ready:!!paper&&noteReady}),
    write:(text,ownerKey)=>{if(key()!==ownerKey)throw new Error('当前论文已切换，请回到原论文。');updateNote(text);},flush:ownerKey=>api.flushNote(ownerKey),
    view:({key:ownerKey,from,to})=>{if(key()!==ownerKey)throw new Error('当前论文已切换。');if($('reading-dialog').open)$('reading-dialog').close();tab('notes');
      if(!$('note-source').hidden){const source=$('note-editor');source.focus({preventScroll:true});source.setSelectionRange(from,from);const line=parseFloat(getComputedStyle(source).lineHeight)||22;source.scrollTop=Math.max(0,(noteText.slice(0,from).split('\n').length-2)*line);}
      else if(!noteUI.revealSourceRange(from,to))throw new Error('无法定位这次摘记。');},notify:notice});
  actionGuide=new PCActionGuide({document,openButton:$('action-guide-open'),shortcutsHost:$('guide-shortcuts'),hintHost:$('guide-empty-hint'),getState:guideState,
    readPrefs:()=>({pins:api.settings.actionGuidePins,dismissed:api.settings.actionGuideDismissed}),
    savePrefs:patch=>api.saveSettings({...('pins'in patch?{actionGuidePins:patch.pins}:{}),...('dismissed'in patch?{actionGuideDismissed:patch.dismissed}:{})}),
    notify:error=>notice(PCore.safeError(error.message),true),actions:[
      {id:'questions',label:'常用问题',description:'选择一个阅读问题，填入草稿后再由你发送。',pages:['chat'],run:()=>{tab('chat');revealComposer();if($('quick-menu').hidden)$('quick-toggle').click();}},
      {id:'screenshot',label:'截图提问',description:'框选当前 PDF，先附加图片，再输入问题。',pages:['chat'],available:s=>s.paperAvailable&&!sending&&!extracting,run:()=>{tab('chat');revealComposer();$('screenshot-ask').click();}},
      {id:'formula',label:'记公式',description:'打开公式工具，可截图识别、编辑或复制 TeX。',pages:['chat','notes'],available:s=>s.paperAvailable,run:()=>openFormula()},
      {id:'notes',label:'阅读笔记',description:'直接编辑并自动保存当前论文的 Markdown 笔记。',pages:['chat','translate','notes'],available:s=>s.paperAvailable,run:()=>{tab('notes');$('note-preview').focus({preventScroll:true});}},
      {id:'highlights',label:'聊天重点',description:'查看或手动更新本篇聊天重点及重点再整理。',pages:['chat','highlights'],available:s=>s.paperAvailable,run:()=>{tab('highlights');insightPage('highlights');}},
      {id:'vocabulary',label:'单词本',description:'查看个人词库，按本篇或全部单词查找。',run:()=>openVocabularyPage()},
      {id:'practice',label:'单词复习',description:'遮挡释义自测，查看答案后记录掌握情况。',pages:['vocabulary','chat'],run:()=>openVocabularyPage(true)}
    ]});
  const unsubscribe = api.subscribe(event => {
    if(event.type==='appearance')settleMotions();
    if (event.type === 'noteClear' && paper?.key === event.key) featureControls();
    if (event.type === 'preread' && paper?.key === event.key) { prereadControls();if(!api.preread.jobs.has(key()))run(refreshReadingState); }
    if (event.type === 'readingReady' && paper?.key === event.key) run(refreshReadingState);
    if(event.type==='readingScope')readingScopeUI.accept(event);
    if(event.type==='settingsRefreshError')notice('设置已保存；划词浮窗暂未刷新，可重新划选后查看。',true);
    if (event.type === "usage") usageUI.refresh();
    if (["connection","settings","busy"].includes(event.type)) state();
    if (event.type === 'settings') { if(prereadPlan&&JSON.stringify(prereadPlan.config)!==JSON.stringify(prereadConfigSnapshot())){prereadPlan=null;$('preread-plan-info').textContent='模型已改变，请重新查看范围与费用。';prereadControls();} settings(); run(refreshHighlights); }
    if (event.type === "activate" && (!event.targetPanel || event.targetPanel === window)) run(() => activate(event.action));
    if (event.type === "selection" && paper?.id === event.selection.readerID) { selected = { ...event.selection, key: paper.key, link: paper.link + "?page=" + event.selection.page }; $("translation-input").value = selected.text; translation = ''; $("translation-result").textContent = api.settings.selectionTranslation === 'auto' ? '等待划词自动翻译…' : '点击选区浮窗或本页的翻译按钮。'; }
    if (event.type === "translation") showTranslation(event);
    if (event.type === 'translationBusy') $('translation-stop').disabled = !event.busy;
    if (event.type === "noteUpdated" && noteReady && paper?.key === event.key) { noteText = event.text; $("note-editor").value = noteText; renderNote();noteReceiptUI.update(); }
    if (['sessionSaved','sessionSaveFailed'].includes(event.type)&&event.key===key())chatSaveControls();
    if(event.type==='noteExternalBackup'&&paper?.key===event.key)notice('检测到 Markdown 的外部修改，已先备份到论文文件夹的 backups，再保存当前编辑。');
    if (event.type === "noteSaved" && paper?.key === event.key) {$("save-status").textContent = "已自动保存";noteReceiptUI.update();}
    if (event.type === "error") notice(event.message, true);
    if (event.type === 'reading') { if (sending) notice(event.text); if ($('reading-dialog').open) $('reading-status').textContent = event.text; }
    if (event.type === 'highlights' && paper?.key === event.key) featureControls();
    if (['highlightsUpdated', 'reviewUpdated'].includes(event.type) && paper?.key === event.key) { highlightsRevision++; if (event.text) { if (event.type === 'highlightsUpdated') { highlightsText = event.text; PCUI.document($('highlights-document'),event.text); } else PCUI.document($('review-document'),event.text); } run(refreshHighlights); }
    if (event.type === 'review' && paper?.key === event.key) featureControls();
    if (event.type === 'paperFolder' && paper?.key === event.key) featureControls();
    if (event.type === 'paperFolderUpdated' && paper?.key === event.key) { run(refreshFolder); run(refreshHighlights); run(refreshReadingState); }
  });
  window.addEventListener('focus',()=>{readingCheckAttempts=0;run(refreshReadingState);});
  window.addEventListener("unload", () => { for(const [node,record]of folding)finishFold(node,record);pageMotion?.cancel();appearance.reduce.removeEventListener('change',settleMotions);window.clearTimeout(noticeTimer);chatView.destroy();promptDrafts.clear();appearance.destroy();settingsPanel.destroy();readingScopeUI.destroy();noteReceiptUI.destroy();actionGuide.destroy();uninstallReviewUI.destroy();vocabularyUI.destroy(); vocabularyUnsubscribe(); window.clearInterval(vocabularyTimer);window.clearTimeout(readingCheckTimer); api.sidebar?.setReadingFocus(window, false); mathObserver.disconnect(); planController?.abort(); formulaController?.abort(); if (formulaCapturing) api.formula.cancelCapture?.(); unsubscribe(); api.panelClosed(window); }, { once: true });
  window.paperCompanionActivate = activate;
  state(); settings(); await run(() => settingsPanel.refreshKeyState()); await run(() => activate(args.action));
  while (args.embedded && args.readerID && paper?.id !== args.readerID) {
    const readerID = args.readerID; await run(() => activate({ readerID })); if (args.readerID === readerID) break;
  }
  document.body.dataset.ready = "true";
})().catch(error => { document.body.dataset.initError = error.message; const notice = document.getElementById('notice'); notice.hidden = false; notice.textContent = '界面加载失败：' + error.message; });
