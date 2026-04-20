const assert = require('assert');
const fs = require('fs');

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
  for (; end < source.length; end++) {
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

const bundle = [
  'const STEP_IDS = [1,2,3,4,5,6,7,8,9,10];',
  'const LAST_STEP_ID = 10;',
  'const DEFAULT_LOCAL_CPA_STEP9_MODE = "submit";',
  extractFunction('parseUrlSafely'),
  extractFunction('isLocalCpaUrl'),
  extractFunction('normalizeLocalCpaStep9Mode'),
  extractFunction('normalizeLocalCpaSkippedSteps'),
  extractFunction('resolveLocalCpaSkippedSteps'),
  extractFunction('shouldBypassStep9ForLocalCpa'),
].join('\n');

const api = new Function(`${bundle}; return { isLocalCpaUrl, normalizeLocalCpaStep9Mode, normalizeLocalCpaSkippedSteps, resolveLocalCpaSkippedSteps, shouldBypassStep9ForLocalCpa };`)();

assert.strictEqual(api.isLocalCpaUrl('http://127.0.0.1:8317/management.html#/oauth'), true, '127.0.0.1 应视为本地 CPA');
assert.strictEqual(api.isLocalCpaUrl('http://localhost:1455/management.html#/oauth'), true, 'localhost 应视为本地 CPA');
assert.strictEqual(api.isLocalCpaUrl('https://example.com/management.html#/oauth'), false, '远程域名不应视为本地 CPA');
assert.strictEqual(api.isLocalCpaUrl('notaurl'), false, '非法 URL 不应视为本地 CPA');
assert.strictEqual(api.normalizeLocalCpaStep9Mode('submit'), 'submit', 'submit 应保持为 submit');
assert.strictEqual(api.normalizeLocalCpaStep9Mode('bypass'), 'bypass', 'bypass 应保持为 bypass');
assert.strictEqual(api.normalizeLocalCpaStep9Mode('other'), 'submit', '未知模式应回退为 submit');
assert.deepStrictEqual(api.normalizeLocalCpaSkippedSteps([10, '3', '3', 99, 'x']), [3, 10], '跳步列表应归一化、去重并过滤无效步骤');
assert.deepStrictEqual(api.resolveLocalCpaSkippedSteps({
  localCpaSkippedSteps: [3, 10],
  localCpaStep9Mode: 'bypass',
}), [3, 10], '新字段存在时应优先于 legacy bypass');
assert.deepStrictEqual(api.resolveLocalCpaSkippedSteps({
  localCpaStep9Mode: 'bypass',
}), [10], '新字段缺失时 legacy bypass 应回退为跳过第 10 步');

assert.strictEqual(api.shouldBypassStep9ForLocalCpa({
  vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
  localhostUrl: 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz',
}), false, '默认模式下，本地 CPA 也应执行步骤 9');

assert.strictEqual(api.shouldBypassStep9ForLocalCpa({
  localCpaSkippedSteps: [10],
  vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
  localhostUrl: 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz',
}), true, '新跳步字段包含第 10 步时，本地 CPA 且已有 callback 应触发本地跳过');

assert.strictEqual(api.shouldBypassStep9ForLocalCpa({
  localCpaSkippedSteps: [],
  localCpaStep9Mode: 'bypass',
  vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
  localhostUrl: 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz',
}), false, '新字段存在时，legacy bypass 不应再覆盖 canonical 配置');

assert.strictEqual(api.shouldBypassStep9ForLocalCpa({
  localCpaStep9Mode: 'bypass',
  vpsUrl: 'https://example.com/management.html#/oauth',
  localhostUrl: 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz',
}), false, '远程 CPA 不应跳过步骤 9');

assert.strictEqual(api.shouldBypassStep9ForLocalCpa({
  localCpaStep9Mode: 'bypass',
  vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
  localhostUrl: '',
}), false, '没有 callback 时不应跳过步骤 9');

console.log('step9 cpa mode tests passed');
