import { type CommandContext, type CommandId } from "./commands";
import { isForGroupElement, isGroupElement, isGroupExpanded } from "../model/groups";
import {
  elementTypeSupportsHiddenActivity,
  type ElementActivity
} from "../model/elementActivity";
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

const activityLabels: Record<ElementActivity, string> = {
  visible: "表示にする",
  hidden: "非表示にする",
  disabled: "評価しない"
};

const offerableActivities = (element: CadElement): ElementActivity[] => {
  const current = element.activity;
  return (["visible", "hidden", "disabled"] as const).filter(
    (activity) =>
      activity !== current &&
      (activity !== "hidden" || elementTypeSupportsHiddenActivity(element.type))
  );
};

/** Builds the per-element command menu shown by SourceEditorContextMenu. */
export const menuItemsForElement = ({
  commandContext,
  element,
  selectedElements,
  targetEvaluationLimitIndex,
  groupFoldById
}: {
  commandContext: CommandContext;
  element: CadElement;
  selectedElements: CadElement[];
  targetEvaluationLimitIndex: number;
  groupFoldById: GroupFoldById;
}): MenuItem[] => {
  const selectedCount = selectedElements.length;
  const items: MenuItem[] = [];

  for (const activity of offerableActivities(element)) {
    items.push({
      kind: "command",
      commandId: "setElementActivity",
      label: activityLabels[activity],
      context: { elementId: element.id, activity }
    });
  }
  items.push({
    kind: "command",
    commandId: "setEvaluationLimitIndex",
    label: "ここまで評価",
    context: { evaluationLimitIndex: targetEvaluationLimitIndex }
  });
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

  return items;
};
