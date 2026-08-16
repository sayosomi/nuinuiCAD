import { createRoot } from "react-dom/client";
import { VSCodeApp } from "./VSCodeApp";
import type { VscodeWebviewApi } from "./protocol";
import "../styles.css";

type VsCodeWindow = Window & {
  acquireVsCodeApi?: () => VscodeWebviewApi;
};

const vscodeWindow = window as VsCodeWindow;
const api = vscodeWindow.acquireVsCodeApi?.();
if (!api) throw new Error("VS Code Webview API is unavailable");

createRoot(document.getElementById("root")!).render(
  <VSCodeApp api={api} />
);
