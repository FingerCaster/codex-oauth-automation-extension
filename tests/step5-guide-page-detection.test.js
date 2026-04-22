const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

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
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
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

test('step 5 completion treats ChatGPT guide page as completed even if hidden profile DOM remains', () => {
  const api = new Function(`
const SIGNUP_GUIDE_PAGE_PATTERN = /welcome\\s+to\\s+chatgpt|try\\s+our\\s+latest\\s+models|how\\s+would\\s+you\\s+like\\s+to\\s+use\\s+chatgpt|choose\\s+how\\s+you(?:'d|\\s+would)?\\s+like\\s+to\\s+use\\s+chatgpt|欢迎使用\\s*chatgpt|欢迎来到\\s*chatgpt|开始使用\\s*chatgpt|让我们开始/i;
const SIGNUP_GUIDE_ACTION_PATTERN = /get\\s+started|continue|next|开始|继续|下一步|跳过/i;

const hiddenNameInput = { visible: false };
const guideButton = {
  visible: true,
  textContent: 'Get started',
  value: '',
  disabled: false,
  getAttribute(name) {
    if (name === 'aria-disabled') return 'false';
    if (name === 'type') return 'button';
    return '';
  },
};

const document = {
  body: {
    innerText: '是什么促使你使用 ChatGPT? 学校 工作 个人任务 其他',
    textContent: '是什么促使你使用 ChatGPT? 学校 工作 个人任务 其他',
  },
  querySelectorAll(selector) {
    switch (selector) {
      case 'input[name="name"]':
        return [hiddenNameInput];
      case 'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]':
        return [guideButton];
      default:
        return [];
    }
  },
};

const location = {
  href: 'https://chatgpt.com/',
};

function isVisibleElement(el) {
  return Boolean(el?.visible);
}

function getStep5ErrorText() {
  return '';
}

function isStep8Ready() {
  return false;
}

function isAddPhonePageReady() {
  return false;
}

${extractFunction('getActionText')}
${extractFunction('isStep5Ready')}
${extractFunction('getPageTextSnapshot')}
${extractFunction('isSignupEntryHost')}
${extractFunction('isSignupProfileCompletionUrl')}
${extractFunction('isSignupGuidePageReady')}
${extractFunction('inspectStep5CompletionState')}

return {
  run() {
    return inspectStep5CompletionState();
  },
};
`)();

  const snapshot = api.run();
  assert.equal(snapshot.state, 'completed');
  assert.equal(snapshot.url, 'https://chatgpt.com/');
  assert.equal(snapshot.completedByUrl, true);
});

test('step 5 readiness still recognizes visible profile inputs', () => {
  const api = new Function(`
const visibleNameInput = { visible: true };

const document = {
  querySelectorAll(selector) {
    if (selector === 'input[name="name"]') {
      return [visibleNameInput];
    }
    return [];
  },
};

function isVisibleElement(el) {
  return Boolean(el?.visible);
}

${extractFunction('isStep5Ready')}

return {
  run() {
    return isStep5Ready();
  },
};
`)();

  assert.equal(api.run(), true);
});
