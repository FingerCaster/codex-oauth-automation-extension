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

test('ensureHotmailAccountForFlow can allocate pending accounts that already have refresh tokens', async () => {
  const ensureHotmailAccountForFlow = new Function(`
${extractFunction('ensureHotmailAccountForFlow')}
return ensureHotmailAccountForFlow;
`)();

  const accounts = [
    {
      id: 'pending-hotmail',
      email: 'pending@hotmail.com',
      status: 'pending',
      refreshToken: 'rt-pending',
      used: false,
    },
  ];

  let selectedArgs = null;
  globalThis.getState = async () => ({
    hotmailAccounts: accounts,
    currentHotmailAccountId: null,
  });
  globalThis.normalizeHotmailAccounts = (items) => items;
  globalThis.findHotmailAccount = (items, id) => items.find((item) => item.id === id) || null;
  globalThis.pickHotmailAccountForRun = (items) => items[0] || null;
  globalThis.setCurrentHotmailAccount = async (id, options) => {
    selectedArgs = { id, options };
    return accounts.find((item) => item.id === id) || null;
  };

  const selected = await ensureHotmailAccountForFlow({});

  assert.equal(selected?.email, 'pending@hotmail.com');
  assert.deepEqual(selectedArgs, {
    id: 'pending-hotmail',
    options: { markUsed: false, syncEmail: true },
  });
});
