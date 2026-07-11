import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from "@codemirror/view";
import type { GroupFoldById } from "../model/groups";
import type { PickCandidate } from "../model/pickCandidates";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import {
  forGroupGeneratedWidgetSpecs,
  pickCandidateLines,
  visibleLineStatuses,
  type GeneratedWidgetSpec,
  type LineStatus
} from "./sourceEditorEvaluationDecorations";
import type { AtStopRange, StatementRangeIndex } from "./statementRangeIndex";

/** Dispatched to force a decoration rebuild when setEvaluation() promotes a new result. */
export const evaluationChanged = StateEffect.define<null>();

export type EvaluationExtensionSource = {
  statementRanges: () => StatementRangeIndex;
  elements: () => readonly CadElement[];
  evaluation: () => EvaluationResult | null;
  groupFoldById: () => GroupFoldById;
  atStopRange: () => AtStopRange | null;
  pickCandidates: () => readonly PickCandidate[];
  pickCursorElementId: () => ElementId | null;
};

class GeneratedRowsWidget extends WidgetType {
  constructor(private readonly spec: GeneratedWidgetSpec) {
    super();
  }

  eq(other: GeneratedRowsWidget) {
    return other.spec.forGroupId === this.spec.forGroupId && other.spec.rows.length === this.spec.rows.length;
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

  ignoreEvent() {
    return true;
  }
}

class StatusGutterMarker extends GutterMarker {
  constructor(private readonly className: string) {
    super();
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = this.className;
    return element;
  }
}

const errorGutterMarker = new StatusGutterMarker("cm-status-gutter-marker cm-status-gutter-error");
const warningGutterMarker = new StatusGutterMarker("cm-status-gutter-marker cm-status-gutter-warning");
const stopGutterMarker = new StatusGutterMarker("cm-status-gutter-marker cm-status-gutter-stop");

const lineClassFor = (status: LineStatus) => {
  const classes = ["cm-eval-line"];
  if (status.hasError) classes.push("cm-eval-error");
  if (status.hasWarning) classes.push("cm-eval-warning");
  if (status.hiddenByGroup) classes.push("cm-eval-hidden-by-group");
  if (status.disabledByGroup) classes.push("cm-eval-disabled-by-group");
  if (status.conditionInactive) classes.push("cm-eval-condition-inactive");
  if (!status.isEvaluated) classes.push("cm-eval-unevaluated");
  if (status.locked) classes.push("cm-eval-locked");
  if (status.printEnabled) classes.push("cm-eval-print-enabled");
  return classes.join(" ");
};

export class EvaluationViewPluginValue {
  decorations: DecorationSet = Decoration.none;
  statuses: LineStatus[] = [];

  constructor(
    private view: EditorView,
    private readonly source: EvaluationExtensionSource
  ) {
    this.rebuild();
  }

  update(update: ViewUpdate) {
    this.view = update.view;
    const evaluationDidChange = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(evaluationChanged))
    );
    if (update.docChanged || update.viewportChanged || evaluationDidChange) this.rebuild();
  }

  private rebuild() {
    const ranges = this.source.statementRanges();
    const elements = this.source.elements();
    const evaluation = this.source.evaluation();
    const groupFoldById = this.source.groupFoldById();
    const visible = this.view.visibleRanges;

    this.statuses = evaluation ? visibleLineStatuses(ranges, elements, evaluation, groupFoldById, visible) : [];
    const pickLines = pickCandidateLines(ranges, this.source.pickCandidates(), this.source.pickCursorElementId(), visible);
    const widgetSpecs = evaluation ? forGroupGeneratedWidgetSpecs(ranges, elements, evaluation, groupFoldById, visible) : [];
    const atStop = this.source.atStopRange();

    const entries: { pos: number; decoration: Decoration }[] = [];
    for (const status of this.statuses) {
      entries.push({ pos: status.from, decoration: Decoration.line({ class: lineClassFor(status) }) });
    }
    for (const line of pickLines) {
      entries.push({
        pos: line.from,
        decoration: Decoration.line({ class: line.isCursor ? "cm-pick-cursor" : "cm-pick-candidate" })
      });
    }
    if (atStop) {
      entries.push({ pos: atStop.from, decoration: Decoration.line({ class: "cm-at-stop-line" }) });
    }
    for (const spec of widgetSpecs) {
      entries.push({
        pos: spec.afterPos,
        decoration: Decoration.widget({ widget: new GeneratedRowsWidget(spec), side: 1, block: true })
      });
    }

    entries.sort((a, b) => a.pos - b.pos);
    const builder = new RangeSetBuilder<Decoration>();
    for (const entry of entries) builder.add(entry.pos, entry.pos, entry.decoration);
    this.decorations = builder.finish();
  }
}

/**
 * Builds a fresh ViewPlugin + gutter pair per call, closing over this controller's own
 * `source`. Each SourceEditorController instance gets its own extension instances, so
 * multiple controllers (e.g. across tests) never share mutable state.
 */
export const createEvaluationExtension = (source: EvaluationExtensionSource): Extension => {
  const evaluationViewPlugin = ViewPlugin.define<EvaluationViewPluginValue>(
    (view) => new EvaluationViewPluginValue(view, source),
    { decorations: (value) => value.decorations }
  );

  const statusGutter = gutter({
    class: "cm-status-gutter",
    lineMarker: (view, line) => {
      const plugin = view.plugin(evaluationViewPlugin);
      if (!plugin) return null;
      const atStop = source.atStopRange();
      if (atStop && atStop.from === line.from) return stopGutterMarker;
      const status = plugin.statuses.find((item) => item.from === line.from);
      if (!status) return null;
      if (status.hasError) return errorGutterMarker;
      if (status.hasWarning) return warningGutterMarker;
      return null;
    },
    initialSpacer: () => errorGutterMarker
  });

  return [evaluationViewPlugin, statusGutter];
};
