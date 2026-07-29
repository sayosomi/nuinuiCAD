import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { ElementId } from "../types/geometry";
import { entriesInVisibleRanges, type EvaluationDecorationIndex, type IndexedLineStatus } from "./sourceEditorEvaluationIndex";
import { evaluationChanged } from "./sourceEditorEvaluationEffects";
import { sourceEditorGeneratedRowsExtension } from "./sourceEditorGeneratedRowsExtension";
import type { AtStopRange } from "./statementRangeIndex";

export { evaluationChanged } from "./sourceEditorEvaluationEffects";

export type EvaluationExtensionSource = {
  index: () => EvaluationDecorationIndex;
  atStopRange: () => AtStopRange | null;
  pickCursorElementId: () => ElementId | null;
  isLastGood: () => boolean;
  onGutterAction: (lineFrom: number) => boolean;
};

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
    entries.sort((left, right) => left.pos - right.pos);
    const builder = new RangeSetBuilder<Decoration>();
    for (const entry of entries) builder.add(entry.pos, entry.pos, entry.decoration);
    this.decorations = builder.finish();
  }
}

const activityClassFor = (status: IndexedLineStatus) =>
  status.disabledSelf ? "is-disabled" : status.hiddenSelf ? "is-hidden" : "is-visible";

const activityLabelFor = (status: IndexedLineStatus) =>
  status.disabledSelf ? "評価しない" : status.hiddenSelf ? "非表示" : "表示";

class ElementStateMarker extends GutterMarker {
  constructor(
    private readonly status: IndexedLineStatus,
    private readonly lineFrom: number,
    private readonly source: EvaluationExtensionSource
  ) { super(); }

  toDOM() {
    const root = document.createElement("span");
    const label = activityLabelFor(this.status);
    root.className = `cm-element-state-marker ${activityClassFor(this.status)}`;
    root.title = label;
    root.setAttribute("aria-label", label);
    root.dataset.elementActivityLine = String(this.lineFrom);
    root.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.source.onGutterAction(this.lineFrom);
    });
    return root;
  }
}

const elementStateGutter = (source: EvaluationExtensionSource) => gutter({
  class: "cm-element-state-gutter",
  lineMarker: (view, line) => {
    const status = source.index().statusByLineFrom.get(line.from);
    if (!status) return null;
    return new ElementStateMarker(status, line.from, source);
  },
  lineMarkerChange: (update) => update.docChanged || update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(evaluationChanged))
  )
});

export const createEvaluationExtension = (source: EvaluationExtensionSource): Extension => {
  const evaluationViewPlugin = ViewPlugin.define<EvaluationViewPluginValue>((view) => new EvaluationViewPluginValue(view, source), { decorations: (value) => value.decorations });
  return [
    evaluationViewPlugin,
    sourceEditorGeneratedRowsExtension(source),
    elementStateGutter(source)
  ];
};
