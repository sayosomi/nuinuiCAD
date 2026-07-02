import type { ComputedImage } from "../types/geometry";

export type ImageCorner = {
  x: number;
  y: number;
};

const rotate = (point: ImageCorner, angleDeg: number) => {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos
  };
};

export const imageWorldCorners = (image: ComputedImage): ImageCorner[] => {
  const width = image.mirrorX ? -image.widthMm : image.widthMm;
  const localCorners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: -image.heightMm },
    { x: 0, y: -image.heightMm }
  ];

  return localCorners.map((corner) => {
    const rotated = rotate(corner, image.angleDeg);
    return {
      x: image.origin.x + rotated.x,
      y: image.origin.y + rotated.y
    };
  });
};
