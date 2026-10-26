// Disposable registered-sidebar check. Synthetic messages; no real model calls.
function startup() {
 (async()=>{
  const output='__OUTPUT__',results=[],shots=[];let debug=()=>({}),lastFit=null;
  const check=(ok,label,detail)=>{if(!ok)throw Error(label+' '+JSON.stringify(detail||''));results.push(label);};
  const wait=async(fn,label)=>{for(let i=0;i<240;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('Timeout '+label);};
  const pause=()=>Zotero.Promise.delay(160);
  try {
   await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion,'plugin');
   const pc=Zotero.PaperCompanion,main=Zotero.getMainWindow();main.resizeTo(1600,1040);let requests=0,copied=null;
   pc.request=async()=>{requests++;throw Error('Chat layout checks stay offline');};pc.copy=text=>{copied=text;};
   await pc.saveSettings({chatProvider:'deepseek',chatDeepseekModel:'deepseek-v4-pro',smartReading:false,headerCollapsed:true,chatOptionsCollapsed:true,materialsCollapsed:true});await pc.saveAppearance({theme:'cloud',appearanceMotion:'off'});
   const parent=new Zotero.Item('journalArticle');parent.setField('title','具身智能中的主动感知：研究方法与实验依据');await parent.saveTx();
   const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});await Zotero.Reader.open(item.id);const paper=await pc.paperInfo(item.id),session=await pc.session(paper.key);
   const answer='理解取决于信息质量、任务相关性与模型的归纳能力。\n\n阅读时应核对证据是否充分，而不只统计观测数量。';
   session.messages=[
    {role:'user',text:'观测越多，理解就越好吗？',status:'complete',at:1},
    {role:'assistant',provider:'chatgpt',model:'gpt-6.1-sol',text:answer,status:'complete',at:2},
    {role:'user',text:'这段尚未完成的问题保留了原材料说明。',context:'原始 PDF · 2 页 · 演示资料',status:'cancelled',at:3},
    {role:'assistant',text:'这是一条没有保存模型信息的历史回答。',status:'complete',at:4},
    {role:'assistant',provider:'deepseek',model:'deepseek-flash',text:'这段回答已停止，内容仍可复制。',status:'cancelled',at:5},
    {role:'assistant',provider:'deepseek',text:'',error:'演示错误：本次回答未完成。',status:'failed',at:6},
    {role:'assistant',provider:'deepseek',model:'deepseek-flash',text:'',status:'pending',at:7}
   ];await pc.saveSession(paper.key);await pc.openPanel({readerID:item.id});await wait(()=>pc.panel?.document?.body?.dataset.ready==='true','registered sidebar');
   const win=pc.panel,doc=win.document,$=id=>doc.getElementById(id),frame=win.frameElement,normalWidth=frame.style.width;
   const articles=()=>Array.from($('messages').querySelectorAll('article.message'));
   await wait(()=>articles().length===session.messages.length,'synthetic conversation');await doc.fonts.ready;
   const question=articles()[0],first=articles()[1],legacy=articles()[3],cancelled=articles()[4],failed=articles()[5],pending=articles()[6];
   const action=(article,label)=>Array.from(article.querySelectorAll('.message-actions button')).find(b=>b.textContent.trim()===label);
   const detail=article=>action(article,'详情'),info=article=>article.querySelector('.message-model-info');
   debug=()=>({uri:doc.documentURI,width:win.innerWidth,height:win.innerHeight,theme:doc.documentElement.dataset.pcTheme,notice:$('notice').textContent,articles:articles().length,detail:detail(first)?.getAttribute('aria-expanded'),lastFit});
   check(pc.sidebar.frames.has(frame),'chat is rendered in the actual registered Zotero sidebar');
   check(!$('messages').querySelector('.message-label'),'sender headings no longer occupy conversation space');
   check(articles().every((n,i)=>n.getAttribute('aria-label')===(session.messages[i].role==='user'?'你的提问':'AI 回答')),'screen-reader names still distinguish questions and answers');
   check(question.firstElementChild.classList.contains('message-body')&&first.firstElementChild.classList.contains('message-body'),'question and answer content begin without a redundant heading');
   check(win.getComputedStyle(question.querySelector('.message-body')).backgroundColor!==win.getComputedStyle(first.querySelector('.message-body')).backgroundColor,'user bubble remains visually distinct from the assistant body');
   check(info(first)?.hidden&&detail(first)?.getAttribute('aria-expanded')==='false','recorded model information is collapsed by default');
   detail(first).click();await pause();check(!info(first).hidden&&detail(first).getAttribute('aria-expanded')==='true','answer details open without changing the message body');
   check(doc.getElementById(detail(first).getAttribute('aria-controls'))===info(first),'details control points to its own accessible information');
   check(info(first).textContent.includes('gpt-6.1-sol')&&info(first).textContent.includes('ChatGPT')&&!info(first).textContent.includes('deepseek-v4-pro'),'details show the stored answer model rather than the current selection');
   detail(first).click();check(info(first).hidden&&detail(first).getAttribute('aria-expanded')==='false','answer details can collapse again');
   detail(legacy).click();check(!info(legacy).hidden&&info(legacy).textContent.includes('未记录')&&!/ChatGPT|DeepSeek/.test(info(legacy).textContent),'legacy answers explicitly mark missing model metadata without guessing');detail(legacy).click();
   check(articles()[2].querySelector('.message-error')?.textContent.includes('已停止')&&cancelled.querySelector('.message-error')?.textContent.includes('已停止')&&articles()[2].querySelector('.message-context')?.textContent.includes('演示资料'),'stopped turns retain their state and material explanation');
   check(failed.querySelector('.message-error')?.textContent.includes('演示错误'),'failed answers retain their error explanation');
   check(pending.querySelector('.message-body').textContent.includes('正在思考'),'empty pending answers keep their progress placeholder');
   action(first,'复制').click();await wait(()=>copied===answer,'answer copy');check(copied===answer,'copy still returns only the answer text');
   action(first,'记入笔记').click();
   // Note persistence is asynchronous; do not assume a click completed the save.
   for(let i=0;i<120&&!(await pc.note(paper)).includes(answer);i++)await Zotero.Promise.delay(50);
   check((await pc.note(paper)).includes(answer),'answer excerpt still saves to this paper note');
   $('nav-chat').click();await wait(()=>$('tab-chat').classList.contains('active')&&$('messages').getBoundingClientRect().width>0,'return to the conversation after saving a note');
   const body=first.querySelector('.message-body');await pc.saveSettings({chatDeepseekModel:'deepseek-flash'});await pause();
   detail(first).click();check(info(first).textContent.includes('gpt-6.1-sol')&&!info(first).textContent.includes('deepseek-flash'),'changing the next model does not relabel a previous answer');detail(first).click();
   check(articles()[1]===first&&first.querySelector('.message-body')===body,'settings updates retain existing answer DOM');
   const measure=node=>{const s=win.getComputedStyle(node);return {rect:node.getBoundingClientRect().toJSON(),clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,scrollLeft:node.scrollLeft,scrollTop:node.scrollTop,hidden:node.hidden,isConnected:node.isConnected,display:s.display,visibility:s.visibility,overflowX:s.overflowX,overflowY:s.overflowY,whiteSpace:s.whiteSpace,overflowWrap:s.overflowWrap,boxSizing:s.boxSizing};};
   const fit=()=>{
    const box=first.getBoundingClientRect(),buttons=Array.from(first.querySelectorAll('.message-actions button')).map(b=>{const value=measure(b),r=value.rect;return {text:b.textContent.trim(),...value,withinArticle:r.left>=box.left-1&&r.right<=box.right+1,withinViewport:r.left>=-1&&r.right<=win.innerWidth+1};});
    const articleFits=first.scrollWidth<=first.clientWidth+1,buttonsFit=buttons.every(b=>b.rect.width>0&&b.withinArticle&&b.withinViewport),infoFits=info(first).scrollWidth<=info(first).clientWidth+1;
    lastFit={articleFits,buttonsFit,infoFits,viewport:{innerWidth:win.innerWidth,innerHeight:win.innerHeight,rootClientWidth:doc.documentElement.clientWidth,rootScrollLeft:doc.documentElement.scrollLeft,bodyScrollLeft:doc.body.scrollLeft,dpr:win.devicePixelRatio},messageIsCurrent:articles()[1]===first,article:measure(first),body:measure(first.querySelector('.message-body')),info:measure(info(first)),actions:measure(first.querySelector('.message-actions')),buttons,messages:measure($('messages')),frameRect:frame.getBoundingClientRect().toJSON()};
    return articleFits&&buttonsFit&&infoFits;
   };
   for(const theme of ['cloud','blue','warm','dark']) {
    await pc.saveAppearance({theme});await pause();check(doc.documentElement.dataset.pcTheme===theme&&!$('messages').querySelector('.message-label'),'sender-free conversation follows '+theme);
    frame.style.width=normalWidth;await pause();first.scrollIntoView({block:'center'});detail(first).click();await pause();check(fit(),theme+' normal sidebar fits answer actions and expanded information',lastFit);detail(first).click();
    frame.style.width='260px';await wait(()=>win.innerWidth===260,'narrow sidebar');first.scrollIntoView({block:'center'});detail(first).click();await pause();check(fit(),theme+' narrow sidebar fits answer actions and expanded information',lastFit);detail(first).click();
   }
   await pc.saveAppearance({theme:'cloud'});frame.style.width=normalWidth;await pause();$('messages').scrollTop=0;
   const capture=async name=>{await pause();const c=doc.createElement('canvas'),scale=win.devicePixelRatio;c.width=Math.round(win.innerWidth*scale);c.height=Math.round(win.innerHeight*scale);c.getContext('2d').scale(scale,scale);c.getContext('2d').drawWindow(win,0,0,win.innerWidth,win.innerHeight,'white');const path=PathUtils.join(PathUtils.parent(output),name+'.png');await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),x=>x.charCodeAt(0)));shots.push(path);};
   await capture('chat-without-sender-headings');frame.style.width='260px';await wait(()=>win.innerWidth===260,'detail screenshot width');detail(first).click();$('messages').scrollTop=0;await capture('chat-model-details-narrow');
   check(articles().length===session.messages.length&&action(first,'记入笔记')&&action(first,'复制')&&$('send'),'conversation state and core actions remain available');
   check(requests===0,'all chat presentation checks stay local without a provider request');
   await IOUtils.writeUTF8(output,JSON.stringify({ok:true,results,shots,viewport:{width:win.innerWidth,height:win.innerHeight,dpr:win.devicePixelRatio}},null,2));
  } catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results,shots},null,2));}
  finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
 })();
}
function shutdown(){}function install(){}function uninstall(){}
