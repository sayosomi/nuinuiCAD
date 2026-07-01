import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement } from "../types/geometry";
import { ParameterName } from "./ParameterName";
import type { CommonEditorProps } from "./parameterEditorShared";
import { useParameterEditor } from "./parameterEditorShared";

const AUTO_COLOR_VALUE = "__auto__";

export const ColorParameterEditor = ({
  element,
  isParameterEditMode,
  registerParameterControl
}: Omit<CommonEditorProps, "elements">) => {
  const palette = useCadDocumentStore((state) => state.palette);
  const updateElement = useCadDocumentStore((state) => state.updateElement);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { controlProps, parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const selectedValue = element.colorId ?? AUTO_COLOR_VALUE;
  const selectedColor = palette.colors.find((color) => color.id === element.colorId) ?? null;
  const selectedLabel = selectedColor?.name ?? "自動";

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const updateColor = (value: string) => {
    selectParameter("colorId");
    setIsOpen(false);
    updateElement(
      element.id,
      value === AUTO_COLOR_VALUE
        ? ({ colorId: undefined } as Partial<CadElement>)
        : { colorId: value }
    );
  };

  return (
    <div className={parameterFieldClass("colorId")} onClick={() => selectParameter("colorId")}>
      <ParameterName element={element} parameterKey="colorId" label="表示色" />
      <div className="color-parameter-control">
        <div className="color-select" ref={containerRef}>
          <button
            {...controlProps("colorId")}
            type="button"
            className="color-select-trigger"
            aria-label={`${element.name} の表示色`}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            onClick={(event) => {
              event.stopPropagation();
              selectParameter("colorId");
              setIsOpen((value) => !value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
          >
            <ColorSwatch colorHex={selectedColor?.hex ?? null} />
            <span className="color-select-label">{selectedLabel}</span>
            <span className="color-select-arrow" aria-hidden="true">
              ▾
            </span>
          </button>
          {isOpen ? (
            <div
              className="color-option-list"
              role="listbox"
              aria-label={`${element.name} の表示色候補`}
            >
              <ColorOption
                active={selectedValue === AUTO_COLOR_VALUE}
                description="親グループ / 既定色"
                label="自動"
                onSelect={() => updateColor(AUTO_COLOR_VALUE)}
              />
              {palette.colors.map((color) => (
                <ColorOption
                  key={color.id}
                  active={selectedValue === color.id}
                  colorHex={color.hex}
                  description={color.hex}
                  label={color.name}
                  onSelect={() => updateColor(color.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="color-palette-edit-button"
          onClick={(event) => {
            event.stopPropagation();
            dispatchCommand("openPaletteSettings");
          }}
        >
          編集
        </button>
      </div>
    </div>
  );
};

const ColorSwatch = ({ colorHex }: { colorHex?: string | null }) => (
  <span
    className={`color-option-swatch ${colorHex ? "" : "color-option-swatch-auto"}`}
    style={colorHex ? ({ "--color-option": colorHex } as CSSProperties) : undefined}
    aria-hidden="true"
  />
);

const ColorOption = ({
  active,
  colorHex,
  description,
  label,
  onSelect
}: {
  active: boolean;
  colorHex?: string;
  description: string;
  label: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    className={`color-option-button ${active ? "active" : ""}`}
    role="option"
    aria-selected={active}
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
  >
    <ColorSwatch colorHex={colorHex ?? null} />
    <span className="color-option-label">
      <strong>{label}</strong>
      <small>{description}</small>
    </span>
  </button>
);
