# Verification record — Issue 1458

Base: `c3ce5409f4124a1d9600ebf3bfb1b84190eb562a`.
Production candidate: only SVG text coordinate serialization and its existing
module-test expectations differ from Base. All other changes are authorized
source/oracle/artifact verification fixtures and the output test.

## Focused checks

- Existing TypeScript outputCore + #1456 tests: PASS (49 tests).
- New actual-file matrix on unchanged Base production: 26 unit tests pass;
  S7, X4 and F1 fail solely on SVG glyph ascent. Four failing SVG variants,
  with all same-source PDF and vector neighbors passing. One distinct family.
- New actual-file matrix on repaired candidate: PASS (29 units, 59 variants,
  73 real files plus 3 error/preservation observations; 32 isolated oracle
  sensitivity assertions). Repeated after adding schedule, resource and stale
  artifact discrimination and tightening numeric tolerance; every final run
  passed. Earlier failed runs reflected corrected harness syntax/assertion
  mistakes or the established Base defect; no unchanged failing run was retried
  to obtain a pass.
- Rust output module tests: PASS (26).
- Rust evaluation_stdio tests: PASS (6).
- Focused cargo fmt/check: PASS.
- Preliminary build: PASS. Preliminary lint found a test-local `prefer-const`
  error, which was corrected; subsequent preliminary build/lint passed.

## Required final block

Executed verbatim in the admitted checkout:

```sh
(
  cd /Users/yosomi/Code/nuinuiCAD || exit 1
  npm run build &&
  npm run lint &&
  npm test -- --maxWorkers=2 &&
  npm run test:parity &&
  cargo fmt --manifest-path rust-evaluator/Cargo.toml --all -- --check &&
  cargo check --manifest-path rust-evaluator/Cargo.toml &&
  cargo test --manifest-path rust-evaluator/Cargo.toml &&
  cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings &&
  git diff --check
)
```

The complete block exited **0**. Actual outcomes:

| Gate | Outcome |
| --- | --- |
| `npm run build` | PASS, including Language Core typecheck and MCP build |
| `npm run lint` | PASS |
| `npm test -- --maxWorkers=2` | PASS: 687 files / 11,044 tests passed; 2 files / 183 tests skipped under existing suite configuration |
| `npm run test:parity` | PASS: 203 tests |
| `cargo fmt --manifest-path rust-evaluator/Cargo.toml --all -- --check` | PASS |
| `cargo check --manifest-path rust-evaluator/Cargo.toml` | PASS |
| `cargo test --manifest-path rust-evaluator/Cargo.toml` | PASS: 617 library + 6 stdio + 1 integration tests; 9 existing ignored library tests; 0 doc tests |
| `cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings` | PASS |
| `git diff --check` | PASS |

No failing, unavailable or unexecuted required gate remains. No commands were
substituted or CI weakened. The new actual-file matrix runs by default in the
npm suite. Only evidence documentation was finalized after this block;
`git diff --check` was run again before commit.

GitHub protected CI and independent exact-pushed-HEAD review are pending handoff.
Human Manual GUI E2E is not required for these host-neutral output changes.
Human-observed weekly/five-hour before/after usage: UNAVAILABLE.
