(
  cd /Users/yosomi/Code/nuinuiCAD || exit 1

  npm run build &&
  npm run lint &&
  npm test -- --maxWorkers=2 --no-file-parallelism &&
  npm run test:parity &&
  git diff --check
)
