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
const SIGNUP_GUIDE_PAGE_PATTERN = /welcome\\s+to\\s+chatgpt|try\\s+our\\s+latest\\s+models|how\\s+would\\s+you\\s+like\\s+to\\s+use\\s+chatgpt|choose\\s+how\\s+you(?:'d|\\s+would)?\\s+like\\s+to\\s+use\\s+chatgpt|what\\s+brings\\s+you\\s+to\\s+chatgpt|what\\s+brings\\s+you\\s+here|欢迎使用\\s*chatgpt|欢迎来到\\s*chatgpt|开始使用\\s*chatgpt|让我们开始|是什么促使你使用\\s*chatgpt|你想如何使用\\s*chatgpt|我们会利用这些信息提出.*建议|学校\\s*工作\\s*个人任务\\s*(?:乐趣和娱乐|娱乐和乐趣|乐趣|娱乐)?\\s*其他/i;
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

test('step 5 completion treats localized usage guide as completed even before url host finishes switching', () => {
  const api = new Function(`
const SIGNUP_GUIDE_PAGE_PATTERN = /welcome\\s+to\\s+chatgpt|try\\s+our\\s+latest\\s+models|how\\s+would\\s+you\\s+like\\s+to\\s+use\\s+chatgpt|choose\\s+how\\s+you(?:'d|\\s+would)?\\s+like\\s+to\\s+use\\s+chatgpt|what\\s+brings\\s+you\\s+to\\s+chatgpt|what\\s+brings\\s+you\\s+here|欢迎使用\\s*chatgpt|欢迎来到\\s*chatgpt|开始使用\\s*chatgpt|让我们开始|是什么促使你使用\\s*chatgpt|你想如何使用\\s*chatgpt|我们会利用这些信息提出.*建议|学校\\s*工作\\s*个人任务\\s*(?:乐趣和娱乐|娱乐和乐趣|乐趣|娱乐)?\\s*其他/i;
const SIGNUP_GUIDE_ACTION_PATTERN = /get\\s+started|continue|next|开始|继续|下一步|跳过/i;

const visibleNameInput = { visible: true };
const guideButton = {
  visible: true,
  textContent: '下一步',
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
    innerText: '是什么促使你使用 ChatGPT? 我们会利用这些信息提出一些可能会对你有用的建议。 学校 工作 个人任务 乐趣和娱乐 其他',
    textContent: '是什么促使你使用 ChatGPT? 我们会利用这些信息提出一些可能会对你有用的建议。 学校 工作 个人任务 乐趣和娱乐 其他',
  },
  querySelectorAll(selector) {
    switch (selector) {
      case 'input[name="name"]':
        return [visibleNameInput];
      case 'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]':
        return [guideButton];
      default:
        return [];
    }
  },
};

const location = {
  href: 'https://auth.openai.com/u/signup/create-account/profile',
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
  assert.equal(snapshot.guidePage, true);
  assert.equal(snapshot.url, 'https://auth.openai.com/u/signup/create-account/profile');
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
