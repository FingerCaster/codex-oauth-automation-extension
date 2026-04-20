const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const step4Source = fs.readFileSync('background/steps/fetch-signup-code.js', 'utf8');
const step8Source = fs.readFileSync('background/steps/fetch-login-code.js', 'utf8');

function loadFactory(source, globalName) {
  const self = {};
  return new Function('self', `${source}; return self[${JSON.stringify(globalName)}];`)(self);
}

test('step 4 keeps Hotmail filter timestamp under verification-flow control', async () => {
  const moduleApi = loadFactory(step4Source, 'MultiPageBackgroundStep4');
  let resolveOptions = null;

  const executor = moduleApi.createStep4Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypass: async () => {},
    getMailConfig: () => ({ provider: 'hotmail-api', label: 'Hotmail' }),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      resolveOptions = options;
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async () => ({}),
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    throwIfStopped: () => {},
  });

  await executor.executeStep4({
    email: 'orjivestering79@hotmail.com',
    password: 'secret',
  });

  assert.equal(resolveOptions?.filterAfterTimestamp, undefined);
});

test('step 8 keeps Hotmail filter timestamp under verification-flow control', async () => {
  const moduleApi = loadFactory(step8Source, 'MultiPageBackgroundStep8');
  let resolveOptions = null;

  const executor = moduleApi.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ displayedEmail: 'orjivestering79@hotmail.com' }),
    getOAuthFlowRemainingMs: async () => null,
    getOAuthFlowStepTimeoutMs: async () => 15000,
    getMailConfig: () => ({ provider: 'hotmail-api', label: 'Hotmail' }),
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      resolveOptions = options;
    },
    rerunStep7ForStep8Recovery: async () => {},
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 3,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'orjivestering79@hotmail.com',
    oauthUrl: 'https://example.test/oauth',
  });

  assert.equal(resolveOptions?.filterAfterTimestamp, undefined);
  assert.equal(resolveOptions?.targetEmail, 'orjivestering79@hotmail.com');
});
