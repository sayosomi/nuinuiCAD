import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dispatchCommand, type CommandContext } from "../commands/commands";
import { menuItemsForElement } from "../commands/elementContextMenuItems";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { ElementId } from "../types/geometry";

export type SourceEditorContextMenuState = {
  elementId: ElementId;
  x: number;
  y: number;
};

type SourceEditorContextMenuProps = {
  commandContext: CommandContext;
  state: SourceEditorContextMenuState;
  onClose: () => void;
};

const viewportPadding = 8;

/**
 * Plain React, no `@codemirror/*` import. Driven by a plain {elementId, x, y}
 * resolved by the controller's own contextmenu handler (src/editor/), not by
 * touching CM here.
 */
export const SourceEditorContextMenu = ({ commandContext, state, onClose }: SourceEditorContextMenuProps) => {
  const elements = useCadDocumentStore(effectiveElements);
  const selectedElementIds = useCadUiStore((ui) => ui.selectedElementIds);
  const showPrintLayout = useCadUiStore((ui) => ui.showPrintLayout);
  const groupFoldById = useCadUiStore((ui) => ui.groupFoldById);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: state.x, y: state.y });

  const element = elements.find((item) => item.id === state.elementId) ?? null;
  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const targetEvaluationLimitIndex = element ? elements.findIndex((item) => item.id === element.id) + 1 : 0;

  const items = useMemo(() => {
    if (!element) return [];
    const selectedElements = selectedElementIdSet.has(element.id)
      ? elements.filter((item) => selectedElementIdSet.has(item.id))
      : [element];
    return menuItemsForElement({
      commandContext,
      element,
      selectedElements,
      showPrintControls: showPrintLayout,
      targetEvaluationLimitIndex,
      groupFoldById
    });
  }, [commandContext, element, elements, selectedElementIdSet, showPrintLayout, targetEvaluationLimitIndex, groupFoldById]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(viewportPadding, Math.min(state.x, window.innerWidth - rect.width - viewportPadding)),
      y: Math.max(viewportPadding, Math.min(state.y, window.innerHeight - rect.height - viewportPadding))
    });
  }, [state.x, state.y, items]);

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

  if (!element) return null;

  return (
    <div
      ref={menuRef}
      className="source-editor-context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={`${element.name}の操作`}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.kind === "separator" ? (
          <div key={`separator-${index}`} className="source-editor-context-menu-separator" role="separator" />
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
