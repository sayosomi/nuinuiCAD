import { describe, expect, it } from "vitest";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { canvasNavigationContainerTarget } from "./canvasNavigationContainerTarget";

const element = (
  id: string,
  type: CadElement["type"],
  parentGroupId?: string,
  activity: CadElement["activity"] = "visible"
) => ({ id, name: id, type, parentGroupId, activity } as CadElement);

const point = (elementId: string, x: number, y: number): ComputedGeometry => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const evaluationFor = (geometry: readonly ComputedGeometry[]): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: []
});

const materialization = (instanceId: string, descendantIds: string[]): ModuleMaterialization => ({
  executionStatements: [],
  sourceExecutionUnits: [],
  elementIdBySourceStatementIndex: new Map(),
  sourceExecutionPositionByRuntimeElementId: new Map(),
  originByRuntimeElementId: new Map(),
  runtimeIdentityByElementId: new Map(),
  instanceBaseGeometrySnapshots: [{ instanceId, endRuntimeIndex: descendantIds.length, descendantIds }],
  evaluationLimitIndex: undefined
});

const profile = defaultVisibilityProfile();
const targetFor = ({
  runtimeElementIds,
  elements,
  evaluation,
  evaluationIsCurrent = true,
  moduleMaterialization
}: {
  runtimeElementIds: string[];
  elements: CadElement[];
  evaluation: EvaluationResult;
  evaluationIsCurrent?: boolean;
  moduleMaterialization?: ModuleMaterialization;
}) => canvasNavigationContainerTarget({
  runtimeElementIds,
  elements,
  evaluation,
  evaluationIsCurrent,
  moduleMaterialization,
  visibilityProfiles: [profile],
  activeVisibilityProfileId: profile.id
});

describe("canvasNavigationContainerTarget", () => {
  it("resolves a group to its recursive renderable bounds before selection", () => {
    expect(targetFor({
      runtimeElementIds: ["group"],
      elements: [
        element("group", "group"),
        element("inner", "group", "group"),
        element("child", "freePoint", "inner")
      ],
      evaluation: evaluationFor([point("child", 30, -10)])
    })).toEqual({
      status: "ready",
      containerId: "group",
      bounds: { minX: 30, minY: -10, maxX: 30, maxY: -10 }
    });
  });

  it("fails a group Reveal closed when it has no renderable descendant", () => {
    expect(targetFor({
      runtimeElementIds: ["group"],
      elements: [
        element("group", "group"),
        element("hidden", "freePoint", "group", "hidden")
      ],
      evaluation: evaluationFor([point("hidden", 1, 2)])
    })).toEqual({ status: "no-renderable-geometry" });
  });

  it("requires current evaluation for a container target", () => {
    expect(targetFor({
      runtimeElementIds: ["group"],
      elements: [element("group", "group"), element("child", "freePoint", "group")],
      evaluation: evaluationFor([point("child", 1, 2)]),
      evaluationIsCurrent: false
    })).toEqual({ status: "stale" });
  });

  it("leaves ordinary geometry on the existing Reveal path", () => {
    expect(targetFor({
      runtimeElementIds: ["point"],
      elements: [element("point", "freePoint")],
      evaluation: evaluationFor([point("point", 1, 2)])
    })).toEqual({ status: "ordinary" });
  });

  it("preserves Module instance selection/bounds semantics", () => {
    expect(targetFor({
      runtimeElementIds: ["instance"],
      elements: [element("instance", "moduleInstance"), element("child", "freePoint")],
      evaluation: evaluationFor([point("child", 5, 6)]),
      moduleMaterialization: materialization("instance", ["child"])
    })).toEqual({
      status: "ready",
      containerId: "instance",
      bounds: { minX: 5, minY: 6, maxX: 5, maxY: 6 }
    });
  });
});
