import type { CadElement } from "./types/geometry";

export const sampleElements: CadElement[] = [
  {
    id: "point-a",
    name: "点A",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 50,
    y: 50
  },
  {
    id: "point-b",
    name: "点B",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "point-a",
    dx: 100,
    dy: 0
  },
  {
    id: "point-c",
    name: "点C",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "point-b",
    dx: 0,
    dy: 80
  },
  {
    id: "line-ab",
    name: "直線AB",
    type: "line",
    visible: true,
    enabled: true,
    startPointId: "point-a",
    endPointId: "point-b"
  },
  {
    id: "line-bc",
    name: "直線BC",
    type: "line",
    visible: true,
    enabled: true,
    startPointId: "point-b",
    endPointId: "point-c"
  }
];
