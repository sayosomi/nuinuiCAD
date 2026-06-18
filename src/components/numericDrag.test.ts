import { describe, expect, it } from "vitest";
import { numericDragStepsForDelta } from "./numericDrag";

describe("numericDragStepsForDelta", () => {
  it("does not emit steps below the drag threshold", () => {
    expect(numericDragStepsForDelta(7)).toEqual({ steps: 0, remainderX: 7 });
    expect(numericDragStepsForDelta(-7)).toEqual({ steps: 0, remainderX: -7 });
  });

  it("emits one step for each full threshold of horizontal drag", () => {
    expect(numericDragStepsForDelta(8)).toEqual({ steps: 1, remainderX: 0 });
    expect(numericDragStepsForDelta(16)).toEqual({ steps: 2, remainderX: 0 });
    expect(numericDragStepsForDelta(-16)).toEqual({ steps: -2, remainderX: 0 });
  });

  it("keeps leftover drag distance for the next pointer move", () => {
    expect(numericDragStepsForDelta(19)).toEqual({ steps: 2, remainderX: 3 });
    expect(numericDragStepsForDelta(-19)).toEqual({ steps: -2, remainderX: -3 });
  });
});
