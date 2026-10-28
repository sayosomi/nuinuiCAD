# Shared nominal record fixtures

The oracle is Issue #1439's approved language contract and `docs/nui1/spec.md`.
These fixtures are retained as executable language regressions.

- `seam.nui`, `facade.nui`, `modules.nui`, and `root.nui` exercise public/private
  record publication, original identity through re-export, nested scalar,
  optional-record, record-array, number-array and point fields, and asymmetric
  Module parameter/local/export forwarding. `observations.json` fixes the
  numeric observations; the Result point is independently `(23 + 7, 29 + 7)`.
- `same-document.nui` is the neighboring same-file control, with the same
  independent observations and geometry expectation.
- `wrappers.nui` covers qualified constructors under `if` and `??`, optional
  array elements and containers, nested constructor fields, imported Module
  factories, optional array forwarding and two-level Module array forwarding.
  Module-local statement indices overlap caller indices to exercise source
  ownership of runtime event positions. Its explicit numeric oracle is in the
  integration test.
- `illegal.json` freezes invalid constructor/type/publication source fragments
  and their diagnostic codes. The semantic tests also cover private/missing
  facade members, import cycles, lexical shadowing, saved fingerprint changes,
  nominal mismatch through Modules/arrays and forwarded parameters, repeated local IDs in different
  documents, optional-to-required rejection, and caller source ownership.
- `no-import-undefined.nui` freezes F-01's unresolved qualified type and
  constructor without an import. It must fail source-graph validation with
  diagnostics on the authored names. Tests also reject an invalid saved leaf,
  cover other record type positions, and retain a real-import positive control.

`issue1439RecordImportsRust.integration.test.ts` asserts observations separately
on the TypeScript reference and normal persistent Rust stdio payloads, then
compares their complete normalized results. Rust eligibility must be true.
No import loading or source parsing is introduced in Rust.

Parser/AST, shared type resolution, public catalog, Module semantics, lowering,
runtime values and source occurrence ownership are affected. Native host UI,
completion, imported record rename/navigation features and new commands are
outside this Issue; existing host-neutral queries must retain source ownership.
