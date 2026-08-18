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
    name: "workflow-only",
    paths: [".github/workflows/ci.yml", "scripts/ci/classifyChanges.mjs"],
    expected: flags({ workflow: true })
  },
  {
    name: "ordinary Canvas/UI TypeScript",
    paths: ["src/components/Canvas.tsx"],
    expected: flags({ node: true, vscode: true })
  },
  {
    name: "VS Code host source",
    paths: ["src/vscode/host.ts", "vscode-extension/src/extension.ts", "scripts/vscode/build.mjs"],
    expected: flags({ node: true, vscode: true })
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
