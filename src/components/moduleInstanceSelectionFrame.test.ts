import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ModuleMaterialization } from "@nuinuicad/nui-language";
import { defaultVisibilityProfile } from "@nuinuicad/nui-language";
import type { CanvasLayerPresentation } from "../model/canvasLayerPresentation";
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

const evaluationForLayeredPoints = (): EvaluationResult => ({
  computedGeometry: new Map([
    ["front-child", { kind: "point", elementId: "front-child", name: "Front", x: 5, y: 10 }],
    ["back-child", { kind: "point", elementId: "back-child", name: "Back", x: 105, y: 210 }]
  ]),
  errors: [],
  warnings: []
});

const layerPresentation = (hiddenLayerIds: ReadonlySet<string>): CanvasLayerPresentation => ({
  layers: [],
  hiddenLayerIds,
  layerIdByElementId: new Map([
    ["front-child", "layer:front"],
    ["back-child", "layer:back"]
  ]),
  unmappedModuleDrawableIds: new Set()
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

  it.each(["group", "moduleInstance"] as const)(
    "filters %s selection frames by layer while leaving evaluation unchanged",
    (containerType) => {
      const elements = [
        element("container", "Container", containerType),
        element("front-child", "Front", "freePoint", containerType === "group" ? "container" : undefined),
        element("back-child", "Back", "freePoint", containerType === "group" ? "container" : undefined)
      ];
      const evaluation = evaluationForLayeredPoints();
      const geometryBefore = [...evaluation.computedGeometry];
      const sharedInput = {
        selectedElementIds: ["container"],
        elements,
        evaluation,
        moduleMaterialization: materialization("container", ["front-child", "back-child"]),
        visibilityProfiles: [profile],
        activeVisibilityProfileId: profile.id,
        viewportSize: { width: 200, height: 100 },
        canvasViewport: { panX: 0, panY: 0, zoom: 2 }
      };

      const bothVisible = moduleInstanceSelectionFrameOverlays({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set())
      });
      expect(bothVisible).toHaveLength(1);
      expect(bothVisible[0]!.width).toBeGreaterThan(16);
      expect(bothVisible[0]!.height).toBeGreaterThan(16);

      const oneVisible = moduleInstanceSelectionFrameOverlays({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set(["layer:back"]))
      });
      expect(oneVisible).toEqual([{
        instanceId: "container",
        name: "Container",
        left: 102,
        top: 22,
        width: 16,
        height: 16
      }]);

      const restored = moduleInstanceSelectionFrameOverlays({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set())
      });
      expect(restored).toEqual(bothVisible);

      expect(moduleInstanceSelectionFrameOverlays({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set(["layer:front", "layer:back"]))
      })).toEqual([]);
      expect([...evaluation.computedGeometry]).toEqual(geometryBefore);
    }
  );

  it("passes the host layer presentation into the selection-frame memo and dependencies", () => {
    const source = readFileSync("src/components/DrawingCanvas.tsx", "utf8");
    const start = source.indexOf("const moduleInstanceSelectionFrames = useMemo(");
    const end = source.indexOf("const interactiveOverlayLines", start);
    const memo = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(memo).toContain("canvasLayerPresentation: hostAdapter.canvasLayerPresentation");
    expect(memo).toContain("hostAdapter.canvasLayerPresentation,");
  });
});
