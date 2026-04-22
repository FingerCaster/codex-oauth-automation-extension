const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

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
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
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

test('signup verification preparation uses a longer wait window in slow navigation mode', async () => {
  const api = new Function(`
const waits = [];
const logs = [];
const location = { href: 'https://auth.openai.com/create-account/password' };

async function waitForSignupVerificationTransition(timeout) {
  waits.push(timeout);
  return { state: 'verification' };
}

function throwIfStopped() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}
function createSignupUserAlreadyExistsError() {
  return new Error('should not create user already exists error');
}
async function recoverCurrentAuthRetryPage() {
  throw new Error('recoverCurrentAuthRetryPage should not be called');
}
async function humanPause() {}
function fillInput() {}
function isActionEnabled() {
  return true;
}
function simulateClick() {}
async function sleep() {}

${extractFunction('prepareSignupVerificationFlow')}

return {
  run(payload) {
    return prepareSignupVerificationFlow(payload);
  },
  snapshot() {
    return { waits, logs };
  },
};
`)();

  const result = await api.run({
    password: 'Secret123!',
    prepareSource: 'step3_finalize',
    prepareLogLabel: '步骤 3 收尾',
    slowNavigationMode: true,
  });

  const snapshot = api.snapshot();
  assert.deepStrictEqual(result, {
    ready: true,
    retried: 0,
    prepareSource: 'step3_finalize',
  });
  assert.deepStrictEqual(snapshot.waits, [10000]);
  assert.equal(snapshot.logs.some(({ message }) => /先等待 10 秒/.test(message)), true);
});

test('signup password preparation throws a dedicated error after 3 password resubmits still fail', async () => {
  const api = new Function(`
const clicks = [];
const location = { href: 'https://auth.openai.com/u/signup/password' };

async function waitForSignupVerificationTransition() {
  return {
    state: 'password',
    passwordInput: { value: 'Secret123!' },
    submitButton: { id: 'submit' },
  };
}

function throwIfStopped() {}
function log() {}
function createSignupUserAlreadyExistsError() {
  return new Error('should not create user already exists error');
}
async function recoverCurrentAuthRetryPage() {
  throw new Error('recoverCurrentAuthRetryPage should not be called');
}
async function humanPause() {}
function fillInput() {}
function isActionEnabled() {
  return true;
}
function simulateClick(button) {
  clicks.push(button);
}
async function sleep() {}

${extractFunction('prepareSignupVerificationFlow')}

return {
  async run() {
    try {
      await prepareSignupVerificationFlow({
        password: 'Secret123!',
        prepareSource: 'step3_finalize',
        prepareLogLabel: '步骤 3 收尾',
      });
      return null;
    } catch (error) {
      return { error, clickCount: clicks.length };
    }
  },
};
`)();

  const result = await api.run();

  assert.ok(result);
  assert.match(result.error.message, /^STEP3_PASSWORD_RETRY_EXHAUSTED::/);
  assert.equal(result.clickCount, 3);
});

test('signup password preparation wraps retry-page recovery failure into the dedicated step3 exhausted error', async () => {
  const api = new Function(`
const location = { href: 'https://auth.openai.com/u/signup/retry' };

async function waitForSignupVerificationTransition() {
  return {
    state: 'error',
    userAlreadyExistsBlocked: false,
  };
}

function throwIfStopped() {}
function log() {}
function createSignupUserAlreadyExistsError() {
  return new Error('should not create user already exists error');
}
async function recoverCurrentAuthRetryPage() {
  throw new Error('步骤 3 收尾：检测到注册认证重试页，正在点击“重试”恢复（第 1/4 次）失败：已连续点击“重试” 5 次，页面仍未恢复。URL: https://auth.openai.com/u/signup/retry');
}
async function humanPause() {}
function fillInput() {}
function isActionEnabled() {
  return true;
}
function simulateClick() {}
async function sleep() {}

${extractFunction('prepareSignupVerificationFlow')}

return {
  async run() {
    try {
      await prepareSignupVerificationFlow({
        password: 'Secret123!',
        prepareSource: 'step3_finalize',
        prepareLogLabel: '步骤 3 收尾',
        slowNavigationMode: true,
      });
      return null;
    } catch (error) {
      return error;
    }
  },
};
`)();

  const error = await api.run();

  assert.ok(error);
  assert.match(error.message, /^STEP3_PASSWORD_RETRY_EXHAUSTED::/);
  assert.match(error.message, /已连续点击“重试” 5 次/);
});

test('signup profile completion preparation keeps waiting longer in slow navigation mode until the page leaves step 5', async () => {
  const api = new Function(`
const waits = [];
const logs = [];
let pollCount = 0;
const location = { href: 'https://auth.openai.com/u/signup/profile' };

async function waitForStep5CompletionState(timeout) {
  waits.push(timeout);
  pollCount += 1;
  if (pollCount === 1) {
    return { state: 'profile', url: 'https://auth.openai.com/u/signup/profile' };
  }
  return { state: 'completed', url: 'https://chatgpt.com/' };
}

function inspectStep5CompletionState() {
  return { state: 'profile', url: 'https://auth.openai.com/u/signup/profile' };
}

function throwIfStopped() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}

${extractFunction('prepareSignupProfileCompletion')}

return {
  run(payload) {
    return prepareSignupProfileCompletion(payload);
  },
  snapshot() {
    return { waits, logs };
  },
};
`)();

  const result = await api.run({
    prepareSource: 'step5_finalize',
    prepareLogLabel: '步骤 5 收尾',
    slowNavigationMode: true,
  });

  const snapshot = api.snapshot();
  assert.deepStrictEqual(result, {
    ready: true,
    prepareSource: 'step5_finalize',
    waitRounds: 1,
    url: 'https://chatgpt.com/',
    slowNavigationMode: true,
  });
  assert.deepStrictEqual(snapshot.waits, [10000, 10000]);
  assert.equal(snapshot.logs.some(({ message }) => /继续等待提交结果/.test(message)), true);
});
