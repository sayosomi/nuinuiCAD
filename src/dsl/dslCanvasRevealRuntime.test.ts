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

const statementMap = (pairs: readonly (readonly [number, ElementId])[]): StatementMap => ({
  elementIdByStatementIndex: new Map(pairs)
} as unknown as StatementMap);

const materialization = (
  entries: readonly Partial<MaterializedExecutionStatement>[],
  direct: readonly (readonly [number, ElementId])[] = []
): ModuleMaterialization => ({
  executionStatements: entries as readonly MaterializedExecutionStatement[],
  elementIdBySourceStatementIndex: new Map(direct)
} as unknown as ModuleMaterialization);

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
  statementMap: statementMap(direct),
  moduleMaterialization: materialization(entries, direct),
  ...(analysis ? { moduleSemanticAnalysis: analysis } : {}),
  diagnostics
});

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

const propertyTarget = ({
  sourceStatementIndex,
  target,
  ownerSourceStatementIndex = sourceStatementIndex,
  referenceText = "@target.length"
}: {
  sourceStatementIndex: number;
  target: ModuleGeometryPropertySourceTarget;
  ownerSourceStatementIndex?: number | null;
  referenceText?: string;
}): DslCanvasRevealSourceTarget => ({
  kind: "semantic",
  ownerSourceStatementIndex,
  semantic: {
    kind: "geometry-property",
    sourceStatementIndex,
    referenceText,
    reference: {
      geometryName: "target",
      property: "length",
      elementNameSpan: { start: 1, end: 7 },
      propertySpan: { start: 8, end: referenceText.length },
      span: { start: 0, end: referenceText.length },
      target,
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

const sets = (
  allIds: readonly ElementId[],
  options: {
    visible?: readonly ElementId[];
    enabled?: readonly ElementId[];
    profile?: readonly ElementId[];
  } = {}
) => ({
  effectiveVisibleElementIds: new Set(options.visible ?? allIds),
  effectiveEnabledElementIds: new Set(options.enabled ?? allIds),
  profileVisibleElementIds: new Set(options.profile ?? allIds)
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
    const elements = [element("A-id"), element("B-id")];
    const result = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target }),
      compiled: compiled({ direct: [[1, "A-id"], [2, "B-id"]] }),
      elements,
      ...sets(elements.map((item) => item.id))
    });

    expect(result).toEqual({
      status: "resolved",
      runtimeElementIds: ["A-id"],
      primaryRuntimeElementId: "A-id",
      degradations: []
    });
  });

  it("expands a module geometry parameter across current materializations in order", () => {
    const target: ModuleGeometrySourceTarget = {
      kind: "parameter",
      definitionStatementId: "def",
      parameterIndex: 0,
      geometryKind: "point"
    };
    const entries: readonly Partial<MaterializedExecutionStatement>[] = [
      { type: "moduleInstance", runtimeElementId: "M1", sourceStatementIndex: 10, instancePath: ["S1"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "point", runtimeElementId: "Out1", sourceStatementIndex: 2, instancePath: ["S1"] },
      { type: "moduleInstance", runtimeElementId: "M2", sourceStatementIndex: 11, instancePath: ["S2"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "point", runtimeElementId: "Out2", sourceStatementIndex: 2, instancePath: ["S2"] }
    ];
    const elements = ["P1", "P2", "Out1", "Out2", "M1", "M2"].map(element);
    const result = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target }),
      compiled: compiled({ entries, analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({ builtin: new Map([[JSON.stringify(["S1"]), "P1"], [JSON.stringify(["S2"]), "P2"]]) }),
      elements,
      ...sets(elements.map((item) => item.id))
    });

    expect(result).toEqual({
      status: "resolved",
      runtimeElementIds: ["P1", "P2"],
      primaryRuntimeElementId: "P1",
      degradations: []
    });
  });

  it("keeps the valid semantic subset and reports one partial degradation", () => {
    const target: ModuleGeometrySourceTarget = {
      kind: "parameter",
      definitionStatementId: "def",
      parameterIndex: 0,
      geometryKind: "point"
    };
    const entries: readonly Partial<MaterializedExecutionStatement>[] = [
      { type: "moduleInstance", runtimeElementId: "M1", sourceStatementIndex: 10, instancePath: ["S1"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "point", runtimeElementId: "Out1", sourceStatementIndex: 2, instancePath: ["S1"] },
      { type: "moduleInstance", runtimeElementId: "M2", sourceStatementIndex: 11, instancePath: ["S2"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "point", runtimeElementId: "Out2", sourceStatementIndex: 2, instancePath: ["S2"] }
    ];
    const elements = ["P1", "P2", "Out1", "Out2", "M1", "M2"].map(element);
    const allIds = elements.map((item) => item.id);
    const result = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target }),
      compiled: compiled({ entries, analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({ builtin: new Map([[JSON.stringify(["S1"]), "P1"], [JSON.stringify(["S2"]), "P2"]]) }),
      elements,
      ...sets(allIds, { visible: allIds.filter((id) => id !== "P2") })
    });

    expect(result).toEqual({
      status: "resolved",
      runtimeElementIds: ["P1"],
      primaryRuntimeElementId: "P1",
      degradations: [{ kind: "partial-targets", omittedCount: 1, causes: ["hidden"] }]
    });
  });

  it("falls back to all materialized statement owners when semantic targets are not revealable", () => {
    const target: ModuleGeometrySourceTarget = {
      kind: "parameter",
      definitionStatementId: "def",
      parameterIndex: 0,
      geometryKind: "point"
    };
    const entries: readonly Partial<MaterializedExecutionStatement>[] = [
      { type: "moduleInstance", runtimeElementId: "M1", sourceStatementIndex: 10, instancePath: ["S1"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "point", runtimeElementId: "Out1", sourceStatementIndex: 2, instancePath: ["S1"] },
      { type: "moduleInstance", runtimeElementId: "M2", sourceStatementIndex: 11, instancePath: ["S2"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "point", runtimeElementId: "Out2", sourceStatementIndex: 2, instancePath: ["S2"] }
    ];
    const elements = ["P1", "P2", "Out1", "Out2", "M1", "M2"].map(element);
    const allIds = elements.map((item) => item.id);
    const visible = allIds.filter((id) => id !== "P1" && id !== "P2");
    const result = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target, referenceText: "@input" }),
      compiled: compiled({ entries, analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({ builtin: new Map([[JSON.stringify(["S1"]), "P1"], [JSON.stringify(["S2"]), "P2"]]) }),
      elements,
      ...sets(allIds, { visible })
    });

    expect(result).toEqual({
      status: "resolved",
      runtimeElementIds: ["Out1", "Out2"],
      primaryRuntimeElementId: "Out1",
      degradations: [{ kind: "owner-fallback", cause: "hidden", referenceText: "@input" }]
    });
  });

  it("falls back with unresolved or ambiguous reason codes", () => {
    const elements = [element("Owner")];
    const unresolved = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "undefined", referenceText: "@missing" }),
      compiled: compiled({ direct: [[2, "Owner"]] }),
      elements,
      ...sets(["Owner"])
    });
    expect(unresolved.status).toBe("resolved");
    if (unresolved.status === "resolved") {
      expect(unresolved.degradations).toEqual([{ kind: "owner-fallback", cause: "unresolved", referenceText: "@missing" }]);
    }

    const ambiguous = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "invalid", referenceText: "@dup" }),
      compiled: compiled({
        direct: [[2, "Owner"]],
        diagnostics: [{ severity: "error", line: 1, column: 1, code: "module-ambiguous-geometry-reference", message: "ambiguous", statementIndex: 2 }]
      }),
      elements,
      ...sets(["Owner"])
    });
    expect(ambiguous.status).toBe("resolved");
    if (ambiguous.status === "resolved") {
      expect(ambiguous.degradations).toEqual([{ kind: "owner-fallback", cause: "ambiguous", referenceText: "@dup" }]);
    }
  });

  it("resolves geometry-property references to their base runtime geometry", () => {
    const target: ModuleGeometryPropertySourceTarget = {
      kind: "parameterProperty",
      definitionStatementId: "def",
      parameterIndex: 0,
      geometryKind: "line",
      property: "length"
    };
    const entries: readonly Partial<MaterializedExecutionStatement>[] = [
      { type: "moduleInstance", runtimeElementId: "M1", sourceStatementIndex: 10, instancePath: ["S1"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "point", runtimeElementId: "Out", sourceStatementIndex: 2, instancePath: ["S1"] }
    ];
    const elements = ["BaseLine", "Out", "M1"].map(element);
    const result = queryDslCanvasRevealRuntimeTarget({
      target: propertyTarget({ sourceStatementIndex: 2, target }),
      compiled: compiled({ entries, analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({ property: new Map([[JSON.stringify(["S1"]), "BaseLine"]]) }),
      elements,
      ...sets(elements.map((item) => item.id))
    });

    expect(result).toEqual({
      status: "resolved",
      runtimeElementIds: ["BaseLine"],
      primaryRuntimeElementId: "BaseLine",
      degradations: []
    });
  });

  it("deduplicates identical semantic runtime IDs without treating duplicates as omissions", () => {
    const target: ModuleGeometrySourceTarget = {
      kind: "parameter",
      definitionStatementId: "def",
      parameterIndex: 0,
      geometryKind: "point"
    };
    const entries: readonly Partial<MaterializedExecutionStatement>[] = [
      { type: "moduleInstance", runtimeElementId: "M1", sourceStatementIndex: 10, instancePath: ["S1"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] },
      { type: "moduleInstance", runtimeElementId: "M2", sourceStatementIndex: 11, instancePath: ["S2"], origin: { moduleDefinitionStatementId: "def" } as MaterializedExecutionStatement["origin"] }
    ];
    const elements = ["Shared", "M1", "M2"].map(element);
    const result = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target, ownerSourceStatementIndex: null }),
      compiled: compiled({ entries, analysis: analysisForBody("def", 2) }),
      moduleGeometryRuntime: runtime({ builtin: new Map([[JSON.stringify(["S1"]), "Shared"], [JSON.stringify(["S2"]), "Shared"]]) }),
      elements,
      ...sets(elements.map((item) => item.id))
    });

    expect(result).toEqual({
      status: "resolved",
      runtimeElementIds: ["Shared"],
      primaryRuntimeElementId: "Shared",
      degradations: []
    });
  });

  it("fails without mutating selection semantics when neither semantic nor owner target is revealable", () => {
    const target: ModuleGeometrySourceTarget = {
      kind: "sourceGeometry",
      statementId: "A",
      statementIndex: 1,
      category: "point",
      geometryKind: "point"
    };
    const elements = [element("A-id"), element("Owner")];
    const result = queryDslCanvasRevealRuntimeTarget({
      target: geometryTarget({ sourceStatementIndex: 2, target }),
      compiled: compiled({ direct: [[1, "A-id"], [2, "Owner"]] }),
      elements,
      ...sets(["A-id", "Owner"], { enabled: [] })
    });

    expect(result).toEqual({ status: "failed", reason: "no-revealable-runtime-target" });
  });
});
