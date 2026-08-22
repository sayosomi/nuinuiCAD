import assert from "node:assert/strict";
import test from "node:test";

import { classifyChangedPaths } from "./classifyChanges.mjs";

const flags = (overrides = {}) => ({
  node: false,
  full_node: false,
  vscode: false,
  rust: false,
  parity: false,
  workflow: false,
  unknown: false,
  ...overrides
});

const cases = [
  {
    name: "docs-only",
    paths: ["docs/ci.md", "AGENTS.md"],
    expected: flags()
  },
  {
    name: "test-backed command ID documentation",
    paths: ["docs/command-id-map.md"],
    expected: flags({ node: true, full_node: true })
  },
  {
    name: "test-backed manual fixture documentation",
    paths: ["docs/module/manual-fixtures/sample.nui"],
    expected: flags({ node: true, full_node: true })
  },
  {
    name: "unknown non-Markdown docs path",
    paths: ["docs/module/new-fixture.nui"],
    expected: flags({
      node: true,
      full_node: true,
      vscode: true,
      rust: true,
      parity: true,
      unknown: true
    })
  },
  {
    name: "workflow-only",
    paths: [".github/workflows/ci.yml", "scripts/ci/classifyChanges.mjs"],
    expected: flags({ workflow: true })
  },
  {
    name: "MCP server source and tests",
    paths: ["mcp-server/src/server.ts", "mcp-server/test/stdio.test.ts"],
    expected: flags({ node: true })
  },
  {
    name: "ordinary Canvas/UI TypeScript",
    paths: ["src/components/Canvas.tsx"],
    expected: flags({ node: true, vscode: true })
  },
  {
    name: "src/state changes",
    paths: ["src/state/documentStore.ts"],
    expected: flags({ node: true, full_node: true, vscode: true })
  },
  {
    name: "shared Node host runtime",
    paths: ["src/node/rustEvaluationProcess.ts"],
    expected: flags({ node: true, full_node: true, vscode: true })
  },
  {
    name: "VS Code host source",
    paths: ["src/vscode/host.ts", "vscode-extension/src/extension.ts", "scripts/vscode/build.mjs"],
    expected: flags({ node: true, vscode: true })
  },
  {
    name: "VS Code language configuration",
    paths: ["vscode-extension/language-configuration.json"],
    expected: flags({ node: true, full_node: true, vscode: true })
  },
  {
    name: "VS Code syntax grammar",
    paths: ["vscode-extension/syntaxes/nui.tmLanguage.json"],
    expected: flags({ node: true, full_node: true, vscode: true })
  },
  {
    name: "Rust non-evaluation",
    paths: ["src-tauri/src/window.rs"],
    expected: flags({ rust: true })
  },
  {
    name: "Rust evaluation",
    paths: ["src-tauri/src/evaluation/evaluator.rs"],
    expected: flags({ rust: true, parity: true })
  },
  {
    name: "evaluation parity test",
    paths: ["test/evaluationParity.test.ts"],
    expected: flags({ node: true, parity: true })
  },
  {
    name: "evaluation parity support",
    paths: ["test/evaluationParitySupport.ts"],
    expected: flags({ node: true, full_node: true, parity: true })
  },
  {
    name: "ordinary adjacent evaluation test",
    paths: ["test/evaluationParityHelpers.test.ts"],
    expected: flags({ node: true })
  },
  {
    name: "evaluation parity fixtures",
    paths: ["test/fixtures/evaluation/basic.json"],
    expected: flags({ parity: true })
  },
  {
    name: "typed expression fixture",
    paths: ["test/fixtures/typed-expressions.json"],
    expected: flags({ node: true, rust: true })
  },
  {
    name: "scalar fixtures",
    paths: ["test/fixtures/scalars/length.json"],
    expected: flags({ node: true, rust: true })
  },
  {
    name: "unknown test fixture path",
    paths: ["test/fixtures/future-input.yaml"],
    expected: flags({
      node: true,
      full_node: true,
      vscode: true,
      rust: true,
      parity: true,
      unknown: true
    })
  },
  {
    name: "Rust-backed Vitest integration test",
    paths: ["test/documentRust.integration.test.ts"],
    expected: flags({ node: true, full_node: true })
  },
  {
    name: "parity-critical TypeScript",
    paths: ["src/document/document.ts", "src/types/geometry.ts"],
    expected: flags({ node: true, full_node: true, vscode: true, parity: true })
  },
  {
    name: "broad package/build config",
    paths: ["package.json", "vite.config.ts", "tsconfig.app.json"],
    expected: flags({ node: true, full_node: true, vscode: true })
  },
  {
    name: "unknown root config path",
    paths: ["future.config.json"],
    expected: flags({
      node: true,
      full_node: true,
      vscode: true,
      rust: true,
      parity: true,
      unknown: true
    })
  },
  {
    name: "mixed docs and application changes",
    paths: ["README.md", "src/components/Canvas.tsx"],
    expected: flags({ node: true, vscode: true })
  },
  {
    name: "test-only file inside a core source directory",
    paths: ["src/dsl/dslParser.test.ts", "src/vscode/host.test.ts"],
    expected: flags({ node: true })
  },
  {
    name: "unknown path fail-safe",
    paths: ["tools/experimental-input.txt"],
    expected: flags({
      node: true,
      full_node: true,
      vscode: true,
      rust: true,
      parity: true,
      unknown: true
    })
  },
  {
    name: "empty/unresolved input fail-safe",
    paths: [],
    expected: flags({
      node: true,
      full_node: true,
      vscode: true,
      rust: true,
      parity: true,
      unknown: true
    })
  }
];

for (const { name, paths, expected } of cases) {
  test(name, () => {
    assert.deepEqual(classifyChangedPaths(paths), expected);
  });
}

test("invalid path input uses the fail-safe full check set", () => {
  assert.deepEqual(
    classifyChangedPaths(["src/components/Canvas.tsx", ""]),
    flags({
      node: true,
      full_node: true,
      vscode: true,
      rust: true,
      parity: true,
      unknown: true
    })
  );
});
