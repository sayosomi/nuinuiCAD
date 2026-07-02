type ImageAssetState =
  | { status: "loading"; image: HTMLImageElement }
  | { status: "loaded"; image: HTMLImageElement }
  | { status: "error"; image: HTMLImageElement };

const imageAssetCache = new Map<string, ImageAssetState>();

export const imageAssetForSource = (
  source: string,
  onSettled?: () => void
): ImageAssetState => {
  const cached = imageAssetCache.get(source);
  if (cached) return cached;

  const image = new Image();
  image.decoding = "async";
  const state: ImageAssetState = { status: "loading", image };
  imageAssetCache.set(source, state);
  image.onload = () => {
    imageAssetCache.set(source, { status: "loaded", image });
    onSettled?.();
  };
  image.onerror = () => {
    imageAssetCache.set(source, { status: "error", image });
    onSettled?.();
  };
  image.src = source;
  return state;
};
