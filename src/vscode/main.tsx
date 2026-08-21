import { createRoot } from "react-dom/client";
import {
  vscodeWebviewSurfaceDataAttribute,
  type VscodeWebviewApi
} from "./protocol";
import { routeVscodeWebviewSurface } from "./webviewSurfaceRouter";
import "../styles.css";

type VsCodeWindow = Window & {
  acquireVsCodeApi?: () => VscodeWebviewApi;
};

const vscodeWindow = window as VsCodeWindow;
const api = vscodeWindow.acquireVsCodeApi?.();
if (!api) throw new Error("VS Code Webview API is unavailable");

const surfaceKind = document.documentElement.getAttribute(vscodeWebviewSurfaceDataAttribute);
createRoot(document.getElementById("root")!).render(routeVscodeWebviewSurface(surfaceKind, api));
