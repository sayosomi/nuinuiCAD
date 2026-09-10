import * as vscode from "vscode";

export const WEBVIEW_CONTEXT_COMMAND_ALIASES = [
  ["nuinuiCAD.webview.createFreePointAtPointer", "nuinuiCAD.createFreePointAtPointer"],
  ["nuinuiCAD.webview.fitDrawing", "nuinuiCAD.fitDrawing"],
  ["nuinuiCAD.webview.resetCanvasView", "nuinuiCAD.resetCanvasView"],
  ["nuinuiCAD.webview.toggleCanvasPointNames", "nuinuiCAD.toggleCanvasPointNames"],
  ["nuinuiCAD.webview.toggleCanvasGeometryNames", "nuinuiCAD.toggleCanvasGeometryNames"],
  ["nuinuiCAD.webview.toggleCanvasPoints", "nuinuiCAD.toggleCanvasPoints"],
  ["nuinuiCAD.webview.editCanvasRibbon", "nuinuiCAD.editCanvasRibbon"],
  ["nuinuiCAD.webview.clearCanvasSelection", "nuinuiCAD.clearCanvasSelection"],
  ["nuinuiCAD.webview.convertPointToXYOffset", "nuinuiCAD.convertPointToXYOffset"],
  ["nuinuiCAD.webview.convertPointToAngleDistanceOffset", "nuinuiCAD.convertPointToAngleDistanceOffset"],
  ["nuinuiCAD.webview.selectParentGroup", "nuinuiCAD.selectParentGroup"],
  ["nuinuiCAD.webview.selectInstance", "nuinuiCAD.selectInstance"],
  ["nuinuiCAD.webview.goToSourceDefinition", "nuinuiCAD.goToSourceDefinition"],
  ["nuinuiCAD.webview.inlineModuleInstance", "nuinuiCAD.inlineModuleInstance"],
  ["nuinuiCAD.webview.extractModule", "nuinuiCAD.extractModule"],
  ["nuinuiCAD.webview.bakeCurrentShape", "nuinuiCAD.bakeCurrentShape"],
  ["nuinuiCAD.webview.bakeBaseShape", "nuinuiCAD.bakeBaseShape"],
  ["nuinuiCAD.webview.modulePreview.fitDrawing", "nuinuiCAD.modulePreview.fitDrawing"],
  ["nuinuiCAD.webview.modulePreview.resetView", "nuinuiCAD.modulePreview.resetView"],
  ["nuinuiCAD.webview.modulePreview.togglePointNames", "nuinuiCAD.modulePreview.togglePointNames"],
  ["nuinuiCAD.webview.modulePreview.toggleGeometryNames", "nuinuiCAD.modulePreview.toggleGeometryNames"],
  ["nuinuiCAD.webview.modulePreview.togglePoints", "nuinuiCAD.modulePreview.togglePoints"],
  ["nuinuiCAD.webview.modulePreview.clearSelection", "nuinuiCAD.modulePreview.clearSelection"],
  ["nuinuiCAD.webview.resetOutputPreviewView", "nuinuiCAD.resetOutputPreviewView"],
  ["nuinuiCAD.webview.fitOutputPreview", "nuinuiCAD.fitOutputPreview"],
  ["nuinuiCAD.webview.clearOutputPreviewFocus", "nuinuiCAD.clearOutputPreviewFocus"]
] as const;

export const registerWebviewContextCommandAliases = (): vscode.Disposable => {
  const registrations = WEBVIEW_CONTEXT_COMMAND_ALIASES.map(([alias, canonical]) =>
    vscode.commands.registerCommand(alias, (...args: unknown[]) =>
      vscode.commands.executeCommand(canonical, ...args)
    )
  );
  return vscode.Disposable.from(...registrations);
};
