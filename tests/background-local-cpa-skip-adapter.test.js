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

test('executeStepViaCompletionSignal returns early for configured local CPA completion-signal skip', async () => {
  const bundle = [
    'const STEP_IDS = [1,2,3,4,5,6,7,8,9,10];',
    'const LAST_STEP_ID = 10;',
    'const DEFAULT_LOCAL_CPA_STEP9_MODE = "submit";',
    'const AUTO_RUN_SIGNAL_COMPLETION_TIMEOUT_MS = 120000;',
    'const LOG_PREFIX = "[test]";',
    extractFunction('parseUrlSafely'),
    extractFunction('isLocalhostOAuthCallbackUrl'),
    extractFunction('isLocalCpaUrl'),
    extractFunction('getPanelMode'),
    extractFunction('normalizeLocalCpaStep9Mode'),
    extractFunction('normalizeLocalCpaSkippedSteps'),
    extractFunction('resolveLocalCpaSkippedSteps'),
    extractFunction('shouldApplyLocalCpaConfiguredStepSkip'),
    extractFunction('assertLocalCpaConfiguredStep10SkipReady'),
    extractFunction('executeConfiguredLocalCpaSkippedStep'),
    extractFunction('executeStepViaCompletionSignal'),
  ].join('\n');

  const api = new Function(`
const events = {
  completed: [],
  statuses: [],
  executeCalls: 0,
};
async function getState() {
  return {
    panelMode: 'cpa',
    vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
    localCpaSkippedSteps: [3],
  };
}
function waitForStepComplete() {
  throw new Error('waitForStepComplete should not be called for configured local CPA skip');
}
async function executeStep() {
  events.executeCalls += 1;
}
function isStopError() { return false; }
function isRetryableContentScriptTransportError() { return false; }
function notifyStepError(error) {
  throw new Error('notifyStepError should not be called: ' + error);
}
function getErrorMessage(error) { return error?.message || String(error); }
function doesStepUseCompletionSignal(step) { return new Set([3, 5, 10]).has(step); }
async function addLog() {}
async function completeStepFromBackground(step, payload = {}) {
  events.completed.push({ step, payload });
}
async function setStepStatus(step, status) {
  events.statuses.push({ step, status });
}
${bundle}
return {
  executeStepViaCompletionSignal,
  snapshot() { return events; },
};
  `)();

  const result = await api.executeStepViaCompletionSignal(3, 5000);
  assert.deepStrictEqual(result, { configuredLocalCpaSkip: true });
  assert.deepStrictEqual(api.snapshot().completed, [{
    step: 3,
    payload: { configuredLocalCpaSkip: true },
  }]);
  assert.deepStrictEqual(api.snapshot().statuses, []);
  assert.equal(api.snapshot().executeCalls, 0);
});

test('configured local CPA skip for step 10 uses completion path instead of raw skipped status', async () => {
  const bundle = [
    'const STEP_IDS = [1,2,3,4,5,6,7,8,9,10];',
    'const LAST_STEP_ID = 10;',
    'const DEFAULT_LOCAL_CPA_STEP9_MODE = "submit";',
    extractFunction('parseUrlSafely'),
    extractFunction('isLocalhostOAuthCallbackUrl'),
    extractFunction('isLocalCpaUrl'),
    extractFunction('getPanelMode'),
    extractFunction('normalizeLocalCpaStep9Mode'),
    extractFunction('normalizeLocalCpaSkippedSteps'),
    extractFunction('resolveLocalCpaSkippedSteps'),
    extractFunction('shouldApplyLocalCpaConfiguredStepSkip'),
    extractFunction('assertLocalCpaConfiguredStep10SkipReady'),
    extractFunction('executeConfiguredLocalCpaSkippedStep'),
  ].join('\n');

  const api = new Function(`
const events = {
  completed: [],
  statuses: [],
};
function doesStepUseCompletionSignal(step) { return new Set([3, 5, 10]).has(step); }
async function addLog() {}
async function completeStepFromBackground(step, payload = {}) {
  events.completed.push({ step, payload });
}
async function setStepStatus(step, status) {
  events.statuses.push({ step, status });
}
${bundle}
return {
  executeConfiguredLocalCpaSkippedStep,
  snapshot() { return events; },
};
  `)();

  const applied = await api.executeConfiguredLocalCpaSkippedStep(10, {
    panelMode: 'cpa',
    vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
    localhostUrl: 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz',
    localCpaSkippedSteps: [10],
  });

  assert.equal(applied, true);
  assert.deepStrictEqual(api.snapshot().completed, [{
    step: 10,
    payload: {
      localhostUrl: 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz',
      verifiedStatus: 'local-auto',
      configuredLocalCpaSkip: true,
    },
  }]);
  assert.deepStrictEqual(api.snapshot().statuses, []);
});

test('shouldApplyLocalCpaConfiguredStepSkip still applies in CPA mode before local URL is filled', async () => {
  const bundle = [
    'const STEP_IDS = [1,2,3,4,5,6,7,8,9,10];',
    'const LAST_STEP_ID = 10;',
    'const DEFAULT_LOCAL_CPA_STEP9_MODE = "submit";',
    extractFunction('parseUrlSafely'),
    extractFunction('isLocalCpaUrl'),
    extractFunction('getPanelMode'),
    extractFunction('normalizeLocalCpaStep9Mode'),
    extractFunction('normalizeLocalCpaSkippedSteps'),
    extractFunction('resolveLocalCpaSkippedSteps'),
    extractFunction('shouldApplyLocalCpaConfiguredStepSkip'),
  ].join('\n');

  const api = new Function(`
${bundle}
return { shouldApplyLocalCpaConfiguredStepSkip };
  `)();

  assert.equal(api.shouldApplyLocalCpaConfiguredStepSkip({
    panelMode: 'cpa',
    vpsUrl: '',
    localCpaSkippedSteps: [7, 8, 9, 10],
  }, 7), true);

  assert.equal(api.shouldApplyLocalCpaConfiguredStepSkip({
    panelMode: 'cpa',
    vpsUrl: 'https://example.com/management.html#/oauth',
    localCpaSkippedSteps: [7, 8, 9, 10],
  }, 7), false);
});

test('configured local CPA skip for step 10 can complete without callback data', async () => {
  const bundle = [
    'const STEP_IDS = [1,2,3,4,5,6,7,8,9,10];',
    'const LAST_STEP_ID = 10;',
    'const DEFAULT_LOCAL_CPA_STEP9_MODE = "submit";',
    extractFunction('parseUrlSafely'),
    extractFunction('isLocalhostOAuthCallbackUrl'),
    extractFunction('isLocalCpaUrl'),
    extractFunction('getPanelMode'),
    extractFunction('normalizeLocalCpaStep9Mode'),
    extractFunction('normalizeLocalCpaSkippedSteps'),
    extractFunction('resolveLocalCpaSkippedSteps'),
    extractFunction('shouldApplyLocalCpaConfiguredStepSkip'),
    extractFunction('assertLocalCpaConfiguredStep10SkipReady'),
    extractFunction('executeConfiguredLocalCpaSkippedStep'),
  ].join('\n');

  const api = new Function(`
const events = {
  completed: [],
  statuses: [],
};
function doesStepUseCompletionSignal(step) { return new Set([3, 5, 10]).has(step); }
async function addLog() {}
async function completeStepFromBackground(step, payload = {}) {
  events.completed.push({ step, payload });
}
async function setStepStatus(step, status) {
  events.statuses.push({ step, status });
}
${bundle}
return {
  executeConfiguredLocalCpaSkippedStep,
  snapshot() { return events; },
};
  `)();

  const applied = await api.executeConfiguredLocalCpaSkippedStep(10, {
    panelMode: 'cpa',
    vpsUrl: '',
    localhostUrl: '',
    localCpaSkippedSteps: [10],
  });

  assert.equal(applied, true);
  assert.deepStrictEqual(api.snapshot().completed, [{
    step: 10,
    payload: {
      configuredLocalCpaSkip: true,
    },
  }]);
  assert.deepStrictEqual(api.snapshot().statuses, []);
});
