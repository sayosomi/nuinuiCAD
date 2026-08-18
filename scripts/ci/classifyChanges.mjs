import { readFileSync } from "node:fs";

const OUTPUT_KEYS = [
  "node",
  "full_node",
  "vscode",
  "rust",
  "parity",
  "workflow",
  "unknown"
];

const POLICY_FILES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CODE_OF_CONDUCT",
  "CODEOWNERS",
  "CONTRIBUTING",
  "LICENSE"
]);

const PARITY_SOURCE_DIRECTORIES = [
  "src/document/",
  "src/dsl/",
  "src/scalars/",
  "src/model/",
  "src/geometry/"
];

const FULL_NODE_FILES = new Set([
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "eslint.config.js"
]);

const fullCheckFlags = () => ({
  node: true,
  full_node: true,
  vscode: true,
  rust: true,
  parity: true,
  workflow: false,
  unknown: true
});

const emptyFlags = () => ({
  node: false,
  full_node: false,
  vscode: false,
  rust: false,
  parity: false,
  workflow: false,
  unknown: false
});

const isTestOnlyPath = (path) =>
  /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(path) ||
  /(?:^|\/)[^/]+\.(?:test|spec)(?:\.[^/]+)+$/.test(path);

const isDocumentationPath = (path) =>
  path.startsWith("docs/") ||
  path.startsWith(".claude/") ||
  path.endsWith(".md") ||
  POLICY_FILES.has(path) ||
  [...POLICY_FILES].some((file) => path.endsWith(`/${file}`));

const isParityTestPath = (path) =>
  /^test\/evaluationParity[^/]*$/.test(path) ||
  path.startsWith("test/fixtures/evaluation/");

const isParitySourcePath = (path) =>
  path === "src/types/geometry.ts" ||
  PARITY_SOURCE_DIRECTORIES.some((directory) => path.startsWith(directory));

const isFullNodePath = (path) =>
  FULL_NODE_FILES.has(path) ||
  /(?:^|\/)tsconfig[^/]*\.json$/.test(path) ||
  path === "vscode-extension/package.json" ||
  path === "vscode-extension/tsconfig.json";

const isRootNodeInput = (path) =>
  path === "index.html" ||
  path.startsWith("public/") ||
  (!path.includes("/") &&
    /\.(?:css|html|js|json|mjs|cjs|ts|tsx)$/.test(path));

const isRustPath = (path) => path.startsWith("src-tauri/");

const isRustParityPath = (path) =>
  path.startsWith("src-tauri/src/evaluation/") ||
  path === "src-tauri/examples/evaluate_fixture.rs";

const classifyPath = (path) => {
  if (isDocumentationPath(path)) {
    return emptyFlags();
  }

  if (path.startsWith(".github/workflows/") || path.startsWith("scripts/ci/")) {
    const flags = emptyFlags();
    flags.workflow = true;
    return flags;
  }

  if (isRustPath(path)) {
    const flags = emptyFlags();
    flags.rust = true;
    flags.parity = isRustParityPath(path);
    return flags;
  }

  if (isParityTestPath(path)) {
    const flags = emptyFlags();
    flags.parity = true;
    return flags;
  }

  if (isFullNodePath(path)) {
    const flags = emptyFlags();
    flags.node = true;
    flags.full_node = true;
    flags.vscode =
      path === "package.json" ||
      path === "package-lock.json" ||
      path.startsWith("vscode-extension/");
    return flags;
  }

  if (path.startsWith("src/") ||
      path.startsWith("test/") ||
      path.startsWith("vscode-extension/") ||
      (path.startsWith("scripts/") && !path.startsWith("scripts/ci/")) ||
      isRootNodeInput(path)) {
    const flags = emptyFlags();
    flags.node = true;

    const testOnly = isTestOnlyPath(path);
    const productionSource = path.startsWith("src/") && !testOnly;
    const paritySource = productionSource && isParitySourcePath(path);

    flags.vscode =
      !testOnly &&
      (productionSource ||
        path.startsWith("vscode-extension/") ||
        path.startsWith("scripts/vscode/"));
    flags.parity = paritySource;
    flags.full_node = paritySource;
    return flags;
  }

  return null;
};

export function classifyChangedPaths(paths = []) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return fullCheckFlags();
  }

  const result = emptyFlags();
  for (const path of paths) {
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.includes("\0") ||
      path.startsWith("/") ||
      path.startsWith("../") ||
      path.includes("/../")
    ) {
      return fullCheckFlags();
    }

    const flags = classifyPath(path);
    if (flags === null) {
      return fullCheckFlags();
    }

    for (const key of OUTPUT_KEYS) {
      result[key] ||= flags[key];
    }
  }

  return result;
}

const outputLines = (flags) =>
  OUTPUT_KEYS.map((key) => `${key}=${flags[key]}`).join("\n");

const runCli = () => {
  const fullMode = process.argv.slice(2).includes("--full");
  const input = readFileSync(0);
  const paths = input
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
  const flags = fullMode ? fullCheckFlags() : classifyChangedPaths(paths);
  process.stdout.write(`${outputLines(flags)}\n`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
