const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const asyncSignature = `async function ${name}`;
  const syncSignature = `function ${name}`;
  const asyncStart = sidepanelSource.indexOf(asyncSignature);
  const start = asyncStart >= 0 ? asyncStart : sidepanelSource.indexOf(syncSignature);
  if (start === -1) {
    throw new Error(`Function ${name} not found`);
  }

  let parenDepth = 0;
  let braceIndex = -1;
  for (let index = start; index < sidepanelSource.length; index += 1) {
    const char = sidepanelSource[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === '{' && parenDepth === 0) {
      braceIndex = index;
      break;
    }
  }
  if (braceIndex === -1) {
    throw new Error(`Function ${name} body not found`);
  }
  let depth = 0;
  for (let index = braceIndex; index < sidepanelSource.length; index += 1) {
    const char = sidepanelSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return sidepanelSource.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Function ${name} is not balanced`);
}

test('sidepanel html contains browser proxy test controls', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /id="btn-test-browser-proxy"/);
  assert.match(html, /id="btn-clear-browser-proxy-runtime"/);
  assert.match(html, /id="browser-proxy-test-status"/);
  assert.match(html, />代理状态</);
});

test('flushPendingSettingsBeforeAction waits for in-flight saves and persists dirty settings', async () => {
  const api = new Function(`
    let settingsAutoSaveTimer = 123;
    let settingsSaveInFlight = false;
    let settingsDirty = true;
    const INVALID_BROWSER_PROXY_URL_MESSAGE = 'invalid proxy';
    const calls = {
      wait: 0,
      normalize: 0,
      save: 0,
      cleared: [],
      messages: [],
    };
    function clearTimeout(value) {
      calls.cleared.push(value);
    }
    const chrome = {
      runtime: {
        async sendMessage(message) {
          calls.messages.push(message);
          return { ok: true };
        },
      },
    };
    ${extractFunction('waitForSettingsSaveIdle')}
    function normalizeBrowserProxyInput() {
      calls.normalize += 1;
      return true;
    }
    async function saveSettings() {
      calls.save += 1;
      settingsDirty = false;
    }
    ${extractFunction('flushPendingSettingsBeforeAction')}
    return {
      flushPendingSettingsBeforeAction,
      calls,
    };
  `)();

  await api.flushPendingSettingsBeforeAction();

  assert.deepStrictEqual(api.calls.cleared, [123]);
  assert.equal(api.calls.normalize, 1);
  assert.equal(api.calls.save, 1);
  assert.deepStrictEqual(api.calls.messages, [{
    type: 'ENSURE_BROWSER_PROXY',
    source: 'sidepanel',
    payload: {},
  }]);
});

test('clearActiveBrowserProxyRuntime clears active proxy while preserving saved config in the UI', async () => {
  const api = new Function(`
    const calls = {
      messages: [],
      statuses: [],
      toasts: [],
    };
    const inputBrowserProxyUrl = {
      value: 'http://user:pass@proxy.example.com:8080',
    };
    const chrome = {
      runtime: {
        async sendMessage(message) {
          calls.messages.push(message);
          return { ok: true, cleared: true };
        },
      },
    };
    function setBrowserProxyTestStatusText(text, options = {}) {
      calls.statuses.push({ text, options });
    }
    function showToast(message, level, duration) {
      calls.toasts.push({ message, level, duration });
    }
    ${extractFunction('clearActiveBrowserProxyRuntime')}
    return {
      calls,
      clearActiveBrowserProxyRuntime,
    };
  `)();

  const response = await api.clearActiveBrowserProxyRuntime();

  assert.equal(response.ok, true);
  assert.deepStrictEqual(api.calls.messages, [{
    type: 'CLEAR_BROWSER_PROXY_RUNTIME',
    source: 'sidepanel',
    payload: {},
  }]);
  assert.deepStrictEqual(api.calls.statuses, [{
    text: '当前直连',
    options: {
      title: '已手动清理当前浏览器代理；代理地址配置仍会保留，下次执行前会自动重新应用。',
    },
  }]);
  assert.deepStrictEqual(api.calls.toasts, [{
    message: '已手动清理当前浏览器代理，当前恢复直连；下次执行会按配置自动重新应用。',
    level: 'success',
    duration: 3500,
  }]);
});

test('browser proxy runtime formatter prefers live exit ip and clear-state copy', () => {
  const api = new Function(`
    const DISPLAY_TIMEZONE = 'Asia/Shanghai';
    const inputBrowserProxyUrl = {
      value: 'http://user:pass@proxy.example.com:8080',
    };
    ${extractFunction('getPendingBrowserProxyTestStatusText')}
    ${extractFunction('formatBrowserProxySummary')}
    ${extractFunction('buildBrowserProxyTestToastMessage')}
    ${extractFunction('formatBrowserProxyRuntimeTestedAt')}
    ${extractFunction('formatBrowserProxyRuntimeStatusText')}
    ${extractFunction('buildBrowserProxyRuntimeStatusTitle')}
    return {
      formatBrowserProxyRuntimeStatusText,
      buildBrowserProxyRuntimeStatusTitle,
    };
  `)();

  const activeRuntime = {
    status: 'active',
    mode: 'proxy',
    ok: true,
    ip: '203.0.113.10',
    endpoint: 'ipify',
    testedAt: Date.UTC(2026, 3, 22, 14, 30, 0),
    proxy: {
      scheme: 'http',
      host: 'proxy.example.com',
      port: 8080,
      hasAuth: true,
    },
  };

  assert.equal(
    api.formatBrowserProxyRuntimeStatusText(activeRuntime),
    '代理出口 203.0.113.10'
  );
  assert.match(
    api.buildBrowserProxyRuntimeStatusTitle(activeRuntime),
    /当前出口 IP 为 203\.0\.113\.10/
  );

  const clearedRuntime = {
    status: 'cleared',
    mode: 'direct',
  };

  assert.equal(
    api.formatBrowserProxyRuntimeStatusText(clearedRuntime),
    '当前直连'
  );
  assert.match(
    api.buildBrowserProxyRuntimeStatusTitle(clearedRuntime),
    /重新连接并刷新出口 IP/
  );
});
