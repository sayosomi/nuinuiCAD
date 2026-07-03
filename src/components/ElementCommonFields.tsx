import { dispatchCommand } from "../commands/commands";
import { elementSupportsDisplayColor } from "../palette/colorApplicability";
import { supportsNumericVariables } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement } from "../types/geometry";
import {
  BooleanParameterEditor,
  NumericParameterEditor,
  ParameterName
} from "./ParameterEditors";
import { PointAnchorParameterEditor } from "./PointParameterEditors";
import { ColorParameterEditor } from "./ColorParameterEditor";
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
      {element.type !== "variable" ? (
        <>
          {elementSupportsDisplayColor(element) ? (
            <ColorParameterEditor {...elementEditorProps} />
          ) : null}
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="visible"
            label="表示する"
            checked={element.visible}
          />
        </>
      ) : null}
      <BooleanParameterEditor
        {...elementEditorProps}
        parameterKey="enabled"
        label="評価する"
        checked={element.enabled}
      />

      {element.type === "group" && (
        <>
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="printEnabled"
            label="印刷する"
            checked={element.printEnabled === true}
          />
          <PointAnchorParameterEditor
            {...commonEditorProps}
            parameterKey="printAnchor"
            label="印刷基準点"
            anchor={element.printAnchor ?? { mode: "coordinate", x: 0, y: 0 }}
            allowCoordinate
          />
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="expanded"
            label="展開する"
            checked={element.expanded}
          />
        </>
      )}
      {element.type === "conditionalGroup" && (
        <>
          <NumericParameterEditor
            {...commonEditorProps}
            parameterKey="condition"
            label="条件"
            value={element.condition}
            ariaLabel={`${element.name} の条件`}
            enableExpressionInsert
            showStepControl={false}
          />
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="expanded"
            label="thenを展開する"
            checked={element.expanded}
          />
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="elseExpanded"
            label="elseを展開する"
            checked={element.elseExpanded}
          />
        </>
      )}

      {supportsNumericVariables(element) && (
        <div className="local-variable-editor">
          <div className="local-variable-section-header">
            <span>要素内変数</span>
            <button type="button" onClick={() => dispatchCommand("addNumericVariable")}>
              追加
            </button>
          </div>
          {(element.numericVariables ?? []).length === 0 ? (
            <p className="empty-state">要素内変数はありません。</p>
          ) : (
            (element.numericVariables ?? []).map((variable, index) => (
              <div className="local-variable-group" key={variable.id}>
                <div className="local-variable-row-header">
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
                    aria-label="要素内変数名"
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
                  ariaLabel={`要素内変数 ${variable.name}`}
                  enableExpressionInsert
                />
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
};
