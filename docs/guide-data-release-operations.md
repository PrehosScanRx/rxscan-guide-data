# Guide Data release operations

## Boundaries and states

The human-approved Word document is the editorial source. ChatGPT may help turn
it into bilingual patient-facing copy. Codex applies reviewed content to
`catalog/guideCatalog.json`, which is the canonical machine-readable input.
There is no separate editorial interface.

Medication statuses retain their explicit meaning throughout the pipeline:

- `approved`: eligible to appear in Guide;
- `review`: retained in a release but never promoted to approved automatically;
- `draft`: retained as unfinished content and never treated as approved;
- `disabled`: explicitly unavailable and paired with `enabled: false`.

## Build a candidate

1. Update the canonical catalogue through the reviewed Word/ChatGPT/Codex flow.
2. Run `npm run validate:catalog`.
3. Preview with `npm run build:guide-release -- --dry-run`.
4. Build with `npm run build:guide-release`.
5. Validate with `npm run validate:guide-release -- --release-id <releaseId>`.
6. Review and commit the new `releases/<releaseId>/` directory.

Building never changes Stable. The generator sorts catalogue records, emits
canonical object-key order, hashes the exact UTF-8 bytes, and refuses to replace
an existing release directory. Its generation timestamp is derived from the
source commit unless explicitly supplied, so the same source and provenance
produce identical output.

## Validate a release

Validation compiles the Draft 2020-12 schemas and checks the directory name,
release identifier, safe paths, required and unexpected files, exact byte count,
SHA-256, media type, record count, editorial counters, content version,
catalogue rules, and provenance. Any partial or inconsistent release is rejected.

Run all automated corruption and transition fixtures with `npm test`.

## Promote Stable

First inspect the proposed transition:

```text
npm run promote:guide-stable -- --release-id <releaseId> --approval-id <approval> --dry-run
```

After human approval, repeat without `--dry-run` and add `--confirm`. The command
fully revalidates the release and current pointer, increments `generation`, sets
`previousReleaseId`, records the manifest SHA-256 and approval, and replaces the
pointer atomically. It never edits the release.

Promotion is intentionally separate from build and is never automatic.

## Roll back Stable

A rollback repoints Stable to a release already present in `releaseHistory`:

```text
npm run rollback:guide-stable -- --release-id <oldReleaseId> --approval-id <approval> --rollback-reason "<reason>" --dry-run
```

Review the diff, then repeat with `--confirm` and without `--dry-run`. The target
is fully revalidated, `generation` increases, the formerly active release becomes
`previousReleaseId`, and the reason is recorded. The old immutable release is
not rewritten. Guide can consume the pointer change without a new application build.

## Human confirmations

Automated: catalogue validation, deterministic generation, hashing, manifest
validation, release cross-validation, and calculation of a proposed channel
transition.

Human confirmation required: approving editorial content, committing a release,
promoting Stable, and authorizing rollback with a documented reason.
