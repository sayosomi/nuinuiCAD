import { describe, expect, it } from "vitest";

import { connectSourceSegmentGroups, sourceStart } from "./offsetSourceSegments";
import type { SourceSegment } from "./offsetPathTypes";

describe("connectSourceSegmentGroups", () => {
  it("uses tangent continuity to orient equally close source groups", () => {
    const incoming: SourceSegment = {
      kind: "line",
      start: { x: -50, y: 0 },
      end: { x: 0, y: 0 }
    };
    const loopWithOppositeSourceDirection: SourceSegment = {
      kind: "bezier",
      start: { x: 0, y: 0 },
      control1: { x: -20, y: 0 },
      control2: { x: 20, y: 0 },
      end: { x: 0, y: 0 }
    };

    const connected = connectSourceSegmentGroups([[incoming], [loopWithOppositeSourceDirection]], false);

    expect(connected).toHaveLength(2);
    expect(connected[1]).toMatchObject({ kind: "bezier" });
    if (connected[1].kind !== "bezier") throw new Error("Expected Bezier segment");
    expect(sourceStart(connected[1])).toMatchObject({ x: 0, y: 0 });
    expect(connected[1].control1).toMatchObject({ x: 20, y: 0 });
  });
});
