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

function isFacebookUrl(url) {
  try {
    return /facebook\.com$/i.test(new URL(url).hostname) ||
      /\.facebook\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isFacebookUrl(tab.url || "")) {
    return { ok: false, error: "The active tab is not a Facebook page." };
  }

  try {
    const status = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (status?.ok) return { ok: true, injected: false };
  } catch {
    if (typeof chrome.scripting === "undefined") {
      return { ok: false, error: "scripting API not available. Reload the extension." };
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          "lib/constants.js",
          "lib/scoring.js",
          "lib/facebook-utils.js",
          "content/facebook-scanner.js"
        ]
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content/content.css"]
      }).catch(() => {});
    } catch (e) {
      return { ok: false, error: "Could not inject scripts: " + e.message };
    }
  }

  return { ok: true, injected: true };
}

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

  if (message?.type === "ENSURE_CONTENT_SCRIPT" && Number.isInteger(message.tabId)) {
    ensureContentScript(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SCROLL_PROGRESS") {
    chrome.storage.session.set({
      scrollProgress: {
        ...message,
        tabId: sender.tab?.id ?? null,
        timestamp: Date.now()
      }
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
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
      } catch {
        const ensure = await ensureContentScript(tabId).catch(() => ({ ok: false }));
        if (!ensure.ok) {
          sendResponse({ ok: false, error: "Could not connect to Facebook tab. Reload the page and try again." });
          return;
        }
        try {
          const result = await chrome.tabs.sendMessage(tabId, message.payload);
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      }
    })();
    return true;
  }
});
