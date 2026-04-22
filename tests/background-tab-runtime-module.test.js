const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports tab runtime module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/tab-runtime\.js/);
});

test('tab runtime module exposes a factory', () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  assert.equal(typeof api?.createTabRuntime, 'function');
});

test('tab runtime waitForTabComplete waits until tab status becomes complete', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  let getCalls = 0;
  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    buildLocalhostCleanupPrefix: () => '',
    chrome: {
      tabs: {
        get: async () => {
          getCalls += 1;
          return {
            id: 9,
            url: 'https://example.com',
            status: getCalls >= 3 ? 'complete' : 'loading',
          };
        },
        query: async () => [],
      },
    },
    getSourceLabel: (source) => source || 'unknown',
    getState: async () => ({ tabRegistry: {}, sourceLastUrls: {} }),
    matchesSourceUrlFamily: () => false,
    normalizeLocalCpaStep9Mode: () => 'submit',
    parseUrlSafely: () => null,
    registerTab: async () => {},
    setState: async () => {},
    shouldBypassStep9ForLocalCpa: () => false,
    throwIfStopped: () => {},
  });

  const result = await runtime.waitForTabComplete(9, {
    timeoutMs: 2000,
    retryDelayMs: 1,
  });

  assert.equal(result?.status, 'complete');
  assert.equal(getCalls, 3);
});

test('tab runtime waitForTabComplete keeps waiting longer when browser proxy is configured', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  let fakeNow = 0;
  const originalDateNow = Date.now;
  Date.now = () => fakeNow;

  try {
    const runtime = api.createTabRuntime({
      LOG_PREFIX: '[test]',
      addLog: async () => {},
      chrome: {
        tabs: {
          get: async () => ({
            id: 9,
            url: 'https://example.com',
            status: fakeNow >= 20000 ? 'complete' : 'loading',
          }),
          query: async () => [],
        },
      },
      getSourceLabel: (sourceName) => sourceName || 'unknown',
      getState: async () => ({
        browserProxyUrl: 'http://user:pass@proxy.example.com:8080',
        tabRegistry: {},
        sourceLastUrls: {},
      }),
      matchesSourceUrlFamily: () => false,
      setState: async () => {},
      sleepWithStop: async (ms) => {
        fakeNow += ms;
      },
      throwIfStopped: () => {},
    });

    const result = await runtime.waitForTabComplete(9, {
      timeoutMs: 15000,
      retryDelayMs: 1000,
    });

    assert.equal(result?.status, 'complete');
    assert.ok(fakeNow >= 20000);
  } finally {
    Date.now = originalDateNow;
  }
});

test('tab runtime waitForTabComplete aborts promptly when stop is requested', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  let throwCalls = 0;
  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({
          id: 9,
          url: 'https://example.com',
          status: 'loading',
        }),
        query: async () => [],
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => ({ tabRegistry: {}, sourceLastUrls: {} }),
    matchesSourceUrlFamily: () => false,
    setState: async () => {},
    throwIfStopped: () => {
      throwCalls += 1;
      if (throwCalls >= 2) {
        throw new Error('Flow stopped.');
      }
    },
  });

  await assert.rejects(
    runtime.waitForTabComplete(9, {
      timeoutMs: 2000,
      retryDelayMs: 1,
    }),
    /Flow stopped\./
  );
});

test('tab runtime keeps retrying content script readiness longer when browser proxy is configured', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  let fakeNow = 0;
  let injectCalls = 0;
  const originalDateNow = Date.now;
  Date.now = () => fakeNow;

  const state = {
    browserProxyUrl: 'http://user:pass@proxy.example.com:8080',
    tabRegistry: {},
    sourceLastUrls: {},
  };

  try {
    const runtime = api.createTabRuntime({
      LOG_PREFIX: '[test]',
      addLog: async () => {},
      chrome: {
        tabs: {
          get: async () => ({
            id: 9,
            url: 'https://example.com/signup',
            status: 'loading',
          }),
          query: async () => [],
          sendMessage: async () => (fakeNow >= 35000 ? { ok: true, source: 'signup-page' } : null),
        },
        scripting: {
          executeScript: async () => {
            injectCalls += 1;
          },
        },
      },
      getSourceLabel: (sourceName) => sourceName || 'unknown',
      getState: async () => state,
      matchesSourceUrlFamily: () => false,
      setState: async (updates) => {
        Object.assign(state, updates);
      },
      sleepWithStop: async (ms) => {
        fakeNow += ms;
      },
      throwIfStopped: () => {},
    });

    await runtime.ensureContentScriptReadyOnTab('signup-page', 9, {
      inject: ['content/signup-page.js'],
      timeoutMs: 30000,
      retryDelayMs: 5000,
    });

    assert.ok(fakeNow >= 35000);
    assert.ok(injectCalls >= 1);
    assert.deepStrictEqual(state.tabRegistry['signup-page'], { tabId: 9, ready: true });
  } finally {
    Date.now = originalDateNow;
  }
});

test('tab runtime extends content script response timeout when browser proxy is configured', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({ id: 9, url: 'https://example.com', status: 'complete' }),
        query: async () => [],
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => ({
      browserProxyUrl: 'http://user:pass@proxy.example.com:8080',
      tabRegistry: {},
      sourceLastUrls: {},
    }),
    matchesSourceUrlFamily: () => false,
    setState: async () => {},
    throwIfStopped: () => {},
  });

  const responseTimeoutMs = await runtime.getEffectiveContentScriptResponseTimeoutMs({
    type: 'PREPARE_SIGNUP_VERIFICATION',
    step: 4,
    source: 'background',
    payload: {},
  });

  assert.equal(responseTimeoutMs, 90000);
});

test('tab runtime can invalidate tracked sources after proxy changes', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const state = {
    tabRegistry: {
      'signup-page': { tabId: 7, ready: true },
      'vps-panel': { tabId: 8, ready: true },
      'mail-163': { tabId: 9, ready: true },
    },
    sourceLastUrls: {},
  };

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({ id: 1, status: 'complete' }),
        query: async () => [],
        sendMessage: async () => null,
      },
      scripting: {
        executeScript: async () => {},
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => state,
    matchesSourceUrlFamily: () => false,
    setState: async (updates) => {
      Object.assign(state, updates);
    },
    throwIfStopped: () => {},
  });

  const result = await runtime.invalidateTrackedSources(['signup-page', 'mail-163']);

  assert.deepStrictEqual(result, {
    sources: ['signup-page', 'mail-163'],
    updated: true,
  });
  assert.equal(state.tabRegistry['signup-page'], null);
  assert.deepStrictEqual(state.tabRegistry['vps-panel'], { tabId: 8, ready: true });
  assert.equal(state.tabRegistry['mail-163'], null);
});

test('tab runtime can remove tracked entries when a tab is closed', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const state = {
    tabRegistry: {
      'signup-page': { tabId: 7, ready: true },
      'mail-163': { tabId: 9, ready: true },
      'vps-panel': { tabId: 11, ready: true },
    },
    sourceLastUrls: {},
  };

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({ id: 1, status: 'complete' }),
        query: async () => [],
        sendMessage: async () => null,
      },
      scripting: {
        executeScript: async () => {},
      },
    },
    getSourceLabel: (sourceName) => sourceName || 'unknown',
    getState: async () => state,
    matchesSourceUrlFamily: () => false,
    setState: async (updates) => {
      Object.assign(state, updates);
    },
    throwIfStopped: () => {},
  });

  const result = await runtime.removeTrackedTabById(9);

  assert.deepStrictEqual(result, {
    sources: ['mail-163'],
    updated: true,
  });
  assert.deepStrictEqual(state.tabRegistry['signup-page'], { tabId: 7, ready: true });
  assert.equal(state.tabRegistry['mail-163'], null);
  assert.deepStrictEqual(state.tabRegistry['vps-panel'], { tabId: 11, ready: true });
});

test('tab runtime surfaces proxy-specific guidance when a tab turns into an error page', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const runtime = api.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({
          id: 9,
          url: 'chrome-error://chromewebdata/',
          status: 'complete',
        }),
        query: async () => [],
        sendMessage: async () => null,
      },
      scripting: {
        executeScript: async () => {
          throw new Error('Frame with ID 0 is showing error page');
        },
      },
    },
    getLastBrowserProxyError: () => ({ error: 'net::ERR_PROXY_CONNECTION_FAILED' }),
    getSourceLabel: (sourceName) => sourceName === 'signup-page' ? 'ChatGPT 官网' : (sourceName || 'unknown'),
    getState: async () => ({
      browserProxyUrl: 'https://user:pass@proxy.example.com:8443',
      tabRegistry: {},
      sourceLastUrls: {},
    }),
    matchesSourceUrlFamily: () => false,
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await assert.rejects(
    runtime.ensureContentScriptReadyOnTab('signup-page', 9, {
      inject: ['content/signup-page.js'],
      timeoutMs: 1000,
      retryDelayMs: 1,
    }),
    (error) => {
      assert.match(error.message, /当前代理：https:\/\/\*\*\*:\*\*\*@proxy\.example\.com:8443/);
      assert.match(error.message, /多数用户名密码代理应填写 http:\/\/username:password@hostname:port/);
      assert.doesNotMatch(error.message, /https:\/\/user:pass@proxy\.example\.com:8443/);
      return true;
    }
  );
});
