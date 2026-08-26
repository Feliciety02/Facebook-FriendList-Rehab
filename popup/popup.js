const KEYS = {
  FRIENDS: "friendlistRehabFriends",
  SETTINGS: "friendlistRehabSettings"
};

const scanButton = document.getElementById("scanButton");
const dashboardButton = document.getElementById("dashboardButton");
const watchToggle = document.getElementById("watchToggle");
const pageNotice = document.getElementById("pageNotice");

async function activeFacebookTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(www\.)?facebook\.com\//i.test(tab.url || "")) return null;
  return tab;
}

async function refreshStats() {
  const data = await chrome.storage.local.get([KEYS.FRIENDS, KEYS.SETTINGS]);
  const friends = data[KEYS.FRIENDS] || [];
  const counts = friends.reduce((acc, friend) => {
    acc.total += 1;
    if (friend.status === "KEEP") acc.keep += 1;
    if (friend.status === "REVIEW") acc.review += 1;
    if (friend.status === "LIKELY_INACTIVE") acc.inactive += 1;
    return acc;
  }, { total: 0, keep: 0, review: 0, inactive: 0 });

  document.getElementById("totalCount").textContent = counts.total;
  document.getElementById("keepCount").textContent = counts.keep;
  document.getElementById("reviewCount").textContent = counts.review;
  document.getElementById("inactiveCount").textContent = counts.inactive;
  document.getElementById("dryRunBadge").textContent = `Dry Run: ${(data[KEYS.SETTINGS]?.dryRun ?? true) ? "ON" : "OFF"}`;
}

async function sendToActive(message) {
  const tab = await activeFacebookTab();
  if (!tab) return { ok: false, error: "Open Facebook in the active tab first." };
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return { ok: false, error: "Reload Facebook once after installing the extension, then try again." };
  }
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  scanButton.textContent = "Scanning…";
  const result = await sendToActive({ type: "SCAN_LOADED_FRIENDS" });
  pageNotice.textContent = result?.ok
    ? `Found ${result.loadedCount} loaded friend cards. ${result.totalStored} stored for review.`
    : (result?.error || "Scan failed.");
  await refreshStats();
  scanButton.disabled = false;
  scanButton.textContent = "Scan loaded friends";
});

watchToggle.addEventListener("change", async () => {
  const type = watchToggle.checked ? "START_WATCH" : "STOP_WATCH";
  const result = await sendToActive({ type });
  if (!result?.ok) {
    watchToggle.checked = false;
    pageNotice.textContent = result?.error || "Could not start continuous scanning.";
  }
});

dashboardButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
});

(async () => {
  const tab = await activeFacebookTab();
  if (tab && /\/friends(?:\/|\?|$)/i.test(tab.url || "")) {
    pageNotice.textContent = "Facebook Friends page detected. Scroll normally, then scan loaded friends.";
  }
  await refreshStats();
})();
