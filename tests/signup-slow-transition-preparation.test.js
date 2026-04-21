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
