const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const popup = fs.readFileSync(path.join(root, "popup/popup.html"), "utf8");
const popupScript = fs.readFileSync(path.join(root, "popup/popup.js"), "utf8");
const popupStyles = fs.readFileSync(path.join(root, "popup/popup.css"), "utf8");
const scanner = fs.readFileSync(path.join(root, "content/facebook-scanner.js"), "utf8");

for (const permission of ["storage", "scripting", "tabs"]) {
  if (!manifest.permissions.includes(permission)) {
    throw new Error(`Missing required permission: ${permission}`);
  }
}

const ids = [...popup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length > 0) {
  throw new Error(`Duplicate popup IDs: ${[...new Set(duplicates)].join(", ")}`);
}

if (popupScript.includes("Reload Facebook once")) {
  throw new Error("The popup still contains the obsolete reload-only recovery message.");
}
if (!scanner.includes("for (const id of newFriends.keys()) scannedIds.add(id)")) {
  throw new Error("Newly discovered friend IDs are not added to scan progress.");
}
if (scanner.includes("__friendListRehabScannerLoaded") ||
    !scanner.includes("__friendListRehabScannerCleanup")) {
  throw new Error("The scanner does not safely replace a stale page instance.");
}
if (!/\.scan-ui\s*\{[^}]*display:\s*flex;[^}]*gap:/s.test(popupStyles)) {
  throw new Error("The scan panel is missing its compact flex layout.");
}
if (/\.app\s*\{[^}]*min-height:/s.test(popupStyles)) {
  throw new Error("The popup app still forces an empty minimum height.");
}

console.log("✓ manifest permissions");
console.log("✓ popup IDs are unique");
console.log("✓ scanner recovery and progress guards");
console.log("✓ compact popup layout guards");
