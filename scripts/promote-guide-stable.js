import path from "node:path";
import { ROOT, atomicWriteJson, channelDiff, nextChannelPointer, readJson } from "../lib/guide-releases.js";
import { parseArgs, requireConfirmation } from "./cli.js";

const args = parseArgs(process.argv.slice(2));
const releaseId = args["release-id"] ?? args._[0];
if (!releaseId) throw new Error("--release-id is required");
const pointerPath = path.resolve(args["channel-path"] ?? path.join(ROOT, "channels", "stable.json"));
const current = readJson(pointerPath);
const next = nextChannelPointer({
  current,
  targetReleaseDir: path.resolve(args["release-dir"] ?? path.join(ROOT, "releases", releaseId)),
  approvalId: args["approval-id"],
  promotedAt: args["promoted-at"] ?? new Date().toISOString(),
});
console.log(channelDiff(current, next));
if (args["dry-run"]) console.log("Dry run: Stable was not modified.");
else {
  requireConfirmation(args);
  atomicWriteJson(pointerPath, next);
  console.log(`Stable promoted to ${releaseId}.`);
}
