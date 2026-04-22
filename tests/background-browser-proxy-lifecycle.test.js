const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background wires browser proxy cleanup and recovery lifecycle hooks', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  assert.match(source, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(source, /chrome\.runtime\.onSuspend\?\.\s*addListener/);
  assert.match(source, /async function handleTrackedTabRemoved\(tabId\)/);
  assert.match(source, /await ensureConfiguredBrowserProxyActive\(/);
  assert.match(source, /await releaseBrowserProxyIfUnused\(\{ force: true \}\);/);
  assert.match(source, /browserProxyRuntime/);
});
