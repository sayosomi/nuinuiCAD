import * as vscode from "vscode";

export const SOURCE_CONTEXT_COMMAND_ALIASES = [
  ["nuinuiCAD.sourceContext.insertTemplate", "nuinuiCAD.insertTemplate"],
  ["nuinuiCAD.sourceContext.insertModulePreviewInstance", "nuinuiCAD.insertModulePreviewInstance"]
] as const;

export const registerSourceContextCommandAliases = (): vscode.Disposable => {
  const registrations = SOURCE_CONTEXT_COMMAND_ALIASES.map(([alias, canonical]) =>
    vscode.commands.registerCommand(alias, (...args: unknown[]) =>
      vscode.commands.executeCommand(canonical, ...args)
    )
  );
  return vscode.Disposable.from(...registrations);
};
