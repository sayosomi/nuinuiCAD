import type { ScreenPoint } from "./DrawingCanvasHitTest";

export type BezierHandleHitTarget = {
  control: ScreenPoint;
};

export type PointPickHitTarget = {
  screen: ScreenPoint;
};

export const squaredScreenDistance = (a: ScreenPoint, b: ScreenPoint) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const hitTestBezierHandle = <T extends BezierHandleHitTarget>(
  screen: ScreenPoint,
  handles: T[],
  hitRadiusPx: number
): T | null => {
  const hitRadiusSquared = hitRadiusPx * hitRadiusPx;
  for (let index = handles.length - 1; index >= 0; index -= 1) {
    if (squaredScreenDistance(screen, handles[index].control) <= hitRadiusSquared) {
      return handles[index];
    }
  }
  return null;
};

export const hitTestPointPickCandidates = <T extends PointPickHitTarget>(
  screen: ScreenPoint,
  candidates: T[],
  hitRadiusPx: number
) => {
  const hitRadiusSquared = hitRadiusPx * hitRadiusPx;
  const hits: T[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (squaredScreenDistance(screen, candidates[index].screen) <= hitRadiusSquared) {
      hits.push(candidates[index]);
    }
  }
  return hits;
};
