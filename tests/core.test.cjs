const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, generateKeyPairSync, createSign } = require('node:crypto');
const C = require('../addon/content/core.js');
const ChatGPTAuth = require('../addon/content/auth.js');

test('SSE decoding handles every split boundary, CRLF, Unicode and multiline data', () => {
  const stream = ': comment\r\nevent: delta\r\ndata: 你好\r\ndata: second\r\n\r\ndata: [DONE]\n\n';
  for (let cut = 0; cut <= stream.length; cut++) {
    const events = [], parser = new C.SSEParser(e => events.push(e));
    parser.push(stream.slice(0, cut)); parser.push(stream.slice(cut)); parser.push('', true);
    assert.deepEqual(events, [{event:'delta',data:'你好\nsecond'}, {event:'message',data:'[DONE]'}]);
  }
});
test('Responses must actually complete; interrupted and failed streams are not success', () => {
  const c = C.responsesCollector();
  c.parser.push('data: {"type":"response.output_text.delta","delta":"你好"}\n\n');
  assert.throws(() => c.finish(), /中断/);
  c.parser.push('data: {"type":"response.completed","response":{"status":"completed"}}\n\n');
  assert.equal(c.finish(), '你好');
  assert.throws(() => C.responsesCollector().parser.push('data: {"type":"response.failed","response":{"error":{"message":"failed"}}}\n\n'), /未完成/);
});
test('Markdown never executes HTML, loads remote images, or emits unsafe links', () => {
  const html = C.markdown('# Title\n\n<script>alert(1)</script>\n\n[bad](javascript:alert)\n![tracking](https://example.com/t.png)\n\n[safe](https://example.com)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert(!html.includes('<script>')); assert(!html.includes('href="javascript:')); assert(!html.includes('<img'));
  assert(html.includes('href="https://example.com/"')); assert(html.includes('<table>'));
  assert.equal(C.safeURL('file:///etc/passwd'), ''); assert.equal(C.safeURL('https://user:pass@example.com'), '');
});
test('OAuth callback rejects state mismatch, expiry, duplicate codes, changed client and non-loopback origin', () => {
  const t = {state:'random',redirectURI:'http://127.0.0.1:12345/auth/callback',expiresAt:Date.now()+60000,clientID:'issued'};
  const valid = t.redirectURI+'?state=random&code=one';
  assert.deepEqual(C.validateCallback(valid,t),{code:'one',clientID:'issued'});
  for (const url of [valid.replace('state=random','state=wrong'),valid+'&code=two',valid+'&client_id=other',valid.replace('127.0.0.1','localhost')]) assert.throws(()=>C.validateCallback(url,t));
  assert.throws(()=>C.validateCallback(valid,{...t,expiresAt:0}));
  assert.throws(()=>C.validateCallback(t.redirectURI+'?state=random&code=x',{...t,clientID:undefined}));
});
const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const jwk = publicKey.export({format:'jwk'}); jwk.kid='test'; jwk.alg='RS256';
function jwt(payload) { const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'); const body=Buffer.from(JSON.stringify(payload)).toString('base64url'); const data=header+'.'+body; return data+'.'+createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url'); }
test('OIDC validates real signatures, issuer, audience, nonce, expiry and account identity', async () => {
  const now=Math.floor(Date.now()/1000), claims={iss:C.ISSUER,aud:'issued',sub:'user',iat:now,exp:now+3600,nonce:'nonce'};
  const expected={clientID:'issued',nonce:'nonce',subject:'user'};
  assert.equal((await C.verifyIDToken(jwt(claims),{keys:[jwk]},expected,webcrypto)).sub,'user');
  for(const change of [{iss:'https://evil.example'},{aud:'other'},{nonce:'wrong'},{exp:now-60},{sub:'other'},{iat:now+600}]) await assert.rejects(C.verifyIDToken(jwt({...claims,...change}),{keys:[jwk]},expected,webcrypto));
  const token=jwt(claims).split('.'); token[1]=Buffer.from(JSON.stringify({...claims,sub:'attacker'})).toString('base64url');
  await assert.rejects(C.verifyIDToken(token.join('.'),{keys:[jwk]},expected,webcrypto),/签名/);
});
test('Response payload preserves prior page materials, deduplicates and excludes failed exchanges', () => {
  const a={id:'a',title:'paper',label:'p1',text:'PAGE_ONE'},b={id:'b',title:'paper',label:'p2',text:'PAGE_TWO',image:'data:image/png;base64,TEST'};
  const body=C.responsesBody({model:'allowed-model',context:b,prompt:'new question',materials:{a,b},history:[{role:'user',text:'q1',status:'complete',materialID:'a'},{role:'assistant',text:'a1',status:'complete'},{role:'user',text:'failed-q',status:'failed',materialID:'b'}]});
  assert.equal(body.store,false); assert.equal(body.stream,true); assert(!('temperature' in body));
  const json=JSON.stringify(body); assert(json.includes('PAGE_ONE')); assert(json.includes('PAGE_TWO')); assert(!json.includes('failed-q')); assert(json.includes('input_image'));
  const same=C.responsesBody({model:'m',context:a,materials:{a},prompt:'q',history:[{role:'user',text:'q1',materialID:'a',status:'complete'}]});
  assert.equal(JSON.stringify(same).split('PAGE_ONE').length-1,1);
});
test('DeepSeek only receives selected text and disables reasoning for quick translation',()=>{
  const b=C.translationBody('selected words','deepseek-flash','简体中文');
  assert.equal(b.messages[1].content,'selected words'); assert.equal(b.thinking.type,'disabled'); assert.equal(b.stream,false);
  assert(!JSON.stringify(b).includes('ChatGPT')); assert.equal(b.model,'deepseek-flash');
});
test('PDF extraction retains page line boundaries while personal notes omit generated provenance',()=>{
  const text=C.pdfText([{str:'First',hasEOL:true},{str:'Second',transform:[1,0,0,1,0,20]},{str:'Third',transform:[1,0,0,1,0,10]}]);
  assert.match(text,/First\nSecond\nThird/);
  assert.equal(C.noteQuote('quotation',{page:2,link:'zotero://open-pdf/library/items/ABC?page=2'}),'\n\n> quotation\n\n');
  assert(!C.filename('a/b:c?.pdf').includes('/'));
});
test('Stored access token avoids network; expired tokens renew once with rotation',async()=>{
  let calls=0, saved=null;
  const state={openai:{id:{access_token:'still-valid',expiresAt:Date.now()+100000,scopes:['chatgpt.tokens.use.direct']}}};
  const env={readSecrets:async()=>state,form:async()=>{calls++; await new Promise(r=>setTimeout(r,10));return {access_token:'new',refresh_token:'rotated',token_type:'Bearer',expires_in:3600};},setToken:async(id,t)=>{saved=t;state.openai[id]=t;}};
  const auth=new ChatGPTAuth(env);assert.equal(await auth.access('id',new AbortController().signal),'still-valid');assert.equal(calls,0);
  state.openai.id.expiresAt=0;state.openai.id.refresh_token='old';
  const results=await Promise.all([auth.access('id',new AbortController().signal),auth.access('id',new AbortController().signal)]);
  assert.deepEqual(results,['new','new']);assert.equal(calls,1);assert.equal(saved.refresh_token,'rotated');
});

test('translation note formatting preserves Markdown math by default and supports literal text, quote and code',()=>{
 const value='**结论**\n\n$$x_1=\\frac{a}{b}$$';
 assert.equal(C.excerpt(value,null,'markdown'),'\n\n'+value+'\n\n');
 assert.equal(C.excerpt('a\nb',null,'quote'),'\n\n> a\n> b\n\n');
 assert.equal(C.excerpt('**结论**',null,'plain'),'\n\n\\*\\*结论\\*\\*\n\n');
 assert.equal(C.excerpt('a\nb',null,'code'),'\n\n```\na\nb\n```\n\n');
 assert(!C.excerpt(value,{page:3,link:'zotero://open-pdf/library/items/ABC'},'markdown').includes('zotero://'));
});

test('Excerpt styles preserve text and code fences cannot escape the code block',()=>{
 const context={page:4,link:'zotero://open-pdf/library/items/ABC?page=4'};
 assert.match(C.excerpt('# original',context,'plain'),/\\# original/);
 const plain=C.markdown(C.excerpt('# original **bold** `code`',context,'plain'));
 assert(!plain.includes('<h1>')&&!plain.includes('<strong>')&&!plain.includes('<code>'));assert(plain.includes('**bold** `code`'));
 assert.match(C.excerpt('original',context,'quote'),/> original/);
 const code=C.excerpt('line\n```\nother',context,'code');assert(code.includes('````\nline'));assert(code.includes('\n````\n'));
 assert(!code.includes('PDF 第')&&!code.includes('zotero://'));assert.equal(C.markdown(code).split('<pre><code>').length-1,1);assert(C.markdown(code).includes('line\n```\nother'));
});
test('new excerpts omit automatic page links and headings without stripping user-authored content',()=>{
 const source={page:7,link:'zotero://open-pdf/library/items/ABC?page=7'};
 for(const style of ['plain','quote','code']){
  const note=C.excerpt('USERCONTENT',source,style);assert(note.includes('USERCONTENT'));assert(!/PDF 第|zotero:\/\/|原文摘录|摘录 ·/.test(note));
 }
 assert.match(C.excerpt('我自己写的 PDF 第 7 页',source,'plain'),/我自己写的 PDF 第 7 页/);
});
test('DeepSeek chat accepts Flash images and rejects unsupported Pro images or PDF without dropping them',()=>{
 const page={id:'page',label:'Page 1',title:'Paper',text:'PAGE',images:['data:image/png;base64,TEST']};
 const options={model:'deepseek-flash',prompt:'question',history:[],context:page};
 const body=C.deepseekBody(options);assert(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url')));
 assert.equal(JSON.stringify(body).split('data:image/png').length-1,1);
 assert.throws(()=>C.deepseekBody({...options,model:'deepseek-v4-pro'}),/Flash/);
 assert.throws(()=>C.deepseekBody({...options,context:{...page,file:'data:application/pdf;base64,TEST'}}),/PDF/);
});
test('DeepSeek stream requires a successful terminal choice and collects split deltas',()=>{
 const c=C.deepseekCollector();c.parser.push('data: {"choices":[{"delta":{"content":"translated"},"finish_reason":null}]}\n\n');
 assert.throws(()=>c.finish(),/中断/);c.parser.push('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');assert.equal(c.finish(),'translated');
 assert.throws(()=>C.deepseekCollector().parser.push('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'),/未完整/);
});
test('DeepSeek plain-text followups survive historical PDFs without changing saved attachments or dropping chat',()=>{
 const pdf={id:'pdf',mode:'pdf',label:'原始 PDF',title:'Paper',text:'附件为完整PDF',file:'data:application/pdf;base64,OLD'};
 const options={model:'deepseek-flash',prompt:'Explain this sentence',materials:{pdf},history:[{role:'user',text:'OLD_QUESTION',status:'complete',materialID:'pdf'},{role:'assistant',text:'OLD_ANSWER',status:'complete'}]};
 const original=JSON.stringify(options),body=JSON.stringify(C.deepseekBody(options));
 assert.match(body,/Explain this sentence/);assert.match(body,/OLD_QUESTION/);assert.match(body,/OLD_ANSWER/);assert.match(body,/不能声称已读取/);
 assert(!body.includes('data:application/pdf'));assert(!body.includes('附件为完整PDF'));assert.match(C.deepseekHistory(options).notice,/PDF/);assert.equal(JSON.stringify(options),original);
 assert.match(JSON.stringify(C.responsesBody(options)),/data:application\/pdf/);
 assert.throws(()=>C.deepseekBody({...options,context:pdf}),/PDF/);
 const failed={...options,history:[{role:'user',text:'FAILED',status:'failed',materialID:'pdf'}]};assert.equal(C.deepseekHistory(failed).notice,'');assert(!JSON.stringify(C.deepseekBody(failed)).includes('FAILED'));
});
test('DeepSeek Pro retains historical text while explicitly omitting unsupported old images',()=>{
 const page={id:'page',label:'Page 1',title:'Paper',text:'EXTRACTED_PAGE_TEXT',images:['data:image/png;base64,OLD']};
 const options={model:'deepseek-v4-pro',prompt:'Followup',materials:{page},history:[{role:'user',text:'Question',materialID:'page',status:'complete'}]};
 const json=JSON.stringify(C.deepseekBody(options));assert.match(json,/EXTRACTED_PAGE_TEXT/);assert.match(json,/图片未发送/);assert(!json.includes('data:image'));
 assert.equal(page.images.length,1);assert.match(C.deepseekHistory(options).notice,/页面图片/);
 assert.throws(()=>C.deepseekBody({...options,context:page}),/Flash/);
 assert.match(JSON.stringify(C.deepseekBody({...options,model:'deepseek-flash'})),/data:image/);
});
test('translation note scope and formats stay independent without adding page metadata',()=>{
 const options={source:'ORIGINAL $x$',translation:'**译文** $y$',sourceStyle:'code',translationStyle:'quote'};
 const translated=C.translationExcerpt(options);assert(!translated.includes('ORIGINAL'));assert(translated.includes('> **译文** $y$'));
 const source=C.translationExcerpt({...options,scope:'source'});assert(source.includes('```')&&source.includes('ORIGINAL $x$'));assert(!source.includes('$y$'));
 const both=C.translationExcerpt({...options,scope:'both'});assert(both.includes('```')&&both.includes('> **译文** $y$'));assert(!/PDF|page=|zotero:/.test(both));
 assert.throws(()=>C.translationExcerpt({...options,scope:'other'}),/请选择/);assert.throws(()=>C.translationExcerpt({scope:'source'}),/原文/);assert.throws(()=>C.translationExcerpt({source:'x',scope:'both'}),/翻译/);
});
test('feature labels resolve each real model selection without inheriting the chat model',()=>{
 const settings={chatProvider:'deepseek',chatDeepseekModel:'deepseek-v4-pro',translationProvider:'chatgpt',translationChatGPTModel:'selected-translation',translationChatGPTEffort:'high',formulaProvider:'deepseek',summaryProvider:'chatgpt',summaryChatGPTModel:'selected-summary',summaryChatGPTEffort:'low'};
 assert.equal(C.featureModel(settings,'preread').model,'deepseek-v4-pro');assert.equal(C.featureModel(settings,'vocabulary').model,'selected-translation');assert.equal(C.featureModel(settings,'vocabulary-context').effort,'high');assert.equal(C.featureModel(settings,'vocabulary-ocr').model,'deepseek-flash');assert.equal(C.featureModel(settings,'review').model,'selected-summary');
 settings.translationChatGPTModel='';assert.match(C.featureModel(settings,'translation').label,/未选模型/);settings.chatProvider='chatgpt-web';assert.match(C.featureModel(settings,'chat').label,/网页选模型/);assert.throws(()=>C.featureModel(settings,'unknown'),/未知/);
});
test('all four reading palettes retain readable text and primary-button contrast',()=>{
 const luminance=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 for(const theme of C.themeIDs()){const palette=C.surfacePalette(theme);for(const color of ['ink','muted','accent'])assert(contrast(palette[color],palette.paper)>=4.5,theme+' '+color+' on paper');assert(contrast('#FFFFFF',palette.fill)>=4.5,theme+' primary button');}
});
test('four palettes preserve old identities and boolean callers with a cloud default',()=>{
 assert.deepEqual(C.themeIDs(),['cloud','blue','warm','dark']);assert.equal(C.surfacePalette().id,'cloud');assert.equal(C.surfacePalette('invalid').id,'cloud');assert.equal(C.surfacePalette(true).id,'dark');assert.equal(C.surfacePalette(false).id,'cloud');assert.equal(C.surfacePalette('warm').paper,'#FCFAF7');assert.equal(C.surfacePalette('dark').bg,'#15161A');const p=C.surfacePalette('warm');p.paper='changed';assert.equal(C.surfacePalette('warm').paper,'#FCFAF7');
});
test('four themes have independent names and static material fields with no remote assets',()=>{
 assert.deepEqual(C.themeIDs().map(id=>C.surfacePalette(id).label),['云岚瓷白','晴空湛蓝','暖砂霞光','静夜墨蓝']);
 const ids=C.themeIDs();ids.pop();assert.equal(C.themeIDs().length,4);
 for(const id of C.themeIDs())for(const name of ['atmosphere','header','wash','popup']){const value=C.surfacePalette(id)[name];assert.match(value,/gradient\(/);assert.doesNotMatch(value,/https?:|url\(|animation/);}
 assert.notEqual(C.surfacePalette('cloud').atmosphere,C.surfacePalette('blue').atmosphere);assert.notEqual(C.surfacePalette('cloud').accent,C.surfacePalette('blue').accent);
});
test('border light responds continuously to proximity on both sides and ignores the middle',()=>{
 const rect={left:100,top:100,width:200,height:100};assert.equal(C.borderLight(rect,{x:200,y:150}),null);assert.equal(C.borderLight(rect,{x:84,y:150}),null);assert.equal(C.borderLight(rect,{x:100,y:150}).strength,1);
 const inside=C.borderLight(rect,{x:108,y:150}),outside=C.borderLight(rect,{x:92,y:150});assert.equal(inside.strength,outside.strength);assert(inside.strength>0&&inside.strength<1);assert(C.borderLight(rect,{x:101,y:150}).strength>inside.strength);
 assert.equal(C.borderLight(rect,{x:NaN,y:100}),null);assert.equal(C.borderLight(rect,{x:100,y:100},0),null);
});
test('rounded corners receive one continuous border intersection rather than a square corner',()=>{
 const rect={left:0,top:0,width:100,height:100},point={x:10-10/Math.sqrt(2),y:10-10/Math.sqrt(2)};assert(C.borderLight(rect,point,16,10).strength>.999);assert.equal(C.borderLight(rect,{x:-12,y:-12},16,10),null);
});

test('a surface with only one visible edge never lights its absent borders',()=>{
 const rect={left:10,top:10,width:200,height:100},edges={left:true,top:false,bottom:false,right:false};
 assert.equal(C.borderLight(rect,{x:10,y:60},16,6,edges).strength,1);
 assert.equal(C.borderLight(rect,{x:110,y:10},16,6,edges),null);
 assert.equal(C.borderLight(rect,{x:210,y:60},16,6,edges),null);
 assert.equal(C.borderLight(rect,{x:10,y:60},16,6,{}),null);
});
