import { describe, expect, it } from "vitest";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import {
  canvasElementDrawingBounds,
  canvasPresentationEligibleElementIds,
  visibleCanvasDrawingBounds
} from "./canvasDrawingBounds";

const element = (id: string, type: CadElement["type"], activity: CadElement["activity"] = "visible") => ({
  id,
  name: id,
  type,
  activity
} as CadElement);

const evaluationFor = (
  geometry: ComputedGeometry[],
  visibleIds: string[],
  options: {
    evaluatedIds?: string[];
    enabledIds?: string[];
    conditionInactiveIds?: string[];
  } = {}
): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: [],
  effectiveVisibleElementIds: new Set(visibleIds),
  evaluatedElementIds: new Set(options.evaluatedIds ?? visibleIds),
  effectiveEnabledElementIds: new Set(options.enabledIds ?? visibleIds),
  conditionInactiveElementIds: new Set(options.conditionInactiveIds ?? [])
});

const textGeometry = ({
  elementId = "text",
  text = "A",
  x = 10,
  y = 20,
  fontSize = 5
}: {
  elementId?: string;
  text?: string;
  x?: number;
  y?: number;
  fontSize?: number;
} = {}): ComputedGeometry => ({
  kind: "text",
  elementId,
  name: elementId,
  text,
  anchor: { kind: "point", elementId: `${elementId}-anchor`, name: `${elementId}-anchor`, x, y },
  fontSize
});

describe("visibleCanvasDrawingBounds", () => {
  it("reuses the exact curve extent path for one visible target", () => {
    const curve: ComputedGeometry = {
      kind: "bezierCurve",
      elementId: "curve",
      name: "curve",
      startPointId: null,
      endPointId: null,
      intermediatePointIds: [],
      intermediateSlotIds: [],
      segments: [{
        startPointId: null,
        endPointId: null,
        start: { kind: "point", elementId: "start", name: "start", x: 0, y: 0 },
        control1: { x: 0, y: 100 },
        control2: { x: 100, y: 100 },
        end: { kind: "point", elementId: "end", name: "end", x: 100, y: 0 }
      }],
      length: 0,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null,
      startHandleAngleDeg: 0,
      startHandleLength: 0,
      endHandleAngleDeg: 0,
      endHandleLength: 0
    };
    const profiles = [defaultVisibilityProfile()];
    expect(canvasElementDrawingBounds({
      elementId: "curve",
      elements: [element("curve", "bezierCurve")],
      evaluation: evaluationFor([curve], ["curve"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    })).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 75 });
  });
  it("uses actual cubic extrema and excludes hidden, disabled, and image geometry", () => {
    const curve: ComputedGeometry = {
      kind: "bezierCurve",
      elementId: "curve",
      name: "curve",
      startPointId: null,
      endPointId: null,
      intermediatePointIds: [],
      intermediateSlotIds: [],
      segments: [{
        startPointId: null,
        endPointId: null,
        start: { kind: "point", elementId: "start", name: "start", x: 0, y: 0 },
        control1: { x: 0, y: 100 },
        control2: { x: 100, y: 100 },
        end: { kind: "point", elementId: "end", name: "end", x: 100, y: 0 }
      }],
      length: 0,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null,
      startHandleAngleDeg: 0,
      startHandleLength: 0,
      endHandleAngleDeg: 0,
      endHandleLength: 0
    };
    const hiddenPoint: ComputedGeometry = {
      kind: "point",
      elementId: "hidden",
      name: "hidden",
      x: -100,
      y: -100
    };
    const disabledPoint: ComputedGeometry = {
      kind: "point",
      elementId: "disabled",
      name: "disabled",
      x: 200,
      y: 200
    };
    const image: ComputedGeometry = {
      kind: "image",
      elementId: "image",
      name: "image",
      sourcePath: "reference.png",
      origin: { kind: "point", elementId: "image-origin", name: "image-origin", x: -500, y: -500 },
      naturalWidthPx: 100,
      naturalHeightPx: 100,
      sourceDpi: 96,
      targetPixelsPerMm: 1,
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      widthMm: 1000,
      heightMm: 1000
    };
    const profiles = [defaultVisibilityProfile()];
    const bounds = visibleCanvasDrawingBounds({
      elements: [
        element("curve", "bezierCurve"),
        element("hidden", "freePoint", "hidden"),
        element("disabled", "freePoint", "disabled"),
        element("image", "image")
      ],
      evaluation: evaluationFor([curve, hiddenPoint, disabledPoint, image], ["curve", "hidden", "disabled", "image"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    });

    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 75 });
  });

  it("includes cardinal extrema reached by a visible arc", () => {
    const arc: ComputedGeometry = {
      kind: "arcLine",
      elementId: "arc",
      name: "arc",
      centerPointId: null,
      center: { kind: "point", elementId: "center", name: "center", x: 0, y: 0 },
      start: { kind: "point", elementId: "start", name: "start", x: 10, y: 0 },
      end: { kind: "point", elementId: "end", name: "end", x: 0, y: 10 },
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 90,
      sweepAngleDeg: 90,
      length: 0
    };
    const profiles = [defaultVisibilityProfile()];

    expect(visibleCanvasDrawingBounds({
      elements: [element("arc", "arcLine")],
      evaluation: evaluationFor([arc], ["arc"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    })).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it("includes all ordered polyline segment endpoints", () => {
    const start = { kind: "point" as const, elementId: "start", name: "start", x: -5, y: 2 };
    const corner = { kind: "point" as const, elementId: "corner", name: "corner", x: 10, y: 20 };
    const polyline: ComputedGeometry = {
      kind: "polyline",
      elementId: "polyline",
      name: "polyline",
      segments: [{ kind: "line", start, end: corner, length: 0 }],
      closed: false,
      start,
      end: corner,
      length: 0,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null
    };
    const profiles = [defaultVisibilityProfile()];

    expect(visibleCanvasDrawingBounds({
      elements: [element("polyline", "polyline")],
      evaluation: evaluationFor([polyline], ["polyline"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    })).toEqual({ minX: -5, minY: 2, maxX: 10, maxY: 20 });
  });

  it("includes the drawable extent of visible text instead of only its anchor", () => {
    const profiles = [defaultVisibilityProfile()];

    expect(visibleCanvasDrawingBounds({
      elements: [element("text", "text")],
      evaluation: evaluationFor([textGeometry()], ["text"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      measureCanvasTextWidth: () => 5
    })).toEqual({ minX: 10, minY: 15, maxX: 15, maxY: 20 });
  });

  it("uses the supplied measured width for ASCII-heavy text", () => {
    const profiles = [defaultVisibilityProfile()];
    const bounds = visibleCanvasDrawingBounds({
      elements: [element("text", "text")],
      evaluation: evaluationFor([textGeometry({ text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", fontSize: 4 })], ["text"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      measureCanvasTextWidth: () => 18
    });

    expect(bounds).toEqual({ minX: 10, minY: 16, maxX: 28, maxY: 20 });
  });

  it("uses the longest measured line for mixed ASCII and CJK text", () => {
    const profiles = [defaultVisibilityProfile()];
    const bounds = visibleCanvasDrawingBounds({
      elements: [element("text", "text")],
      evaluation: evaluationFor([textGeometry({ text: "ASCII\n日本語", fontSize: 4 })], ["text"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      measureCanvasTextWidth: (line) => line === "ASCII" ? 12 : 27
    });

    expect(bounds).toEqual({ minX: 10, minY: 11.2, maxX: 37, maxY: 20 });
  });

  it("uses the CanvasOverlay line advance for multiline text", () => {
    const profiles = [defaultVisibilityProfile()];
    const bounds = visibleCanvasDrawingBounds({
      elements: [element("text", "text")],
      evaluation: evaluationFor([textGeometry({ text: "first\nsecond\nthird", fontSize: 10 })], ["text"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      measureCanvasTextWidth: (line) => ({ first: 40, second: 60, third: 50 })[line] ?? 0
    });

    expect(bounds).toEqual({ minX: 10, minY: -14, maxX: 70, maxY: 20 });
  });

  it("excludes hidden and disabled text from Fit Drawing bounds", () => {
    const profiles = [defaultVisibilityProfile()];
    const bounds = visibleCanvasDrawingBounds({
      elements: [
        element("visible", "text"),
        element("hidden", "text", "hidden"),
        element("disabled", "text", "disabled")
      ],
      evaluation: evaluationFor([
        textGeometry({ elementId: "visible", x: 0, y: 0 }),
        textGeometry({ elementId: "hidden", x: -1000, y: 1000, text: "hidden" }),
        textGeometry({ elementId: "disabled", x: 1000, y: -1000, text: "disabled" })
      ], ["visible", "hidden", "disabled"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      measureCanvasTextWidth: () => 5
    });

    expect(bounds).toEqual({ minX: 0, minY: -5, maxX: 5, maxY: 0 });
  });

  it("ignores malformed text geometry without producing non-finite bounds", () => {
    const profiles = [defaultVisibilityProfile()];
    const malformed = {
      ...textGeometry({ elementId: "malformed" }),
      anchor: { kind: "point", elementId: "malformed-anchor", name: "malformed-anchor", x: Number.NaN, y: 20 },
      fontSize: Number.POSITIVE_INFINITY
    } as ComputedGeometry;
    const bounds = visibleCanvasDrawingBounds({
      elements: [element("valid", "freePoint"), element("malformed", "text")],
      evaluation: evaluationFor([
        { kind: "point", elementId: "valid", name: "valid", x: 3, y: 4 },
        malformed
      ], ["valid", "malformed"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    });

    expect(bounds).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
    expect(Object.values(bounds ?? {}).every(Number.isFinite)).toBe(true);
  });

  it.each([null, Number.NaN, -1])("fails closed when visible text measurement returns %s", (measuredWidth) => {
    const profiles = [defaultVisibilityProfile()];
    const bounds = visibleCanvasDrawingBounds({
      elements: [element("text", "text")],
      evaluation: evaluationFor([textGeometry()], ["text"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id,
      measureCanvasTextWidth: () => measuredWidth
    });

    expect(bounds).toBeNull();
  });

  it("fails closed when visible text has no measurement capability", () => {
    const profiles = [defaultVisibilityProfile()];

    expect(visibleCanvasDrawingBounds({
      elements: [element("text", "text")],
      evaluation: evaluationFor([textGeometry()], ["text"]),
      visibilityProfiles: profiles,
      activeVisibilityProfileId: profiles[0]!.id
    })).toBeNull();
  });
});

describe("canvasPresentationEligibleElementIds", () => {
  const pointGeometry = (elementId: string, x = 0, y = 0): ComputedGeometry => ({
    kind: "point",
    elementId,
    name: elementId,
    x,
    y
  });

  it("prunes hidden, disabled, profile-excluded, condition-inactive, limited, and absent presentations", () => {
    const elements = [
      element("visible", "freePoint"),
      element("hidden", "freePoint", "hidden"),
      element("disabled", "freePoint", "disabled"),
      element("profile", "freePoint"),
      element("condition", "freePoint"),
      element("limited", "freePoint"),
      element("absent", "freePoint")
    ];
    const profile = {
      id: "draft",
      name: "Draft",
      defaultRoleVisible: true,
      roleVisibility: { construction: false }
    };
    const profileGroup = {
      id: "profile-group",
      name: "Profile group",
      type: "group" as const,
      activity: "visible" as const,
      visibilityRoleIds: ["construction"]
    };
    const profileChild = {
      id: "profile-child",
      name: "Profile child",
      type: "freePoint" as const,
      activity: "visible" as const,
      parentGroupId: "profile-group",
      x: 0,
      y: 0
    };
    const allElements = [
      ...elements.map((item) => item.id === "profile" ? { ...item, parentGroupId: "profile-group" } : item),
      profileGroup,
      profileChild
    ];
    const geometry = [
      pointGeometry("visible"),
      pointGeometry("hidden"),
      pointGeometry("disabled"),
      pointGeometry("profile"),
      pointGeometry("condition"),
      pointGeometry("limited"),
      pointGeometry("profile-child")
    ];
    const ids = canvasPresentationEligibleElementIds({
      elements: allElements,
      evaluation: evaluationFor(geometry, allElements.map((item) => item.id), {
        evaluatedIds: ["visible", "hidden", "profile", "condition", "profile-child"],
        enabledIds: ["visible", "hidden", "profile", "condition", "profile-child"],
        conditionInactiveIds: ["condition"]
      }),
      visibilityProfiles: [profile],
      activeVisibilityProfileId: "draft",
      showCanvasPoints: true
    });

    expect(ids).toEqual(new Set(["visible"]));
  });

  it("requires a normal computed presentation and a real text anchor", () => {
    const anchoredText = textGeometry({ elementId: "anchored" });
    const unanchoredText = { ...anchoredText, elementId: "unanchored", anchor: null };
    const staleContainerGeometry = pointGeometry("group");
    const staleRuntimeGeometry = pointGeometry("module");
    const elements = [
      element("anchored", "text"),
      element("unanchored", "text"),
      element("group", "group"),
      element("module", "moduleInstance")
    ];
    const ids = canvasPresentationEligibleElementIds({
      elements,
      evaluation: evaluationFor([anchoredText, unanchoredText, staleContainerGeometry, staleRuntimeGeometry], elements.map((item) => item.id)),
      visibilityProfiles: [],
      activeVisibilityProfileId: null,
      showCanvasPoints: true
    });

    expect(ids).toEqual(new Set(["anchored"]));
  });

  it("excludes structural/container elements even when stale computed geometry is present", () => {
    const elements = [element("group", "group"), element("module", "moduleInstance")];
    const evaluation = evaluationFor([], ["group", "module"]);

    expect(canvasPresentationEligibleElementIds({
      elements,
      evaluation,
      visibilityProfiles: [],
      activeVisibilityProfileId: null,
      showCanvasPoints: true
    })).toEqual(new Set());
  });

  it("excludes normal points when point presentation is disabled without affecting other presented geometry", () => {
    const point = pointGeometry("point", 1_000_000, 1_000_000);
    const image: ComputedGeometry = {
      kind: "image",
      elementId: "image",
      name: "image",
      sourcePath: "reference.png",
      origin: { kind: "point", elementId: "image-origin", name: "origin", x: 0, y: 0 },
      naturalWidthPx: 100,
      naturalHeightPx: 100,
      sourceDpi: 96,
      targetPixelsPerMm: 1,
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      widthMm: 100,
      heightMm: 100
    };
    const elements = [element("point", "freePoint"), element("image", "image")];
    const evaluation = evaluationFor([point, image], ["point", "image"]);

    expect(canvasPresentationEligibleElementIds({
      elements,
      evaluation,
      visibilityProfiles: [],
      activeVisibilityProfileId: null,
      showCanvasPoints: false
    })).toEqual(new Set(["image"]));
    expect(visibleCanvasDrawingBounds({
      elements,
      evaluation,
      visibilityProfiles: [],
      activeVisibilityProfileId: null
    })).toEqual({
      minX: 1_000_000,
      minY: 1_000_000,
      maxX: 1_000_000,
      maxY: 1_000_000
    });
  });

  it("keeps ordinary offscreen presented geometry eligible", () => {
    const offscreen = pointGeometry("offscreen", -1_000_000, 1_000_000);
    expect(canvasPresentationEligibleElementIds({
      elements: [element("offscreen", "freePoint")],
      evaluation: evaluationFor([offscreen], ["offscreen"]),
      visibilityProfiles: [],
      activeVisibilityProfileId: null,
      showCanvasPoints: true
    })).toEqual(new Set(["offscreen"]));
  });
});
