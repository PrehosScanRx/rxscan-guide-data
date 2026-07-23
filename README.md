# RxScan Guide Data

Public, versioned medication guidance for patients, families, and caregivers. It
does not contain the professional clinical content used by RxScan Paramedic and
does not replace advice from a qualified healthcare professional.

## Publication model

The editorial path remains deliberately simple:

`Word -> ChatGPT -> Codex -> catalog/guideCatalog.json -> immutable release -> Stable -> Guide`

- Word is the human clinical/editorial source.
- ChatGPT assists with drafting and review; it is not the publication authority.
- Codex applies the approved text to the canonical catalogue and runs the checks.
- `catalog/guideCatalog.json` is the canonical publication input in this repository.
- `releases/<releaseId>/` contains immutable, hashed candidate releases.
- `channels/stable.json` is the only mutable deployment pointer.
- Guide follows Stable; building a release alone changes nothing for users.

The root `manifest.json` is the historical pre-release-architecture manifest. It
remains for compatibility during migration but is not an immutable release
manifest and must not be used for new promotions.

## Commands

```text
npm run validate:catalog
npm run build:guide-release -- --dry-run
npm run build:guide-release
npm run validate:guide-release -- --release-id <releaseId>
npm run promote:guide-stable -- --release-id <releaseId> --approval-id <id> --dry-run
npm run rollback:guide-stable -- --release-id <releaseId> --approval-id <id> --rollback-reason "<reason>" --dry-run
npm test
```

New RX_ID-linked candidates additionally require `--guide-source-commit`,
`--medication-directory`, and `--medication-directory-provenance`. The build
then checks every Guide card against that exact Medication Directory before it
can create an immutable release. Historical catalogues without `rxId` continue
to use the original contract.

`build:guide-release` validates and creates a candidate; it never promotes it.
Promotion and rollback print the proposed pointer diff first. Without `--dry-run`,
they additionally require `--confirm`. Rollback always requires a reason.

See [Guide Data release operations](docs/guide-data-release-operations.md) for
the complete operating procedure.
