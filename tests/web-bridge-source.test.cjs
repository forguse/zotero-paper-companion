const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PCWebView: WebView } = require('../addon/content/webview.js');

async function sourceFixture(run, options = {}) {
  const previous = { Services: global.Services, Cc: global.Cc, Ci: global.Ci };
  const state = { exists: true, regular: true, readable: true, conversions: 0, stats: 0, actorCalls: 0, timers: [], ...options };
  const file = {
    exists() { state.stats++; return state.exists; },
    isFile: () => state.regular, isReadable: () => state.readable
  };
  const fileURI = { scheme: 'file', file, QueryInterface() { return this; } };
  const jar = nested => ({ scheme: 'jar', JARFile: nested, QueryInterface() { return this; } });
  state.resolved ||= jar(fileURI);
  global.Ci = { nsIChromeRegistry: 'chrome-registry', nsIJARURI: 'jar-uri', nsIFileURL: 'file-uri', nsITimer: { TYPE_ONE_SHOT: 0 } };
  global.Services = { io: { newURI: () => ({ scheme: 'chrome' }) } };
  global.Cc = {
    '@mozilla.org/chrome/chrome-registry;1': { getService() { return { convertChromeURL() { state.conversions++; if (state.resolveFailure) throw Error('Unknown package'); return state.resolved; } }; } },
    '@mozilla.org/timer;1': { createInstance() { const timer = { initWithCallback() {}, cancel() { this.cancelled = true; } }; state.timers.push(timer); return timer; } }
  };
  const win = {}, web = new WebView({ settings: {}, emit() {}, resourceURL: name => 'chrome://paper-companion-ui-test/content/' + name });
  web.views.set(win, { opened: true, browser: { currentURI: { scheme: 'https', host: 'chatgpt.com' } } });
  web.actor = () => ({ async sendQuery(action) { state.actorCalls++; assert.equal(action, 'status'); return { composer: true, readyState: 'interactive' }; } });
  try { await run({ state, web, win, fileURI, jar }); }
  finally { Object.assign(global, previous); }
}

test('a missing installed XPI fails before dispatching any actor query or starting its timeout', async () => {
  await sourceFixture(async ({ state, web, win }) => {
    await assert.rejects(web.query(win, 'status', {}), error => error.code === 'WEB_BRIDGE_INSTALLATION_MISSING' && error.webNotDispatched === true && /重新安装/.test(error.message) && /重启/.test(error.message) && !/登录|额度/.test(error.message));
    assert.equal(state.actorCalls, 0); assert.equal(state.timers.length, 0);
  }, { exists: false });
});

test('ready propagates a missing source immediately instead of repeating website connection waits', async () => {
  await sourceFixture(async ({ state, web, win }) => {
    let delays = 0; web.delay = async () => { delays++; throw Error('A missing installation must not retry website readiness'); };
    await assert.rejects(web.ready(win), error => error.code === 'WEB_BRIDGE_INSTALLATION_MISSING');
    assert.equal(delays, 0); assert.equal(state.actorCalls, 0); assert.equal(state.stats, 1);
  }, { exists: false });
});

test('unreadable or non-file module archives fail locally without website or module imports', async () => {
  for (const options of [{ readable: false }, { regular: false }]) {
    await sourceFixture(async ({ state, web, win }) => {
      await assert.rejects(web.query(win, 'status', {}), error => error.code === 'WEB_BRIDGE_UNAVAILABLE' && /重新安装/.test(error.message));
      assert.equal(state.actorCalls, 0); assert.equal(state.timers.length, 0);
    }, options);
  }
});

test('unresolvable chrome mappings and non-local module sources fail before actor dispatch', async () => {
  for (const options of [{ resolveFailure: true }, { resolved: { scheme: 'https' } }]) {
    await sourceFixture(async ({ state, web, win }) => {
      await assert.rejects(web.ready(win), error => error.code === 'WEB_BRIDGE_UNAVAILABLE');
      assert.equal(state.actorCalls, 0); assert.equal(state.timers.length, 0);
    }, options);
  }
});

test('nested JAR sources and unpacked module files preserve normal actor queries', async () => {
  for (const nested of [false, true]) {
    await sourceFixture(async ({ state, web, win, fileURI, jar }) => {
      state.resolved = nested ? jar(jar(fileURI)) : fileURI;
      const status = await web.query(win, 'status', {});
      assert.equal(status.composer, true); assert.equal(state.actorCalls, 1); assert.equal(state.stats, 1);
      assert(state.timers.every(timer => timer.cancelled));
    });
  }
});

test('a source disappearing after a successful query is detected rather than hidden by a cached success', async () => {
  await sourceFixture(async ({ state, web, win }) => {
    await web.query(win, 'status', {}); assert.equal(state.actorCalls, 1);
    state.exists = false;
    await assert.rejects(web.query(win, 'status', {}), error => error.code === 'WEB_BRIDGE_INSTALLATION_MISSING');
    assert.equal(state.actorCalls, 1); assert.equal(state.stats, 2); assert.equal(state.timers.length, 1);
  });
});
