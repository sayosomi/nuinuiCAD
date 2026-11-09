import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ModuleMaterialization } from "@nuinuicad/nui-language";
import { defaultVisibilityProfile } from "@nuinuicad/nui-language";
import type { CanvasLayerPresentation } from "../model/canvasLayerPresentation";
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
const layerPresentation = (hiddenLayerIds: ReadonlySet<string>): CanvasLayerPresentation => ({
  layers: [],
  hiddenLayerIds,
  layerIdByElementId: new Map([
    ["front-child", "layer:front"],
    ["back-child", "layer:back"]
  ]),
  unmappedModuleDrawableIds: new Set()
});
const targetFor = ({
  runtimeElementIds,
  elements,
  evaluation,
  evaluationIsCurrent = true,
  moduleMaterialization,
  canvasLayerPresentation
}: {
  runtimeElementIds: string[];
  elements: CadElement[];
  evaluation: EvaluationResult;
  evaluationIsCurrent?: boolean;
  moduleMaterialization?: ModuleMaterialization;
  canvasLayerPresentation?: CanvasLayerPresentation;
}) => canvasNavigationContainerTarget({
  runtimeElementIds,
  elements,
  evaluation,
  evaluationIsCurrent,
  moduleMaterialization,
  canvasLayerPresentation,
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

  it.each(["group", "moduleInstance"] as const)(
    "filters %s Reveal bounds by layer and returns no geometry when all descendants are hidden",
    (containerType) => {
      const elements = [
        element("container", containerType),
        element("front-child", "freePoint", containerType === "group" ? "container" : undefined),
        element("back-child", "freePoint", containerType === "group" ? "container" : undefined)
      ];
      const evaluation = evaluationFor([
        point("front-child", 5, 10),
        point("back-child", 105, 210)
      ]);
      const geometryBefore = [...evaluation.computedGeometry];
      const sharedInput = {
        runtimeElementIds: ["container"],
        elements,
        evaluation,
        moduleMaterialization: materialization("container", ["front-child", "back-child"])
      };

      const bothVisible = targetFor({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set())
      });
      expect(bothVisible).toEqual({
        status: "ready",
        containerId: "container",
        bounds: { minX: 5, minY: 10, maxX: 105, maxY: 210 }
      });

      expect(targetFor({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set(["layer:back"]))
      })).toEqual({
        status: "ready",
        containerId: "container",
        bounds: { minX: 5, minY: 10, maxX: 5, maxY: 10 }
      });

      expect(targetFor({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set())
      })).toEqual(bothVisible);
      expect(targetFor({
        ...sharedInput,
        canvasLayerPresentation: layerPresentation(new Set(["layer:front", "layer:back"]))
      })).toEqual({ status: "no-renderable-geometry" });
      expect([...evaluation.computedGeometry]).toEqual(geometryBefore);
    }
  );

  it("keeps activity and visibility-profile gates authoritative with layer projection", () => {
    const elements: CadElement[] = [
      element("group", "group"),
      { ...element("role-group", "group", "group"), visibilityRoleIds: ["construction"] } as CadElement,
      element("visible", "freePoint", "group"),
      element("inactive", "freePoint", "group", "hidden"),
      element("profile-hidden", "freePoint", "role-group")
    ];
    const evaluation = evaluationFor([
      point("visible", 5, 10),
      point("inactive", -100, -100),
      point("profile-hidden", 100, 100)
    ]);
    const visibilityProfile = {
      id: "draft",
      name: "Draft",
      defaultRoleVisible: true,
      roleVisibility: { construction: false }
    };
    const sharedInput = {
      runtimeElementIds: ["group"],
      elements,
      evaluation,
      evaluationIsCurrent: true,
      visibilityProfiles: [visibilityProfile],
      activeVisibilityProfileId: "draft"
    };

    expect(canvasNavigationContainerTarget(sharedInput)).toEqual({
      status: "ready",
      containerId: "group",
      bounds: { minX: 5, minY: 10, maxX: 5, maxY: 10 }
    });
    expect(canvasNavigationContainerTarget({
      ...sharedInput,
      canvasLayerPresentation: {
        ...layerPresentation(new Set(["layer:front"])),
        layerIdByElementId: new Map([["visible", "layer:front"]])
      }
    })).toEqual({ status: "no-renderable-geometry" });
  });

  it("passes the projected layer presentation from the production Reveal caller", () => {
    const source = readFileSync("src/vscode/VSCodeApp.tsx", "utf8");
    const start = source.indexOf("const containerTarget = canvasNavigationContainerTarget({");
    const end = source.indexOf("\n          });", start);
    const call = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(call).toContain("canvasLayerPresentation: layerPresentation");
  });
});
