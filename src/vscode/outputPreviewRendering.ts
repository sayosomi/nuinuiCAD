import type {
  OutputDrawable,
  OutputPathSegment,
  OutputPlan,
  OutputPoint,
  OutputText
} from "../output/outputCore";
import {
  outputPreviewWorldToScreen,
  type OutputPreviewViewport,
  type OutputPreviewViewportSize
} from "./outputPreviewViewport";

export type OutputPreviewScreenPoint = { x: number; y: number };

export type OutputPreviewPageRect = OutputPreviewScreenPoint & {
  width: number;
  height: number;
};

export type OutputPreviewGuideLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export const outputPreviewScreenPointFor = (
  point: OutputPoint,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
): OutputPreviewScreenPoint => outputPreviewWorldToScreen(point, size, viewport);

export const outputPreviewPageRectsFor = (
  plan: OutputPlan,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
): OutputPreviewPageRect[] => {
  if (plan.kind !== "print" || !plan.print) return [];
  return plan.print.pages.map((page) => {
    const topLeft = outputPreviewScreenPointFor(
      { x: page.origin.x, y: page.origin.y + plan.print!.paperHeightMm },
      size,
      viewport
    );
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: plan.print!.paperWidthMm * viewport.zoom,
      height: plan.print!.paperHeightMm * viewport.zoom
    };
  });
};

export const outputPreviewGuideLinesFor = (
  plan: OutputPlan,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
): OutputPreviewGuideLine[] => {
  if (plan.kind !== "print" || !plan.print) return [];
  return plan.print.pages.flatMap((page) => page.guides.map((guide) => {
    const start = guide.axis === "vertical"
      ? { x: page.origin.x + guide.positionMm, y: page.origin.y }
      : { x: page.origin.x, y: page.origin.y + guide.positionMm };
    const end = guide.axis === "vertical"
      ? { x: start.x, y: page.origin.y + plan.print!.paperHeightMm }
      : { x: page.origin.x + plan.print!.paperWidthMm, y: start.y };
    const screenStart = outputPreviewScreenPointFor(start, size, viewport);
    const screenEnd = outputPreviewScreenPointFor(end, size, viewport);
    return { x1: screenStart.x, y1: screenStart.y, x2: screenEnd.x, y2: screenEnd.y };
  }));
};

const arcPointAt = (
  segment: Extract<OutputPathSegment, { kind: "arc" }>,
  angleDeg: number
): OutputPoint => {
  const angle = angleDeg * Math.PI / 180;
  return {
    x: segment.center.x + Math.cos(angle) * segment.radius,
    y: segment.center.y + Math.sin(angle) * segment.radius
  };
};

const pathDataForSegment = (
  segment: OutputPathSegment,
  project: (point: OutputPoint) => OutputPreviewScreenPoint
): string => {
  if (segment.kind === "line") {
    const start = project(segment.start);
    const end = project(segment.end);
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }
  if (segment.kind === "bezier") {
    const start = project(segment.start);
    const control1 = project(segment.control1);
    const control2 = project(segment.control2);
    const end = project(segment.end);
    return `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
  }
  const sampleCount = Math.max(2, Math.ceil(Math.abs(segment.sweepAngleDeg) / 4));
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const point = project(arcPointAt(
      segment,
      segment.startAngleDeg + segment.sweepAngleDeg * index / sampleCount
    ));
    return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
  }).join(" ");
};

export const outputPreviewPathDataFor = (
  drawable: OutputDrawable,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
): string | null => {
  const project = (point: OutputPoint) => outputPreviewScreenPointFor(point, size, viewport);
  if (drawable.kind === "text") return null;
  if (drawable.kind === "offsetLine" || drawable.kind === "polyline") return drawable.segments.map((segment) => pathDataForSegment(segment, project)).join(" ");
  return pathDataForSegment(drawable, project);
};

export const outputPreviewTextTransformFor = (
  text: OutputText,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
): string => {
  const anchor = outputPreviewScreenPointFor(text.anchor, size, viewport);
  return `translate(${anchor.x} ${anchor.y}) rotate(${-text.rotationDeg}) scale(${text.mirrorX ? -viewport.zoom : viewport.zoom} ${-viewport.zoom})`;
};
