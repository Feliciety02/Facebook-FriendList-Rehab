(() => {
  const root = globalThis.FriendListRehab;
  if (!root) return;

  const { STORAGE_KEYS, DEFAULT_SETTINGS } = root;
  const utils = root.facebookUtils;
  let watchObserver = null;
  let watchEnabled = false;

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

  async function scanLoadedFriends() {
    if (!utils.isFriendsPage()) {
      return { ok: false, error: "Open your Facebook Friends page first." };
    }

    await chrome.runtime.sendMessage({ type: "REGISTER_FRIENDS_TAB" }).catch(() => {});

    const main = document.querySelector('[role="main"]') || document.body;
    const anchors = [...main.querySelectorAll('a[href]')];
    const found = new Map();

    for (const anchor of anchors) {
      const friend = extractFriendFromAnchor(anchor);
      if (!friend) continue;
      if (!found.has(friend.profileUrl)) found.set(friend.profileUrl, friend);
    }

    const state = await loadState();
    const existing = new Map(state.friends.map((friend) => [friend.id, friend]));

    for (const [id, friend] of found) {
      const merged = { ...existing.get(id), ...friend };
      merged.protected = state.protectedIds.has(id) || Boolean(existing.get(id)?.protected);
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
        loadedCount: found.size,
        totalStored: result.length,
        sourceUrl: location.href
      }
    });

    return {
      ok: true,
      loadedCount: found.size,
      totalStored: result.length
    };
  }

  function startWatch() {
    if (watchObserver) return;
    watchEnabled = true;
    let debounce;
    watchObserver = new MutationObserver(() => {
      if (!watchEnabled) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => scanLoadedFriends().catch(() => {}), 900);
    });
    watchObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopWatch() {
    watchEnabled = false;
    watchObserver?.disconnect();
    watchObserver = null;
  }

  function normalize(url) {
    return utils.normalizeProfileUrl(url);
  }

  function findFriendCardByUrl(profileUrl) {
    const target = normalize(profileUrl);
    if (!target) return null;
    const anchors = [...document.querySelectorAll('a[href]')];
    for (const anchor of anchors) {
      if (normalize(anchor.href) === target) return smallestUsefulCard(anchor);
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
    if (!card) return { ok: false, code: "NOT_LOADED", error: "This friend is not currently loaded on the page. Scroll until the card is visible and try again." };

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

    if (!unfriendAction) return { ok: false, code: "UNFRIEND_NOT_FOUND", error: "Unfriend action was not found. Facebook may have changed its layout." };
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
      // Some Facebook variants remove immediately after choosing Unfriend.
      return { ok: true, uncertain: true, message: "Unfriend action was clicked; no confirmation dialog appeared." };
    }

    if (utils.isSecurityOrChallengeVisible()) return { ok: false, code: "SECURITY", error: "Facebook security UI appeared. Processing stopped." };
    confirm.click();
    return { ok: true, message: "Unfriend action confirmed." };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCAN_LOADED_FRIENDS") {
      scanLoadedFriends().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "START_WATCH") {
      startWatch();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "STOP_WATCH") {
      stopWatch();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "ATTEMPT_UNFRIEND") {
      attemptUnfriend(message.profileUrl, message.friend || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  });

  if (utils.isFriendsPage()) {
    chrome.runtime.sendMessage({ type: "REGISTER_FRIENDS_TAB" }).catch(() => {});
  }
})();
