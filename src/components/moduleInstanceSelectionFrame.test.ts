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

const element = (id: string, name: string, type: CadElement["type"]): CadElement => ({
  id,
  name,
  type,
  activity: "visible"
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

const framesFor = (selectedElementIds: string[]) => moduleInstanceSelectionFrameOverlays({
  selectedElementIds,
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

describe("Module instance selection frame presentation", () => {
  it("keeps the instance as the only presentation identity and gives zero-area bounds a visible frame", () => {
    expect(framesFor(["instance"])).toEqual([{
      instanceId: "instance",
      name: "InstanceOne",
      left: 102,
      top: 22,
      width: 16,
      height: 16
    }]);
  });

  it("does not create an instance frame for an ordinary selected child", () => {
    expect(framesFor(["child"])).toEqual([]);
  });
});
