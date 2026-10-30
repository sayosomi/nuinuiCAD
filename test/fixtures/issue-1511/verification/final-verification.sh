(
  cd /Users/yosomi/Code/nuinuiCAD || exit 1
  npm test -- --maxWorkers=2 src/geometry/evaluate.test.ts src/dsl/transformationRecipes.test.ts || exit 1
  cargo test --manifest-path rust-evaluator/Cargo.toml edge_tests || exit 1
  cargo test --manifest-path rust-evaluator/Cargo.toml extend_trim_tests || exit 1
  npm run build || exit 1
  npm run lint || exit 1
  npm test -- --maxWorkers=2 || exit 1
  npm run test:parity || exit 1
  npm run docs:dsl:check || exit 1
  cargo fmt --manifest-path rust-evaluator/Cargo.toml --check || exit 1
  cargo check --manifest-path rust-evaluator/Cargo.toml || exit 1
  cargo test --manifest-path rust-evaluator/Cargo.toml || exit 1
  cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings || exit 1
  git diff --check || exit 1
)
