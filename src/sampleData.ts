import type { CadElement } from "./types/geometry";

export const sampleElements: CadElement[] = [
  {
    id: "point-a",
    name: "点A",
    type: "freePoint",
    activity: "visible",
    x: 50,
    y: -50
  },
  {
    id: "point-b",
    name: "点B",
    type: "offsetPoint",
    activity: "visible",
    fromPointId: "point-a",
    dx: 100,
    dy: 0
  },
  {
    id: "point-c",
    name: "点C",
    type: "offsetPoint",
    activity: "visible",
    fromPointId: "point-b",
    dx: 0,
    dy: -80
  },
  {
    id: "line-ab",
    name: "直線AB",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "point-a" },
    endPoint: { mode: "reference", pointId: "point-b" }
  },
  {
    id: "line-bc",
    name: "直線BC",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "point-b" },
    endPoint: { mode: "reference", pointId: "point-c" }
  },
  {
    id: "curve-ac",
    name: "曲線AC",
    type: "bezierCurve",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "point-a" },
    startHandleAngleDeg: 0,
    startHandleLength: 45,
    intermediatePoints: [],
    endPoint: { mode: "reference", pointId: "point-c" },
    endHandleAngleDeg: 90,
    endHandleLength: 35
  }
];
