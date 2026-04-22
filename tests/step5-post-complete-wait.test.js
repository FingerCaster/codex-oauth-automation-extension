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

test('step 5 skips extra tab complete wait after it has already reached chatgpt guide page', async () => {
  const api = new Function(`
const AUTO_RUN_BACKGROUND_COMPLETED_STEPS = new Set();
const AUTO_RUN_SIGNAL_COMPLETION_TIMEOUT_MS = 30000;
const calls = {
  waitForTabComplete: 0,
  logs: [],
};
const chrome = {
  tabs: {
    async get() {
      return {
        url: 'https://chatgpt.com/?model=auto',
        status: 'loading',
      };
    },
  },
};
function throwIfStopped() {}
function normalizeAutoStepDelaySeconds() { return 0; }
async function getState() { return { autoStepDelaySeconds: null }; }
async function addLog(message, level) { calls.logs.push({ message, level }); }
async function sleepWithStop() {}
async function executeStep() {}
function doesStepUseCompletionSignal(step) { return step === 5; }
async function executeStepViaCompletionSignal() { return { ok: true }; }
async function getTabId() { return 9; }
async function waitForTabComplete() { calls.waitForTabComplete += 1; }
${extractFunction('parseUrlSafely')}
${extractFunction('isSignupEntryHost')}
${extractFunction('isSignupProfileCompletionUrl')}
${extractFunction('executeStepAndWait')}
return { calls, executeStepAndWait };
`)();

  await api.executeStepAndWait(5, 0);

  assert.equal(api.calls.waitForTabComplete, 0);
  assert.ok(
    api.calls.logs.some((entry) => entry.message.includes('跳过额外的页面 complete 等待'))
  );
});

test('step 5 still waits for tab complete when signup tab has not reached chatgpt host yet', async () => {
  const api = new Function(`
const AUTO_RUN_BACKGROUND_COMPLETED_STEPS = new Set();
const AUTO_RUN_SIGNAL_COMPLETION_TIMEOUT_MS = 30000;
const calls = {
  waitForTabComplete: 0,
};
const chrome = {
  tabs: {
    async get() {
      return {
        url: 'https://auth.openai.com/u/signup/create-account',
        status: 'loading',
      };
    },
  },
};
function throwIfStopped() {}
function normalizeAutoStepDelaySeconds() { return 0; }
async function getState() { return { autoStepDelaySeconds: null }; }
async function addLog() {}
async function sleepWithStop() {}
async function executeStep() {}
function doesStepUseCompletionSignal(step) { return step === 5; }
async function executeStepViaCompletionSignal() { return { ok: true }; }
async function getTabId() { return 9; }
async function waitForTabComplete() { calls.waitForTabComplete += 1; }
${extractFunction('parseUrlSafely')}
${extractFunction('isSignupEntryHost')}
${extractFunction('isSignupProfileCompletionUrl')}
${extractFunction('executeStepAndWait')}
return { calls, executeStepAndWait };
`)();

  await api.executeStepAndWait(5, 0);

  assert.equal(api.calls.waitForTabComplete, 1);
});
