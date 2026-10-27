set -x
(
  cd /Users/yosomi/Code/nuinuiCAD || exit 1

  npm run build &&
  npm run lint &&
  npm test -- --maxWorkers=2 --no-file-parallelism &&
  npm run test:parity &&
  cargo fmt --manifest-path rust-evaluator/Cargo.toml -- --check &&
  cargo check --manifest-path rust-evaluator/Cargo.toml &&
  cargo test --manifest-path rust-evaluator/Cargo.toml &&
  cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings &&
  cargo build --manifest-path rust-evaluator/Cargo.toml --bin evaluation_stdio &&
  git diff --check
)
