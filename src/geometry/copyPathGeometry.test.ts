import { describe, expect, it } from "vitest";

import { copyPathGeometry } from "./copyPathGeometry";
import type { SourceSegment } from "./offsetPathTypes";

describe("copyPathGeometry", () => {
  it("applies translation, mirrorX, scale, and rotation about the destination point", () => {
    const source: SourceSegment[] = [{
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 }
    }];

    expect(copyPathGeometry(source, {
      kind: "transform",
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 20, y: 10 },
      scale: 2,
      angleDeg: 90,
      mirrorX: true
    })).toMatchObject({
      kind: "offsetLine",
      start: { x: 20, y: 10 },
      end: { x: 20, y: -10 },
      length: 20,
      segments: [{ kind: "line", length: 20 }]
    });
  });

  it("reverses arc orientation when transform mirrorX is enabled", () => {
    const source: SourceSegment[] = [{
      kind: "arc",
      center: { x: 0, y: 0 },
      radius: 10,
      startAngleDeg: 0,
      sweepAngleDeg: 90
    }];

    expect(copyPathGeometry(source, {
      kind: "transform",
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 20, y: 0 },
      scale: 1,
      angleDeg: 0,
      mirrorX: true
    })).toMatchObject({
      segments: [{
        kind: "arc",
        center: { x: 20, y: 0 },
        start: { x: 10, y: 0 },
        end: { x: 20, y: 10 },
        radius: 10,
        sweepAngleDeg: -90
      }]
    });
  });

  it("transforms Bezier controls together with their endpoints", () => {
    const source: SourceSegment[] = [{
      kind: "bezier",
      start: { x: 0, y: 0 },
      control1: { x: 2, y: 2 },
      control2: { x: 8, y: 2 },
      end: { x: 10, y: 0 }
    }];

    expect(copyPathGeometry(source, {
      kind: "transform",
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 10, y: 0 },
      scale: 1,
      angleDeg: 0,
      mirrorX: true
    })).toMatchObject({
      segments: [{
        kind: "bezier",
        start: { x: 10, y: 0 },
        control1: { x: 8, y: 2 },
        control2: { x: 2, y: 2 },
        end: { x: 0, y: 0 }
      }]
    });
  });

  it("reflects arcs, recomputes radius, and reverses sweep direction", () => {
    const source: SourceSegment[] = [{
      kind: "arc",
      center: { x: 0, y: 0 },
      radius: 10,
      startAngleDeg: 0,
      sweepAngleDeg: 90
    }];

    expect(copyPathGeometry(source, {
      kind: "mirror",
      axis1: { x: 0, y: 0 },
      axis2: { x: 0, y: 10 }
    })).toMatchObject({
      segments: [{
        kind: "arc",
        radius: 10,
        start: { x: -10, y: 0 },
        sweepAngleDeg: -90,
        length: 10 * Math.PI / 2
      }]
    });
    expect(copyPathGeometry(source, {
      kind: "mirror",
      axis1: { x: 0, y: 0 },
      axis2: { x: 0, y: 10 }
    })?.segments[0]).toMatchObject({ end: { y: 10 } });
  });

  it("drops degenerate transformed line and Bezier segments", () => {
    const source: SourceSegment[] = [
      { kind: "line", start: { x: 1, y: 1 }, end: { x: 1, y: 1 } },
      { kind: "bezier", start: { x: 2, y: 2 }, control1: { x: 2, y: 2 }, control2: { x: 2, y: 2 }, end: { x: 2, y: 2 } }
    ];

    expect(copyPathGeometry(source, {
      kind: "transform",
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
      scale: 1,
      angleDeg: 0,
      mirrorX: false
    })).toBeNull();
  });
});
