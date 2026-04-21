(function attachBackgroundBrowserProxy(root, factory) {
  root.MultiPageBackgroundBrowserProxy = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundBrowserProxyModule() {
  function createBrowserProxyController(deps = {}) {
    const {
      chrome,
      fetch: fetchFn = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      getState,
      LOG_PREFIX = '[MultiPage:bg]',
      buildAutomationProxyBypassList,
      normalizeAutomationProxyUrl,
      normalizeHostForComparison,
      parseAutomationProxyUrl,
    } = deps;

    let activeProxy = null;
    let activeProxyKey = '';
    let lastProxyError = null;
    const authAttemptsByRequestId = new Map();
    const PROXY_IP_TEST_ENDPOINTS = [
      {
        label: 'ipify',
        url: 'https://api.ipify.org?format=json',
        readIp: async (response) => {
          const payload = await response.json();
          return String(payload?.ip || '').trim();
        },
      },
      {
        label: 'ipinfo',
        url: 'https://ipinfo.io/json',
        readIp: async (response) => {
          const payload = await response.json();
          return String(payload?.ip || '').trim();
        },
      },
    ];

    function isProxySettingsAvailable() {
      return Boolean(chrome?.proxy?.settings?.set && chrome?.proxy?.settings?.clear);
    }

    function clearProxyAuthAttempt(requestId) {
      if (requestId) {
        authAttemptsByRequestId.delete(requestId);
      }
    }

    function getBypassList() {
      if (typeof buildAutomationProxyBypassList === 'function') {
        return buildAutomationProxyBypassList();
      }
      return ['<local>', 'localhost', '127.0.0.1', '127.0.0.0/8', '[::1]'];
    }

    function getParsedProxy(input) {
      const rawValue = typeof input === 'string' ? input : input?.browserProxyUrl;
      const normalized = typeof normalizeAutomationProxyUrl === 'function'
        ? normalizeAutomationProxyUrl(rawValue)
        : String(rawValue || '').trim();
      if (!normalized) {
        return null;
      }
      return typeof parseAutomationProxyUrl === 'function'
        ? parseAutomationProxyUrl(normalized)
        : null;
    }

    function getProxyKey(parsedProxy) {
      return parsedProxy?.url || '';
    }

    function buildProxySummary(parsedProxy) {
      if (!parsedProxy) {
        return null;
      }

      return {
        scheme: parsedProxy.scheme,
        host: parsedProxy.host,
        port: parsedProxy.port,
        hasAuth: Boolean(parsedProxy.hasAuth),
      };
    }

    function buildProxySettingsValue(parsedProxy) {
      return {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme: parsedProxy.scheme,
            host: parsedProxy.host,
            port: parsedProxy.port,
          },
          bypassList: getBypassList(),
        },
      };
    }

    function resetActiveProxyState() {
      activeProxy = null;
      activeProxyKey = '';
      lastProxyError = null;
      authAttemptsByRequestId.clear();
    }

    function clearProxySettingsBestEffort() {
      resetActiveProxyState();

      if (!isProxySettingsAvailable()) {
        return false;
      }

      try {
        const clearResult = chrome.proxy.settings.clear({ scope: 'regular' });
        if (clearResult && typeof clearResult.catch === 'function') {
          clearResult.catch((error) => {
            console.warn(LOG_PREFIX, 'Failed to clear browser proxy settings:', error?.message || error);
          });
        }
        return true;
      } catch (error) {
        console.warn(LOG_PREFIX, 'Failed to clear browser proxy settings:', error?.message || error);
        return false;
      }
    }

    async function clearProxySettings() {
      resetActiveProxyState();

      if (!isProxySettingsAvailable()) {
        return { enabled: false };
      }

      await chrome.proxy.settings.clear({ scope: 'regular' });
      return { enabled: false };
    }

    async function syncConfiguredProxy(state = null) {
      const sourceState = state || (typeof getState === 'function' ? await getState() : {});
      const parsedProxy = getParsedProxy(sourceState);
      if (!parsedProxy) {
        return clearProxySettings();
      }

      const nextKey = getProxyKey(parsedProxy);
      if (nextKey === activeProxyKey) {
        activeProxy = parsedProxy;
        return { enabled: true, proxy: parsedProxy };
      }

      if (!isProxySettingsAvailable()) {
        activeProxy = parsedProxy;
        activeProxyKey = nextKey;
        return { enabled: false, proxy: parsedProxy };
      }

      await chrome.proxy.settings.set({
        value: buildProxySettingsValue(parsedProxy),
        scope: 'regular',
      });

      activeProxy = parsedProxy;
      activeProxyKey = nextKey;
      lastProxyError = null;
      authAttemptsByRequestId.clear();
      return { enabled: true, proxy: parsedProxy };
    }

    async function fetchWithTimeout(url, options = {}) {
      if (typeof fetchFn !== 'function') {
        throw new Error('当前环境不支持代理测试。');
      }

      const { timeoutMs: rawTimeoutMs, ...fetchOptions } = options || {};
      const timeoutMs = Math.max(1000, Number(rawTimeoutMs) || 8000);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      try {
        return await fetchFn(url, {
          cache: 'no-store',
          redirect: 'follow',
          ...fetchOptions,
          ...(controller ? { signal: controller.signal } : {}),
        });
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }

    async function testProxyConnection(state = null, options = {}) {
      const sourceState = state || (typeof getState === 'function' ? await getState() : {});
      const parsedProxy = getParsedProxy(sourceState) || activeProxy;
      const proxy = buildProxySummary(parsedProxy);
      const attempts = [];
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);

      for (const endpoint of PROXY_IP_TEST_ENDPOINTS) {
        const testUrl = `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}_=${Date.now()}`;
        try {
          const response = await fetchWithTimeout(testUrl, {
            headers: {
              Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
            },
            timeoutMs,
          });

          if (!response?.ok) {
            throw new Error(`HTTP ${response?.status || 'unknown'}`);
          }

          const ip = String(await endpoint.readIp(response)).trim();
          if (!ip) {
            throw new Error('返回结果中未包含出口 IP。');
          }

          return {
            ok: true,
            endpoint: endpoint.label,
            ip,
            lastProxyError,
            proxy,
            testedAt: Date.now(),
          };
        } catch (error) {
          attempts.push({
            endpoint: endpoint.label,
            error: error?.message || String(error || '代理测试失败'),
          });
        }
      }

      return {
        ok: false,
        attempts,
        errorMessage: attempts[attempts.length - 1]?.error || '代理测试失败。',
        lastProxyError,
        proxy,
        testedAt: Date.now(),
      };
    }

    function shouldHandleProxyAuth(details, parsedProxy) {
      if (!details?.isProxy || !parsedProxy?.hasAuth) {
        return false;
      }

      const challengerHost = typeof normalizeHostForComparison === 'function'
        ? normalizeHostForComparison(details?.challenger?.host)
        : String(details?.challenger?.host || '').trim().toLowerCase();
      const proxyHost = typeof normalizeHostForComparison === 'function'
        ? normalizeHostForComparison(parsedProxy.host)
        : String(parsedProxy.host || '').trim().toLowerCase();
      const challengerPort = Number(details?.challenger?.port);

      return challengerHost === proxyHost && challengerPort === Number(parsedProxy.port);
    }

    function registerWebRequestListeners() {
      if (!chrome?.webRequest?.onAuthRequired?.addListener) {
        return;
      }

      chrome.webRequest.onAuthRequired.addListener(
        (details, callback) => {
          const parsedProxy = activeProxy;
          if (!shouldHandleProxyAuth(details, parsedProxy)) {
            callback({});
            return;
          }

          const currentAttempts = Number(authAttemptsByRequestId.get(details.requestId) || 0);
          if (currentAttempts >= 1) {
            callback({});
            return;
          }

          authAttemptsByRequestId.set(details.requestId, currentAttempts + 1);
          callback({
            authCredentials: {
              username: parsedProxy.username,
              password: parsedProxy.password,
            },
          });
        },
        { urls: ['<all_urls>'] },
        ['asyncBlocking']
      );

      chrome.webRequest.onCompleted?.addListener?.(
        (details) => clearProxyAuthAttempt(details?.requestId),
        { urls: ['<all_urls>'] }
      );
      chrome.webRequest.onErrorOccurred?.addListener?.(
        (details) => clearProxyAuthAttempt(details?.requestId),
        { urls: ['<all_urls>'] }
      );
    }

    function registerProxyErrorListener() {
      if (!chrome?.proxy?.onProxyError?.addListener) {
        return;
      }

      chrome.proxy.onProxyError.addListener((details) => {
        lastProxyError = {
          ...details,
          occurredAt: Date.now(),
        };
        console.warn(LOG_PREFIX, 'Browser proxy error:', details?.error || details);
      });
    }

    function registerStorageListener() {
      if (!chrome?.storage?.onChanged?.addListener) {
        return;
      }

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes || {}, 'browserProxyUrl')) {
          return;
        }

        syncConfiguredProxy({ browserProxyUrl: changes.browserProxyUrl?.newValue || '' }).catch((error) => {
          console.warn(LOG_PREFIX, 'Failed to sync browser proxy after storage change:', error?.message || error);
        });
      });
    }

    registerWebRequestListeners();
    registerProxyErrorListener();
    registerStorageListener();

    return {
      buildProxySettingsValue,
      buildProxySummary,
      clearProxySettings,
      clearProxySettingsBestEffort,
      getActiveProxy: () => activeProxy,
      getLastProxyError: () => lastProxyError,
      shouldHandleProxyAuth,
      syncConfiguredProxy,
      testProxyConnection,
    };
  }

  return {
    createBrowserProxyController,
  };
});
