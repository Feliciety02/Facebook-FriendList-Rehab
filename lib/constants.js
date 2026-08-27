(() => {
  const root = globalThis.FriendListRehab = globalThis.FriendListRehab || {};

  root.DEFAULT_SETTINGS = Object.freeze({
    inactiveYears: 2,
    maxMutualFriends: 5,
    inactiveScoreThreshold: 7,
    protectRecentActivity: true,
    privateProfileProtection: true,
    excludeProtected: true,
    dryRun: true,
    autoUnfriend: false,
    developerMode: false
  });

  root.STATUS = Object.freeze({
    KEEP: "KEEP",
    REVIEW: "REVIEW",
    LIKELY_INACTIVE: "LIKELY_INACTIVE",
    PROTECTED: "PROTECTED"
  });

  root.STORAGE_KEYS = Object.freeze({
    FRIENDS: "friendlistRehabFriends",
    SETTINGS: "friendlistRehabSettings",
    HISTORY: "friendlistRehabHistory",
    PROTECTED: "friendlistRehabProtected",
    SCAN_META: "friendlistRehabScanMeta"
  });
})();
