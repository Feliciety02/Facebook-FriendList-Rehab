const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "dashboard/dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard/dashboard.css"), "utf8");
const script = fs.readFileSync(path.join(root, "dashboard/dashboard.js"), "utf8");

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate dashboard IDs: ${duplicates.join(", ")}`);

for (const requiredId of [
  "navTotal", "navReview", "navKeep", "queueTitle", "queueSubtitle",
  "emptyTitle", "emptyMessage", "emptyAction"
]) {
  if (!ids.includes(requiredId)) throw new Error(`Missing dashboard element: ${requiredId}`);
}

if (!script.includes('action.dataset.action = STATUS.REVIEW')) {
  throw new Error("The empty Keep view does not link users to their Review queue.");
}
if (!css.includes("max-width: 1200px")) {
  throw new Error("Dashboard content still uses the narrow legacy width.");
}

console.log("✓ dashboard IDs are unique");
console.log("✓ dashboard filters and empty-state recovery");
console.log("✓ dashboard wide layout");
