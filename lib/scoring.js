(() => {
  const root = globalThis.FriendListRehab = globalThis.FriendListRehab || {};

  function evaluateFriend(friend, settings = {}) {
    const defaults = root.DEFAULT_SETTINGS || {};
    const cfg = { ...defaults, ...settings };
    const STATUS = root.STATUS || {
      KEEP: "KEEP",
      REVIEW: "REVIEW",
      LIKELY_INACTIVE: "LIKELY_INACTIVE",
      PROTECTED: "PROTECTED"
    };

    const reasons = [];
    let score = 0;

    if (friend.protected) {
      return {
        status: STATUS.PROTECTED,
        score: 0,
        reasons: ["Manually protected"],
        protectedFromRemoval: true,
        mlProbability: null,
        mlSource: null
      };
    }

    if (cfg.protectRecentActivity) {
      if (friend.activeNow) {
        return {
          status: STATUS.KEEP,
          score: 0,
          reasons: ["Active now detected"],
          protectedFromRemoval: true,
          mlProbability: 0,
          mlSource: "override"
        };
      }
      if (friend.recentlyActive) {
        return {
          status: STATUS.KEEP,
          score: 0,
          reasons: ["Recent activity detected"],
          protectedFromRemoval: true,
          mlProbability: 0,
          mlSource: "override"
        };
      }
      if (Number.isFinite(friend.lastVisibleActivityMonths) && friend.lastVisibleActivityMonths <= 12) {
        return {
          status: STATUS.KEEP,
          score: 0,
          reasons: ["Visible activity within the last 12 months"],
          protectedFromRemoval: true,
          mlProbability: 0,
          mlSource: "override"
        };
      }
    }

    if (Number.isFinite(friend.mutualFriends)) {
      if (friend.mutualFriends <= 2) { score += 3; reasons.push("0\u20132 mutual friends"); }
      else if (friend.mutualFriends <= 5) { score += 2; reasons.push("3\u20135 mutual friends"); }
      else if (friend.mutualFriends <= 10) { score += 1; reasons.push("6\u201310 mutual friends"); }
    }

    const months = friend.lastVisibleActivityMonths;
    const hasActivityAge = Number.isFinite(months);
    let strongInactivitySignal = false;

    if (hasActivityAge) {
      if (months >= 36) { score += 5; strongInactivitySignal = true; reasons.push("Latest visible activity is 3+ years old"); }
      else if (months >= 24) { score += 4; strongInactivitySignal = true; reasons.push("Latest visible activity is 2\u20133 years old"); }
      else if (months >= 12) { score += 2; reasons.push("Latest visible activity is 1\u20132 years old"); }
    }

    if (friend.noRecentProfileUpdate === true) { score += 1; reasons.push("No recent visible profile update"); }
    if (friend.sparseProfile === true) { score += 1; reasons.push("Very sparse visible profile"); }
    if (friend.noRecentVisiblePosts === true) { score += 1; reasons.push("No recent visible posts detected"); }
    if (friend.appearsDormant === true) { score += 1; reasons.push("Visible profile appears dormant"); }

    if (!hasActivityAge && Number.isFinite(friend.mutualFriends) && friend.mutualFriends <= cfg.maxMutualFriends) {
      return {
        status: STATUS.REVIEW,
        score,
        reasons: [...reasons, "Activity age is unknown; review manually"],
        protectedFromRemoval: true,
        mlProbability: null,
        mlSource: "heuristic"
      };
    }

    if (cfg.privateProfileProtection &&
        (friend.visibility === "LIMITED" || friend.visibility === "UNKNOWN") &&
        !hasActivityAge && !friend.activeNow && !friend.recentlyActive) {
      return {
        status: STATUS.REVIEW,
        score,
        reasons: [...reasons, "Insufficient visible activity information"],
        protectedFromRemoval: true,
        mlProbability: null,
        mlSource: "heuristic"
      };
    }

    let mlProbability = null;
    let mlSource = "heuristic";
    if (root.mlClassifier) {
      try {
        const mlResult = root.mlClassifier.classifyFriend(friend, root._mlModel, score);
        mlProbability = mlResult.mlProbability;
        mlSource = mlResult.source;
        score = mlResult.combinedScore;
      } catch {}
    }

    if (score >= cfg.inactiveScoreThreshold && strongInactivitySignal) {
      return {
        status: STATUS.LIKELY_INACTIVE,
        score,
        reasons,
        protectedFromRemoval: false,
        mlProbability,
        mlSource
      };
    }

    if (score >= 4 || (hasActivityAge && months >= cfg.inactiveYears * 12)) {
      return {
        status: STATUS.REVIEW,
        score,
        reasons,
        protectedFromRemoval: true,
        mlProbability,
        mlSource
      };
    }

    return {
      status: STATUS.KEEP,
      score,
      reasons: reasons.length ? reasons : ["No strong inactivity signal detected"],
      protectedFromRemoval: true,
      mlProbability,
      mlSource
    };
  }

  root.evaluateFriend = evaluateFriend;
})();
