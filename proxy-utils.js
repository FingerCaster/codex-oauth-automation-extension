(function proxyUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.MultiPageProxyUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createProxyUtils() {
  const SUPPORTED_PROXY_SCHEMES = ['http', 'https', 'socks4', 'socks5'];
  const DEFAULT_AUTOMATION_PROXY_BYPASS_LIST = Object.freeze([
    '<local>',
    'localhost',
    '127.0.0.1',
    '127.0.0.0/8',
    '[::1]',
  ]);
  const INVALID_PROXY_URL_MESSAGE = '浏览器代理地址格式无效，请使用 http://username:password@hostname:port 或 https://username:password@hostname:port';

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function normalizeHostForComparison(value) {
    return normalizeText(value).replace(/^\[(.*)\]$/, '$1').toLowerCase();
  }

  function formatHostForUrl(value) {
    const host = normalizeText(value);
    if (!host) {
      return '';
    }
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return String(value || '');
    }
  }

  function encodeAuthComponent(value) {
    return encodeURIComponent(String(value || ''));
  }

  function buildAutomationProxyUrl(config = {}) {
    const scheme = normalizeText(config.scheme).toLowerCase();
    const host = normalizeHostForComparison(config.host);
    const port = Number(config.port);
    if (!SUPPORTED_PROXY_SCHEMES.includes(scheme) || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return '';
    }

    const authSegment = config.hasAuth
      ? `${encodeAuthComponent(config.username)}:${encodeAuthComponent(config.password)}@`
      : '';

    return `${scheme}://${authSegment}${formatHostForUrl(host)}:${port}`;
  }

  function parseAutomationProxyUrl(value = '') {
    const trimmed = normalizeText(value);
    if (!trimmed) {
      return null;
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }

    const scheme = normalizeText(parsed.protocol).replace(/:$/, '').toLowerCase();
    const host = normalizeHostForComparison(parsed.hostname);
    const port = Number(parsed.port);
    const hasPath = parsed.pathname && parsed.pathname !== '/';

    if (!SUPPORTED_PROXY_SCHEMES.includes(scheme) || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    if (hasPath || parsed.search || parsed.hash) {
      return null;
    }

    const hasAuth = parsed.username !== '' || parsed.password !== '';
    const username = safeDecodeURIComponent(parsed.username);
    const password = safeDecodeURIComponent(parsed.password);
    const normalized = {
      scheme,
      host,
      compareHost: host,
      port,
      hasAuth,
      username,
      password,
    };

    return {
      ...normalized,
      url: buildAutomationProxyUrl(normalized),
    };
  }

  function normalizeAutomationProxyUrl(value = '', options = {}) {
    const { strict = false } = options;
    const trimmed = normalizeText(value);
    if (!trimmed) {
      return '';
    }

    const parsed = parseAutomationProxyUrl(trimmed);
    if (!parsed) {
      if (strict) {
        throw new Error(INVALID_PROXY_URL_MESSAGE);
      }
      return '';
    }

    return parsed.url;
  }

  function buildAutomationProxyBypassList(extraEntries = []) {
    return [
      ...DEFAULT_AUTOMATION_PROXY_BYPASS_LIST,
      ...(Array.isArray(extraEntries) ? extraEntries : []),
    ];
  }

  return {
    DEFAULT_AUTOMATION_PROXY_BYPASS_LIST: DEFAULT_AUTOMATION_PROXY_BYPASS_LIST.slice(),
    INVALID_PROXY_URL_MESSAGE,
    SUPPORTED_PROXY_SCHEMES: SUPPORTED_PROXY_SCHEMES.slice(),
    buildAutomationProxyBypassList,
    buildAutomationProxyUrl,
    normalizeAutomationProxyUrl,
    normalizeHostForComparison,
    parseAutomationProxyUrl,
  };
});
