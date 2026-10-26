const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Drafts = require('../addon/content/chat-drafts.js');
const core = require('../addon/content/core.js');
const ChatService = require('../addon/content/chat-service.js');
const Gateway = require('../addon/content/model-gateway.js');
function setup(provider = 'deepseek') {
  let release, waiting;
  const gate = new Promise(r => release = r), started = new Promise(r => waiting = r);
  const session = { messages: [], materials: {} }, sent = [], events = [];
  const api = { settings: { chatProvider: provider, chatDeepseekModel: 'deepseek-flash', model: 'gpt-5', chatGPTEffort: 'high', smartReading: false },
    state: 'online', epoch: 1, meta: { active: 'initial-account' }, models: [{ id: 'gpt-5', reasoningEfforts: ['default','high'] }],
    preread: { jobs: new Map() }, insights: { enabled: () => false }, async session() { return session; }, async saveSession() {},
    async readSecrets() { waiting(); await gate; return { deepseek: 'fake-test-key' }; },
    auth: { async access(account) { api.authorizedAccount = account; waiting(); await gate; return 'fake-token'; } },
    emit(type) { events.push(type); }, async infer(url, options) { sent.push(JSON.parse(options.body)); throw Error('synthetic transport stop'); } };
  const gateway = new Gateway({connection:()=>({state:api.state,active:api.meta.active,epoch:api.epoch,models:api.models}),readDeepseekKey:async()=>(await api.readSecrets()).deepseek,accessToken:(account,signal)=>api.auth.access(account,signal),request:(url,options)=>api.infer(url,options)});
  const service = new ChatService({runtime:()=>({settings:api.settings,online:api.state==='online',models:api.models}),snapshotModel:c=>gateway.snapshot(c),openModel:(c,s)=>gateway.open(c,s),session:()=>api.session(),save:()=>api.saveSession(),emit:type=>api.emit(type),cite:t=>t,verified:()=>{},organize:()=>{}});
  api.ask=(...args)=>service.ask(...args);return { api, service, session, sent, events, release, started };
}
test('paper drafts retain independent text, materials and cursor without leaking changes to another paper', () => {
  const d = new Drafts(); d.remember('A', { text: '甲论文的问题', start: 2, end: 4, context: { key: 'A' }, ids: [11] });
  d.remember('B', { text: '乙论文的问题', start: 1, end: 1 });
  const a = d.get('A'); a.ids.push(22); a.text = 'changed copy';
  assert.equal(d.get('A').text, '甲论文的问题'); assert.deepEqual(d.get('A').ids, [11]); assert.equal(d.get('A').start, 2); assert.equal(d.get('B').text, '乙论文的问题');
});
test('late failed submissions recover only their own empty paper draft and preserve newer writing', () => {
  const d = new Drafts(); d.remember('B', { text: '仍在写乙篇' });
  assert.equal(d.recover('A', { text: '甲篇失败的问题', start: 2 }), true); assert.equal(d.get('B').text, '仍在写乙篇');
  d.remember('A', { text: '甲篇较新的草稿' }); assert.equal(d.recover('A', { text: '旧失败问题' }), false); assert.equal(d.get('A').text, '甲篇较新的草稿');
});
test('a DeepSeek request keeps the model selected before an asynchronous credential read', async () => {
  const s = setup(), pending = s.api.ask('general', 'question', null); await s.started;
  s.api.settings.chatDeepseekModel = 'deepseek-v4-pro'; s.release(); await assert.rejects(pending, /synthetic transport/);
  assert.equal(s.sent[0].model, 'deepseek-flash');
});
test('an authorized request keeps model, reasoning and account from the same invocation', async () => {
  const s = setup('chatgpt'), pending = s.api.ask('general', 'question', null); await s.started;
  s.api.settings.model = 'another-model'; s.api.settings.chatGPTEffort = 'low';
  s.release(); await assert.rejects(pending, /synthetic transport/);
  assert.equal(s.sent[0].model, 'gpt-5'); assert.equal(s.sent[0].reasoning.effort, 'high'); assert.equal(s.api.authorizedAccount, 'initial-account');
});

test('an account change during authorization refuses dispatch instead of mixing account state', async()=>{
 const s=setup('chatgpt'),pending=s.api.ask('general','question',null);await s.started;
 s.api.meta.active='later-account';s.release();await assert.rejects(pending,/账号已改变/);assert.equal(s.sent.length,0);assert.equal(s.session.messages.length,0);assert.equal(s.service.busy,false);
});
