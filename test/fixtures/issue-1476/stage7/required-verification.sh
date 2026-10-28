(
  cd /Users/yosomi/Code/nuinuiCAD || {
    echo "ERROR: implementation checkout unavailable"
    exit 1
  }
  set -e

  cargo fmt --manifest-path rust-evaluator/Cargo.toml --check
  cargo check --manifest-path rust-evaluator/Cargo.toml
  cargo test --manifest-path rust-evaluator/Cargo.toml
  cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings
  npm run test:parity
  VITE_RUN_PERFORMANCE_GATES=1 npm test -- test/issue1474DependencyTopology.performance.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --disableConsoleIntercept
  npm test
  git diff --check
)
