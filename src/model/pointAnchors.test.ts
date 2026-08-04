import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { derivedAnchor, derivedPointLabel, pointAnchorLabel } from "./pointAnchors";

const curve: CadElement = {
  id: "curve",
  name: "曲線",
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "coordinate", x: 0, y: 0 },
  startHandleAngleDeg: 0,
  startHandleLength: 20,
  intermediatePoints: [
    {
      id: "mid-a",
      point: { mode: "coordinate", x: 20, y: 10 },
      handleAngleDeg: 45,
      incomingHandleLength: 10,
      outgoingHandleLength: 10
    },
    {
      id: "mid-b",
      point: { mode: "coordinate", x: 40, y: 10 },
      handleAngleDeg: 45,
      incomingHandleLength: 10,
      outgoingHandleLength: 10
    }
  ],
  endPoint: { mode: "coordinate", x: 60, y: 0 },
  endHandleAngleDeg: 180,
  endHandleLength: 20
};

describe("pointAnchors", () => {
  it("labels Bezier intermediate derived points with stable indexes", () => {
    expect(pointAnchorLabel(derivedAnchor("curve", "intermediate:mid-b"), [curve])).toBe(
      "曲線.中間点2"
    );
    expect(derivedPointLabel("curve", "intermediate:missing", [curve])).toBe(
      "曲線.中間点missing"
    );
  });

  it("labels common derived point keys consistently", () => {
    expect(derivedPointLabel("curve", "start", [curve])).toBe("曲線.始点");
    expect(derivedPointLabel("curve", "end", [curve])).toBe("曲線.終点");
    expect(derivedPointLabel("arc", "center", [])).toBe("arc.中心点");
  });
});
