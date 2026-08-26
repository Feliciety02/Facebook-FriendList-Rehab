const SOURCE_TAB_KEY = "friendlistRehabSourceTab";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["friendlistRehabSettings"]);
  if (!existing.friendlistRehabSettings) {
    await chrome.storage.local.set({
      friendlistRehabSettings: {
        inactiveYears: 2,
        maxMutualFriends: 5,
        inactiveScoreThreshold: 7,
        protectRecentActivity: true,
        privateProfileProtection: true,
        excludeProtected: true,
        dryRun: true,
        developerMode: false
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "REGISTER_FRIENDS_TAB" && sender.tab?.id) {
    chrome.storage.session.set({ [SOURCE_TAB_KEY]: sender.tab.id })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "SEND_TO_FRIENDS_TAB") {
    (async () => {
      const stored = await chrome.storage.session.get([SOURCE_TAB_KEY]);
      const tabId = stored[SOURCE_TAB_KEY];
      if (!tabId) {
        sendResponse({ ok: false, error: "No Facebook Friends tab has registered yet." });
        return;
      }

      try {
        const result = await chrome.tabs.sendMessage(tabId, message.payload);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
});
