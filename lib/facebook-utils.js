(() => {
  const root = globalThis.FriendListRehab = globalThis.FriendListRehab || {};

  const RESERVED_PATHS = new Set([
    "friends", "groups", "marketplace", "watch", "messages", "notifications",
    "settings", "gaming", "reel", "reels", "events", "pages", "search",
    "help", "privacy", "bookmarks", "memories", "saved", "ads", "business"
  ]);

  function normalizeProfileUrl(rawHref) {
    if (!rawHref) return null;
    try {
      const url = new URL(rawHref, location.origin);
      if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) return null;

      if (url.pathname === "/profile.php" && url.searchParams.get("id")) {
        return `https://www.facebook.com/profile.php?id=${encodeURIComponent(url.searchParams.get("id"))}`;
      }

      const first = url.pathname.split("/").filter(Boolean)[0];
      if (!first || RESERVED_PATHS.has(first.toLowerCase())) return null;
      if (first === "people" || first === "photo" || first === "photos" || first === "story.php") return null;

      return `https://www.facebook.com/${first}`;
    } catch {
      return null;
    }
  }

  function parseMutualCount(text) {
    if (!text) return null;
    const match = text.replace(/\u00a0/g, " ").match(/([\d,.]+)\s+mutual\s+friends?/i);
    if (!match) return null;
    const n = Number(match[1].replace(/[,.](?=\d{3}\b)/g, "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function textHasActiveNow(text) {
    return /\bactive\s+now\b/i.test(text || "");
  }

  function textHasRecentlyActive(text) {
    return /\bactive\s+(?:\d+\s*)?(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s+ago\b/i.test(text || "") ||
      /\brecently\s+active\b/i.test(text || "");
  }

  function isFriendsPage() {
    return /facebook\.com\/.+\/friends(?:\/|\?|$)/i.test(location.href) ||
      /facebook\.com\/friends(?:\/|\?|$)/i.test(location.href);
  }

  function isSecurityOrChallengeVisible() {
    const body = document.body?.innerText || "";
    return /security check|confirm your identity|captcha|suspicious activity|temporarily blocked|try again later/i.test(body);
  }

  root.facebookUtils = {
    normalizeProfileUrl,
    parseMutualCount,
    textHasActiveNow,
    textHasRecentlyActive,
    isFriendsPage,
    isSecurityOrChallengeVisible
  };
})();
