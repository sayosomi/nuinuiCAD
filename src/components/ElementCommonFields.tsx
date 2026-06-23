import { dispatchCommand } from "../commands/commands";
import { supportsNumericVariables } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement } from "../types/geometry";
import {
  BooleanParameterEditor,
  NumericParameterEditor,
  ParameterName
} from "./ParameterEditors";
import type { CommonEditorProps } from "./parameterEditorShared";

export const ElementCommonFields = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  const updateElement = useCadDocumentStore((state) => state.updateElement);
  const renameElement = useCadDocumentStore((state) => state.renameElement);
  const selectedParameterKey = useCadDocumentStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadDocumentStore((state) => state.setSelectedParameterKey);
  const commonEditorProps = { element, elements, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };

  const commitName = (name: string) => renameElement(element.id, name);
  const parameterFieldClass = (key: ParameterKey) =>
    `parameter-field ${
      isParameterEditMode && selectedParameterKey === key ? "selected-parameter" : ""
    }`;
  const selectParameter = (key: ParameterKey) => setSelectedParameterKey(key);

  return (
    <>
      <label className={parameterFieldClass("name")} onClick={() => selectParameter("name")}>
        <ParameterName element={element} parameterKey="name" label="名前" />
        <input
          key={`${element.id}-${element.name}`}
          ref={(node) => registerParameterControl("name", node)}
          defaultValue={element.name}
          onFocus={() => setSelectedParameterKey("name")}
          onBlur={(event) => commitName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitName(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.currentTarget.value = element.name;
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <BooleanParameterEditor
        {...elementEditorProps}
        parameterKey="visible"
        label="表示する"
        checked={element.visible}
      />
      <BooleanParameterEditor
        {...elementEditorProps}
        parameterKey="enabled"
        label="評価する"
        checked={element.enabled}
      />

      {element.type === "group" && (
        <BooleanParameterEditor
          {...elementEditorProps}
          parameterKey="expanded"
          label="展開する"
          checked={element.expanded}
        />
      )}

      {supportsNumericVariables(element) && (
        <div className="curve-point-editor">
          <div className="curve-point-header">
            <span>共通変数</span>
            <button type="button" onClick={() => dispatchCommand("addNumericVariable")}>
              追加
            </button>
          </div>
          {(element.numericVariables ?? []).length === 0 ? (
            <p className="empty-state">共通変数はありません。</p>
          ) : (
            (element.numericVariables ?? []).map((variable, index) => (
              <div className="curve-point-group" key={variable.id}>
                <div className="curve-point-header">
                  <span>変数{index + 1}</span>
                  <button
                    type="button"
                    onClick={() =>
                      dispatchCommand("deleteNumericVariable", {
                        variableId: variable.id
                      })
                    }
                  >
                    削除
                  </button>
                </div>
                <label className="parameter-field">
                  <span className="parameter-name">名前 (@名前で参照)</span>
                  <input
                    type="text"
                    aria-label="共通変数名"
                    value={variable.name}
                    onChange={(event) =>
                      updateElement(element.id, {
                        numericVariables: (element.numericVariables ?? []).map((item) =>
                          item.id === variable.id ? { ...item, name: event.target.value } : item
                        )
                      } as Partial<CadElement>)
                    }
                  />
                </label>
                <NumericParameterEditor
                  {...commonEditorProps}
                  parameterKey={`variable:${variable.id}:value`}
                  label={variable.name}
                  value={variable.value}
                  ariaLabel={`共通変数 ${variable.name}`}
                />
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
};
