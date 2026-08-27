(() => {
  const root = globalThis.FriendListRehab;
  if (!root) return;

  const { STORAGE_KEYS, DEFAULT_SETTINGS } = root;
  const utils = root.facebookUtils;

  try { globalThis.__frRehabCleanup?.(); } catch {}

  const scannedIds = new Set();
  let scrollActive = false;
  let abortController = null;
  let scanTask = null;

  function safeText(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function smallestUsefulCard(anchor) {
    let node = anchor;
    let best = anchor.parentElement;
    for (let i = 0; i < 7 && node?.parentElement; i += 1) {
      node = node.parentElement;
      const text = safeText(node);
      if (text.length >= 3 && text.length <= 700) best = node;
      if (/mutual\s+friends?/i.test(text) && text.length <= 700) return node;
    }
    return best;
  }

  function extractFriendFromAnchor(anchor) {
    const profileUrl = utils.normalizeProfileUrl(anchor.href);
    if (!profileUrl) return null;
    const name = (anchor.textContent || anchor.getAttribute("aria-label") || "").trim();
    if (!name || name.length > 100) return null;
    const card = smallestUsefulCard(anchor);
    const cardText = safeText(card);
    return {
      id: profileUrl,
      name,
      profileUrl,
      profileImage: card?.querySelector("img")?.src || anchor.querySelector("img")?.src || "",
      mutualFriends: utils.parseMutualCount(cardText),
      activeNow: utils.textHasActiveNow(cardText),
      recentlyActive: utils.textHasRecentlyActive(cardText),
      lastVisibleActivity: null,
      lastVisibleActivityMonths: null,
      recentProfileActivity: null,
      visibility: "UNKNOWN",
      noRecentProfileUpdate: null,
      sparseProfile: null,
      noRecentVisiblePosts: null,
      appearsDormant: null,
      inactiveScore: 0,
      status: "REVIEW",
      reasons: [],
      protected: false,
      selected: false,
      scannedAt: new Date().toISOString()
    };
  }

  function scanDOMForNew() {
    const main = document.querySelector('[role="main"]') || document.body;
    const anchors = [...main.querySelectorAll('a[href]')];
    const found = new Map();
    for (const anchor of anchors) {
      const friend = extractFriendFromAnchor(anchor);
      if (!friend || scannedIds.has(friend.profileUrl)) continue;
      if (!found.has(friend.profileUrl)) found.set(friend.profileUrl, friend);
    }
    return found;
  }

  function scanAllDOM() {
    const main = document.querySelector('[role="main"]') || document.body;
    const anchors = [...main.querySelectorAll('a[href]')];
    const found = new Map();
    for (const anchor of anchors) {
      const friend = extractFriendFromAnchor(anchor);
      if (!friend) continue;
      if (!found.has(friend.profileUrl)) found.set(friend.profileUrl, friend);
    }
    return found;
  }

  async function loadState() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.FRIENDS, STORAGE_KEYS.SETTINGS, STORAGE_KEYS.PROTECTED
    ]);
    return {
      friends: data[STORAGE_KEYS.FRIENDS] || [],
      settings: { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) },
      protectedIds: new Set(data[STORAGE_KEYS.PROTECTED] || [])
    };
  }

  async function mergeAndStore(friendsMap) {
    const state = await loadState();
    const existing = new Map(state.friends.map((f) => [f.id, f]));
    for (const [id, friend] of friendsMap) {
      const prev = existing.get(id);
      const merged = { ...prev, ...friend };
      merged.protected = state.protectedIds.has(id) || Boolean(prev?.protected);
      merged.selected = Boolean(prev?.selected);
      const evaluation = root.evaluateFriend(merged, state.settings);
      merged.status = evaluation.status;
      merged.inactiveScore = evaluation.score;
      merged.reasons = evaluation.reasons;
      merged.protectedFromRemoval = evaluation.protectedFromRemoval;
      existing.set(id, merged);
    }
    const result = [...existing.values()];
    await chrome.storage.local.set({
      [STORAGE_KEYS.FRIENDS]: result,
      [STORAGE_KEYS.SCAN_META]: {
        scannedAt: new Date().toISOString(),
        loadedCount: friendsMap.size,
        totalStored: result.length,
        sourceUrl: location.href
      }
    });
    return result.length;
  }

  async function broadcastProgress(progress) {
    try {
      await chrome.runtime.sendMessage({ type: "SCROLL_PROGRESS", ...progress });
    } catch {}
  }

  function getDisplayedFriendCount() {
    const body = document.body?.innerText || "";
    const match = body.match(/(\d[\d,]*)\s+friends/i);
    if (match) {
      const n = parseInt(match[1].replace(/,/g, ""), 10);
      if (Number.isFinite(n) && n > 0 && n < 50000) return n;
    }
    return null;
  }

  function getScrollContainer() {
    const main = document.querySelector('[role="main"]');
    if (!main) return document.documentElement;
    let el = main;
    while (el && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 50) return el;
      el = el.parentElement;
    }
    return document.documentElement;
  }

  function clickLoadMore() {
    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      const t = safeText(btn).toLowerCase();
      if (t === "see more friends" || t === "see more" || t === "load more" || t === "show more") {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function autoScrollScan() {
    if (scrollActive) return { ok: true, alreadyRunning: true };

    scrollActive = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    const stored = (await chrome.storage.local.get([STORAGE_KEYS.FRIENDS]))[STORAGE_KEYS.FRIENDS] || [];
    for (const f of stored) scannedIds.add(f.id);

    const container = getScrollContainer();
    const displayedTotal = getDisplayedFriendCount();

    await broadcastProgress({
      phase: "scanning",
      message: displayedTotal ? `Found ${displayedTotal} friends. Scanning...` : "Starting auto-scan...",
      scanned: scannedIds.size,
      displayedTotal
    });

    let prevCount = scannedIds.size;
    let stableRounds = 0;
    let round = 0;

    try {
      while (round < 600) {
        if (signal.aborted) break;
        round++;

        clickLoadMore();
        await sleep(300);

        for (let s = 0; s < 3; s++) {
          if (signal.aborted) break;
          container.scrollTop = container.scrollHeight;
          document.documentElement.scrollTop = document.documentElement.scrollHeight;
          await sleep(600);
        }
        if (signal.aborted) break;
        await sleep(1200);
        if (signal.aborted) break;

        const newFriends = scanDOMForNew();
        for (const [id] of newFriends) scannedIds.add(id);

        if (newFriends.size > 0) {
          await mergeAndStore(newFriends);
        }

        const current = scannedIds.size;
        const dt = displayedTotal || getDisplayedFriendCount();

        if (dt && current >= dt) {
          await broadcastProgress({
            phase: "scanning",
            message: `Done! Found all ${current} friends.`,
            scanned: current, displayedTotal: dt
          });
          break;
        }

        await broadcastProgress({
          phase: "scanning",
          message: newFriends.size > 0
            ? `Found ${newFriends.size} new friends... (${current}${dt ? "/" + dt : ""} total)`
            : `Looking for more... (${current}${dt ? "/" + dt : ""} so far)`,
          scanned: current,
          displayedTotal: dt,
          newSinceLast: newFriends.size
        });

        if (current === prevCount) stableRounds++;
        else stableRounds = 0;
        prevCount = current;

        if (stableRounds >= 10) break;
      }
    } catch (err) {
      if (err.name === "AbortError") {
        scrollActive = false;
        return { ok: false, error: "Scan was cancelled." };
      }
    }

    const finalAll = scanAllDOM();
    for (const [id] of finalAll) scannedIds.add(id);
    const totalStored = await mergeAndStore(finalAll);
    const dt = displayedTotal || getDisplayedFriendCount();

    await broadcastProgress({
      phase: "complete",
      message: `Scan complete. ${scannedIds.size} friends found, ${totalStored} stored.`,
      scanned: scannedIds.size,
      displayedTotal: dt
    });

    scrollActive = false;
    abortController = null;
    scanTask = null;

    return { ok: true, loadedCount: scannedIds.size, totalStored, displayedTotal: dt };
  }

  async function scanLoadedFriends() {
    if (!utils.isFriendsPage()) return { ok: false, error: "Open your Facebook Friends page first." };
    chrome.runtime.sendMessage({ type: "REGISTER_FRIENDS_TAB" }).catch(() => {});
    const all = scanAllDOM();
    for (const [id] of all) scannedIds.add(id);
    const totalStored = await mergeAndStore(all);
    return { ok: true, loadedCount: all.size, totalStored };
  }

  function startAutoScan() {
    if (scanTask || scrollActive) return { ok: true, started: false, alreadyRunning: true };
    scanTask = autoScrollScan().catch(() => { scrollActive = false; scanTask = null; });
    return { ok: true, started: true };
  }

  function cancelAutoScan() {
    if (abortController) abortController.abort();
    scrollActive = false;
    return { ok: true };
  }

  function handleMessage(message, _sender, sendResponse) {
    if (message?.type === "PING") {
      sendResponse({ ok: true, isFriendsPage: utils.isFriendsPage(), scanning: scrollActive });
      return false;
    }
    if (message?.type === "SCAN_LOADED_FRIENDS") {
      scanLoadedFriends().then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (message?.type === "AUTO_SCROLL_SCAN") {
      sendResponse(startAutoScan());
      return false;
    }
    if (message?.type === "CANCEL_AUTO_SCROLL") {
      sendResponse(cancelAutoScan());
      return false;
    }
    if (message?.type === "SCROLL_STATUS") {
      sendResponse({ active: scrollActive });
      return false;
    }
    if (message?.type === "ATTEMPT_UNFRIEND") {
      sendResponse({ ok: false, error: "Unfriend not implemented in this version." });
      return false;
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage);

  if (utils.isFriendsPage()) {
    chrome.runtime.sendMessage({ type: "REGISTER_FRIENDS_TAB" }).catch(() => {});
    setTimeout(startAutoScan, 2000);
  }

  globalThis.__frRehabCleanup = () => {
    if (abortController) abortController.abort();
    scrollActive = false;
    scanTask = null;
    try { chrome.runtime.onMessage.removeListener(handleMessage); } catch {}
    globalThis.__frRehabCleanup = null;
  };
})();
