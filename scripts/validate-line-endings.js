import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, assertCanonicalUtf8Lf } from "../lib/guide-releases.js";
import { parseArgs } from "./cli.js";

const args = parseArgs(process.argv.slice(2));
const releaseId = args["release-id"] ?? args._[0];
if (!releaseId) throw new Error("Usage: npm run validate:line-endings -- --release-id <releaseId>");
const releaseDir = path.join(ROOT, "releases", releaseId);
const files = [path.join(releaseDir, "manifest.json"), path.join(releaseDir, "catalog", "guideCatalog.json")];
for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`Required artifact is missing: ${file}`);
  assertCanonicalUtf8Lf(fs.readFileSync(file), file);
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  const attribute = childProcess.execFileSync("git", ["check-attr", "eol", "--", relative], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!attribute.endsWith(": eol: lf")) throw new Error(`Git eol=lf is not enforced for ${relative}: ${attribute}`);
}
console.log(`Canonical UTF-8 LF artifacts validated: ${releaseId}`);
