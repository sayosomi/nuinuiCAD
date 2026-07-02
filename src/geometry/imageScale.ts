export const initialImageScale = (sourceDpi: number, targetPixelsPerMm: number) =>
  sourceDpi / (25.4 * targetPixelsPerMm);

export const defaultTargetPixelsPerMm = (sourceDpi: number | null | undefined) =>
  sourceDpi && sourceDpi > 0 ? sourceDpi / 25.4 : 10;
