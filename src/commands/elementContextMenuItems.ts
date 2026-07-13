import { type CommandContext, type CommandId } from "./commands";
import { isForGroupElement, isGroupElement, isGroupExpanded } from "../model/groups";
import { elementSupportsDisplayColor } from "../palette/colorApplicability";
import type { CadElement } from "../types/geometry";
import type { GroupFoldById } from "../model/groups";

export type MenuCommandItem = {
  kind: "command";
  commandId: CommandId;
  label: string;
  context?: CommandContext;
};

export type MenuSeparatorItem = {
  kind: "separator";
};

export type MenuItem = MenuCommandItem | MenuSeparatorItem;

const visibleLabel = (element: CadElement) => (element.visible ? "非表示にする" : "表示する");

const enabledLabel = (element: CadElement) => (element.enabled ? "評価しない" : "評価する");

const lockedLabel = (element: CadElement) => (element.locked ? "ロック解除" : "ロック");

const printLabel = (element: CadElement) =>
  element.type === "group" && element.printEnabled === true ? "印刷しない" : "印刷する";

/** Builds the per-element command menu shown by SourceEditorContextMenu. */
export const menuItemsForElement = ({
  commandContext,
  element,
  selectedElements,
  showPrintControls,
  targetEvaluationLimitIndex,
  groupFoldById
}: {
  commandContext: CommandContext;
  element: CadElement;
  selectedElements: CadElement[];
  showPrintControls: boolean;
  targetEvaluationLimitIndex: number;
  groupFoldById: GroupFoldById;
}): MenuItem[] => {
  const selectedCount = selectedElements.length;
  const hasColorTarget = selectedElements.some(elementSupportsDisplayColor);
  const items: MenuItem[] = [
    {
      kind: "command",
      commandId: "openDslPanel",
      label: selectedCount > 1 ? `DSLで編集 (${selectedCount}件)` : "DSLで編集",
      context: { dslElementIds: selectedElements.map((item) => item.id) }
    },
    { kind: "separator" }
  ];

  if (element.type !== "variable") {
    items.push({
      kind: "command",
      commandId: "toggleElementVisibility",
      label: visibleLabel(element),
      context: { elementId: element.id }
    });
  }
  items.push({
    kind: "command",
    commandId: "toggleElementEnabled",
    label: enabledLabel(element),
    context: { elementId: element.id }
  });
  items.push({
    kind: "command",
    commandId: "toggleElementLocked",
    label: lockedLabel(element),
    context: { elementId: element.id }
  });
  items.push({
    kind: "command",
    commandId: "setEvaluationLimitIndex",
    label: "ここまで評価",
    context: { evaluationLimitIndex: targetEvaluationLimitIndex }
  });
  if (showPrintControls && element.type === "group") {
    items.push({
      kind: "command",
      commandId: "toggleGroupPrintEnabled",
      label: printLabel(element),
      context: { elementId: element.id }
    });
  }
  if (isGroupElement(element)) {
    items.push({
      kind: "command",
      commandId: "toggleGroupExpanded",
      label: isGroupExpanded(element.id, groupFoldById) ? "折り畳む" : "展開する",
      context: { elementId: element.id }
    });
  }
  if (isForGroupElement(element)) {
    items.push({
      kind: "command",
      commandId: "toggleSelectedForGroupGenerated",
      label: element.showGenerated ? "生成結果を非表示" : "生成結果を表示"
    });
  }

  items.push(
    { kind: "separator" },
    { kind: "command", commandId: "duplicateSelectedElement", label: "複製" },
    { kind: "command", commandId: "deleteSelectedElement", label: "削除" },
    { kind: "separator" },
    { kind: "command", commandId: "moveSelectedElementUp", label: "上へ移動" },
    { kind: "command", commandId: "moveSelectedElementDown", label: "下へ移動" },
    { kind: "command", commandId: "indentSelectedElements", label: "インデント" },
    { kind: "command", commandId: "outdentSelectedElements", label: "アウトデント" }
  );

  if (element.parentGroupId) {
    items.push({
      kind: "command",
      commandId: "selectParentGroup",
      label: "親グループを選択"
    });
  }

  items.push(
    { kind: "separator" },
    {
      kind: "command",
      commandId: "groupSelectedElements",
      label: selectedCount > 1 ? "選択範囲をグループ化" : "グループ化",
      context: commandContext
    }
  );
  if (selectedCount === 1 && element.type === "group") {
    items.push({
      kind: "command",
      commandId: "ungroupSelectedGroup",
      label: "グループ解除"
    });
  }
  if (hasColorTarget) {
    items.push({
      kind: "command",
      commandId: "openSelectionColorPicker",
      label: "表示色を変更"
    });
  }

  return items;
};
