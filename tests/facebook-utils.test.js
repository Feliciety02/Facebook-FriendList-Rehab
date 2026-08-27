const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = {
  globalThis: {},
  location: {
    href: "https://www.facebook.com/friends",
    origin: "https://www.facebook.com"
  },
  URL
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../lib/facebook-utils.js"), "utf8"),
  context
);

const { isFriendsUrl } = context.globalThis.FriendListRehab.facebookUtils;

const cases = [
  ["friends landing page", "https://www.facebook.com/friends", true],
  ["friends list subsection", "https://www.facebook.com/friends/list", true],
  ["vanity profile friends", "https://www.facebook.com/example.user/friends", true],
  ["profile.php friends tab", "https://www.facebook.com/profile.php?id=123&sk=friends", true],
  ["ordinary Facebook page", "https://www.facebook.com/example.user", false],
  ["lookalike external domain", "https://facebook.com.example.org/friends", false]
];

for (const [label, url, expected] of cases) {
  const actual = isFriendsUrl(url);
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`✓ ${label}`);
}
