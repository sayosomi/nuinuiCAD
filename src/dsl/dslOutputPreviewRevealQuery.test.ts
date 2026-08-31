import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import type { CadElement, ElementId } from "../types/geometry";
import type { CompiledDslDocument, StatementMap } from "./dslDocument";
import type { MaterializedExecutionStatement, ModuleMaterialization } from "./moduleMaterialization";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import type { ModuleSemanticAnalysis, ModuleGeometrySourceTarget } from "./moduleSemanticTypes";
import {
  isDslOutputPreviewRevealSourceTargetStructurallyAvailable,
  projectDslOutputPreviewRevealRuntimeTarget,
  queryDslOutputPreviewRevealSourceTarget
} from "./dslOutputPreviewRevealQuery";

const compileSource = (lines: string[]) => {
  const source = lines.join("\n");
  const compiled = compileFreshCanonicalText(source);
  if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
  return {
    source,
    compiled: compiled.currentCompiled,
    snapshot: { normalizedSource: source, sourceRevision: compiled.currentCompiled.spans.sourceMap.sourceRevision }
  };
};

const positionOf = (source: string, token: string, offset = 1) => {
  const position = source.indexOf(token);
  if (position < 0) throw new Error(`missing token ${token}`);
  return position + offset;
};

const targetAt = (
  source: string,
  compiled: ReturnType<typeof compileFreshCanonicalText>["currentCompiled"],
  snapshot: { normalizedSource: string; sourceRevision: number },
  token: string,
  offset = 1
) => {
  if (!compiled) throw new Error("missing compiled document");
  const result = queryDslOutputPreviewRevealSourceTarget({
    source: snapshot,
    compiled,
    position: positionOf(source, token, offset)
  });
  if (result.status === "failed") throw new Error(`missing target: ${result.reason}`);
  return result.target;
};

describe("queryDslOutputPreviewRevealSourceTarget", () => {
  it("fails closed for stale source, invalid positions, and missing targets", () => {
    const { source, compiled, snapshot } = compileSource(["nui 1", "point A = coordinate(x: 0, y: 0)"]);

    expect(queryDslOutputPreviewRevealSourceTarget({
      source: { ...snapshot, sourceRevision: snapshot.sourceRevision + 1 },
      compiled,
      position: 1
    })).toEqual({ status: "failed", reason: "source-mismatch" });
    expect(queryDslOutputPreviewRevealSourceTarget({ source: snapshot, compiled, position: -1 }))
      .toEqual({ status: "failed", reason: "invalid-position" });
    expect(queryDslOutputPreviewRevealSourceTarget({ source: snapshot, compiled, position: source.length + 1 }))
      .toEqual({ status: "failed", reason: "invalid-position" });

    const empty = compileSource(["nui 1", "", "  "]);
    expect(queryDslOutputPreviewRevealSourceTarget({
      source: empty.snapshot,
      compiled: empty.compiled,
      position: 0
    })).toEqual({ status: "failed", reason: "no-target" });
  });

  it("resolves output, layout, place, group, and ordinary geometry owners by current identities", () => {
    const { source, compiled, snapshot } = compileSource([
      "nui 1",
      "group G {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, orientation: portrait, overlap: 0)",
      "svg S(layout: @L, margin: 0)"
    ]);
    const query = (token: string, offset = 1) => queryDslOutputPreviewRevealSourceTarget({
      source: snapshot,
      compiled,
      position: positionOf(source, token, offset)
    });

    expect(query("group G")).toMatchObject({ status: "resolved", target: { kind: "group", sourceStatementIndex: 1 } });
    expect(query("line A")).toMatchObject({ status: "resolved", target: { kind: "geometry", sourceStatementIndex: 2 } });
    expect(query("place @G", 2)).toMatchObject({ status: "resolved", target: { kind: "place", placementIndex: 0 } });
    expect(query("print P")).toMatchObject({ status: "resolved", target: { kind: "output", outputKind: "print" } });
    expect(query("svg S")).toMatchObject({ status: "resolved", target: { kind: "output", outputKind: "svg" } });

    const groupReference = query("@G");
    expect(groupReference).toMatchObject({ status: "resolved", target: { kind: "group", sourceStatementIndex: 1 } });
    const layoutReference = query("@L");
    expect(layoutReference).toMatchObject({ status: "resolved", target: { kind: "layout", sourceStatementIndex: 4 } });
  });

  it("keeps Canvas geometry-reference and geometry-property precedence", () => {
    const { source, compiled, snapshot } = compileSource([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: @A.start, end: @A.end)",
      "const width: number = @A.length"
    ]);
    const query = (token: string, offset = 1) => queryDslOutputPreviewRevealSourceTarget({
      source: snapshot,
      compiled,
      position: positionOf(source, token, offset)
    });

    expect(query("@A.start")).toMatchObject({
      status: "resolved",
      target: { kind: "semantic", semantic: { kind: "geometry-reference" } }
    });
    expect(query("@A.length", 3)).toMatchObject({
      status: "resolved",
      target: { kind: "semantic", semantic: { kind: "geometry-property" } }
    });
  });

  it("projects structural availability from current authored output ownership", () => {
    const { source, compiled, snapshot } = compileSource([
      "nui 1",
      "group G {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  line B = segment(start: @A.start, end: @A.end)",
      "  group N {",
      "    point P = coordinate(x: 1, y: 1)",
      "  }",
      "}",
      "group U {",
      "  point X = coordinate(x: 2, y: 2)",
      "  point Y = offset(from: @X, dx: 1, dy: 0)",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      "layout Unused {",
      "  place @U(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, orientation: portrait, overlap: 0)",
      "svg S(layout: @L, margin: 0)"
    ]);
    const available = (token: string, offset = 1) => isDslOutputPreviewRevealSourceTargetStructurallyAvailable({
      target: targetAt(source, compiled, snapshot, token, offset),
      compiled: compiled!
    });

    expect(available("print P")).toBe(true);
    expect(available("svg S")).toBe(true);
    expect(available("layout L")).toBe(true);
    expect(available("layout Unused")).toBe(false);
    expect(available("place @G", 2)).toBe(true);
    expect(available("place @U", 2)).toBe(false);
    expect(available("group G")).toBe(true);
    expect(available("line A")).toBe(true);
    expect(available("group N")).toBe(true);
    expect(available("point P")).toBe(true);
    expect(available("group U")).toBe(false);
    expect(available("point X")).toBe(false);
    expect(available("@A.start")).toBe(true);
    expect(available("@X")).toBe(false);

    const placeTarget = targetAt(source, compiled, snapshot, "place @G", 2);
    if (placeTarget.kind !== "place") throw new Error("expected a place target");
    expect(isDslOutputPreviewRevealSourceTargetStructurallyAvailable({
      compiled: compiled!,
      target: { ...placeTarget, placementId: `${placeTarget.placementId}-stale` }
    })).toBe(false);
    expect(isDslOutputPreviewRevealSourceTargetStructurallyAvailable({
      compiled: compiled!,
      target: { ...placeTarget, placementIndex: 1 }
    })).toBe(false);
  });

  it("accepts repeated Module runtime projections when one projected target is inside a placed group", () => {
    const { source, compiled, snapshot } = compileSource([
      "nui 1",
      "point Input = coordinate(x: 0, y: 0)",
      "module M(input: point) {",
      "  point Output = offset(from: @input, dx: 1, dy: 0)",
      "  point Derived = offset(from: @Output, dx: 1, dy: 0)",
      "}",
      "group Placed {",
      "  instance First = M(input: @Input)",
      "  instance Second = M(input: @Input)",
      "}",
      "layout L {",
      "  place @Placed(at: (0, 0))",
      "}",
      "print P(layout: @L, paper: a4, orientation: portrait, overlap: 0)"
    ]);
    const result = queryDslOutputPreviewRevealSourceTarget({
      source: snapshot,
      compiled: compiled!,
      position: positionOf(source, "@Output")
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.target.kind).toBe("semantic");
      expect(isDslOutputPreviewRevealSourceTargetStructurallyAvailable({
        compiled: compiled!,
        target: result.target
      })).toBe(true);
    }
  });
});

const fakeElement = (id: ElementId): CadElement => ({ id } as unknown as CadElement);

const moduleCompiled = (): Pick<
  CompiledDslDocument,
  "statementMap" | "moduleSemanticAnalysis" | "sourceSemanticAnalysis" | "moduleMaterialization"
> => {
  const target: ModuleGeometrySourceTarget = {
    kind: "parameter",
    definitionStatementId: "definition",
    parameterIndex: 0,
    geometryKind: "point"
  };
  const statementMap = {
    elementIdByStatementIndex: new Map<number, ElementId>(),
    statementIndexByStatementId: new Map<string, number>()
  } as unknown as StatementMap;
  const entries = [
    {
      type: "moduleInstance",
      runtimeElementId: "instance-1",
      sourceStatementIndex: 10,
      instancePath: ["call-1"],
      origin: { moduleDefinitionStatementId: "definition" }
    },
    { type: "freePoint", runtimeElementId: "point-1", sourceStatementIndex: 2, instancePath: ["call-1"] },
    {
      type: "moduleInstance",
      runtimeElementId: "instance-2",
      sourceStatementIndex: 11,
      instancePath: ["call-2"],
      origin: { moduleDefinitionStatementId: "definition" }
    },
    { type: "freePoint", runtimeElementId: "point-2", sourceStatementIndex: 2, instancePath: ["call-2"] }
  ] as unknown as readonly MaterializedExecutionStatement[];
  const analysis = {
    definitions: [{ statementId: "definition", bodyStatements: [{ statementIndex: 2 }] }]
  } as unknown as ModuleSemanticAnalysis;
  const materialization = {
    executionStatements: entries,
    elementIdBySourceStatementIndex: new Map<number, ElementId>(),
    originByRuntimeElementId: new Map(),
    runtimeIdentityByElementId: new Map()
  } as unknown as ModuleMaterialization;
  const moduleGeometryRuntime: ModuleGeometryRuntimeCompilation = {
    diagnostics: [],
    resolversByRuntimeElementId: new Map(),
    resolveBuiltinTarget: (_target, path, expectedGeometryType) => ({
      elementId: path[0] === "call-1" ? "point-1" : "point-2",
      geometryType: expectedGeometryType
    }),
    resolvePropertyTarget: () => undefined,
    coordinateForReference: () => undefined
  };
  return {
    statementMap,
    moduleSemanticAnalysis: analysis,
    moduleMaterialization: materialization,
    sourceSemanticAnalysis: undefined,
    target,
    moduleGeometryRuntime
  } as unknown as Pick<
    CompiledDslDocument,
    "statementMap" | "moduleSemanticAnalysis" | "sourceSemanticAnalysis" | "moduleMaterialization"
  > & { target: ModuleGeometrySourceTarget; moduleGeometryRuntime: ModuleGeometryRuntimeCompilation };
};

describe("projectDslOutputPreviewRevealRuntimeTarget", () => {
  it("projects repeated Module geometry without Canvas visibility/profile filtering", () => {
    const fixture = moduleCompiled() as ReturnType<typeof moduleCompiled> & {
      target: ModuleGeometrySourceTarget;
      moduleGeometryRuntime: ModuleGeometryRuntimeCompilation;
    };
    const target = {
      kind: "semantic" as const,
      ownerSourceStatementIndex: 2,
      semantic: {
        kind: "geometry-reference" as const,
        sourceStatementIndex: 2,
        referenceText: "@input",
        reference: {
          source: "@input",
          span: { start: 0, end: 6 },
          expectedGeometryKind: "point" as const,
          role: "pointReference" as const,
          target: fixture.target,
          coordinate: null,
          resolution: "resolved" as const
        }
      }
    };

    expect(projectDslOutputPreviewRevealRuntimeTarget({
      target,
      compiled: fixture,
      moduleGeometryRuntime: fixture.moduleGeometryRuntime,
      elements: [fakeElement("point-1"), fakeElement("point-2")]
    })).toEqual({
      status: "resolved",
      target: {
        kind: "geometry",
        sourceStatementIndex: 2,
        runtimeElementIds: ["point-1", "point-2"]
      }
    });
  });
});
