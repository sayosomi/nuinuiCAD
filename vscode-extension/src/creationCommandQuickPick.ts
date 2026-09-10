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
  recentCommandIds: readonly VscodeCanvasCreationCommandId[];
};

const compareCreationEntriesForQuickPick = (
  left: VscodeCanvasCreationCommand,
  right: VscodeCanvasCreationCommand
): number => {
  const labelOrder = left.quickPickLabel.localeCompare(right.quickPickLabel);
  return labelOrder !== 0 ? labelOrder : left.commandId.localeCompare(right.commandId);
};

export const sortVscodeCreationCommandsForQuickPick = (
  entries: readonly VscodeCanvasCreationCommand[]
): VscodeCanvasCreationCommand[] => [...entries].sort(compareCreationEntriesForQuickPick);

const quickPickItemsFor = (
  entries: readonly VscodeCanvasCreationCommand[],
  displayLanguage: string,
  recentCommandIds: readonly VscodeCanvasCreationCommandId[]
): QuickPickCreationItem[] => {
  const sortedEntries = sortVscodeCreationCommandsForQuickPick(entries);
  const entriesByCommandId = new Map(sortedEntries.map((entry) => [entry.commandId, entry]));
  const promotedCommandIds = new Set<VscodeCanvasCreationCommandId>();
  const promotedEntries: VscodeCanvasCreationCommand[] = [];
  for (const commandId of recentCommandIds) {
    const entry = entriesByCommandId.get(commandId);
    if (!entry || promotedCommandIds.has(commandId)) continue;
    promotedCommandIds.add(commandId);
    promotedEntries.push(entry);
  }

  return [...promotedEntries, ...sortedEntries.filter(({ commandId }) => !promotedCommandIds.has(commandId))].map((entry) => ({
  label: entry.quickPickLabel,
  description: canvasQuickCreateDescriptionFor(entry.commandId, displayLanguage),
  commandId: entry.commandId,
  alwaysShow: true
}));
};

/** Picks one existing Create Geometry command without owning any command lifecycle. */
export const pickVscodeCreationCommand = ({
  displayLanguage,
  recentCommandIds
}: VscodeCreationCommandPickerOptions): Promise<VscodeCanvasCreationCommandId | undefined> => {
  const picker = nativeCreateQuickPick<QuickPickCreationItem>();
  let settled = false;
  let resolvePick: (selection: VscodeCanvasCreationCommandId | undefined) => void = () => undefined;
  let finish: (selection: QuickPickCreationItem | undefined) => void = () => undefined;

  const result = new Promise<VscodeCanvasCreationCommandId | undefined>((resolve) => {
    resolvePick = resolve;
  });
  const listeners: vscode.Disposable[] = [];
  finish = (selection): void => {
    if (settled) return;
    settled = true;
    for (const listener of listeners) listener.dispose();
    picker.dispose();
    resolvePick(
      selection && isVscodeCanvasCreationCommandId(selection.commandId)
        ? selection.commandId
        : undefined
    );
  };
  picker.placeholder = canvasQuickCreateTranslatorFor(displayLanguage)(
    "canvasQuickCreate.placeholder.createGeometry"
  );
  picker.matchOnDescription = false;
  const itemsForValue = (value: string): QuickPickCreationItem[] => quickPickItemsFor(
    filterVscodeCanvasCreationCommands(value),
    displayLanguage,
    value === "" ? recentCommandIds : []
  );
  picker.items = itemsForValue("");
  listeners.push(picker.onDidChangeValue((value) => {
    picker.items = itemsForValue(value);
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
