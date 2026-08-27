(() => {
  const COLORS = ['#0866ff','#22c55e','#f59e0b','#ef4444','#a855f7','#ec4899'];
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let raf = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: -10,
      w: Math.random() * 6 + 4,
      h: Math.random() * 4 + 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx: (Math.random() - .5) * 3,
      vy: Math.random() * 3 + 2,
      rotation: Math.random() * 360,
      spin: (Math.random() - .5) * 8,
      opacity: 1
    };
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.opacity > 0);
    for (const p of particles) {
      p.x += p.vx;
      p.vy += 0.05;
      p.y += p.vy;
      p.rotation += p.spin;
      if (p.y > canvas.height * .85) p.opacity -= 0.02;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (particles.length) raf = requestAnimationFrame(animate);
  }

  window.fireConfetti = function(count = 80) {
    for (let i = 0; i < count; i++) particles.push(createParticle());
    if (!raf) animate();
    setTimeout(() => { cancelAnimationFrame(raf); raf = null; }, 3000);
  };
})();

function showAchievement(icon, text) {
  let toast = document.querySelector('.achievement-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'achievement-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `${icon} ${text}`;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

const app = globalThis.FriendListRehab;
const { STORAGE_KEYS, DEFAULT_SETTINGS, STATUS } = app;
let friends = [];
let settings = { ...DEFAULT_SETTINGS };
let history = [];
let activeTab = "overview";

const XP_PER_REVIEW = 25;
const XP_PER_UNFRIEND = 50;
const LEVEL_XP = [0, 50, 150, 350, 600, 1000, 1600, 2500, 4000, 6000, 9999999];

function getLevel(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) {
    if (xp >= LEVEL_XP[i]) lvl = i + 1;
    else break;
  }
  return Math.min(lvl, 10);
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
  document.getElementById("xpLevel").textContent = `Lvl ${lvl}`;
  document.getElementById("xpText").textContent = `${xp} XP`;
  const badge = document.getElementById("xpBadge");
  badge.classList.remove("pop");
  void badge.offsetWidth;
  badge.classList.add("pop");
}

const $ = (id) => document.getElementById(id);

function statusLabel(s) {
  return ({ [STATUS.KEEP]: "Keep", [STATUS.REVIEW]: "Review", [STATUS.LIKELY_INACTIVE]: "Inactive", [STATUS.PROTECTED]: "Protected" })[s] || s;
}

function statusClass(s) {
  return ({ [STATUS.KEEP]: "keep", [STATUS.REVIEW]: "review", [STATUS.LIKELY_INACTIVE]: "inactive", [STATUS.PROTECTED]: "protected" })[s] || "review";
}

function currentFilter() {
  return activeTab !== "overview" && !["settings", "history"].includes(activeTab)
    ? activeTab
    : $("statusFilter").value;
}

async function load() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.FRIENDS, STORAGE_KEYS.SETTINGS, STORAGE_KEYS.HISTORY
  ]);
  friends = data[STORAGE_KEYS.FRIENDS] || [];
  settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  history = data[STORAGE_KEYS.HISTORY] || [];
  applySettingsToForm();
  render();
  renderXp(await getXp());
  renderMlStats();
}

function counts() {
  return friends.reduce((acc, f) => {
    acc.total++;
    if (f.status === STATUS.KEEP) acc.keep++;
    if (f.status === STATUS.REVIEW) acc.review++;
    if (f.status === STATUS.LIKELY_INACTIVE) acc.inactive++;
    if (f.status === STATUS.PROTECTED) acc.protected++;
    return acc;
  }, { total: 0, keep: 0, review: 0, inactive: 0, protected: 0 });
}

function renderSummary() {
  const c = counts();
  $("sumTotal").textContent = c.total;
  $("sumKeep").textContent = c.keep;
  $("sumReview").textContent = c.review;
  $("sumInactive").textContent = c.inactive;
  $("sumProtected").textContent = c.protected;
  $("navTotal").textContent = c.total;
  $("navKeep").textContent = c.keep;
  $("navReview").textContent = c.review;
  $("navInactive").textContent = c.inactive;
  $("navProtected").textContent = c.protected;
  $("dryPill").textContent = `Dry Run ${settings.dryRun ? "ON" : "OFF"}`;

  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (Math.min(c.total / 500, 1) * circumference);
  $("bigRing").style.strokeDashoffset = offset;
}

function filteredFriends() {
  const query = $("searchInput").value.trim().toLowerCase();
  const filter = currentFilter();
  let result = friends.filter((f) => {
    const matchQ = !query || f.name.toLowerCase().includes(query);
    const matchS = filter === "ALL" || filter === "overview" || f.status === filter;
    return matchQ && matchS;
  });

  const sort = $("sortSelect").value;
  if (sort === "score") result.sort((a, b) => (b.inactiveScore || 0) - (a.inactiveScore || 0));
  if (sort === "mutuals") result.sort((a, b) => (a.mutualFriends ?? 99999) - (b.mutualFriends ?? 99999));
  if (sort === "name") result.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "recent") result.sort((a, b) => new Date(b.scannedAt || 0) - new Date(a.scannedAt || 0));
  return result;
}

function makeAvatar(friend) {
  const wrap = document.createElement("div");
  wrap.className = "avatar";
  if (friend.profileImage) {
    const img = document.createElement("img");
    img.src = friend.profileImage;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    wrap.appendChild(img);
  } else {
    wrap.textContent = (friend.name || "?").slice(0, 1).toUpperCase();
  }
  return wrap;
}

function makeFriendCard(friend) {
  const card = document.createElement("article");
  card.className = `friend-card${friend.selected ? " selected" : ""}`;

  const avatar = makeAvatar(friend);
  const info = document.createElement("div");
  info.className = "friend-info";

  const top = document.createElement("div");
  top.style.display = "flex";
  top.style.justifyContent = "space-between";
  top.style.alignItems = "flex-start";
  top.style.gap = "6px";

  const name = document.createElement("h3");
  name.className = "friend-name";
  name.textContent = friend.name;

  const badge = document.createElement("span");
  badge.className = `badge ${statusClass(friend.status)}`;
  badge.textContent = statusLabel(friend.status);

  top.append(name, badge);

  const meta = document.createElement("div");
  meta.className = "friend-meta";
  const mutual = Number.isFinite(friend.mutualFriends) ? `${friend.mutualFriends} mutual` : "mutuals ?";

  let activity = "activity ?";
  if (friend.activeNow) activity = "active now";
  else if (friend.recentlyActive) activity = "recently active";
  else if (Number.isFinite(friend.lastVisibleActivityMonths)) activity = `${Math.round(friend.lastVisibleActivityMonths / 12 * 10) / 10}y since activity`;

  meta.textContent = `${mutual} \u00b7 ${activity}`;

  const reasons = document.createElement("ul");
  reasons.className = "reason-list";
  for (const reason of (friend.reasons || []).slice(0, 2)) {
    const li = document.createElement("li");
    li.textContent = `\u2022 ${reason}`;
    reasons.appendChild(li);
  }

  const actions = document.createElement("div");
  actions.className = "friend-actions";

  const selectBtn = document.createElement("button");
  selectBtn.className = `select-btn${friend.selected ? " selected" : ""}`;
  selectBtn.textContent = friend.selected ? "\u2713" : "Select";
  const canSelect = friend.status === STATUS.LIKELY_INACTIVE && !friend.protected && !friend.protectedFromRemoval;
  selectBtn.disabled = !canSelect;
  selectBtn.addEventListener("click", () => toggleSelected(friend.id));

  const protectBtn = document.createElement("button");
  protectBtn.textContent = friend.protected ? "\ud83d\udd13" : "\ud83d\udee1\ufe0f";
  protectBtn.title = friend.protected ? "Unprotect" : "Protect";
  protectBtn.addEventListener("click", () => toggleProtected(friend.id));

  const keepBtn = document.createElement("button");
  keepBtn.textContent = "\u2714";
  keepBtn.title = "Keep";
  keepBtn.addEventListener("click", () => markKeep(friend.id));

  const link = document.createElement("a");
  link.href = friend.profileUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "\u2197";

  actions.append(selectBtn, keepBtn, protectBtn, link);
  info.append(top, meta, reasons, actions);
  card.append(avatar, info);
  return card;
}

function renderFriendList() {
  const list = $("friendList");
  list.replaceChildren();
  const data = filteredFriends();
  const filter = currentFilter();
  const query = $("searchInput").value.trim();
  const c = counts();
  const titles = {
    ALL: "All friends",
    KEEP: "Kept friends",
    REVIEW: "Needs review",
    LIKELY_INACTIVE: "Likely inactive",
    PROTECTED: "Protected friends"
  };
  const emptyLabels = {
    KEEP: "kept friends",
    REVIEW: "friends waiting for review",
    LIKELY_INACTIVE: "likely inactive friends",
    PROTECTED: "protected friends"
  };

  $("queueTitle").textContent = titles[filter] || "Friend review";
  $("queueSubtitle").textContent = query
    ? `${data.length} result${data.length === 1 ? "" : "s"} for “${query}”`
    : `Showing ${data.length} of ${friends.length} scanned friend${friends.length === 1 ? "" : "s"}.`;

  const empty = $("emptyState");
  empty.classList.toggle("hidden", data.length !== 0);
  if (data.length === 0) {
    const action = $("emptyAction");
    if (friends.length === 0) {
      $("emptyTitle").textContent = "No friends scanned yet";
      $("emptyMessage").textContent = "Open your Facebook Friends page and start a scan to build your dashboard.";
      action.textContent = "Start a scan";
      action.dataset.action = "SCAN";
    } else if (query) {
      $("emptyTitle").textContent = "No matching friends";
      $("emptyMessage").textContent = `Nothing matches “${query}” in this filter.`;
      action.textContent = "Clear search";
      action.dataset.action = "CLEAR_SEARCH";
    } else if (filter === STATUS.KEEP && c.review > 0) {
      $("emptyTitle").textContent = "No kept friends yet";
      $("emptyMessage").textContent = `You have ${c.review} friend${c.review === 1 ? "" : "s"} waiting for review.`;
      action.textContent = `Show ${c.review} to review`;
      action.dataset.action = STATUS.REVIEW;
    } else {
      $("emptyTitle").textContent = `No ${emptyLabels[filter] || "matching friends"}`;
      $("emptyMessage").textContent = "There are no friends in this category yet. Try viewing the full list.";
      action.textContent = "Show all friends";
      action.dataset.action = "ALL";
    }
  }

  for (const f of data) list.appendChild(makeFriendCard(f));

  const selected = friends.filter((f) => f.selected);
  $("selectedCount").textContent = `${selected.length} selected`;
  $("reviewBtn").disabled = selected.length === 0;
  $("selectAllBtn").disabled = c.inactive === 0;
  $("selectAllBtn").textContent = c.inactive > 0
    ? `Select inactive (${c.inactive})`
    : "No inactive friends";
  const unfriendAllBtn = $("unfriendAllBtn");
  unfriendAllBtn.disabled = c.inactive === 0;
  unfriendAllBtn.textContent = c.inactive > 0
    ? `Unfriend All (${c.inactive})`
    : "No inactive friends";
}

function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();
  if (!history.length) {
    list.innerHTML = '<div class="empty-state">No history yet.</div>';
    return;
  }
  for (const item of [...history].reverse()) {
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = `<div><b>${item.name}</b><br><small>${item.profileUrl || ""}</small></div><div>${item.decision}</div><small>${new Date(item.at).toLocaleString()}</small>`;
    list.appendChild(row);
  }
}

function renderPanels() {
  $("settingsPanel").classList.toggle("hidden", activeTab !== "settings");
  $("historyPanel").classList.toggle("hidden", activeTab !== "history");
  $("overviewPanel").classList.toggle("hidden", ["settings", "history"].includes(activeTab));
  document.querySelectorAll(".nav").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === activeTab));
  if (!["settings", "history"].includes(activeTab)) {
    $("statusFilter").value = activeTab === "overview" ? "ALL" : activeTab;
  }
  const filter = currentFilter();
  document.querySelectorAll(".mini-card[data-status]").forEach((card) => {
    card.classList.toggle("active", card.dataset.status === filter);
  });
}

function render() {
  renderSummary();
  renderPanels();
  renderFriendList();
  renderHistory();
}

async function persistFriends() {
  await chrome.storage.local.set({ [STORAGE_KEYS.FRIENDS]: friends });
}

async function addHistory(friend, decision) {
  history.push({ name: friend.name, profileUrl: friend.profileUrl, decision, at: new Date().toISOString() });
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
}

async function toggleSelected(id) {
  const f = friends.find((x) => x.id === id);
  if (!f || f.protected || f.protectedFromRemoval || f.status !== STATUS.LIKELY_INACTIVE) return;
  f.selected = !f.selected;
  await persistFriends();
  render();
}

async function toggleProtected(id) {
  const f = friends.find((x) => x.id === id);
  if (!f) return;
  f.protected = !f.protected;
  f.selected = false;
  const evaluation = app.evaluateFriend(f, settings);
  f.status = evaluation.status;
  f.inactiveScore = evaluation.score;
  f.reasons = evaluation.reasons;
  f.protectedFromRemoval = evaluation.protectedFromRemoval;

  await chrome.storage.local.set({
    [STORAGE_KEYS.FRIENDS]: friends,
    [STORAGE_KEYS.PROTECTED]: friends.filter((x) => x.protected).map((x) => x.id)
  });
  await addHistory(f, f.protected ? "Protected" : "Unprotected");
  if (f.protected) showAchievement("\ud83d\udee1\ufe0f", `${f.name} protected`);
  render();
}

async function markKeep(id) {
  const f = friends.find((x) => x.id === id);
  if (!f) return;
  f.selected = false;
  f.status = STATUS.KEEP;
  f.protectedFromRemoval = true;
  f.reasons = ["Kept manually"];
  await persistFriends();
  await addHistory(f, "Kept");
  if (app.mlClassifier) {
    await app.mlClassifier.addKeepDecisions([f]);
    await renderMlStats();
  }
  await addXp(XP_PER_REVIEW);
  showAchievement("\u2705", `${f.name} kept \u2014 +${XP_PER_REVIEW} XP`);
  if (typeof fireConfetti === "function") fireConfetti(30);
  render();
}

function selectedFriends() {
  return friends.filter((f) => f.selected && f.status === STATUS.LIKELY_INACTIVE && !f.protected && !f.protectedFromRemoval);
}

function openReviewDialog() {
  const list = $("dialogList");
  list.replaceChildren();
  for (const f of selectedFriends()) {
    const row = document.createElement("div");
    row.className = "dialog-item";
    row.innerHTML = `<div><b>${f.name}</b><br><small>Score ${f.inactiveScore || 0} \u00b7 ${Number.isFinite(f.mutualFriends) ? f.mutualFriends + " mutual" : "mutuals ?"}</small></div><span class="badge inactive">Inactive</span>`;
    list.appendChild(row);
  }
  $("processStatus").textContent = settings.dryRun
    ? "Dry Run is ON. Simulating removals."
    : "Live mode. Processing loaded cards one at a time.";
  $("reviewDialog").showModal();
}

async function processSelected() {
  const queue = selectedFriends();
  if (!queue.length) return;
  $("processBtn").disabled = true;

  let xpEarned = 0;

  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    $("processStatus").textContent = `${i + 1} / ${queue.length}: ${f.name}`;

    if (settings.dryRun) {
      await new Promise((r) => setTimeout(r, 300));
      await addHistory(f, "Dry-run");
      xpEarned += 10;
      continue;
    }

    const resp = await chrome.runtime.sendMessage({
      type: "SEND_TO_FRIENDS_TAB",
      payload: { type: "ATTEMPT_UNFRIEND", profileUrl: f.profileUrl, friend: f }
    });

    if (!resp?.ok) {
      $("processStatus").textContent = resp?.error || "Could not reach Facebook tab.";
      break;
    }

    const result = resp.result;
    if (!result?.ok) {
      await addHistory(f, result?.skipped ? "Skipped" : "Stopped");
      $("processStatus").textContent = `${f.name}: ${result?.error || "Stopped."}`;
      break;
    }

    f.selected = false;
    await addHistory(f, "Removed");
    if (app.mlClassifier) {
      await app.mlClassifier.addRemoveDecisions([f]);
    }
    xpEarned += XP_PER_UNFRIEND;
    await new Promise((r) => setTimeout(r, 4000));
  }

  if (xpEarned > 0) {
    await addXp(xpEarned);
    showAchievement("\ud83c\udfc6", `+${xpEarned} XP earned!`);
    if (typeof fireConfetti === "function") fireConfetti(120);
  }

  await renderMlStats();
  await persistFriends();
  $("processBtn").disabled = false;
  $("reviewDialog").close();
  render();
}

async function renderMlStats() {
  if (!app.mlClassifier) {
    $("mlFeedbackCount").textContent = "0";
    $("mlReadyStatus").textContent = "ML unavailable";
    return;
  }
  const stats = app.mlClassifier.getStats();
  $("mlFeedbackCount").textContent = stats.totalFeedback;
  $("mlReadyStatus").textContent = stats.modelTrained ? "Trained" : "Needs more data";
  $("mlReadyStatus").style.color = stats.modelTrained ? "var(--success)" : "var(--muted)";
}

function inactiveFriends() {
  return friends.filter((f) => f.status === STATUS.LIKELY_INACTIVE && !f.protected && !f.protectedFromRemoval);
}

function openUnfriendAllDialog() {
  const queue = inactiveFriends();
  if (!queue.length) {
    showAchievement("\u2139\ufe0f", "No inactive friends to unfriend");
    return;
  }
  const list = $("unfriendAllList");
  list.replaceChildren();
  for (const f of queue) {
    const row = document.createElement("div");
    row.className = "dialog-item";
    row.innerHTML = `<div><b>${f.name}</b><br><small>Score ${f.inactiveScore || 0} \u00b7 ${Number.isFinite(f.mutualFriends) ? f.mutualFriends + " mutual" : "mutuals ?"}</small></div><span class="badge inactive">Inactive</span>`;
    list.appendChild(row);
  }
  $("unfriendAllCount").textContent = queue.length;
  $("unfriendAllStatus").textContent = settings.dryRun
    ? "Dry Run is ON. Simulating all removals."
    : "Live mode. Will unfriend all inactive friends one by one.";
  $("unfriendAllDialog").showModal();
}

async function processUnfriendAll() {
  const queue = inactiveFriends();
  if (!queue.length) return;
  $("unfriendAllConfirmBtn").disabled = true;

  let xpEarned = 0;

  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    $("unfriendAllStatus").textContent = `${i + 1} / ${queue.length}: ${f.name}`;

    if (settings.dryRun) {
      await new Promise((r) => setTimeout(r, 300));
      await addHistory(f, "Dry-run (unfriend all)");
      xpEarned += 10;
      continue;
    }

    const resp = await chrome.runtime.sendMessage({
      type: "SEND_TO_FRIENDS_TAB",
      payload: { type: "ATTEMPT_UNFRIEND", profileUrl: f.profileUrl, friend: f }
    });

    if (!resp?.ok) {
      $("unfriendAllStatus").textContent = resp?.error || "Could not reach Facebook tab.";
      break;
    }

    const result = resp.result;
    if (!result?.ok) {
      await addHistory(f, result?.skipped ? "Skipped" : "Stopped");
      $("unfriendAllStatus").textContent = `${f.name}: ${result?.error || "Stopped."}`;
      break;
    }

    await addHistory(f, "Removed");
    if (app.mlClassifier) {
      await app.mlClassifier.addRemoveDecisions([f]);
    }
    xpEarned += XP_PER_UNFRIEND;
    await new Promise((r) => setTimeout(r, 4000));
  }

  if (xpEarned > 0) {
    await addXp(xpEarned);
    showAchievement("\ud83c\udfc6", `+${xpEarned} XP earned!`);
    if (typeof fireConfetti === "function") fireConfetti(120);
  }

  await renderMlStats();
  await persistFriends();
  $("unfriendAllConfirmBtn").disabled = false;
  $("unfriendAllDialog").close();
  render();
}

function applySettingsToForm() {
  $("inactiveYears").value = String(settings.inactiveYears);
  $("maxMutualFriends").value = String(settings.maxMutualFriends);
  $("inactiveScoreThreshold").value = settings.inactiveScoreThreshold;
  $("protectRecentActivity").checked = settings.protectRecentActivity;
  $("privateProfileProtection").checked = settings.privateProfileProtection;
  $("dryRun").checked = settings.dryRun;
  $("autoUnfriend").checked = settings.autoUnfriend || false;
}

async function saveSettings() {
  settings = {
    ...settings,
    inactiveYears: Number($("inactiveYears").value),
    maxMutualFriends: Number($("maxMutualFriends").value),
    inactiveScoreThreshold: Number($("inactiveScoreThreshold").value),
    protectRecentActivity: $("protectRecentActivity").checked,
    privateProfileProtection: $("privateProfileProtection").checked,
    dryRun: $("dryRun").checked,
    autoUnfriend: $("autoUnfriend").checked
  };

  friends = friends.map((f) => {
    const evaluation = app.evaluateFriend(f, settings);
    return {
      ...f,
      status: evaluation.status,
      inactiveScore: evaluation.score,
      reasons: evaluation.reasons,
      protectedFromRemoval: evaluation.protectedFromRemoval,
      selected: evaluation.protectedFromRemoval ? false : f.selected
    };
  });

  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: settings,
    [STORAGE_KEYS.FRIENDS]: friends
  });
  showAchievement("\u2699\ufe0f", "Settings saved");
  render();
}

$("navTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  activeTab = btn.dataset.tab;
  render();
});

$("searchInput").addEventListener("input", renderFriendList);
$("statusFilter").addEventListener("change", () => {
  activeTab = $("statusFilter").value === "ALL" ? "overview" : $("statusFilter").value;
  render();
});
$("sortSelect").addEventListener("change", renderFriendList);
document.querySelector(".mini-stats").addEventListener("click", (e) => {
  const card = e.target.closest("button[data-status]");
  if (!card) return;
  activeTab = card.dataset.status;
  render();
});
$("emptyAction").addEventListener("click", () => {
  const action = $("emptyAction").dataset.action;
  if (action === "SCAN") {
    $("scanBtn").click();
    return;
  }
  if (action === "CLEAR_SEARCH") {
    $("searchInput").value = "";
    renderFriendList();
    return;
  }
  activeTab = action === "ALL" ? "overview" : action;
  render();
});
$("scanBtn").addEventListener("click", () => chrome.runtime.sendMessage({ type: "SEND_TO_FRIENDS_TAB", payload: { type: "SCAN_LOADED_FRIENDS" } }).then(() => load()));
$("selectAllBtn").addEventListener("click", async () => {
  friends.forEach((f) => { f.selected = f.status === STATUS.LIKELY_INACTIVE && !f.protected && !f.protectedFromRemoval; });
  await persistFriends();
  render();
});
$("reviewBtn").addEventListener("click", openReviewDialog);
$("processBtn").addEventListener("click", processSelected);
$("unfriendAllBtn").addEventListener("click", openUnfriendAllDialog);
$("unfriendAllConfirmBtn").addEventListener("click", processUnfriendAll);
$("saveBtn").addEventListener("click", saveSettings);
$("resetBtn").addEventListener("click", () => { settings = { ...DEFAULT_SETTINGS }; applySettingsToForm(); });
$("clearHistoryBtn").addEventListener("click", async () => {
  history = [];
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
  renderHistory();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEYS.FRIENDS] || changes[STORAGE_KEYS.SETTINGS])) load();
});

load();
