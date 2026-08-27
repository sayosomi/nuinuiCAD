import { describe, expect, it } from "vitest";
import type { CadElement, ElementId } from "../types/geometry";
import type { CompiledDslDocument, StatementMap } from "./dslDocument";
import type { MaterializedExecutionStatement, ModuleMaterialization } from "./moduleMaterialization";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import type {
  ModuleGeometryPropertySourceTarget,
  ModuleGeometrySourceTarget,
  ModuleSemanticAnalysis
} from "./moduleSemanticTypes";
import type { DslCanvasRevealSourceTarget } from "./dslCanvasRevealQuery";
import { queryDslCanvasRevealRuntimeTarget } from "./dslCanvasRevealRuntime";

const element = (id: ElementId): CadElement => ({ id } as unknown as CadElement);

const compiled = ({
  direct = [],
  entries = [],
  analysis,
  diagnostics = []
}: {
  direct?: readonly (readonly [number, ElementId])[];
  entries?: readonly Partial<MaterializedExecutionStatement>[];
  analysis?: ModuleSemanticAnalysis;
  diagnostics?: CompiledDslDocument["diagnostics"];
}): Pick<
  CompiledDslDocument,
  "statementMap" | "moduleSemanticAnalysis" | "sourceSemanticAnalysis" | "moduleMaterialization" | "diagnostics"
> => ({
  statementMap: ({ elementIdByStatementIndex: new Map(direct) } as unknown as StatementMap),
  moduleMaterialization: ({
    executionStatements: entries as readonly MaterializedExecutionStatement[],
    elementIdBySourceStatementIndex: new Map(direct)
  } as unknown as ModuleMaterialization),
  ...(analysis ? { moduleSemanticAnalysis: analysis } : {}),
  diagnostics
});

const analysisForBody = (definitionStatementId: string, sourceStatementIndex: number): ModuleSemanticAnalysis => ({
  definitions: [{
    statementId: definitionStatementId,
    bodyStatements: [{ statementIndex: sourceStatementIndex }]
  }],
  instances: [],
  definitionsByStatementId: new Map(),
  instancesByStatementId: new Map(),
  callEdges: [],
  rootScalarExpressionsByStatementId: new Map(),
  rootGeometryReferencesByStatementId: new Map(),
  rootParentReferencesByStatementId: new Map(),
  diagnostics: []
} as unknown as ModuleSemanticAnalysis);

const geometryTarget = ({
  sourceStatementIndex,
  target,
  ownerSourceStatementIndex = sourceStatementIndex,
  resolution = "resolved",
  referenceText = "@target"
}: {
  sourceStatementIndex: number;
  target: ModuleGeometrySourceTarget | null;
  ownerSourceStatementIndex?: number | null;
  resolution?: "resolved" | "undefined" | "forward" | "outerCapture" | "invalid" | "deferred";
  referenceText?: string;
}): DslCanvasRevealSourceTarget => ({
  kind: "semantic",
  ownerSourceStatementIndex,
  semantic: {
    kind: "geometry-reference",
    sourceStatementIndex,
    referenceText,
    reference: {
      source: referenceText,
      span: { start: 0, end: referenceText.length },
      expectedGeometryKind: "point",
      role: "pointReference",
      target,
      coordinate: null,
      resolution
    }
  }
});

const propertyTarget = (
  sourceStatementIndex: number,
  target: ModuleGeometryPropertySourceTarget
): DslCanvasRevealSourceTarget => ({
  kind: "semantic",
  ownerSourceStatementIndex: sourceStatementIndex,
  semantic: {
    kind: "geometry-property",
    sourceStatementIndex,
    referenceText: "@target.length",
    reference: {
      geometryName: "target",
      property: "length",
      elementNameSpan: { start: 1, end: 7 },
      propertySpan: { start: 8, end: 14 },
      span: { start: 0, end: 14 },
      target,
      type: { kind: "number" },
      resolution: "resolved"
    }
  }
});

const runtime = ({
  builtin = new Map<string, ElementId>(),
  property = new Map<string, ElementId>()
}: {
  builtin?: ReadonlyMap<string, ElementId>;
  property?: ReadonlyMap<string, ElementId>;
}): ModuleGeometryRuntimeCompilation => ({
  diagnostics: [],
  resolversByRuntimeElementId: new Map(),
  resolveBuiltinTarget: (_target, instancePath, expectedGeometryType) => {
    const id = builtin.get(JSON.stringify(instancePath));
    return id ? { elementId: id, geometryType: expectedGeometryType } : undefined;
  },
  resolvePropertyTarget: (_target, instancePath) => {
    const id = property.get(JSON.stringify(instancePath));
    return id ? { kind: "runtime", elementId: id, property: "length" } : undefined;
  },
  coordinateForReference: () => undefined
});

const revealability = (
  allIds: readonly ElementId[],
  options: { visible?: readonly ElementId[]; enabled?: readonly ElementId[]; profile?: readonly ElementId[] } = {}
) => ({
  effectiveVisibleElementIds: new Set(options.visible ?? allIds),
  effectiveEnabledElementIds: new Set(options.enabled ?? allIds),
  profileVisibleElementIds: new Set(options.profile ?? allIds)
});

const materializedModule = (): readonly Partial<MaterializedExecutionStatement>[] => [
  {
    type: "moduleInstance",
    runtimeElementId: "M1",
    sourceStatementIndex: 10,
    instancePath: ["S1"],
    origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"]
  },
  { type: "freePoint", runtimeElementId: "Out1", sourceStatementIndex: 2, instancePath: ["S1"] },
  {
    type: "moduleInstance",
    runtimeElementId: "M2",
    sourceStatementIndex: 11,
    instancePath: ["S2"],
    origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"]
  },
  { type: "freePoint", runtimeElementId: "Out2", sourceStatementIndex: 2, instancePath: ["S2"] }
];

const parameterTarget = (): ModuleGeometrySourceTarget => ({
  kind: "parameter",
  definitionStatementId: "def",
  parameterIndex: 0,
  geometryKind: "point"
});

describe("queryDslCanvasRevealRuntimeTarget", () => {
  it("resolves an ordinary source geometry reference without module runtime lowering", () => {
    const target: ModuleGeometrySourceTarget = {
      kind: "sourceGeometry",
      statementId: "A",
      statementIndex: 1,
      category: "point",
      geometryKind: "point"
    };
    const elements = [element("A-id"), element("Owner")];
    expect(queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target }),
      compiled: compiled({ direct: [[1, "A-id"], [2, "Owner"]] }),
      elements,
      ...revealability(elements.map((item) => item.id))
    })).toEqual({
      status: "resolved",
      runtimeElementIds: ["A-id"],
      primaryRuntimeElementId: "A-id",
      degradations: []
    });
  });

  it("expands module parameters in materialization order and reports a partial subset", () => {
    const elements = ["P1", "P2", "Out1", "Out2", "M1", "M2"].map(element);
    const allIds = elements.map((item) => item.id);
    expect(queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target: parameterTarget() }),
      compiled: compiled({ entries: materializedModule(), analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({
        builtin: new Map([
          [JSON.stringify(["S1"]), "P1"],
          [JSON.stringify(["S2"]), "P2"]
        ])
      }),
      elements,
      ...revealability(allIds, { visible: allIds.filter((id) => id !== "P2") })
    })).toEqual({
      status: "resolved",
      runtimeElementIds: ["P1"],
      primaryRuntimeElementId: "P1",
      degradations: [{ kind: "partial-targets", omittedCount: 1, causes: ["hidden"] }]
    });
  });

  it("falls back to all materialized statement owners when semantic targets are hidden", () => {
    const elements = ["P1", "P2", "Out1", "Out2", "M1", "M2"].map(element);
    const allIds = elements.map((item) => item.id);
    expect(queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target: parameterTarget(), referenceText: "@input" }),
      compiled: compiled({ entries: materializedModule(), analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({
        builtin: new Map([
          [JSON.stringify(["S1"]), "P1"],
          [JSON.stringify(["S2"]), "P2"]
        ])
      }),
      elements,
      ...revealability(allIds, { visible: allIds.filter((id) => id !== "P1" && id !== "P2") })
    })).toEqual({
      status: "resolved",
      runtimeElementIds: ["Out1", "Out2"],
      primaryRuntimeElementId: "Out1",
      degradations: [{ kind: "owner-fallback", cause: "hidden", referenceText: "@input" }]
    });
  });

  it("resolves geometry properties to their base runtime geometry and deduplicates IDs", () => {
    const target: ModuleGeometryPropertySourceTarget = {
      kind: "parameterProperty",
      definitionStatementId: "def",
      parameterIndex: 0,
      geometryKind: "line",
      property: "length"
    };
    const elements = ["BaseLine", "Out1", "Out2", "M1", "M2"].map(element);
    expect(queryDslCanvasRevealRuntimeTarget({
      target: propertyTarget(2, target),
      compiled: compiled({ entries: materializedModule(), analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({
        property: new Map([
          [JSON.stringify(["S1"]), "BaseLine"],
          [JSON.stringify(["S2"]), "BaseLine"]
        ])
      }),
      elements,
      ...revealability(elements.map((item) => item.id))
    })).toEqual({
      status: "resolved",
      runtimeElementIds: ["BaseLine"],
      primaryRuntimeElementId: "BaseLine",
      degradations: []
    });
  });

  it("uses stable fallback reasons and fails when neither semantic nor owner target is revealable", () => {
    const elements = [element("Owner")];
    const unresolved = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "undefined", referenceText: "@missing" }),
      compiled: compiled({ direct: [[2, "Owner"]] }),
      elements,
      ...revealability(["Owner"])
    });
    expect(unresolved.status).toBe("resolved");
    if (unresolved.status === "resolved") {
      expect(unresolved.degradations).toEqual([
        { kind: "owner-fallback", cause: "unresolved", referenceText: "@missing" }
      ]);
    }

    expect(queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "invalid", referenceText: "@dup" }),
      compiled: compiled({
        direct: [[2, "Owner"]],
        diagnostics: [{
          severity: "error",
          line: 1,
          column: 1,
          code: "module-ambiguous-geometry-reference",
          message: "ambiguous",
          statementIndex: 2
        }]
      }),
      elements,
      ...revealability(["Owner"])
    })).toEqual({
      status: "resolved",
      runtimeElementIds: ["Owner"],
      primaryRuntimeElementId: "Owner",
      degradations: [{ kind: "owner-fallback", cause: "ambiguous", referenceText: "@dup" }]
    });

    expect(queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "undefined", referenceText: "@missing" }),
      compiled: compiled({ direct: [[2, "Owner"]] }),
      elements,
      ...revealability(["Owner"], { enabled: [] })
    })).toEqual({ status: "failed", reason: "no-revealable-runtime-target" });
  });
});
