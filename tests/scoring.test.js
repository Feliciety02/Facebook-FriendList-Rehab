const fs = require('fs');
const vm = require('vm');
const path = require('path');

const context = { globalThis: {} };
vm.createContext(context);
for (const file of ['../lib/constants.js', '../lib/scoring.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
}
const app = context.globalThis.FriendListRehab;

function assert(label, friend, expected) {
  const got = app.evaluateFriend(friend, app.DEFAULT_SETTINGS).status;
  if (got !== expected) throw new Error(`${label}: expected ${expected}, got ${got}`);
  console.log(`✓ ${label}`);
}

assert('old + low mutuals', { mutualFriends: 2, lastVisibleActivityMonths: 48, visibility: 'PUBLIC' }, 'LIKELY_INACTIVE');
assert('active now', { mutualFriends: 1, activeNow: true, visibility: 'UNKNOWN' }, 'KEEP');
assert('recent post', { mutualFriends: 3, lastVisibleActivityMonths: 3, visibility: 'PUBLIC' }, 'KEEP');
assert('unknown + low mutuals', { mutualFriends: 0, visibility: 'UNKNOWN' }, 'REVIEW');
assert('protected', { mutualFriends: 0, lastVisibleActivityMonths: 60, protected: true, visibility: 'PUBLIC' }, 'PROTECTED');
