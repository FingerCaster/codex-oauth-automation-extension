const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const proxyUtils = require('../proxy-utils.js');

test('manifest declares proxy permissions for browser-level proxy auth', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

  assert.ok(manifest.permissions.includes('proxy'));
  assert.ok(manifest.permissions.includes('webRequest'));
  assert.ok(manifest.permissions.includes('webRequestAuthProvider'));
});

test('background imports proxy utils and browser proxy module', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  assert.match(source, /proxy-utils\.js/);
  assert.match(source, /background\/browser-proxy\.js/);
});

test('browser proxy module exposes a factory', () => {
  const source = fs.readFileSync('background/browser-proxy.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundBrowserProxy;`)(globalScope);

  assert.equal(typeof api?.createBrowserProxyController, 'function');
});

test('browser proxy controller applies fixed proxy settings and serves matching auth credentials', async () => {
  const source = fs.readFileSync('background/browser-proxy.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundBrowserProxy;`)(globalScope);

  const setCalls = [];
  const clearCalls = [];
  let authListener = null;
  let authExtraInfo = null;
  let completedListener = null;
  let errorListener = null;
  let storageListener = null;

  const controller = api.createBrowserProxyController({
    buildAutomationProxyBypassList: proxyUtils.buildAutomationProxyBypassList,
    chrome: {
      proxy: {
        settings: {
          set: async (payload) => {
            setCalls.push(payload);
          },
          clear: async (payload) => {
            clearCalls.push(payload);
          },
        },
        onProxyError: {
          addListener() {},
        },
      },
      storage: {
        onChanged: {
          addListener(listener) {
            storageListener = listener;
          },
        },
      },
      webRequest: {
        onAuthRequired: {
          addListener(listener, _filter, extraInfoSpec) {
            authListener = listener;
            authExtraInfo = extraInfoSpec;
          },
        },
        onCompleted: {
          addListener(listener) {
            completedListener = listener;
          },
        },
        onErrorOccurred: {
          addListener(listener) {
            errorListener = listener;
          },
        },
      },
    },
    getState: async () => ({ browserProxyUrl: 'https://user:pass@proxy.example.com:8443' }),
    LOG_PREFIX: '[test]',
    normalizeAutomationProxyUrl: proxyUtils.normalizeAutomationProxyUrl,
    normalizeHostForComparison: proxyUtils.normalizeHostForComparison,
    parseAutomationProxyUrl: proxyUtils.parseAutomationProxyUrl,
  });

  await controller.syncConfiguredProxy();

  assert.equal(setCalls.length, 1);
  assert.deepStrictEqual(setCalls[0], {
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'https',
          host: 'proxy.example.com',
          port: 8443,
        },
        bypassList: proxyUtils.buildAutomationProxyBypassList(),
      },
    },
    scope: 'regular',
  });
  assert.deepStrictEqual(authExtraInfo, ['asyncBlocking']);
  assert.equal(typeof authListener, 'function');
  assert.equal(typeof completedListener, 'function');
  assert.equal(typeof errorListener, 'function');
  assert.equal(typeof storageListener, 'function');

  const authResults = [];
  authListener(
    {
      isProxy: true,
      challenger: { host: 'proxy.example.com', port: 8443 },
      requestId: 'req-1',
    },
    (result) => authResults.push(result)
  );
  authListener(
    {
      isProxy: true,
      challenger: { host: 'proxy.example.com', port: 8443 },
      requestId: 'req-1',
    },
    (result) => authResults.push(result)
  );

  assert.deepStrictEqual(authResults[0], {
    authCredentials: {
      username: 'user',
      password: 'pass',
    },
  });
  assert.deepStrictEqual(authResults[1], {});

  completedListener({ requestId: 'req-1' });

  const nextAuthResults = [];
  authListener(
    {
      isProxy: true,
      challenger: { host: 'proxy.example.com', port: 8443 },
      requestId: 'req-2',
    },
    (result) => nextAuthResults.push(result)
  );
  errorListener({ requestId: 'req-2' });

  assert.deepStrictEqual(nextAuthResults[0], {
    authCredentials: {
      username: 'user',
      password: 'pass',
    },
  });

  await controller.syncConfiguredProxy({ browserProxyUrl: '' });
  assert.equal(clearCalls.length, 1);
});
