import { useEffect } from "react";
import { dispatchCommand } from "../commands/commands";
import { shortcutHelpItems } from "../keyboard/shortcuts";
import { useCadUiStore } from "../state/cadUiStore";

type ShortcutHelpOverlayProps = {
  isPickMode?: boolean;
};

const modeLabel = ({ isPickMode = false }: ShortcutHelpOverlayProps) => {
  if (isPickMode) return "構成リスト選択";
  return "通常";
};

export const ShortcutHelpOverlay = ({
  isPickMode = false
}: ShortcutHelpOverlayProps) => {
  const showShortcutHelp = useCadUiStore((state) => state.showShortcutHelp);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const setShowShortcutHelp = useCadUiStore((state) => state.setShowShortcutHelp);
  const shortcuts = shortcutHelpItems({ settings: shortcutSettings, isPickMode });

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
            <p>{modeLabel({ isPickMode })}</p>
          </div>
          <button type="button" onClick={() => dispatchCommand("toggleShortcutHelp")}>
            閉じる
          </button>
          <button type="button" onClick={() => dispatchCommand("openShortcutSettings")}>
            設定
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
