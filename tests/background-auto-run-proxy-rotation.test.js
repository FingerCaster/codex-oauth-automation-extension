const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('auto-run controller clears browser proxy between rounds so the next round can reconnect', async () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);

  const timeline = [];
  const state = {
    autoRunFallbackThreadIntervalMinutes: 0,
    stepStatuses: {},
    mailProvider: '163',
  };
  const runtimeState = {
    autoRunActive: false,
    autoRunCurrentRun: 0,
    autoRunTotalRuns: 0,
    autoRunAttemptRun: 0,
    autoRunSessionId: 0,
  };

  const controller = api.createAutoRunController({
    addLog: async () => {},
    appendAccountRunRecord: async () => null,
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 1,
    AUTO_RUN_RETRY_DELAY_MS: 0,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before-retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between-rounds',
    broadcastAutoRunStatus: async () => {},
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 77,
    getAutoRunStatusPayload: (phase, payload) => ({
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun,
      autoRunTotalRuns: payload.totalRuns,
      autoRunAttemptRun: payload.attemptRun,
    }),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedStep: () => 1,
    getPendingAutoRunTimerPlan: () => null,
    getRunningSteps: () => [],
    getState: async () => state,
    getStopRequested: () => false,
    hasSavedProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isRestartCurrentAttemptError: () => false,
    isSignupUserAlreadyExistsFailure: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: () => 0,
    persistAutoRunTimerPlan: async () => {},
    releaseBrowserProxyIfUnused: async (options) => {
      timeline.push({ type: 'release', options });
      return { cleared: true };
    },
    resetState: async () => {
      timeline.push({ type: 'reset' });
    },
    runAutoSequenceFromStep: async (_startStep, context) => {
      timeline.push({ type: 'run', run: context.targetRun });
    },
    runtime: {
      get: () => ({ ...runtimeState }),
      set: (updates = {}) => {
        Object.assign(runtimeState, updates);
      },
    },
    setState: async (updates) => {
      Object.assign(state, updates);
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningStepsToFinish: async () => state,
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
      },
    },
  });

  await controller.autoRunLoop(2);

  assert.deepStrictEqual(
    timeline.filter((entry) => entry.type !== 'reset'),
    [
      { type: 'run', run: 1 },
      { type: 'release', options: { force: true } },
      { type: 'run', run: 2 },
      { type: 'release', options: { force: true } },
    ]
  );
});
