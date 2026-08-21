import { describe, expect, it } from "vitest";
import type { ModuleMaterialization, ModuleMaterializationSnapshot } from "../dsl/moduleMaterialization";
import { defaultVisibilityProfile } from "./visibilityProfiles";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { reconcileModuleInstanceSelection } from "./moduleInstanceSelection";

const element = (
  id: string,
  type: CadElement["type"],
  activity: CadElement["activity"] = "visible"
) => ({ id, name: id, type, activity } as CadElement);

const point = (elementId: string): ComputedGeometry => ({
  kind: "point",
  elementId,
  name: elementId,
  x: 1,
  y: 2
});

const evaluationFor = (geometry: readonly ComputedGeometry[]): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: []
});

const materializationFor = (
  snapshots: readonly ModuleMaterializationSnapshot[]
): ModuleMaterialization => ({
  executionStatements: [],
  sourceExecutionUnits: [],
  elementIdBySourceStatementIndex: new Map(),
  sourceExecutionPositionByRuntimeElementId: new Map(),
  originByRuntimeElementId: new Map(),
  runtimeIdentityByElementId: new Map(),
  instanceBaseGeometrySnapshots: snapshots,
  evaluationLimitIndex: undefined
});

const profiles = [defaultVisibilityProfile()];

const reconcile = ({
  evaluationIsCurrent,
  selectedElementIds = ["instance"],
  selectedElementId = "instance",
  selectionAnchorElementId = "instance",
  elements,
  evaluation,
  materialization
}: {
  evaluationIsCurrent: boolean;
  selectedElementIds?: string[];
  selectedElementId?: string | null;
  selectionAnchorElementId?: string | null;
  elements: CadElement[];
  evaluation: EvaluationResult;
  materialization?: ModuleMaterialization;
}) => reconcileModuleInstanceSelection({
  selection: {
    selectedElementId,
    selectedElementIds,
    selectionAnchorElementId
  },
  evaluationIsCurrent,
  elements,
  evaluation,
  moduleMaterialization: materialization,
  visibilityProfiles: profiles,
  activeVisibilityProfileId: profiles[0]!.id
});

describe("reconcileModuleInstanceSelection", () => {
  it("does not clear an instance while evaluation is stale or in flight", () => {
    const result = reconcile({
      evaluationIsCurrent: false,
      elements: [element("instance", "moduleInstance")],
      evaluation: evaluationFor([]),
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 0,
        descendantIds: []
      }])
    });

    expect(result).toBeNull();
  });

  it("clears an instance only when current evaluation proves zero renderable descendants", () => {
    const result = reconcile({
      evaluationIsCurrent: true,
      elements: [
        element("instance", "moduleInstance"),
        element("hidden", "freePoint", "hidden")
      ],
      evaluation: evaluationFor([point("hidden")]),
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 1,
        descendantIds: ["hidden"]
      }])
    });

    expect(result?.clearedInstanceIds).toEqual(["instance"]);
    expect(result?.selection).toEqual({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });

  it("keeps an instance selected when a current renderable descendant exists", () => {
    const result = reconcile({
      evaluationIsCurrent: true,
      elements: [
        element("instance", "moduleInstance"),
        element("child", "freePoint")
      ],
      evaluation: evaluationFor([point("child")]),
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 1,
        descendantIds: ["child"]
      }])
    });

    expect(result).toBeNull();
  });

  it("does not treat a missing materialization snapshot as proof of emptiness", () => {
    const result = reconcile({
      evaluationIsCurrent: true,
      elements: [element("instance", "moduleInstance")],
      evaluation: evaluationFor([]),
      materialization: materializationFor([])
    });

    expect(result).toBeNull();
  });

  it("removes only the empty instance from a mixed selection and preserves the remaining primary", () => {
    const result = reconcile({
      evaluationIsCurrent: true,
      selectedElementIds: ["ordinary", "instance"],
      selectedElementId: "instance",
      selectionAnchorElementId: "instance",
      elements: [
        element("ordinary", "freePoint"),
        element("instance", "moduleInstance")
      ],
      evaluation: evaluationFor([point("ordinary")]),
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 1,
        descendantIds: []
      }])
    });

    expect(result?.selection).toEqual({
      selectedElementId: "ordinary",
      selectedElementIds: ["ordinary"],
      selectionAnchorElementId: "ordinary"
    });
  });
});
