import { describe, expect, it } from "vitest";
import type {
  CadElement,
  ComputedGeometry,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import { canvasPresentationEligibleElementIds } from "./canvasDrawingBounds";
import { canvasSelectionEligibleElementIds } from "./canvasSelectionEligibility";

const element = (
  id: string,
  type: CadElement["type"],
  patch: Partial<CadElement> = {}
): CadElement => ({
  id,
  name: id,
  type,
  activity: "visible",
  ...patch
} as CadElement);

const point = (elementId: string): ComputedGeometry => ({
  kind: "point",
  elementId,
  name: elementId,
  x: 1,
  y: 2
});

const image = (elementId: string): ComputedGeometry => ({
  kind: "image",
  elementId,
  name: elementId,
  sourcePath: "reference.png",
  origin: { kind: "point", elementId: `${elementId}-origin`, name: "origin", x: 0, y: 0 },
  naturalWidthPx: 100,
  naturalHeightPx: 100,
  sourceDpi: 96,
  targetPixelsPerMm: 1,
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
  widthMm: 100,
  heightMm: 100
});

const textWithoutAnchor = (elementId: string): ComputedGeometry => ({
  kind: "text",
  elementId,
  name: elementId,
  text: "text",
  anchor: null,
  fontSize: 5
});

const materializationFor = (
  snapshots: ModuleMaterialization["instanceBaseGeometrySnapshots"]
): Pick<ModuleMaterialization, "instanceBaseGeometrySnapshots"> => ({
  instanceBaseGeometrySnapshots: snapshots
});

const evaluationFor = (
  geometry: readonly ComputedGeometry[],
  options: {
    visible?: readonly string[];
    enabled?: readonly string[];
    conditionInactive?: readonly string[];
    evaluated?: readonly string[];
  } = {}
): EvaluationResult => {
  const ids = geometry.map((item) => item.elementId);
  return {
    computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
    errors: [],
    warnings: [],
    effectiveVisibleElementIds: new Set(options.visible ?? ids),
    effectiveEnabledElementIds: new Set(options.enabled ?? ids),
    conditionInactiveElementIds: new Set(options.conditionInactive ?? []),
    evaluatedElementIds: new Set(options.evaluated ?? ids)
  };
};

const profiles = [defaultVisibilityProfile()];

const sharedEligibilityFor = ({
  elements,
  geometry,
  materialization,
  showCanvasPoints,
  visibilityProfiles = profiles,
  activeVisibilityProfileId = visibilityProfiles[0]!.id,
  ...evaluationOptions
}: {
  elements: readonly CadElement[];
  geometry: readonly ComputedGeometry[];
  materialization: Pick<ModuleMaterialization, "instanceBaseGeometrySnapshots">;
  visible?: readonly string[];
  enabled?: readonly string[];
  conditionInactive?: readonly string[];
  evaluated?: readonly string[];
  showCanvasPoints?: boolean;
  visibilityProfiles?: readonly VisibilityProfile[];
  activeVisibilityProfileId?: string | null;
}) => canvasSelectionEligibleElementIds({
  elements,
  evaluation: evaluationFor(geometry, evaluationOptions),
  moduleMaterialization: materialization,
  visibilityProfiles,
  activeVisibilityProfileId,
  showCanvasPoints: showCanvasPoints ?? true
});

describe("canvasSelectionEligibleElementIds", () => {
  it("keeps ordinary presentation eligibility unchanged", () => {
    const elements = [element("point", "freePoint")];
    const evaluation = evaluationFor([point("point")]);
    const base = canvasPresentationEligibleElementIds({
      elements,
      evaluation,
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      showCanvasPoints: true
    });

    expect(canvasSelectionEligibleElementIds({
      elements,
      evaluation,
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      showCanvasPoints: true
    })).toEqual(base);
  });

  it("adds a qualifying concrete Module instance while keeping it out of base presentation eligibility", () => {
    const elements = [element("instance", "moduleInstance"), element("child", "freePoint")];
    const evaluation = evaluationFor([point("child")]);
    const materialization = materializationFor([{
      instanceId: "instance",
      endRuntimeIndex: 1,
      descendantIds: ["child"]
    }]);

    expect(canvasPresentationEligibleElementIds({
      elements,
      evaluation,
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      showCanvasPoints: true
    })).toEqual(new Set(["child"]));
    expect(canvasSelectionEligibleElementIds({
      elements,
      evaluation,
      moduleMaterialization: materialization,
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      showCanvasPoints: true
    })).toEqual(new Set(["child", "instance"]));
  });

  it("does not add a Module instance with no qualifying descendants", () => {
    const elements = [element("instance", "moduleInstance"), element("child", "freePoint")];

    expect(sharedEligibilityFor({
      elements,
      geometry: [],
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 1,
        descendantIds: ["child"]
      }])
    })).toEqual(new Set());
  });

  it("does not qualify an instance from hidden, disabled, profile-excluded, or inactive descendants", () => {
    const elements = [
      element("hidden-instance", "moduleInstance"),
      element("hidden-child", "freePoint"),
      element("disabled-instance", "moduleInstance"),
      element("disabled-child", "freePoint"),
      element("profile-instance", "moduleInstance"),
      element("profile-child", "freePoint", { parentGroupId: "profile-group" }),
      element("profile-group", "group", { visibilityRoleIds: ["construction"] }),
      element("inactive-instance", "moduleInstance"),
      element("inactive-child", "freePoint")
    ];
    const geometry = [
      point("hidden-child"),
      point("disabled-child"),
      point("profile-child"),
      point("inactive-child")
    ];
    const materialization = materializationFor([
      { instanceId: "hidden-instance", endRuntimeIndex: 1, descendantIds: ["hidden-child"] },
      { instanceId: "disabled-instance", endRuntimeIndex: 1, descendantIds: ["disabled-child"] },
      { instanceId: "profile-instance", endRuntimeIndex: 1, descendantIds: ["profile-child"] },
      { instanceId: "inactive-instance", endRuntimeIndex: 1, descendantIds: ["inactive-child"] }
    ]);
    const profile = {
      id: "draft",
      name: "Draft",
      defaultRoleVisible: true,
      roleVisibility: { construction: false }
    };
    const ids = sharedEligibilityFor({
      elements,
      geometry,
      materialization,
      visible: ["disabled-child", "profile-child", "inactive-child"],
      enabled: ["hidden-child", "profile-child", "inactive-child"],
      conditionInactive: ["inactive-child"],
      visibilityProfiles: [profile],
      activeVisibilityProfileId: profile.id
    });

    expect(ids).toEqual(new Set());
  });

  it("qualifies an instance from a presented reference image even though Fit Drawing excludes images", () => {
    const elements = [element("instance", "moduleInstance"), element("reference", "image")];
    const materialization = materializationFor([{
      instanceId: "instance",
      endRuntimeIndex: 1,
      descendantIds: ["reference"]
    }]);

    expect(sharedEligibilityFor({
      elements,
      geometry: [image("reference")],
      materialization
    })).toEqual(new Set(["reference", "instance"]));
  });

  it("does not qualify a point-only instance when Canvas points are suppressed", () => {
    const elements = [element("instance", "moduleInstance"), element("point", "freePoint")];

    expect(sharedEligibilityFor({
      elements,
      geometry: [point("point")],
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 1,
        descendantIds: ["point"]
      }]),
      showCanvasPoints: false
    })).toEqual(new Set());
  });

  it("does not qualify a text-only instance when the text has no anchor", () => {
    const elements = [element("instance", "moduleInstance"), element("text", "text")];

    expect(sharedEligibilityFor({
      elements,
      geometry: [textWithoutAnchor("text")],
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 1,
        descendantIds: ["text"]
      }])
    })).toEqual(new Set());
  });
});
