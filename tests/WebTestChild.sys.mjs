// Disposable fixture actor; never distributed inside the XPI.
import { PaperCompanionWebChild } from 'chrome://paper-companion/content/WebBridgeChild.sys.mjs';
export class PaperCompanionWebTestChild extends PaperCompanionWebChild {
 checkOrigin(){if(this.document.location.protocol!=='file:'||!this.document.location.pathname.endsWith('/web-fixture.html'))throw new Error('Wrong test fixture');}
 conversationPath(){return this.document.body.dataset.bridgeMode?this.document.body.dataset.conversation||'/':super.conversationPath();}
 async receiveMessage(message){
  this.checkOrigin();
  const d=this.document;
  if(message.name==='bridge-reset'||message.name==='bridge-mode'||message.name==='bridge-configure'||message.name==='bridge-modern-roles'||message.name==='bridge-mobile'||message.name==='bridge-owned-send'){
   if(message.name!=='bridge-configure'){Cu.waiveXrays(this.contentWindow).pcWebFixture.reset();for(const record of this.requests?.values()||[])this.finishRequest(record,'failed','Fixture reset');this.requests?.clear();this.activeRequest=null;}
   this.clearCompact();const fixture=Cu.waiveXrays(this.contentWindow).pcWebFixture;if(message.name==='bridge-mobile'||message.name==='bridge-owned-send')fixture.useMobileComposer();
   d.body.dataset.bridgeMode=message.data?.mode||'stream';d.body.dataset.searchUnits=String(message.data?.searchUnits===true);d.body.dataset.modernRoles=String(message.name==='bridge-modern-roles'||message.name==='bridge-mobile'||message.name==='bridge-owned-send'||message.data?.modernRoles===true);d.body.dataset.uploadDelay=String(message.data?.uploadDelay||120);d.body.dataset.streamDelay=String(message.data?.streamDelay||500);d.body.dataset.uploadFailure=String(!!message.data?.uploadFailure);d.body.dataset.reply=message.data?.reply||'';
   d.body.dataset.dynamicSend=String(message.name==='bridge-owned-send'?message.data?.dynamicSend!==false:message.name==='bridge-mobile'||message.data?.dynamicSend===true);d.body.dataset.sendDelay=String(message.data?.sendDelay||300);d.body.dataset.missingSend=String(message.data?.missingSend===true);
   if(message.name==='bridge-owned-send')fixture.configureSendControl(Cu.cloneInto({layout:message.data?.layout||'sibling',label:message.data?.sendLabel||'Send',semanticOnly:message.data?.semanticOnly===true},this.contentWindow));
   else if(message.name!=='bridge-configure')fixture.configureSendControl(Cu.cloneInto({legacy:true},this.contentWindow));
   const send=d.getElementById('send')||d.getElementById('fixture-owned-submit')||fixture.sendNode;fixture.configureComposer();
   for(const duplicate of d.querySelectorAll('[data-fixture-duplicate-send]'))duplicate.remove();
   if(message.data?.ambiguous){const duplicate=send.cloneNode(true);duplicate.id='fixture-duplicate-send';duplicate.setAttribute('data-fixture-duplicate-send','');send.after(duplicate);}
   if(message.data?.draft){const input=this.editor();if(input.localName==='textarea')input.value=message.data.draft;else input.textContent=message.data.draft;}
   if(message.data?.challenge){const challenge=d.createElement('div');challenge.id='fixture-challenge';challenge.setAttribute('role','dialog');challenge.setAttribute('aria-modal','true');challenge.textContent='Complete verification';d.body.append(challenge);}
   return this.pageStatus();
  }
  if(message.name==='bridge-debug')return {status:this.pageStatus(),requests:[...(this.requests?.values()||[])].map(r=>({id:r.id,state:r.state,submitted:r.submitted,sent:r.sentNormalized,userID:r.userID,baseline:r.baselineCount})),users:this.messageNodes().filter(n=>this.messageRole(n)==='user').map(n=>({id:this.messageID(n),text:this.userText(n)}))};
  if(message.name==='bridge-path'){d.body.dataset.conversation=String(message.data?.path||'/');return this.pageStatus();}
  if(message.name==='bridge-drop-requests'){this.requests?.clear();this.activeRequest=null;return this.pageStatus();}
  if(message.name==='bridge-defer-history'){const root=d.querySelector('[data-thread-find-target="conversation"]');if(!root)throw Error('Expected the synthetic transcript');root.remove();this.contentWindow.setTimeout(()=>d.body.prepend(root),Number(message.data?.delay)||1200);return this.pageStatus();}
  if(message.name==='bridge-unit-inspect')return {legacy:d.querySelectorAll('[data-message-author-role]').length,modern:d.querySelectorAll('ol[data-conversation-transcript] > li[data-message-role]').length,rows:[...d.querySelectorAll('[data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]')].map(node=>({role:this.messageRole(node),id:this.messageID(node),state:node.closest('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state'),copy:!!node.querySelector('button[aria-label="Copy"]')}))};
  if(message.name==='bridge-external-turn'){
   for(const role of ['user','assistant']){const node=d.createElement('div');node.setAttribute('data-message-author-role',role);node.setAttribute('data-message-id','external-'+role+'-'+Date.now());node.textContent=role==='user'?'UNRELATED_QUESTION':'UNRELATED_ANSWER';d.body.append(node);}return this.pageStatus();
  }
  if(message.name==='inspect'){const fixture=Cu.waiveXrays(this.contentWindow).pcWebFixture,editor=this.editor(),send=d.getElementById('send')||d.getElementById('fixture-owned-submit')||fixture.sendNode,voice=d.getElementById('fixture-voice'),form=editor?.closest('form');return {draft:editor?(editor.value??editor.textContent):'',files:Array.from(d.getElementById('files').files).map(f=>({name:f.name,size:f.size,type:f.type})),changes:d.body.dataset.changes,sends:d.body.dataset.sends,stops:d.body.dataset.stops||'0',voiceClicks:d.body.dataset.voiceClicks||'0',voiceVisible:!!voice&&this.visible(voice),sendCandidateCount:this.sendButtons().length,sendDOMPresent:!!send?.isConnected,sendLabel:send?.getAttribute('aria-label'),sendTestID:send?.getAttribute('data-testid'),sendID:send?.id,sendType:send?.type,sendFormOwned:!!form&&send?.form===form,sendInsideNarrowComposer:!!editor?.closest('[data-type="unified-composer"]')?.contains(send),sendControlLayout:d.body.dataset.sendControlLayout||'form',mobileComposer:d.body.dataset.mobileComposer==='true',editorTag:editor?.localName,editorInForm:!!form,lastSubmission:JSON.parse(JSON.stringify(fixture.lastSubmission)),modernRows:[...d.querySelectorAll('ol[data-conversation-transcript] > li[data-message-role]')].map(node=>({role:node.getAttribute('data-message-role'),id:node.id,complete:node.hasAttribute('data-message-complete')})),legacyRows:d.querySelectorAll('[data-message-author-role]').length,collapsed:!!this.compactNode,editorID:editor?.id,sendVisible:!!send&&send.isConnected&&send.getBoundingClientRect().height>0&&!send.closest('[data-pc-web-compact]'),hiddenDraft:d.querySelector('textarea[hidden]')?.value,compactHeight:this.compactNode?.getBoundingClientRect().height};}
  if(message.name==='editable'){const div=d.createElement('div');div.id='prompt-textarea';div.setAttribute('contenteditable','true');div.textContent='Existing editable';d.getElementById('prompt-textarea').replaceWith(div);return true;}
  if(message.name==='modern'){
   this.clearCompact();const old=this.editor(),root=old.closest('form')||old;const form=d.createElement('form');form.setAttribute('data-type','unified-composer');d.body.dataset.mobileComposer='false';
   const decoy=d.createElement('textarea');decoy.id='prompt-textarea';decoy.disabled=true;decoy.hidden=true;decoy.value='HIDDEN_LEGACY_DRAFT';
   const branch=d.createElement('div'),editor=d.createElement('div');editor.id='modern-web-editor';editor.className='ProseMirror';editor.setAttribute('role','textbox');editor.setAttribute('contenteditable','true');editor.innerHTML='<p>MODERN_EXISTING_DRAFT</p>';branch.append(editor);
   const toolbar=d.createElement('div');toolbar.id='composer-toolbar';toolbar.append(d.getElementById('files'),d.getElementById('send')||Cu.waiveXrays(this.contentWindow).pcWebFixture.sendNode,d.getElementById('fixture-voice'));form.append(decoy,branch,toolbar);root.replaceWith(form);form.addEventListener('submit',e=>e.preventDefault());return true;
  }
  if(message.name==='replace-editor'){const old=this.editor(),next=old.cloneNode(false);next.innerHTML='<p>SPA_DRAFT</p>';old.replaceWith(next);return true;}
  if(message.name==='blocked'){this.clearCompact();this.editor().setAttribute('contenteditable','false');return true;}
  if(message.name==='unblocked'){d.getElementById('modern-web-editor').setAttribute('contenteditable','true');return true;}
  return super.receiveMessage(message);
 }
}
