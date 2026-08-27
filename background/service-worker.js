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

async function injectContentScript(tabId) {
  const files = [
    "lib/constants.js",
    "lib/scoring.js",
    "lib/facebook-utils.js",
    "content/facebook-scanner.js"
  ];
  const css = ["content/content.css"];

  for (const file of files) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] })
      .catch(() => {});
  }
  for (const file of css) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: [file] })
      .catch(() => {});
  }
}

async function ensureConnection(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (resp?.ok) return { ok: true };
  } catch {
    try {
      await injectContentScript(tabId);
      const resp = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (resp?.ok) return { ok: true };
    } catch {}
  }
  return { ok: false, error: "Could not connect to the Facebook tab. Make sure you are on Facebook and reload the page." };
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

  if (message?.type === "ENSURE_CONNECTION" && Number.isInteger(message.tabId)) {
    ensureConnection(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SCROLL_PROGRESS") {
    chrome.storage.session.set({
      scrollProgress: {
        phase: message.phase,
        message: message.message,
        scanned: message.scanned,
        displayedTotal: message.displayedTotal,
        newSinceLast: message.newSinceLast,
        round: message.round,
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

      if (tabId) {
        try {
          const result = await chrome.tabs.sendMessage(tabId, message.payload);
          sendResponse({ ok: true, result });
          return;
        } catch {
          const conn = await ensureConnection(tabId);
          if (conn.ok) {
            try {
              const result = await chrome.tabs.sendMessage(tabId, message.payload);
              sendResponse({ ok: true, result });
              return;
            } catch {}
          }
        }
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab found." });
        return;
      }

      const conn = await ensureConnection(tab.id);
      if (!conn.ok) {
        sendResponse({ ok: false, error: conn.error });
        return;
      }

      try {
        await chrome.storage.session.set({ [SOURCE_TAB_KEY]: tab.id });
        const result = await chrome.tabs.sendMessage(tab.id, message.payload);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
});
