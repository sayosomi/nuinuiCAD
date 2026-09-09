import * as vscode from "vscode";
import {
  filterVscodeCanvasCreationCommands,
  isVscodeCanvasCreationCommandId,
  type VscodeCanvasCreationCommand,
  type VscodeCanvasCreationCommandId
} from "../../src/vscode/vscodeCanvasCreationCommands";
import {
  canvasQuickCreateDescriptionFor,
  canvasQuickCreateTranslatorFor
} from "./canvasQuickCreateLocalization";
import { nativeCreateQuickPick } from "./nativeQuickInput";

type QuickPickCreationItem = vscode.QuickPickItem & {
  commandId: VscodeCanvasCreationCommandId;
};

export type VscodeCreationCommandPickerOptions = {
  displayLanguage: string;
  registerCloser?: (closer: () => void) => vscode.Disposable;
};

const quickPickItemsFor = (
  entries: readonly VscodeCanvasCreationCommand[],
  displayLanguage: string
): QuickPickCreationItem[] => entries.map((entry) => ({
  label: entry.quickPickLabel,
  description: canvasQuickCreateDescriptionFor(entry.commandId, displayLanguage),
  commandId: entry.commandId,
  alwaysShow: true
}));

/** Picks one existing Create Geometry command without owning any command lifecycle. */
export const pickVscodeCreationCommand = ({
  displayLanguage,
  registerCloser
}: VscodeCreationCommandPickerOptions): Promise<VscodeCanvasCreationCommandId | undefined> => {
  const picker = nativeCreateQuickPick<QuickPickCreationItem>();
  let settled = false;
  let resolvePick: (selection: VscodeCanvasCreationCommandId | undefined) => void = () => undefined;
  const closerRegistration: { disposable?: vscode.Disposable } = {};
  let finish: (selection: QuickPickCreationItem | undefined) => void = () => undefined;
  const close = (): void => finish(undefined);

  const result = new Promise<VscodeCanvasCreationCommandId | undefined>((resolve) => {
    resolvePick = resolve;
  });
  const listeners: vscode.Disposable[] = [];
  finish = (selection): void => {
    if (settled) return;
    settled = true;
    for (const listener of listeners) listener.dispose();
    closerRegistration.disposable?.dispose();
    picker.dispose();
    resolvePick(
      selection && isVscodeCanvasCreationCommandId(selection.commandId)
        ? selection.commandId
        : undefined
    );
  };
  closerRegistration.disposable = registerCloser?.(close);

  picker.placeholder = canvasQuickCreateTranslatorFor(displayLanguage)(
    "canvasQuickCreate.placeholder.createGeometry"
  );
  picker.matchOnDescription = false;
  picker.items = quickPickItemsFor(filterVscodeCanvasCreationCommands(""), displayLanguage);
  listeners.push(picker.onDidChangeValue((value) => {
    picker.items = quickPickItemsFor(filterVscodeCanvasCreationCommands(value), displayLanguage);
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
