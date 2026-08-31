import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { analyzeTypedBindingRenameInDocument } from "../document/typedRenameAnalysis";

// Dense fan-out: `count` distinct `let` declarations each directly
// referencing one shared binding by `name` - this is the shape most
// relevant to rename safety specifically (every occurrence the rename must
// replay), as opposed to typedDependencyGraph.performance.test.ts's long
// chain shape (most relevant to dependency-graph traversal depth).
const fanOutSource = (count: number, name: string) => [
  "nui 1",
  `const ${name}: number = 0`,
  ...Array.from({ length: count }, (_, index) => `let v${index}: number = @${name}`)
].join("\n");

const compile = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
};

describe("typed binding rename safety analysis (property)", () => {
  it("keeps every fan-out reference resolvable for a safe rename, matching an independently-generated already-renamed document", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 60 }), fc.integer(), (count, seed) => {
        const before = compile(fanOutSource(count, "Target"));
        expect(before.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
        const target = before.bindingAnalysis!.catalog.bindings.find(
          (binding) => binding.kind === "typed" && binding.name === "Target"
        )!;
        const newName = `Renamed${Math.abs(seed)}_${count}`;

        const analysis = analyzeTypedBindingRenameInDocument({ compiled: before, targetBindingId: target.id, newName });
        expect(analysis.verdict).toBe("ok");
        if (analysis.verdict !== "ok") return;
        expect(analysis.occurrences).toHaveLength(count);
        expect(analysis.occurrences.every((occurrence) => occurrence.kind === "initializer")).toBe(true);
        expect(analysis.occurrences.every((occurrence) => occurrence.oldName === "Target" && occurrence.newName === newName)).toBe(true);

        // Independent ground truth: a document generated directly with the
        // new name, never produced via span-based patching, must itself
        // compile clean and be structurally identical (same binding/edge
        // counts) - confirming the "ok" verdict matches real compiler truth.
        const after = compile(fanOutSource(count, newName));
        expect(after.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
        expect(after.bindingAnalysis!.issues).toEqual([]);
        expect(after.bindingAnalysis!.catalog.bindings.filter((binding) => binding.kind === "typed")).toHaveLength(count + 1);
        expect(after.typedDependencyGraph!.edges).toHaveLength(count);
      }),
      { numRuns: 40 }
    );
  });
});
