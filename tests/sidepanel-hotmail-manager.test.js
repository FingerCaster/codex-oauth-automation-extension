const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createAccountPoolUiStub() {
  return {
    createAccountPoolFormController({
      formShell,
      toggleButton,
      hiddenLabel = '添加账号',
      visibleLabel = '取消添加',
      onClear,
      onFocus,
    } = {}) {
      let visible = false;

      function sync() {
        if (formShell) {
          formShell.hidden = !visible;
        }
        if (toggleButton) {
          toggleButton.textContent = visible ? visibleLabel : hiddenLabel;
          toggleButton.setAttribute?.('aria-expanded', String(visible));
        }
      }

      function setVisible(nextVisible, options = {}) {
        visible = Boolean(nextVisible);
        if (options.clearForm) {
          onClear?.();
        }
        sync();
        if (visible && options.focusField) {
          onFocus?.();
        }
      }

      sync();
      return {
        isVisible: () => visible,
        setVisible,
        sync,
      };
    },
  };
}

test('sidepanel loads hotmail manager before sidepanel bootstrap', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const helperIndex = html.indexOf('<script src="account-pool-ui.js"></script>');
  const hotmailManagerIndex = html.indexOf('<script src="hotmail-manager.js"></script>');
  const sidepanelIndex = html.indexOf('<script src="sidepanel.js"></script>');

  assert.notEqual(helperIndex, -1);
  assert.notEqual(hotmailManagerIndex, -1);
  assert.notEqual(sidepanelIndex, -1);
  assert.ok(helperIndex < hotmailManagerIndex);
  assert.ok(hotmailManagerIndex < sidepanelIndex);
});

test('sidepanel html contains collapsible hotmail form controls', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  assert.match(html, /id="btn-toggle-hotmail-form"/);
  assert.match(html, /id="btn-batch-verify-hotmail-accounts"[^>]*>批量校验</);
  assert.match(html, /id="hotmail-form-shell"/);
  assert.match(html, /id="btn-import-hotmail-accounts"[^>]*>批量导入</);
  assert.match(html, /id="input-hotmail-search"/);
  assert.match(html, /id="btn-search-hotmail-accounts"[^>]*>搜索</);
});

test('hotmail manager exposes a factory and renders empty state', () => {
  const source = fs.readFileSync('sidepanel/hotmail-manager.js', 'utf8');
  const windowObject = {
    SidepanelAccountPoolUi: createAccountPoolUiStub(),
  };
  const localStorageMock = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  const api = new Function('window', 'localStorage', `${source}; return window.SidepanelHotmailManager;`)(
    windowObject,
    localStorageMock
  );

  assert.equal(typeof api?.createHotmailManager, 'function');

  const hotmailAccountsList = { innerHTML: '' };
  const toggleButton = {
    textContent: '',
    disabled: false,
    setAttribute() {},
  };
  const noopClassList = { toggle() {} };

  const manager = api.createHotmailManager({
    state: {
      getLatestState: () => ({ currentHotmailAccountId: null }),
      syncLatestState() {},
    },
    dom: {
      btnClearUsedHotmailAccounts: { textContent: '', disabled: false },
      btnDeleteAllHotmailAccounts: { textContent: '', disabled: false },
      btnToggleHotmailList: toggleButton,
      hotmailAccountsList,
      hotmailListShell: { classList: noopClassList },
      selectMailProvider: { value: 'hotmail-api' },
      inputEmail: { value: '' },
    },
    helpers: {
      getHotmailAccounts: () => [],
      getCurrentHotmailEmail: () => '',
      escapeHtml: (value) => String(value || ''),
      showToast() {},
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: async () => ({}),
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-hotmail-list-expanded',
    },
    hotmailUtils: {},
  });

  assert.equal(typeof manager.renderHotmailAccounts, 'function');
  assert.equal(typeof manager.bindHotmailEvents, 'function');
  assert.equal(typeof manager.initHotmailListExpandedState, 'function');

  manager.renderHotmailAccounts();
  assert.match(hotmailAccountsList.innerHTML, /还没有 Hotmail 账号/);
});

test('hotmail manager sorts accounts by email and filters them through the search button', () => {
  const source = fs.readFileSync('sidepanel/hotmail-manager.js', 'utf8');
  const windowObject = {
    SidepanelAccountPoolUi: createAccountPoolUiStub(),
  };
  const localStorageMock = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  const api = new Function('window', 'localStorage', `${source}; return window.SidepanelHotmailManager;`)(
    windowObject,
    localStorageMock
  );

  const handlers = {};
  const stateStore = {
    currentHotmailAccountId: null,
    hotmailAccounts: [
      { id: 'zeta', email: 'Zeta@hotmail.com', status: 'authorized', used: false, refreshToken: 'rt-z', clientId: 'client-z' },
      { id: 'beta', email: 'beta@hotmail.com', status: 'authorized', used: false, refreshToken: 'rt-b', clientId: 'client-b' },
      { id: 'alpha', email: 'Alpha@hotmail.com', status: 'authorized', used: false, refreshToken: 'rt-a', clientId: 'client-a' },
    ],
  };
  const hotmailAccountsList = {
    innerHTML: '',
    addEventListener() {},
  };
  const searchInput = {
    value: '',
    addEventListener(type, handler) {
      if (type === 'input') handlers.searchInput = handler;
      if (type === 'keydown') handlers.searchKeydown = handler;
    },
  };
  const searchButton = {
    disabled: false,
    addEventListener(type, handler) {
      if (type === 'click') handlers.searchClick = handler;
    },
  };

  const manager = api.createHotmailManager({
    state: {
      getLatestState: () => stateStore,
      syncLatestState(updates) {
        Object.assign(stateStore, updates);
      },
    },
    dom: {
      btnAddHotmailAccount: { textContent: '', disabled: false, addEventListener() {} },
      btnBatchVerifyHotmailAccounts: { textContent: '', disabled: false, hidden: true, addEventListener() {} },
      btnClearUsedHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnDeleteAllHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnHotmailUsageGuide: { addEventListener() {} },
      btnImportHotmailAccounts: { disabled: false, addEventListener() {} },
      btnSearchHotmailAccounts: searchButton,
      btnToggleHotmailForm: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      btnToggleHotmailList: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      hotmailAccountsList,
      hotmailFormShell: { hidden: true },
      hotmailListShell: { classList: { toggle() {} } },
      inputEmail: { value: '' },
      inputHotmailClientId: { value: '' },
      inputHotmailEmail: { value: '', focus() {} },
      inputHotmailImport: { value: '' },
      inputHotmailPassword: { value: '' },
      inputHotmailRefreshToken: { value: '' },
      inputHotmailSearch: searchInput,
      selectMailProvider: { value: 'hotmail-api' },
    },
    helpers: {
      getHotmailAccounts: () => stateStore.hotmailAccounts,
      getCurrentHotmailEmail: () => '',
      escapeHtml: (value) => String(value || ''),
      showToast() {},
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: async () => ({}),
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-hotmail-list-expanded',
    },
    hotmailUtils: {},
  });

  manager.bindHotmailEvents();
  manager.renderHotmailAccounts();

  const alphaIndex = hotmailAccountsList.innerHTML.indexOf('Alpha@hotmail.com');
  const betaIndex = hotmailAccountsList.innerHTML.indexOf('beta@hotmail.com');
  const zetaIndex = hotmailAccountsList.innerHTML.indexOf('Zeta@hotmail.com');
  assert.ok(alphaIndex >= 0);
  assert.ok(betaIndex > alphaIndex);
  assert.ok(zetaIndex > betaIndex);

  searchInput.value = 'zeta';
  handlers.searchClick();

  assert.match(hotmailAccountsList.innerHTML, /Zeta@hotmail\.com/);
  assert.doesNotMatch(hotmailAccountsList.innerHTML, /Alpha@hotmail\.com/);
  assert.doesNotMatch(hotmailAccountsList.innerHTML, /beta@hotmail\.com/);

  searchInput.value = '';
  handlers.searchInput();

  assert.match(hotmailAccountsList.innerHTML, /Alpha@hotmail\.com/);
  assert.match(hotmailAccountsList.innerHTML, /beta@hotmail\.com/);
  assert.match(hotmailAccountsList.innerHTML, /Zeta@hotmail\.com/);
});

test('hotmail manager toggles form container from header button', () => {
  const source = fs.readFileSync('sidepanel/hotmail-manager.js', 'utf8');
  const windowObject = {
    SidepanelAccountPoolUi: createAccountPoolUiStub(),
  };
  const localStorageMock = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  const api = new Function('window', 'localStorage', `${source}; return window.SidepanelHotmailManager;`)(
    windowObject,
    localStorageMock
  );

  const handlers = {};
  const toggleFormButton = {
    textContent: '',
    disabled: false,
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(type, handler) {
      if (type === 'click') handlers.toggleForm = handler;
    },
  };
  const formShell = { hidden: true };

  const manager = api.createHotmailManager({
    state: {
      getLatestState: () => ({ currentHotmailAccountId: null }),
      syncLatestState() {},
    },
    dom: {
      btnAddHotmailAccount: { textContent: '', disabled: false, addEventListener() {} },
      btnClearUsedHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnDeleteAllHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnHotmailUsageGuide: { addEventListener() {} },
      btnImportHotmailAccounts: { disabled: false, addEventListener() {} },
      btnToggleHotmailForm: toggleFormButton,
      btnToggleHotmailList: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      hotmailAccountsList: { innerHTML: '', addEventListener() {} },
      hotmailFormShell: formShell,
      hotmailListShell: { classList: { toggle() {} } },
      inputEmail: { value: '' },
      inputHotmailClientId: { value: '' },
      inputHotmailEmail: { value: '', focus() { this.focused = true; } },
      inputHotmailImport: { value: '' },
      inputHotmailPassword: { value: '' },
      inputHotmailRefreshToken: { value: '' },
      selectMailProvider: { value: 'hotmail-api' },
    },
    helpers: {
      getHotmailAccounts: () => [],
      getCurrentHotmailEmail: () => '',
      escapeHtml: (value) => String(value || ''),
      showToast() {},
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: async () => ({}),
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-hotmail-list-expanded',
    },
    hotmailUtils: {},
  });

  manager.bindHotmailEvents();
  assert.equal(formShell.hidden, true);
  assert.equal(toggleFormButton.textContent, '添加账号');

  handlers.toggleForm();
  assert.equal(formShell.hidden, false);
  assert.equal(toggleFormButton.textContent, '取消添加');

  handlers.toggleForm();
  assert.equal(formShell.hidden, true);
  assert.equal(toggleFormButton.textContent, '添加账号');
});

test('hotmail manager hides form after save succeeds', async () => {
  const source = fs.readFileSync('sidepanel/hotmail-manager.js', 'utf8');
  const windowObject = {
    SidepanelAccountPoolUi: createAccountPoolUiStub(),
  };
  const localStorageMock = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  const api = new Function('window', 'localStorage', `${source}; return window.SidepanelHotmailManager;`)(
    windowObject,
    localStorageMock
  );

  const handlers = {};
  const formShell = { hidden: true };
  const toggleFormButton = {
    textContent: '',
    disabled: false,
    setAttribute() {},
    addEventListener(type, handler) {
      if (type === 'click') handlers.toggleForm = handler;
    },
  };
  const addButton = {
    textContent: '',
    disabled: false,
    addEventListener(type, handler) {
      if (type === 'click') handlers.add = handler;
    },
  };
  const inputHotmailEmail = { value: '', focus() {} };
  const inputHotmailClientId = { value: '' };
  const inputHotmailPassword = { value: '' };
  const inputHotmailRefreshToken = { value: '' };
  const toastMessages = [];

  const manager = api.createHotmailManager({
    state: {
      getLatestState: () => ({ currentHotmailAccountId: null }),
      syncLatestState() {},
    },
    dom: {
      btnAddHotmailAccount: addButton,
      btnClearUsedHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnDeleteAllHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnHotmailUsageGuide: { addEventListener() {} },
      btnImportHotmailAccounts: { disabled: false, addEventListener() {} },
      btnToggleHotmailForm: toggleFormButton,
      btnToggleHotmailList: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      hotmailAccountsList: { innerHTML: '', addEventListener() {} },
      hotmailFormShell: formShell,
      hotmailListShell: { classList: { toggle() {} } },
      inputEmail: { value: '' },
      inputHotmailClientId,
      inputHotmailEmail,
      inputHotmailImport: { value: '' },
      inputHotmailPassword,
      inputHotmailRefreshToken,
      selectMailProvider: { value: 'hotmail-api' },
    },
    helpers: {
      getHotmailAccounts: () => [],
      getCurrentHotmailEmail: () => '',
      escapeHtml: (value) => String(value || ''),
      showToast(message) {
        toastMessages.push(message);
      },
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: async () => ({
        account: {
          id: 'acc-1',
          email: 'demo@hotmail.com',
          clientId: 'client-id',
          refreshToken: 'refresh-token',
        },
      }),
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-hotmail-list-expanded',
    },
    hotmailUtils: {},
  });

  manager.bindHotmailEvents();
  handlers.toggleForm();
  inputHotmailEmail.value = 'demo@hotmail.com';
  inputHotmailClientId.value = 'client-id';
  inputHotmailPassword.value = 'secret';
  inputHotmailRefreshToken.value = 'refresh-token';

  await handlers.add();

  assert.equal(formShell.hidden, true);
  assert.equal(toggleFormButton.textContent, '添加账号');
  assert.equal(inputHotmailEmail.value, '');
  assert.equal(inputHotmailClientId.value, '');
  assert.equal(inputHotmailPassword.value, '');
  assert.equal(inputHotmailRefreshToken.value, '');
  assert.match(toastMessages.at(-1) || '', /已保存 Hotmail 账号/);
});

test('hotmail manager batch verifies pending and error accounts in local mode', async () => {
  const source = fs.readFileSync('sidepanel/hotmail-manager.js', 'utf8');
  const windowObject = {
    SidepanelAccountPoolUi: createAccountPoolUiStub(),
  };
  const localStorageMock = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  const api = new Function('window', 'localStorage', `${source}; return window.SidepanelHotmailManager;`)(
    windowObject,
    localStorageMock
  );

  const handlers = {};
  const toastMessages = [];
  const accounts = [
    { id: 'pending-1', email: 'pending-1@hotmail.com', status: 'pending', used: false, refreshToken: 'rt-1' },
    { id: 'error-1', email: 'error@hotmail.com', status: 'error', used: false, refreshToken: 'rt-err' },
    { id: 'authorized-1', email: 'authorized@hotmail.com', status: 'authorized', used: false, refreshToken: 'rt-2' },
    { id: 'used-1', email: 'used@hotmail.com', status: 'pending', used: true, refreshToken: 'rt-3' },
  ];
  const stateStore = {
    hotmailServiceMode: 'local',
    hotmailAccounts: accounts,
    currentHotmailAccountId: null,
  };
  const batchButton = {
    textContent: '',
    disabled: false,
    hidden: true,
    addEventListener(type, handler) {
      if (type === 'click') handlers.batchVerify = handler;
    },
  };

  const manager = api.createHotmailManager({
    state: {
      getLatestState: () => stateStore,
      syncLatestState(updates) {
        Object.assign(stateStore, updates);
      },
    },
    dom: {
      btnAddHotmailAccount: { textContent: '', disabled: false, addEventListener() {} },
      btnBatchVerifyHotmailAccounts: batchButton,
      btnClearUsedHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnDeleteAllHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnHotmailUsageGuide: { addEventListener() {} },
      btnImportHotmailAccounts: { disabled: false, addEventListener() {} },
      btnToggleHotmailForm: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      btnToggleHotmailList: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      hotmailAccountsList: { innerHTML: '', addEventListener() {} },
      hotmailFormShell: { hidden: true },
      hotmailListShell: { classList: { toggle() {} } },
      inputEmail: { value: '' },
      inputHotmailClientId: { value: '' },
      inputHotmailEmail: { value: '', focus() {} },
      inputHotmailImport: { value: '' },
      inputHotmailPassword: { value: '' },
      inputHotmailRefreshToken: { value: '' },
      selectMailProvider: { value: 'hotmail-api' },
    },
    helpers: {
      getHotmailAccounts: () => stateStore.hotmailAccounts,
      getCurrentHotmailEmail: () => '',
      escapeHtml: (value) => String(value || ''),
      showToast(message) {
        toastMessages.push(message);
      },
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: async (message) => {
        assert.equal(message.type, 'BATCH_VERIFY_HOTMAIL_ACCOUNTS');
        return {
          verifiedCount: 2,
          failedCount: 0,
          skippedCount: 2,
        };
      },
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-hotmail-list-expanded',
    },
    hotmailUtils: {
      normalizeHotmailServiceMode(value) {
        return value === 'remote' ? 'remote' : 'local';
      },
    },
  });

  manager.bindHotmailEvents();
  manager.renderHotmailAccounts();

  assert.equal(batchButton.hidden, false);
  assert.equal(batchButton.textContent, '批量校验（2）');
  assert.equal(batchButton.disabled, false);

  await handlers.batchVerify();

  assert.match(toastMessages.at(-1) || '', /批量校验完成：成功 2 个，失败 0 个，跳过 2 个/);
});

test('hotmail manager switches batch verify button to stop while running', async () => {
  const source = fs.readFileSync('sidepanel/hotmail-manager.js', 'utf8');
  const windowObject = {
    SidepanelAccountPoolUi: createAccountPoolUiStub(),
  };
  const localStorageMock = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  const api = new Function('window', 'localStorage', `${source}; return window.SidepanelHotmailManager;`)(
    windowObject,
    localStorageMock
  );

  const handlers = {};
  const toastMessages = [];
  const accounts = [
    { id: 'pending-1', email: 'pending-1@hotmail.com', status: 'pending', used: false, refreshToken: 'rt-1' },
  ];
  const stateStore = {
    hotmailServiceMode: 'local',
    hotmailAccounts: accounts,
    currentHotmailAccountId: null,
  };
  let resolveBatch = null;
  const sentTypes = [];
  const batchButton = {
    textContent: '',
    disabled: false,
    hidden: true,
    addEventListener(type, handler) {
      if (type === 'click') handlers.batchVerify = handler;
    },
  };

  const manager = api.createHotmailManager({
    state: {
      getLatestState: () => stateStore,
      syncLatestState(updates) {
        Object.assign(stateStore, updates);
      },
    },
    dom: {
      btnAddHotmailAccount: { textContent: '', disabled: false, addEventListener() {} },
      btnBatchVerifyHotmailAccounts: batchButton,
      btnClearUsedHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnDeleteAllHotmailAccounts: { textContent: '', disabled: false, addEventListener() {} },
      btnHotmailUsageGuide: { addEventListener() {} },
      btnImportHotmailAccounts: { disabled: false, addEventListener() {} },
      btnToggleHotmailForm: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      btnToggleHotmailList: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      hotmailAccountsList: { innerHTML: '', addEventListener() {} },
      hotmailFormShell: { hidden: true },
      hotmailListShell: { classList: { toggle() {} } },
      inputEmail: { value: '' },
      inputHotmailClientId: { value: '' },
      inputHotmailEmail: { value: '', focus() {} },
      inputHotmailImport: { value: '' },
      inputHotmailPassword: { value: '' },
      inputHotmailRefreshToken: { value: '' },
      selectMailProvider: { value: 'hotmail-api' },
    },
    helpers: {
      getHotmailAccounts: () => stateStore.hotmailAccounts,
      getCurrentHotmailEmail: () => '',
      escapeHtml: (value) => String(value || ''),
      showToast(message) {
        toastMessages.push(message);
      },
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: (message) => {
        sentTypes.push(message.type);
        if (message.type === 'BATCH_VERIFY_HOTMAIL_ACCOUNTS') {
          return new Promise((resolve) => {
            resolveBatch = resolve;
          });
        }
        if (message.type === 'STOP_HOTMAIL_BATCH_VERIFY') {
          return Promise.resolve({ ok: true, stopping: true });
        }
        return Promise.resolve({});
      },
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-hotmail-list-expanded',
    },
    hotmailUtils: {
      isPendingHotmailAccount(account) {
        return Boolean(account)
          && account.status === 'pending'
          && !account.used
          && Boolean(account.refreshToken);
      },
      normalizeHotmailServiceMode(value) {
        return value === 'remote' ? 'remote' : 'local';
      },
    },
  });

  manager.bindHotmailEvents();
  manager.renderHotmailAccounts();

  const startPromise = handlers.batchVerify();
  await Promise.resolve();

  assert.equal(batchButton.textContent, '停止');
  assert.equal(batchButton.disabled, false);

  await handlers.batchVerify();

  assert.equal(batchButton.textContent, '停止中...');
  assert.equal(batchButton.disabled, true);
  assert.deepEqual(sentTypes, ['BATCH_VERIFY_HOTMAIL_ACCOUNTS', 'STOP_HOTMAIL_BATCH_VERIFY']);
  assert.match(toastMessages.at(-1) || '', /正在停止 Hotmail 批量校验/);

  resolveBatch({
    ok: true,
    stopped: true,
    verifiedCount: 0,
    failedCount: 0,
    skippedCount: 1,
  });
  await startPromise;

  assert.equal(batchButton.textContent, '批量校验（1）');
  assert.equal(batchButton.disabled, false);
  assert.match(toastMessages.at(-1) || '', /批量校验已停止：成功 0 个，失败 0 个，未处理 1 个/);
});
