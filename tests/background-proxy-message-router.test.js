const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('message router invalidates proxy-affected tabs after browser proxy changes', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  const proxySyncStates = [];
  const invalidations = [];
  let persistedUpdates = null;
  let sessionState = {
    browserProxyUrl: 'http://old-user:old-pass@proxy-old.example.com:8000',
    tabRegistry: {
      'signup-page': { tabId: 5, ready: true },
    },
  };

  const router = api.createMessageRouter({
    buildLuckmailSessionSettingsPayload: () => ({}),
    buildPersistentSettingsPayload: () => ({
      browserProxyUrl: 'http://user:pass@proxy-new.example.com:8080',
    }),
    getState: async () => sessionState,
    invalidateBrowserProxyAffectedTabs: async () => {
      invalidations.push(true);
    },
    setPersistentSettings: async (updates) => {
      persistedUpdates = updates;
    },
    setState: async (updates) => {
      sessionState = { ...sessionState, ...updates };
    },
    syncConfiguredBrowserProxy: async (state) => {
      proxySyncStates.push(state);
    },
  });

  const response = await router.handleMessage({
    type: 'SAVE_SETTING',
    payload: { browserProxyUrl: 'http://user:pass@proxy-new.example.com:8080' },
  }, {});

  assert.equal(response.ok, true);
  assert.deepStrictEqual(persistedUpdates, {
    browserProxyUrl: 'http://user:pass@proxy-new.example.com:8080',
  });
  assert.equal(proxySyncStates.length, 1);
  assert.equal(proxySyncStates[0].browserProxyUrl, 'http://user:pass@proxy-new.example.com:8080');
  assert.deepStrictEqual(invalidations, [true]);
});

test('message router can force browser proxy re-sync before launching actions', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  const proxySyncStates = [];
  const executedSteps = [];
  const state = {
    browserProxyUrl: 'http://user:pass@proxy.example.com:8080',
    stepStatuses: {},
  };

  const router = api.createMessageRouter({
    clearStopRequest: () => {},
    doesStepUseCompletionSignal: () => false,
    executeStep: async (step) => {
      executedSteps.push(step);
    },
    getState: async () => state,
    syncConfiguredBrowserProxy: async (nextState) => {
      proxySyncStates.push(nextState);
      return { enabled: true };
    },
  });

  const ensureResponse = await router.handleMessage({
    type: 'ENSURE_BROWSER_PROXY',
    payload: {},
  }, {});
  const executeResponse = await router.handleMessage({
    type: 'EXECUTE_STEP',
    source: 'background',
    payload: { step: 1 },
  }, {});

  assert.equal(ensureResponse.ok, true);
  assert.equal(executeResponse.ok, true);
  assert.equal(proxySyncStates.length, 2);
  assert.equal(proxySyncStates[0].browserProxyUrl, 'http://user:pass@proxy.example.com:8080');
  assert.equal(proxySyncStates[1].browserProxyUrl, 'http://user:pass@proxy.example.com:8080');
  assert.deepStrictEqual(executedSteps, [1]);
});

test('message router can manually clear active browser proxy without deleting saved config', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  const releases = [];
  const logs = [];

  const router = api.createMessageRouter({
    addLog: async (message, level) => {
      logs.push({ message, level });
    },
    releaseBrowserProxyIfUnused: async (options) => {
      releases.push(options);
      return { cleared: true };
    },
  });

  const response = await router.handleMessage({
    type: 'CLEAR_BROWSER_PROXY_RUNTIME',
    payload: {},
  }, {});

  assert.equal(response.ok, true);
  assert.equal(response.cleared, true);
  assert.deepStrictEqual(releases, [{ force: true }]);
  assert.deepStrictEqual(logs, [{
    message: '已手动清理当前浏览器代理，当前恢复直连；下次执行前会按配置自动重新应用。',
    level: 'info',
  }]);
});

test('message router releases browser proxy on reset and successful step 10 completion', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  const releases = [];
  const state = {
    stepStatuses: {},
  };

  const router = api.createMessageRouter({
    addLog: async () => {},
    appendAccountRunRecord: async () => ({}),
    buildLocalhostCleanupPrefix: () => '',
    clearAutoRunTimerAlarm: async () => {},
    clearStopRequest: () => {},
    closeLocalhostCallbackTabs: async () => {},
    closeTabsByUrlPrefix: async () => {},
    finalizeIcloudAliasAfterSuccessfulFlow: async () => {},
    getCurrentLuckmailPurchase: () => null,
    getState: async () => state,
    getStopRequested: () => false,
    isHotmailProvider: () => false,
    isLocalhostOAuthCallbackUrl: () => true,
    isLuckmailProvider: () => false,
    notifyStepComplete: () => {},
    patchHotmailAccount: async () => {},
    releaseBrowserProxyIfUnused: async (options) => {
      releases.push(options);
      return { cleared: true };
    },
    resetState: async () => {},
    setStepStatus: async () => {},
  });

  const stepResponse = await router.handleMessage({
    type: 'STEP_COMPLETE',
    step: 10,
    payload: {
      localhostUrl: 'http://localhost:1455/auth/callback?code=abc&state=xyz',
    },
  }, {});
  const resetResponse = await router.handleMessage({
    type: 'RESET',
    payload: {},
  }, {});

  assert.equal(stepResponse.ok, true);
  assert.equal(resetResponse.ok, true);
  assert.deepStrictEqual(releases, [{ force: true }, { force: true }]);
});

test('message router exposes browser proxy test results without turning them into transport errors', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  const router = api.createMessageRouter({
    testConfiguredBrowserProxy: async () => ({
      ok: false,
      errorMessage: 'HTTP 502',
      proxy: {
        scheme: 'http',
        host: 'proxy.example.com',
        port: 8080,
        hasAuth: true,
      },
    }),
  });

  const response = await router.handleMessage({
    type: 'TEST_BROWSER_PROXY',
    payload: {},
  }, {});

  assert.equal(response.ok, false);
  assert.equal(response.errorMessage, 'HTTP 502');
  assert.deepStrictEqual(response.proxy, {
    scheme: 'http',
    host: 'proxy.example.com',
    port: 8080,
    hasAuth: true,
  });
});
