// Actual Gecko windows, synthetic papers, local-only vocabulary UX regressions.
var vocabularyTestChrome;
function startup({rootURI}) {
  vocabularyTestChrome=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','paper-companion-audit','content/']]);
  (async()=>{
    const output='__OUTPUT__',results=[],shots=[],geometry=[];let debug=()=>({}),captureFailure=async()=>{};
    const check=(ok,label,detail)=>{if(!ok)throw Error(label+' '+JSON.stringify(detail||''));results.push(label);};
    const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('Timeout: '+label);};
    const pause=()=>Zotero.Promise.delay(80);
    const capture=async(win,name)=>{
      await pause();await win.document.fonts.ready;
      const c=win.document.createElement('canvas');c.width=win.innerWidth;c.height=win.innerHeight;
      c.getContext('2d').drawWindow(win,0,0,c.width,c.height,'white');
      const path=PathUtils.join(PathUtils.parent(output),name+'.png');
      await IOUtils.write(path,Uint8Array.from(atob(c.toDataURL().split(',')[1]),x=>x.charCodeAt(0)));shots.push(path);
    };
    const pointerClick=async(node)=>{
      node.scrollIntoView({block:'nearest'});await pause();const r=node.getBoundingClientRect(),win=node.ownerDocument.defaultView;
      const x=r.left+r.width/2,y=r.top+r.height/2,hit=node.ownerDocument.elementFromPoint(x,y);
      check(hit===node||node.contains(hit),'native pointer target is unobscured: '+(node.dataset.action||node.textContent));
      win.windowUtils.sendMouseEvent('mousedown',x,y,0,1,0);win.windowUtils.sendMouseEvent('mouseup',x,y,0,1,0);await pause();
    };
    try{
      await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');
      await wait(()=>Zotero.PaperCompanion,'plugin');const pc=Zotero.PaperCompanion,main=Zotero.getMainWindow(),book=pc.vocabulary;
      let requests=0;pc.request=async()=>{requests++;throw Error('This regression must remain offline');};
      Services.prefs.setIntPref('ui.prefersReducedMotion',1);
      await pc.saveSettings({vocabularyGenerateOnAdd:false,vocabularyContextFallback:'none'});
      const parent=new Zotero.Item('journalArticle');parent.setField('title','Vocabulary usability source');await parent.saveTx();
      const attachment=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});
      await Zotero.Reader.open(attachment.id);
      for(const [word,meaning]of [['feedback','反馈'],['trajectory','轨迹；运动物体随时间经过的路径'],['pneumonoultramicroscopicsilicovolcanoconiosis','一种很长的示例释义，必须在自己的列中换行，不把中文移到词头下方。'.repeat(3)]]){
        const c=await book.add({text:word,readerID:attachment.id,page:1});
        await book.edit(c.id,{meaning,defaultMeaning:meaning,sentence:'Local context for '+word+'.',sentenceTranslation:'用于检查排版的合成句子。'});
      }
      // Use an actual embedded content frame and pointer input, not a direct
      // privileged call to the opener as in the original vocabulary suite.
      const holder=main.openDialog('chrome://paper-companion-audit/content/viewport.xhtml','','chrome,dialog=no,resizable,width=440,height=850');
      await wait(()=>holder.document?.documentURI==='chrome://paper-companion-audit/content/viewport.xhtml'&&holder.document.readyState==='complete'&&holder.document.body,'viewport');
      const frame=holder.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');frame.style.cssText='display:block;border:0;width:340px;height:760px';
      Cu.waiveXrays(frame).paperCompanionArgs={api:pc,embedded:true,readerID:attachment.id};frame.src='chrome://paper-companion/content/panel.xhtml';holder.document.body.append(frame);
      debug=()=>({url:frame.contentDocument?.URL,initError:frame.contentDocument?.body?.dataset.initError,notice:frame.contentDocument?.getElementById('notice')?.textContent});
      await wait(()=>frame.contentDocument?.body?.dataset.ready==='true','embedded panel');
      const panel=frame.contentDocument;panel.getElementById('nav-vocabulary').click();
      const popout=panel.querySelector('[data-action=vocabulary-popout]');await pointerClick(popout);
      await wait(()=>pc.vocabularyWindow?.pcVocabularyUI,'pointer-opened word window');
      let win=pc.vocabularyWindow,ui=win.pcVocabularyUI,root=ui.root;
      captureFailure=()=>capture(win,'failure-state');
      debug=()=>({url:win?.location.href,title:win?.document.title,ready:win?.document.body?.dataset.vocabularyReady,error:win?.document.body?.dataset.vocabularyError,text:win?.document.body?.textContent.slice(0,600)});
      check(win.document.title.includes('单词本')&&win.document.body.dataset.vocabularyReady==='true','sidebar pointer opens a titled, ready vocabulary window');
      const sameRow=()=>{
        const card=root.querySelector('.vocab-entry'),line=card.querySelector('.vocab-card-main'),word=card.querySelector('.vocab-word'),answer=card.querySelector('.vocab-answer'),arrow=card.querySelector('.vocab-details>summary');
        const w=word.getBoundingClientRect(),a=answer.getBoundingClientRect(),s=arrow.getBoundingClientRect(),l=line.getBoundingClientRect();
        check(w.right<=a.left+1&&Math.min(w.bottom,a.bottom)>Math.max(w.top,a.top),'English and Chinese occupy the same horizontal row');
        check(s.width>=32&&s.height>=32&&s.top>=l.top&&s.bottom<=l.bottom+1,'expand arrow is a fixed reachable target inside the primary row');
        check(root.scrollWidth<=root.clientWidth+1&&ui.content.scrollWidth<=ui.content.clientWidth+1,'vocabulary fits the viewport without horizontal scrolling');
        const search=ui.search.getBoundingClientRect(),bounds=card.getBoundingClientRect(),scrollbar=ui.content.offsetWidth-ui.content.clientWidth;
        check(Math.abs(bounds.left-search.left)<1&&bounds.width>=search.width-scrollbar-1,'word rows use the search field width instead of a narrower centered column');
        return {wordY:w.top-l.top,arrowX:s.left-l.left,arrowY:s.top-l.top,height:l.height};
      };
      const meaningOrigin=()=>{
        const answer=root.querySelector('[data-key=feedback] .vocab-answer'),node=answer.querySelector('.vocab-definition')||answer.querySelector('.vocab-cover');
        const range=win.document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect(),slot=answer.getBoundingClientRect();
        // Full-mode contexts above this entry legitimately lose their Chinese
        // paragraphs during recall. Compare the text inside its own stable slot,
        // not the resulting document position of a later word.
        return {left:rect.left-slot.left,top:rect.top-slot.top,screenLeft:rect.left,screenTop:rect.top};
      };
      for(const width of [920,520,340,260]){
        win.resizeTo(width,760);await pause();
        for(const view of ['cards','rows']){
          (view==='cards'?ui.all:ui.rows).click();
          for(const density of ['minimal','full']){
            root.querySelector('[data-action=presentation-'+density+']').click();await pause();
            check(root.querySelectorAll('.vocab-card').length===3,'both densities and orders share one entry structure');
            check(root.querySelectorAll('.vocab-details[open]').length===(density==='full'?3:0),'density only controls context expansion');
            const familiar=root.querySelector('[data-key=feedback] .vocab-word');
            check(familiar.getBoundingClientRect().height<=parseFloat(win.getComputedStyle(familiar).lineHeight)+1,'a familiar short word fits one line without an oversized encounter-count column');
            const displayed=sameRow(),displayedOrigin=meaningOrigin();
            root.querySelector('[data-action=study-recall]').click();await pause();const covered=sameRow(),coveredOrigin=meaningOrigin();
            check(!root.querySelector('.vocab-definition,.vocab-meaning,.vocab-translation'),'recall removes all Chinese answers from the DOM until revealed');
            root.querySelector('[data-key=feedback] .vocab-card-main .vocab-cover').click();await pause();const revealed=sameRow(),revealedOrigin=meaningOrigin();
            check(Math.abs(displayed.height-covered.height)<1&&Math.abs(covered.height-revealed.height)<1&&Math.abs(covered.arrowX-revealed.arrowX)<1,'show, cover, and reveal keep the row height and arrow position');
            check(Math.abs(displayedOrigin.left-coveredOrigin.left)<1&&Math.abs(coveredOrigin.left-revealedOrigin.left)<1&&Math.abs(displayedOrigin.top-coveredOrigin.top)<1&&Math.abs(coveredOrigin.top-revealedOrigin.top)<1,'definition text and reveal label share the exact text origin in all three answer states',{width,view,density,displayedOrigin,coveredOrigin,revealedOrigin});
            root.querySelector('[data-action=study-display]').click();
            const summary=root.querySelector('.vocab-details>summary'),before=summary.getBoundingClientRect();summary.click();await pause();const after=summary.getBoundingClientRect();
            check(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1&&!summary.textContent.includes('\n'),'expanding and collapsing never moves or vertically stacks its label');
            geometry.push({width,view,density,...displayed});
          }
        }
      }
      win.resizeTo(920,760);ui.all.click();root.querySelector('[data-action=presentation-minimal]').click();await pause();await capture(win,'02-minimal-display');
      root.querySelector('.vocab-details>summary').click();await pause();await capture(win,'03-single-expanded');
      root.querySelector('[data-action=presentation-full]').click();await pause();await capture(win,'04-full-display');
      root.querySelector('[data-action=study-recall]').click();await pause();await capture(win,'05-full-recall');
      check(root.querySelector('.vocab-source')?.getBoundingClientRect().height>0&&root.querySelector('.vocab-sentence')?.getBoundingClientRect().height>0,'full recall keeps the source and original sentence visible while Chinese is covered');
      root.querySelector('[data-action=study-display]').click();root.querySelector('[data-action=presentation-minimal]').click();
      for(const theme of ['warm','dark','blue']){
        await pc.saveAppearance({theme});await wait(()=>win.document.documentElement.dataset.pcTheme===theme,'vocabulary theme '+theme);await pause();
        const probe=win.document.createElement('span');probe.style.backgroundColor=win.PCore.surfacePalette(theme).paper;
        check(win.getComputedStyle(root).backgroundColor===probe.style.backgroundColor,'vocabulary uses its actual '+theme+' paper surface');
        sameRow();await capture(win,'07-theme-'+theme);
      }
      // A chapter is a local view of the personal book, never a second ledger.
      const otherParent=new Zotero.Item('journalArticle');otherParent.setField('title','A different vocabulary source');await otherParent.saveTx();
      const other=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:otherParent.id});await Zotero.Reader.open(other.id);
      const foreign=await book.add({text:'foreign',readerID:other.id,page:1}),repeat=await book.add({text:'feedback',readerID:other.id,page:1});
      await book.edit(foreign.id,{meaning:'其他论文独有',defaultMeaning:'其他的',sentence:'A foreign source.',sentenceTranslation:'另一篇来源。'});
      await book.edit(repeat.id,{meaning:'其他论文的反馈义',sentence:'Feedback in a different paper.',sentenceTranslation:'其他论文中的反馈。'});
      await ui.refreshPaper();ui.all.click();await pause();
      check(ui.paper.key===(await pc.paperInfo(other.id)).key&&root.querySelectorAll('.vocab-card').length===2,'chapter tab follows the currently selected paper and only shows its two words');
      root.querySelector('[data-key=feedback] .vocab-details').open=true;await pause();
      check(root.querySelector('[data-key=feedback] .vocab-count').textContent==='×2'&&root.querySelectorAll('[data-key=feedback] .vocab-context').length===1,'chapter contexts remain local while the encounter count stays personal and cumulative');
      ui.search.value='Local context';ui.search.dispatchEvent(new win.Event('input'));check(!root.querySelector('.vocab-entry'),'chapter search never matches an unrelated paper context');
      ui.search.value='';ui.search.dispatchEvent(new win.Event('input'));ui.rows.click();await pause();
      check(root.querySelectorAll('.vocab-entry').length===4&&ui.rows.textContent==='所有单词','all words is the complete alphabetical personal book');
      ui.showWord('feedback');check(root.querySelectorAll('.vocab-encounter-details').length===2,'word details can still open both paper sources from a filtered chapter');ui.back();
      const progress=book.data.reviewedThrough;ui.review.click();await pause();
      check(ui.batchEnd===5&&book.pending().length===5,'review still covers personal encounters across every paper');
      check(ui.controls.hidden&&!ui.reviewControls.hidden&&root.querySelector('[data-action=review-mode-test]').getAttribute('aria-pressed')==='true'&&!root.querySelector('.vocab-meaning,.vocab-translation'),'review has its own clearly selected self-test mode and removes covered answers from the DOM');
      root.querySelector('[data-action=review-mode-browse]').click();await pause();check(root.querySelector('.vocab-meaning')&&!root.querySelector('[data-grade]'),'review browsing exposes its answer without grading or changing list preferences');
      const savedStudy=ui.study;ui.all.click();check(ui.study===savedStudy&&!ui.controls.hidden&&ui.reviewControls.hidden,'returning to a word list restores its independent display controls');
      ui.review.click();await pause();const pendingWord=book.pending()[0],knownMeaning=pendingWord.meaning;await book.edit(pendingWord.id,{meaning:''});
      root.querySelector('.vocab-cover').click();await pause();check(!root.querySelector('[data-grade]')&&root.textContent.includes('这条释义尚未补全'),'self-test never offers a mastery rating for an unknown definition and retains browsing/editing exits');
      await book.edit(pendingWord.id,{meaning:knownMeaning});ui.open(true);await pause();
      ui.rows.click();ui.review.click();
      check(book.data.reviewedThrough===progress,'changing chapter, all words and review never advances progress implicitly');
      await Zotero.Reader.open(attachment.id);await ui.refreshPaper();ui.all.click();await pause();
      check(root.querySelectorAll('.vocab-card').length===3&&!root.querySelector('[data-key=foreign]'),'returning to the first chapter removes foreign-only words');
      await capture(win,'08-current-chapter');ui.rows.click();await capture(win,'09-all-words');
      ui.search.value='feedback';ui.search.dispatchEvent(new win.Event('input'));ui.showWord('feedback');
      const selected=ui.selectedKey;pc.openVocabulary();check(win===pc.vocabularyWindow&&ui.selectedKey===selected&&ui.search.value==='feedback','reopening an existing window preserves its word and search');
      win.close();pc.openVocabulary({wordKey:'trajectory'});pc.openVocabulary({wordKey:'feedback'});
      await wait(()=>pc.vocabularyWindow?.pcVocabularyUI,'reopen and latest pending word');win=pc.vocabularyWindow;ui=win.pcVocabularyUI;root=ui.root;
      check(ui.selectedKey==='feedback','rapid opening keeps the latest requested word rather than dropping it while loading');
      win.close();
      // Missing/late arguments must have a visible, recoverable state.
      win=main.openDialog('chrome://paper-companion/content/vocabulary.xhtml','','chrome,dialog=no,width=600,height=500');
      await wait(()=>win.document.body?.dataset.vocabularyError==='true','missing-arguments error');
      check(win.document.body.textContent.includes('重试')&&win.document.body.textContent.includes('关闭'),'missing API renders recovery controls instead of an empty main');
      win.paperCompanionArgs={api:pc};await pointerClick([...win.document.querySelectorAll('button')].find(b=>b.textContent==='重试'));
      check(win.document.body.dataset.vocabularyReady==='true'&&!!win.pcVocabularyUI,'late API plus retry initializes the same failed window');
      win.close();
      // Reproduce an entirely missing chrome document, including no target JS.
      const openDialog=main.openDialog;
      try{
        main.openDialog=function(_url,name,features,args){return openDialog.call(this,'about:blank',name,features,args);};
        pc.openVocabulary();win=pc.vocabularyWindow;
      }finally{main.openDialog=openDialog;}
      await wait(()=>win.document.body?.textContent.includes('窗口未能载入'),'native owner watchdog');
      check(win.document.title.includes('单词本')&&win.document.body.querySelector('button'),'an absent document is replaced with a titled recovery screen by the native owner');await capture(win,'06-resource-error');
      await pointerClick([...win.document.querySelectorAll('button')].find(b=>b.textContent==='重试'));await wait(()=>pc.vocabularyWindow?.pcVocabularyUI,'window after resource failure');win=pc.vocabularyWindow;
      check(win.pcVocabularyUI.root.querySelectorAll('.vocab-card').length===3,'closing a failed window allows a clean open with the same vocabulary data');
      check(requests===0&&book.stats().encounters===5&&book.data.reviewedThrough===0,'opening, modes, pointer interaction, retry and errors make no model calls or progress/count changes');
      win.close();holder.close();
      await IOUtils.writeUTF8(output,JSON.stringify({ok:true,results,shots,geometry},null,2));
    }catch(e){try{await captureFailure();}catch(_){}await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,debug:debug(),results,shots,geometry},null,2));}
    finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}
  })();
}
function shutdown(){vocabularyTestChrome?.destruct();}function install(){}function uninstall(){}
