import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compile, initial, loadCheckpoint, manifest, metrics } from "./issue1474DependencyTopologySupport";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";

describe("#1476 source-backed module prerequisite graph facts", () => {
  it("B2 and B3 compile to Rust-eligible graphs without module-occurrence prerequisites", () => {
    const expected = new Map([
      ["B2", { V: 775, E: 773, edgeRecords: 773, outputCount: 258, bindingCount: 2, evaluationOrderCount: 258 }],
      ["B3", { V: 3007, E: 3005, edgeRecords: 3005, outputCount: 1002, bindingCount: 2, evaluationOrderCount: 1002 }]
    ]);

    for (const id of ["B2", "B3"] as const) {
      const unit = manifest.units.find((candidate) => candidate.id === id)!;
      const checkpoint = unit.checkpoints[0];
      const { source } = loadCheckpoint(checkpoint);
      const compiled = compile(source, initial());
      assert.deepEqual(metrics(compiled), {
        ...expected.get(id)!,
        maxPrerequisites: 1,
        maxDependents: id === "B2" ? 256 : 1000
      });

      const prepared = prepareRustEvaluation(compiled.doc.document.elements, buildEvaluationOptions({
        compiledDocument: compiled.doc,
        evaluationLimitIndex: undefined
      }));
      assert.equal(prepared.rustEligible, true, `${id} must use ordinary production Rust eligibility`);
      const rustGraph = prepared.input.scalarExpressionPayload?.conditionalDependencyGraph;
      assert.ok(rustGraph, `${id} must lower the canonical compiler graph to the Rust payload`);
      assert.equal(rustGraph.edges.length, expected.get(id)!.edgeRecords);
      const targetKindCounts = rustGraph.edges.reduce<Record<string, number>>((counts, edge) => {
        counts[edge.to.kind] = (counts[edge.to.kind] ?? 0) + 1;
        return counts;
      }, {});
      assert.equal(targetKindCounts["module-occurrence"] ?? 0, 0, `${id} module-occurrence target count`);
      assert.ok(Object.keys(targetKindCounts).length > 0, `${id} actual compiler graph must be nonempty`);
    }
  });
});
