// Disposable fixture actor; never distributed inside the XPI.
import { PaperCompanionWebChild } from 'chrome://paper-companion/content/WebBridgeChild.sys.mjs';
export class PaperCompanionWebTestChild extends PaperCompanionWebChild {
 checkOrigin(){if(this.document.location.protocol!=='file:'||!this.document.location.pathname.endsWith('/web-fixture.html'))throw new Error('Wrong test fixture');}
 async receiveMessage(message){
  this.checkOrigin();
  const d=this.document;
  if(message.name==='inspect'){const editor=this.editor(),send=d.getElementById('send');return {draft:editor?(editor.value??editor.textContent):'',files:Array.from(d.getElementById('files').files).map(f=>({name:f.name,size:f.size,type:f.type})),changes:d.body.dataset.changes,sends:d.body.dataset.sends,collapsed:!!this.compactNode,editorID:editor?.id,sendVisible:send.getBoundingClientRect().height>0&&!send.closest('[data-pc-web-compact]'),hiddenDraft:d.querySelector('textarea[hidden]')?.value,compactHeight:this.compactNode?.getBoundingClientRect().height};}
  if(message.name==='editable'){const div=d.createElement('div');div.id='prompt-textarea';div.setAttribute('contenteditable','true');div.textContent='Existing editable';d.getElementById('prompt-textarea').replaceWith(div);return true;}
  if(message.name==='modern'){
   this.clearCompact();const old=this.editor();const form=d.createElement('form');form.setAttribute('data-type','unified-composer');
   const decoy=d.createElement('textarea');decoy.id='prompt-textarea';decoy.disabled=true;decoy.hidden=true;decoy.value='HIDDEN_LEGACY_DRAFT';
   const branch=d.createElement('div'),editor=d.createElement('div');editor.id='modern-web-editor';editor.className='ProseMirror';editor.setAttribute('role','textbox');editor.setAttribute('contenteditable','true');editor.innerHTML='<p>MODERN_EXISTING_DRAFT</p>';branch.append(editor);
   const toolbar=d.createElement('div');toolbar.id='composer-toolbar';toolbar.append(d.getElementById('files'),d.getElementById('send'));form.append(decoy,branch,toolbar);old.replaceWith(form);form.addEventListener('submit',e=>e.preventDefault());return true;
  }
  if(message.name==='replace-editor'){const old=this.editor(),next=old.cloneNode(false);next.innerHTML='<p>SPA_DRAFT</p>';old.replaceWith(next);return true;}
  if(message.name==='blocked'){this.clearCompact();this.editor().setAttribute('contenteditable','false');return true;}
  if(message.name==='unblocked'){d.getElementById('modern-web-editor').setAttribute('contenteditable','true');return true;}
  return super.receiveMessage(message);
 }
}
