import * as vscode from "vscode";

export const WEBVIEW_CONTEXT_COMMAND_ALIASES = [
  ["nuinuiCAD.webview.showCanvasPointNames", "nuinuiCAD.toggleCanvasPointNames"],
  ["nuinuiCAD.webview.hideCanvasPointNames", "nuinuiCAD.toggleCanvasPointNames"],
  ["nuinuiCAD.webview.showCanvasGeometryNames", "nuinuiCAD.toggleCanvasGeometryNames"],
  ["nuinuiCAD.webview.hideCanvasGeometryNames", "nuinuiCAD.toggleCanvasGeometryNames"],
  ["nuinuiCAD.webview.showCanvasPoints", "nuinuiCAD.toggleCanvasPoints"],
  ["nuinuiCAD.webview.hideCanvasPoints", "nuinuiCAD.toggleCanvasPoints"],
  ["nuinuiCAD.webview.modulePreview.showPointNames", "nuinuiCAD.modulePreview.togglePointNames"],
  ["nuinuiCAD.webview.modulePreview.hidePointNames", "nuinuiCAD.modulePreview.togglePointNames"],
  ["nuinuiCAD.webview.modulePreview.showGeometryNames", "nuinuiCAD.modulePreview.toggleGeometryNames"],
  ["nuinuiCAD.webview.modulePreview.hideGeometryNames", "nuinuiCAD.modulePreview.toggleGeometryNames"],
  ["nuinuiCAD.webview.modulePreview.showPoints", "nuinuiCAD.modulePreview.togglePoints"],
  ["nuinuiCAD.webview.modulePreview.hidePoints", "nuinuiCAD.modulePreview.togglePoints"]
] as const;

export const registerWebviewContextCommandAliases = (): vscode.Disposable => {
  const registrations = WEBVIEW_CONTEXT_COMMAND_ALIASES.map(([alias, canonical]) =>
    vscode.commands.registerCommand(alias, (...args: unknown[]) =>
      vscode.commands.executeCommand(canonical, ...args)
    )
  );
  return vscode.Disposable.from(...registrations);
};
