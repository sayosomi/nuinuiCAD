import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { ElementId } from "../types/geometry";
import { entriesInVisibleRanges, type EvaluationDecorationIndex, type IndexedGeneratedWidget, type IndexedLineStatus } from "./sourceEditorEvaluationIndex";
import type { AtStopRange } from "./statementRangeIndex";

/** Refreshes only decoration projections; it never changes editor text, selection, or history. */
export const evaluationChanged = StateEffect.define<null>();

export type EvaluationGutterAction = "visibility" | "enabled" | "locked" | "print" | "stop";

export type EvaluationExtensionSource = {
  index: () => EvaluationDecorationIndex;
  atStopRange: () => AtStopRange | null;
  pickCursorElementId: () => ElementId | null;
  isLastGood: () => boolean;
  onGutterAction: (action: EvaluationGutterAction, lineFrom: number) => boolean;
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

class StatusGutterMarker extends GutterMarker {
  constructor(private readonly className: string, private readonly label: string) { super(); }
  toDOM() {
    const element = document.createElement("span");
    element.className = this.className;
    element.setAttribute("aria-label", this.label);
    element.title = this.label;
    return element;
  }
}

const marker = (className: string, label: string) => new StatusGutterMarker(className, label);
const errorMarker = marker("cm-status-gutter-marker cm-status-gutter-error", "評価エラー");
const warningMarker = marker("cm-status-gutter-marker cm-status-gutter-warning", "評価警告");
const stopMarker = marker("cm-status-gutter-marker cm-status-gutter-stop", "評価区切り");

const lineClassFor = (status: IndexedLineStatus, isLastGood: boolean) => {
  const classes = ["cm-eval-line"];
  if (status.hasError) classes.push("cm-eval-error");
  if (status.hasWarning) classes.push("cm-eval-warning");
  if (status.hiddenSelf) classes.push("cm-eval-hidden-self");
  if (status.hiddenByGroup) classes.push("cm-eval-hidden-by-group");
  if (status.hiddenByProfile) classes.push("cm-eval-hidden-by-profile");
  if (status.disabledSelf) classes.push("cm-eval-disabled-self");
  if (status.disabledByGroup) classes.push("cm-eval-disabled-by-group");
  if (status.conditionInactive) classes.push("cm-eval-condition-inactive");
  if (!status.isEvaluated) classes.push("cm-eval-unevaluated");
  if (status.locked) classes.push("cm-eval-locked");
  if (status.printEnabled) classes.push("cm-eval-print-enabled");
  if (isLastGood) classes.push("cm-eval-last-good");
  return classes.join(" ");
};

export class EvaluationViewPluginValue {
  decorations: DecorationSet = Decoration.none;
  statuses: IndexedLineStatus[] = [];
  constructor(private view: EditorView, private readonly source: EvaluationExtensionSource) { this.rebuild(); }
  update(update: ViewUpdate) {
    this.view = update.view;
    if (update.docChanged || update.viewportChanged || update.transactions.some((tx) => tx.effects.some((effect) => effect.is(evaluationChanged)))) this.rebuild();
  }
  private rebuild() {
    const index = this.source.index();
    const visible = this.view.visibleRanges;
    this.statuses = entriesInVisibleRanges(index.statuses, visible);
    const pickLines = entriesInVisibleRanges(index.pickLines, visible);
    const widgetSpecs = entriesInVisibleRanges(index.generatedWidgets.map((spec) => ({ ...spec, from: spec.afterPos, to: spec.afterPos })), visible);
    const atStop = this.source.atStopRange();
    const stopVisible = atStop && visible.some((range) => atStop.from >= range.from && atStop.from <= range.to);
    const entries: { pos: number; decoration: Decoration }[] = [];
    for (const status of this.statuses) entries.push({
      pos: status.from,
      decoration: Decoration.line({
        class: lineClassFor(status, this.source.isLastGood()),
        attributes: { style: `--cm-element-color:${status.color}` }
      })
    });
    for (const line of pickLines) entries.push({ pos: line.from, decoration: Decoration.line({ class: line.elementId === this.source.pickCursorElementId() ? "cm-pick-cursor" : "cm-pick-candidate" }) });
    if (stopVisible && atStop) entries.push({ pos: atStop.from, decoration: Decoration.line({ class: "cm-at-stop-line" }) });
    for (const spec of widgetSpecs) entries.push({ pos: spec.afterPos, decoration: Decoration.widget({ widget: new GeneratedRowsWidget(spec), side: 1, block: true }) });
    entries.sort((left, right) => left.pos - right.pos);
    const builder = new RangeSetBuilder<Decoration>();
    for (const entry of entries) builder.add(entry.pos, entry.pos, entry.decoration);
    this.decorations = builder.finish();
  }
}

const stateGutter = (
  source: EvaluationExtensionSource,
  action: Exclude<EvaluationGutterAction, "stop">,
  className: string,
  label: (status: IndexedLineStatus) => string,
  visible: (status: IndexedLineStatus) => boolean
) => gutter({
  class: className,
  lineMarker: (view, line) => {
    const status = source.index().statusByLineFrom.get(line.from);
    return status && visible(status) ? marker(`${className}-marker`, label(status)) : null;
  },
  domEventHandlers: { mousedown: (_view, line, event) => source.onGutterAction(action, line.from) && (event.preventDefault(), true) }
});

export const createEvaluationExtension = (source: EvaluationExtensionSource): Extension => {
  const evaluationViewPlugin = ViewPlugin.define<EvaluationViewPluginValue>((view) => new EvaluationViewPluginValue(view, source), { decorations: (value) => value.decorations });
  const statusGutter = gutter({
    class: "cm-status-gutter",
    lineMarker: (view, line) => {
      const atStop = source.atStopRange();
      if (atStop?.from === line.from) return stopMarker;
      const status = source.index().statusByLineFrom.get(line.from);
      if (status?.hasError) return errorMarker;
      if (status?.hasWarning) return warningMarker;
      return null;
    },
    domEventHandlers: { mousedown: (_view, line, event) => source.onGutterAction("stop", line.from) && (event.preventDefault(), true) },
    initialSpacer: () => errorMarker
  });
  return [
    evaluationViewPlugin,
    statusGutter,
    stateGutter(source, "visibility", "cm-visibility-gutter", (status) => status.hiddenSelf ? "表示する" : "非表示にする", (status) => status.canToggleVisibility),
    stateGutter(source, "enabled", "cm-enabled-gutter", (status) => status.disabledSelf ? "評価する" : "評価しない", () => true),
    stateGutter(source, "locked", "cm-locked-gutter", (status) => status.locked ? "ロック解除" : "ロック", () => true),
    stateGutter(source, "print", "cm-print-gutter", (status) => status.printEnabled ? "印刷しない" : "印刷する", (status) => status.canTogglePrint)
  ];
};
