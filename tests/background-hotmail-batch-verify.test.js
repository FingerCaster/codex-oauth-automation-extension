const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadMessageRouterFactory() {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);
}

test('message router batch verifies pending and error unused hotmail accounts in local mode', async () => {
  const api = loadMessageRouterFactory();
  const verifiedIds = [];
  const patchedFailures = [];
  const logs = [];
  const accounts = [
    { id: 'pending-ok', email: 'pending-ok@hotmail.com', status: 'pending', used: false, refreshToken: 'rt-1' },
    { id: 'error-ok', email: 'error-ok@hotmail.com', status: 'error', used: false, refreshToken: 'rt-error' },
    { id: 'authorized', email: 'authorized@hotmail.com', status: 'authorized', used: false, refreshToken: 'rt-2' },
    { id: 'pending-fail', email: 'pending-fail@hotmail.com', status: 'pending', used: false, refreshToken: 'rt-3' },
    { id: 'used', email: 'used@hotmail.com', status: 'pending', used: true, refreshToken: 'rt-4' },
  ];

  const router = api.createMessageRouter({
    addLog: async (message, level) => {
      logs.push({ message, level });
    },
    getState: async () => ({
      hotmailServiceMode: 'local',
      hotmailAccounts: accounts,
    }),
    normalizeHotmailAccounts: (items) => items,
    patchHotmailAccount: async (accountId, updates = {}) => {
      patchedFailures.push({ accountId, updates });
      const account = accounts.find((item) => item.id === accountId) || {};
      return { ...account, ...updates };
    },
    verifyHotmailAccount: async (accountId) => {
      verifiedIds.push(accountId);
      if (accountId === 'pending-fail') {
        throw new Error('token expired');
      }
      const account = accounts.find((item) => item.id === accountId);
      return {
        account: { ...account, status: 'authorized' },
        messageCount: 3,
      };
    },
  });

  const result = await router.handleMessage({
    type: 'BATCH_VERIFY_HOTMAIL_ACCOUNTS',
    source: 'sidepanel',
    payload: {},
  }, {});

  assert.deepEqual(verifiedIds, ['pending-ok', 'error-ok', 'pending-fail']);
  assert.deepEqual(patchedFailures, [{
    accountId: 'pending-fail',
    updates: {
      status: 'error',
      lastError: 'token expired',
    },
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.processedCount, 3);
  assert.equal(result.verifiedCount, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(result.skippedCount, 2);
  assert.match(logs[0]?.message || '', /开始批量校验 3 个待处理账号/);
  assert.match(logs.at(-1)?.message || '', /批量校验完成，成功 2 个，失败 1 个，跳过 2 个/);
});

test('message router rejects hotmail batch verify outside local mode', async () => {
  const api = loadMessageRouterFactory();
  const router = api.createMessageRouter({
    getState: async () => ({
      hotmailServiceMode: 'remote',
      hotmailAccounts: [],
    }),
    normalizeHotmailAccounts: (items) => items,
  });

  await assert.rejects(
    () => router.handleMessage({
      type: 'BATCH_VERIFY_HOTMAIL_ACCOUNTS',
      source: 'sidepanel',
      payload: {},
    }, {}),
    /批量校验仅支持 Hotmail 本地助手模式/
  );
});

test('message router can stop hotmail batch verify in progress', async () => {
  const api = loadMessageRouterFactory();
  let observedSignal = null;
  const router = api.createMessageRouter({
    addLog: async () => {},
    getState: async () => ({
      hotmailServiceMode: 'local',
      hotmailAccounts: [
        { id: 'pending-1', email: 'pending-1@hotmail.com', status: 'pending', used: false, refreshToken: 'rt-1' },
      ],
    }),
    normalizeHotmailAccounts: (items) => items,
    verifyHotmailAccount: async (_accountId, options = {}) => {
      observedSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(options.signal.reason);
        }, { once: true });
      });
    },
  });

  const startPromise = router.handleMessage({
    type: 'BATCH_VERIFY_HOTMAIL_ACCOUNTS',
    source: 'sidepanel',
    payload: {},
  }, {});
  for (let attempt = 0; attempt < 10 && !observedSignal; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const stopResult = await router.handleMessage({
    type: 'STOP_HOTMAIL_BATCH_VERIFY',
    source: 'sidepanel',
    payload: {},
  }, {});
  const finalResult = await startPromise;

  assert.equal(stopResult.ok, true);
  assert.equal(stopResult.stopping, true);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(finalResult.ok, true);
  assert.equal(finalResult.stopped, true);
  assert.equal(finalResult.processedCount, 0);
  assert.equal(finalResult.verifiedCount, 0);
  assert.equal(finalResult.failedCount, 0);
  assert.equal(finalResult.skippedCount, 1);
});
