(() => {
  const root = globalThis.FriendListRehab;
  if (!root) return;

  // An extension reload can leave this isolated page world alive while its old
  // runtime listener is disconnected. Tear down any prior instance and attach
  // a fresh listener instead of trusting a permanent "loaded" boolean.
  try {
    globalThis.__friendListRehabScannerCleanup?.();
  } catch {}

  const { STORAGE_KEYS, DEFAULT_SETTINGS } = root;
  const utils = root.facebookUtils;
  let scrollActive = false;
  let abortController = null;
  let scanTask = null;
  let watchObserver = null;
  let watchTimer = null;
  let autoStartTimer = null;
  let navigationInterval = null;
  let lastUrl = location.href;
  const scannedIds = new Set();

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
    const mutualFriends = utils.parseMutualCount(cardText);
    const activeNow = utils.textHasActiveNow(cardText);
    const recentlyActive = utils.textHasRecentlyActive(cardText);
    const image = card?.querySelector("img")?.src || anchor.querySelector("img")?.src || "";

    return {
      id: profileUrl,
      name,
      profileUrl,
      profileImage: image,
      mutualFriends,
      activeNow,
      recentlyActive,
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

  async function loadState() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.FRIENDS,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.PROTECTED
    ]);
    return {
      friends: data[STORAGE_KEYS.FRIENDS] || [],
      settings: { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) },
      protectedIds: new Set(data[STORAGE_KEYS.PROTECTED] || [])
    };
  }

  function scanDOMForNew() {
    const main = document.querySelector('[role="main"]') || document.body;
    const anchors = [...main.querySelectorAll('a[href]')];
    const newFriends = new Map();

    for (const anchor of anchors) {
      const friend = extractFriendFromAnchor(anchor);
      if (!friend) continue;
      if (scannedIds.has(friend.profileUrl)) continue;
      if (!newFriends.has(friend.profileUrl)) newFriends.set(friend.profileUrl, friend);
    }

    return newFriends;
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

  async function scanLoadedFriends() {
    if (!utils.isFriendsPage()) {
      return { ok: false, error: "Open your Facebook Friends page first." };
    }

    await chrome.runtime.sendMessage({ type: "REGISTER_FRIENDS_TAB" }).catch(() => {});

    const allDOM = scanAllDOM();
    scannedIds.clear();
    for (const id of allDOM.keys()) scannedIds.add(id);

    const totalStored = await mergeAndStore(allDOM);

    return {
      ok: true,
      loadedCount: allDOM.size,
      totalStored
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getScrollContainer() {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;
    let el = main;
    while (el && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if (style.overflow === "auto" || style.overflow === "scroll" ||
          style.overflowY === "auto" || style.overflowY === "scroll") {
        if (el.scrollHeight > el.clientHeight + 50) return el;
      }
      el = el.parentElement;
    }
    return document.documentElement;
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

  function clickLoadMore() {
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    for (const btn of buttons) {
      const text = safeText(btn).toLowerCase();
      if (text === "see more friends" || text === "see more" || text === "load more" ||
          text === "view more" || text === "show more") {
        btn.click();
        return true;
      }
    }
    return false;
  }

  async function broadcastProgress(progress) {
    try {
      await chrome.runtime.sendMessage({ type: "SCROLL_PROGRESS", ...progress });
    } catch {}
  }

  async function autoScrollScan() {
    if (!utils.isFriendsPage()) {
      return { ok: false, error: "Open your Facebook Friends page first." };
    }

    if (scrollActive) {
      return { ok: false, error: "Scan already in progress." };
    }

    await chrome.runtime.sendMessage({ type: "REGISTER_FRIENDS_TAB" }).catch(() => {});
    if (!utils.isFriendsPage()) {
      return { ok: false, error: "The Friends page was left before scanning could start." };
    }

    scrollActive = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    // Count this page's scan independently from previously stored friends.
    // Otherwise an old stored total can make a new scan stop immediately.
    scannedIds.clear();
    const initiallyVisible = scanAllDOM();
    for (const id of initiallyVisible.keys()) scannedIds.add(id);
    if (initiallyVisible.size > 0) await mergeAndStore(initiallyVisible);

    const container = await waitFor(() => getScrollContainer(), 10000);
    if (!container) {
      scrollActive = false;
      return { ok: false, error: "The Friends list did not finish loading. Open the list and try again." };
    }

    const displayedTotal = getDisplayedFriendCount();

    await broadcastProgress({
      phase: "scanning",
      message: displayedTotal
        ? `Found ${displayedTotal} friends on page. Scanning...`
        : "Starting auto-scan...",
      scanned: scannedIds.size,
      displayedTotal,
      newSinceLast: 0
    });

    let previousCount = scannedIds.size;
    let stableRounds = 0;
    const MAX_STABLE_ROUNDS = 8;
    let round = 0;
    const MAX_ROUNDS = 600;

    try {
      while (round < MAX_ROUNDS) {
        if (signal.aborted) break;
        round++;

        clickLoadMore();
        await sleep(400);
        if (signal.aborted) break;

        for (let sub = 0; sub < 3; sub++) {
          if (signal.aborted) break;
          container.scrollTop = container.scrollHeight;
          document.documentElement.scrollTop = document.documentElement.scrollHeight;
          await sleep(800);
        }

        if (signal.aborted) break;
        await sleep(1500);
        if (signal.aborted) break;

        const newFriends = scanDOMForNew();
        for (const id of newFriends.keys()) scannedIds.add(id);

        const currentCount = scannedIds.size;

        if (newFriends.size > 0) {
          const merged = new Map();
          for (const [id, friend] of newFriends) merged.set(id, friend);
          await mergeAndStore(merged);
        }

        const newSinceLast = Math.max(0, currentCount - previousCount);

        let msg;
        if (displayedTotal && currentCount >= displayedTotal) {
          msg = `Done! Found all ${currentCount} friends.`;
        } else if (newSinceLast > 0) {
          msg = `Found ${newFriends.size} new friends... (${currentCount}${displayedTotal ? `/${displayedTotal}` : ""} total)`;
        } else {
          msg = `Looking for more... (${currentCount}${displayedTotal ? `/${displayedTotal}` : ""} so far)`;
        }

        await broadcastProgress({
          phase: "scanning",
          message: msg,
          scanned: currentCount,
          displayedTotal,
          newSinceLast,
          round
        });

        if (displayedTotal && currentCount >= displayedTotal) break;

        if (currentCount === previousCount) {
          stableRounds++;
        } else {
          stableRounds = 0;
        }

        previousCount = currentCount;

        if (stableRounds >= MAX_STABLE_ROUNDS) break;
      }
    } catch (err) {
      if (err.name === "AbortError") {
        scrollActive = false;
        return { ok: false, error: "Scan was cancelled." };
      }
      throw err;
    }

    if (signal.aborted) {
      await broadcastProgress({
        phase: "cancelled",
        message: "Scan cancelled.",
        scanned: scannedIds.size,
        displayedTotal,
        newSinceLast: 0
      });
      scrollActive = false;
      abortController = null;
      return { ok: false, error: "Scan was cancelled." };
    }

    const finalAll = scanAllDOM();
    for (const [id] of finalAll) scannedIds.add(id);

    const totalStored = await mergeAndStore(finalAll);

    await broadcastProgress({
      phase: "complete",
      message: `Scan complete. ${scannedIds.size} friends found, ${totalStored} stored.`,
      scanned: scannedIds.size,
      displayedTotal,
      newSinceLast: 0
    });

    scrollActive = false;
    abortController = null;

    return {
      ok: true,
      loadedCount: scannedIds.size,
      totalStored,
      displayedTotal,
      rounds: round
    };
  }

  function startAutoScrollScan() {
    if (!utils.isFriendsPage()) {
      return { ok: false, error: "Open your Facebook Friends page first." };
    }

    if (scanTask || scrollActive) {
      return { ok: true, started: false, alreadyRunning: true };
    }

    scanTask = autoScrollScan()
      .then(async (result) => {
        if (result?.ok === false && result.error !== "Scan was cancelled.") {
          await broadcastProgress({
            phase: "error",
            message: result.error,
            scanned: scannedIds.size,
            displayedTotal: getDisplayedFriendCount()
          });
        }
        return result;
      })
      .catch(async (error) => {
        await broadcastProgress({
          phase: "error",
          message: error?.message || "The scan stopped unexpectedly.",
          scanned: scannedIds.size,
          displayedTotal: getDisplayedFriendCount()
        });
      })
      .finally(() => {
        scrollActive = false;
        abortController = null;
        scanTask = null;
      });

    return { ok: true, started: true };
  }

  function cancelAutoScroll() {
    if (abortController) abortController.abort();
    scrollActive = false;
    return { ok: true };
  }

  function stopWatch() {
    watchObserver?.disconnect();
    watchObserver = null;
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = null;
    return { ok: true };
  }

  function startWatch() {
    if (!utils.isFriendsPage()) {
      return { ok: false, error: "Open your Facebook Friends page first." };
    }
    if (watchObserver) return { ok: true, alreadyWatching: true };

    watchObserver = new MutationObserver(() => {
      if (scrollActive || watchTimer) return;
      watchTimer = setTimeout(() => {
        watchTimer = null;
        if (utils.isFriendsPage() && !scrollActive) {
          scanLoadedFriends().catch(() => {});
        }
      }, 700);
    });
    watchObserver.observe(document.body, { childList: true, subtree: true });
    return { ok: true };
  }

  function scheduleAutomaticScan() {
    if (autoStartTimer) clearTimeout(autoStartTimer);
    autoStartTimer = null;

    if (!utils.isFriendsPage()) return;
    chrome.runtime.sendMessage({ type: "REGISTER_FRIENDS_TAB" }).catch(() => {});
    autoStartTimer = setTimeout(() => {
      autoStartTimer = null;
      startAutoScrollScan();
    }, 1600);
  }

  function handleFacebookNavigation() {
    if (location.href === lastUrl) return;
    const wasFriendsPage = utils.isFriendsUrl(lastUrl);
    lastUrl = location.href;
    const isFriendsPage = utils.isFriendsPage();

    if (!isFriendsPage) {
      if (wasFriendsPage) cancelAutoScroll();
      stopWatch();
      return;
    }

    scheduleAutomaticScan();
  }

  function findFriendCardByUrl(profileUrl) {
    const target = utils.normalizeProfileUrl(profileUrl);
    if (!target) return null;
    const anchors = [...document.querySelectorAll('a[href]')];
    for (const anchor of anchors) {
      if (utils.normalizeProfileUrl(anchor.href) === target) return smallestUsefulCard(anchor);
    }
    return null;
  }

  async function waitFor(predicate, timeoutMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  }

  function findClickableByText(scope, regex) {
    const candidates = [...scope.querySelectorAll('button, [role="button"], [role="menuitem"]')];
    return candidates.find((node) => regex.test(safeText(node)) || regex.test(node.getAttribute("aria-label") || ""));
  }

  async function attemptUnfriend(profileUrl, friendSnapshot = {}) {
    if (!utils.isFriendsPage()) return { ok: false, code: "WRONG_PAGE", error: "The Facebook Friends page is not open." };
    if (utils.isSecurityOrChallengeVisible()) return { ok: false, code: "SECURITY", error: "Facebook security or rate-limit UI is visible. Processing stopped." };

    const card = findFriendCardByUrl(profileUrl);
    if (!card) return { ok: false, code: "NOT_LOADED", error: "This friend is not currently loaded on the page." };

    const cardText = safeText(card);
    if (utils.textHasActiveNow(cardText) || utils.textHasRecentlyActive(cardText) || friendSnapshot.activeNow || friendSnapshot.recentlyActive) {
      return { ok: false, code: "RECENT_ACTIVITY", skipped: true, error: "Recent activity detected. Friend was skipped." };
    }

    const relationshipButton = findClickableByText(card, /^(friends|friend)$/i) ||
      findClickableByText(card, /friends/i);
    if (!relationshipButton) {
      return { ok: false, code: "BUTTON_NOT_FOUND", error: "Could not find the Friends action on this loaded card." };
    }

    relationshipButton.click();

    const unfriendAction = await waitFor(() => {
      const menus = [...document.querySelectorAll('[role="menu"], [role="dialog"], body')];
      for (const scope of menus) {
        const node = findClickableByText(scope, /^unfriend(?:\s|$)/i);
        if (node && node !== relationshipButton) return node;
      }
      return null;
    });

    if (!unfriendAction) return { ok: false, code: "UNFRIEND_NOT_FOUND", error: "Unfriend action was not found." };
    if (utils.isSecurityOrChallengeVisible()) return { ok: false, code: "SECURITY", error: "Facebook security UI appeared. Processing stopped." };

    unfriendAction.click();

    const confirm = await waitFor(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      for (const dialog of dialogs) {
        const button = findClickableByText(dialog, /^(confirm|unfriend)$/i);
        if (button) return button;
      }
      return null;
    }, 2200);

    if (!confirm) {
      return { ok: true, uncertain: true, message: "Unfriend action was clicked; no confirmation dialog appeared." };
    }

    if (utils.isSecurityOrChallengeVisible()) return { ok: false, code: "SECURITY", error: "Facebook security UI appeared. Processing stopped." };
    confirm.click();
    return { ok: true, message: "Unfriend action confirmed." };
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "PING") {
      sendResponse({
        ok: true,
        isFriendsPage: utils.isFriendsPage(),
        scanning: Boolean(scanTask || scrollActive),
        watching: Boolean(watchObserver)
      });
      return false;
    }

    if (message?.type === "SCAN_LOADED_FRIENDS") {
      scanLoadedFriends().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "AUTO_SCROLL_SCAN") {
      sendResponse(startAutoScrollScan());
      return false;
    }

    if (message?.type === "CANCEL_AUTO_SCROLL") {
      cancelAutoScroll();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "SCROLL_STATUS") {
      sendResponse({ active: Boolean(scanTask || scrollActive) });
      return false;
    }

    if (message?.type === "START_WATCH") {
      sendResponse(startWatch());
      return false;
    }

    if (message?.type === "STOP_WATCH") {
      sendResponse(stopWatch());
      return false;
    }

    if (message?.type === "ATTEMPT_UNFRIEND") {
      attemptUnfriend(message.profileUrl, message.friend || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  }

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  scheduleAutomaticScan();

  // Facebook is a single-page app, so content scripts survive route changes.
  // Watch the URL and start scanning when the user reaches any Friends route.
  navigationInterval = setInterval(handleFacebookNavigation, 750);

  globalThis.__friendListRehabScannerCleanup = () => {
    if (autoStartTimer) clearTimeout(autoStartTimer);
    if (navigationInterval) clearInterval(navigationInterval);
    stopWatch();
    cancelAutoScroll();
    try {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    } catch {}
    globalThis.__friendListRehabScannerCleanup = null;
  };
})();
