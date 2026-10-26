const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../addon/content/native.js'),'utf8');
const method=source.slice(source.indexOf('  resourceURL('),source.indexOf('  registerPanel('));
test('every view and its nested resources use the installed version package',()=>{
 const fn=base=>vm.runInNewContext('(class{'+method+'}).prototype.resourceURL',{uiRootURI:base});
 for(const version of ['0-27-1','0-28-0']){
  const base='chrome://paper-companion-ui-'+version+'/content/',url=fn(base);
  for(const path of ['panel.xhtml','vocabulary.xhtml','appearance.css','icons/book-open.svg'])assert.equal(url(path),base+path);
  const page=url('panel.xhtml');assert.equal(new URL('appearance.css',page).href,url('appearance.css'));
  assert.equal(new URL('theme-cloud-mist.webp',url('appearance.css')).href,url('theme-cloud-mist.webp'));
 }
});
test('plugin resource paths cannot leave their version package or load a remote resource',()=>{
 const url=vm.runInNewContext('(class{'+method+'}).prototype.resourceURL',{uiRootURI:'chrome://paper-companion-ui-0-27-1/content/'});
 for(const path of ['../settings.json','icons/../../data.json','https://example.invalid/a.css','/appearance.css','appearance.css?other=1'])assert.throws(()=>url(path),/资源路径/);
});
