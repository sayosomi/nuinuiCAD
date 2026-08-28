import type { CanvasTheme } from "../components/canvasTheme";

/** JSON-safe proof of the resolved Canvas theme observed by the Canvas Webview. */
export type VscodeCanvasThemePublication = {
  type: "canvasThemePublication";
  documentVersion: number;
  generation: number;
  theme: CanvasTheme;
};

export type VscodeCanvasThemeToExtensionMessage = VscodeCanvasThemePublication;
