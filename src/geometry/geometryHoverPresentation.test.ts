import { describe, expect, it } from "vitest";
import type { CadElement, EvaluationResult } from "../types/geometry";
import {
  geometryHoverMarkdown,
  geometryHoverPresentation
} from "./geometryHoverPresentation";

const elementFor = (activity: CadElement["activity"] = "visible"): CadElement => ({
  id: "point-a",
  name: "A",
  type: "freePoint",
  activity,
  x: 1,
  y: 2
});

const evaluationFor = ({
  geometry = true,
  evaluated = true,
  enabled = true,
  visible = true,
  inactive = false,
  error = false,
  warning = false
}: {
  geometry?: boolean;
  evaluated?: boolean;
  enabled?: boolean;
  visible?: boolean;
  inactive?: boolean;
  error?: boolean;
  warning?: boolean;
} = {}): EvaluationResult => ({
  computedGeometry: new Map(geometry ? [["point-a", {
    kind: "point" as const,
    elementId: "point-a",
    name: "A",
    x: 1,
    y: 2
  }]] : []),
  errors: error ? [{
    elementId: "point-a",
    elementName: "A",
    missingDependencyId: "missing",
    message: "failed"
  }] : [],
  warnings: warning ? [{
    elementId: "point-a",
    elementName: "A",
    message: "warning"
  }] : [],
  evaluatedElementIds: new Set(evaluated ? ["point-a"] : []),
  effectiveEnabledElementIds: new Set(enabled ? ["point-a"] : []),
  effectiveVisibleElementIds: new Set(visible ? ["point-a"] : []),
  conditionInactiveElementIds: new Set(inactive ? ["point-a"] : [])
});

describe("geometry Hover runtime presentation", () => {
  it("shows shared current geometry rows for a visible evaluated element", () => {
    const presentation = geometryHoverPresentation(elementFor(), evaluationFor());

    expect(presentation).toEqual({
      heading: "A · free point",
      statuses: [],
      availability: {
        kind: "geometry",
        rows: [{ label: "座標", value: "(1, 2)" }]
      }
    });
    expect(geometryHoverMarkdown(presentation)).toContain("**座標:** \\(1, 2\\)");
  });

  it("keeps current geometry while surfacing hidden and issue states", () => {
    const presentation = geometryHoverPresentation(
      elementFor("hidden"),
      evaluationFor({ visible: false, error: true, warning: true })
    );

    expect(presentation.statuses).toEqual(["Hidden", "Error", "Warning"]);
    expect(presentation.availability.kind).toBe("geometry");
  });

  it("shows disabled and inactive elements as not evaluated without geometry", () => {
    expect(geometryHoverPresentation(
      elementFor("disabled"),
      evaluationFor({ enabled: false })
    )).toMatchObject({
      statuses: ["Disabled"],
      availability: { kind: "not-evaluated" }
    });

    expect(geometryHoverPresentation(
      elementFor(),
      evaluationFor({ inactive: true })
    )).toMatchObject({
      statuses: ["Inactive"],
      availability: { kind: "not-evaluated" }
    });
  });

  it("shows an evaluated-limit miss as not evaluated", () => {
    const presentation = geometryHoverPresentation(
      elementFor(),
      evaluationFor({ evaluated: false, geometry: false })
    );

    expect(presentation).toMatchObject({
      statuses: [],
      availability: { kind: "not-evaluated" }
    });
    expect(geometryHoverMarkdown(presentation)).toContain("Not evaluated");
  });

  it("does not invent geometry when current evaluation has none", () => {
    const presentation = geometryHoverPresentation(
      elementFor(),
      evaluationFor({ geometry: false, error: true })
    );

    expect(presentation).toMatchObject({
      statuses: ["Error"],
      availability: { kind: "unavailable" }
    });
    expect(geometryHoverMarkdown(presentation)).toContain("Geometry unavailable");
  });
});
