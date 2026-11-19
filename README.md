# 🤝 FriendList Rehab

> A privacy-first Chrome extension that helps you **review** your Facebook friend list — find likely inactive accounts using visible activity, mutual friends and safety rules, then decide for yourself.

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-f7df1e?logo=javascript&logoColor=black)
![Runs locally](https://img.shields.io/badge/data-stays%20on%20your%20device-2ea44f)
![Version](https://img.shields.io/badge/version-0.1.2-blue)

---

## ✨ Features

- 🔎 **Friend list scanner** — scrolls your Friends page and collects what is already visible to you
- 🧮 **Explainable scoring** — every friend gets a score built from clear signals (mutual friends, last visible activity, profile signals)
- 🧠 **Learns from you** — a small on-device classifier adjusts to the decisions you make
- 🛡️ **Protected list** — mark people who must never be suggested for removal
- 🧪 **Dry run by default** — nothing is removed unless you turn dry run off yourself
- 📊 **Dashboard** — Overview, Likely Inactive, Review, Keep, Protected, Settings and History tabs
- 🔒 **Local only** — no servers, no accounts, no tracking; data lives in `chrome.storage.local`

---

## 🏷️ How friends are sorted

| Status | Meaning |
|---|---|
| 🟥 **LIKELY_INACTIVE** | Score passed your threshold — worth a look |
| 🟨 **REVIEW** | Mixed signals — decide manually |
| 🟩 **KEEP** | Active or well-connected |
| 🛡️ **PROTECTED** | You marked them; never suggested for removal |

### Scoring signals

| Signal | Points |
|---|---|
| 0–2 mutual friends | +3 |
| 3–5 mutual friends | +2 |
| 6–10 mutual friends | +1 |
| No visible activity for 36+ months | +5 |
| No visible activity for 24+ months | +4 |
| No visible activity for 12+ months | +2 |
| Profile signals (e.g. missing photo) | small extra points |

A friend whose total reaches the **inactive score threshold** (default `7`) is marked *Likely inactive*. All thresholds can be changed in **Settings**.

### Default settings

| Setting | Default |
|---|---|
| Inactive after | 2 years |
| Max mutual friends to flag | 5 |
| Inactive score threshold | 7 |
| Dry run | ✅ On |
| Auto-unfriend | ❌ Off |

---

## 📥 Install

1. Click the green **Code** button → **Download ZIP**, then unzip it (or `git clone` this repo)
2. Open `chrome://extensions` in Chrome
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and pick the folder that contains `manifest.json`
5. Pin **FriendList Rehab** to your toolbar

## 🚀 Use it

1. Log in to Facebook and open your **Friends** list
2. Click the extension icon and start a **scan**
3. Open the **Dashboard** to see each friend's status and why they got it
4. Move people between **Keep / Review / Protected** — the classifier learns from it
5. Only when you're sure, turn **Dry run** off and remove friends one by one

---

## 🔐 Privacy

- Runs only on `facebook.com` pages, using what you can already see while logged in
- No external servers, analytics or API keys — nothing is uploaded anywhere
- Everything is stored in your browser and can be wiped by removing the extension

## ⚠️ Disclaimer

This is a personal project and is **not affiliated with Meta or Facebook**. Automated actions on Facebook may go against its Terms and could get your account rate-limited. Keep **dry run** on, review results yourself, and use auto-unfriend at your own risk. A "likely inactive" label is an estimate, not a fact — always double-check before removing someone.

---

## 🗂️ Project structure

```
background/   service worker (messaging, tab handling)
content/      Facebook page scanner + on-page styles
dashboard/    full review dashboard
popup/        toolbar popup
lib/          constants, scoring, on-device classifier, Facebook helpers
tests/        plain Node tests
```

## 🧪 Tests

No dependencies needed — just Node:

```bash
for f in tests/*.test.js; do node "$f"; done
```

---

## 💛 Support

If this helped you clean up your feed, **leave a ⭐** — it really helps!
Found a bug or have an idea? [Open an issue](../../issues).

Made by [Fe Anne Malasarte](https://github.com/Feliciety02).
