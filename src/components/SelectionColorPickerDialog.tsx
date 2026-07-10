import type { CSSProperties } from "react";
import { dispatchCommand } from "../commands/commands";
import { elementSupportsDisplayColor } from "../palette/colorApplicability";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

export const SelectionColorPickerDialog = () => {
  const showSelectionColorPicker = useCadUiStore((state) => state.showSelectionColorPicker);
  const elements = useCadDocumentStore((state) => state.elements);
  const palette = useCadDocumentStore((state) => state.palette);
  const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);

  if (!showSelectionColorPicker) return null;

  const selectedIds = new Set(
    selectedElementId && !selectedElementIds.includes(selectedElementId)
      ? [selectedElementId]
      : selectedElementIds
  );
  const eligibleCount = elements.filter(
    (element) => selectedIds.has(element.id) && elementSupportsDisplayColor(element)
  ).length;
  const close = () => dispatchCommand("closeSelectionColorPicker");
  const applyColor = (colorId?: string) => {
    dispatchCommand("applyDisplayColorToSelection", { colorId });
    close();
  };

  return (
    <div
      className="selection-color-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <section
        className="selection-color-picker"
        role="dialog"
        aria-modal="true"
        aria-label="選択範囲の表示色"
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>選択範囲の表示色</h2>
            <p>{eligibleCount}件に適用</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>
        <div className="selection-color-picker-list" role="listbox" aria-label="表示色候補">
          <SelectionColorOption
            description="親グループ / 既定色"
            label="自動"
            onSelect={() => applyColor()}
          />
          {palette.colors.map((color) => (
            <SelectionColorOption
              key={color.id}
              colorHex={color.hex}
              description={color.hex}
              label={color.name}
              onSelect={() => applyColor(color.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

const SelectionColorSwatch = ({ colorHex }: { colorHex?: string | null }) => (
  <span
    className={`color-option-swatch ${colorHex ? "" : "color-option-swatch-auto"}`}
    style={colorHex ? ({ "--color-option": colorHex } as CSSProperties) : undefined}
    aria-hidden="true"
  />
);

const SelectionColorOption = ({
  colorHex,
  description,
  label,
  onSelect
}: {
  colorHex?: string;
  description: string;
  label: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    className="color-option-button"
    role="option"
    aria-selected={false}
    onClick={onSelect}
  >
    <SelectionColorSwatch colorHex={colorHex ?? null} />
    <span className="color-option-label">
      <strong>{label}</strong>
      <small>{description}</small>
    </span>
  </button>
);
