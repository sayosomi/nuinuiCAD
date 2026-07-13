import { codeFolding, foldGutter, foldService } from "@codemirror/language";
import { openSearchPanel, closeSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Text,
  Transaction
} from "@codemirror/state";
import { defaultKeymap, history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type KeyBinding,
  type ViewUpdate
} from "@codemirror/view";
import { forceLinting } from "@codemirror/lint";
import { dispatchCommand } from "../commands/commands";
import { bindingMatchesEvent, sourceEditorShortcutBindings } from "../keyboard/shortcutRegistry";
import type { KeyChord } from "../keyboard/shortcutTypes";
import { pickCandidates } from "../model/pickCandidates";
import type { ElementId, EvaluationResult } from "../types/geometry";
import { useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
import { useCadUiStore, type CadUiState } from "../state/cadUiStore";
import { dslCmLanguageExtension } from "./cmLanguage";
import { focusSourceEditorLineLens, reconfigureSourceEditorLineLensKeymap, sourceEditorLineLens } from "./sourceEditorLineLens";
import {
  captureSourceEditorViewport,
  cursorAtSnapshotLocation,
  restoreSourceEditorViewport,
  selectionAfterModelPatch,
  type SourceEditorViewportSnapshot
} from "./sourceEditorViewportStability";
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
import type { SourceEditorControllerOptions, SourceEditorHandle, SourceEvaluationPublication, SourceTextFormat } from "./sourceEditorTypes";
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
import { patchHighlightPayloadForChanges, setPatchHighlight, sourceEditorPatchHighlightExtension } from "./sourceEditorPatchHighlight";
import { createDiagnosticsExtension } from "./sourceEditorDiagnosticsExtension";
import { mapPositionedDiagnostics, toStaleDiagnostics, type PositionedDiagnostic } from "./sourceEditorDiagnostics";
import { createEvaluationExtension, evaluationChanged, type EvaluationGutterAction } from "./sourceEditorEvaluationExtension";
import { createEvaluationDecorationIndex, type EvaluationDecorationIndex } from "./sourceEditorEvaluationIndex";
import { adjacentDslValueSpan, dslLineValueSpans, findDslValueSpanAt, type DslValueSpanDirection } from "../dsl/dslValueSpans";
import { resolveParameterValueSpan } from "../dsl/dslParameterSpans";
import { resolveDslValueStep, type DslValueStepDirection } from "../dsl/dslValueStep";
import {
  sameValueStepGesture,
  valueStepDirectionForCommand,
  valueStepGestureEndsOnKeyup,
  valueStepGestureForKeyboardEvent,
  type SourceEditorValueStepGesture
} from "./sourceEditorValueStepGesture";

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
const emptyDecorationIndex = (): EvaluationDecorationIndex => ({
  statuses: [],
  statusByLineFrom: new Map(),
  generatedWidgets: [],
  pickLines: []
});

const codeMirrorKeyForChord = (chord: KeyChord): string | null => {
  if (chord.mod === "any" || chord.alt === "any" || chord.shift === "any") return null;
  const prefixes = [
    ...(chord.mod ? ["Mod"] : []),
    ...(chord.alt ? ["Alt"] : []),
    ...(chord.shift ? ["Shift"] : [])
  ];
  const key = chord.key === " " ? "Space" : chord.key;
  return [...prefixes, key].join("-");
};

export class SourceEditorController implements SourceEditorHandle {
  private readonly store: SourceStore;
  private readonly unsubscribe: () => void;
  private readonly uiStore: UiStore;
  private readonly unsubscribeUi: () => void;
  private readonly unregisterSession: () => void;
  private readonly historyCompartment = new Compartment();
  private readonly sourceEditorShortcutCompartment = new Compartment();
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
  /** At most two newest compiled-document revisions are retained; older results can never become current. */
  private pendingEvaluations = new Map<number, { evaluation: EvaluationResult; evaluationRequestRevision: number }>();
  private appliedEvaluation: { evaluation: EvaluationResult; compiledDocumentRevision: number; evaluationRequestRevision: number } | null = null;
  private decorationIndex: EvaluationDecorationIndex = emptyDecorationIndex();
  private pendingDecorationRefresh = false;
  private pendingSelectionSync = false;
  private pendingPrimaryCursorProjection = false;
  private deferredExternalCursor: SourceEditorViewportSnapshot | null = null;
  private pendingFoldProjection = false;
  private applyingUiSync = false;
  private publishingCanvasSelection = false;
  private lineLensFocused = false;
  /** A physical registry shortcut held down across browser key-repeat events. */
  private activeValueStepGesture: SourceEditorValueStepGesture | null = null;
  /** Set by the DOM observer, then consumed by the registry keymap's command dispatch. */
  private pendingKeyboardValueStep: SourceEditorValueStepGesture | null = null;
  private pendingMainLensFocus: { lineFrom: number; clientX: number; clientY: number } | null = null;
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
          highlightActiveLine(),
          highlightActiveLineGutter(),
          dslCmLanguageExtension,
          sourceEditorLineLens({
            sourceKeymap: () => this.lineLensKeymap(),
            onFocusChange: (focused) => {
              this.lineLensFocused = focused;
            },
            onKeydown: (event, view) => this.observeValueStepKeydown(event, view),
            onKeyup: (event) => this.observeValueStepKeyup(event),
            onCompositionStart: () => this.beginComposition(),
            onCompositionEnd: () => this.endComposition(),
            onBlur: () => this.flush("blur")
          }),
          sourceEditorSelectionExtension,
          sourceEditorPatchHighlightExtension,
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
            index: () => this.decorationIndex,
            atStopRange: () => this.atStopRange,
            pickCursorElementId: () => this.uiStore.getState().activePickCursor?.elementId ?? null,
            isLastGood: () => this.isShowingLastGoodEvaluation(),
            onGutterAction: (action, lineFrom) => this.handleEvaluationGutterAction(action, lineFrom)
          }),
          search(),
          this.historyCompartment.of(history()),
          this.sourceEditorShortcutCompartment.of(keymap.of(this.sourceEditorShortcutKeymap())),
          keymap.of([
            { key: "Mod-z", run: () => this.runUndo() },
            { key: "Mod-y", run: () => this.runRedo() },
            { key: "Mod-Shift-z", run: () => this.runRedo() },
            { key: "Mod-s", run: () => this.runSave() },
            { key: "Enter", run: () => this.runPickApply() },
            { key: "ArrowDown", run: () => this.runPickNavigation("selectNextPickCandidate") },
            { key: "ArrowUp", run: () => this.runPickNavigation("selectPreviousPickCandidate") },
            { key: "ArrowRight", run: () => this.runPickNavigation("selectNextPickOption") },
            { key: "ArrowLeft", run: () => this.runPickNavigation("selectPreviousPickOption") },
            { key: "Ctrl-Shift-[", mac: "Mod-Alt-[", run: () => this.changeFoldAtCursor("fold") },
            { key: "Ctrl-Shift-]", mac: "Mod-Alt-]", run: () => this.changeFoldAtCursor("unfold") },
            { key: "Ctrl-Alt-[", run: () => this.changeAllFolds(false) },
            { key: "Ctrl-Alt-]", run: () => this.changeAllFolds(true) },
            ...searchKeymap,
            { key: "Escape", run: () => this.runEscape() },
            { key: "Tab", run: () => this.navigateValueSpan("next") },
            { key: "Shift-Tab", run: () => this.navigateValueSpan("previous") },
            ...defaultKeymap
          ] satisfies KeyBinding[]),
          EditorView.domEventHandlers({
            mousedown: (event, view) => this.handleMainEditorMouseDown(event as MouseEvent, view),
            contextmenu: (event, view) => this.handleContextMenu(event as MouseEvent, view),
            mouseup: (event, view) => this.handleValueClick(event as MouseEvent, view)
          }),
          EditorView.domEventObservers({
            keydown: (event, view) => this.observeValueStepKeydown(event as KeyboardEvent, view),
            keyup: (event) => this.observeValueStepKeyup(event as KeyboardEvent)
          }),
          EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
          EditorView.domEventHandlers({
            compositionstart: () => {
              this.beginComposition();
              return false;
            },
            compositionend: () => {
              this.endComposition();
              return false;
            },
            blur: () => {
              this.flush("blur");
              return false;
            },
            focus: () => {
              this.restoreDeferredExternalCursor();
              return false;
            }
          })
        ]
      })
    });
    this.unregisterSession = registerSourceEditSession({
      hasPendingText: () => this.hasPendingText(),
      isComposing: () => this.protocol.composing,
      flush: (reason) => this.flush(reason),
      stepValue: (direction) => this.stepSourceValue(direction)
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
      const primarySelectionChanged = next.selectedElementId !== previous.selectedElementId;
      const selectionChanged = primarySelectionChanged || next.selectedElementIds !== previous.selectedElementIds;
      const foldChanged = next.groupFoldById !== previous.groupFoldById;
      const decorationChanged = foldChanged ||
        next.activePickCursor !== previous.activePickCursor ||
        next.activePointPickTarget !== previous.activePointPickTarget ||
        next.activeNumericReferencePickTarget !== previous.activeNumericReferencePickTarget ||
        next.activeLinePickTarget !== previous.activeLinePickTarget;
      if (selectionChanged) {
        this.pendingSelectionSync = true;
        // Canvas selection should move the source cursor once. A model patch for
        // the already-selected element must only refresh decorations, otherwise
        // its scrollIntoView call visibly snaps the editor on every drag update.
        this.pendingPrimaryCursorProjection ||= primarySelectionChanged && !this.publishingCanvasSelection;
      }
      if (foldChanged) this.pendingFoldProjection = true;
      if (next.shortcutSettings !== previous.shortcutSettings) {
        this.view.dispatch({
          effects: [
            this.sourceEditorShortcutCompartment.reconfigure(keymap.of(this.sourceEditorShortcutKeymap())),
            reconfigureSourceEditorLineLensKeymap.of(this.lineLensKeymap())
          ],
          annotations: Transaction.addToHistory.of(false)
        });
      }
      if (decorationChanged) this.requestDecorationRefresh();
      this.applyPendingUiSync();
    });
    this.refreshStatementRanges();
    this.refreshDecorationIndex();
    this.pendingSelectionSync = true;
    this.pendingPrimaryCursorProjection = true;
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

  /** Results are keyed by the compiled document revision captured at request start.
   * Keep at most the two newest future revisions; lower revisions are permanently stale. */
  setEvaluation = (publication: SourceEvaluationPublication) => {
    const current = this.store.getState().compiledDocumentRevision;
    if (publication.compiledDocumentRevision < current) return;
    if (this.appliedEvaluation?.compiledDocumentRevision === publication.compiledDocumentRevision &&
      this.appliedEvaluation.evaluationRequestRevision >= publication.evaluationRequestRevision) return;
    const pending = this.pendingEvaluations.get(publication.compiledDocumentRevision);
    if (pending && pending.evaluationRequestRevision >= publication.evaluationRequestRevision) return;
    this.pendingEvaluations.set(publication.compiledDocumentRevision, {
      evaluation: publication.evaluation,
      evaluationRequestRevision: publication.evaluationRequestRevision
    });
    for (const revision of [...this.pendingEvaluations.keys()].sort((left, right) => left - right)) {
      if (revision < current || this.pendingEvaluations.size > 2) this.pendingEvaluations.delete(revision);
    }
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

  jumpToParameterValue = (elementId: ElementId, parameterKey: string): boolean => {
    if (this.protocol.composing) return false;
    const range = this.statementRanges.get(elementId);
    const element = this.store.getState().elements.find((candidate) => candidate.id === elementId);
    if (!range || !element) return false;
    const line = this.view.state.doc.lineAt(range.from);
    const committedLineText = range.statement.line <= this.committedDoc.lines
      ? this.committedDoc.line(range.statement.line).text
      : undefined;
    const target = resolveParameterValueSpan(line.text, element, parameterKey, { committedLineText });
    if (!target) {
      this.jumpToElement(elementId);
      this.view.focus();
      return false;
    }
    // Store selection subscriptions project Canvas selection to line starts. Publish
    // this external selection under the existing loop guard before selecting the span.
    this.deferredExternalCursor = null;
    this.pendingPrimaryCursorProjection = false;
    this.publishingCanvasSelection = true;
    try {
      this.uiStore.getState().setSelectedElementId(elementId);
    } finally {
      this.publishingCanvasSelection = false;
    }
    this.view.dispatch({
      selection: EditorSelection.single(line.from + target.start, line.from + target.end),
      scrollIntoView: true,
      effects: focusSourceEditorLineLens.of({
        lineFrom: line.from,
        sourceAnchor: target.start,
        sourceHead: target.end
      }),
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.view.focus();
    return true;
  };

  /** Changes one proven value in the live source line. Keyboard repeats commit on keyup. */
  private stepSourceValue(direction: DslValueStepDirection) {
    if (this.protocol.composing) return false;
    const ui = this.uiStore.getState();
    if (ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget || ui.activeTemplateInsertion) return false;
    const selection = this.view.state.selection;
    if (selection.ranges.length !== 1) return false;
    const main = selection.main;
    const line = this.view.state.doc.lineAt(main.from);
    if (this.view.state.doc.lineAt(main.to).number !== line.number) return false;
    const elementId = elementIdAtCursor(this.statementRanges, main.from);
    const range = elementId ? this.statementRanges.get(elementId) : null;
    const element = elementId
      ? this.store.getState().elements.find((candidate) => candidate.id === elementId)
      : undefined;
    if (!range || !element) return false;
    const committedLineText = range.statement.line <= this.committedDoc.lines
      ? this.committedDoc.line(range.statement.line).text
      : undefined;
    const change = resolveDslValueStep(
      line.text,
      element,
      { start: main.from - line.from, end: main.to - line.from },
      direction,
      { committedLineText }
    );
    if (!change) {
      if (this.activeValueStepGesture) this.flush("command");
      return false;
    }
    this.view.dispatch({
      changes: { from: line.from + change.from, to: line.from + change.to, insert: change.insert },
      selection: EditorSelection.single(line.from + change.selection.start, line.from + change.selection.end),
      annotations: Transaction.userEvent.of("input.stepValue")
    });
    const keyboardGesture = this.pendingKeyboardValueStep;
    this.pendingKeyboardValueStep = null;
    if (keyboardGesture && keyboardGesture.direction === direction && this.activeValueStepGesture) {
      this.cancelCommitTimer();
      // The store history remains untouched until keyup, while effectiveElements
      // still receives this valid projection so Canvas and evaluation keep pace.
      this.store.getState().setSourceEditorPreviewText(this.getText());
      return true;
    }
    return this.flush("command") !== "blocked-composition";
  }

  private observeValueStepKeydown(event: KeyboardEvent, view: EditorView) {
    if (this.destroyed || this.protocol.composing || view.compositionStarted) return;
    const ui = this.uiStore.getState();
    if (ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget || ui.activeTemplateInsertion) return;
    const binding = sourceEditorShortcutBindings(ui.shortcutSettings).find((candidate) => {
      const direction = valueStepDirectionForCommand(candidate.commandId);
      return direction !== null && bindingMatchesEvent(candidate, event) &&
        candidate.chords.some((chord) => codeMirrorKeyForChord(chord) !== null);
    });
    if (!binding) {
      if (!event.repeat && this.activeValueStepGesture) this.flush("command");
      return;
    }
    const direction = valueStepDirectionForCommand(binding.commandId);
    if (!direction) return;
    const candidate = valueStepGestureForKeyboardEvent(direction, event);
    if (this.activeValueStepGesture &&
      (!event.repeat || !sameValueStepGesture(this.activeValueStepGesture, candidate))) {
      this.flush("command");
    }
    this.activeValueStepGesture = candidate;
    this.pendingKeyboardValueStep = candidate;
    this.cancelCommitTimer();
  }

  private observeValueStepKeyup(event: KeyboardEvent) {
    const gesture = this.activeValueStepGesture;
    if (!gesture || !valueStepGestureEndsOnKeyup(gesture, event)) return;
    this.pendingKeyboardValueStep = null;
    this.flush("command");
  }

  private beginComposition() {
    if (this.activeValueStepGesture) this.flush("command");
    this.protocol = beginSourceComposition(this.protocol);
  }

  private endComposition() {
    this.drainCompositionQueue();
    this.publishCursorLine();
    if (this.flushAfterComposition) {
      this.flushAfterComposition = false;
      this.flush("blur");
    } else if (this.hasPendingText()) {
      this.scheduleCommit();
    }
  }

  pickCandidateElementIds = () => this.decorationIndex.pickLines.map((line) => line.elementId);

  applyPickCandidate = (elementId: ElementId) => {
    if (this.protocol.composing || this.flush("command") === "blocked-composition") return false;
    const candidate = this.currentPickCandidates().find((item) => item.elementId === elementId);
    if (!candidate) return false;
    this.uiStore.getState().setActivePickCursor({ elementId: candidate.elementId, optionIndex: 0 });
    return dispatchCommand("applySelectedPickCandidate") !== false;
  };

  openTextSearch = () => {
    openSearchPanel(this.view);
  };

  closeTextSearch = () => {
    closeSearchPanel(this.view);
  };

  focusSearch = () => this.view.focus();

  private tryApplyPendingEvaluation() {
    if (this.destroyed) return;
    const state = this.store.getState();
    const pending = this.pendingEvaluations.get(state.compiledDocumentRevision);
    if (!pending) return;
    if (!this.sourceIsApplied()) return;
    if (this.appliedEvaluation?.compiledDocumentRevision === state.compiledDocumentRevision &&
      this.appliedEvaluation.evaluationRequestRevision >= pending.evaluationRequestRevision) return;
    this.appliedEvaluation = {
      evaluation: pending.evaluation,
      compiledDocumentRevision: state.compiledDocumentRevision,
      evaluationRequestRevision: pending.evaluationRequestRevision
    };
    this.pendingEvaluations.delete(state.compiledDocumentRevision);
    this.options.onEvaluationPresentationChange?.({ isLastGood: this.isShowingLastGoodEvaluation() });
    this.refreshDecorationIndex();
  }

  private currentPickCandidates() {
    const ui = this.uiStore.getState();
    const evaluation = this.appliedEvaluation?.evaluation;
    if (!evaluation) return [];
    return pickCandidates(this.store.getState().elements, evaluation, {
      activePointPickTarget: ui.activePointPickTarget,
      activeNumericReferencePickTarget: ui.activeNumericReferencePickTarget,
      activeLinePickTarget: ui.activeLinePickTarget
    });
  }

  private runSave() {
    if (this.flush("save") === "blocked-composition") return true;
    dispatchCommand("saveDocument");
    return true;
  }

  private runPickApply() {
    if (this.protocol.composing || this.flush("command") === "blocked-composition") return true;
    const ui = this.uiStore.getState();
    if (!(ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget)) return false;
    const cursor = ui.activePickCursor;
    if (!cursor || !this.currentPickCandidates().some((candidate) => candidate.elementId === cursor.elementId)) return false;
    return dispatchCommand("applySelectedPickCandidate") !== false;
  }

  private runPickNavigation(commandId: "selectNextPickCandidate" | "selectPreviousPickCandidate" | "selectNextPickOption" | "selectPreviousPickOption") {
    if (this.protocol.composing) return true;
    const ui = this.uiStore.getState();
    if (!(ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget)) return false;
    dispatchCommand(commandId);
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
    const ui = this.uiStore.getState();
    if (this.protocol.composing || ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const lineFrom = view.state.doc.lineAt(pos).from;
    if (this.flush("command") === "blocked-composition") return true;
    const elementId = elementIdAtCursor(this.statementRanges, lineFrom);
    if (!elementId || !this.store.getState().elements.some((element) => element.id === elementId) || !this.options.onRequestContextMenu) return false;
    event.preventDefault();
    if (this.uiStore.getState().selectedElementId !== elementId) {
      if (dispatchCommand("selectElement", { elementId }) === false) return true;
      if (!this.store.getState().elements.some((element) => element.id === elementId)) return true;
    }
    this.options.onRequestContextMenu(elementId, event.clientX, event.clientY);
    return true;
  }

  private handleMainEditorMouseDown(event: MouseEvent, view: EditorView) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || this.protocol.composing) return false;
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) return false;
    this.pendingMainLensFocus = {
      lineFrom: view.state.doc.lineAt(position).from,
      clientX: event.clientX,
      clientY: event.clientY
    };
    view.contentDOM.ownerDocument.removeEventListener("mouseup", this.handlePendingMainLensFocus);
    view.contentDOM.ownerDocument.addEventListener("mouseup", this.handlePendingMainLensFocus, { once: true });
    return false;
  }

  private handlePendingMainLensFocus = (event: MouseEvent) => {
    const pending = this.pendingMainLensFocus;
    this.pendingMainLensFocus = null;
    if (!pending || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (Math.max(Math.abs(event.clientX - pending.clientX), Math.abs(event.clientY - pending.clientY)) >= 10) return;
    queueMicrotask(() => {
      if (this.destroyed || this.protocol.composing) return;
      const selection = this.view.state.selection;
      if (selection.ranges.length !== 1) return;
      const firstLine = this.view.state.doc.lineAt(selection.main.from);
      const lastLine = this.view.state.doc.lineAt(selection.main.to);
      if (firstLine.from !== pending.lineFrom || lastLine.from !== pending.lineFrom) return;
      this.view.dispatch({
        effects: focusSourceEditorLineLens.of({
          lineFrom: firstLine.from,
          sourceAnchor: selection.main.anchor - firstLine.from,
          sourceHead: selection.main.head - firstLine.from
        }),
        annotations: Transaction.addToHistory.of(false)
      });
    });
  };

  /**
   * Selects the whole editable value under a plain click that ended without a drag.
   * Runs on `mouseup` so CodeMirror's own pointer handling (drag-select, Mod-click
   * multi-selection) has already resolved `view.state.selection`; this only acts when
   * that outcome is a single collapsed cursor with no modifier keys held, otherwise it
   * defers entirely. Re-derives spans from the live buffer's line text on every call
   * (via dslLineValueSpans), so it is correct while dirty or while the document is
   * fatal without needing any statement-range mapping of its own.
   */
  private handleValueClick(event: MouseEvent, view: EditorView) {
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (this.protocol.composing) return false;
    const selection = view.state.selection;
    if (selection.ranges.length !== 1 || !selection.main.empty) return false;
    const pos = selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const span = findDslValueSpanAt(dslLineValueSpans(line.text), pos - line.from);
    if (!span) return false;
    view.dispatch({
      selection: EditorSelection.single(line.from + span.start, line.from + span.end),
      annotations: Transaction.addToHistory.of(false)
    });
    return true;
  }

  /**
   * Tab/Shift-Tab cycles the selection between editable value spans within the current
   * statement (always one line — see dslParser.ts). Reuses dslLineValueSpans/
   * adjacentDslValueSpan, the exact same span source handleValueClick uses, so click and
   * Tab always agree on what's a value and what isn't. During IME composition the key is
   * fully consumed (no value-jump, no fallthrough to defaultKeymap's indentMore/indentLess
   * either, since letting that mutate the document mid-composition is unsafe); when there
   * are no spans or the selection crosses lines, this falls through so Tab keeps its
   * ordinary indent behavior.
   */
  private navigateValueSpan(direction: DslValueSpanDirection): boolean {
    if (this.protocol.composing) return true;
    const main = this.view.state.selection.main;
    const lineFrom = this.view.state.doc.lineAt(main.from);
    if (this.view.state.doc.lineAt(main.to).number !== lineFrom.number) return false;
    const spans = dslLineValueSpans(lineFrom.text);
    if (spans.length === 0) return false;
    const target = adjacentDslValueSpan(spans, main.from - lineFrom.from, direction);
    if (!target) return false;
    this.view.dispatch({
      selection: EditorSelection.single(lineFrom.from + target.start, lineFrom.from + target.end),
      annotations: Transaction.addToHistory.of(false)
    });
    return true;
  }

  /**
   * Line Lens counterpart of navigateValueSpan: the lens's own document is already
   * exactly the projected line's text at offset 0, so no line.from translation is
   * needed, and a selection-only dispatch on `view` (the lens's EditorView, passed in by
   * CodeMirror since this keymap entry lives inside the lens's own extensions) is picked
   * up by the lens's existing handleLensUpdate and projected outward to the main editor
   * automatically. `view.compositionStarted` is CodeMirror's own per-view IME flag: the
   * outer controller's `this.protocol.composing` is driven by compositionstart/end on the
   * main editor's contentDOM only, a separate DOM subtree from the lens's, so it would
   * never reflect composition happening inside the lens.
   */
  private navigateLensValueSpan(view: EditorView, direction: DslValueSpanDirection): boolean {
    if (view.compositionStarted) return true;
    if (view.state.doc.lines > 1) return false;
    const spans = dslLineValueSpans(view.state.doc.toString());
    if (spans.length === 0) return false;
    const target = adjacentDslValueSpan(spans, view.state.selection.main.from, direction);
    if (!target) return false;
    view.dispatch({
      selection: EditorSelection.single(target.start, target.end),
      annotations: Transaction.addToHistory.of(false)
    });
    return true;
  }

  flush = (reason: FlushReason): SourceEditFlushResult => {
    if (this.destroyed) return "clean";
    this.activeValueStepGesture = null;
    this.pendingKeyboardValueStep = null;
    if (!this.hasPendingText()) {
      this.store.getState().setSourceEditorPreviewText(null);
      return "clean";
    }
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
    this.view.contentDOM.ownerDocument.removeEventListener("mouseup", this.handlePendingMainLensFocus);
    this.unregisterSession();
    this.unsubscribe();
    this.unsubscribeUi();
    this.view.destroy();
  };

  /**
   * Structural editor commands come from the shared shortcut registry rather
   * than a second handwritten key list. They deliberately yield to IME and
   * pick navigation, while normal text keys remain CodeMirror's responsibility.
   */
  private sourceEditorShortcutKeymap(): KeyBinding[] {
    return sourceEditorShortcutBindings(this.uiStore.getState().shortcutSettings).flatMap((binding) =>
      binding.chords.flatMap((chord) => {
        const key = codeMirrorKeyForChord(chord);
        if (!key) return [];
        return [{
          key,
          run: (view) => {
            if (this.protocol.composing || view.compositionStarted) return true;
            const ui = this.uiStore.getState();
            if (ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget) return false;
            return dispatchCommand(binding.commandId) !== false;
          }
        } satisfies KeyBinding];
      })
    );
  }

  /** The line lens owns text input, but editor-wide commands must keep acting
   * on the primary document and its history. */
  private lineLensKeymap(): KeyBinding[] {
    return [
      { key: "Mod-z", run: () => this.runUndo() },
      { key: "Mod-y", run: () => this.runRedo() },
      { key: "Mod-Shift-z", run: () => this.runRedo() },
      { key: "Mod-s", run: () => this.runSave() },
      { key: "Mod-f", run: () => {
        openSearchPanel(this.view);
        return true;
      } },
      { key: "Enter", run: () => this.runPickApply() },
      { key: "ArrowDown", run: () => this.runPickNavigation("selectNextPickCandidate") },
      { key: "ArrowUp", run: () => this.runPickNavigation("selectPreviousPickCandidate") },
      { key: "ArrowRight", run: () => this.runPickNavigation("selectNextPickOption") },
      { key: "ArrowLeft", run: () => this.runPickNavigation("selectPreviousPickOption") },
      { key: "Ctrl-Shift-[", mac: "Mod-Alt-[", run: () => this.changeFoldAtCursor("fold") },
      { key: "Ctrl-Shift-]", mac: "Mod-Alt-]", run: () => this.changeFoldAtCursor("unfold") },
      { key: "Ctrl-Alt-[", run: () => this.changeAllFolds(false) },
      { key: "Ctrl-Alt-]", run: () => this.changeAllFolds(true) },
      { key: "Escape", run: () => this.runEscape() },
      { key: "Tab", run: (view) => this.navigateLensValueSpan(view, "next") },
      { key: "Shift-Tab", run: (view) => this.navigateLensValueSpan(view, "previous") },
      ...this.sourceEditorShortcutKeymap()
    ];
  }

  private handleViewUpdate(update: ViewUpdate) {
    if (this.destroyed) return;
    const isExternal = update.transactions.some((transaction) =>
      transaction.annotation(modelPatchOrigin) || transaction.annotation(resetOrigin)
    );
    if (update.docChanged) {
      this.statementRanges = mapStatementRangeIndex(this.statementRanges, update.changes);
      this.atStopRange = mapAtStopRange(this.atStopRange, update.changes);
      this.staleDiagnosticBaseline = mapPositionedDiagnostics(this.staleDiagnosticBaseline, update.changes);
      this.requestDecorationRefresh();
    }
    if (update.docChanged && !isExternal && !this.protocol.composing) {
      const wasPendingBeforeThisUpdate = !update.startState.doc.eq(this.committedDoc);
      if (!wasPendingBeforeThisUpdate) {
        this.burstStartCursorLine = useCadUiStore.getState().sourceCursorLine;
      }
      if (this.hasPendingText() && this.activeValueStepGesture) this.cancelCommitTimer();
      else if (this.hasPendingText()) this.scheduleCommit();
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
    if (this.activeValueStepGesture) this.flush("command");
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
    if (this.activeValueStepGesture) this.flush("command");
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
    if (this.pendingDecorationRefresh) {
      this.pendingDecorationRefresh = false;
      this.refreshDecorationIndex();
    }
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
      const changeSet = this.view.state.changes(changes);
      const viewport = captureSourceEditorViewport(
        this.view,
        this.uiStore.getState().selectedElementId,
        this.hasSourceFocus()
      );
      const mappedSelection = viewport.hadFocus
        ? selectionAfterModelPatch(this.view, changeSet)
        : null;
      this.view.dispatch({
        changes,
        ...(mappedSelection ? { selection: mappedSelection } : {}),
        effects: [setPatchHighlight.of(patchHighlightPayloadForChanges(this.view.state.doc, changeSet))],
        annotations: [modelPatchOrigin.of("model-patch"), Transaction.addToHistory.of(false)]
      });
      if (!viewport.hadFocus) this.deferredExternalCursor = viewport;
      restoreSourceEditorViewport(this.view, viewport);
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
    this.pendingEvaluations.clear();
    this.appliedEvaluation = null;
    this.decorationIndex = emptyDecorationIndex();
    this.options.onEvaluationPresentationChange?.({ isLastGood: false });
    const cursorLine = useCadUiStore.getState().sourceCursorLine;
    const cursorOffset = cursorLine === null
      ? null
      : this.cursorOffsetForLine(this.committedLogicalText, cursorLine);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: this.committedLogicalText },
      ...(cursorOffset === null ? {} : { selection: EditorSelection.cursor(cursorOffset) }),
      effects: [evaluationChanged.of(null), setPatchHighlight.of(null)],
      annotations: [resetOrigin.of("reset"), Transaction.addToHistory.of(false)]
    });
    this.clearCmHistory();
  }

  private restoreDeferredExternalCursor() {
    const snapshot = this.deferredExternalCursor;
    if (!snapshot) return;
    this.deferredExternalCursor = null;
    if (snapshot.primaryElementId !== this.uiStore.getState().selectedElementId) return;
    this.view.dispatch({
      selection: cursorAtSnapshotLocation(this.view, snapshot),
      annotations: Transaction.addToHistory.of(false)
    });
  }

  /**
   * A UI projection is allowed only after the matching source revision is in the CM document and
   * its fresh (or safely mapped) ranges have been selected. This is the ordering gate for Canvas
   * selection and fold changes that arrive during source updates.
   */
  private afterSourceUpdate() {
    this.refreshStatementRanges();
    this.reconcileEvaluationForSource();
    this.refreshDecorationIndex();
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

  private reconcileEvaluationForSource() {
    const state = this.store.getState();
    for (const revision of this.pendingEvaluations.keys()) {
      if (revision < state.compiledDocumentRevision) this.pendingEvaluations.delete(revision);
    }
    // A Canvas model patch advances the compiled-document revision before its
    // asynchronous evaluation result returns. Keep the previous evaluation in
    // that interval so every element line keeps its gutter, line class, and
    // generated-row widget instead of disappearing for one render frame.
    // refreshDecorationIndex rebuilds positions and model-owned state from the
    // current document, while evaluation-owned state is atomically replaced by
    // tryApplyPendingEvaluation once the matching result arrives.
    this.options.onEvaluationPresentationChange?.({ isLastGood: this.isShowingLastGoodEvaluation() });
  }

  private isShowingLastGoodEvaluation() {
    const state = this.store.getState();
    return Boolean(this.appliedEvaluation && state.docText !== state.sourceText && this.appliedEvaluation.compiledDocumentRevision === state.compiledDocumentRevision);
  }

  private refreshDecorationIndex() {
    const state = this.store.getState();
    this.decorationIndex = createEvaluationDecorationIndex({
      ranges: this.statementRanges,
      elements: state.elements,
      evaluation: this.appliedEvaluation?.evaluation ?? null,
      groupFoldById: this.uiStore.getState().groupFoldById,
      palette: state.palette,
      visibilityProfiles: state.visibilityProfiles,
      activeVisibilityProfileId: state.activeVisibilityProfileId,
      pickCandidates: this.currentPickCandidates()
    });
    if (!this.destroyed && !this.protocol.composing) this.view.dispatch({ effects: evaluationChanged.of(null) });
    else this.pendingDecorationRefresh = true;
  }

  private requestDecorationRefresh() {
    if (this.protocol.composing) {
      this.pendingDecorationRefresh = true;
      return;
    }
    this.refreshDecorationIndex();
  }

  private handleEvaluationGutterAction(action: EvaluationGutterAction, lineFrom: number) {
    if (this.protocol.composing || this.flush("command") === "blocked-composition") return false;
    if (action === "stop") {
      if (!this.atStopRange || this.atStopRange.from !== lineFrom) return false;
      const preceding = [...this.statementRanges.values()].filter((range) => range.to < lineFrom).at(-1);
      const index = preceding ? this.store.getState().elements.findIndex((element) => element.id === preceding.elementId) + 1 : 0;
      return dispatchCommand("setEvaluationLimitIndex", { evaluationLimitIndex: index }) !== false;
    }
    const elementId = elementIdAtCursor(this.statementRanges, lineFrom);
    if (!elementId || !this.store.getState().elements.some((element) => element.id === elementId)) return false;
    const commandId = action === "visibility"
      ? "toggleElementVisibility"
      : action === "enabled"
        ? "toggleElementEnabled"
        : action === "locked"
          ? "toggleElementLocked"
          : "toggleGroupPrintEnabled";
    return dispatchCommand(commandId, { elementId }) !== false;
  }

  private sourceIsApplied() {
    return this.protocol.appliedRevision === this.store.getState().sourceRevision;
  }

  private hasSourceFocus() {
    return this.view.hasFocus || this.lineLensFocused;
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
        if (this.pendingPrimaryCursorProjection) {
          this.pendingPrimaryCursorProjection = false;
          this.projectPrimaryCursor();
        }
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
    // A Canvas selection always supersedes any deferred cursor snapshot left over from
    // an earlier unfocused model patch; otherwise a later focus() would restore the
    // stale snapshot over the cursor this projection is about to place.
    this.deferredExternalCursor = null;
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
