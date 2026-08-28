/** JSON-safe proof of the current Canvas background observed by the Canvas Webview. */
export type VscodeCanvasBackgroundPublication = {
  type: "canvasBackgroundPublication";
  documentVersion: number;
  background: string;
};

export type VscodeCanvasThemeToExtensionMessage = VscodeCanvasBackgroundPublication;
