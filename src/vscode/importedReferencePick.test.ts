import { describe, expect, it } from "vitest";
import { importedPickFixture, importedPickUri as uri } from "./importedReferencePickFixture";
import { startVscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { projectVscodeMultiDocumentCanvasRuntime } from "./multiDocumentRuntimeTransport";
import { projectReferencePickGraphSnapshot } from "./referencePickGraphSnapshot";

describe("#1623 exact-base authority reproduction", () => {
  it.each(["A", "B", "C"] as const)("%s host versus standalone Webview", async relation => {
    const f = await importedPickFixture(relation);
    expect(f.compiled.diagnostics).toEqual([]);
    const result = startVscodeReferencePickCanvasSession({ ...f, compiled: f.standalone, authoritativeDocumentUri: uri, authoritativeDocumentVersion: 7, evaluationIsCurrent: relation !== "C" });
    expect(result.result.status).toBe(relation === "C" ? "stale" : "started");
    if (relation === "C") {
      expect(f.standalone.document).toBeNull();
      expect(f.standalone.statementMap).toBeNull();
      expect(f.standalone.diagnostics.map(d => d.code)).toContain("module-unresolved-callee");
      expect(projectVscodeMultiDocumentCanvasRuntime({ ...f, graphRevision: 41 })).not.toBeNull();
    }
  });
  it("preserves root A/B for an empty imported Module", async () => {
    const f = await importedPickFixture("F");
    expect(f.evaluation.errors).toEqual([]);
    expect(f.compiled.document!.elements.map(e => e.name)).toEqual(expect.arrayContaining(["A", "B"]));
    expect(projectVscodeMultiDocumentCanvasRuntime({ ...f, graphRevision: 41 })).not.toBeNull();
  });
});

describe("#1623 bounded graph Pick matrix", () => {
  for (const relation of ["A", "B", "C", "D", "E", "F"] as const) {
    for (const empty of relation === "B" || relation === "C" || relation === "E" ? [false, true] : [false]) {
      it(`${relation} ${empty ? "empty dependency" : "marker"}: target and Browse survive serialization`, async () => {
        const f = await importedPickFixture(relation, empty);
        const runtime = projectVscodeMultiDocumentCanvasRuntime({ ...f, graphRevision: 41 });
        if (relation === "C" || relation === "F") expect(runtime).not.toBeNull();
        else expect(runtime).toBeNull();
        const semantic = { rootDocumentId: uri, documentVersion: 7, graphRevision: 41, sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled };
        for (const mode of ["target-bound", "browse"] as const) {
          const request = { ...f.request, mode, ...(mode === "browse" ? { targetProof: null, normalizedSourceOffset: f.source.normalizedSource.length } : {}) };
          for (let roundTrip = 0; roundTrip < 2; roundTrip++) {
            const snapshot = projectReferencePickGraphSnapshot({ request, semantic, evaluation: f.evaluation });
            expect(snapshot).not.toBeNull();
            const wire = JSON.parse(JSON.stringify(snapshot));
            expect(wire.result.status).toBe("started");
            expect(wire.result.sessionMode).toBe(mode);
            expect(wire.session.candidates.flatMap((c: { options: {reference: {base: string}}[] }) => c.options.map(o => o.reference.base))).toContain("A");
            expect(f.evaluation.computedGeometry.size).toBeGreaterThanOrEqual(2);
            expect(wire).not.toHaveProperty("compiled");
            expect(wire).not.toHaveProperty("graph");
          }
        }
      });
    }
  }
  it("rejects wrong URI, version, target proof and Source revision", async () => {
    const f = await importedPickFixture("C");
    const semantic = { rootDocumentId: uri, documentVersion: 7, graphRevision: 41, sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled };
    for (const request of [
      { ...f.request, documentUri: "file:///wrong.nui" },
      { ...f.request, documentVersion: 8 },
      { ...f.request, targetProof: { ...f.request.targetProof!, oldText: "@Wrong" } },
      { ...f.request, targetProof: { ...f.request.targetProof!, range: { from: 0, to: 1 } } }
    ]) expect(projectReferencePickGraphSnapshot({ request, semantic, evaluation: f.evaluation })).toBeNull();
    expect(projectReferencePickGraphSnapshot({ request: f.request, semantic: { ...semantic, sourceRevision: 13 }, evaluation: f.evaluation })).toBeNull();
  });
});

it.each(["missing", "invalid"] as const)("#1623 %s imported dependency/instance fails closed", async variant => {
  const f = await importedPickFixture("C", false, { [variant]: true });
  expect(f.compiled.diagnostics.some(d => d.severity === "error") || !f.graph.valid).toBe(true);
  expect(projectVscodeMultiDocumentCanvasRuntime({ ...f, graphRevision: 41 })).toBeNull();
});
