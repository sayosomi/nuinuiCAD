import { describe, expect, it } from "vitest";
import { importedPickFixture, importedPickUri as uri } from "./importedReferencePickFixture";
import { compileDslDocument, queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { startVscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { projectVscodeMultiDocumentCanvasRuntime } from "./multiDocumentRuntimeTransport";
import { projectReferencePickGraphSnapshot } from "./referencePickGraphSnapshot";
import { createModuleRuntimeContext } from "@nuinuicad/nui-language";
import { referencePickTargetProofFor } from "./referencePickProtocol";

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
        const semantic = { sourceDocumentUri: uri, rootDocumentId: uri, documentVersion: 7, graphRevision: 41, sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled };
        for (const mode of ["target-bound", "browse"] as const) {
          const request = { ...f.request, mode, ...(mode === "browse" ? { targetProof: null, normalizedSourceOffset: f.source.normalizedSource.length } : {}) };
          for (let roundTrip = 0; roundTrip < 2; roundTrip++) {
            const snapshot = projectReferencePickGraphSnapshot({ request, semantic, evaluation: f.evaluation });
            expect(snapshot).not.toBeNull();
            const wire = JSON.parse(JSON.stringify(snapshot));
            expect(wire.result.status).toBe("started");
            expect(wire.result.sessionMode).toBe(mode);
            expect(wire.documentUri).toBe(uri);
            expect(wire.rootDocumentId).toBe(uri);
            expect(wire.session.candidates.flatMap((c: { options: {reference: {base: string}}[] }) => c.options.map(o => o.reference.base))).toContain("A");
            expect(f.evaluation.computedGeometry.size).toBeGreaterThanOrEqual(2);
            expect(wire).not.toHaveProperty("compiled");
            expect(wire).not.toHaveProperty("graph");
          }
        }
      });
    }
  }

  it("#1631 separates the NFC request URI from the NFD canonical graph root", async () => {
    const f = await importedPickFixture("C");
    const sourcePath = "/synthetic/型紙-ず/pick_ascii.nui";
    const sourceUri = `file://${sourcePath}`;
    const canonicalRoot = `file://${sourcePath.normalize("NFD")}`;
    const semantic = { rootDocumentId: canonicalRoot, sourceDocumentUri: sourceUri,
      documentVersion: 7, graphRevision: 41, sourceRevision: 12,
      sourceText: f.source.normalizedSource, compiled: f.compiled };
    const request = { ...f.request, documentUri: sourceUri };

    const snapshot = projectReferencePickGraphSnapshot({ request, semantic, evaluation: f.evaluation });
    expect(snapshot).not.toBeNull();
    expect(JSON.parse(JSON.stringify(snapshot))).toMatchObject({ documentUri: sourceUri, rootDocumentId: canonicalRoot });

    const asciiPath = "/synthetic/ascii-parent/pick_ascii.nui";
    const asciiUri = `file://${asciiPath}`;
    const ascii = projectReferencePickGraphSnapshot({ request: { ...request, documentUri: asciiUri },
      semantic: { ...semantic, rootDocumentId: asciiUri, sourceDocumentUri: asciiUri }, evaluation: f.evaluation });
    expect(ascii).toMatchObject({ documentUri: asciiUri, rootDocumentId: asciiUri });

    expect(projectReferencePickGraphSnapshot({ request: { ...request, documentUri: "file:///foreign/pick_ascii.nui" },
      semantic, evaluation: f.evaluation })).toBeNull();
  });

  it("#1628/#1631 projects Bezier start/end Pick from a synthetic 1,000-line imported Source", async () => {
    const sourcePath = "/synthetic/型紙-ず/pick_large_ascii.nui";
    const sourceUri = `file://${sourcePath}`;
    const canonicalRoot = `file://${sourcePath.normalize("NFD")}`;
    const sourceRevision = 12;
    const filler = Array.from({ length: 990 }, (_, index) => `// synthetic Source line ${index + 1}`).join("\n");
    const source = [
      "nui 1",
      'import "../modules/pick_module.nui" as probe',
      "point side = coordinate(x: 0, y: 0)",
      "point center = coordinate(x: 30, y: 0)",
      filler,
      "curve Curve = bezier(start: @side, end: @center)",
      "instance N = probe::Probe(x: 50)"
    ].join("\n");
    expect(source.split("\n")).toHaveLength(996);
    const moduleUri = "file:///synthetic/modules/pick_module.nui";
    const moduleSource = "nui 1\nexport module Probe(x: number) {\n  point marker = coordinate(x: @x, y: 0)\n}\n";
    const rootDocumentId = documentIdFromHost(canonicalRoot);
    const graph = await buildMultiDocumentImportGraph({
      root: { kind: "root-current", documentId: rootDocumentId, normalizedSource: source, sourceRevision },
      loader: {
        async loadSavedDependency(_importerId, importPath) {
          return importPath === "../modules/pick_module.nui"
            ? { status: "loaded" as const, snapshot: {
                kind: "dependency-saved" as const,
                documentId: documentIdFromHost(moduleUri),
                savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:synthetic-reference-pick-module"),
                normalizedSource: moduleSource
              } }
            : { status: "failed" as const, reason: "missing" as const };
        }
      },
      declarationContributors: [moduleDeclarationContributor]
    });
    expect(graph.valid).toBe(true);
    const context = createModuleRuntimeContext(graph, analyzeMultiDocumentModuleSemantics(graph));
    const rootNode = graph.nodes.get(rootDocumentId)!;
    const compiled = compileDslDocument(source, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: { ...compiled, document: compiled.document!, statementMap: compiled.statementMap!, majorVersion: compiled.majorVersion! },
      evaluationLimitIndex: undefined
    }));
    const semantic = { sourceDocumentUri: sourceUri, rootDocumentId: canonicalRoot,
      documentVersion: 7, graphRevision: 41, sourceRevision, sourceText: source, compiled };

    for (const endpoint of ["side", "center"] as const) {
      const normalizedSourceOffset = source.indexOf(`@${endpoint}`) + 1;
      const sourceSnapshot = { normalizedSource: source, sourceRevision };
      const target = queryDslReferencePickTarget({ source: sourceSnapshot, position: normalizedSourceOffset,
        semantic: { sourceRevision, sourceText: source, compiled } });
      expect(target).not.toBeNull();
      const request = { type: "referencePickStartRequest" as const, requestId: endpoint === "side" ? 1631 : 1632,
        documentUri: sourceUri, documentVersion: 7, normalizedSourceOffset,
        mode: "target-bound" as const, targetProof: referencePickTargetProofFor(source, target!) };
      const snapshot = projectReferencePickGraphSnapshot({ request, semantic, evaluation });
      expect(snapshot?.result.status).toBe("started");
      expect(snapshot?.result.candidateReferences.map(reference => reference.base)).toContain(endpoint);
    }

    const browseRequest = { type: "referencePickStartRequest" as const, requestId: 1633,
      documentUri: sourceUri, documentVersion: 7, normalizedSourceOffset: source.length,
      mode: "browse" as const, targetProof: null };
    const browse = projectReferencePickGraphSnapshot({ request: browseRequest, semantic, evaluation });
    expect(browse?.result.status).toBe("started");
    expect((browse?.result.browseReferences ?? []).map(reference => reference.base)).toEqual(expect.arrayContaining(["side", "center"]));
  });

  it("rejects wrong URI, version, target proof and Source revision", async () => {
    const f = await importedPickFixture("C");
    const semantic = { sourceDocumentUri: uri, rootDocumentId: uri, documentVersion: 7, graphRevision: 41, sourceRevision: 12, sourceText: f.source.normalizedSource, compiled: f.compiled };
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
