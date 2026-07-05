import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { NumericValue } from "../types/geometry";
import {
  NumericParameterEditor,
  PointAnchorParameterEditor
} from "./ParameterEditors";
import { ParameterName } from "./ParameterName";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import type { CommonEditorProps } from "./parameterEditorShared";

export const TextElementFields = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  const updateElement = useCadDocumentStore((state) => state.updateElement);
  const selectedParameterKey = useCadDocumentStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadDocumentStore((state) => state.setSelectedParameterKey);
  if (element.type !== "text") return null;
  const commonEditorProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
  const parameterFieldClass = (key: ParameterKey) =>
    `parameter-field ${
      isParameterEditMode && selectedParameterKey === key ? "selected-parameter" : ""
    }`;
  const commitText = (text: string) => updateElement(element.id, { text });

  return (
    <>
      <label
        className={parameterFieldClass("text")}
        onClick={() => setSelectedParameterKey("text")}
      >
        <ParameterName element={element} parameterKey="text" label="テキスト" />
        <textarea
          className="text-parameter-input"
          key={`${element.id}-${element.text}`}
          ref={(node) => registerParameterControl("text", node)}
          defaultValue={element.text}
          rows={3}
          onFocus={() => setSelectedParameterKey("text")}
          onBlur={(event) => commitText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isImeComposingKeyEvent(event)) return;
            if (event.key === "Escape") {
              event.currentTarget.value = element.text;
              event.currentTarget.blur();
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              commitText(event.currentTarget.value);
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <PointAnchorParameterEditor
        {...commonEditorProps}
        parameterKey="anchor"
        label="基準点"
        anchor={element.anchor}
        allowCoordinate
      />
      <NumericParameterEditor
        {...commonEditorProps}
        parameterKey="fontSize"
        label="文字サイズ"
        value={element.fontSize as NumericValue}
        ariaLabel="文字サイズ"
        enableExpressionInsert
      />
    </>
  );
};
