const app = globalThis.FriendListRehab;
const { STORAGE_KEYS, DEFAULT_SETTINGS, STATUS } = app;
let friends = [];
let settings = { ...DEFAULT_SETTINGS };
let history = [];
let activeTab = "overview";

const $ = (id) => document.getElementById(id);

function escText(value) {
  return String(value ?? "");
}

function statusLabel(status) {
  return ({
    [STATUS.KEEP]: "Keep",
    [STATUS.REVIEW]: "Needs Review",
    [STATUS.LIKELY_INACTIVE]: "Likely Inactive",
    [STATUS.PROTECTED]: "Protected"
  })[status] || status;
}

function statusClass(status) {
  return ({
    [STATUS.KEEP]: "keep",
    [STATUS.REVIEW]: "review",
    [STATUS.LIKELY_INACTIVE]: "inactive",
    [STATUS.PROTECTED]: "protected"
  })[status] || "review";
}

async function load() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.FRIENDS,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.HISTORY
  ]);
  friends = data[STORAGE_KEYS.FRIENDS] || [];
  settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  history = data[STORAGE_KEYS.HISTORY] || [];
  applySettingsToForm();
  render();
}

function counts() {
  return friends.reduce((acc, f) => {
    acc.total += 1;
    if (f.status === STATUS.KEEP) acc.keep += 1;
    if (f.status === STATUS.REVIEW) acc.review += 1;
    if (f.status === STATUS.LIKELY_INACTIVE) acc.inactive += 1;
    if (f.status === STATUS.PROTECTED) acc.protected += 1;
    return acc;
  }, { total: 0, keep: 0, review: 0, inactive: 0, protected: 0 });
}

function renderSummary() {
  const c = counts();
  $("sumTotal").textContent = c.total;
  $("sumKeep").textContent = c.keep;
  $("sumReview").textContent = c.review;
  $("sumInactive").textContent = c.inactive;
  $("dryRunPill").textContent = `Dry Run ${settings.dryRun ? "ON" : "OFF"}`;
}

function filteredFriends() {
  const query = $("searchInput").value.trim().toLowerCase();
  const filter = activeTab !== "overview" && !["settings", "history"].includes(activeTab)
    ? activeTab
    : $("statusFilter").value;
  let result = friends.filter((friend) => {
    const matchesQuery = !query || friend.name.toLowerCase().includes(query);
    const matchesStatus = filter === "ALL" || filter === "overview" || friend.status === filter;
    return matchesQuery && matchesStatus;
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
  card.dataset.id = friend.id;
  card.appendChild(makeAvatar(friend));

  const main = document.createElement("div");
  main.className = "friend-main";

  const top = document.createElement("div");
  top.className = "friend-top";
  const info = document.createElement("div");
  const name = document.createElement("h3");
  name.className = "friend-name";
  name.textContent = friend.name;
  const meta = document.createElement("div");
  meta.className = "meta";
  const mutual = Number.isFinite(friend.mutualFriends) ? `${friend.mutualFriends} mutual friend${friend.mutualFriends === 1 ? "" : "s"}` : "Mutual friends unknown";
  const activity = friend.activeNow ? "Active now" : friend.recentlyActive ? "Recently active" : Number.isFinite(friend.lastVisibleActivityMonths) ? `${Math.round(friend.lastVisibleActivityMonths / 12 * 10) / 10} years since visible activity` : "Visible activity age unknown";
  meta.textContent = `${mutual} · ${activity}`;
  info.append(name, meta);

  const badge = document.createElement("span");
  badge.className = `badge ${statusClass(friend.status)}`;
  badge.textContent = statusLabel(friend.status);
  top.append(info, badge);

  const reasons = document.createElement("ul");
  reasons.className = "reason-list";
  for (const reason of (friend.reasons || []).slice(0, 3)) {
    const li = document.createElement("li");
    li.textContent = `• ${reason}`;
    reasons.appendChild(li);
  }

  const actions = document.createElement("div");
  actions.className = "friend-actions";

  const selectBtn = document.createElement("button");
  selectBtn.className = `select-btn${friend.selected ? " selected" : ""}`;
  selectBtn.textContent = friend.selected ? "Selected" : "Select";
  const canSelect = friend.status === STATUS.LIKELY_INACTIVE && !friend.protected && !friend.protectedFromRemoval;
  selectBtn.disabled = !canSelect;
  selectBtn.addEventListener("click", () => toggleSelected(friend.id));

  const protectBtn = document.createElement("button");
  protectBtn.textContent = friend.protected ? "Unprotect" : "Protect";
  protectBtn.addEventListener("click", () => toggleProtected(friend.id));

  const keepBtn = document.createElement("button");
  keepBtn.textContent = "Keep";
  keepBtn.addEventListener("click", () => markKeep(friend.id));

  const profileLink = document.createElement("a");
  profileLink.href = friend.profileUrl;
  profileLink.target = "_blank";
  profileLink.rel = "noreferrer";
  profileLink.textContent = "View profile";

  actions.append(selectBtn, keepBtn, protectBtn, profileLink);
  main.append(top, reasons, actions);
  card.appendChild(main);
  return card;
}

function renderFriendList() {
  const list = $("friendList");
  list.replaceChildren();
  const data = filteredFriends();
  $("emptyState").hidden = data.length !== 0;
  for (const friend of data) list.appendChild(makeFriendCard(friend));

  const selected = friends.filter((f) => f.selected);
  $("selectedCount").textContent = `${selected.length} selected`;
  $("reviewSelectedButton").disabled = selected.length === 0;
}

function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No history yet.";
    list.appendChild(empty);
    return;
  }

  for (const item of [...history].reverse()) {
    const row = document.createElement("div");
    row.className = "history-row";
    const who = document.createElement("div");
    who.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = item.name;
    const s = document.createElement("small");
    s.textContent = item.profileUrl || "";
    who.append(b, document.createElement("br"), s);
    const decision = document.createElement("div");
    decision.textContent = item.decision;
    const date = document.createElement("div");
    date.textContent = new Date(item.at).toLocaleString();
    row.append(who, decision, date);
    list.appendChild(row);
  }
}

function renderPanels() {
  $("settingsPanel").classList.toggle("hidden", activeTab !== "settings");
  $("historyPanel").classList.toggle("hidden", activeTab !== "history");
  $("overviewPanel").classList.toggle("hidden", ["settings", "history"].includes(activeTab));
  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === activeTab));
  if (!["settings", "history"].includes(activeTab)) {
    $("statusFilter").value = activeTab === "overview" ? "ALL" : activeTab;
  }
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
  const friend = friends.find((f) => f.id === id);
  if (!friend || friend.protected || friend.protectedFromRemoval || friend.status !== STATUS.LIKELY_INACTIVE) return;
  friend.selected = !friend.selected;
  await persistFriends();
  render();
}

async function toggleProtected(id) {
  const friend = friends.find((f) => f.id === id);
  if (!friend) return;
  friend.protected = !friend.protected;
  friend.selected = false;
  const evaluation = app.evaluateFriend(friend, settings);
  friend.status = evaluation.status;
  friend.inactiveScore = evaluation.score;
  friend.reasons = evaluation.reasons;
  friend.protectedFromRemoval = evaluation.protectedFromRemoval;

  const protectedIds = friends.filter((f) => f.protected).map((f) => f.id);
  await chrome.storage.local.set({
    [STORAGE_KEYS.FRIENDS]: friends,
    [STORAGE_KEYS.PROTECTED]: protectedIds
  });
  await addHistory(friend, friend.protected ? "Protected" : "Unprotected");
  render();
}

async function markKeep(id) {
  const friend = friends.find((f) => f.id === id);
  if (!friend) return;
  friend.selected = false;
  friend.status = STATUS.KEEP;
  friend.protectedFromRemoval = true;
  friend.reasons = ["Kept manually"];
  await persistFriends();
  await addHistory(friend, "Kept");
  render();
}

function selectedFriends() {
  return friends.filter((f) => f.selected && f.status === STATUS.LIKELY_INACTIVE && !f.protected && !f.protectedFromRemoval);
}

function openReviewDialog() {
  const selected = selectedFriends();
  const list = $("dialogList");
  list.replaceChildren();
  for (const friend of selected) {
    const row = document.createElement("div");
    row.className = "dialog-item";
    const left = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = friend.name;
    const small = document.createElement("small");
    small.textContent = `Score ${friend.inactiveScore || 0} · ${Number.isFinite(friend.mutualFriends) ? friend.mutualFriends + " mutual" : "mutuals unknown"}`;
    left.append(b, document.createElement("br"), small);
    const badge = document.createElement("span");
    badge.className = "badge inactive";
    badge.textContent = "Likely Inactive";
    row.append(left, badge);
    list.appendChild(row);
  }
  $("processStatus").textContent = settings.dryRun
    ? "Dry Run is ON. Processing will simulate removals only."
    : "Live mode is ON. Processing will use the loaded Friends-page cards one at a time.";
  $("reviewDialog").showModal();
}

async function processSelected() {
  const queue = selectedFriends();
  if (!queue.length) return;
  $("processButton").disabled = true;

  for (let i = 0; i < queue.length; i += 1) {
    const friend = queue[i];
    $("processStatus").textContent = `Processing ${i + 1} / ${queue.length}: ${friend.name}`;

    if (settings.dryRun) {
      await new Promise((r) => setTimeout(r, 350));
      await addHistory(friend, "Dry-run skipped");
      continue;
    }

    const response = await chrome.runtime.sendMessage({
      type: "SEND_TO_FRIENDS_TAB",
      payload: { type: "ATTEMPT_UNFRIEND", profileUrl: friend.profileUrl, friend }
    });

    if (!response?.ok) {
      $("processStatus").textContent = response?.error || "Could not reach the Facebook Friends tab.";
      break;
    }

    const result = response.result;
    if (!result?.ok) {
      await addHistory(friend, result?.skipped ? "Skipped" : "Stopped");
      $("processStatus").textContent = `${friend.name}: ${result?.error || "Stopped."}`;
      break;
    }

    friend.selected = false;
    await addHistory(friend, "Removed");
    await new Promise((r) => setTimeout(r, 4000));
  }

  await persistFriends();
  $("processButton").disabled = false;
  render();
}

async function sendScan() {
  const response = await chrome.runtime.sendMessage({ type: "SEND_TO_FRIENDS_TAB", payload: { type: "SCAN_LOADED_FRIENDS" } });
  if (!response?.ok) {
    alert(response?.error || "Open your Facebook Friends page, reload it once, and try again.");
    return;
  }
  await load();
}

function applySettingsToForm() {
  $("inactiveYears").value = String(settings.inactiveYears);
  $("maxMutualFriends").value = String(settings.maxMutualFriends);
  $("inactiveScoreThreshold").value = settings.inactiveScoreThreshold;
  $("protectRecentActivity").checked = settings.protectRecentActivity;
  $("privateProfileProtection").checked = settings.privateProfileProtection;
  $("dryRun").checked = settings.dryRun;
}

async function saveSettings() {
  settings = {
    ...settings,
    inactiveYears: Number($("inactiveYears").value),
    maxMutualFriends: Number($("maxMutualFriends").value),
    inactiveScoreThreshold: Number($("inactiveScoreThreshold").value),
    protectRecentActivity: $("protectRecentActivity").checked,
    privateProfileProtection: $("privateProfileProtection").checked,
    dryRun: $("dryRun").checked
  };

  friends = friends.map((friend) => {
    const evaluation = app.evaluateFriend(friend, settings);
    return {
      ...friend,
      status: evaluation.status,
      inactiveScore: evaluation.score,
      reasons: evaluation.reasons,
      protectedFromRemoval: evaluation.protectedFromRemoval,
      selected: evaluation.protectedFromRemoval ? false : friend.selected
    };
  });

  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: settings,
    [STORAGE_KEYS.FRIENDS]: friends
  });
  render();
}

$("navTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (!button) return;
  activeTab = button.dataset.tab;
  render();
});
$("searchInput").addEventListener("input", renderFriendList);
$("statusFilter").addEventListener("change", () => { activeTab = "overview"; render(); });
$("sortSelect").addEventListener("change", renderFriendList);
$("refreshButton").addEventListener("click", load);
$("scanAgainButton").addEventListener("click", sendScan);
$("selectInactiveButton").addEventListener("click", async () => {
  friends.forEach((friend) => {
    friend.selected = friend.status === STATUS.LIKELY_INACTIVE && !friend.protected && !friend.protectedFromRemoval;
  });
  await persistFriends();
  render();
});
$("reviewSelectedButton").addEventListener("click", openReviewDialog);
$("processButton").addEventListener("click", processSelected);
$("saveSettings").addEventListener("click", saveSettings);
$("resetSettings").addEventListener("click", () => {
  settings = { ...DEFAULT_SETTINGS };
  applySettingsToForm();
});
$("clearHistory").addEventListener("click", async () => {
  history = [];
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
  renderHistory();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEYS.FRIENDS] || changes[STORAGE_KEYS.SETTINGS])) load();
});

load();
