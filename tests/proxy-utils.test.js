const test = require('node:test');
const assert = require('node:assert/strict');

const proxyUtils = require('../proxy-utils.js');

test('proxy utils normalize authenticated proxy url', () => {
  assert.equal(
    proxyUtils.normalizeAutomationProxyUrl(' https://user:pass@proxy.example.com:8443 '),
    'https://user:pass@proxy.example.com:8443'
  );
});

test('proxy utils parse proxy credentials and endpoint', () => {
  const parsed = proxyUtils.parseAutomationProxyUrl('https://user:pass@proxy.example.com:8443');

  assert.deepStrictEqual(parsed, {
    scheme: 'https',
    host: 'proxy.example.com',
    compareHost: 'proxy.example.com',
    port: 8443,
    hasAuth: true,
    username: 'user',
    password: 'pass',
    url: 'https://user:pass@proxy.example.com:8443',
  });
});

test('proxy utils reject invalid proxy urls in strict mode', () => {
  assert.throws(
    () => proxyUtils.normalizeAutomationProxyUrl('https://proxy.example.com', { strict: true }),
    /浏览器代理地址格式无效/
  );
});

test('proxy utils keep localhost bypass list by default', () => {
  const bypassList = proxyUtils.buildAutomationProxyBypassList();

  assert.ok(bypassList.includes('<local>'));
  assert.ok(bypassList.includes('localhost'));
  assert.ok(bypassList.includes('127.0.0.1'));
  assert.ok(bypassList.includes('[::1]'));
});
