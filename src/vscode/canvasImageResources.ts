import type { VscodeCanvasImageResources } from "./protocol";

/** Local paths can only use URLs supplied alongside the authoritative source. */
export const canvasImageSourceUrl = (
  sourcePath: string,
  resources: VscodeCanvasImageResources
): string => {
  if (Object.hasOwn(resources, sourcePath)) return resources[sourcePath];
  if (/^blob:/.test(sourcePath) || /^data:image\/(png|jpeg|webp);base64,/i.test(sourcePath)) return sourcePath;
  // A non-image data URI settles the existing asset cache into its error fallback.
  return "data:,";
};
