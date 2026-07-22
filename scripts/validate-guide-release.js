import path from "node:path";
import { ROOT, validateRelease } from "../lib/guide-releases.js";
import { parseArgs } from "./cli.js";

const args = parseArgs(process.argv.slice(2));
const releaseId = args["release-id"] ?? args._[0];
if (!releaseId) throw new Error("Usage: npm run validate:guide-release -- --release-id <releaseId>");
const result = validateRelease(path.join(ROOT, "releases", releaseId));
console.log(`Release valid: ${result.manifest.releaseId}`);
console.log(JSON.stringify(result.manifest.counts));
