(function attachBackgroundBrowserProxy(root, factory) {
  root.MultiPageBackgroundBrowserProxy = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundBrowserProxyModule() {
  function createBrowserProxyController(deps = {}) {
    const {
      chrome,
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

    async function clearProxySettings() {
      activeProxy = null;
      activeProxyKey = '';
      lastProxyError = null;
      authAttemptsByRequestId.clear();

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
      clearProxySettings,
      getActiveProxy: () => activeProxy,
      getLastProxyError: () => lastProxyError,
      shouldHandleProxyAuth,
      syncConfiguredProxy,
    };
  }

  return {
    createBrowserProxyController,
  };
});
