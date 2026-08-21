import { createElement, type ReactElement } from "react";
import { VSCodeApp } from "./VSCodeApp";
import { OutputPreviewApp } from "./OutputPreviewApp";
import {
  parseVscodeWebviewSurfaceKind,
  type VscodeWebviewApi
} from "./protocol";

export const routeVscodeWebviewSurface = (
  rawSurfaceKind: unknown,
  api: VscodeWebviewApi
): ReactElement => {
  const surfaceKind = parseVscodeWebviewSurfaceKind(rawSurfaceKind);
  if (surfaceKind === "canvas") return createElement(VSCodeApp, { api });
  if (surfaceKind === "outputPreview") return createElement(OutputPreviewApp, { api });
  throw new Error("The VS Code Webview surface kind is missing or invalid.");
};
