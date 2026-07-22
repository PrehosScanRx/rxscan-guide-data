import childProcess from "node:child_process";
import path from "node:path";
import { ROOT, prepareRelease, readJson, writeRelease } from "../lib/guide-releases.js";
import { parseArgs } from "./cli.js";

function git(...args) {
  return childProcess.execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const args = parseArgs(process.argv.slice(2));
const catalogPath = path.resolve(args.catalog ?? path.join(ROOT, "catalog", "guideCatalog.json"));
const relativeCatalog = path.relative(ROOT, catalogPath).split(path.sep).join("/");
const sourceCommit = args["source-commit"] ?? git("log", "-1", "--format=%H", "--", relativeCatalog);
const generatedAt = args["generated-at"] ?? git("show", "-s", "--format=%cI", sourceCommit);
const prepared = prepareRelease({
  catalog: readJson(catalogPath),
  sourceCommit,
  generatedAt,
  publicationSource: args["publication-source"] ?? "canonical",
  minimumGuideVersion: args["minimum-guide-version"] ?? "1.0.0",
  provenance: {
    sourceRepository: args["source-repository"] ?? "PrehosScanRx/rxscan-guide-data",
    importedAt: args["imported-at"] ?? generatedAt,
    clinicalSource: args["clinical-source"] ?? null,
    clinicalSourceVersion: args["clinical-source-version"] ?? null,
  },
});
console.log(`Release candidate: ${prepared.releaseId}`);
console.log(`Catalog SHA-256: ${prepared.manifest.files[0].sha256}`);
console.log(JSON.stringify(prepared.manifest.counts));
if (args["dry-run"]) console.log("Dry run: no release written.");
else console.log(`Written: ${writeRelease(prepared, path.join(ROOT, "releases"))}`);
