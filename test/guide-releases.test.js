import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ROOT,
  atomicWriteJson,
  canonicalJson,
  compileSchemas,
  countCatalog,
  nextChannelPointer,
  prepareRelease,
  readJson,
  releaseIdFor,
  sha256,
  validateCatalog,
  validateChannel,
  validateRelease,
  writeRelease,
} from "../lib/guide-releases.js";

const SOURCE_82 = "34b08ac46b96bc977b5d4d146fc587d2b817a1b5";
const SOURCE_88 = "78002003c232b245793984006d9166f4c65339d5";
const FIXED_TIME_82 = "2026-07-14T05:02:38.745Z";
const FIXED_TIME_88 = "2026-07-15T18:46:45.850Z";

function gitJson(commit, file) {
  return JSON.parse(childProcess.execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, encoding: "utf8" }));
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guide-release-test-"));
  fs.cpSync(path.join(ROOT, "schema"), path.join(root, "schema"), { recursive: true });
  fs.mkdirSync(path.join(root, "releases"));
  fs.mkdirSync(path.join(root, "channels"));
  return root;
}

function initialPointer() {
  return {
    approvalId: null,
    channel: "stable",
    generation: 0,
    manifestPath: null,
    manifestSha256: null,
    previousReleaseId: null,
    promotedAt: null,
    releaseId: null,
    releaseHistory: [],
    rollbackReason: null,
    schemaVersion: "1.0.0",
  };
}

function prepare(catalog, sourceCommit, generatedAt, root) {
  return prepareRelease({
    catalog,
    sourceCommit,
    generatedAt,
    publicationSource: "fixture",
    minimumGuideVersion: "1.0.0",
    provenance: {
      sourceRepository: "PrehosScanRx/rxscan-guide-data",
      importedAt: generatedAt,
      clinicalSource: "test fixture",
      clinicalSourceVersion: catalog.contentVersion,
    },
    root,
  });
}

function cloneRelease(source) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guide-release-copy-"));
  const destination = path.join(parent, path.basename(source));
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

function rewriteJson(file, mutate) {
  const value = readJson(file);
  mutate(value);
  fs.writeFileSync(file, canonicalJson(value));
}

test("Draft 2020-12 schemas compile and reject malformed values", () => {
  const { validateManifestSchema, validateChannelSchema } = compileSchemas(ROOT);
  const root = workspace();
  const prepared = prepare(gitJson(SOURCE_82, "catalog/guideCatalog.json"), SOURCE_82, FIXED_TIME_82, root);
  assert.equal(validateManifestSchema(prepared.manifest), true);
  assert.equal(validateChannelSchema(initialPointer()), true);
  for (const mutation of [
    (value) => delete value.contentVersion,
    (value) => { value.counts.totalCount = "82"; },
    (value) => { value.unexpected = true; },
    (value) => { value.files[0].path = "../catalog.json"; },
    (value) => { value.files[0].sha256 = "bad"; },
    (value) => { value.releaseId = "invalid release"; },
  ]) {
    const candidate = structuredClone(prepared.manifest);
    mutation(candidate);
    assert.equal(validateManifestSchema(candidate), false);
  }
});

test("82-card release is deterministic and fully valid", () => {
  const root = workspace();
  const catalog = gitJson(SOURCE_82, "catalog/guideCatalog.json");
  const first = prepare(catalog, SOURCE_82, FIXED_TIME_82, root);
  const second = prepare(catalog, SOURCE_82, FIXED_TIME_82, root);
  assert.equal(first.releaseId, second.releaseId);
  assert.equal(first.catalogBytes.equals(second.catalogBytes), true);
  assert.equal(first.manifest.files[0].sha256, second.manifest.files[0].sha256);
  assert.deepEqual(first.manifest.counts, { totalCount: 82, approvedCount: 82, reviewCount: 0, draftCount: 0, disabledCount: 0 });
  const releaseDir = writeRelease(first, path.join(root, "releases"));
  assert.equal(validateRelease(releaseDir, root).manifest.releaseId, first.releaseId);
  assert.throws(() => writeRelease(first, path.join(root, "releases")), /already exists/);
});

test("88-card saved publication remains review-safe and valid", () => {
  const root = workspace();
  const catalog = gitJson(SOURCE_88, "catalog/guideCatalog.json");
  const prepared = prepare(catalog, SOURCE_88, FIXED_TIME_88, root);
  assert.deepEqual(countCatalog(prepared.catalog), { totalCount: 88, approvedCount: 82, reviewCount: 6, draftCount: 0, disabledCount: 0 });
  assert.equal(prepared.catalog.medications.filter((item) => item.status === "review").every((item) => item.status !== "approved"), true);
  const releaseDir = writeRelease(prepared, path.join(root, "releases"));
  assert.equal(validateRelease(releaseDir, root).manifest.counts.reviewCount, 6);
});

test("release identity changes with content and rejects invalid contentVersion", () => {
  const catalog = gitJson(SOURCE_82, "catalog/guideCatalog.json");
  const same = structuredClone(catalog);
  same.generatedAt = "2099-01-01T00:00:00.000Z";
  assert.equal(releaseIdFor(catalog), releaseIdFor(same), "generatedAt must not affect content identity");
  const changed = structuredClone(catalog);
  changed.medications[0].essential.en += " Changed.";
  assert.notEqual(releaseIdFor(catalog), releaseIdFor(changed));
  const invalid = structuredClone(catalog);
  invalid.contentVersion = "Invalid Version";
  assert.throws(() => validateCatalog(invalid), /contentVersion/);
});

test("cross-validation rejects all material release corruptions", () => {
  const root = workspace();
  const prepared = prepare(gitJson(SOURCE_82, "catalog/guideCatalog.json"), SOURCE_82, FIXED_TIME_82, root);
  const releaseDir = writeRelease(prepared, path.join(root, "releases"));
  const cases = [
    ["catalog altered", (dir) => fs.appendFileSync(path.join(dir, "catalog", "guideCatalog.json"), " "), /Byte count mismatch|SHA-256 mismatch/],
    ["manifest hash", (dir) => rewriteJson(path.join(dir, "manifest.json"), (m) => { m.files[0].sha256 = "0".repeat(64); }), /SHA-256 mismatch/],
    ["manifest bytes", (dir) => rewriteJson(path.join(dir, "manifest.json"), (m) => { m.files[0].bytes += 1; }), /Byte count mismatch/],
    ["recordCount", (dir) => rewriteJson(path.join(dir, "manifest.json"), (m) => { m.files[0].recordCount += 1; }), /recordCount mismatch/],
    ["counts", (dir) => rewriteJson(path.join(dir, "manifest.json"), (m) => { m.counts.approvedCount -= 1; }), /counts mismatch/i],
    ["contentVersion", (dir) => rewriteJson(path.join(dir, "manifest.json"), (m) => { m.contentVersion = "wrong-version"; }), /contentVersion mismatch/],
    ["releaseId", (dir) => rewriteJson(path.join(dir, "manifest.json"), (m) => { m.releaseId = `guide-catalog-wrong+${"0".repeat(12)}`; }), /directory name/],
    ["missing file", (dir) => fs.rmSync(path.join(dir, "catalog", "guideCatalog.json")), /Required file is missing/],
    ["unexpected file", (dir) => fs.writeFileSync(path.join(dir, "unexpected.txt"), "x"), /Unexpected release file/],
  ];
  for (const [label, mutate, expected] of cases) {
    const copy = cloneRelease(releaseDir);
    mutate(copy);
    assert.throws(() => validateRelease(copy, root), expected, label);
  }
});

test("promotion and rollback are monotone, validated, and atomically writable", () => {
  const root = workspace();
  const release82 = prepare(gitJson(SOURCE_82, "catalog/guideCatalog.json"), SOURCE_82, FIXED_TIME_82, root);
  const release88 = prepare(gitJson(SOURCE_88, "catalog/guideCatalog.json"), SOURCE_88, FIXED_TIME_88, root);
  const dir82 = writeRelease(release82, path.join(root, "releases"));
  const dir88 = writeRelease(release88, path.join(root, "releases"));
  const first = nextChannelPointer({ current: initialPointer(), targetReleaseDir: dir82, approvalId: "APPROVAL-1", promotedAt: "2026-07-21T20:00:00.000Z", root });
  assert.equal(first.generation, 1);
  assert.equal(first.previousReleaseId, null);
  const second = nextChannelPointer({ current: first, targetReleaseDir: dir88, approvalId: "APPROVAL-2", promotedAt: "2026-07-21T21:00:00.000Z", root });
  assert.equal(second.generation, 2);
  assert.equal(second.previousReleaseId, first.releaseId);
  assert.throws(() => nextChannelPointer({ current: second, targetReleaseDir: dir88, approvalId: "APPROVAL-3", promotedAt: FIXED_TIME_88, root }), /already active/);
  assert.throws(() => nextChannelPointer({ current: second, targetReleaseDir: dir82, approvalId: "APPROVAL-3", rollback: true, promotedAt: FIXED_TIME_88, root }), /rollbackReason/);
  const rolledBack = nextChannelPointer({ current: second, targetReleaseDir: dir82, approvalId: "APPROVAL-3", rollback: true, rollbackReason: "Operational rollback test", promotedAt: "2026-07-21T22:00:00.000Z", root });
  assert.equal(rolledBack.generation, 3);
  assert.equal(rolledBack.previousReleaseId, second.releaseId);
  assert.equal(rolledBack.rollbackReason, "Operational rollback test");
  assert.deepEqual(rolledBack.releaseHistory, [first.releaseId, second.releaseId]);
  validateChannel(rolledBack, root);

  const unknownCatalog = structuredClone(gitJson(SOURCE_82, "catalog/guideCatalog.json"));
  unknownCatalog.contentVersion = "unknown-release";
  const unknown = prepare(unknownCatalog, SOURCE_82, FIXED_TIME_82, root);
  const unknownDir = writeRelease(unknown, path.join(root, "releases"));
  assert.throws(() => nextChannelPointer({ current: second, targetReleaseDir: unknownDir, approvalId: "APPROVAL-4", rollback: true, rollbackReason: "Unknown", promotedAt: FIXED_TIME_88, root }), /not previously been promoted/);

  const pointerPath = path.join(root, "channels", "stable.json");
  fs.writeFileSync(pointerPath, canonicalJson(second));
  assert.throws(() => atomicWriteJson(pointerPath, rolledBack, { simulateInterruption: true }), /Simulated interruption/);
  assert.deepEqual(readJson(pointerPath), second, "interruption must preserve current pointer");
  atomicWriteJson(pointerPath, rolledBack);
  assert.deepEqual(readJson(pointerPath), rolledBack);
  assert.equal(sha256(fs.readFileSync(path.join(dir82, "manifest.json"))), rolledBack.manifestSha256);
});

test("promotion and rollback CLI dry-runs never modify their channel", () => {
  const root = workspace();
  const release82 = prepare(gitJson(SOURCE_82, "catalog/guideCatalog.json"), SOURCE_82, FIXED_TIME_82, root);
  const release88 = prepare(gitJson(SOURCE_88, "catalog/guideCatalog.json"), SOURCE_88, FIXED_TIME_88, root);
  const dir82 = writeRelease(release82, path.join(root, "releases"));
  const dir88 = writeRelease(release88, path.join(root, "releases"));
  const pointerPath = path.join(root, "channels", "stable.json");
  fs.writeFileSync(pointerPath, canonicalJson(initialPointer()));
  const beforePromotion = fs.readFileSync(pointerPath);
  const promotion = childProcess.execFileSync(process.execPath, [
    path.join(ROOT, "scripts", "promote-guide-stable.js"),
    "--release-id", release82.releaseId,
    "--release-dir", dir82,
    "--channel-path", pointerPath,
    "--approval-id", "DRY-RUN-1",
    "--promoted-at", "2026-07-21T20:00:00.000Z",
    "--dry-run",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.match(promotion, /Dry run: Stable was not modified/);
  assert.equal(fs.readFileSync(pointerPath).equals(beforePromotion), true);

  const first = nextChannelPointer({ current: initialPointer(), targetReleaseDir: dir82, approvalId: "APPROVAL-1", promotedAt: "2026-07-21T20:00:00.000Z", root });
  const second = nextChannelPointer({ current: first, targetReleaseDir: dir88, approvalId: "APPROVAL-2", promotedAt: "2026-07-21T21:00:00.000Z", root });
  fs.writeFileSync(pointerPath, canonicalJson(second));
  const beforeRollback = fs.readFileSync(pointerPath);
  const rollback = childProcess.execFileSync(process.execPath, [
    path.join(ROOT, "scripts", "rollback-guide-stable.js"),
    "--release-id", release82.releaseId,
    "--release-dir", dir82,
    "--channel-path", pointerPath,
    "--approval-id", "DRY-RUN-2",
    "--rollback-reason", "Dry-run verification",
    "--promoted-at", "2026-07-21T22:00:00.000Z",
    "--dry-run",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.match(rollback, /Dry run: Stable was not modified/);
  assert.equal(fs.readFileSync(pointerPath).equals(beforeRollback), true);
});
