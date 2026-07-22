import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const RELEASE_ID_PATTERN = /^guide-catalog-[a-z0-9][a-z0-9._-]+\+[a-f0-9]{12}$/;
const CONTENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]+$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9_]*$/;
const STATUSES = new Set(["approved", "review", "draft", "disabled"]);
const CATALOG_RELATIVE_PATH = "catalog/guideCatalog.json";

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

export function canonicalJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) errors.push("catalog must be an object");
  if (catalog?.schemaVersion !== 1) errors.push("catalog schemaVersion must be 1");
  if (!CONTENT_VERSION_PATTERN.test(catalog?.contentVersion ?? "")) errors.push("invalid contentVersion");
  if (!Array.isArray(catalog?.medications) || catalog.medications.length === 0) errors.push("medications must be a non-empty array");
  const ids = new Set();
  for (const [index, medication] of (catalog?.medications ?? []).entries()) {
    const prefix = `medications[${index}]`;
    if (!medication || typeof medication !== "object" || Array.isArray(medication)) { errors.push(`${prefix} must be an object`); continue; }
    if (!ID_PATTERN.test(medication.id ?? "")) errors.push(`${prefix}.id is invalid`);
    if (ids.has(medication.id)) errors.push(`${prefix}.id is duplicated`);
    ids.add(medication.id);
    if (!STATUSES.has(medication.status)) errors.push(`${prefix}.status is invalid`);
    if (typeof medication.enabled !== "boolean") errors.push(`${prefix}.enabled must be boolean`);
    if (medication.status === "disabled" && medication.enabled !== false) errors.push(`${prefix} disabled status requires enabled=false`);
    if (medication.enabled === false && medication.status !== "disabled") errors.push(`${prefix} enabled=false requires disabled status`);
    if (medication.status !== "disabled") {
      for (const field of ["name", "essential", "whyTaken", "goodToKnow", "whenToGetHelp"]) {
        if (!medication[field] || typeof medication[field].fr !== "string" || !medication[field].fr.trim() || typeof medication[field].en !== "string" || !medication[field].en.trim()) {
          errors.push(`${prefix}.${field} requires non-empty fr and en text`);
        }
      }
    }
  }
  if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join("\n- ")}`);
  return catalog;
}

export function countCatalog(catalog) {
  const counts = { totalCount: catalog.medications.length, approvedCount: 0, reviewCount: 0, draftCount: 0, disabledCount: 0 };
  for (const medication of catalog.medications) counts[`${medication.status}Count`] += 1;
  return counts;
}

export function normalizeCatalog(catalog, generatedAt) {
  validateCatalog(catalog);
  return {
    ...catalog,
    generatedAt,
    medications: [...catalog.medications].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function contentIdentity(catalog) {
  const identity = structuredClone(catalog);
  delete identity.generatedAt;
  return sha256(Buffer.from(canonicalJson(identity)));
}

export function releaseIdFor(catalog) {
  validateCatalog(catalog);
  return `guide-catalog-${catalog.contentVersion}+${contentIdentity(catalog).slice(0, 12)}`;
}

export function createManifest({ catalog, catalogBytes, sourceCommit, generatedAt, publicationSource = "canonical", minimumGuideVersion = "1.0.0", provenance }) {
  const releaseId = releaseIdFor(catalog);
  return {
    schemaVersion: "1.0.0",
    releaseId,
    contentVersion: catalog.contentVersion,
    generatedAt,
    sourceCommit,
    publicationSource,
    releaseStatus: "candidate",
    compatibility: { manifestSchema: "1.x", catalogSchema: "1.x", offlineCapable: true },
    minimumGuideVersion,
    files: [{
      path: CATALOG_RELATIVE_PATH,
      role: "guide-catalog",
      mediaType: "application/json",
      bytes: catalogBytes.length,
      sha256: sha256(catalogBytes),
      recordCount: catalog.medications.length,
      required: true,
    }],
    counts: countCatalog(catalog),
    provenance: {
      sourceRepository: provenance.sourceRepository,
      sourceCommit,
      importedAt: provenance.importedAt,
      clinicalSource: provenance.clinicalSource ?? null,
      clinicalSourceVersion: provenance.clinicalSourceVersion ?? null,
    },
  };
}

export function compileSchemas(root = ROOT) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const manifestSchema = readJson(path.join(root, "schema", "guide-release-manifest-1.0.0.schema.json"));
  const channelSchema = readJson(path.join(root, "schema", "guide-channel-pointer-1.0.0.schema.json"));
  return { validateManifestSchema: ajv.compile(manifestSchema), validateChannelSchema: ajv.compile(channelSchema) };
}

function assertSchema(validate, value, label) {
  if (!validate(value)) throw new Error(`${label} schema validation failed: ${JSON.stringify(validate.errors)}`);
}

export function prepareRelease({ catalog, sourceCommit, generatedAt, publicationSource, minimumGuideVersion, provenance, root = ROOT }) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("sourceCommit must be a full lowercase Git SHA");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generatedAt must be a valid date-time");
  const normalized = normalizeCatalog(catalog, generatedAt);
  const catalogBytes = Buffer.from(canonicalJson(normalized));
  const manifest = createManifest({ catalog: normalized, catalogBytes, sourceCommit, generatedAt, publicationSource, minimumGuideVersion, provenance });
  const { validateManifestSchema } = compileSchemas(root);
  assertSchema(validateManifestSchema, manifest, "manifest");
  return { releaseId: manifest.releaseId, catalog: normalized, catalogBytes, manifest, manifestBytes: Buffer.from(canonicalJson(manifest)) };
}

export function writeRelease(prepared, releasesRoot = path.join(ROOT, "releases")) {
  const releaseDir = path.join(releasesRoot, prepared.releaseId);
  if (fs.existsSync(releaseDir)) throw new Error(`Immutable release already exists: ${prepared.releaseId}`);
  const temporaryDir = path.join(releasesRoot, `.${prepared.releaseId}.${process.pid}.tmp`);
  if (fs.existsSync(temporaryDir)) throw new Error(`Temporary release path already exists: ${temporaryDir}`);
  fs.mkdirSync(path.join(temporaryDir, "catalog"), { recursive: true });
  try {
    fs.writeFileSync(path.join(temporaryDir, CATALOG_RELATIVE_PATH), prepared.catalogBytes, { flag: "wx" });
    fs.writeFileSync(path.join(temporaryDir, "manifest.json"), prepared.manifestBytes, { flag: "wx" });
    fs.renameSync(temporaryDir, releaseDir);
  } catch (error) {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  validateRelease(releaseDir);
  return releaseDir;
}

function safeReleaseFile(releaseDir, relativePath) {
  if (relativePath.includes("\\")) throw new Error(`Unsafe release path: ${relativePath}`);
  const resolved = path.resolve(releaseDir, relativePath);
  const prefix = `${path.resolve(releaseDir)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`Unsafe release path: ${relativePath}`);
  return resolved;
}

export function validateRelease(releaseDir, root = ROOT) {
  const resolvedDir = path.resolve(releaseDir);
  const manifestPath = path.join(resolvedDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Required manifest.json is missing");
  const manifest = readJson(manifestPath);
  const { validateManifestSchema } = compileSchemas(root);
  assertSchema(validateManifestSchema, manifest, "manifest");
  if (path.basename(resolvedDir) !== manifest.releaseId) throw new Error("releaseId does not match directory name");
  if (!RELEASE_ID_PATTERN.test(manifest.releaseId)) throw new Error("Invalid releaseId");
  const expectedFiles = new Set(["manifest.json"]);
  for (const file of manifest.files) {
    const filePath = safeReleaseFile(resolvedDir, file.path);
    expectedFiles.add(file.path.split("/").join(path.sep));
    if (!fs.existsSync(filePath)) throw new Error(`Required file is missing: ${file.path}`);
    const bytes = fs.readFileSync(filePath);
    if (bytes.length !== file.bytes) throw new Error(`Byte count mismatch: ${file.path}`);
    if (sha256(bytes) !== file.sha256) throw new Error(`SHA-256 mismatch: ${file.path}`);
    if (file.role !== "guide-catalog" || file.mediaType !== "application/json") throw new Error(`Unsupported file declaration: ${file.path}`);
    const catalog = validateCatalog(JSON.parse(bytes.toString("utf8")));
    if (catalog.medications.length !== file.recordCount) throw new Error("recordCount mismatch");
    if (catalog.contentVersion !== manifest.contentVersion) throw new Error("contentVersion mismatch");
    if (releaseIdFor(catalog) !== manifest.releaseId) throw new Error("releaseId does not match catalog identity");
    if (canonicalJson(countCatalog(catalog)) !== canonicalJson(manifest.counts)) throw new Error("Editorial counts mismatch");
  }
  const actualFiles = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else actualFiles.push(path.relative(resolvedDir, absolute));
    }
  };
  walk(resolvedDir);
  for (const actual of actualFiles) if (!expectedFiles.has(actual)) throw new Error(`Unexpected release file: ${actual}`);
  if (actualFiles.length !== expectedFiles.size) throw new Error("Release file set is incomplete");
  if (manifest.provenance.sourceCommit !== manifest.sourceCommit) throw new Error("Provenance sourceCommit mismatch");
  return { manifest, catalog: readJson(path.join(resolvedDir, CATALOG_RELATIVE_PATH)) };
}

export function validateChannel(pointer, root = ROOT) {
  const { validateChannelSchema } = compileSchemas(root);
  assertSchema(validateChannelSchema, pointer, "channel pointer");
  if (pointer.generation > 0) {
    const expectedPath = `releases/${pointer.releaseId}/manifest.json`;
    if (pointer.manifestPath !== expectedPath) throw new Error("manifestPath does not match releaseId");
    if (!pointer.releaseHistory.includes(pointer.releaseId)) throw new Error("active release is absent from releaseHistory");
    if (pointer.previousReleaseId !== null && !pointer.releaseHistory.includes(pointer.previousReleaseId)) throw new Error("previousReleaseId is absent from releaseHistory");
  }
  return pointer;
}

export function nextChannelPointer({ current, targetReleaseDir, approvalId, rollbackReason = null, rollback = false, promotedAt, root = ROOT }) {
  validateChannel(current, root);
  const { manifest } = validateRelease(targetReleaseDir, root);
  if (!approvalId?.trim()) throw new Error("approvalId is required");
  if (current.releaseId === manifest.releaseId) throw new Error("Target release is already active");
  if (rollback && !rollbackReason?.trim()) throw new Error("rollbackReason is required");
  if (rollback && !current.releaseHistory.includes(manifest.releaseId)) throw new Error("Rollback target has not previously been promoted");
  const history = [...new Set([...current.releaseHistory, manifest.releaseId])];
  const pointer = {
    schemaVersion: "1.0.0",
    channel: "stable",
    releaseId: manifest.releaseId,
    manifestPath: `releases/${manifest.releaseId}/manifest.json`,
    manifestSha256: sha256(fs.readFileSync(path.join(targetReleaseDir, "manifest.json"))),
    generation: current.generation + 1,
    promotedAt,
    previousReleaseId: current.releaseId,
    releaseHistory: history,
    rollbackReason: rollback ? rollbackReason : null,
    approvalId,
  };
  validateChannel(pointer, root);
  if (pointer.generation <= current.generation) throw new Error("Channel generation must increase monotonically");
  return pointer;
}

export function atomicWriteJson(filePath, value, { simulateInterruption = false } = {}) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, canonicalJson(value), { flag: "wx" });
  try {
    if (simulateInterruption) throw new Error("Simulated interruption before atomic replacement");
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function channelDiff(current, next) {
  return canonicalJson({ before: current, after: next });
}
