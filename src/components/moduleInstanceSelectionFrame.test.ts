import { describe, expect, it } from "vitest";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { moduleInstanceSelectionFrameOverlays } from "./moduleInstanceSelectionFrame";

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

const element = (
  id: string,
  name: string,
  type: CadElement["type"],
  parentGroupId?: string
): CadElement => ({
  id,
  name,
  type,
  activity: "visible",
  parentGroupId
} as CadElement);

const evaluationForPoint = (elementId: string): EvaluationResult => ({
  computedGeometry: new Map([[elementId, {
    kind: "point",
    elementId,
    name: elementId,
    x: 5,
    y: 10
  }]]),
  errors: [],
  warnings: []
});

const profile = defaultVisibilityProfile();

describe("container selection frame presentation", () => {
  it("keeps a Module instance as the only presentation identity and gives zero-area bounds a visible frame", () => {
    const frames = moduleInstanceSelectionFrameOverlays({
      selectedElementIds: ["instance"],
      elements: [
        element("instance", "InstanceOne", "moduleInstance"),
        element("child", "Child", "freePoint")
      ],
      evaluation: evaluationForPoint("child"),
      moduleMaterialization: materialization("instance", ["child"]),
      visibilityProfiles: [profile],
      activeVisibilityProfileId: profile.id,
      viewportSize: { width: 200, height: 100 },
      canvasViewport: { panX: 0, panY: 0, zoom: 2 }
    });

    expect(frames).toEqual([{
      instanceId: "instance",
      name: "InstanceOne",
      left: 102,
      top: 22,
      width: 16,
      height: 16
    }]);
  });

  it("uses the same frame semantics for an authored group identity", () => {
    const frames = moduleInstanceSelectionFrameOverlays({
      selectedElementIds: ["group"],
      elements: [
        element("group", "Front", "group"),
        element("child", "Child", "freePoint", "group")
      ],
      evaluation: evaluationForPoint("child"),
      visibilityProfiles: [profile],
      activeVisibilityProfileId: profile.id,
      viewportSize: { width: 200, height: 100 },
      canvasViewport: { panX: 0, panY: 0, zoom: 2 }
    });

    expect(frames).toEqual([{
      instanceId: "group",
      name: "Front",
      left: 102,
      top: 22,
      width: 16,
      height: 16
    }]);
  });

  it("does not create a container frame for an ordinary selected child", () => {
    expect(moduleInstanceSelectionFrameOverlays({
      selectedElementIds: ["child"],
      elements: [element("child", "Child", "freePoint")],
      evaluation: evaluationForPoint("child"),
      visibilityProfiles: [profile],
      activeVisibilityProfileId: profile.id,
      viewportSize: { width: 200, height: 100 },
      canvasViewport: { panX: 0, panY: 0, zoom: 2 }
    })).toEqual([]);
  });
});
