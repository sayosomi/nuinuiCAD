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
  const { controlProps, parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const selectedValue = element.colorId ?? AUTO_COLOR_VALUE;

  const updateColor = (value: string) => {
    selectParameter("colorId");
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
        <select
          {...controlProps("colorId")}
          value={selectedValue}
          aria-label={`${element.name} の表示色`}
          onChange={(event) => updateColor(event.target.value)}
        >
          <option value={AUTO_COLOR_VALUE}>自動（親グループ / 既定色）</option>
          {palette.colors.map((color) => (
            <option key={color.id} value={color.id}>
              {color.name} {color.hex}
            </option>
          ))}
        </select>
        <button
          type="button"
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
