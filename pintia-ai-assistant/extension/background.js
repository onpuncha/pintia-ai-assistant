const DEFAULTS = {
  mode: 'diagnostic',
  apiBaseUrl: 'http://127.0.0.1:8787',
  model: 'deepseek-chat',
  autoSaveAndNavigate: false,
  overwriteExisting: true,
  pauseAfterSaveMs: 1200
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({ ...DEFAULTS, ...current });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'get-config') {
    chrome.storage.local.get(DEFAULTS).then(config => {
      // 旧版本曾把 deepseek-flash 写入本地设置；官方兼容接口改用 deepseek-chat。
      if (config.model === 'deepseek-flash') {
        config.model = 'deepseek-chat';
        chrome.storage.local.set({ model: config.model });
      }
      sendResponse(config);
    });
    return true;
  }
  if (message?.type === 'save-config') {
    chrome.storage.local.set(message.config).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'server-health') {
    fetch(`${message.baseUrl || DEFAULTS.apiBaseUrl}/health`)
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
