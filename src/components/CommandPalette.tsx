import { useEffect, useMemo, useRef, useState } from "react";
import {
  dispatchCommand,
  filterCommandPaletteItems,
  type CommandContext
} from "../commands/commands";
import { effectiveShortcutBindings, keyChordListLabel } from "../keyboard/shortcuts";
import { useCadUiStore } from "../state/cadUiStore";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { selectTextInputValue } from "./textInputSelection";

type CommandPaletteProps = {
  commandContext: CommandContext;
};

export const CommandPalette = ({ commandContext }: CommandPaletteProps) => {
  const showCommandPalette = useCadUiStore((state) => state.showCommandPalette);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => filterCommandPaletteItems(query, commandContext), [query, commandContext]);
  const shortcutLabelByCommandId = useMemo(() => {
    const labelsByCommandId = new Map<string, Set<string>>();
    for (const binding of effectiveShortcutBindings(shortcutSettings)) {
      if (binding.chords.length === 0) continue;
      const labels = labelsByCommandId.get(binding.commandId) ?? new Set<string>();
      labels.add(keyChordListLabel(binding.chords));
      labelsByCommandId.set(binding.commandId, labels);
    }
    return new Map(
      [...labelsByCommandId.entries()].map(([commandId, labels]) => [
        commandId,
        [...labels].join(" / ")
      ])
    );
  }, [shortcutSettings]);
  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));
  const selectedItem = items[clampedSelectedIndex] ?? null;

  useEffect(() => {
    if (showCommandPalette) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        selectTextInputValue(inputRef.current);
      });
    }
  }, [showCommandPalette]);

  if (!showCommandPalette) return null;

  const closePalette = () => {
    setQuery("");
    setSelectedIndex(0);
    dispatchCommand("closeCommandPalette");
  };

  const runSelectedCommand = () => {
    if (!selectedItem) return;

    dispatchCommand(selectedItem.commandId, commandContext);
    dispatchCommand("closeCommandPalette");
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={closePalette}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="コマンドパレット"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          value={query}
          placeholder="コマンドを検索"
          aria-label="コマンドを検索"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closePalette();
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) => Math.min(index + 1, items.length - 1));
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((index) => Math.max(index - 1, 0));
              return;
            }

            if (event.key === "Enter") {
              if (isImeComposingKeyEvent(event)) return;
              event.preventDefault();
              runSelectedCommand();
            }
          }}
        />

        <div className="command-palette-list" role="listbox" aria-label="コマンド候補">
          {items.length === 0 ? (
            <p className="command-palette-empty">該当するコマンドはありません。</p>
          ) : (
            items.map((item, index) => {
              const shortcutLabel = shortcutLabelByCommandId.get(item.commandId);
              return (
                <button
                  key={item.commandId}
                  type="button"
                  className={`command-palette-item ${index === clampedSelectedIndex ? "selected" : ""}`}
                  role="option"
                  aria-selected={index === clampedSelectedIndex}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    dispatchCommand(item.commandId, commandContext);
                    dispatchCommand("closeCommandPalette");
                  }}
                >
                  <span>{item.label}</span>
                  {shortcutLabel ? <kbd>{shortcutLabel}</kbd> : null}
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};
