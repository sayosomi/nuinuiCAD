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
  canvasQuickCreateLabelFor,
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

type QuickCreateManagerItem = QuickPickCreationItem & {
  buttons: readonly vscode.QuickInputButton[];
};

type QuickCreateButtons = {
  add: vscode.QuickInputButton;
  moveUp: vscode.QuickInputButton;
  moveDown: vscode.QuickInputButton;
  remove: vscode.QuickInputButton;
};

const quickCreateButtonsFor = (displayLanguage: string): QuickCreateButtons => {
  const translator = canvasQuickCreateTranslatorFor(displayLanguage);
  return {
    add: { iconPath: new vscode.ThemeIcon("add"), tooltip: translator("canvasQuickCreate.button.add") },
    moveUp: { iconPath: new vscode.ThemeIcon("arrow-up"), tooltip: translator("canvasQuickCreate.button.moveUp") },
    moveDown: { iconPath: new vscode.ThemeIcon("arrow-down"), tooltip: translator("canvasQuickCreate.button.moveDown") },
    remove: { iconPath: new vscode.ThemeIcon("trash"), tooltip: translator("canvasQuickCreate.button.remove") }
  };
};

const quickPickItemsFor = (
  entries: readonly VscodeCanvasCreationCommand[],
  displayLanguage: string,
  alwaysShow = false
): QuickPickCreationItem[] => entries.map((entry) => ({
  label: canvasQuickCreateLabelFor(entry.commandId, displayLanguage),
  description: canvasQuickCreateDescriptionFor(entry.commandId, displayLanguage),
  commandId: entry.commandId,
  alwaysShow
}));

const commandOrderForAddCandidates = (
  entries: readonly VscodeCanvasCreationCommand[]
): VscodeCanvasCreationCommand[] => [...entries].sort((left, right) => {
  if (left.commandId < right.commandId) return -1;
  if (left.commandId > right.commandId) return 1;
  return 0;
});

const quickCreateManagerItemsFor = (
  commandIds: readonly VscodeCanvasCreationCommandId[],
  buttons: QuickCreateButtons,
  displayLanguage: string
): QuickCreateManagerItem[] => commandIds.map((commandId, index) => {
  const entry = vscodeCanvasCreationCommands.find((candidate) => candidate.commandId === commandId);
  if (!entry) throw new Error(`Unknown VS Code Canvas creation command: ${commandId}`);
  return {
    label: canvasQuickCreateLabelFor(commandId, displayLanguage),
    description: canvasQuickCreateDescriptionFor(commandId, displayLanguage),
    commandId,
    buttons: [
      ...(index > 0 ? [buttons.moveUp] : []),
      ...(index < commandIds.length - 1 ? [buttons.moveDown] : []),
      buttons.remove
    ]
  };
});

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

  const configureQuickCreate = (): Promise<void> => {
    const displayLanguage = displayLanguageFor();
    const picker = vscode.window.createQuickPick<QuickCreateManagerItem>();
    const buttons = quickCreateButtonsFor(displayLanguage);
    let settled = false;
    let resolveManager: () => void = () => undefined;
    let finish: () => void = () => undefined;
    const close = (): void => finish();
    activePickerClosers.add(close);

    const result = new Promise<void>((resolve) => {
      resolveManager = resolve;
    });
    const listeners: vscode.Disposable[] = [];
    let mutationQueue: Promise<void> = Promise.resolve();
    const setItems = (commands: readonly VscodeCanvasCreationCommandId[]): void => {
      picker.items = quickCreateManagerItemsFor(commands, buttons, displayLanguage);
    };
    const readCurrent = (): VscodeCanvasCreationCommandId[] => readQuickCreateCommands();
    const persist = (commands: VscodeCanvasCreationCommandId[]): Promise<void> => {
      mutationQueue = mutationQueue
        .then(async () => {
          await vscode.workspace.getConfiguration().update(
            VSCODE_CANVAS_QUICK_CREATE_SETTING,
            commands,
            vscode.ConfigurationTarget.Global
          );
          setItems(commands);
        })
        .catch(() => undefined);
      return mutationQueue;
    };
    const addCommand = async (): Promise<void> => {
      if (settled) return;
      const current = readCurrent();
      setItems(current);
      const configured = new Set(current);
      const candidates = commandOrderForAddCandidates(
        vscodeCanvasCreationCommands.filter((entry) => !configured.has(entry.commandId))
      );
      if (candidates.length === 0) return;
      const selected = await vscode.window.showQuickPick(quickPickItemsFor(candidates, displayLanguage), {
        placeHolder: canvasQuickCreateTranslatorFor(displayLanguage)("canvasQuickCreate.placeholder.addCommand"),
        matchOnDescription: true
      });
      if (settled || !selected || !isVscodeCanvasCreationCommandId(selected.commandId)) return;
      const latest = readCurrent();
      if (latest.includes(selected.commandId)) return;
      await persist([...latest, selected.commandId]);
    };
    const onItemButton = ({ item, button }: vscode.QuickPickItemButtonEvent<QuickCreateManagerItem>): void => {
      if (settled) return;
      const current = readCurrent();
      const index = current.indexOf(item.commandId);
      if (index < 0) return;
      const next = [...current];
      if (button === buttons.moveUp && index > 0) {
        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      } else if (button === buttons.moveDown && index < next.length - 1) {
        [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
      } else if (button === buttons.remove) {
        next.splice(index, 1);
      } else {
        return;
      }
      void persist(next);
    };

    finish = (): void => {
      if (settled) return;
      settled = true;
      activePickerClosers.delete(close);
      for (const listener of listeners) listener.dispose();
      picker.dispose();
      void mutationQueue.then(resolveManager, resolveManager);
    };

    const translator = canvasQuickCreateTranslatorFor(displayLanguage);
    picker.title = translator("canvasQuickCreate.title.configure");
    picker.placeholder = translator("canvasQuickCreate.placeholder.configuredCommands");
    picker.matchOnDescription = false;
    picker.buttons = [buttons.add];
    setItems(readCurrent());
    listeners.push(picker.onDidTriggerButton((button) => {
      if (button === buttons.add) void addCommand();
    }));
    listeners.push(picker.onDidTriggerItemButton(onItemButton));
    listeners.push(picker.onDidAccept(() => finish()));
    listeners.push(picker.onDidHide(() => finish()));
    try {
      picker.show();
    } catch {
      finish();
    }
    return result;
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
