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
  "eslint.config.js",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vscode-extension/package.json",
  "vscode-extension/tsconfig.json",
  "vscode-extension/language-configuration.json"
]);

const LIFECYCLE_STRESS_RUNNER = "scripts/ci/runLifecycleStress.mjs";
const TEST_BACKED_DOCUMENTATION_PREFIX = "docs/module/manual-fixtures/";

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
  (path.startsWith("docs/") && path.endsWith(".md")) ||
  path.startsWith(".claude/") ||
  path.endsWith(".md") ||
  POLICY_FILES.has(path) ||
  [...POLICY_FILES].some((file) => path.endsWith(`/${file}`));

const isDslReferencePath = (path) =>
  path === "docs/dsl.md" || path.startsWith("docs/dsl/");

const isParityTestPath = (path) =>
  path.startsWith("test/fixtures/evaluation/");

const isParitySourcePath = (path) =>
  path === "src/types/geometry.ts" ||
  PARITY_SOURCE_DIRECTORIES.some((directory) => path.startsWith(directory));

const isFullNodePath = (path) =>
  FULL_NODE_FILES.has(path) ||
  path.startsWith("vscode-extension/syntaxes/");

const isRootNodeInput = (path) =>
  path === "index.html" ||
  path.startsWith("public/");

const isRustPath = (path) =>
  path.startsWith("rust-evaluator/");

const isRustParityPath = (path) =>
  path.startsWith("rust-evaluator/src/evaluation/") ||
  path === "rust-evaluator/examples/evaluate_fixture.rs";

const isSharedRustFixturePath = (path) =>
  path === "test/fixtures/typed-expressions.json" ||
  path.startsWith("test/fixtures/scalars/");

const isKnownFixturePath = (path) => path.startsWith("test/fixtures/");

const isRustIntegrationTestPath = (path) =>
  /^test\/[^/]+Rust\.integration\.test\.ts$/.test(path);

const isEvaluationParitySupportPath = (path) =>
  path === "test/evaluationParitySupport.ts";

const isTestBackedDocumentationPath = (path) =>
  path === "docs/command-id-map.md" ||
  path.startsWith(TEST_BACKED_DOCUMENTATION_PREFIX);

const isStatePath = (path) => path.startsWith("src/state/");
const isSharedNodeRuntimePath = (path) => path.startsWith("src/node/");

const classifyPath = (path) => {
  if (isTestBackedDocumentationPath(path)) {
    const flags = emptyFlags();
    flags.node = true;
    flags.full_node = true;
    return flags;
  }

  if (isDslReferencePath(path)) {
    const flags = emptyFlags();
    flags.node = true;
    return flags;
  }

  if (isDocumentationPath(path)) {
    return emptyFlags();
  }

  if (path === LIFECYCLE_STRESS_RUNNER) {
    const flags = emptyFlags();
    flags.node = true;
    flags.full_node = true;
    flags.workflow = true;
    return flags;
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

  if (isSharedRustFixturePath(path)) {
    const flags = emptyFlags();
    flags.node = true;
    flags.rust = true;
    return flags;
  }

  if (isRustIntegrationTestPath(path)) {
    const flags = emptyFlags();
    flags.node = true;
    flags.full_node = true;
    return flags;
  }

  if (path === "test/evaluationParity.test.ts") {
    const flags = emptyFlags();
    flags.node = true;
    flags.parity = true;
    return flags;
  }

  if (isEvaluationParitySupportPath(path)) {
    const flags = emptyFlags();
    flags.node = true;
    flags.full_node = true;
    flags.parity = true;
    return flags;
  }

  if (isParityTestPath(path)) {
    const flags = emptyFlags();
    flags.parity = true;
    return flags;
  }

  if (isKnownFixturePath(path)) {
    return null;
  }

  if (isStatePath(path) || isSharedNodeRuntimePath(path)) {
    const flags = emptyFlags();
    flags.node = true;
    flags.full_node = true;
    flags.vscode = true;
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
      path.startsWith("mcp-server/") ||
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
