export const degreesToRadians = (degrees: number): number => degrees * (Math.PI / 180);

export const radiansToDegrees = (radians: number): number => radians * (180 / Math.PI);

export const normalizeDegrees360 = (degrees: number): number => {
  const remainder = degrees % 360;
  const normalized = remainder < 0 ? remainder + 360 : remainder;
  return normalized === 0 ? 0 : normalized;
};

export const atan2Degrees360 = (y: number, x: number): number =>
  y === 0 && x === 0 ? 0 : normalizeDegrees360(radiansToDegrees(Math.atan2(y, x)));

export const isOddMultipleOf90Degrees = (degrees: number): boolean => Math.abs(degrees % 180) === 90;
