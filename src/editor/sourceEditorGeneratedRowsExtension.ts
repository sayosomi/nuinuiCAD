import { RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { evaluationChanged } from "./sourceEditorEvaluationEffects";
import type { EvaluationDecorationIndex, IndexedGeneratedWidget } from "./sourceEditorEvaluationIndex";

type GeneratedRowsSource = {
  index: () => EvaluationDecorationIndex;
};

const rowsKey = (rows: IndexedGeneratedWidget["rows"]) => rows.map((row) =>
  `${row.generatedElementId}\u0000${row.variableName}\u0000${row.variableValue}\u0000${row.elementName}`
).join("\u0001");

class GeneratedRowsWidget extends WidgetType {
  constructor(private readonly spec: IndexedGeneratedWidget) { super(); }

  eq(other: GeneratedRowsWidget) {
    return other.spec.forGroupId === this.spec.forGroupId && rowsKey(other.spec.rows) === rowsKey(this.spec.rows);
  }

  toDOM() {
    const container = document.createElement("div");
    container.className = "cm-generated-rows-widget";
    container.contentEditable = "false";
    for (const row of this.spec.rows) {
      const line = document.createElement("div");
      line.className = "cm-generated-row";
      line.textContent = `${row.variableName}=${row.variableValue} → ${row.elementName}`;
      container.appendChild(line);
    }
    return container;
  }

  ignoreEvent() { return true; }
}

const decorationsFor = (index: EvaluationDecorationIndex) => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const spec of index.generatedWidgets) {
    builder.add(spec.afterPos, spec.afterPos, Decoration.widget({
      widget: new GeneratedRowsWidget(spec),
      side: 1,
      block: true
    }));
  }
  return builder.finish();
};

/** Block widgets must be supplied by a StateField, not a ViewPlugin. */
export const sourceEditorGeneratedRowsExtension = (source: GeneratedRowsSource): Extension => {
  const generatedRowsField = StateField.define<DecorationSet>({
    create: () => decorationsFor(source.index()),
    update: (value, transaction) => {
      if (transaction.effects.some((effect) => effect.is(evaluationChanged))) {
        return decorationsFor(source.index());
      }
      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field)
  });
  return generatedRowsField;
};
