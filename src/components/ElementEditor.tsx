import type { CadElement } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import { ElementCommonFields } from "./ElementCommonFields";
import { ElementSpecificFields } from "./ElementSpecificFields";

export const ElementEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl
}: {
  element: CadElement;
  elements: CadElement[];
  isParameterEditMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
}) => {
  const editorProps = { element, elements, isParameterEditMode, registerParameterControl };

  return (
    <section className="panel-section">
      <div className="section-header">
        <div>
          <h2>要素設定</h2>
          <p className="section-subtitle">
            {element.name} ・ {elementTypeLabels[element.type]}
          </p>
        </div>
        <span className={`mode-pill ${isParameterEditMode ? "active" : ""}`}>
          {isParameterEditMode ? "要素設定中" : "eで要素設定"}
        </span>
      </div>
      <div className="editor-grid">
        <ElementCommonFields {...editorProps} />
        <ElementSpecificFields {...editorProps} />
      </div>
    </section>
  );
};
