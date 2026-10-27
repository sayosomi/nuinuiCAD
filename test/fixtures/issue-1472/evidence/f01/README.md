# F-01 follow-up evidence

Continuation checkpoint: `67ae1eb2cf05659e48ec16bf104e69e57a6082ef`.
Review: https://github.com/sayosomi/nuinuiCAD/issues/1472#issuecomment-6433931790

The only executable change is in `test/issue1472AsyncPublication.test.ts`.
Its suite-level `beforeAll` now synchronously runs:

```text
cargo build --quiet --manifest-path rust-evaluator/Cargo.toml --bin evaluation_stdio
```

The build timeout is 120,000 ms; the hook timeout is 125,000 ms, matching the
existing #1470 pattern. Tests and the persistent Rust process start only after
this build succeeds. The one-process/three-source control, analytic geometry,
request/close deadlines and teardown listeners are preserved. No production,
Rust source, frozen oracle, CI configuration or assertion changed.

The prebuilt-binary prerequisite described in the original historical report is
superseded by this correction. Original report, fixtures and evidence remain
byte-identical to the continuation checkpoint; `preservation.json` records their
hashes. This folder contains additive F-01 evidence only. No new exploration
unit or product defect family is counted.

Verification before the complete gate:

- Hook + #1472 corpus: 32 tests in 2 files PASS, exit 0 (`focused.log.gz`).
- #1472 alone: 21 tests PASS, exit 0 (`standalone.log.gz`). This run includes its own
  Rust build/control and no unrelated test file initialization.
- The complete gate executes the unchanged parent `gate-command.sh`, once, in
  the original order. Its result is recorded in `gate-result.json` and `gate.log.gz`.

Manual E2E remains Not Required. No Human GUI result is claimed. Independent
review of the new pushed HEAD and protected CI remain separate gates.

Complete gate: **PASS**, one run, overall exit 0. In the prescribed order: build 0; lint 0; full tests 0 (11,225 passed, 187 existing skips); parity 0 (207 passed); diff check 0. No new skip or assertion change. Original artifacts were rechecked unchanged after the gate. Owned processes were cleaned up.
