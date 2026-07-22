# Immutable Guide editorial releases

Each child directory is an append-only candidate release. Once committed, its
files must never be changed, moved, or deleted. Corrections require a new
release ID. Channel promotion changes only `channels/stable.json`.

Each release has exactly this shape:

```text
releases/<releaseId>/
  manifest.json
  catalog/
    guideCatalog.json
```

The identifier is `guide-catalog-<contentVersion>+<contentHash12>`. The hash
fragment excludes `generatedAt`, keeping content identity stable when only
temporal metadata changes. The manifest records the exact catalogue byte count
and full SHA-256. A release is valid only when schema, identity, path, byte,
hash, record, counter, content-version, provenance, and file-set checks pass.

Never edit an existing release. Generate a new release for every correction.
