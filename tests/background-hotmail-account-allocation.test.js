const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('ensureHotmailAccountForFlow can allocate pending accounts that already have refresh tokens', async () => {
  const ensureHotmailAccountForFlow = new Function(`
${extractFunction('ensureHotmailAccountForFlow')}
return ensureHotmailAccountForFlow;
`)();

  const accounts = [
    {
      id: 'pending-hotmail',
      email: 'pending@hotmail.com',
      status: 'pending',
      refreshToken: 'rt-pending',
      used: false,
    },
  ];

  let selectedArgs = null;
  globalThis.getState = async () => ({
    hotmailAccounts: accounts,
    currentHotmailAccountId: null,
  });
  globalThis.normalizeHotmailAccounts = (items) => items;
  globalThis.findHotmailAccount = (items, id) => items.find((item) => item.id === id) || null;
  globalThis.pickHotmailAccountForRun = (items) => items[0] || null;
  globalThis.setCurrentHotmailAccount = async (id, options) => {
    selectedArgs = { id, options };
    return accounts.find((item) => item.id === id) || null;
  };

  const selected = await ensureHotmailAccountForFlow({});

  assert.equal(selected?.email, 'pending@hotmail.com');
  assert.deepEqual(selectedArgs, {
    id: 'pending-hotmail',
    options: { markUsed: false, syncEmail: true },
  });
});

test('ensureHotmailAccountForFlow can keep using the current used hotmail account when explicitly allowed', async () => {
  const ensureHotmailAccountForFlow = new Function(`
${extractFunction('ensureHotmailAccountForFlow')}
return ensureHotmailAccountForFlow;
`)();

  const accounts = [
    {
      id: 'current-hotmail',
      email: 'current@hotmail.com',
      status: 'authorized',
      refreshToken: 'rt-current',
      used: true,
    },
    {
      id: 'fresh-hotmail',
      email: 'fresh@hotmail.com',
      status: 'authorized',
      refreshToken: 'rt-fresh',
      used: false,
    },
  ];

  let selectedArgs = null;
  globalThis.getState = async () => ({
    hotmailAccounts: accounts,
    currentHotmailAccountId: 'current-hotmail',
  });
  globalThis.normalizeHotmailAccounts = (items) => items;
  globalThis.findHotmailAccount = (items, id) => items.find((item) => item.id === id) || null;
  globalThis.pickHotmailAccountForRun = () => {
    throw new Error('should not allocate another account');
  };
  globalThis.setCurrentHotmailAccount = async (id, options) => {
    selectedArgs = { id, options };
    return accounts.find((item) => item.id === id) || null;
  };

  const selected = await ensureHotmailAccountForFlow({
    allowUsedSelectedAccount: true,
    preferredAccountId: 'current-hotmail',
  });

  assert.equal(selected?.email, 'current@hotmail.com');
  assert.deepEqual(selectedArgs, {
    id: 'current-hotmail',
    options: { markUsed: false, syncEmail: true },
  });
});

test('patchHotmailAccount can preserve current hotmail selection while marking account used', async () => {
  const patchHotmailAccount = new Function(`
${extractFunction('patchHotmailAccount')}
return patchHotmailAccount;
`)();

  const accounts = [
    {
      id: 'current-hotmail',
      email: 'alpha@hotmail.com',
      status: 'authorized',
      used: false,
      refreshToken: 'rt-1',
      lastUsedAt: 0,
    },
  ];

  const syncedAccounts = [];
  const setStateCalls = [];
  const broadcastPayloads = [];
  const emailStates = [];

  globalThis.getState = async () => ({
    hotmailAccounts: accounts,
    currentHotmailAccountId: 'current-hotmail',
    mailProvider: 'hotmail-api',
  });
  globalThis.normalizeHotmailAccounts = (items) => items;
  globalThis.findHotmailAccount = (items, id) => items.find((item) => item.id === id) || null;
  globalThis.normalizeHotmailAccount = (account) => account;
  globalThis.syncHotmailAccounts = async (items) => {
    syncedAccounts.push(items);
  };
  globalThis.shouldClearHotmailCurrentSelection = () => true;
  globalThis.setState = async (updates) => {
    setStateCalls.push(updates);
  };
  globalThis.broadcastDataUpdate = (payload) => {
    broadcastPayloads.push(payload);
  };
  globalThis.isHotmailProvider = () => true;
  globalThis.setEmailState = async (email) => {
    emailStates.push(email);
  };

  const result = await patchHotmailAccount(
    'current-hotmail',
    {
      used: true,
      lastUsedAt: 123456,
    },
    {
      preserveCurrentSelection: true,
    }
  );

  assert.equal(result.used, true);
  assert.equal(result.lastUsedAt, 123456);
  assert.equal(syncedAccounts.length, 1);
  assert.deepStrictEqual(setStateCalls, []);
  assert.deepStrictEqual(broadcastPayloads, []);
  assert.deepStrictEqual(emailStates, []);
});

test('pollHotmailVerificationCode keeps mailbox affinity with the current used hotmail account', async () => {
  const pollHotmailVerificationCode = new Function(`
${extractFunction('pollHotmailVerificationCode')}
return pollHotmailVerificationCode;
`)();

  const ensureCalls = [];
  const logMessages = [];

  globalThis.addLog = async (message) => {
    logMessages.push(message);
  };
  globalThis.ensureHotmailAccountForFlow = async (options) => {
    ensureCalls.push(options);
    return {
      id: 'current-hotmail',
      email: 'current@hotmail.com',
    };
  };
  globalThis.getHotmailServiceSettings = () => ({ mode: 'local' });
  globalThis.HOTMAIL_SERVICE_MODE_LOCAL = 'local';
  globalThis.pollHotmailVerificationCodeViaLocalHelper = async (_step, account, payload) => ({
    account,
    payload,
  });
  globalThis.throwIfStopped = () => {};
  globalThis.fetchHotmailMailboxMessages = async () => {
    throw new Error('remote path should not run in this test');
  };
  globalThis.HOTMAIL_MAILBOXES = ['INBOX', 'Junk'];
  globalThis.pickVerificationMessageWithFallback = () => null;
  globalThis.extractVerificationCodeFromMessage = () => null;
  globalThis.getHotmailVerificationRequestTimestamp = () => 0;
  globalThis.sleepWithStop = async () => {};

  const result = await pollHotmailVerificationCode(8, {
    currentHotmailAccountId: 'current-hotmail',
  }, {
    targetEmail: 'signup@hotmail.com',
  });

  assert.equal(ensureCalls.length, 1);
  assert.deepEqual(ensureCalls[0], {
    allowAllocate: true,
    allowUsedSelectedAccount: true,
    markUsed: false,
    preferredAccountId: 'current-hotmail',
  });
  assert.equal(result.account.email, 'current@hotmail.com');
  assert.equal(logMessages.some((message) => /当前使用 Hotmail 账号 current@hotmail.com 轮询收件箱/.test(message)), true);
});
