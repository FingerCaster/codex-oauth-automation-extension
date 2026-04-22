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

const bundle = [
  extractFunction('isAddPhoneAuthUrl'),
  extractFunction('isAddPhoneAuthState'),
  extractFunction('isMail2925ThreadTerminatedError'),
  extractFunction('isSignupUserAlreadyExistsFailure'),
  extractFunction('getPostStep6AutoRestartDecision'),
  extractFunction('runAutoSequenceFromStep'),
].join('\n');

test('auto-run clears cookies and switches to the next Hotmail account after step 3 password retries are exhausted', async () => {
  const api = new Function(`
const AUTO_STEP_DELAYS = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
const LAST_STEP_ID = 10;
const FINAL_OAUTH_CHAIN_START_STEP = 7;
const chrome = {
  tabs: {
    update: async () => {},
  },
  runtime: {
    sendMessage: async () => {},
  },
};

let step3FailuresRemaining = 1;
let nextHotmailIndex = 0;
const hotmailPool = [
  { id: 'hotmail-1', email: 'first@example.com' },
  { id: 'hotmail-2', email: 'second@example.com' },
];
let currentState = {
  email: null,
  password: 'Secret123!',
  mailProvider: 'hotmail',
  currentHotmailAccountId: null,
  stepStatuses: {
    1: 'pending',
    2: 'pending',
    3: 'pending',
    4: 'pending',
    5: 'pending',
    6: 'pending',
    7: 'pending',
    8: 'pending',
    9: 'pending',
    10: 'pending',
  },
};
const events = {
  steps: [],
  emails: [],
  invalidations: [],
  logs: [],
  cookieCleanupLabels: [],
  broadcasts: [],
  stateUpdates: [],
  silentEmails: [],
};

async function addLog(message, level = 'info') {
  events.logs.push({ message, level });
}

async function ensureAutoEmailReady() {
  const account = hotmailPool[nextHotmailIndex];
  if (!account) {
    throw new Error('no more hotmail accounts');
  }
  nextHotmailIndex += 1;
  currentState = {
    ...currentState,
    email: account.email,
    currentHotmailAccountId: account.id,
  };
  events.emails.push(account.email);
  return account.email;
}

async function broadcastAutoRunStatus() {}

async function getState() {
  return currentState;
}

async function setState(updates) {
  currentState = {
    ...currentState,
    ...updates,
    stepStatuses: updates.stepStatuses ? { ...updates.stepStatuses } : currentState.stepStatuses,
  };
  events.stateUpdates.push(updates);
}

function broadcastDataUpdate(payload) {
  events.broadcasts.push(payload);
  currentState = { ...currentState, ...payload };
}

async function setEmailStateSilently(email) {
  currentState = { ...currentState, email };
  events.silentEmails.push(email);
}

function isStopError() {
  return false;
}

function isStepDoneStatus(status) {
  return status === 'completed' || status === 'manual_completed' || status === 'skipped';
}

async function executeStepAndWait(step) {
  events.steps.push(step);
  if (step === 3 && step3FailuresRemaining > 0) {
    step3FailuresRemaining -= 1;
    throw new Error('STEP3_PASSWORD_RETRY_EXHAUSTED::步骤 3 填写密码后已重试 3 次，仍未进入验证码页（最后停留：密码页）。URL: https://auth.openai.com/u/signup/password');
  }
}

async function getTabId() {
  return 1;
}

async function invalidateDownstreamAfterStepRestart(step, options = {}) {
  events.invalidations.push({ step, options });
  currentState = {
    ...currentState,
    password: null,
    lastEmailTimestamp: null,
    signupVerificationRequestedAt: null,
    loginVerificationRequestedAt: null,
    lastSignupCode: null,
    lastLoginCode: null,
    stepStatuses: {
      1: 'pending',
      2: 'pending',
      3: 'pending',
      4: 'pending',
      5: 'pending',
      6: 'pending',
      7: 'pending',
      8: 'pending',
      9: 'pending',
      10: 'pending',
    },
  };
}

function getLoginAuthStateLabel(state) {
  return state || 'unknown';
}

function getErrorMessage(error) {
  return error?.message || String(error || '');
}

async function getLoginAuthStateFromContent() {
  return { state: 'password_page', url: 'https://auth.openai.com/log-in' };
}

async function clearPreLoginCookiesDirectly(logLabel) {
  events.cookieCleanupLabels.push(logLabel);
  return 4;
}

${bundle}

return {
  async run() {
    await runAutoSequenceFromStep(1, {
      targetRun: 1,
      totalRuns: 1,
      attemptRuns: 1,
      continued: false,
    });
    return { events, currentState };
  },
};
`)();

  const { events, currentState } = await api.run();

  assert.deepStrictEqual(events.steps, [1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepStrictEqual(events.emails, ['first@example.com', 'second@example.com']);
  assert.deepStrictEqual(events.cookieCleanupLabels, ['步骤 3']);
  assert.equal(events.invalidations.length, 1);
  assert.equal(events.invalidations[0].step, 1);
  assert.match(events.invalidations[0].options.logLabel, /步骤 3 密码重试耗尽后准备切换下一个 Hotmail 邮箱/);
  assert.deepStrictEqual(events.silentEmails, [null]);
  assert.equal(currentState.email, 'second@example.com');
  assert.equal(currentState.currentHotmailAccountId, 'hotmail-2');
  assert.equal(events.logs.some(({ message }) => /切换下一个 Hotmail 邮箱重新开始/.test(message)), true);
});
