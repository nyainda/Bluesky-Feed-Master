import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
const notifications = readFileSync(resolve(root, "artifacts/api-server/src/routes/notifications.ts"), "utf8");

const hasCorrectSeenCall = notifications.includes("updateSeenNotifications(new Date().toISOString())");

console.log(`[verify-release] workspace version: ${pkg.version}`);
console.log(`[verify-release] notifications seen signature fixed: ${hasCorrectSeenCall}`);

if (!hasCorrectSeenCall) {
  console.error("[verify-release] Expected notifications fix is missing in this checkout.");
  process.exit(1);
}
