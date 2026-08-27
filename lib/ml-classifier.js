(() => {
  const root = globalThis.FriendListRehab = globalThis.FriendListRehab || {};

  const STORAGE_KEY = "friendlistRehabMlModel";
  const FEEDBACK_KEY = "friendlistRehabMlFeedback";

  const DEFAULT_WEIGHTS = {
    mutualFriends: -0.15,
    activeNow: -3.0,
    recentlyActive: -2.5,
    monthsSinceActivity: 0.08,
    noRecentProfileUpdate: 0.4,
    sparseProfile: 0.5,
    noRecentVisiblePosts: 0.6,
    appearsDormant: 0.7,
    visibilityUnknown: 0.3,
    visibilityLimited: 0.5,
    bias: -1.2
  };

  const FEATURE_NAMES = Object.keys(DEFAULT_WEIGHTS);

  function extractFeatures(friend) {
    return {
      mutualFriends: Number.isFinite(friend.mutualFriends) ? Math.min(friend.mutualFriends, 50) : 10,
      activeNow: friend.activeNow ? 1 : 0,
      recentlyActive: friend.recentlyActive ? 1 : 0,
      monthsSinceActivity: Number.isFinite(friend.lastVisibleActivityMonths) ? friend.lastVisibleActivityMonths : 24,
      noRecentProfileUpdate: friend.noRecentProfileUpdate ? 1 : 0,
      sparseProfile: friend.sparseProfile ? 1 : 0,
      noRecentVisiblePosts: friend.noRecentVisiblePosts ? 1 : 0,
      appearsDormant: friend.appearsDormant ? 1 : 0,
      visibilityUnknown: friend.visibility === "UNKNOWN" ? 1 : 0,
      visibilityLimited: friend.visibility === "LIMITED" ? 1 : 0
    };
  }

  function sigmoid(z) {
    if (z > 20) return 1;
    if (z < -20) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  function dotProduct(weights, features) {
    let sum = weights.bias || 0;
    for (const name of FEATURE_NAMES) {
      if (name === "bias") continue;
      sum += (weights[name] || 0) * (features[name] || 0);
    }
    return sum;
  }

  function normalizeMutualFriends(friends) {
    let max = 0;
    for (const f of friends) {
      const mf = Number.isFinite(f.mutualFriends) ? f.mutualFriends : 0;
      if (mf > max) max = mf;
    }
    return Math.max(max, 1);
  }

  async function loadModel() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    return data[STORAGE_KEY] || { weights: { ...DEFAULT_WEIGHTS }, trainedOn: 0, version: 1 };
  }

  async function saveModel(model) {
    await chrome.storage.local.set({ [STORAGE_KEY]: model });
  }

  async function loadFeedback() {
    const data = await chrome.storage.local.get([FEEDBACK_KEY]);
    return data[FEEDBACK_KEY] || [];
  }

  async function saveFeedback(feedback) {
    await chrome.storage.local.set({ [FEEDBACK_KEY]: feedback });
  }

  function trainModel(feedback, existingWeights) {
    if (feedback.length < 2) return existingWeights;

    const weights = { ...existingWeights };
    const learningRate = 0.05;
    const epochs = Math.min(50, Math.max(10, feedback.length * 2));

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;

      for (const sample of feedback) {
        const features = extractFeatures(sample.friend);
        const z = dotProduct(weights, features);
        const prediction = sigmoid(z);
        const label = sample.label === "inactive" ? 1 : 0;
        const error = prediction - label;

        totalLoss += Math.abs(error);

        for (const name of FEATURE_NAMES) {
          if (name === "bias") {
            weights.bias -= learningRate * error;
          } else {
            weights[name] -= learningRate * error * (features[name] || 0);
          }
        }
      }

      if (totalLoss / feedback.length < 0.05) break;
    }

    return weights;
  }

  async function trainFromDecisions(friends, decisions) {
    const feedback = await loadFeedback();

    for (const decision of decisions) {
      const friend = friends.find((f) => f.id === decision.id);
      if (!friend) continue;

      const exists = feedback.find((f) => f.friendId === decision.id);
      if (exists) {
        exists.label = decision.label;
        exists.friend = { ...friend };
        exists.timestamp = Date.now();
      } else {
        feedback.push({
          friendId: decision.id,
          label: decision.label,
          friend: { ...friend },
          timestamp: Date.now()
        });
      }
    }

    const recent = feedback.slice(-500);
    await saveFeedback(recent);

    const model = await loadModel();
    model.weights = trainModel(recent, model.weights);
    model.trainedOn = recent.length;
    model.lastTrained = Date.now();
    await saveModel(model);

    return model;
  }

  function predictProbability(friend, weights) {
    const features = extractFeatures(friend);
    const z = dotProduct(weights, features);
    return sigmoid(z);
  }

  function classifyFriend(friend, model, heuristicScore) {
    if (!model || model.trainedOn < 5) {
      return {
        mlProbability: null,
        combinedScore: heuristicScore,
        source: "heuristic"
      };
    }

    const mlProb = predictProbability(friend, model.weights);

    const mlScore = mlProb * 10;
    const alpha = Math.min(0.6, model.trainedOn / 50);
    const combinedScore = (1 - alpha) * heuristicScore + alpha * mlScore;

    return {
      mlProbability: mlProb,
      combinedScore,
      source: model.trainedOn >= 10 ? "ml" : "hybrid"
    };
  }

  async function addKeepDecisions(friends) {
    const decisions = friends.map((f) => ({ id: f.id, label: "active" }));
    return trainFromDecisions(friends, decisions);
  }

  async function addRemoveDecisions(friends) {
    const decisions = friends.map((f) => ({ id: f.id, label: "inactive" }));
    return trainFromDecisions(friends, decisions);
  }

  async function getModelStats() {
    const model = await loadModel();
    const feedback = await loadFeedback();
    return {
      trainedOn: model.trainedOn,
      lastTrained: model.lastTrained,
      feedbackCount: feedback.length,
      keepCount: feedback.filter((f) => f.label === "active").length,
      removeCount: feedback.filter((f) => f.label === "inactive").length,
      ready: model.trainedOn >= 5
    };
  }

  root.mlClassifier = {
    extractFeatures,
    predictProbability,
    classifyFriend,
    loadModel,
    saveModel,
    trainFromDecisions,
    addKeepDecisions,
    addRemoveDecisions,
    getModelStats,
    loadFeedback,
    DEFAULT_WEIGHTS
  };
})();
