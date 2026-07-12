import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { ElementId } from "../types/geometry";
import { entriesInVisibleRanges, type EvaluationDecorationIndex, type IndexedLineStatus } from "./sourceEditorEvaluationIndex";
import { evaluationChanged } from "./sourceEditorEvaluationEffects";
import { sourceEditorGeneratedRowsExtension } from "./sourceEditorGeneratedRowsExtension";
import type { AtStopRange } from "./statementRangeIndex";

export { evaluationChanged } from "./sourceEditorEvaluationEffects";

export type EvaluationGutterAction = "visibility" | "enabled" | "locked" | "print" | "stop";

export type EvaluationExtensionSource = {
  index: () => EvaluationDecorationIndex;
  atStopRange: () => AtStopRange | null;
  pickCursorElementId: () => ElementId | null;
  isLastGood: () => boolean;
  onGutterAction: (action: EvaluationGutterAction, lineFrom: number) => boolean;
};

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

const stateSummaryLabel = (status: IndexedLineStatus) => [
  status.hiddenSelf ? "非表示" : "表示",
  status.disabledSelf ? "評価しない" : "評価する",
  status.locked ? "ロック中" : "編集可能",
  status.printEnabled ? "印刷する" : "印刷しない"
].join(" / ");

class ElementStateMarker extends GutterMarker {
  constructor(
    private readonly status: IndexedLineStatus,
    private readonly lineFrom: number
  ) { super(); }

  toDOM() {
    const root = document.createElement("span");
    root.className = [
      "cm-element-state-marker",
      this.status.hiddenSelf ? "is-hidden" : "",
      this.status.disabledSelf ? "is-disabled" : "",
      this.status.locked ? "is-locked" : "",
      this.status.printEnabled ? "is-print-enabled" : ""
    ].filter(Boolean).join(" ");
    root.title = stateSummaryLabel(this.status);
    root.dataset.sourceStateRailLine = String(this.lineFrom);
    root.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      root.dispatchEvent(new CustomEvent("source-editor-open-state-rail", {
        bubbles: true,
        detail: { lineFrom: this.lineFrom }
      }));
    });
    return root;
  }
}

type StateRailAction = Exclude<EvaluationGutterAction, "stop">;

const stateRailActions = (status: IndexedLineStatus): Array<[StateRailAction, string, string]> => [
  ["visibility", status.hiddenSelf ? "表示する" : "非表示にする", "◉"],
  ["enabled", status.disabledSelf ? "評価する" : "評価しない", "▶"],
  ["locked", status.locked ? "ロック解除" : "ロック", "⌑"],
  ["print", status.printEnabled ? "印刷しない" : "印刷する", "🖶"]
];

class ElementStateRail {
  private readonly root = document.createElement("div");
  private openLineFrom: number | null = null;

  constructor(private view: EditorView, private readonly source: EvaluationExtensionSource) {
    this.root.className = "cm-element-state-rail";
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "行の状態操作");
    this.root.hidden = true;
    this.view.dom.appendChild(this.root);
    this.view.dom.addEventListener("source-editor-open-state-rail", this.onOpen as EventListener);
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.addEventListener("keydown", this.onDocumentKeyDown, true);
  }

  update(update: ViewUpdate) {
    this.view = update.view;
    const evaluationChangedInUpdate = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(evaluationChanged))
    );
    if (this.openLineFrom !== null && (update.docChanged || update.viewportChanged || update.geometryChanged || evaluationChangedInUpdate)) {
      this.render();
    }
  }

  destroy() {
    this.view.dom.removeEventListener("source-editor-open-state-rail", this.onOpen as EventListener);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.removeEventListener("keydown", this.onDocumentKeyDown, true);
    this.root.remove();
  }

  private readonly onOpen = (event: CustomEvent<{ lineFrom: number }>) => {
    event.preventDefault();
    event.stopPropagation();
    this.openLineFrom = event.detail.lineFrom;
    this.render();
  };

  private readonly onDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Node ? event.target : null;
    if (!target || this.root.contains(target)) return;
    if (target instanceof Element && target.closest("[data-source-state-rail-line]")) return;
    this.close();
  };

  private readonly onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || this.openLineFrom === null) return;
    event.preventDefault();
    this.close();
  };

  private close() {
    this.openLineFrom = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private render() {
    if (this.openLineFrom === null) return;
    const status = this.source.index().statusByLineFrom.get(this.openLineFrom);
    const anchor = this.view.dom.querySelector<HTMLElement>(`[data-source-state-rail-line="${this.openLineFrom}"]`);
    if (!status || !anchor) {
      this.close();
      return;
    }
    const editorRect = this.view.dom.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    this.root.style.left = `${Math.max(0, anchorRect.right - editorRect.left + 5)}px`;
    this.root.style.top = `${Math.max(0, anchorRect.top - editorRect.top - 4)}px`;
    this.root.replaceChildren();
    for (const [action, label, icon] of stateRailActions(status)) {
      if (action === "visibility" && !status.canToggleVisibility) continue;
      if (action === "print" && !status.canTogglePrint) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.textContent = icon;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.source.onGutterAction(action, this.openLineFrom!);
      });
      this.root.appendChild(button);
    }
    this.root.hidden = false;
  }
}

const elementStateGutter = (source: EvaluationExtensionSource) => gutter({
  class: "cm-element-state-gutter",
  lineMarker: (view, line) => {
    const status = source.index().statusByLineFrom.get(line.from);
    if (!status) return null;
    return new ElementStateMarker(status, line.from);
  },
  lineMarkerChange: (update) => update.docChanged || update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(evaluationChanged))
  )
});

export const createEvaluationExtension = (source: EvaluationExtensionSource): Extension => {
  const evaluationViewPlugin = ViewPlugin.define<EvaluationViewPluginValue>((view) => new EvaluationViewPluginValue(view, source), { decorations: (value) => value.decorations });
  const elementStateRail = ViewPlugin.fromClass(
    class extends ElementStateRail {
      constructor(view: EditorView) { super(view, source); }
    }
  );
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
    sourceEditorGeneratedRowsExtension(source),
    elementStateRail,
    statusGutter,
    elementStateGutter(source)
  ];
};
