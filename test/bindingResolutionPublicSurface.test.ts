// Locks the production-facing surface of src/scalars/bindingResolution.ts:
// only resolveInitializerReferences (initializer-owner-bound) &&
// visibleBindingsAt (bulk visibility) may be used outside tests.
// resolveBindingReferenceForTests exposes exact duplicate/forward/undefined
// resolution detail that neither production API returns, && is exported
// solely so tests can assert it directly - Task 14/15+ expression-parser
// work must not depend on it. See
// docs/typed-variables/tasks/13r4-batch-resolver-contract.md.
//
// This file lives under test/, not src/, following this repo's existing
// pattern for vitest-only files that use Node built-ins (see
// commandIdMap.test.ts, evaluationParity.test.ts): tsc -b's project
// references only type-check src/, so a src/-included file importing
// "node:fs"/"node:path" fails the build even though vitest runs it fine.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(process.cwd(), "src");
const DEFINITION_FILE = path.join(SRC_ROOT, "scalars", "bindingResolution.ts");
const TEST_ONLY_SYMBOLS = [
  "resolveBindingReferenceForTests",
  "resolveInitializerReferencesWithTraceForTests",
  "visibleBindingsAtWithTraceForTests"
];

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) { collectSourceFiles(fullPath, out); continue; }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(fullPath);
  }
  return out;
};

describe("bindingResolution public surface", () => {
  it("never references test-only resolver helpers from non-test source", () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) => file !== DEFINITION_FILE)
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => TEST_ONLY_SYMBOLS.some((symbol) => fs.readFileSync(file, "utf8").includes(symbol)))
      .map((file) => path.relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it("keeps the production bulk query independent from the single-name test oracle", () => {
    const source = fs.readFileSync(DEFINITION_FILE, "utf8");
    const bulkImplementation = source.slice(source.indexOf("const visibleBindingsAtInternal"));
    expect(bulkImplementation).not.toContain("resolveAtSite(");
  });
});
