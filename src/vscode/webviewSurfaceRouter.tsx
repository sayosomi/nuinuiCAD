import { createElement, type ReactElement } from "react";
import { VSCodeApp } from "./VSCodeApp";
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
  if (surfaceKind === "outputPreview") {
    throw new Error("The VS Code Output Preview surface is not implemented.");
  }
  throw new Error("The VS Code Webview surface kind is missing or invalid.");
};
