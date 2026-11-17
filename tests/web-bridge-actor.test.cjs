const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../addon/content/WebBridgeChild.sys.mjs'), 'utf8');
function fixture() {
  const clock = { now: 10000 }, sandbox = { JSWindowActorChild: class {}, Date: { now: () => clock.now } };
  vm.runInNewContext(source.replace('export class PaperCompanionWebChild', 'class PaperCompanionWebChild') + '\nthis.Actor = PaperCompanionWebChild;', sandbox);
  const actor = new sandbox.Actor(), state = { nodes: [], path: '/', draft: '', attachments: false, streaming: false, blocked: '', sends: 0, stops: 0, done: false };
  actor.document = { querySelector: () => null, querySelectorAll: () => [] };
  actor.contentWindow = { setTimeout, clearTimeout };
  actor.conversationPath = () => state.path;
  actor.messageNodes = () => state.nodes;
  actor.editor = () => ({ closest: () => null });
  actor.draftText = () => state.draft;
  actor.hasAttachments = () => state.attachments;
  actor.uploading = () => false;
  actor.isStreaming = () => state.streaming;
  actor.blocked = () => state.blocked;
  actor.requestFailure = () => '';
  actor.userText = node => actor.normalized(node.text);
  actor.answerText = node => node.text;
  actor.hasCompletionControl = () => state.done;
  const send = { disabled: false, getAttribute: () => null, matches: () => false, click: () => state.sends++ };
  actor.sendButtons = () => [send];
  actor.stopButtons = () => [{ click: () => state.stops++ }];
  actor.observeRequest = () => {};
  actor.receiveMessage = async ({ name, data }) => { assert.equal(name, 'fill'); state.draft = data.text; };
  return { actor, state, clock, send };
}
const message = (role, id, text) => ({ text, contains: () => false, getAttribute: name => name === 'data-message-author-role' ? role : name === 'data-message-id' ? id : null });

test('composer controls use the owning form rather than only a nested text branch',()=>{
  const {actor}=fixture(),chip={isConnected:true},progress={isConnected:true},narrow={querySelectorAll:()=>[]};
  const form={querySelectorAll:selector=>selector.includes('progressbar')?[progress]:[chip]};
  actor.editor=()=>({form,closest:selector=>selector==='form'?form:narrow});actor.visible=()=>true;actor.uploading=Object.getPrototypeOf(actor).uploading.bind(actor);
  assert.equal(actor.composerRoot(),form);assert.equal(actor.attachmentNodes().length,1);assert.equal(actor.attachmentNodes()[0],chip);assert.equal(actor.uploading(),true);
});

test('composer controls preserve the unified branch fallback when there is no HTML form',()=>{
  const {actor}=fixture(),branch={};actor.editor=()=>({closest:selector=>selector==='form'?null:branch});
  assert.equal(actor.composerRoot(),branch);
});

test('new user correlation preserves multiline material boundaries without accepting different words',async()=>{
  const {actor,state}=fixture(),text='Reference paragraph.\n\nQuestion:\nWhy this method?';
  await actor.submit({requestID:'multiline',text});
  const user=message('user','multiline-user','Reference paragraph.Question:Why this method?');user.textContent=text;
  state.nodes.push(user,message('assistant','multiline-answer','Confirmed answer'));state.streaming=true;
  const result=actor.requestStatus('multiline');assert.equal(result.state,'streaming');assert.equal(result.text,'Confirmed answer');
  assert.equal(actor.userTextMatches({text:'notable',textContent:'notable'},'not able'),false);
});

test('a definite pre-submit DOM failure crosses IPC as unsent rather than an ambiguous submission',async()=>{
  const {actor,state}=fixture();actor.checkOrigin=()=>{};state.draft='An unrelated draft';
  const result=await Object.getPrototypeOf(actor).receiveMessage.call(actor,{name:'submit',data:{requestID:'preflight-ipc',text:'Question'}});
  assert.equal(result.state,'failed');assert.equal(result.submitted,false);assert.equal(result.needsInteraction,true);assert.equal(state.sends,0);assert.equal(state.draft,'An unrelated draft');
});

test('automatic submit clicks once and duplicate request IDs share the original outcome', async () => {
  const { actor, state } = fixture();
  const [one, two] = await Promise.all([actor.submit({ requestID: 'one', text: 'Why this method?', expectedConversation: '/' }), actor.submit({ requestID: 'one', text: 'Why this method?', expectedConversation: '/' })]);
  assert.equal(state.sends, 1); assert.equal(one.state, 'submitted'); assert.equal(two.state, 'submitted');
  await actor.submit({ requestID: 'one', text: 'Why this method?' }); assert.equal(state.sends, 1);
  await assert.rejects(actor.submit({ requestID: 'one', text: 'Different question' }), /不能替换/); assert.equal(state.sends, 1);
});

test('existing webpage drafts, unknown attachments, modal confirmation and invalid selected files fail before mutation', async () => {
  for (const change of [{ draft: 'UNRELATED DRAFT' }, { attachments: true }, { blocked: 'Complete verification' }]) {
    const { actor, state } = fixture(); Object.assign(state, change);
    await assert.rejects(actor.submit({ requestID: 'guard', text: 'Only typed question' }));
    assert.equal(state.sends, 0); assert.equal(state.draft, change.draft || '');
  }
  const { actor, state } = fixture();
  await assert.rejects(actor.submit({ requestID: 'files', text: 'Question with selected files', files: [{ name: 'paper.pdf' }] }), /格式或文件名/);
  assert.equal(state.draft, ''); assert.equal(state.sends, 0);
});

const selectedFiles = [{ name: 'selected-page.png', type: 'image/png', dataURL: 'data:image/png;base64,AA==' }, { name: 'selected-paper.pdf', type: 'application/pdf', dataURL: 'data:application/pdf;base64,AA==' }];
function uploadsFixture() {
  const result = fixture(), { actor, state, clock } = result; state.attachCalls = 0; state.readyAt = clock.now + 400;
  actor.attachmentInput = () => ({}); actor.uploadsReady = () => clock.now >= state.readyAt;
  actor.contentWindow.setTimeout = (callback, ms) => { clock.now += ms; queueMicrotask(callback); return 0; };
  const fill = actor.receiveMessage;
  actor.receiveMessage = async message => { if (message.name === 'attach') { state.attachCalls++; assert.deepEqual(message.data.files, selectedFiles); } else await fill(message); };
  return result;
}

test('explicit selected PDF and image uploads are confirmed before the sole Send click, with exact question and selected context', async () => {
  const { actor, state, clock } = uploadsFixture(), text = 'Question\n\nSelected PDF page 2 context only.';
  const result = await actor.submit({ requestID: 'selected', text, files: selectedFiles });
  assert.equal(result.state, 'submitted'); assert.equal(state.attachCalls, 1); assert.equal(state.sends, 1); assert(clock.now >= 10700); assert.equal(state.draft, text);
  await actor.submit({ requestID: 'selected', text, files: selectedFiles }); assert.equal(state.attachCalls, 1); assert.equal(state.sends, 1);
});

test('unknown or failed selected upload state prevents Send rather than assuming completion', async () => {
  const { actor, state } = uploadsFixture(); actor.uploadsReady = () => false;
  const result = await actor.submit({ requestID: 'unconfirmed-upload', text: 'Question', files: selectedFiles });
  assert.equal(result.state, 'failed'); assert.equal(result.submitted, false); assert.match(result.error, /无法确认.*上传完成/); assert.equal(state.sends, 0);
  const other = uploadsFixture(); other.actor.requestFailure = () => 'Fixture upload failed';
  const failed = await other.actor.submit({ requestID: 'failed-upload', text: 'Question', files: selectedFiles });
  assert.equal(failed.submitted, false); assert.match(failed.error, /upload failed/); assert.equal(other.state.sends, 0);
});

test('cancellation while explicit files are being staged prevents submission', async () => {
  const { actor, state } = uploadsFixture(); let staged, release;
  const stagedPromise = new Promise(resolve => { staged = resolve; }), fill = actor.receiveMessage;
  actor.receiveMessage = message => message.name === 'attach' ? new Promise(resolve => { release = resolve; staged(); }) : fill(message);
  const submitted = actor.submit({ requestID: 'cancel-upload', text: 'Question', files: selectedFiles }); await stagedPromise;
  assert.equal(actor.stopRequest('cancel-upload').cancelled, true); release();
  const result = await submitted; assert.equal(result.submitted, false); assert.equal(result.state, 'failed'); assert.equal(state.sends, 0);
});

test('one wrapper or one duplicate filename chip cannot confirm multiple selected files', () => {
  const { actor } = fixture(), chip = name => ({ textContent: name, getAttribute: () => null, contains: () => false });
  const one = chip('selected-page.png'), two = chip('selected-paper.pdf'), wrapper = { textContent: one.textContent + ' ' + two.textContent, getAttribute: () => null, contains: node => node === one || node === two };
  actor.attachmentNodes = () => [wrapper, one, two]; assert.equal(actor.uploadsReady(selectedFiles), true);
  actor.attachmentNodes = () => [wrapper]; assert.equal(actor.uploadsReady(selectedFiles), false);
  actor.attachmentNodes = () => [one]; assert.equal(actor.uploadsReady([selectedFiles[0], selectedFiles[0]]), false);
  actor.attachmentNodes = () => [one, two, chip('UNRELATED FILE.pdf')]; assert.equal(actor.uploadsReady(selectedFiles), false);
});

test('ambiguous or missing Send buttons never fall back to Enter or form submission', async () => {
  const { actor, state, send,clock } = fixture(); actor.sendButtons = () => [send, send];
  await assert.rejects(actor.submit({ requestID: 'ambiguous', text: 'Question' }), /唯一/); assert.equal(state.sends, 0);
  actor.contentWindow.setTimeout=(callback,ms)=>{clock.now+=ms;return setTimeout(callback,0);};
  actor.sendButtons = () => []; const result=await actor.submit({ requestID: 'missing', text: 'Question' });
  assert.equal(result.state,'failed');assert.equal(result.submitted,false);assert.equal(state.draft,'Question');assert.equal(state.sends,0);
});

test('an empty webpage may render Send only after input and a delayed site state update',async()=>{
  const {actor,state,send,clock}=fixture();let readyAt=Infinity;
  actor.sendButtons=()=>state.draft&&clock.now>=readyAt?[send]:[];
  actor.receiveMessage=async({name,data})=>{assert.equal(name,'fill');state.draft=data.text;readyAt=clock.now+300;};
  actor.contentWindow.setTimeout=(callback,ms)=>{clock.now+=ms;return setTimeout(callback,0);};
  const result=await actor.submit({requestID:'empty-voice-page',text:'This question creates Send'});
  assert.equal(result.state,'submitted');assert.equal(state.sends,1);assert.equal(state.draft,'This question creates Send');assert(clock.now>=readyAt);
  await actor.submit({requestID:'empty-voice-page',text:'This question creates Send'});assert.equal(state.sends,1);
});

test('a slowly initialized page can enable Send after five seconds without losing its original draft',async()=>{
  const {actor,state,send,clock}=fixture(),enabledAt=clock.now+6500;
  actor.sendButtons=()=>state.draft&&clock.now>=enabledAt?[send]:[];
  actor.contentWindow.setTimeout=(callback,ms)=>{clock.now+=ms;queueMicrotask(callback);return 0;};
  const result=await actor.submit({requestID:'slow-send-ready',text:'Wait for this exact draft'});
  assert.equal(result.submitted,true);assert.equal(state.draft,'Wait for this exact draft');assert.equal(state.sends,1);assert(clock.now>=enabledAt);
});

test('cancelling a delayed Send wait never clicks the button when it later becomes ready',async()=>{
  const {actor,state,send,clock}=fixture(),cancelAt=clock.now+5500,enabledAt=clock.now+6500;
  actor.sendButtons=()=>clock.now>=enabledAt?[send]:[];
  actor.contentWindow.setTimeout=(callback,ms)=>{clock.now+=ms;if(clock.now>=cancelAt)actor.stopRequest('stop-before-delayed-send');queueMicrotask(callback);return 0;};
  const result=await actor.submit({requestID:'stop-before-delayed-send',text:'Do not submit after Stop'});
  clock.now=enabledAt+100;assert.equal(result.submitted,false);assert.equal(state.sends,0);assert.equal(result.cancelled,true);
});

function mobileComposerFixture(id = 'mobile-composer-prompt') {
  const result = fixture(), { actor, state, send, clock } = result, proto = Object.getPrototypeOf(actor);
  let sendReadyAt = Infinity;
  const form = { querySelector: () => state.draft && clock.now >= sendReadyAt ? send : null };
  const textarea = { id, localName: 'textarea', isConnected: true, disabled: false, value: '',
    classList: { contains: () => false }, getAttribute: () => null, matches: () => false, querySelectorAll: () => [],
    closest: selector => selector.includes('form') ? form : null, getClientRects: () => [{ width: 320, height: 50 }] };
  actor.document = { querySelector: () => null, querySelectorAll: selector => selector.includes('form textarea') ? [textarea] : [] };
  actor.contentWindow.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  actor.editor = proto.editor.bind(actor);
  actor.sendButtons = () => form.querySelector() ? [send] : [];
  actor.receiveMessage = async ({ name, data }) => { assert.equal(name, 'fill'); textarea.value = state.draft = data.text; sendReadyAt = clock.now + 300; };
  actor.contentWindow.setTimeout = (callback, ms) => { clock.now += ms; return setTimeout(callback, 0); };
  return { ...result, textarea, form };
}

test('an empty modern mobile composer is recognized with no Send element in its form', async () => {
  const { actor, state, textarea, form } = mobileComposerFixture();
  assert.equal(form.querySelector(), null, 'the initial Send element is absent from the DOM, not merely hidden');
  assert.equal(actor.editor(), textarea, 'recognition must not require the Send button that typing creates');
  const result = await actor.submit({ requestID: 'modern-mobile-empty', text: 'A question creates the mobile Send button' });
  assert.equal(result.state, 'submitted'); assert.equal(state.sends, 1); assert.equal(state.draft, 'A question creates the mobile Send button');
});

test('the modern empty-composer exception rejects unrelated form textareas and disabled or hidden editors', () => {
  assert.equal(mobileComposerFixture('unrelated-search').actor.editor(), null);
  const disabled = mobileComposerFixture(); disabled.textarea.disabled = true; assert.equal(disabled.actor.editor(), null);
  const hidden = mobileComposerFixture(); hidden.actor.contentWindow.getComputedStyle = () => ({ display: 'none', visibility: 'visible' }); assert.equal(hidden.actor.editor(), null);
});

test('Send ambiguity appearing after input still stops before any website submission',async()=>{
  const {actor,state,send}=fixture();actor.sendButtons=()=>state.draft?[send,send]:[];
  const result=await actor.submit({requestID:'late-ambiguity',text:'Keep this local question'});
  assert.equal(result.state,'failed');assert.equal(result.submitted,false);assert.equal(state.sends,0);assert.equal(state.draft,'Keep this local question');
});

test('a disabled website Send control retains the typed draft without any submission fallback', async () => {
  const { actor, state, send, clock } = fixture(); send.disabled = true;
  actor.contentWindow.setTimeout = (callback, ms) => { clock.now += ms; return setTimeout(callback, 0); };
  const result = await actor.submit({ requestID: 'disabled', text: 'Preserved typed question' });
  assert.equal(result.state, 'failed'); assert.equal(result.submitted, false); assert.equal(state.sends, 0); assert.equal(state.draft, 'Preserved typed question');
});

function unavailableSendFixture() {
  const result = fixture(), { actor, clock } = result;
  actor.contentWindow.setTimeout = (callback, ms) => { clock.now += ms; queueMicrotask(callback); return 0; };
  return result;
}

test('an unidentified website Send reports missing controls without alleging login or quota failure', async () => {
  const { actor, state } = unavailableSendFixture(); actor.sendButtons = () => [];
  const result = await actor.submit({ requestID: 'missing-controls-reason', text: 'Retain this draft' });
  assert.match(result.error, /未识别到网页发送按钮/); assert.doesNotMatch(result.error, /登录|额度|上传/);
  assert.equal(result.state, 'failed'); assert.equal(result.submitted, false); assert.equal(result.retryable, true); assert.equal(state.sends, 0); assert.equal(state.draft, 'Retain this draft');
});

test('a disabled website Send is distinguished from a missing control while preserving the owned stage', async () => {
  const { actor, state, send } = unavailableSendFixture(); send.disabled = true;
  const result = await actor.submit({ requestID: 'disabled-controls-reason', text: 'Retain the disabled-control draft' });
  assert.match(result.error, /发送按钮尚未启用/); assert.doesNotMatch(result.error, /未识别|登录|额度/);
  assert.equal(result.submitted, false); assert.equal(result.retryable, true); assert.equal(state.sends, 0); assert.equal(state.draft, 'Retain the disabled-control draft');
});

test('a website that loses the filled question reports lost input without claiming its draft was retained', async () => {
  const { actor, state } = unavailableSendFixture(); actor.sendButtons = () => [];
  actor.receiveMessage = async ({ name }) => { assert.equal(name, 'fill'); state.draft = 'A website replacement draft'; };
  const result = await actor.submit({ requestID: 'lost-input-reason', text: 'Original local question' });
  assert.match(result.error, /网页未保留本轮输入/); assert.doesNotMatch(result.error, /草稿已保留|登录|额度/);
  assert.equal(result.submitted, false); assert.equal(!!result.retryable, false); assert.equal(state.sends, 0); assert.equal(state.draft, 'A website replacement draft');
});

test('a verification block appearing after fill reports the actual block instead of guessing a Send failure', async () => {
  const { actor, state } = unavailableSendFixture(); actor.sendButtons = () => [];
  actor.receiveMessage = async ({ data }) => { state.draft = data.text; state.blocked = '请完成此浏览器验证。'; };
  const result = await actor.submit({ requestID: 'verification-reason', text: 'Verification draft' });
  assert.equal(result.error, '请完成此浏览器验证。'); assert.equal(result.needsInteraction, true); assert.equal(result.submitted, false); assert.equal(state.sends, 0);
});

test('a current website request error is retained when Send remains unavailable', async () => {
  const { actor, state } = unavailableSendFixture(); actor.sendButtons = () => [];
  actor.requestFailure = record => record && state.draft ? '本轮服务暂时不可用。' : '';
  const result = await actor.submit({ requestID: 'current-error-reason', text: 'Current failure draft' });
  assert.equal(result.error, '网页返回：本轮服务暂时不可用。'); assert.equal(result.submitted, false); assert.equal(state.sends, 0); assert.equal(state.draft, 'Current failure draft');
});

test('a still-uploading composer reports upload state even when its one Send button is enabled', async () => {
  const { actor, state } = unavailableSendFixture(); actor.uploading = () => !!state.draft;
  const result = await actor.submit({ requestID: 'upload-state-reason', text: 'Waiting upload draft' });
  assert.match(result.error, /附件仍在上传/); assert.doesNotMatch(result.error, /登录|额度|未识别/);
  assert.equal(result.submitted, false); assert.equal(state.sends, 0); assert.equal(state.draft, 'Waiting upload draft');
});

test('old answers and a new assistant without an exact new user echo cannot be imported', async () => {
  const { actor, state } = fixture();
  state.nodes = [message('user', 'old-user', 'Question'), message('assistant', 'old-answer', 'OLD ANSWER')];
  await actor.submit({ requestID: 'correlated', text: 'Question' });
  state.nodes.push(message('assistant', 'unrelated', 'UNRELATED ANSWER'));
  assert.equal(actor.requestStatus('correlated').text, '');
  state.nodes.push(message('user', 'wrong-user', 'Different Question'), message('assistant', 'wrong-answer', 'WRONG ANSWER'));
  assert.equal(actor.requestStatus('correlated').text, '');
});

test('only the exact new user turn streams, and completion waits for a stable finished answer', async () => {
  const { actor, state, clock } = fixture(); await actor.submit({ requestID: 'stream', text: 'Question' });
  state.nodes.push(message('user', 'new-user', 'Question'), message('assistant', 'new-answer', 'Partial')); state.streaming = true;
  let result = actor.requestStatus('stream'); assert.equal(result.state, 'streaming'); assert.equal(result.text, 'Partial');
  state.nodes.at(-1).text = 'Final **answer**'; clock.now += 100; result = actor.requestStatus('stream'); assert.equal(result.text, 'Final **answer**');
  state.streaming = false; state.done = true; clock.now += 100; assert.equal(actor.requestStatus('stream').state, 'streaming');
  clock.now += 649; assert.equal(actor.requestStatus('stream').state, 'streaming');
  clock.now += 1; result = actor.requestStatus('stream'); assert.equal(result.state, 'complete'); assert.equal(result.messageID, 'new-answer');
});

test('initial root chat may become its new conversation while a switch away from an existing chat is uncertain', async () => {
  const { actor, state } = fixture(); await actor.submit({ requestID: 'new-path', text: 'Question' });
  state.path = '/c/new-chat'; state.nodes.push(message('user', 'new-user', 'Question'), message('assistant', 'new-answer', 'New answer'));
  assert.equal(actor.requestStatus('new-path').conversation, '/c/new-chat'); assert.notEqual(actor.requestStatus('new-path').state, 'uncertain');
  const other = fixture(); other.state.path = '/c/original'; await other.actor.submit({ requestID: 'switched', text: 'Question' }); other.state.path = '/c/unrelated';
  assert.equal(other.actor.requestStatus('switched').state, 'uncertain'); assert.equal(other.state.sends, 1);
});

test('another user question during generation ends synchronization rather than mixing replies', async () => {
  const { actor, state } = fixture(); await actor.submit({ requestID: 'external', text: 'Question' });
  state.nodes.push(message('user', 'own-user', 'Question'), message('assistant', 'own-answer', 'Own partial')); state.streaming = true;
  assert.equal(actor.requestStatus('external').text, 'Own partial');
  state.nodes.push(message('user', 'external-user', 'UNRELATED QUESTION'), message('assistant', 'external-answer', 'UNRELATED ANSWER'));
  const result = actor.requestStatus('external'); assert.equal(result.state, 'uncertain'); assert.equal(result.text, 'Own partial');
});

test('lost acknowledgements and actor replacement are uncertain and never resend', async () => {
  const { actor, state, clock } = fixture(); await actor.submit({ requestID: 'no-ack', text: 'Question' }); clock.now += 20001;
  assert.equal(actor.requestStatus('no-ack').state, 'uncertain'); await actor.submit({ requestID: 'no-ack', text: 'Question' }); assert.equal(state.sends, 1);
  const unknown = actor.requestStatus('unknown'); assert.equal(unknown.state, 'uncertain'); assert.equal(unknown.submitted, true); assert.equal(state.sends, 1);
});

test('cancellation before a delayed fill completes prevents the send click', async () => {
  const { actor, state } = fixture(); let release;
  actor.receiveMessage = () => new Promise(resolve => { release = resolve; });
  const submitted = actor.submit({ requestID: 'cancel-preparing', text: 'Question' });
  assert.equal(actor.stopRequest('cancel-preparing').cancelled, true);
  await assert.rejects(actor.submit({ requestID: 'racing-new-request', text: 'Different question' }), /正在回答/); release();
  const result = await submitted; assert.equal(result.state, 'failed'); assert.equal(result.submitted, false); assert.equal(state.sends, 0);
});

test('stop operates only on the owned matched generation and preserves the partial answer', async () => {
  const { actor, state } = fixture(); await actor.submit({ requestID: 'stop-own', text: 'Question' });
  assert.equal(actor.stopRequest('unknown').state, 'uncertain'); assert.equal(state.stops, 0);
  state.nodes.push(message('user', 'own-user', 'Question'), message('assistant', 'own-answer', 'Partial')); state.streaming = true;
  const result = actor.stopRequest('stop-own'); assert.equal(result.cancelled, true); assert.equal(result.text, 'Partial'); assert.equal(state.stops, 1);
  actor.stopRequest('stop-own'); assert.equal(state.stops, 1);
});

function element(tag, attributes = {}, children = []) {
  const attrs = { ...attributes }, classNames = new Set((attrs.class || '').split(/\s+/).filter(Boolean)); classNames.contains = value => classNames.has(value);
  const node = { nodeType: 1, localName: tag, classList: classNames, childNodes: children.map(child => typeof child === 'string' ? { nodeType: 3, textContent: child } : child),
    getAttribute: key => attrs[key] ?? null, hasAttribute: key => Object.hasOwn(attrs, key) };
  Object.defineProperty(node, 'children', { get: () => node.childNodes.filter(child => child.nodeType === 1) });
  Object.defineProperty(node, 'textContent', { get: () => node.childNodes.map(child => child.textContent).join('') });
  const descendants = () => node.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
  node.querySelectorAll = selector => descendants().filter(child => selector === '*' || child.localName === selector || (selector === 'annotation[encoding="application/x-tex"]' && child.localName === 'annotation' && child.getAttribute('encoding') === 'application/x-tex'));
  node.querySelector = selector => node.querySelectorAll(selector)[0] || null; return node;
}

test('answer DOM is serialized as Markdown with headings, lists and code whitespace retained', () => {
  const { actor } = fixture(), tree = element('div', {}, [element('h2', {}, ['Evidence']), element('p', {}, ['Use ', element('strong', {}, ['supported facts']), '.']), element('ul', {}, [element('li', {}, ['One']), element('li', {}, ['Two'])]), element('pre', {}, [element('code', { class: 'language-python' }, ['answer = 42\n\nprint(answer)'])]), element('button', {}, ['COPY UI']), element('script', {}, ['UNTRUSTED UI'])]);
  const result = actor.markdown(tree); assert.match(result, /## Evidence/); assert.match(result, /Use \*\*supported facts\*\*\./); assert.match(result, /- One\n- Two/); assert.match(result, /```python\nanswer = 42\n\nprint\(answer\)\n```/); assert(!result.includes('COPY UI')); assert(!result.includes('UNTRUSTED UI'));
});

test('answer DOM retains TeX source and rejects unsafe hyperlink schemes', () => {
  const { actor } = fixture(), math = element('span', { class: 'katex' }, [element('annotation', { encoding: 'application/x-tex' }, ['E=mc^2'])]), display = element('span', { class: 'katex-display' }, [element('annotation', { encoding: 'application/x-tex' }, ['\\int_0^1 x dx'])]);
  const result = actor.markdown(element('div', {}, [math, display, element('a', { href: 'javascript:alert(1)' }, ['Link label'])]));
  assert.match(result, /\$E=mc\^2\$/); assert.match(result, /\$\$\n\\int_0\^1 x dx\n\$\$/); assert(result.includes('Link label')); assert(!result.includes('javascript:'));
  assert.equal(actor.markdown(element('code', {}, ['`literal`'])), '`` `literal` ``');
});

test('historical website errors do not fail a later owned answer but a new current error does',async()=>{
  const {actor,state}=fixture(),old={textContent:'An earlier request failed',getAttribute:()=>null,closest:()=>null};let errors=[old];
  actor.errorNodes=()=>errors;actor.requestFailure=Object.getPrototypeOf(actor).requestFailure.bind(actor);
  await actor.submit({requestID:'new-turn',text:'A new question'});
  state.nodes.push(message('user','new-user','A new question'),message('assistant','new-answer','Successful text'));state.streaming=true;
  assert.equal(actor.requestStatus('new-turn').state,'streaming');assert.equal(actor.requestStatus('new-turn').text,'Successful text');
  errors=[old,{textContent:'Current request failed',getAttribute:()=>null,closest:()=>null}];
  const failed=actor.requestStatus('new-turn');assert.equal(failed.state,'failed');assert.match(failed.error,/Current request failed/);
});

test('normal slow selected uploads can take thirty seconds and still click Send only once',async()=>{
  const {actor,state,clock}=uploadsFixture();state.readyAt=clock.now+30000;
  const result=await actor.submit({requestID:'slow-upload',text:'Question',files:selectedFiles});
  assert.equal(result.submitted,true);assert(clock.now>=40000);assert.equal(state.attachCalls,1);assert.equal(state.sends,1);
});

test('IPC returns a preparation snapshot while a cancellable upload continues in the actor',async()=>{
  const {actor,state}=uploadsFixture();actor.checkOrigin=()=>{};let release,entered;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r),fill=actor.receiveMessage;
  actor.receiveMessage=async message=>{if(message.name==='attach'){entered();await gate;return fill(message);}return fill(message);};
  const result=await Object.getPrototypeOf(actor).receiveMessage.call(actor,{name:'submit',data:{requestID:'ipc-stage',text:'Question',files:selectedFiles}});
  await start;assert.equal(result.submitted,false);assert(['preparing','uploading'].includes(result.state));assert.equal(state.sends,0);
  actor.stopRequest('ipc-stage');release();await actor.requests.get('ipc-stage').operation;assert.equal(state.sends,0);
});

test('a user-triggered stage retry reuses exact owned text without filling or attaching twice',async()=>{
  const {actor,state,send,clock}=fixture();send.disabled=true;let fills=0;const fill=actor.receiveMessage;
  actor.receiveMessage=message=>{fills++;return fill(message);};actor.contentWindow.setTimeout=(callback,ms)=>{clock.now+=ms;queueMicrotask(callback);return 0;};
  const failed=await actor.submit({requestID:'retry-text',text:'Original question'});assert.equal(failed.retryable,true);assert.equal(state.sends,0);
  send.disabled=false;const resumed=await actor.retryStaged({requestID:'retry-text'});assert.equal(resumed.submitted,true);assert.equal(fills,1);assert.equal(state.sends,1);
  await assert.rejects(actor.retryStaged({requestID:'retry-text'}),/无法确认/);assert.equal(state.sends,1);
});

test('modified webpage staging cannot be continued as the original request',async()=>{
  const {actor,state,send,clock}=fixture();send.disabled=true;actor.contentWindow.setTimeout=(callback,ms)=>{clock.now+=ms;queueMicrotask(callback);return 0;};
  await actor.submit({requestID:'changed-stage',text:'Original question'});state.draft='A manually edited question';send.disabled=false;
  await assert.rejects(actor.retryStaged({requestID:'changed-stage'}),/未知内容/);assert.equal(state.draft,'A manually edited question');assert.equal(state.sends,0);
});

test('same-actor cancelled recovery requires the exact final user and a stable idle page',async()=>{
  const {actor,state,clock}=fixture();await actor.submit({requestID:'cancelled-recovery',text:'Original question'});
  state.path='/c/owned';state.nodes.push(message('user','own-user','Original question'),message('assistant','own-answer','Partial text'));state.streaming=true;
  actor.requestStatus('cancelled-recovery');actor.stopRequest('cancelled-recovery');state.streaming=false;
  const data={requestID:'cancelled-recovery',baselineUserCount:0};assert.equal(actor.recoverRequest(data).state,'recovering');clock.now+=700;
  const result=actor.recoverRequest(data);assert.equal(result.state,'cancelled');assert.equal(result.idleVerified,true);assert.equal(result.text,'Partial text');assert.equal(state.sends,1);
  state.nodes.push(message('user','manual-user','Another manual question'));assert.equal(actor.recoverRequest(data).state,'uncertain');
});

test('reloaded actor recovery requires persisted path, exact user ID, text, count and a completion control',()=>{
  const {actor,state,clock}=fixture();state.path='/c/owned';state.done=true;state.nodes.push(message('user','own-user','Exact original question'),message('assistant','own-answer','Late complete reply'));
  const data={requestID:'persisted',conversation:'/c/owned',sentText:'Exact original question',userID:'own-user',baselineUserCount:0};
  assert.equal(actor.recoverRequest({...data,userID:''}).state,'uncertain');assert.equal(actor.recoverRequest({...data,sentText:'Other question'}).state,'uncertain');
  assert.equal(actor.recoverRequest(data).state,'recovering');clock.now+=700;const result=actor.recoverRequest(data);assert.equal(result.state,'complete');assert.equal(result.text,'Late complete reply');assert.equal(state.sends,0);
  const other=fixture();other.state.path='/c/owned';other.state.nodes.push(message('user','different-user','Exact original question'),message('assistant','own-answer','Wrong reply'));
  assert.equal(other.actor.recoverRequest(data).state,'uncertain');assert.equal(other.state.sends,0);
});

function ownedUploadStage() {
  const result=uploadsFixture(),{actor,state,send}=result;
  const chip=(name,id)=>({textContent:name,contains:()=>false,closest:()=>null,getAttribute:key=>key==='data-file-id'?id:null});
  state.chips=selectedFiles.map((file,index)=>chip(file.name,'original-'+index));state.inputFiles=selectedFiles.map(file=>({name:file.name,type:file.type}));
  actor.attachmentNodes=()=>state.chips;actor.document.querySelectorAll=selector=>selector==='input[type="file"]'?[{get files(){return state.inputFiles;}}]:[];
  const attach=actor.receiveMessage;actor.receiveMessage=async message=>{const value=await attach(message);if(message.name==='attach')actor.activeRequest.injectedFiles=[...state.inputFiles];return value;};
  send.disabled=true;
  return{...result,chip};
}

test('continuing a completed upload accepts retained original chips after the file input clears',async()=>{
  const {actor,state,send}=ownedUploadStage();const failed=await actor.submit({requestID:'owned-upload',text:'Question',files:selectedFiles});
  assert.equal(failed.retryable,true);state.inputFiles=[];send.disabled=false;const result=await actor.retryStaged({requestID:'owned-upload'});
  assert.equal(result.submitted,true);assert.equal(state.attachCalls,1);assert.equal(state.sends,1);
});

test('same-name replacements cannot inherit the original upload ownership',async()=>{
  for(const replace of ['file','chip']){
    const {actor,state,send,chip}=ownedUploadStage();const id='replaced-'+replace;await actor.submit({requestID:id,text:'Question',files:selectedFiles});
    if(replace==='file')state.inputFiles=state.inputFiles.map(file=>({...file}));
    else{state.inputFiles=[];state.chips=selectedFiles.map((file,index)=>chip(file.name,'different-'+index));}
    send.disabled=false;await assert.rejects(actor.retryStaged({requestID:id}),/未知内容/);assert.equal(state.sends,0);assert.equal(state.attachCalls,1);
  }
});

test('framework replacement of an original chip preserves ownership only with its exact file ID',async()=>{
  const {actor,state,send,chip}=ownedUploadStage();await actor.submit({requestID:'same-id-render',text:'Question',files:selectedFiles});
  state.inputFiles=[];state.chips=selectedFiles.map((file,index)=>chip(file.name,'original-'+index));send.disabled=false;
  assert.equal((await actor.retryStaged({requestID:'same-id-render'})).submitted,true);assert.equal(state.attachCalls,1);assert.equal(state.sends,1);
});

test('attachment replacement during a continued preparation is checked again immediately before Send',async()=>{
  const {actor,state,send,chip}=ownedUploadStage();await actor.submit({requestID:'late-replace',text:'Question',files:selectedFiles});
  send.disabled=false;actor.sendButtons=()=>{state.inputFiles=[];state.chips=selectedFiles.map((file,index)=>chip(file.name,'late-unknown-'+index));return[send];};
  const result=await actor.retryStaged({requestID:'late-replace'});assert.equal(result.submitted,false);assert.match(result.error,/原附件.*改变/);assert.equal(state.sends,0);
});

test('reloaded partial reply with a current error and Copy is failed rather than verified complete',()=>{
  const {actor,state,clock}=fixture(),user=message('user','own-user','Question'),answer=message('assistant','own-answer','Incomplete partial text');
  state.path='/c/owned';state.nodes=[user,answer];state.done=true;
  const currentError={textContent:'Generation failed',getAttribute:()=>null,closest:selector=>selector==='[data-message-author-role]'?null:{querySelector:()=>user}};
  actor.errorNodes=()=>[currentError];actor.requestFailure=Object.getPrototypeOf(actor).requestFailure.bind(actor);
  const data={requestID:'reload-error',conversation:'/c/owned',sentText:'Question',userID:'own-user',baselineUserCount:0};actor.recoverRequest(data);clock.now+=700;
  const result=actor.recoverRequest(data);assert.equal(result.state,'failed');assert.equal(result.idleVerified,true);assert.match(result.error,/Generation failed/);assert.equal(state.sends,0);
});

test('reloaded older-turn errors remain excluded from a later complete reply',()=>{
  const {actor,state,clock}=fixture(),oldUser=message('user','old-user','Previous'),oldAnswer=message('assistant','old-answer','Previous failed partial'),user=message('user','own-user','Question'),answer=message('assistant','own-answer','Complete result');
  state.path='/c/owned';state.nodes=[oldUser,oldAnswer,user,answer];state.done=true;
  actor.errorNodes=()=>[{textContent:'Previous failure',getAttribute:()=>null,closest:()=>oldAnswer}];actor.requestFailure=Object.getPrototypeOf(actor).requestFailure.bind(actor);
  const data={requestID:'reload-old-error',conversation:'/c/owned',sentText:'Question',userID:'own-user',baselineUserCount:1};actor.recoverRequest(data);clock.now+=700;
  assert.equal(actor.recoverRequest(data).state,'complete');assert.equal(state.sends,0);
});

// Current public website attributes captured in the live audit, without any
// account data. The old fixtures above remain to exercise both supported DOMs.
const modernUserID='11111111-1111-4111-8111-111111111111',modernAnswerID='22222222-2222-4222-8222-222222222222';
function modernMessage(role,id,text,{complete=false,copy=false}={}) {
  const content=element(role==='user'?'p':'div',{},[element('p',{},[text])]),attrs={'data-message-role':role,id,...(complete?{'data-message-complete':''}:{})};
  const row={localName:'li',id,isConnected:true,parentElement:{closest:()=>null},contains:node=>node===content,getAttribute:key=>attrs[key]??null,hasAttribute:key=>Object.hasOwn(attrs,key),
    matches:selector=>selector==='ol[data-conversation-transcript] > li[data-message-role]',closest:()=>row,
    querySelector:selector=>role==='user'&&/data-user-message-copy|data-user-message-bubble/.test(selector)?content:role==='assistant'&&/data-assistant-markdown/.test(selector)?content:null,
    querySelectorAll:selector=>copy&&/data-copy-message/.test(selector)?[{isConnected:true}]:[]};
  Object.defineProperty(row,'textContent',{get:()=>role.toUpperCase()+' ATTRIBUTION '+content.textContent+' COPY BUTTON'});return row;
}
function modernFixture() {
  const result=fixture(),{actor,state}=result,proto=Object.getPrototypeOf(actor);
  actor.messageNodes=proto.messageNodes.bind(actor);actor.userText=proto.userText.bind(actor);actor.answerText=proto.answerText.bind(actor);actor.hasCompletionControl=proto.hasCompletionControl.bind(actor);actor.visible=()=>true;
  actor.document={location:{pathname:'/c/modern'},readyState:'complete',querySelector:()=>null,querySelectorAll:selector=>selector.includes('[data-message-author-role]')&&selector.includes('li[data-message-role]')?state.nodes:[]};
  return result;
}

test('modern transcript roles and UUIDs correlate the exact user and stream only assistant markdown',async()=>{
  const {actor,state,clock}=modernFixture();await actor.submit({requestID:'modern-turn',text:'A modern question'});
  state.path='/c/modern';state.nodes=[modernMessage('user',modernUserID,'A modern question'),modernMessage('assistant',modernAnswerID,'A modern answer',{complete:true})];state.streaming=true;
  let result=actor.requestStatus('modern-turn');assert.equal(result.state,'streaming');assert.equal(result.userID,modernUserID);assert.equal(result.messageID,modernAnswerID);assert.equal(result.text,'A modern answer');assert(!result.text.includes('ATTRIBUTION'));
  const status=actor.pageStatus();assert.equal(status.userCount,1);assert.equal(status.assistantCount,1);assert.equal(status.lastUserID,modernUserID);assert.equal(status.lastAssistantID,modernAnswerID);
  state.streaming=false;actor.requestStatus('modern-turn');clock.now+=700;result=actor.requestStatus('modern-turn');assert.equal(result.state,'complete');assert.equal(state.sends,1);
});

test('modern completion accepts the observed copy control and refuses an explicitly false completion flag',()=>{
  const {actor}=modernFixture();assert.equal(actor.hasCompletionControl(modernMessage('assistant',modernAnswerID,'Done',{copy:true})),true);
  const incomplete=modernMessage('assistant',modernAnswerID,'Partial');const get=incomplete.getAttribute;incomplete.hasAttribute=key=>key==='data-message-complete';incomplete.getAttribute=key=>key==='data-message-complete'?'false':get(key);
  assert.equal(actor.hasCompletionControl(incomplete),false);
});

test('modern persisted user identity permits read-only reload recovery without sending again',()=>{
  const {actor,state,clock}=modernFixture();state.path='/c/modern';state.nodes=[modernMessage('user',modernUserID,'Question'),modernMessage('assistant',modernAnswerID,'Late answer',{complete:true})];
  const data={requestID:'modern-reload',conversation:'/c/modern',userID:modernUserID,sentText:'Question',baselineUserCount:0};
  assert.equal(actor.recoverRequest({...data,userID:modernAnswerID}).state,'uncertain');assert.equal(actor.recoverRequest(data).state,'recovering');clock.now+=700;
  const result=actor.recoverRequest(data);assert.equal(result.state,'complete');assert.equal(result.messageID,modernAnswerID);assert.equal(result.text,'Late answer');assert.equal(state.sends,0);
});

test('modern conversation extraction reads content wrappers without attribution or copy labels',async()=>{
  const {actor,state}=modernFixture();actor.checkOrigin=()=>{};state.nodes=[modernMessage('user',modernUserID,'Exact selected material question'),modernMessage('assistant',modernAnswerID,'Answer body',{complete:true})];
  const result=await Object.getPrototypeOf(actor).receiveMessage.call(actor,{name:'conversation'});
  assert.equal(result.turns.length,1);assert.equal(result.turns[0].question,'Exact selected material question');assert.equal(result.turns[0].answer,'Answer body');assert.equal(result.turns[0].id,modernAnswerID);
});

test('observed modern login entry controls prevent any guest-page automatic submission',async()=>{
  for(const attribute of ['data-login-button','data-mobile-auth-entry-action']){
    const {actor,state}=fixture();actor.blocked=Object.getPrototypeOf(actor).blocked.bind(actor);actor.visible=()=>true;
    actor.document.querySelectorAll=selector=>selector.includes(attribute)?[{}]:[];
    await assert.rejects(actor.submit({requestID:'guest-'+attribute,text:'Must not submit on a guest page'}),/登录/);assert.equal(state.sends,0);assert.equal(state.draft,'');
  }
});

test('modern UUID identity is accepted only for the observed transcript row scope',()=>{
  const {actor}=fixture(),outside={id:modernUserID,getAttribute:key=>key==='id'?modernUserID:null,matches:()=>false};
  assert.equal(actor.messageID(outside),'');assert.equal(actor.messageID(modernMessage('user',modernUserID,'Question')),modernUserID);
  assert.equal(actor.messageID(message('assistant','legacy-answer','Old layout')),'legacy-answer');
});

function nativeFillFixture(options = {}) {
  const result = fixture(), { actor, clock } = result, commands = [], events = [], directSets = [];
  let current, ticks = 0;
  class Textarea {
    constructor(value) { this.raw = value; this.localName = 'textarea'; this.isConnected = true; this.selectionStart = this.selectionEnd = 0; }
    get value() { return this.raw; }
    set value(value) { directSets.push(value); this.raw = value; }
    focus() { actor.document.activeElement = options.stealFocus ? { localName: 'input', value: '' } : this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    dispatchEvent(event) { events.push(event); return true; }
  }
  current = new Textarea(options.before || '');
  actor.document = { activeElement: null, execCommand(name, _ui, text) {
    commands.push({ name, text, start: current.selectionStart, end: current.selectionEnd });
    assert.equal(actor.document.activeElement, current, 'native editing must target the identified editor');
    current.raw = current.raw.slice(0, current.selectionStart) + (options.partialFailure ? text.slice(0, 2) : text) + current.raw.slice(current.selectionEnd);
    return !options.partialFailure && !options.falseReceipt;
  } };
  actor.editor = () => current; actor.clearCompact = () => {}; actor.applyPresentation = () => {}; actor.checkOrigin = () => {};
  actor.contentWindow.HTMLTextAreaElement = Textarea;
  actor.contentWindow.Event = class { constructor(type, properties) { this.type = type; Object.assign(this, properties); } };
  actor.contentWindow.setTimeout = (callback, ms) => {
    clock.now += ms; queueMicrotask(() => {
      if (++ticks === 1) {
        if (options.disappear) { current.isConnected = false; current = null; }
        else if (options.replacement !== undefined) { const previous = current; current = new Textarea(options.replacement === 'preserve' ? previous.value : options.replacement); previous.isConnected = false; }
      }
      callback();
    }); return 0;
  };
  actor.receiveMessage = Object.getPrototypeOf(actor).receiveMessage.bind(actor);
  return { ...result, commands, events, directSets, current: () => current };
}

test('production textarea fill appends through one native edit at the end of the existing draft', async () => {
  const f = nativeFillFixture({ before: 'Existing draft' });
  const result = await f.actor.receiveMessage({ name: 'fill', data: { text: 'Only the new question' } });
  assert.equal(result.draft, true); assert.equal(f.current().value, 'Existing draft\n\nOnly the new question');
  assert.deepEqual(f.commands, [{ name: 'insertText', text: '\n\nOnly the new question', start: 14, end: 14 }]);
  assert.equal(f.directSets.length, 0); assert.equal(f.state.sends, 0);
});

test('production fill refuses to edit when focus belongs to a different input', async () => {
  const f = nativeFillFixture({ before: 'Original draft', stealFocus: true });
  await assert.rejects(f.actor.receiveMessage({ name: 'fill', data: { text: 'Must stay local' } }));
  assert.equal(f.commands.length, 0); assert.equal(f.directSets.length, 0); assert.equal(f.current().value, 'Original draft'); assert.equal(f.state.sends, 0);
});

test('a native edit reporting partial failure is never retried through a setter or another insertion', async () => {
  const f = nativeFillFixture({ partialFailure: true });
  await assert.rejects(f.actor.receiveMessage({ name: 'fill', data: { text: 'One attempted insertion' } }));
  assert.equal(f.commands.length, 1); assert.equal(f.directSets.length, 0); assert.equal(f.current().value, 'On'); assert.equal(f.state.sends, 0);
});

test('a false native-edit return value does not duplicate text already inserted exactly once', async () => {
  const f = nativeFillFixture({ before: 'Existing draft', falseReceipt: true });
  const result = await f.actor.receiveMessage({ name: 'fill', data: { text: 'One complete native insertion' } });
  assert.equal(result.draft, true); assert.equal(f.current().value, 'Existing draft\n\nOne complete native insertion');
  assert.equal(f.commands.length, 1); assert.equal(f.directSets.length, 0); assert.equal(f.state.sends, 0);
});

test('production fill refuses a replacement editor that discards the text instead of trusting the detached old node', async () => {
  const f = nativeFillFixture({ replacement: '' });
  await assert.rejects(f.actor.receiveMessage({ name: 'fill', data: { text: 'Keep only if the live editor retains this' } }));
  assert.equal(f.commands.length, 1); assert.equal(f.directSets.length, 0); assert.equal(f.current().value, ''); assert.equal(f.state.sends, 0);
});

test('production fill accepts a framework replacement that keeps the exact full draft without inserting twice', async () => {
  const f = nativeFillFixture({ before: 'Prior paragraph', replacement: 'preserve' });
  const result = await f.actor.receiveMessage({ name: 'fill', data: { text: 'New paragraph' } });
  assert.equal(result.draft, true); assert.equal(f.current().value, 'Prior paragraph\n\nNew paragraph');
  assert.equal(f.commands.length, 1); assert.equal(f.directSets.length, 0); assert.equal(f.state.sends, 0);
});

test('production fill cannot confirm a detached editor when the website removes the live input', async () => {
  const f = nativeFillFixture({ disappear: true });
  await assert.rejects(f.actor.receiveMessage({ name: 'fill', data: { text: 'Must stay in a live input' } }));
  assert.equal(f.current(), null); assert.equal(f.commands.length, 1); assert.equal(f.directSets.length, 0); assert.equal(f.state.sends, 0);
});

test('production fill rejects a replacement containing the question inside a different full draft', async () => {
  const f = nativeFillFixture({ before: 'Original paragraph', replacement: 'Unrelated paragraph\n\nThe same question' });
  await assert.rejects(f.actor.receiveMessage({ name: 'fill', data: { text: 'The same question' } }));
  assert.equal(f.commands.length, 1); assert.equal(f.directSets.length, 0); assert.equal(f.state.sends, 0);
});

function scopedSendFixture({ editorID = 'mobile-composer-prompt' } = {}) {
  const result = fixture(), { actor, state } = result, nodes = [];
  const matches = (node, selector) => selector.split(',').some(part => {
    part = part.trim();
    if (part === ':disabled') return !!node.disabled;
    const tag = part.match(/^[a-z][a-z0-9-]*/i)?.[0], id = part.match(/#([a-z0-9_-]+)/i)?.[1];
    if (tag && node.localName !== tag.toLowerCase() || id && node.id !== id) return false;
    for (const attribute of part.matchAll(/\[([^\s\]=]+)(?:\s*=\s*["']?([^\]"']*)["']?)?\]/g)) {
      if (!node.hasAttribute(attribute[1])) return false;
      if (attribute[2] !== undefined && node.getAttribute(attribute[1]) !== attribute[2]) return false;
    }
    return true;
  });
  const create = (localName, attrs = {}, parentElement = null) => {
    const node = { localName, parentElement, isConnected: true, disabled: false, textContent: '',
      getAttribute: name => Object.hasOwn(attrs, name) ? String(attrs[name]) : null, hasAttribute: name => Object.hasOwn(attrs, name),
      matches(selector) { return matches(this, selector); },
      closest(selector) { for (let candidate = this; candidate; candidate = candidate.parentElement) if (matches(candidate, selector)) return candidate; return null; },
      contains(other) { for (let candidate = other; candidate; candidate = candidate.parentElement) if (candidate === this) return true; return false; },
      querySelectorAll(selector) { return nodes.filter(other => other !== this && this.contains(other) && matches(other, selector)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      getClientRects: () => [{ width: 30, height: 30 }], click: () => state.sends++
    };
    Object.defineProperties(node, {
      id: { get: () => attrs.id || '' }, type: { get: () => attrs.type || (localName === 'button' ? 'submit' : '') },
      form: { get: () => attrs.form ? nodes.find(candidate => candidate.localName === 'form' && candidate.id === attrs.form) || null : node.closest('form') },
      elements: { get: () => nodes.filter(candidate => ['button', 'textarea', 'input'].includes(candidate.localName) && candidate.form === node) }
    });
    node.classList = { contains: name => String(attrs.class || '').split(/\s+/).includes(name) };
    nodes.push(node); return node;
  };
  const document = { querySelectorAll: selector => nodes.filter(node => matches(node, selector)), querySelector(selector) { return this.querySelectorAll(selector)[0] || null; } };
  const form = create('form', { id: 'own-chat-form' }), root = create('div', { 'data-type': 'unified-composer' }, form), editor = create('textarea', { id: editorID }, root), foreignForm = create('form', { id: 'foreign-search-form' });
  actor.document = document; actor.editor = () => editor; actor.contentWindow.getComputedStyle = node => ({ display: node.hasAttribute('hidden') ? 'none' : 'block', visibility: 'visible' });
  actor.sendButtons = Object.getPrototypeOf(actor).sendButtons.bind(actor);
  return { ...result, document, form, root, editor, foreignForm, button(attrs = {}, parent = root) { const node = create('button', attrs, parent); node.ownerDocument = document; return node; } };
}

test('production Send discovery recognizes exact short English and Chinese labels', () => {
  for (const label of ['Send', '发送']) {
    const f = scopedSendFixture(), send = f.button({ type: 'button', 'aria-label': label });
    assert.deepEqual([...f.actor.sendButtons()], [send]); assert.equal(f.state.sends, 0);
  }
});

test('production Send discovery reaches a sibling toolbar in the same owning form', () => {
  const f = scopedSendFixture(), send = f.button({ type: 'submit', 'aria-label': 'Send message' }, f.form);
  assert.equal(f.root.contains(send), false); assert.equal(send.form, f.form);
  assert.deepEqual([...f.actor.sendButtons()], [send]);
});

test('production Send discovery accepts an external button associated with the chat form', () => {
  const f = scopedSendFixture(), send = f.button({ type: 'submit', form: f.form.id, 'aria-label': 'Send message' }, null);
  assert.equal(f.form.contains(send), false); assert.equal(send.form, f.form); assert(f.form.elements.includes(send));
  assert.deepEqual([...f.actor.sendButtons()], [send]);
});

test('production Send discovery accepts an unlabeled submit only for a positively identified chat form', () => {
  const f = scopedSendFixture(), send = f.button({ type: 'submit' }, f.form);
  assert.deepEqual([...f.actor.sendButtons()], [send]);
  const unrelated = scopedSendFixture({ editorID: 'unrelated-search' }); unrelated.button({ type: 'submit' }, unrelated.form);
  assert.equal(unrelated.actor.sendButtons().length, 0, 'generic forms must not acquire the chat submit fallback');
});

test('production Send discovery excludes voice, unlabeled type-button, hidden and foreign-form controls', () => {
  const f = scopedSendFixture(), own = f.button({ type: 'submit', 'data-testid': 'send-button' });
  f.button({ type: 'button', 'aria-label': 'Start voice' }); f.button({ type: 'button' });
  f.button({ type: 'submit', 'data-testid': 'send-button', hidden: '' });
  f.button({ type: 'submit', 'data-testid': 'send-button' }, f.foreignForm);
  f.button({ type: 'submit', 'data-testid': 'send-button', form: f.foreignForm.id });
  assert.deepEqual([...f.actor.sendButtons()], [own]); assert.equal(f.state.sends, 0);
});

test('a known Send and an unlabeled submit in the same chat form remain ambiguous and never submit', async () => {
  const f = scopedSendFixture(); f.button({ type: 'submit', 'data-testid': 'send-button' }); f.button({ type: 'submit' }, f.form);
  assert.equal(f.actor.sendButtons().length, 2);
  await assert.rejects(f.actor.submit({ requestID: 'known-plus-semantic-ambiguity', text: 'Must not pick a preferred Send' }), /唯一/);
  assert.equal(f.state.sends, 0); assert.equal(f.state.draft, '');
});

// Public DOM attributes from the actual webpage; all messages/IDs are synthetic.
// This tree has no old transcript/author-role selectors or generated Stop control.
function searchUnitFixture() {
  const result = fixture(), { actor, state } = result, proto = Object.getPrototypeOf(actor);
  function dom(tag, attributes = {}, children = []) {
    const attrs = { ...attributes }, node = element(tag, attrs, children);
    node.parentElement = null; node.isConnected = true;
    node.getAttribute = key => attrs[key] ?? null; node.hasAttribute = key => Object.hasOwn(attrs, key);
    node.setAttribute = (key, value) => { attrs[key] = String(value); };
    node.removeAttribute = key => { delete attrs[key]; };
    // A small structural selector evaluator, independent of the actor methods.
    const simple = (target, selector) => {
      const exclusions = [...selector.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
      if (exclusions.some(value => simple(target, value))) return false;
      selector = selector.replace(/:not\([^)]+\)/g, '');
      const tagName = selector.match(/^[\w-]+/); if (tagName && target.localName !== tagName[0]) return false;
      const cls = selector.match(/\.([\w-]+)/); if (cls && !target.classList.contains(cls[1])) return false;
      return [...selector.matchAll(/\[([^\s\]=^*]+)(?:([*^]?=)"([^"]*)")?\]/g)].every(([, key, op, value]) => {
        const actual = target.getAttribute(key);
        return !op ? actual !== null : op === '=' ? actual === value : op === '^=' ? actual?.startsWith(value) : actual?.includes(value);
      });
    };
    const matches = (target, selector) => selector.split(',').some(branch => {
      const parts = branch.trim().match(/(?:\[[^\]]*\]|[^\s>])+/g) || [];
      if (!parts.length || !simple(target, parts.pop())) return false;
      let parent = target.parentElement;
      while (parts.length) { const part = parts.pop(); while (parent && !simple(parent, part)) parent = parent.parentElement; if (!parent) return false; parent = parent.parentElement; }
      return true;
    });
    node.matches = selector => matches(node, selector);
    node.closest = selector => { let target = node; while (target && !matches(target, selector)) target = target.parentElement; return target; };
    node.contains = target => { while (target && target !== node) target = target.parentElement; return target === node; };
    node.querySelectorAll = selector => {
      const all = target => target.children.flatMap(child => [child, ...all(child)]);
      return all(node).filter(child => selector === '*' || matches(child, selector));
    };
    node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
    node.getClientRects = () => [{ width: 200, height: 40 }];
    node.append = child => { node.childNodes.push(child); child.parentElement = node; };
    for (const child of node.children) child.parentElement = node;
    return node;
  }
  const conversation = dom('div', { 'data-thread-find-target': 'conversation' }), body = dom('body', {}, [conversation]);
  actor.document = { readyState: 'complete', location: { pathname: '/c/search-units' }, querySelectorAll: selector => body.querySelectorAll(selector), querySelector: selector => body.querySelector(selector) };
  actor.contentWindow.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  for (const name of ['messageNodes', 'userText', 'answerText', 'hasCompletionControl', 'isStreaming', 'visible']) actor[name] = proto[name].bind(actor);
  actor.stopButtons = () => [];
  function turn(question = 'Exact fixed question', answer = 'Exact complete answer', options = {}) {
    const userID = options.userID || modernUserID, answerID = options.answerID || modernAnswerID, index = conversation.children.length;
    const bubble = dom('div', { 'data-user-message-bubble': 'true' }, [dom('div', { class: 'whitespace-pre-wrap' }, [question])]);
    const user = dom('div', { 'data-chatgpt-search-unit-key': `fallback-turn-${index}:0:${options.role || 'user'}`, 'data-chatgpt-search-message-ids': options.userIDs ?? userID }, [bubble]);
    const markdown = dom('div', { 'data-markdown-text-style': 'assistant-message' }, [dom('p', {}, [answer])]);
    const assistant = dom('div', { 'data-chatgpt-search-unit-key': `fallback-turn-${index}:2:assistant`, 'data-chatgpt-search-message-ids': options.answerIDs ?? `${answerID} ${answerID}` }, [dom('h4', { 'data-conversation-role': 'assistant' }, ['Assistant attribution']), markdown, dom('button', { 'aria-label': 'Copy' }, ['Copy UI'])]);
    const status = dom('div', { 'data-talvt-turn-state': options.state || 'complete' }, [dom('div', {}, [dom('h4', { 'data-conversation-role': 'user' }, ['User attribution']), user]), assistant]);
    const wrapper = dom('div', { 'data-turn-key': userID }, [status]); (options.outside ? body : conversation).append(wrapper);
    return { user, assistant, bubble, markdown, status };
  }
  state.path = '/c/search-units'; return { ...result, dom, conversation, body, turn };
}

test('search-unit discovery uses conversation scope, exact role suffix and one deduplicated UUID', () => {
  const f = searchUnitFixture(), row = f.turn();
  f.turn('Outside question', 'Outside answer', { outside: true });
  const invalidRole = f.turn('Not a user', 'Another answer', { role: 'user-extra', userID: '33333333-3333-4333-8333-333333333333', answerID: '44444444-4444-4444-8444-444444444444' });
  assert.deepEqual([...f.actor.messageNodes()].filter(node => f.actor.messageRole(node) === 'user'), [row.user]);
  assert.equal(f.actor.messageRole(invalidRole.user), '');
  assert.equal(f.actor.messageID(row.user), modernUserID); assert.equal(f.actor.messageID(row.assistant), modernAnswerID);
  assert.equal(f.actor.messageOwner(row.bubble), row.user); assert.equal(f.actor.messageOwner(row.markdown), row.assistant);
  assert.equal(f.actor.pageStatus().userCount, 1);
});

test('search-unit automatic correlation reads precise markdown and follows modern streaming state despite Copy', async () => {
  const f = searchUnitFixture(); await f.actor.submit({ requestID: 'search-unit-turn', text: 'Exact fixed question' });
  const row = f.turn(undefined, undefined, { state: 'streaming' });
  let result = f.actor.requestStatus('search-unit-turn');
  assert.equal(result.state, 'streaming'); assert.equal(result.userID, modernUserID); assert.equal(result.messageID, modernAnswerID); assert.equal(result.text, 'Exact complete answer');
  assert.equal(f.actor.hasCompletionControl(row.assistant), false); assert.equal(f.actor.isStreaming(), true);
  f.clock.now += 2000; assert.equal(f.actor.requestStatus('search-unit-turn').state, 'streaming', 'Copy during streaming must not complete an answer');
  row.status.setAttribute('data-talvt-turn-state', 'pending'); f.clock.now += 2000;
  assert.notEqual(f.actor.requestStatus('search-unit-turn').state, 'complete', 'unknown explicit turn state cannot use the sawStreaming fallback');
  row.status.removeAttribute('data-talvt-turn-state'); f.actor.requestStatus('search-unit-turn'); f.clock.now += 2000;
  assert.equal(f.actor.hasCompletionControl(row.assistant), false);
  assert.notEqual(f.actor.requestStatus('search-unit-turn').state, 'complete', 'a temporarily missing modern state cannot use Copy or the legacy stable fallback');
  row.status.setAttribute('data-talvt-turn-state', 'complete'); f.actor.requestStatus('search-unit-turn'); f.clock.now += 700;
  result = f.actor.requestStatus('search-unit-turn'); assert.equal(result.state, 'complete'); assert.equal(f.state.sends, 1);
});

test('search-unit conversation extraction excludes attribution and returns only precise user/answer content', async () => {
  const f = searchUnitFixture(); f.turn(); f.actor.checkOrigin = () => {};
  const result = await Object.getPrototypeOf(f.actor).receiveMessage.call(f.actor, { name: 'conversation' });
  assert.equal(result.turns.length, 1); assert.equal(result.turns[0].question, 'Exact fixed question'); assert.equal(result.turns[0].answer, 'Exact complete answer'); assert.equal(result.turns[0].id, modernAnswerID);
});

test('search-unit malformed or multi-identity rows cannot be imported, correlated or treated as an empty send baseline', async () => {
  for (const ids of ['', 'invalid-id', `${modernUserID} ${modernAnswerID}`]) {
    const f = searchUnitFixture(), row = f.turn(undefined, undefined, { userIDs: ids });
    assert.equal(f.actor.messageID(row.user), ''); assert.equal([...f.actor.messageNodes()].includes(row.user), false);
    f.actor.checkOrigin = () => {};
    await assert.rejects(Object.getPrototypeOf(f.actor).receiveMessage.call(f.actor, { name: 'conversation' }), /身份/);
    await assert.rejects(f.actor.submit({ requestID: 'malformed-search-unit', text: 'Must not use an ambiguous baseline' }), /身份|结构/);
    assert.equal(f.state.sends, 0);
  }
  const f = searchUnitFixture(); await f.actor.submit({ requestID: 'ambiguous-answer', text: 'Exact fixed question' });
  f.turn(undefined, undefined, { answerIDs: `${modernAnswerID} ${modernUserID}` }); f.actor.requestStatus('ambiguous-answer'); f.clock.now += 2000;
  assert.notEqual(f.actor.requestStatus('ambiguous-answer').state, 'complete'); assert.equal(f.actor.requestStatus('ambiguous-answer').text, '');
});

test('search-unit explicit recovery can migrate an old no-userID checkpoint using exact saved path/count/full text only', () => {
  const f = searchUnitFixture(); f.turn();
  const checkpoint = { requestID: 'search-unit-migration', conversation: '/c/search-units', sentText: 'Exact fixed question', baselineUserCount: 0 };
  assert.equal(f.actor.recoverRequest(checkpoint).state, 'recovering'); f.clock.now += 700;
  const result = f.actor.recoverRequest(checkpoint); assert.equal(result.state, 'complete'); assert.equal(result.userID, modernUserID); assert.equal(result.messageID, modernAnswerID); assert.equal(result.text, 'Exact complete answer'); assert.equal(f.state.sends, 0);
});

test('search-unit recovery rejects wrong or absent path, changed full text/count, ambiguous IDs and mismatched persisted userID', () => {
  const checkpoint = { requestID: 'search-unit-reject', conversation: '/c/search-units', sentText: 'Exact fixed question', baselineUserCount: 0 };
  for (const override of [{ conversation: '/' }, { conversation: '' }, { conversation: '/c/other' }, { sentText: 'fixed question' }, { sentText: '' }, { baselineUserCount: 1 }, { baselineUserCount: -1 }, { baselineUserCount: undefined }, { userID: modernAnswerID }]) {
    const f = searchUnitFixture(); f.turn(); assert.equal(f.actor.recoverRequest({ ...checkpoint, ...override }).state, 'uncertain'); assert.equal(f.state.sends, 0);
  }
  const f = searchUnitFixture(); f.turn(); f.turn('Exact fixed question', 'Other answer', { userID: '33333333-3333-4333-8333-333333333333', answerID: '44444444-4444-4444-8444-444444444444' });
  assert.equal(f.actor.recoverRequest(checkpoint).state, 'uncertain');
  const ambiguous = searchUnitFixture(); ambiguous.turn(undefined, undefined, { userIDs: `${modernUserID} ${modernAnswerID}` }); assert.equal(ambiguous.actor.recoverRequest(checkpoint).state, 'uncertain');
  const missingState = searchUnitFixture(), row = missingState.turn(); row.status.removeAttribute('data-talvt-turn-state');
  assert.equal(missingState.actor.recoverRequest(checkpoint).state, 'recovering'); missingState.clock.now += 2000;
  assert.equal(missingState.actor.recoverRequest(checkpoint).state, 'uncertain'); assert.equal(missingState.state.sends, 0);
});

test('search-unit hidden transcript clones cannot become live messages or keep the visible page streaming', () => {
  const f = searchUnitFixture(), hidden = f.turn('Hidden question', 'Hidden answer', { state: 'streaming' });
  hidden.status.setAttribute('aria-hidden', 'true');
  assert.equal(f.actor.messageNodes().length, 0); assert.equal(f.actor.isStreaming(), false);
  assert.equal(f.actor.hasCompletionControl(hidden.assistant), false);
});

test('search-unit content is a presentation boundary even without a form or old role attributes', () => {
  const f = searchUnitFixture(), editor = f.dom('div', { contenteditable: 'true' });
  const unit = f.dom('div', { 'data-chatgpt-search-unit-key': 'fallback-turn-0:0:user', 'data-chatgpt-search-message-ids': modernUserID }, ['Visible user text']);
  const boundary = f.dom('div', {}, [unit, editor]); f.conversation.append(boundary);
  for (const node of [editor, boundary, f.conversation]) node.style = { getPropertyValue: () => '', getPropertyPriority: () => '', setProperty: () => {}, removeProperty: () => {} };
  f.actor.editor = () => editor; f.actor.compactRequested = true; f.actor.applyPresentation();
  assert.equal(f.actor.compactNode, editor); assert.equal(boundary.hasAttribute('inert'), false);
});
