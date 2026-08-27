const KEYS = {
  FRIENDS: "friendlistRehabFriends",
  SETTINGS: "friendlistRehabSettings"
};

const XP_PER_SCAN = 10;
const XP_PER_REVIEW = 25;
const XP_PER_UNFRIEND = 50;
const LEVEL_XP = [0, 50, 150, 350, 600, 1000, 1600, 2500, 4000, 6000, 9999999];

const scanBtn = document.getElementById("scanBtn");
const dashBtn = document.getElementById("dashBtn");
const watchToggle = document.getElementById("watchToggle");
const cancelBtn = document.getElementById("cancelBtn");
const progressWrap = document.getElementById("progressWrap");
const progressMsg = document.getElementById("progressMsg");
const progressFill = document.getElementById("progressFill");
const progressCount = document.getElementById("progressCount");
const pageNotice = document.getElementById("pageNotice");
const guideSection = document.getElementById("guideSection");
const scanSection = document.getElementById("scanSection");
const guideIcon = document.getElementById("guideIcon");
const guideTitle = document.getElementById("guideTitle");
const guideDesc = document.getElementById("guideDesc");
const guideSteps = document.getElementById("guideSteps");
const guideNote = document.getElementById("guideNote");
const navBtn = document.getElementById("navBtn");
const navBtnText = document.getElementById("navBtnText");
const statSection = document.getElementById("statSection");

let polling = null;
let activeScanTabId = null;

function getLevel(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) {
    if (xp >= LEVEL_XP[i]) lvl = i + 1;
    else break;
  }
  return Math.min(lvl, 10);
}

function xpForNext(lvl) {
  return LEVEL_XP[Math.min(lvl, LEVEL_XP.length - 1)];
}

function xpForPrev(lvl) {
  return LEVEL_XP[Math.max(0, lvl - 2)] || 0;
}

async function getXp() {
  const d = await chrome.storage.local.get(["friendlistRehabXp"]);
  return d.friendlistRehabXp || 0;
}

async function addXp(amount) {
  const current = await getXp();
  const newTotal = current + amount;
  await chrome.storage.local.set({ friendlistRehabXp: newTotal });
  renderXp(newTotal);
  return newTotal;
}

function renderXp(xp) {
  const lvl = getLevel(xp);
  const next = xpForNext(lvl);
  const prev = xpForPrev(lvl);
  const inLevel = xp - prev;
  const needed = next - prev;

  document.getElementById("xpLevel").textContent = `Lvl ${lvl}`;
  document.getElementById("xpText").textContent = `${xp} XP`;

  const badge = document.getElementById("xpBadge");
  badge.classList.remove("pop");
  void badge.offsetWidth;
  badge.classList.add("pop");
}

async function activeFacebookTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isFacebookUrl(tab.url || "")) return null;
  return tab;
}

function isFacebookUrl(rawUrl) {
  try {
    return /(^|\.)facebook\.com$/i.test(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

function isFriendsUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return false;
    if (url.searchParams.get("sk")?.toLowerCase() === "friends") return true;
    return /(?:^|\/)friends(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function refreshStats() {
  const data = await chrome.storage.local.get([KEYS.FRIENDS, KEYS.SETTINGS]);
  const friends = data[KEYS.FRIENDS] || [];
  const counts = friends.reduce((acc, f) => {
    acc.total++;
    if (f.status === "KEEP") acc.keep++;
    if (f.status === "REVIEW") acc.review++;
    if (f.status === "LIKELY_INACTIVE") acc.inactive++;
    return acc;
  }, { total: 0, keep: 0, review: 0, inactive: 0 });

  document.getElementById("totalCount").textContent = counts.total;
  document.querySelectorAll('[data-count="keep"]').forEach((node) => { node.textContent = counts.keep; });
  document.querySelectorAll('[data-count="review"]').forEach((node) => { node.textContent = counts.review; });
  document.querySelectorAll('[data-count="inactive"]').forEach((node) => { node.textContent = counts.inactive; });

  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (Math.min(counts.total / 500, 1) * circumference);
  document.getElementById("progressRing").style.strokeDashoffset = offset;

  document.getElementById("dryBadge").innerHTML =
    `<span class="footer-dot"></span>Dry Run: ${(data[KEYS.SETTINGS]?.dryRun ?? true) ? "ON" : "OFF"}`;
}

async function sendToActive(message) {
  const tab = await activeFacebookTab();
  if (!tab) return { ok: false, error: "Open Facebook in the active tab first." };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (response != null) return response;
  } catch {}

  try {
    const ensured = await chrome.runtime.sendMessage({
      type: "ENSURE_CONTENT_SCRIPT",
      tabId: tab.id
    });
    if (ensured?.ok) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, message);
        if (response != null) return response;
      } catch {}
    }
  } catch {}

  return { ok: false, error: "Could not connect to the Facebook tab. Reload the page and try again." };
}

function showProgress(show) {
  progressWrap.classList.toggle("hidden", !show);
}

function updateProgress(data) {
  if (data.message) progressMsg.textContent = data.message;
  if (data.scanned != null) {
    const dt = data.displayedTotal;
    progressCount.textContent = dt
      ? `${data.scanned} / ${dt} friends`
      : `${data.scanned} found`;
    const pct = dt
      ? Math.min(95, (data.scanned / dt) * 100)
      : Math.min(95, 10 + data.scanned * .3);
    progressFill.style.width = pct + "%";
  }
}

function startPolling(tabId = activeScanTabId) {
  stopPolling();
  activeScanTabId = tabId;
  polling = setInterval(async () => {
    const d = await chrome.storage.session.get(["scrollProgress"]);
    const p = d.scrollProgress;
    if (!p || (p.tabId != null && p.tabId !== activeScanTabId)) return;

    if (p.phase === "complete") {
      stopPolling();
      showProgress(false);
      await onScanComplete(p.scanned || 0, p.displayedTotal);
      return;
    }

    if (p.phase === "error") {
      stopPolling();
      showProgress(false);
      pageNotice.textContent = p.message || "Scan stopped unexpectedly.";
      pageNotice.className = "error";
      setScanBtnReady(true);
      return;
    }

    if (p.phase === "cancelled") {
      stopPolling();
      showProgress(false);
      pageNotice.textContent = "Scan cancelled.";
      pageNotice.className = "";
      setScanBtnReady(true);
      return;
    }

    if (Date.now() - p.timestamp > 15000) return;
    updateProgress(p);
  }, 800);
}

function stopPolling() {
  if (polling) clearInterval(polling);
  polling = null;
}

async function onScanComplete(count, displayedTotal) {
  const pct = displayedTotal ? `${count}/${displayedTotal}` : count;
  pageNotice.textContent = `Found ${pct} friends. Nice work!`;
  pageNotice.className = "success";
  await refreshStats();
  const xp = await addXp(XP_PER_SCAN);
  setScanBtnReady(true);

  if (typeof fireConfetti === "function") fireConfetti(100);

  if (count >= 100) showAchievement("\ud83c\udfc6", "Century Collector \u2014 100+ friends found!");
  else if (count >= 50) showAchievement("\u2b50", "Half Century \u2014 50+ friends scanned!");
  else showAchievement("\u2705", `+${XP_PER_SCAN} XP earned!`);
}

function setScanBtnReady(ready) {
  scanBtn.disabled = !ready;
  scanBtn.innerHTML = ready
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>Scan all friends</span>`
    : `<span class="spinner"></span><span>Scanning...</span>`;
}

scanBtn.addEventListener("click", async () => {
  await beginScan();
});

async function beginScan() {
  setScanBtnReady(false);
  showProgress(true);
  progressMsg.textContent = "Auto-scrolling to find all friends...";
  progressCount.textContent = "Starting...";

  const tab = await activeFacebookTab();
  if (!tab) {
    showProgress(false);
    pageNotice.textContent = "Open Facebook in the active tab first.";
    pageNotice.className = "error";
    setScanBtnReady(true);
    return;
  }

  activeScanTabId = tab.id;
  await chrome.storage.session.remove(["scrollProgress"]);

  const result = await sendToActive({ type: "AUTO_SCROLL_SCAN" });
  if (!result?.ok) {
    stopPolling();
    showProgress(false);
    pageNotice.textContent = result?.error || "Scan failed.";
    pageNotice.className = "error";
    setScanBtnReady(true);
    return;
  }

  pageNotice.textContent = result.alreadyRunning ? "Scan in progress..." : "Scanning your friends list now...";
  pageNotice.className = "success";
  startPolling(tab.id);
}

cancelBtn.addEventListener("click", async () => {
  await sendToActive({ type: "CANCEL_AUTO_SCROLL" });
  stopPolling();
  showProgress(false);
  pageNotice.textContent = "Scan cancelled.";
  pageNotice.className = "";
  setScanBtnReady(true);
});

dashBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
});

watchToggle.addEventListener("change", async () => {
  const type = watchToggle.checked ? "START_WATCH" : "STOP_WATCH";
  const r = await sendToActive({ type });
  if (!r?.ok) {
    watchToggle.checked = false;
    pageNotice.textContent = r?.error || "Could not start auto-scan.";
    pageNotice.className = "error";
  }
});

document.querySelectorAll(".stat-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  });
});

navBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const url = (tab?.url || "");
    if (isFacebookUrl(url)) {
      if (!isFriendsUrl(url)) {
        chrome.tabs.update(tab.id, { url: "https://www.facebook.com/feanneLM/friends" });
      }
    } else {
      chrome.tabs.create({ url: "https://www.facebook.com/feanneLM/friends" });
    }
    window.close();
  });
});

function showGuide(type) {
  guideSection.classList.remove("hidden");
  scanSection.classList.add("hidden");
  statSection.classList.remove("hidden");

  if (type === "not-facebook") {
    guideIcon.className = "guide-icon warning";
    guideIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    guideTitle.textContent = "Not on Facebook yet";
    guideDesc.textContent = "Open Facebook and navigate to your Friends page to start scanning.";
    guideSteps.innerHTML = `
      <div class="step"><span class="step-num">1</span><span>Go to <b>facebook.com</b></span></div>
      <div class="step"><span class="step-num">2</span><span>Click your <b>profile picture</b> or <b>Friends</b></span></div>
      <div class="step"><span class="step-num">3</span><span>Select <b>Friends</b> from the menu</span></div>`;
    guideNote.textContent = "The extension scans automatically once you're on the right page.";
    navBtnText.textContent = "Open Facebook";
  } else if (type === "not-friends") {
    guideIcon.className = "guide-icon";
    guideIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    guideTitle.textContent = "Almost there!";
    guideDesc.textContent = "You're on Facebook, but not on the Friends page. Navigate there to start scanning.";
    guideSteps.innerHTML = `
      <div class="step"><span class="step-num">1</span><span>Find <b>Friends</b> in the left sidebar</span></div>
      <div class="step"><span class="step-num">2</span><span>Or click <b>your profile</b> &rarr; <b>Friends</b> tab</span></div>
      <div class="step"><span class="step-num">3</span><span>The scan starts automatically</span></div>`;
    guideNote.textContent = "No manual scrolling needed — the extension handles everything.";
    navBtnText.textContent = "Go to Friends page";
  }
}

function showScanUI() {
  guideSection.classList.add("hidden");
  statSection.classList.add("hidden");
  scanSection.classList.remove("hidden");
}

(async () => {
  const tab = await activeFacebookTab();

  if (!tab) {
    showGuide("not-facebook");
    await refreshStats();
    renderXp(await getXp());
    return;
  }

  const url = tab.url || "";
  const isFriendsPage = isFriendsUrl(url);
  const isFacebook = isFacebookUrl(url);

  if (!isFacebook) {
    showGuide("not-facebook");
    await refreshStats();
    renderXp(await getXp());
    return;
  }

  if (!isFriendsPage) {
    showGuide("not-friends");
    await refreshStats();
    renderXp(await getXp());
    return;
  }

  showScanUI();
  activeScanTabId = tab.id;
  const scannerStatus = await sendToActive({ type: "PING" });
  if (scannerStatus?.ok) watchToggle.checked = Boolean(scannerStatus.watching);

  const d = await chrome.storage.session.get(["scrollProgress"]);
  const p = d.scrollProgress;
  const isCurrentTabProgress = p && (p.tabId == null || p.tabId === tab.id);
  if (isCurrentTabProgress && p.phase === "scanning" && Date.now() - p.timestamp < 15000) {
    pageNotice.textContent = "Scan in progress...";
    pageNotice.className = "success";
    showProgress(true);
    updateProgress(p);
    setScanBtnReady(false);
    startPolling(tab.id);
  } else if (isCurrentTabProgress && p.phase === "complete") {
    pageNotice.textContent = `Last scan found ${p.scanned || 0} friends.`;
    pageNotice.className = "success";
  } else {
    await beginScan();
  }

  await refreshStats();
  renderXp(await getXp());
})();
