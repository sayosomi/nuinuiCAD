import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dispatchCommand, type CommandContext, type CommandId } from "../commands/commands";
import { isForGroupElement, isGroupElement } from "../model/groups";
import { elementSupportsDisplayColor } from "../palette/colorApplicability";
import type { CadElement, ElementId } from "../types/geometry";

export type ElementListContextMenuState = {
  elementId: ElementId;
  x: number;
  y: number;
};

type ElementListContextMenuProps = {
  commandContext: CommandContext;
  element: CadElement;
  selectedElements: CadElement[];
  showPrintControls: boolean;
  x: number;
  y: number;
  onClose: () => void;
};

type MenuCommandItem = {
  kind: "command";
  commandId: CommandId;
  label: string;
  context?: CommandContext;
};

type MenuSeparatorItem = {
  kind: "separator";
};

type MenuItem = MenuCommandItem | MenuSeparatorItem;

const viewportPadding = 8;

const visibleLabel = (element: CadElement) =>
  element.visible ? "非表示にする" : "表示する";

const enabledLabel = (element: CadElement) =>
  element.enabled ? "評価しない" : "評価する";

const printLabel = (element: CadElement) =>
  element.type === "group" && element.printEnabled === true ? "印刷しない" : "印刷する";

const menuItemsForElement = ({
  commandContext,
  element,
  selectedElements,
  showPrintControls
}: {
  commandContext: CommandContext;
  element: CadElement;
  selectedElements: CadElement[];
  showPrintControls: boolean;
}): MenuItem[] => {
  const selectedCount = selectedElements.length;
  const hasColorTarget = selectedElements.some(elementSupportsDisplayColor);
  const items: MenuItem[] = [
    { kind: "command", commandId: "enterParameterEditMode", label: "パラメーター編集" },
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
      label: element.expanded ? "折り畳む" : "展開する",
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

export const ElementListContextMenu = ({
  commandContext,
  element,
  selectedElements,
  showPrintControls,
  x,
  y,
  onClose
}: ElementListContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  const items = useMemo(
    () => menuItemsForElement({ commandContext, element, selectedElements, showPrintControls }),
    [commandContext, element, selectedElements, showPrintControls]
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(
        viewportPadding,
        Math.min(x, window.innerWidth - rect.width - viewportPadding)
      ),
      y: Math.max(
        viewportPadding,
        Math.min(y, window.innerHeight - rect.height - viewportPadding)
      )
    });
  }, [x, y, items]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    const closeOnPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    const closeOnScroll = () => onClose();

    window.addEventListener("pointerdown", closeOnPointerDown, { capture: true });
    window.addEventListener("keydown", closeOnKeyDown, { capture: true });
    window.addEventListener("scroll", closeOnScroll, { capture: true });
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, { capture: true });
      window.removeEventListener("keydown", closeOnKeyDown, { capture: true });
      window.removeEventListener("scroll", closeOnScroll, { capture: true });
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="element-list-context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={`${element.name}の操作`}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.kind === "separator" ? (
          <div key={`separator-${index}`} className="element-list-context-menu-separator" role="separator" />
        ) : (
          <button
            key={`${item.commandId}-${index}`}
            type="button"
            role="menuitem"
            onClick={() => {
              dispatchCommand(item.commandId, item.context);
              onClose();
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
};
