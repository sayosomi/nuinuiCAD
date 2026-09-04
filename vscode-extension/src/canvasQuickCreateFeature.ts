import * as vscode from "vscode";
import {
  filterVscodeCanvasCreationCommands,
  normalizeVscodeCanvasQuickCreateCommands,
  VSCODE_CANVAS_QUICK_CREATE_SETTING,
  VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT,
  vscodeCanvasCreationCommands,
  isVscodeCanvasCreationCommandId,
  type VscodeCanvasCreationCommand,
  type VscodeCanvasCreationCommandId
} from "../../src/vscode/vscodeCanvasCreationCommands";
import {
  canvasQuickCreateDescriptionFor,
  canvasQuickCreateTranslatorFor
} from "./canvasQuickCreateLocalization";

export const VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID = "nuinuiCAD.createGeometry";
export const VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID = "nuinuiCAD.configureQuickCreate";
export const VSCODE_CANVAS_QUICK_CREATE_COMMAND_CONTEXT_KEY_PREFIX = "nuinuiCAD.quickCreateConfigured.";

export const VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS = Array.from(
  { length: VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT },
  (_, index) => `nuinuiCAD.quickCreateSlot${index + 1}`
);

export const vscodeCanvasQuickCreateCommandContextKeyFor = (
  commandId: VscodeCanvasCreationCommandId
): string => `${VSCODE_CANVAS_QUICK_CREATE_COMMAND_CONTEXT_KEY_PREFIX}${commandId}`;

export type VscodeCanvasCreationEndpoint = {
  /** Opaque identity owned by extension.ts; used only for exact-session comparison. */
  sessionToken: object;
  isCurrent: () => boolean;
  postCreationCommand: (commandId: VscodeCanvasCreationCommandId) => void;
};

type QuickPickCreationItem = vscode.QuickPickItem & {
  commandId: VscodeCanvasCreationCommandId;
};

const quickPickItemsFor = (
  entries: readonly VscodeCanvasCreationCommand[],
  displayLanguage: string,
  alwaysShow = false
): QuickPickCreationItem[] => entries.map((entry) => ({
  label: entry.quickPickLabel,
  description: canvasQuickCreateDescriptionFor(entry.commandId, displayLanguage),
  commandId: entry.commandId,
  alwaysShow
}));

export const registerVscodeCanvasQuickCreateFeature = ({
  activeCanvasEndpoint,
  displayLanguageFor = (): string => {
    try {
      return vscode.env?.language ?? "en";
    } catch {
      return "en";
    }
  }
}: {
  activeCanvasEndpoint: () => VscodeCanvasCreationEndpoint | null;
  displayLanguageFor?: () => string;
}): vscode.Disposable => {
  let contextUpdate: Promise<void> = Promise.resolve();
  const activePickerClosers = new Set<() => void>();

  const readQuickCreateCommands = (): VscodeCanvasCreationCommandId[] =>
    normalizeVscodeCanvasQuickCreateCommands(
      vscode.workspace.getConfiguration().get<unknown>(VSCODE_CANVAS_QUICK_CREATE_SETTING)
    );

  const refreshSlotContexts = (): void => {
    const commands = readQuickCreateCommands();
    const configured = new Set(commands);
    const contextValues = [
      ...VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.map((key, index) => [
        key,
        commands[index] ?? ""
      ] as const),
      ...vscodeCanvasCreationCommands.map((entry) => [
        vscodeCanvasQuickCreateCommandContextKeyFor(entry.commandId),
        configured.has(entry.commandId)
      ] as const)
    ];
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.all(contextValues.map(([key, value]) =>
        vscode.commands.executeCommand("setContext", key, value)
      )))
      .then(() => undefined);
  };

  const pickCreationCommand = (): Promise<QuickPickCreationItem | undefined> => {
    const displayLanguage = displayLanguageFor();
    const picker = vscode.window.createQuickPick<QuickPickCreationItem>();
    let settled = false;
    let resolvePick: (selection: QuickPickCreationItem | undefined) => void = () => undefined;
    let finish: (selection: QuickPickCreationItem | undefined) => void = () => undefined;
    const close = (): void => finish(undefined);
    activePickerClosers.add(close);

    const result = new Promise<QuickPickCreationItem | undefined>((resolve) => {
      resolvePick = resolve;
    });
    const listeners: vscode.Disposable[] = [];
    finish = (selection): void => {
      if (settled) return;
      settled = true;
      activePickerClosers.delete(close);
      for (const listener of listeners) listener.dispose();
      picker.dispose();
      resolvePick(selection);
    };

    picker.placeholder = canvasQuickCreateTranslatorFor(displayLanguage)("canvasQuickCreate.placeholder.createGeometry");
    picker.matchOnDescription = false;
    picker.items = quickPickItemsFor(filterVscodeCanvasCreationCommands(""), displayLanguage, true);
    listeners.push(picker.onDidChangeValue((value) => {
      picker.items = quickPickItemsFor(filterVscodeCanvasCreationCommands(value), displayLanguage, true);
    }));
    listeners.push(picker.onDidAccept(() => finish(picker.selectedItems[0])));
    listeners.push(picker.onDidHide(() => finish(undefined)));
    try {
      picker.show();
    } catch {
      finish(undefined);
    }
    return result;
  };

  const configureQuickCreate = (): void => {
    void vscode.commands.executeCommand(
      "workbench.action.openSettings",
      VSCODE_CANVAS_QUICK_CREATE_SETTING
    );
  };

  const createGeometry = async (): Promise<void> => {
    const captured = activeCanvasEndpoint();
    if (!captured || !captured.isCurrent()) return;

    const selected = await pickCreationCommand();
    if (!selected || !isVscodeCanvasCreationCommandId(selected.commandId)) return;

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
      configureQuickCreate
    )
  ];

  refreshSlotContexts();
  const configurationListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
    if (event.affectsConfiguration(VSCODE_CANVAS_QUICK_CREATE_SETTING)) refreshSlotContexts();
  });

  return vscode.Disposable.from(
    ...commandDisposables,
    ...(configurationListener ? [configurationListener] : []),
    { dispose: () => [...activePickerClosers].forEach((close) => close()) }
  );
};
