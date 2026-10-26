// Load the settings actually written by the UI suite in a fresh disposable process.
function startup(){(async()=>{const output='__OUTPUT__',results=[];const check=(v,label)=>{if(!v)throw Error(label);results.push(label);};const wait=async(fn)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(50);}throw Error('Appearance restart timed out');};try{
 await IOUtils.writeUTF8(output+'.progress','starting');await Zotero.uiReadyPromise;await Zotero.initializationPromise;await Zotero.Libraries.userLibrary.waitForDataLoad('item');await wait(()=>Zotero.PaperCompanion);const pc=Zotero.PaperCompanion;let network=0;pc.request=async()=>{network++;throw Error('Restart suite stays offline');};await IOUtils.writeUTF8(output+'.progress','ready');
 const saved=JSON.parse(await IOUtils.readUTF8(PathUtils.join(pc.dir,'settings.json')));check(saved.theme==='warm'&&pc.settings.theme==='warm','previously selected warm theme survives a real Zotero process restart');
 const parent=new Zotero.Item('journalArticle');parent.setField('title','Appearance restart fixture');await parent.saveTx();const item=await Zotero.Attachments.importFromFile({file:'__PDF__',parentItemID:parent.id});await Zotero.Reader.open(item.id);await pc.openPanel({readerID:item.id});await wait(()=>pc.panel?.document?.body?.dataset.ready==='true');const win=pc.panel,doc=win.document;
 check(doc.documentElement.dataset.pcTheme==='warm'&&win.getComputedStyle(doc.body).backgroundColor==='rgb(246, 243, 239)','a newly opened panel paints the saved warm palette on startup');
 check(doc.getElementById('theme-toggle').textContent.includes('暖砂霞光'),'the compact theme trigger restores the saved choice');
 await pc.openVocabulary();await wait(()=>pc.vocabularyWindow?.pcTheme);check(pc.vocabularyWindow.document.documentElement.dataset.pcTheme==='warm','a fresh standalone vocabulary window starts with the saved palette');
 check(network===0,'restoring appearance and opening both surfaces makes no model request');
 await IOUtils.writeUTF8(output,JSON.stringify({ok:true,version:Zotero.version,results},null,2));
}catch(e){await IOUtils.writeUTF8(output,JSON.stringify({ok:false,error:e.message,stack:e.stack,results},null,2));}finally{Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}})();}
function shutdown(){}function install(){}function uninstall(){}
