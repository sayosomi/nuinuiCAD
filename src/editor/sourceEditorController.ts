import { codeFolding, foldGutter, foldService } from "@codemirror/language";
import { openSearchPanel, closeSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState, Text, Transaction } from "@codemirror/state";
import { defaultKeymap, history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { EditorView, keymap, lineNumbers, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { forceLinting } from "@codemirror/lint";
import { dispatchCommand } from "../commands/commands";
import { pickCandidates } from "../model/pickCandidates";
import type { ElementId, EvaluationResult } from "../types/geometry";
import { useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
import { useCadUiStore, type CadUiState } from "../state/cadUiStore";
import { dslCmLanguageExtension } from "./cmLanguage";
import { lineSplicesToSourceTextChanges } from "./lineSpliceChanges";
import { registerSourceEditSession, type FlushReason, type SourceEditFlushResult } from "./sourceEditSession";
import {
  beginSourceComposition,
  createSourceUpdateProtocol,
  endSourceComposition,
  receiveSourceUpdate,
  type PendingSourceUpdate,
  type SourceUpdateProtocolAction,
  type SourceUpdateProtocolState
} from "./sourceUpdateProtocol";
import { normalizeSourceTextForEditor, serializeEditorText, sourceTextFormat } from "./sourceTextFormat";
import type { SourceEditorControllerOptions, SourceEditorHandle, SourceTextFormat } from "./sourceEditorTypes";
import {
  elementIdAtCursor,
  createAtStopRange,
  createStatementRangeIndex,
  mapAtStopRange,
  mapStatementRangeIndex,
  type AtStopRange,
  type StatementRangeIndex
} from "./statementRangeIndex";
import { foldProjectionTransaction, foldTargetAtLine, foldTargets } from "./sourceEditorFolding";
import { secondarySelectionEffect, sourceEditorSelectionExtension } from "./sourceEditorSelection";
import { createDiagnosticsExtension } from "./sourceEditorDiagnosticsExtension";
import { mapPositionedDiagnostics, toStaleDiagnostics, type PositionedDiagnostic } from "./sourceEditorDiagnostics";
import { createEvaluationExtension, evaluationChanged } from "./sourceEditorEvaluationExtension";

type SourceStore = {
  getState: () => CadDocumentState;
  subscribe: (listener: (state: CadDocumentState, previous: CadDocumentState) => void) => () => void;
};

type UiStore = {
  getState: () => CadUiState;
  subscribe: (listener: (state: CadUiState, previous: CadUiState) => void) => () => void;
};

const COMMIT_DELAY_MS = 300;
const modelPatchOrigin = Annotation.define<"model-patch">();
const resetOrigin = Annotation.define<"reset">();
const canvasCursorOrigin = Annotation.define<"canvas-cursor">();
const foldProjectionOrigin = Annotation.define<"fold-projection">();

export class SourceEditorController implements SourceEditorHandle {
  private readonly store: SourceStore;
  private readonly unsubscribe: () => void;
  private readonly uiStore: UiStore;
  private readonly unsubscribeUi: () => void;
  private readonly unregisterSession: () => void;
  private readonly historyCompartment = new Compartment();
  private readonly options: SourceEditorControllerOptions;
  private protocol: SourceUpdateProtocolState;
  private format: SourceTextFormat;
  private committedLogicalText: string;
  private committedDoc: Text;
  private commitTimer: number | null = null;
  private flushAfterComposition = false;
  private burstStartCursorLine: number | null = null;
  private statementRanges: StatementRangeIndex = new Map();
  private atStopRange: AtStopRange | null = null;
  private staleDiagnosticBaseline: PositionedDiagnostic[] = [];
  private pendingEvaluation: { evaluation: EvaluationResult; sourceRevision: number } | null = null;
  private appliedEvaluation: EvaluationResult | null = null;
  private pendingSelectionSync = false;
  private pendingFoldProjection = false;
  private applyingUiSync = false;
  private publishingCanvasSelection = false;
  private destroyed = false;
  private view: EditorView;

  constructor(
    parent: HTMLElement,
    store: SourceStore = useCadDocumentStore,
    uiStore: UiStore = useCadUiStore,
    options: SourceEditorControllerOptions = {}
  ) {
    this.store = store;
    this.uiStore = uiStore;
    this.options = options;
    const initial = store.getState();
    this.format = sourceTextFormat(initial.sourceText);
    this.committedLogicalText = normalizeSourceTextForEditor(initial.sourceText);
    this.committedDoc = Text.of(this.committedLogicalText.split("\n"));
    this.protocol = createSourceUpdateProtocol(initial.sourceRevision);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.committedLogicalText,
        extensions: [
          lineNumbers({
            domEventHandlers: {
              mousedown: (_view, line, event) => this.handleSelectionGutterMouseDown(line.from, event as MouseEvent)
            }
          }),
          dslCmLanguageExtension,
          sourceEditorSelectionExtension,
          codeFolding(),
          foldService.of((state, lineStart) => {
            const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineStart);
            return target ? { from: target.from, to: target.to } : null;
          }),
          foldGutter({
            domEventHandlers: {
              mousedown: (_view, line, event) => this.handleFoldGutterMouseDown(line.from, event as MouseEvent)
            }
          }),
          createDiagnosticsExtension({
            isComposing: () => this.protocol.composing,
            hasPendingText: () => this.hasPendingText(),
            committedDiagnostics: () => this.store.getState().diagnostics,
            staleBaseline: () => this.staleDiagnosticBaseline
          }),
          createEvaluationExtension({
            statementRanges: () => this.statementRanges,
            elements: () => this.store.getState().elements,
            evaluation: () => this.appliedEvaluation,
            groupFoldById: () => this.uiStore.getState().groupFoldById,
            atStopRange: () => this.atStopRange,
            pickCandidates: () => this.currentPickCandidates(),
            pickCursorElementId: () => this.uiStore.getState().activePickCursor?.elementId ?? null
          }),
          search(),
          this.historyCompartment.of(history()),
          keymap.of([
            { key: "Mod-z", run: () => this.runUndo() },
            { key: "Mod-y", run: () => this.runRedo() },
            { key: "Mod-Shift-z", run: () => this.runRedo() },
            { key: "Mod-s", run: () => this.runSave() },
            { key: "Enter", run: () => this.runPickApply() },
            { key: "Ctrl-Shift-[", mac: "Mod-Alt-[", run: () => this.changeFoldAtCursor("fold") },
            { key: "Ctrl-Shift-]", mac: "Mod-Alt-]", run: () => this.changeFoldAtCursor("unfold") },
            { key: "Ctrl-Alt-[", run: () => this.changeAllFolds(false) },
            { key: "Ctrl-Alt-]", run: () => this.changeAllFolds(true) },
            ...searchKeymap,
            { key: "Escape", run: () => this.runEscape() },
            ...defaultKeymap
          ] satisfies KeyBinding[]),
          EditorView.domEventHandlers({
            contextmenu: (event, view) => this.handleContextMenu(event as MouseEvent, view)
          }),
          EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
          EditorView.domEventHandlers({
            compositionstart: () => {
              this.protocol = beginSourceComposition(this.protocol);
              return false;
            },
            compositionend: () => {
              this.drainCompositionQueue();
              this.publishCursorLine();
              if (this.flushAfterComposition) {
                this.flushAfterComposition = false;
                this.flush("blur");
              } else if (this.hasPendingText()) {
                this.scheduleCommit();
              }
              return false;
            },
            blur: () => {
              this.flush("blur");
              return false;
            }
          })
        ]
      })
    });
    this.unregisterSession = registerSourceEditSession({
      hasPendingText: () => this.hasPendingText(),
      isComposing: () => this.protocol.composing,
      flush: (reason) => this.flush(reason)
    });
    this.unsubscribe = store.subscribe((next, previous) => {
      if (next.sourceRevision === previous.sourceRevision) return;
      const update = next.sourceUpdate;
      this.receive({
        update,
        resetText: update.kind === "reset" ? next.sourceText : undefined
      });
    });
    this.unsubscribeUi = uiStore.subscribe((next, previous) => {
      const selectionChanged =
        next.selectedElementId !== previous.selectedElementId ||
        next.selectedElementIds !== previous.selectedElementIds;
      const foldChanged = next.groupFoldById !== previous.groupFoldById;
      if (selectionChanged) this.pendingSelectionSync = true;
      if (foldChanged) this.pendingFoldProjection = true;
      this.applyPendingUiSync();
    });
    this.refreshStatementRanges();
    this.pendingSelectionSync = true;
    this.pendingFoldProjection = true;
    this.applyPendingUiSync();
  }

  focus = () => this.view.focus();

  getText = () => serializeEditorText(this.view.state.doc.toString(), this.format);

  /**
   * Uses CM6's structural Text.eq instead of toString() so a fresh full-string
   * allocation is not made on every check (e.g. on every preview pointermove).
   */
  hasPendingText = () => !this.view.state.doc.eq(this.committedDoc);

  /**
   * `sourceRevision` must match the revision the evaluation was computed against, and
   * CM must have already caught up to it, before the result is used for decorations.
   * Otherwise it is held pending and re-checked on every subsequent source update, so
   * a lagging evaluation call never paints over text it wasn't computed for.
   */
  setEvaluation = (evaluation: EvaluationResult, sourceRevision: number) => {
    this.pendingEvaluation = { evaluation, sourceRevision };
    this.tryApplyPendingEvaluation();
  };

  jumpToElement = (elementId: ElementId) => {
    const range = this.statementRanges.get(elementId);
    if (!range) return;
    this.view.dispatch({
      selection: EditorSelection.cursor(range.from),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.uiStore.getState().setSelectedElementId(elementId);
  };

  openTextSearch = () => {
    openSearchPanel(this.view);
  };

  closeTextSearch = () => {
    closeSearchPanel(this.view);
  };

  focusSearch = () => this.view.focus();

  private tryApplyPendingEvaluation() {
    if (this.destroyed || !this.pendingEvaluation) return;
    if (this.pendingEvaluation.sourceRevision !== this.store.getState().sourceRevision) return;
    if (!this.sourceIsApplied()) return;
    this.appliedEvaluation = this.pendingEvaluation.evaluation;
    this.pendingEvaluation = null;
    this.view.dispatch({ effects: evaluationChanged.of(null) });
  }

  private currentPickCandidates() {
    const ui = this.uiStore.getState();
    const evaluation = this.appliedEvaluation;
    if (!evaluation) return [];
    return pickCandidates(this.store.getState().elements, evaluation, {
      activePointPickTarget: ui.activePointPickTarget,
      activeNumericReferencePickTarget: ui.activeNumericReferencePickTarget,
      activeLinePickTarget: ui.activeLinePickTarget
    });
  }

  private runSave() {
    this.flush("save");
    dispatchCommand("saveDocument");
    return true;
  }

  private runPickApply() {
    const ui = this.uiStore.getState();
    const pickTarget = ui.activePointPickTarget ?? ui.activeNumericReferencePickTarget ?? ui.activeLinePickTarget;
    if (!pickTarget) return false;
    const cursorId = ui.activePickCursor?.elementId ?? null;
    if (!cursorId) return false;
    const candidates = this.currentPickCandidates();
    const candidate = candidates.find((item) => item.elementId === cursorId);
    const option = candidate?.options[ui.activePickCursor?.optionIndex ?? 0];
    if (!option) return false;
    if (option.kind === "point") dispatchCommand("applyPickedPoint", { pickedPointAnchor: option.anchor });
    else if (option.kind === "line") dispatchCommand("applyPickedLine", { pickedLineId: option.lineId });
    else if (option.kind === "numericReference" || option.kind === "variableReference") {
      dispatchCommand("applyPickedNumericReference", { numericReferenceExpression: option.expression });
    }
    return true;
  }

  /**
   * Escape never assumes IME composition is intercepted upstream: it checks the
   * controller's own composing flag first. `searchKeymap`'s own Escape binding
   * (registered ahead of this entry) already consumes the key when CM's search panel
   * is open, so this only runs when that panel is closed.
   */
  private runEscape() {
    if (this.protocol.composing) return false;
    if (this.options.isSourceSearchOpen?.()) {
      this.options.closeSourceSearch?.();
      return true;
    }
    const ui = this.uiStore.getState();
    if (ui.activePointPickTarget) {
      dispatchCommand("cancelPointPick");
      return true;
    }
    if (ui.activeNumericReferencePickTarget) {
      dispatchCommand("cancelNumericReferencePick");
      return true;
    }
    if (ui.activeLinePickTarget) {
      dispatchCommand("cancelLinePick");
      return true;
    }
    if (ui.activeTemplateInsertion) {
      dispatchCommand("cancelTemplateInsertion");
      return true;
    }
    this.flush("command");
    this.options.onRequestCanvasFocus?.();
    return true;
  }

  private handleContextMenu(event: MouseEvent, view: EditorView) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const lineFrom = view.state.doc.lineAt(pos).from;
    const elementId = elementIdAtCursor(this.statementRanges, lineFrom);
    if (!elementId || !this.options.onRequestContextMenu) return false;
    event.preventDefault();
    this.options.onRequestContextMenu(elementId, event.clientX, event.clientY);
    return true;
  }

  flush = (reason: FlushReason): SourceEditFlushResult => {
    if (this.destroyed || !this.hasPendingText()) return "clean";
    if (this.protocol.composing) {
      this.flushAfterComposition ||= reason === "blur";
      return "blocked-composition";
    }
    this.cancelCommitTimer();
    const nextText = this.getText();
    const cursorLineAtBurstStart = this.burstStartCursorLine;
    this.burstStartCursorLine = null;
    this.store.getState().commitText(nextText, "editor", { cursorLineAtBurstStart });
    // A no-op source commit does not produce a source revision, but still closes the local burst.
    this.syncCommittedText(this.store.getState().sourceText);
    this.clearCmHistory();
    return "flushed";
  };

  destroy = () => {
    if (this.destroyed) return;
    // IME composition state is tied to a live, focused, attached DOM node: once
    // view.destroy() detaches it, there is no JS-level way to recover the
    // in-progress input. The app-level close guards (unsavedChangesGuard) already
    // refuse to close/unmount while composing, so this path should not be
    // reachable in practice; if it is, fail loudly in dev instead of silently
    // losing the composition.
    if (this.protocol.composing) {
      if (import.meta.env.DEV) {
        console.error(
          "SourceEditorController destroyed while an IME composition was active; " +
            "the in-progress input could not be recovered."
        );
      }
    } else if (this.hasPendingText()) {
      this.cancelCommitTimer();
      const nextText = this.getText();
      const cursorLineAtBurstStart = this.burstStartCursorLine;
      this.store.getState().commitText(nextText, "editor", { cursorLineAtBurstStart });
    }
    this.destroyed = true;
    this.unregisterSession();
    this.unsubscribe();
    this.unsubscribeUi();
    this.view.destroy();
  };

  private handleViewUpdate(update: ViewUpdate) {
    if (this.destroyed) return;
    const isExternal = update.transactions.some((transaction) =>
      transaction.annotation(modelPatchOrigin) || transaction.annotation(resetOrigin)
    );
    if (update.docChanged) {
      this.statementRanges = mapStatementRangeIndex(this.statementRanges, update.changes);
      this.atStopRange = mapAtStopRange(this.atStopRange, update.changes);
      this.staleDiagnosticBaseline = mapPositionedDiagnostics(this.staleDiagnosticBaseline, update.changes);
    }
    if (update.docChanged && !isExternal && !this.protocol.composing) {
      const wasPendingBeforeThisUpdate = !update.startState.doc.eq(this.committedDoc);
      if (!wasPendingBeforeThisUpdate) {
        this.burstStartCursorLine = useCadUiStore.getState().sourceCursorLine;
      }
      if (this.hasPendingText()) this.scheduleCommit();
      else {
        this.burstStartCursorLine = null;
        this.cancelCommitTimer();
        this.clearCmHistory();
      }
    }
    if (update.selectionSet && !this.protocol.composing) {
      this.publishCursorLine();
      const cursorWasProjected = update.transactions.some((transaction) => transaction.annotation(canvasCursorOrigin));
      if (!isExternal && !cursorWasProjected && this.view.state.selection.ranges.length === 1) {
        const elementId = elementIdAtCursor(this.statementRanges, this.view.state.selection.main.head);
        if (elementId && this.uiStore.getState().selectedElementId !== elementId) {
          this.publishingCanvasSelection = true;
          try {
            this.uiStore.getState().setSelectedElementId(elementId);
          } finally {
            this.publishingCanvasSelection = false;
          }
        }
      }
    }
  }

  private runUndo() {
    if (this.protocol.composing) return true;
    if (!this.hasPendingText()) {
      this.store.getState().undo();
      return true;
    }
    const handled = undo(this.view);
    if (!this.hasPendingText()) {
      this.cancelCommitTimer();
      this.clearCmHistory();
    }
    return handled;
  }

  private runRedo() {
    if (this.protocol.composing) return true;
    if (!this.hasPendingText()) {
      this.store.getState().redo();
      return true;
    }
    return redo(this.view);
  }

  private scheduleCommit() {
    this.cancelCommitTimer();
    this.commitTimer = window.setTimeout(() => {
      this.commitTimer = null;
      this.flush("command");
    }, COMMIT_DELAY_MS);
  }

  private cancelCommitTimer() {
    if (this.commitTimer === null) return;
    window.clearTimeout(this.commitTimer);
    this.commitTimer = null;
  }

  private receive(envelope: PendingSourceUpdate) {
    if (this.destroyed) return;
    const result = receiveSourceUpdate(this.protocol, envelope, this.store.getState().sourceRevision);
    this.protocol = result.state;
    this.apply(result.action);
  }

  private drainCompositionQueue() {
    const result = endSourceComposition(this.protocol, this.store.getState().sourceRevision);
    this.protocol = result.state;
    for (const action of result.actions) this.apply(action);
    this.applyPendingUiSync();
  }

  private apply(action: SourceUpdateProtocolAction) {
    if (!action || this.destroyed) return;
    if (action.kind === "consume-editor") {
      this.syncCommittedText(this.store.getState().sourceText);
      this.clearCmHistory();
      this.afterSourceUpdate();
      return;
    }
    if (action.kind === "apply-model-patch") {
      const changes = lineSplicesToSourceTextChanges(this.view.state.doc.toString(), action.update.splices);
      this.view.dispatch({
        changes,
        annotations: [modelPatchOrigin.of("model-patch"), Transaction.addToHistory.of(false)]
      });
      this.syncCommittedText(this.store.getState().sourceText);
      this.clearCmHistory();
      this.afterSourceUpdate();
      return;
    }
    if (action.reason === "gap" || action.text === undefined) {
      const current = this.store.getState();
      this.reset(current.sourceText);
      this.protocol = createSourceUpdateProtocol(current.sourceRevision);
      this.afterSourceUpdate();
      return;
    }
    this.reset(action.text);
    this.afterSourceUpdate();
  }

  private reset(sourceText: string) {
    this.cancelCommitTimer();
    this.burstStartCursorLine = null;
    this.syncCommittedText(sourceText);
    // Clear before the doc-replace transaction dispatches, so no intermediate frame
    // shows the previous document's evaluation decorations over the new text.
    this.pendingEvaluation = null;
    this.appliedEvaluation = null;
    const cursorLine = useCadUiStore.getState().sourceCursorLine;
    const cursorOffset = cursorLine === null
      ? null
      : this.cursorOffsetForLine(this.committedLogicalText, cursorLine);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: this.committedLogicalText },
      ...(cursorOffset === null ? {} : { selection: EditorSelection.cursor(cursorOffset) }),
      effects: [evaluationChanged.of(null)],
      annotations: [resetOrigin.of("reset"), Transaction.addToHistory.of(false)]
    });
    this.clearCmHistory();
  }

  /**
   * A UI projection is allowed only after the matching source revision is in the CM document and
   * its fresh (or safely mapped) ranges have been selected. This is the ordering gate for Canvas
   * selection and fold changes that arrive during source updates.
   */
  private afterSourceUpdate() {
    this.refreshStatementRanges();
    this.pendingSelectionSync = true;
    this.pendingFoldProjection = true;
    this.applyPendingUiSync();
    this.tryApplyPendingEvaluation();
    // Diagnostics may need to switch between the dirty layered view and the clean
    // store-diagnostics view even when this update carried no CM doc change (e.g. a
    // no-op text commit that only cleared history).
    forceLinting(this.view);
  }

  private refreshStatementRanges() {
    const state = this.store.getState();
    if (state.docText !== state.sourceText) return;
    this.statementRanges = createStatementRangeIndex(this.view.state.doc, state.doc.statementMap);
    this.atStopRange = createAtStopRange(this.view.state.doc, state.doc.statementMap);
    this.staleDiagnosticBaseline = toStaleDiagnostics(this.view.state.doc, state.diagnostics);
  }

  private sourceIsApplied() {
    return this.protocol.appliedRevision === this.store.getState().sourceRevision;
  }

  private applyPendingUiSync() {
    if (
      this.destroyed ||
      this.protocol.composing ||
      !this.sourceIsApplied() ||
      this.applyingUiSync ||
      (!this.pendingSelectionSync && !this.pendingFoldProjection)
    ) return;

    this.applyingUiSync = true;
    try {
      if (this.pendingSelectionSync) {
        this.pendingSelectionSync = false;
        this.expandSelectionAncestors();
        this.updateSecondarySelection();
        this.projectPrimaryCursor();
      }
      if (this.pendingFoldProjection) {
        this.pendingFoldProjection = false;
        this.projectFolds();
      }
    } finally {
      this.applyingUiSync = false;
    }
    // Expanding ancestors writes groupFoldById synchronously. Apply the single latest request only
    // after that write has completed, never against the preceding CM revision.
    if ((this.pendingSelectionSync || this.pendingFoldProjection) && this.sourceIsApplied()) {
      this.applyPendingUiSync();
    }
  }

  private updateSecondarySelection() {
    const ui = this.uiStore.getState();
    this.view.dispatch({
      effects: secondarySelectionEffect(ui.selectedElementIds, ui.selectedElementId, this.statementRanges),
      annotations: Transaction.addToHistory.of(false)
    });
  }

  private projectPrimaryCursor() {
    if (this.publishingCanvasSelection) return;
    const primaryId = this.uiStore.getState().selectedElementId;
    const range = primaryId ? this.statementRanges.get(primaryId) : undefined;
    if (!range || this.view.state.selection.main.head === range.from) return;
    this.view.dispatch({
      selection: EditorSelection.cursor(range.from),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
  }

  private expandSelectionAncestors() {
    const selectedId = this.uiStore.getState().selectedElementId;
    if (!selectedId) return;
    const elements = this.store.getState().elements;
    const byId = new Map(elements.map((element) => [element.id, element]));
    let current = byId.get(selectedId);
    while (current?.parentGroupId) {
      const parent = byId.get(current.parentGroupId);
      if (!parent) break;
      const fold = this.uiStore.getState().groupFoldById.get(parent.id);
      const needsGroupExpand = !(fold?.expanded ?? false);
      const needsElseExpand = current.conditionalBranch === "else" && !(fold?.elseExpanded ?? true);
      if (needsGroupExpand || needsElseExpand) {
        this.uiStore.getState().setGroupFold(parent.id, {
          ...(needsGroupExpand ? { expanded: true } : {}),
          ...(needsElseExpand ? { elseExpanded: true } : {})
        });
      }
      current = parent;
    }
  }

  private projectFolds() {
    const state = this.store.getState();
    const desired = foldTargets(this.statementRanges, state.elements, this.uiStore.getState().groupFoldById)
      .sort((left, right) => left.from - right.from || right.to - left.to);
    const projection = foldProjectionTransaction(this.view.state, desired);
    if (!projection) return;
    this.view.dispatch({
      ...projection,
      annotations: [foldProjectionOrigin.of("fold-projection"), Transaction.addToHistory.of(false)]
    });
  }

  private handleSelectionGutterMouseDown(lineFrom: number, event: MouseEvent) {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return false;
    const elementId = elementIdAtCursor(this.statementRanges, lineFrom);
    if (!elementId) return false;
    event.preventDefault();
    dispatchCommand("selectElement", {
      elementId,
      selectionMode: event.metaKey || event.ctrlKey ? "toggle" : "range"
    });
    return true;
  }

  private handleFoldGutterMouseDown(lineFrom: number, event: MouseEvent) {
    const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineFrom);
    if (!target) return false;
    event.preventDefault();
    return this.changeFold(target, "toggle");
  }

  private changeFoldAtCursor(mode: "fold" | "unfold") {
    const lineFrom = this.view.state.doc.lineAt(this.view.state.selection.main.head).from;
    const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineFrom);
    return target ? this.changeFold(target, mode) : false;
  }

  private changeFold(target: { elementId: string; branch: "group" | "else" }, mode: "fold" | "unfold" | "toggle") {
    if (this.protocol.composing) return true;
    const fold = this.uiStore.getState().groupFoldById.get(target.elementId);
    const currentExpanded = target.branch === "group" ? (fold?.expanded ?? false) : (fold?.elseExpanded ?? true);
    const expanded = mode === "toggle" ? !currentExpanded : mode === "unfold";
    this.uiStore.getState().setGroupFold(target.elementId, target.branch === "group"
      ? { expanded }
      : { elseExpanded: expanded });
    return true;
  }

  private changeAllFolds(expanded: boolean) {
    if (this.protocol.composing) return true;
    for (const element of this.store.getState().elements) {
      if (!this.statementRanges.get(element.id)?.groupFoldRange) continue;
      this.uiStore.getState().setGroupFold(element.id, { expanded, ...(expanded ? { elseExpanded: true } : {}) });
    }
    return true;
  }

  private syncCommittedText(sourceText: string) {
    this.format = sourceTextFormat(sourceText);
    this.committedLogicalText = normalizeSourceTextForEditor(sourceText);
    this.committedDoc = Text.of(this.committedLogicalText.split("\n"));
  }

  private publishCursorLine() {
    const line = this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
    useCadUiStore.getState().setSourceCursorLine(line);
  }

  private cursorOffsetForLine(text: string, requestedLine: number) {
    const lines = text.split("\n");
    const lineIndex = Math.min(Math.max(requestedLine, 1), lines.length) - 1;
    let offset = 0;
    for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1;
    return offset;
  }

  private clearCmHistory() {
    this.view.dispatch({
      effects: this.historyCompartment.reconfigure([]),
      annotations: Transaction.addToHistory.of(false)
    });
    this.view.dispatch({
      effects: this.historyCompartment.reconfigure(history()),
      annotations: Transaction.addToHistory.of(false)
    });
    if (import.meta.env.DEV && (undoDepth(this.view.state) !== 0 || redoDepth(this.view.state) !== 0)) {
      throw new Error("CodeMirror history clear failed.");
    }
  }
}
