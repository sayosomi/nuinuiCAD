import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildTypedDependencyGraph,
  compileDslDocument,
  parseDslSnapshot,
  type TypedDependencyGraph,
  type TypedDependencyGraphInput
} from "@nuinuicad/nui-language";
import { canonicalRegressionSource } from "../../test/canonicalRegressionSource";
import { modulePreviewAggregateSource } from "../dsl/__fixtures__/modulePreviewAggregate";

const SOURCE_REVISION_BASE = 31;

const fixtureSources = [
  ["S-P-0", "S-P", "test/fixtures/issue-1515/S-P-0.nui", SOURCE_REVISION_BASE],
  ["S-P-1", "S-P", "test/fixtures/issue-1515/S-P-1.nui", SOURCE_REVISION_BASE + 1],
  ["M-P-0", "M-P", "test/fixtures/issue-1515/M-P-0.nui", SOURCE_REVISION_BASE],
  ["M-P-1", "M-P", "test/fixtures/issue-1515/M-P-1.nui", SOURCE_REVISION_BASE + 1],
  ["L-P-0", "L-P", "test/fixtures/issue-1515/L-P-0.nui", SOURCE_REVISION_BASE],
  ["L-P-1", "L-P", "test/fixtures/issue-1515/L-P-1.nui", SOURCE_REVISION_BASE + 1]
] as const;

// Canonical source ranges change these digests. The ordered graph and plans
// were compared with the fixed Base after excluding only source spans.
const GRAPH_SHA256_BY_CASE: Readonly<Record<string, string>> = {
  "S-P-0": "501b9e004a3bc2c4a0e74a7909560ec1b89f479dc7311f8fdb0877deeb0432d2",
  "S-P-1": "501b9e004a3bc2c4a0e74a7909560ec1b89f479dc7311f8fdb0877deeb0432d2",
  "M-P-0": "35ed0dbe6f78ecc1eefb1a4f82fe613c2d2b00d1024a3d38c82e20d9e82ddf1a",
  "M-P-1": "35ed0dbe6f78ecc1eefb1a4f82fe613c2d2b00d1024a3d38c82e20d9e82ddf1a",
  "L-P-0": "b9c00f80c58570cd35dea3634d8fe4a5429d091edf95db2131ef3f86e3c64cf3",
  "L-P-1": "b9c00f80c58570cd35dea3634d8fe4a5429d091edf95db2131ef3f86e3c64cf3",
  aggregate: "094244513ff40fc213e7995dc93f0370a20134a8f3b07d154d1cc233648544a2",
  conditional: "aaadc7654b7f471b26850089515339a5eaa7bef6827e2cc89022fcef178847d0"
};

const PATH_CASE_SHA256 = "e5989af17cbf6e999e6cd7287b487d1285f6571e932e84a241fe2c3d1c78d871";

const conditionalModuleSource = () => {
  const source = canonicalRegressionSource(readFileSync("test/fixtures/issue-1515/S-P-0.nui", "utf8"));
  const close = source.indexOf("\n}");
  if (close < 0) throw new Error("expected Panel module body in S-P-0 fixture");
  return `${source.slice(0, close)}\n  const chooseCurve: boolean = true\n  const selectedLength: number = if (chooseCurve) { Curve.length } else { Seam.length }\n  reverse Edge()${source.slice(close)}`;
};

const compileStable = (identity: string, source: string, sourceRevision: number) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [
    index,
    `module-snapshot-index:${identity}:statement:${index}`
  ] as const));
  const compiled = compileDslDocument(source, {
    sourceRevision,
    assignedStatementIds,
    preparsed: parsed
  });
  const diagnostics = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (diagnostics.length) throw new Error(`${identity} did not compile: ${JSON.stringify(diagnostics)}`);
  if (!compiled.typedDependencyGraph) throw new Error(`${identity} did not produce a typed dependency graph`);
  if (!compiled.document || !compiled.statementMap) throw new Error(`${identity} did not produce graph inputs`);
  return compiled;
};

const graphEvidence = (graph: TypedDependencyGraph) => ({
  edges: graph.edges.map((edge) => ({
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
    span: edge.span,
    reason: edge.reason ?? null,
    requiredness: edge.requiredness ?? null,
    activation: edge.activation ?? null
  })),
  evaluationOrder: [...graph.evaluationOrder],
  cycles: [...graph.cycles],
  transformationPlans: [...graph.transformationPlans],
  geometryValueExecutionPositionByOccurrence: [...graph.geometryValueExecutionPositionByOccurrence]
});

const graphDigest = (graph: TypedDependencyGraph) => createHash("sha256")
  .update(JSON.stringify(graphEvidence(graph)))
  .digest("hex");

const endpointKinds = (graph: TypedDependencyGraph) => new Set(
  graph.edges.flatMap((edge) => [edge.from.kind, edge.to.kind])
);

const graphFromCompiled = (
  compiled: ReturnType<typeof compileStable>,
  moduleMaterialization: NonNullable<ReturnType<typeof compileStable>["moduleMaterialization"]>
) => {
  const document = compiled.document!;
  const moduleExportedGeometryValueStatementIds = new Set(
    compiled.moduleSemanticAnalysis?.geometryValues
      .filter((value) => value.exported)
      .map((value) => value.statementId) ?? []
  );
  const input: TypedDependencyGraphInput = {
    elements: document.elements,
    drawingModifiers: document.modifiers,
    elementIdByStatementIndex: compiled.statementMap!.elementIdByStatementIndex,
    statementIdByStatementIndex: compiled.statementMap!.statementIdByStatementIndex,
    bindingAnalysis: compiled.bindingAnalysis,
    bindingVersions: compiled.bindingVersions,
    propertyBindings: compiled.propertyBindings,
    numericBindings: compiled.numericBindings,
    materializedNumericBindings: compiled.materializedNumericBindings,
    transformationNumericBindings: compiled.transformationNumericBindings,
    textTemplates: compiled.textTemplates,
    scalarProgram: compiled.scalarProgram,
    geometryCollectionNodesByValueId: compiled.moduleGeometryRuntime?.geometryCollectionNodesByValueId,
    geometryInputTargets: document.geometryInputTargetsByElementId,
    transformationRecipes: compiled.runtimeTransformationRecipes ?? compiled.transformationRecipes ?? document.transformationRecipes,
    geometryValueProgram: compiled.geometryValueProgram,
    moduleExportedGeometryValueStatementIds,
    moduleMaterialization,
    conditionalGroupConditions: compiled.conditionalGroupConditions
  };
  const graph = buildTypedDependencyGraph(input);
  if (!graph) throw new Error("direct graph construction returned no graph");
  return graph;
};

describe("Module snapshot dependency seed selection", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T03:00:00.000Z"));
  });

  afterAll(() => vi.useRealTimers());

  it("matches frozen graphs for the legal Issue #1515 scale and source-revision fixtures", () => {
    const compiledByCase = new Map<string, ReturnType<typeof compileStable>>();
    for (const [name, identity, path, sourceRevision] of fixtureSources) {
      const source = canonicalRegressionSource(readFileSync(path, "utf8"));
      const compiled = compileStable(identity, source, sourceRevision);
      const digest = graphDigest(compiled.typedDependencyGraph!);
      expect(digest, name).toBe(GRAPH_SHA256_BY_CASE[name]);
      expect(compiled.statementMap!.sourceRevision, `${name} source revision`).toBe(sourceRevision);
      expect(compiled.moduleMaterialization?.instanceBaseGeometrySnapshots.length, `${name} sibling snapshots`).toBeGreaterThan(1);
      compiledByCase.set(name, compiled);
    }

    for (const prefix of ["S-P", "M-P", "L-P"]) {
      const before = compiledByCase.get(`${prefix}-0`)!;
      const after = compiledByCase.get(`${prefix}-1`)!;
      expect(readFileSync(`test/fixtures/issue-1515/${prefix}-0.nui`, "utf8")).not.toBe(
        readFileSync(`test/fixtures/issue-1515/${prefix}-1.nui`, "utf8")
      );
      expect(after.statementMap!.sourceRevision).toBeGreaterThan(before.statementMap!.sourceRevision);
      expect(graphDigest(after.typedDependencyGraph!)).toBe(GRAPH_SHA256_BY_CASE[`${prefix}-1`]);
    }

    const smallGraph = compiledByCase.get("S-P-0")!.typedDependencyGraph!;
    const kinds = endpointKinds(smallGraph);
    for (const kind of ["binding", "element", "geometry-stage", "module-occurrence"] as const) {
      expect(kinds.has(kind), `Issue #1515 fixture endpoint kind ${kind}`).toBe(true);
    }
    expect(smallGraph.edges.some((edge) =>
      [edge.from, edge.to].some((endpoint) => endpoint.kind === "binding" && endpoint.id.startsWith("module-binding:"))
    ), "canonical Module-local binding identity").toBe(true);
    expect(smallGraph.edges.some((edge) =>
      [edge.from, edge.to].some((endpoint) => endpoint.kind === "binding" && endpoint.id.startsWith("binding:"))
    ), "root binding dependency").toBe(true);
  });

  it("matches the nested aggregate graph and covers geometry-value endpoints", () => {
    const compiled = compileStable("aggregate", modulePreviewAggregateSource, SOURCE_REVISION_BASE);
    const graph = compiled.typedDependencyGraph!;
    expect(graphDigest(graph)).toBe(GRAPH_SHA256_BY_CASE.aggregate);
    expect(endpointKinds(graph).has("geometry-value")).toBe(true);
    expect(graph.edges.some((edge) =>
      edge.from.kind === "element" && edge.from.name === "PreviewPoint" &&
      edge.to.kind === "geometry-stage" && edge.to.name === "RootA.final"
    ), "Module dependency on external/root geometry").toBe(true);
    const snapshots = compiled.moduleMaterialization?.instanceBaseGeometrySnapshots ?? [];
    expect(snapshots.length).toBeGreaterThan(1);
    const snapshotPaths = snapshots.map((snapshot) => ({
      instanceId: snapshot.instanceId,
      path: snapshot.instancePath ?? []
    }));
    const instancesByParentPath = new Map<string, Set<string>>();
    for (const snapshot of snapshotPaths) {
      if (snapshot.path.length === 0) continue;
      const parentPath = JSON.stringify(snapshot.path.slice(0, -1));
      const siblings = instancesByParentPath.get(parentPath) ?? new Set<string>();
      siblings.add(snapshot.instanceId);
      instancesByParentPath.set(parentPath, siblings);
    }
    expect([...instancesByParentPath.values()].some((siblings) => siblings.size > 1), "sibling Module instances").toBe(true);
    expect(snapshotPaths.some(({ path }) => path.length > 1), "nested Module instance").toBe(true);
  });

  it("matches the conditional dependency graph including ordered activation guards", () => {
    const compiled = compileStable("conditional", conditionalModuleSource(), SOURCE_REVISION_BASE);
    const graph = compiled.typedDependencyGraph!;
    expect(graphDigest(graph)).toBe(GRAPH_SHA256_BY_CASE.conditional);
    expect(endpointKinds(graph).has("transformation-recipe")).toBe(true);
    const conditionalEdges = graph.edges.filter((edge) => edge.requiredness === "conditional");
    expect(conditionalEdges.length).toBeGreaterThan(0);
    expect(conditionalEdges.every((edge) => (edge.activation?.guards.length ?? 0) > 0)).toBe(true);
  });

  it("matches frozen graphs for empty and otherwise unclassifiable instance paths", () => {
    const source = canonicalRegressionSource(readFileSync("test/fixtures/issue-1515/S-P-0.nui", "utf8"));
    const compiled = compileStable("path-cases", source, SOURCE_REVISION_BASE);
    const materialization = compiled.moduleMaterialization;
    if (!materialization) throw new Error("S-P fixture did not materialize Module snapshots");

    const emptyPathMaterialization = {
      ...materialization,
      instanceBaseGeometrySnapshots: materialization.instanceBaseGeometrySnapshots.map((snapshot, index) =>
        index === 0 ? { ...snapshot, instancePath: [] } : snapshot
      )
    };
    const emptyPathGraph = graphFromCompiled(compiled, emptyPathMaterialization);
    expect(graphDigest(emptyPathGraph), "empty instance path").toBe(PATH_CASE_SHA256);

    const firstSnapshot = materialization.instanceBaseGeometrySnapshots[0];
    const pathOwnedDescendant = materialization.executionStatements.find((entry) =>
      firstSnapshot?.descendantIds.includes(entry.runtimeElementId) &&
      entry.runtimeIdentity?.kind === "moduleBody" &&
      entry.type !== "moduleInstance"
    );
    expect(pathOwnedDescendant, "fixture descendant with a resolved Module instance path").toBeDefined();
    expect(firstSnapshot?.descendantIds).toContain(pathOwnedDescendant?.runtimeElementId);
    const unclassifiableMaterialization = {
      ...materialization,
      executionStatements: materialization.executionStatements.filter((entry) => entry !== pathOwnedDescendant)
    };
    const unclassifiableGraph = graphFromCompiled(compiled, unclassifiableMaterialization);
    expect(graphDigest(unclassifiableGraph), "descendant endpoint without an instance-path entry").toBe(PATH_CASE_SHA256);
  });
});
