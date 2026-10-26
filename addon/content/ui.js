/* Shared local vector controls. Geometry is independent of font fallback. */
var PCUI = class {
  static paths = {
    chevron:['m9 5 7 7-7 7'],
    close:['m6 6 12 12','M18 6 6 18'],
    send:['m21 3-7 18-4-7-7-4Z','m10 14 11-11'],
    external:['M14 3h7v7','m21 3-10 10','M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5'],
    popout:['M9 3h12v12H9Z','M5 9H3v12h12v-2'],
    expand:['M8 3H3v5','M16 3h5v5','M21 16v5h-5','M8 21H3v-5'],
    minimize:['M3 8h5V3','M16 3v5h5','M21 16h-5v5','M8 21v-5H3'],
    formula:['M19 4H5l7 8-7 8h14'],
    next:['m9 5 7 7-7 7'],
    up:['m5 15 7-7 7 7'],down:['m5 9 7 7 7-7'],
    more:['M5 12h.01','M12 12h.01','M19 12h.01'],
    back:['m15 5-7 7 7 7']
  };
  static icon(doc,name) {
    const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
    for(const [k,v]of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(k,v);
    svg.classList.add('pc-glyph');svg.dataset.pcGlyph=name;
    for(const d of this.paths[name]||[]){const path=doc.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}return svg;
  }
  static label(node,text,icon,{disclosure=false,only=false}={}) {
    let label=node.querySelector(':scope > .pc-control-label'),glyph=node.querySelector(':scope > .pc-glyph');
    if(!label){label=node.ownerDocument.createElement('span');label.className='pc-control-label';node.replaceChildren(label);glyph=null;}
    label.textContent=text;
    if(icon&&glyph?.dataset.pcGlyph!==icon){glyph?.remove();glyph=this.icon(node.ownerDocument,icon);node.append(glyph);}
    node.classList.toggle('pc-icon-control',!!icon);node.classList.toggle('pc-disclosure',disclosure);node.classList.toggle('pc-icon-only',only);
    if(icon)node.dataset.pcIcon=icon;
    if(only)node.setAttribute('aria-label',text);return node;
  }
  static summary(node,text) {
    if(text!==undefined)node.textContent=text;
    node.classList.add('pc-disclosure-summary');
    if(!node.querySelector(':scope > .pc-glyph'))node.prepend(this.icon(node.ownerDocument,'chevron'));
  }
  static disclosures(root) { for(const summary of root.querySelectorAll('details > summary'))this.summary(summary); }
  static action(node,text=node.textContent) {
    let icon;
    if(/^[×✕]$/.test(text.trim()))return this.label(node,node.getAttribute('aria-label')||'关闭','close',{only:true});
    if(/^[↑↓]$/.test(text.trim()))return this.label(node,node.getAttribute('aria-label')||node.title,text.trim()==='↑'?'up':'down',{only:true});
    if(/[↗]$/.test(text))icon=/弹出|传入|引入/.test(text)?'popout':/发送/.test(text)?'send':'external';
    else if(/[→›]$/.test(text))icon='next';else if(/[←]/.test(text))icon='back';else if(/^[∑Σ]/.test(text))icon='formula';
    if(icon)this.label(node,text.replace(/[↗→›←∑Σ]/g,'').trim(),icon);return node;
  }
  static document(root,markdown) {
    // Only a generated first title and its source metadata are compacted on screen.
    // The original Markdown string and maintained files are never changed here.
    const expanded=root.querySelector('.pc-document-meta')?.open||false;root.innerHTML=PCore.markdown(markdown);const title=root.firstElementChild;
    if(title?.tagName.toLowerCase()!=='h1')return;
    const doc=root.ownerDocument,details=doc.createElement('details'),summary=doc.createElement('summary');details.className='pc-document-meta';details.open=expanded;summary.textContent='文档信息';details.append(summary);title.before(details);details.append(title);
    while(details.nextElementSibling){const next=details.nextElementSibling,tag=next.tagName.toUpperCase();if(!['P','HR'].includes(tag)||tag==='P'&&!/^(打开文献|本篇|阅读摘记|来源|自动保存)/.test(next.textContent.trim()))break;details.append(next);}
    this.summary(summary);
    for(const h of [...root.querySelectorAll(':scope > h2')])if(/^(阅读摘记|\d{4}[-年/])/.test(h.textContent.trim()))details.append(h);
  }
};
