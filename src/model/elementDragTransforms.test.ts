import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import type { CadElement } from "../types/geometry";
import {
  moveBezierHandleByDeltaInElements,
  movePointElementByDeltaInElements
} from "./elementDragTransforms";

const polarPoint: CadElement = {
  id: "polar-point",
  name: "角度距離点",
  type: "polarOffsetPoint",
  visible: true,
  enabled: true,
  fromPointId: "point-a",
  angleDeg: 0,
  distance: 30
};

const withPolarPoint = () => [...sampleElements, polarPoint];

const curveWithIntermediate = (): CadElement[] =>
  sampleElements.map((element) =>
    element.id === "curve-ac" && element.type === "bezierCurve"
      ? {
          ...element,
          intermediatePoints: [
            {
              id: "mid-b",
              point: { mode: "reference" as const, pointId: "point-b" },
              handleAngleDeg: 0,
              incomingHandleLength: 10,
              outgoingHandleLength: 20
            }
          ]
        }
      : element
  );

const elementById = (elements: CadElement[], id: string) => {
  const element = elements.find((item) => item.id === id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element;
};

describe("elementDragTransforms", () => {
  it("moves free points and keeps numeric expressions stable", () => {
    const elements: CadElement[] = [
      {
        ...(sampleElements[0] as Extract<CadElement, { type: "freePoint" }>),
        x: { kind: "expression", expression: "line-ab.length + 10" }
      },
      ...sampleElements.slice(1)
    ];

    const moved = movePointElementByDeltaInElements(elements, "point-a", { dx: 12, dy: -5 });

    expect(moved?.[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length + 22" },
      y: 45
    });
  });

  it("moves offset points by updating dx and dy", () => {
    const moved = movePointElementByDeltaInElements(sampleElements, "point-b", {
      dx: 12,
      dy: -5
    });

    expect(moved?.[1]).toMatchObject({
      fromPointId: "point-a",
      dx: 112,
      dy: -5
    });
  });

  it("moves polar offset points by updating angle and distance", () => {
    const moved = movePointElementByDeltaInElements(withPolarPoint(), "polar-point", {
      dx: 0,
      dy: -10
    });
    const point = moved?.at(-1);

    expect(point).toMatchObject({ type: "polarOffsetPoint" });
    if (point?.type !== "polarOffsetPoint") throw new Error("Expected a polar offset point");
    expect(point.angleDeg).toBeCloseTo(18.43494882292201);
    expect(point.distance).toBeCloseTo(31.622776601683793);
  });

  it("respects polar point angle and distance locks", () => {
    const angleLocked = movePointElementByDeltaInElements(withPolarPoint(), "polar-point", {
      dx: 0,
      dy: -10,
      angleLocked: true
    });
    const distanceLocked = movePointElementByDeltaInElements(withPolarPoint(), "polar-point", {
      dx: 0,
      dy: -10,
      distanceLocked: true
    });
    const bothLocked = movePointElementByDeltaInElements(withPolarPoint(), "polar-point", {
      dx: 0,
      dy: -10,
      angleLocked: true,
      distanceLocked: true
    });

    expect(angleLocked).toBeNull();
    expect(distanceLocked?.at(-1)).toMatchObject({ distance: 30 });
    const distanceLockedPoint = distanceLocked?.at(-1);
    if (distanceLockedPoint?.type !== "polarOffsetPoint") {
      throw new Error("Expected a polar offset point");
    }
    expect(distanceLockedPoint.angleDeg).toBeCloseTo(18.43494882292201);
    expect(bothLocked).toBeNull();
  });

  it("returns null for zero movement, missing ids, and non-point targets", () => {
    expect(movePointElementByDeltaInElements(sampleElements, "point-a", { dx: 0, dy: 0 })).toBeNull();
    expect(movePointElementByDeltaInElements(sampleElements, "missing", { dx: 1, dy: 1 })).toBeNull();
    expect(movePointElementByDeltaInElements(sampleElements, "line-ab", { dx: 1, dy: 1 })).toBeNull();
  });

  it("moves Bezier start and end handles", () => {
    const startMoved = moveBezierHandleByDeltaInElements(sampleElements, "curve-ac", {
      role: "start",
      dx: 0,
      dy: -45
    });
    const endMoved = moveBezierHandleByDeltaInElements(sampleElements, "curve-ac", {
      role: "end",
      dx: 35,
      dy: 0
    });
    const startCurve = elementById(startMoved ?? [], "curve-ac");
    const endCurve = elementById(endMoved ?? [], "curve-ac");

    if (startCurve.type !== "bezierCurve" || endCurve.type !== "bezierCurve") {
      throw new Error("Expected Bezier curves");
    }
    expect(startCurve.startHandleAngleDeg).toBeCloseTo(45);
    expect(startCurve.startHandleLength).toBeCloseTo(63.63961030678928);
    expect(endCurve.endHandleAngleDeg).toBeCloseTo(135);
    expect(endCurve.endHandleLength).toBeCloseTo(49.49747468305833);
  });

  it("respects Bezier angle and distance locks", () => {
    const angleLocked = moveBezierHandleByDeltaInElements(sampleElements, "curve-ac", {
      role: "start",
      dx: 10,
      dy: -45,
      angleLocked: true
    });
    const distanceLocked = moveBezierHandleByDeltaInElements(sampleElements, "curve-ac", {
      role: "start",
      dx: 0,
      dy: -45,
      distanceLocked: true
    });
    const bothLocked = moveBezierHandleByDeltaInElements(sampleElements, "curve-ac", {
      role: "start",
      dx: 0,
      dy: -45,
      angleLocked: true,
      distanceLocked: true
    });
    const angleLockedCurve = elementById(angleLocked ?? [], "curve-ac");
    const distanceLockedCurve = elementById(distanceLocked ?? [], "curve-ac");

    if (angleLockedCurve.type !== "bezierCurve" || distanceLockedCurve.type !== "bezierCurve") {
      throw new Error("Expected Bezier curves");
    }
    expect(angleLockedCurve.startHandleAngleDeg).toBe(0);
    expect(angleLockedCurve.startHandleLength).toBeCloseTo(55);
    expect(distanceLockedCurve.startHandleAngleDeg).toBeCloseTo(45);
    expect(distanceLockedCurve.startHandleLength).toBe(45);
    expect(bothLocked).toBeNull();
  });

  it("moves Bezier intermediate incoming and outgoing handles", () => {
    const incomingMoved = moveBezierHandleByDeltaInElements(curveWithIntermediate(), "curve-ac", {
      role: "intermediateIncoming",
      intermediatePointId: "mid-b",
      dx: 0,
      dy: -10
    });
    const outgoingMoved = moveBezierHandleByDeltaInElements(curveWithIntermediate(), "curve-ac", {
      role: "intermediateOutgoing",
      intermediatePointId: "mid-b",
      dx: 0,
      dy: -10
    });
    const incomingCurve = elementById(incomingMoved ?? [], "curve-ac");
    const outgoingCurve = elementById(outgoingMoved ?? [], "curve-ac");

    if (incomingCurve.type !== "bezierCurve" || outgoingCurve.type !== "bezierCurve") {
      throw new Error("Expected Bezier curves");
    }
    expect(incomingCurve.intermediatePoints[0].handleAngleDeg).toBeCloseTo(315);
    expect(incomingCurve.intermediatePoints[0].incomingHandleLength).toBeCloseTo(
      14.142135623730951
    );
    expect(incomingCurve.intermediatePoints[0].outgoingHandleLength).toBe(20);
    expect(outgoingCurve.intermediatePoints[0].handleAngleDeg).toBeCloseTo(26.565051177077976);
    expect(outgoingCurve.intermediatePoints[0].incomingHandleLength).toBe(10);
    expect(outgoingCurve.intermediatePoints[0].outgoingHandleLength).toBeCloseTo(
      22.360679774997898
    );
  });

  it("updates a local variable referenced by a Bezier handle length", () => {
    const elements: CadElement[] = sampleElements.map((element) =>
      element.id === "curve-ac" && element.type === "bezierCurve"
        ? {
            ...element,
            numericVariables: [{ id: "shared", name: "共通長", value: 45 }],
            startHandleLength: { kind: "expression" as const, expression: "@shared" },
            endHandleLength: { kind: "expression" as const, expression: "@shared" }
          }
        : element
    );

    const moved = moveBezierHandleByDeltaInElements(elements, "curve-ac", {
      role: "start",
      dx: 10,
      dy: -45,
      angleLocked: true
    });
    const curve = elementById(moved ?? [], "curve-ac");

    if (curve.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.numericVariables?.[0].value).toBeCloseTo(55);
    expect(curve.startHandleLength).toEqual({ kind: "expression", expression: "@shared" });
    expect(curve.endHandleLength).toEqual({ kind: "expression", expression: "@shared" });
  });

  it("returns null for missing Bezier targets and invalid handle targets", () => {
    expect(
      moveBezierHandleByDeltaInElements(sampleElements, "missing", {
        role: "start",
        dx: 1,
        dy: 1
      })
    ).toBeNull();
    expect(
      moveBezierHandleByDeltaInElements(sampleElements, "point-a", {
        role: "start",
        dx: 1,
        dy: 1
      })
    ).toBeNull();
    expect(
      moveBezierHandleByDeltaInElements(sampleElements, "curve-ac", {
        role: "intermediateIncoming",
        intermediatePointId: "missing",
        dx: 1,
        dy: 1
      })
    ).toBeNull();
  });
});
