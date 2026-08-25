export const CANDIDATE_WHEEL_THRESHOLD_PX = 24;

export type CandidateWheelDelta = {
  remainder: number;
  cycles: number;
};

export const candidateWheelDeltaFor = ({
  remainder,
  deltaY,
  deltaMode,
  viewportHeight
}: {
  remainder: number;
  deltaY: number;
  deltaMode: number;
  viewportHeight: number;
}): CandidateWheelDelta => {
  const pixelsPerUnit = deltaMode === 1
    ? 16
    : deltaMode === 2
      ? Math.max(viewportHeight, 1)
      : 1;
  const normalizedDelta = deltaY * pixelsPerUnit;
  let nextRemainder = remainder;
  if (
    nextRemainder !== 0 &&
    normalizedDelta !== 0 &&
    Math.sign(nextRemainder) !== Math.sign(normalizedDelta)
  ) {
    nextRemainder = 0;
  }
  nextRemainder += normalizedDelta;
  if (Math.abs(nextRemainder) < CANDIDATE_WHEEL_THRESHOLD_PX) {
    return { remainder: nextRemainder, cycles: 0 };
  }

  const direction = nextRemainder > 0 ? 1 : -1;
  return {
    remainder: 0,
    cycles: direction
  };
};
