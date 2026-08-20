export const CANVAS_BASE_DRAW_ORDER = [
  "image",
  "line",
  "arcLine",
  "bezierCurve",
  "offsetLine",
  "text",
  "point"
] as const;

export type CanvasIdentityKind = (typeof CANVAS_BASE_DRAW_ORDER)[number];

export const canvasBaseDrawRank = (kind: CanvasIdentityKind): number =>
  CANVAS_BASE_DRAW_ORDER.indexOf(kind);

/** Sorts Canvas geometry hits from front to back. */
export const compareCanvasBaseDrawOrder = (
  a: { kind: CanvasIdentityKind; arrayIndex: number },
  b: { kind: CanvasIdentityKind; arrayIndex: number }
): number =>
  canvasBaseDrawRank(b.kind) - canvasBaseDrawRank(a.kind) || b.arrayIndex - a.arrayIndex;
