import * as vscode from "vscode";
import {
  normalizeVscodeCanvasQuickCreateCommands,
  VSCODE_CANVAS_QUICK_CREATE_SETTING,
  VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT,
  vscodeCanvasCreationCommands,
  isVscodeCanvasCreationCommandId,
  type VscodeCanvasCreationCommandId
} from "../../src/vscode/vscodeCanvasCreationCommands";

export const VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID = "nuinuiCAD.createGeometry";
export const VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID = "nuinuiCAD.configureQuickCreate";

export const VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS = Array.from(
  { length: VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT },
  (_, index) => `nuinuiCAD.quickCreateSlot${index + 1}`
);

export type VscodeCanvasCreationEndpoint = {
  /** Opaque identity owned by extension.ts; used only for exact-session comparison. */
  sessionToken: object;
  isCurrent: () => boolean;
  postCreationCommand: (commandId: VscodeCanvasCreationCommandId) => void;
};

type QuickPickCreationItem = vscode.QuickPickItem & {
  commandId: VscodeCanvasCreationCommandId;
};

export const registerVscodeCanvasQuickCreateFeature = ({
  activeCanvasEndpoint
}: {
  activeCanvasEndpoint: () => VscodeCanvasCreationEndpoint | null;
}): vscode.Disposable => {
  let contextUpdate: Promise<void> = Promise.resolve();

  const refreshSlotContexts = (): void => {
    const configuration = vscode.workspace.getConfiguration("nuinuiCAD");
    const commands = normalizeVscodeCanvasQuickCreateCommands(
      configuration.get<unknown>("canvasQuickCreate.commands")
    );
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.all(VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.map((key, index) =>
        vscode.commands.executeCommand(
          "setContext",
          key,
          commands[index] ?? ""
        )
      )))
      .then(() => undefined);
  };

  const quickPickItems: readonly QuickPickCreationItem[] = vscodeCanvasCreationCommands.map((entry) => ({
    label: entry.quickPickLabel,
    description: entry.quickPickDescription,
    commandId: entry.commandId
  }));

  const createGeometry = async (): Promise<void> => {
    const captured = activeCanvasEndpoint();
    if (!captured || !captured.isCurrent()) return;

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: "Create geometry",
      matchOnDescription: true
    });
    if (!selected) return;
    if (!isVscodeCanvasCreationCommandId(selected.commandId)) return;

    const current = activeCanvasEndpoint();
    if (
      !current ||
      current.sessionToken !== captured.sessionToken ||
      !captured.isCurrent() ||
      !current.isCurrent()
    ) return;
    current.postCreationCommand(selected.commandId);
  };

  const commandDisposables = [
    vscode.commands.registerCommand(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID, createGeometry),
    ...vscodeCanvasCreationCommands.map((entry) =>
      vscode.commands.registerCommand(entry.vscodeCommandId, () => {
        const endpoint = activeCanvasEndpoint();
        if (endpoint?.isCurrent()) endpoint.postCreationCommand(entry.commandId);
      })
    ),
    vscode.commands.registerCommand(
      VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID,
      () => void vscode.commands.executeCommand("workbench.action.openSettings", VSCODE_CANVAS_QUICK_CREATE_SETTING)
    )
  ];

  refreshSlotContexts();
  const configurationListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
    if (event.affectsConfiguration(VSCODE_CANVAS_QUICK_CREATE_SETTING)) refreshSlotContexts();
  });

  return vscode.Disposable.from(
    ...commandDisposables,
    ...(configurationListener ? [configurationListener] : [])
  );
};
