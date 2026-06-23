import { useEffect } from "react";
import { dispatchCommand } from "../commands/commands";
import { shortcutHelpItems } from "../keyboard/shortcuts";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

type ShortcutHelpOverlayProps = {
  isParameterEditMode: boolean;
  isDependencyJumpMode: boolean;
  isPickMode?: boolean;
};

const modeLabel = ({
  isParameterEditMode,
  isDependencyJumpMode,
  isPickMode = false
}: ShortcutHelpOverlayProps) => {
  if (isPickMode) return "構成リスト選択";
  if (isDependencyJumpMode) return "親子要素ジャンプ";
  if (isParameterEditMode) return "パラメーター編集";
  return "通常";
};

export const ShortcutHelpOverlay = ({
  isParameterEditMode,
  isDependencyJumpMode,
  isPickMode = false
}: ShortcutHelpOverlayProps) => {
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementId = useCadDocumentStore((state) => state.selectedElementId);
  const selectedParameterKey = useCadDocumentStore((state) => state.selectedParameterKey);
  const showShortcutHelp = useCadUiStore((state) => state.showShortcutHelp);
  const setShowShortcutHelp = useCadUiStore((state) => state.setShowShortcutHelp);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const shortcuts = shortcutHelpItems({
    isParameterEditMode,
    isDependencyJumpMode,
    isPickMode,
    selectedElement,
    selectedParameterKey
  });

  useEffect(() => {
    if (!showShortcutHelp) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setShowShortcutHelp(false);
    };

    window.addEventListener("keydown", closeOnEscape, { capture: true });
    return () => window.removeEventListener("keydown", closeOnEscape, { capture: true });
  }, [setShowShortcutHelp, showShortcutHelp]);

  if (!showShortcutHelp) return null;

  return (
    <div
      className="shortcut-overlay-backdrop"
      onMouseDown={() => dispatchCommand("toggleShortcutHelp")}
    >
      <section
        className="shortcut-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="ショートカット一覧"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>ショートカット</h2>
            <p>{modeLabel({ isParameterEditMode, isDependencyJumpMode, isPickMode })}</p>
          </div>
          <button type="button" onClick={() => dispatchCommand("toggleShortcutHelp")}>
            閉じる
          </button>
        </div>

        <dl className="shortcut-list shortcut-overlay-list">
          {shortcuts.map((shortcut, index) => (
            <div key={`${shortcut.id}-${index}`}>
              <dt>{shortcut.keys}</dt>
              <dd>{shortcut.label}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
};
