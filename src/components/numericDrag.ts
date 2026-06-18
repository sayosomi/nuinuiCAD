export const numericDragPixelsPerStep = 8;

export type NumericDragStepResult = {
  steps: number;
  remainderX: number;
};

export const numericDragStepsForDelta = (
  accumulatedDeltaX: number,
  pixelsPerStep = numericDragPixelsPerStep
): NumericDragStepResult => {
  const rawSteps = Math.trunc(accumulatedDeltaX / pixelsPerStep);
  const steps = Object.is(rawSteps, -0) ? 0 : rawSteps;

  return {
    steps,
    remainderX: accumulatedDeltaX - steps * pixelsPerStep
  };
};
