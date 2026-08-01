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
import { defaultKeymap, deleteLine, history, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type KeyBinding,
  type ViewUpdate
} from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";
import { forceLinting, setDiagnostics } from "@codemirror/lint";
import { dispatchCommand } from "../commands/commands";
import {
  bindingMatchesEvent,
  crossFocusShortcutBindings,
  sourceEditorShortcutBindings
} from "../keyboard/shortcutRegistry";
import type { KeyChord } from "../keyboard/shortcutTypes";
import { creationPlacementForTarget } from "../model/elementCreationPlacement";
import { isConditionalGroupElement, isFoldTargetExpanded, isStatementExpanded } from "../model/groups";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { parameterPickCommandId } from "../commands/parameterPickCommand";
import { pickCandidates } from "../model/pickCandidates";
import { isRuntimeBindingDisplayFresh } from "../model/runtimeBindingFreshness";
import { runtimeScalarDiagnostics } from "../scalars/runtimeScalarDiagnostics";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ElementId, EvaluationResult } from "../types/geometry";
import { useCadDocumentStore, type CadDocumentState } from "../state/cadDocumentStore";
import { useCadUiStore, type CadUiState } from "../state/cadUiStore";
import { dslCmLanguageExtension } from "./cmLanguage";
import { dslAutocompleteExtension, isElementParameterRetryContext, type DslAutocompleteOptions } from "./cmAutocomplete";
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
  createPrintLayoutRangeIndex,
  createPropertyBindingRangeIndex,
  createScopeBodyRangeIndex,
  createSetStatementFieldRangeIndex,
  createSetStatementRangeIndex,
  createStatementRangeIndex,
  createTemplateHoleRangeIndex,
  createTypedDeclarationFieldRangeIndex,
  createTypedDeclarationRangeIndex,
  mapAtStopRange,
  mapPrintLayoutRangeIndex,
  mapPropertyBindingRangeIndex,
  mapScopeBodyRangeIndex,
  mapSetStatementFieldRangeIndex,
  mapSetStatementRangeIndex,
  mapStatementRangeIndex,
  mapTemplateHoleRangeIndex,
  mapTypedDeclarationFieldRangeIndex,
  mapTypedDeclarationRangeIndex,
  propertyBindingSpanAt,
  setStatementIdAtCursor,
  templateHoleAtPosition,
  typedDeclarationBindingIdAtCursor,
  type AtStopRange,
  type PrintLayoutRangeIndex,
  type PropertyBindingRangeIndex,
  type ScopeBodyRangeIndex,
  type SetStatementFieldRangeIndex,
  type SetStatementRangeIndex,
  type StatementRangeIndex,
  type TemplateHoleRangeIndex,
  type TypedDeclarationFieldRangeIndex,
  type TypedDeclarationRangeIndex
} from "./statementRangeIndex";
import { foldProjectionTransaction, foldTargetAtLine, foldTargets } from "./sourceEditorFolding";
import { secondarySelectionEffect, sourceEditorSelectionExtension } from "./sourceEditorSelection";
import { patchHighlightPayloadForChanges, setPatchHighlight, sourceEditorPatchHighlightExtension } from "./sourceEditorPatchHighlight";
import { createDiagnosticsExtension, diagnosticsForCurrentView, type DiagnosticsExtensionSource } from "./sourceEditorDiagnosticsExtension";
import { mapPositionedDiagnostics, toStaleDiagnostics, type PositionedDiagnostic } from "./sourceEditorDiagnostics";
import { createEvaluationExtension, evaluationChanged } from "./sourceEditorEvaluationExtension";
import { createEvaluationDecorationIndex, type EvaluationDecorationIndex } from "./sourceEditorEvaluationIndex";
import { dslDocumentValueSpansAt, type DslValueSpanDirection } from "../dsl/dslValueSpans";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { resolveParameterValueSpan } from "../dsl/dslParameterSpans";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import { logicalOffsetForPhysicalPosition, logicalTextForProjection, physicalSpanForStatementRange, singlePhysicalSegment, statementProjectionAt } from "../dsl/dslStatementProjection";
import { resolveDslValueStep, type DslValueStepDirection } from "../dsl/dslValueStep";
import { resolveTypedValueStep, typedNumericStepOptions, type TypedValueStepOptions } from "../dsl/dslTypedValueStep";
import { splitDslComment, splitDslTerms } from "../dsl/dslTokens";
import type { ScalarType } from "../scalars/types";
import {
  sameValueStepGesture,
  valueStepDirectionForCommand,
  valueStepGestureEndsOnKeyup,
  valueStepGestureForKeyboardEvent,
  type SourceEditorValueStepGesture
} from "./sourceEditorValueStepGesture";
import { typedRenameTargetBindingIdAtCursor } from "./typedRenameTargetAtCursor";

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
/** External statement snapshots do not alter CM state, so explicitly refresh its gutter markers. */
const foldGutterRefresh = Annotation.define<"fold-gutter-refresh">();
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
  private printLayoutRanges: PrintLayoutRangeIndex = new Map();
  private typedDeclarationRanges: TypedDeclarationRangeIndex = new Map();
  private typedDeclarationFieldRanges: TypedDeclarationFieldRangeIndex = new Map();
  private setStatementRanges: SetStatementRangeIndex = new Map();
  private setStatementFieldRanges: SetStatementFieldRangeIndex = new Map();
  private templateHoleRanges: TemplateHoleRangeIndex = new Map();
  private propertyBindingRanges: PropertyBindingRangeIndex = new Map();
  private scopeBodyRanges: ScopeBodyRangeIndex = [];
  private atStopRange: AtStopRange | null = null;
  /**
   * True only while `doc.bindingAnalysis`/`doc.setStatements` are proven to
   * describe the exact live CM buffer (i.e. a compile just landed and
   * refreshStatementRanges rebuilt from it with no intervening edit). Any
   * doc-changing transaction immediately clears it; only refreshStatementRanges's
   * success branch sets it back. This is deliberately coarser than the
   * per-statement span dirty-tracking above (mapOwningStatementRange) - a `set`
   * statement's own span can remain untouched and still position-valid while an
   * earlier, unrelated edit changes what its target *should* resolve to, and
   * that staleness can only be detected at the whole-document compile level, not
   * per statement. Typed value stepping must hold both: a live, position-valid
   * span AND this flag, before trusting doc.bindingAnalysis/doc.setStatements. */
  private typedSemanticMetadataFresh = false;
  private staleDiagnosticBaseline: PositionedDiagnostic[] = [];
  /** At most two newest compiled-document revisions are retained; older results can never become current. */
  private pendingEvaluations = new Map<number, { evaluation: EvaluationResult; evaluationRequestRevision: number; evaluationIsCurrent: boolean }>();
  private appliedEvaluation: {
    evaluation: EvaluationResult;
    compiledDocumentRevision: number;
    evaluationRequestRevision: number;
    /** The publisher's own evaluationStateIsCurrentFor result, carried
     * through unchanged - never re-derived here (see setEvaluation). Element-
     * property completion's evaluationIsCurrent getter reads this directly. */
    evaluationIsCurrent: boolean;
  } | null = null;
  /** Bridges the autocompleteOptions() object used both to construct the
   * CodeMirror extension and to probe retry eligibility from
   * tryApplyPendingEvaluation, without importing any CodeMirror type here. */
  private autocompleteOptions = (): DslAutocompleteOptions => ({
    elements: () => this.store.getState().elements,
    statementRanges: () => this.statementRanges,
    printLayouts: () => this.store.getState().printLayouts,
    printLayoutRanges: () => this.printLayoutRanges,
    isComposing: () => this.protocol.composing,
    computedVariables: () => this.appliedEvaluation?.evaluation.computedVariables,
    computedGeometry: () => this.appliedEvaluation?.evaluation.computedGeometry,
    forGroupGeneratedRows: () => this.appliedEvaluation?.evaluation.forGroupGeneratedRows,
    effectiveEnabledElementIds: () => this.appliedEvaluation?.evaluation.effectiveEnabledElementIds,
    evaluationErrors: () => this.appliedEvaluation?.evaluation.errors,
    evaluationIsCurrent: () => this.appliedEvaluation?.evaluationIsCurrent ?? false,
    bindingAnalysis: () => this.store.getState().doc.bindingAnalysis,
    typedDeclarationRanges: () => this.typedDeclarationRanges,
    scopeBodyRanges: () => this.scopeBodyRanges,
    statementInfoByElementId: () => this.store.getState().doc.statementMap.byElementId,
    majorVersion: () => this.store.getState().doc.majorVersion ?? undefined
  });
  private decorationIndex: EvaluationDecorationIndex = emptyDecorationIndex();
  private pendingDecorationRefresh = false;
  private pendingSelectionSync = false;
  private pendingPrimaryCursorProjection = false;
  private deferredExternalCursor: SourceEditorViewportSnapshot | null = null;
  private pendingFoldProjection = false;
  private applyingUiSync = false;
  private publishingCanvasSelection = false;
  /** A physical registry shortcut held down across browser key-repeat events. */
  private activeValueStepGesture: SourceEditorValueStepGesture | null = null;
  /** Set by the DOM observer, then consumed by the registry keymap's command dispatch. */
  private pendingKeyboardValueStep: SourceEditorValueStepGesture | null = null;
  /** A controller-authored typed initializer edit may repeat before a new compile rebuilds semantic spans. */
  private repeatingTypedInitializerStep: {
    bindingId: BindingId;
    span: { from: number; to: number };
    declaredType: ScalarType | null;
    options: TypedValueStepOptions;
  } | null = null;
  private applyingTypedInitializerStep = false;
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
          dslAutocompleteExtension(this.autocompleteOptions()),
          sourceEditorSelectionExtension,
          sourceEditorPatchHighlightExtension,
          codeFolding({
            placeholderDOM: (view) => this.createFoldPlaceholder(view)
          }),
          foldService.of((state, lineStart) => {
            const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineStart);
            return target ? { from: target.from, to: target.to } : null;
          }),
          foldGutter({
            foldingChanged: (update) => update.transactions.some(
              (transaction) => transaction.annotation(foldGutterRefresh)
            ),
            domEventHandlers: {
              click: (_view, line, event) => this.handleFoldGutterClick(line.from, event as MouseEvent)
            }
          }),
          createDiagnosticsExtension(this.diagnosticsExtensionSource()),
          createEvaluationExtension({
            index: () => this.decorationIndex,
            atStopRange: () => this.atStopRange,
            pickCursorElementId: () => this.uiStore.getState().activePickCursor?.elementId ?? null,
            isLastGood: () => this.isShowingLastGoodEvaluation(),
            onGutterAction: (lineFrom) => this.handleElementStateGutterAction(lineFrom)
          }),
          search(),
          this.historyCompartment.of(history()),
          this.sourceEditorShortcutCompartment.of(keymap.of(this.editorShortcutBindings())),
          keymap.of([
            { key: "Mod-z", run: () => this.runUndo() },
            { key: "Mod-y", run: () => this.runRedo() },
            { key: "Mod-Shift-z", run: () => this.runRedo() },
            { key: "Enter", run: () => this.runPickApply() },
            { key: "Enter", run: (view) => this.autoContinueAtTermBoundary(view) },
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
      stepValue: (direction) => this.stepSourceValue(direction),
      startPickFromSelection: () => this.startPickFromSelection()
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
            this.sourceEditorShortcutCompartment.reconfigure(keymap.of(this.editorShortcutBindings()))
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

  currentCursorElementId = () =>
    elementIdAtCursor(this.statementRanges, this.view.state.selection.main.head);

  currentSourceCursor = () => {
    const head = this.view.state.selection.main.head;
    return {
      sourceRevision: this.store.getState().sourceRevision,
      line: this.view.state.doc.lineAt(head).number,
      lineCount: this.view.state.doc.lines,
      elementId: elementIdAtCursor(this.statementRanges, head)
    };
  };

  /** Typed-span counterpart to currentCursorElementId, gated by the same
   * typedSemanticMetadataFresh contract as stepTypedSourceValue: the tracked
   * physical spans and doc.scalarProgram/setStatements/propertyBindings/
   * textTemplates must describe the exact live buffer, not just survive an
   * unrelated edit via mapPos. */
  currentCursorTypedRenameTargetBindingId = (): BindingId | null => {
    if (!this.typedSemanticMetadataFresh) return null;
    const doc = this.store.getState().doc;
    return typedRenameTargetBindingIdAtCursor(
      {
        typedDeclarationRanges: this.typedDeclarationRanges,
        typedDeclarationFieldRanges: this.typedDeclarationFieldRanges,
        setStatementRanges: this.setStatementRanges,
        setStatementFieldRanges: this.setStatementFieldRanges,
        propertyBindingRanges: this.propertyBindingRanges,
        templateHoleRanges: this.templateHoleRanges,
        doc: {
          statements: doc.statements,
          scalarProgram: doc.scalarProgram,
          setStatements: doc.setStatements,
          propertyBindings: doc.propertyBindings,
          textTemplates: doc.textTemplates,
          numericBindings: doc.numericBindings
        }
      },
      this.view.state.selection.main.head
    );
  };

  getText = () => serializeEditorText(this.view.state.doc.toString(), this.format);

  /**
   * Uses CM6's structural Text.eq instead of toString() so a fresh full-string
   * allocation is not made on every check (e.g. on every preview pointermove).
   */
  hasPendingText = () => !this.view.state.doc.eq(this.committedDoc);

  /**
   * Whether `candidate` should replace `applied` (or a queued pending entry
   * of the same shape) for a single compiledDocumentRevision. A strictly
   * higher evaluationRequestRevision always supersedes - the existing,
   * preserved semantics for a genuinely newer (or out-of-order/stale)
   * response. At the *same* revision+request, only a pending -> current
   * upgrade counts as new information: parity mode's
   * deferScalarReferenceEvaluation path (useEvaluationEngine.ts) republishes
   * the "evaluating" placeholder and the later resolved shadow-reference
   * result under the identical (compiledDocumentRevision,
   * evaluationRequestRevision) pair - unlike Rust-first mode's
   * stale-asyncEvaluation republication, which carries an older revision
   * that the earlier `compiledDocumentRevision < current` check already
   * rejects, so it never collides this way. Any other same-revision+request
   * publication (current -> pending, or current -> current) is a true
   * duplicate and must not re-apply - this is what keeps
   * retryElementParameterCompletionIfNewlyCurrent from ever looping.
   */
  private supersedesApplied(
    candidate: { evaluationRequestRevision: number; evaluationIsCurrent: boolean },
    applied: { evaluationRequestRevision: number; evaluationIsCurrent: boolean } | undefined
  ): boolean {
    if (!applied) return true;
    if (candidate.evaluationRequestRevision !== applied.evaluationRequestRevision) {
      return candidate.evaluationRequestRevision > applied.evaluationRequestRevision;
    }
    return candidate.evaluationIsCurrent && !applied.evaluationIsCurrent;
  }

  /** Results are keyed by the compiled document revision captured at request start.
   * Keep at most the two newest future revisions; lower revisions are permanently stale. */
  setEvaluation = (publication: SourceEvaluationPublication) => {
    const current = this.store.getState().compiledDocumentRevision;
    if (publication.compiledDocumentRevision < current) return;
    const candidate = {
      evaluationRequestRevision: publication.evaluationRequestRevision,
      evaluationIsCurrent: publication.evaluationIsCurrent ?? true
    };
    if (this.appliedEvaluation?.compiledDocumentRevision === publication.compiledDocumentRevision &&
      !this.supersedesApplied(candidate, this.appliedEvaluation)) return;
    const pending = this.pendingEvaluations.get(publication.compiledDocumentRevision);
    if (pending && !this.supersedesApplied(candidate, pending)) return;
    this.pendingEvaluations.set(publication.compiledDocumentRevision, {
      evaluation: publication.evaluation,
      evaluationRequestRevision: candidate.evaluationRequestRevision,
      evaluationIsCurrent: candidate.evaluationIsCurrent
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

  jumpToBindingDeclaration = (bindingId: BindingId): boolean => {
    if (this.protocol.composing) return false;
    const range = this.typedDeclarationRanges.get(bindingId);
    if (!range) return false;
    this.view.dispatch({
      selection: EditorSelection.cursor(range.from),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.uiStore.getState().setSelectedBindingId(bindingId);
    this.view.focus();
    return true;
  };

  /**
   * Task 43: same shape as jumpToBindingDeclaration, but selects the declaration's
   * type annotation or initializer sub-span (Inspector's "型"/"初期化式" rows) instead of
   * just moving the cursor to the statement's start. Returns false - without moving the
   * cursor at all - when the binding no longer resolves to a typed declaration or that
   * particular field's span is not currently trackable (e.g. a multi-line initializer,
   * or a dirty edit that fully replaced it); callers can fall back to
   * jumpToBindingDeclaration for a whole-statement jump in that case.
   */
  jumpToBindingDeclarationPart = (bindingId: BindingId, part: "type" | "initializer"): boolean => {
    if (this.protocol.composing) return false;
    const span = this.typedDeclarationFieldRanges.get(bindingId)?.[part];
    if (!span) return false;
    this.view.dispatch({
      selection: EditorSelection.single(span.from, span.to),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.uiStore.getState().setSelectedBindingId(bindingId);
    this.view.focus();
    return true;
  };

  /**
   * Task 45: selects a resolved property/control-flow `@name` binding's own
   * value span via Task 43's plain PropertyBindingRangeIndex (`occurrenceKey`
   * is Task 22's `propertyBindingOccurrenceKey(statementIndex, parameterKey)`).
   * Never re-parses the line and never guesses a position - returns false
   * without moving anything when the occurrence's span isn't currently
   * trackable (dirty-dropped, or the occurrence no longer compiles), so a
   * caller never lands on a stale/wrong location. Does not touch selection;
   * callers own selecting the consuming element first (mirroring
   * jumpToParameterValue).
   */
  jumpToPropertyBindingValue = (occurrenceKey: string): boolean => {
    if (this.protocol.composing) return false;
    const range = this.propertyBindingRanges.get(occurrenceKey);
    if (!range) return false;
    this.view.dispatch({
      selection: EditorSelection.single(range.span.from, range.span.to),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.view.focus();
    return true;
  };

  /**
   * Task 48 correction: selects a diagnostic's own already-resolved,
   * revision-stamped physicalSpan directly - for a reference occurrence
   * (undefined-binding/forward-binding-reference/self-initialization/a
   * reference-origin duplicate-binding) there is no dedicated Task 43 index
   * keyed by anything narrower than a whole binding's declaration, so this
   * is the only exact target. Re-validates at click time rather than
   * trusting the span was computed a moment ago: false (no-op, no movement)
   * on IME composition, a dirty/uncommitted buffer, a source revision that
   * has since moved on, or an out-of-bounds/empty segment. Never falls back
   * to any other position (e.g. the owning binding's declaration).
   */
  selectSourceSpan = (span: DslPhysicalSpan): boolean => {
    if (this.protocol.composing) return false;
    if (this.hasPendingText()) return false;
    const state = this.store.getState();
    if (span.sourceRevision !== state.doc.statementMap.sourceRevision) return false;
    const segment = span.segments[0];
    if (!segment || segment.from < 0 || segment.to < segment.from || segment.to > this.view.state.doc.length) return false;
    this.view.dispatch({
      selection: EditorSelection.single(segment.from, segment.to),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.view.focus();
    return true;
  };

  /**
   * Task 45: selects one text-template hole's brace-interior (`inner`) span
   * via Task 43's plain TemplateHoleRangeIndex. `holeIndex` is the hole's
   * position among Task 26's TextTemplateAst hole segments (all hole kinds
   * counted, in source order) - callers resolve it once against the compiled
   * TextTemplateAst's `dependencies`/`segments`, never here. Returns false
   * without moving anything if the occurrence/hole isn't currently
   * trackable.
   */
  jumpToTemplateHole = (occurrenceKey: string, holeIndex: number): boolean => {
    if (this.protocol.composing) return false;
    const hole = this.templateHoleRanges.get(occurrenceKey)?.holes[holeIndex];
    if (!hole) return false;
    this.view.dispatch({
      selection: EditorSelection.single(hole.inner.from, hole.inner.to),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.view.focus();
    return true;
  };

  jumpToElementEnd = (elementId: ElementId) => {
    if (this.protocol.composing) return false;
    const range = this.statementRanges.get(elementId);
    if (!range) return false;
    const doc = this.view.state.doc;
    if (
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 0 ||
      range.to < range.from ||
      range.to > doc.length
    ) return false;
    // Statement metadata owns the matching close brace even when the editor's
    // fold range intentionally omits an inline-header fallback. A creation
    // return belongs after the whole block, including its else branch.
    const closingBraceLine = range.statement.closeBraceLine;
    const mappedClosingBraceFrom = range.foldTargets
      .map((target) => target.foldTo)
      .sort((left, right) => right - left)[0];
    const canUseClosingBraceLine =
      closingBraceLine !== undefined &&
      closingBraceLine >= 1 &&
      closingBraceLine <= doc.lines &&
      mappedClosingBraceFrom !== undefined &&
      mappedClosingBraceFrom >= range.from &&
      mappedClosingBraceFrom <= doc.length &&
      doc.line(closingBraceLine).from === mappedClosingBraceFrom;
    const cursor = canUseClosingBraceLine ? doc.line(closingBraceLine).to : range.to;
    // Publish the external selection first, under the same guard as parameter
    // navigation, so its subscription cannot project this deliberate end
    // cursor back to the statement header.
    this.deferredExternalCursor = null;
    this.pendingPrimaryCursorProjection = false;
    this.publishingCanvasSelection = true;
    try {
      this.uiStore.getState().setSelectedElementId(elementId);
    } finally {
      this.publishingCanvasSelection = false;
    }
    this.view.dispatch({
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
      annotations: [canvasCursorOrigin.of("canvas-cursor"), Transaction.addToHistory.of(false)]
    });
    this.view.focus();
    return true;
  };

  jumpToParameterValue = (elementId: ElementId, parameterKey: string): boolean => {
    if (this.protocol.composing) return false;
    const range = this.statementRanges.get(elementId);
    const element = this.store.getState().elements.find((candidate) => candidate.id === elementId);
    if (!range || !element) return false;
    const snapshot = { normalizedSource: this.view.state.doc.toString(), sourceRevision: this.store.getState().sourceRevision };
    const projection = statementProjectionAt(snapshot, range.from);
    if (!projection.ok || !projection.value) return false;
    const logicalText = logicalTextForProjection(projection.value);
    const committedSnapshot = { normalizedSource: this.committedDoc.toString(), sourceRevision: range.statement.sourceRevision };
    const committed = statementProjectionAt(committedSnapshot, range.from);
    const committedLineText = committed.ok && committed.value ? logicalTextForProjection(committed.value) ?? undefined : undefined;
    const target = logicalText ? resolveParameterValueSpan(logicalText, element, parameterKey, { committedLineText }) : null;
    const targetRange = target ? singlePhysicalSegment(snapshot, physicalSpanForStatementRange(projection.value, target)) : { ok: true as const, value: null };
    if (!targetRange.ok || !targetRange.value) {
      this.jumpToElement(elementId);
      this.view.focus();
      return false;
    }
    // If the destination sits inside the element's own folded statement range,
    // expand it first so the synchronous store subscription unfolds the text
    // before the cursor is dispatched into it, instead of landing on hidden text.
    const statementTarget = range.foldTargets.find((foldTarget) => foldTarget.branch === "statement");
    if (
      statementTarget &&
      statementTarget.foldFrom < targetRange.value.from &&
      targetRange.value.from < statementTarget.foldTo &&
      !isStatementExpanded(elementId, this.uiStore.getState().groupFoldById)
    ) {
      this.uiStore.getState().setFoldTargetExpanded({ elementId, branch: "statement" }, true);
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
      selection: EditorSelection.single(targetRange.value.from, targetRange.value.to),
      scrollIntoView: true,
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
    const elementId = elementIdAtCursor(this.statementRanges, main.from);
    const range = elementId ? this.statementRanges.get(elementId) : null;
    const element = elementId
      ? this.store.getState().elements.find((candidate) => candidate.id === elementId)
      : undefined;
    if (!range || !element) return this.stepTypedSourceValue(direction, main);
    const line = this.view.state.doc.lineAt(main.from);
    // Gate on whether the *statement* is a single physical line, not whether the
    // (usually collapsed) selection happens to sit within one line — a collapsed
    // cursor always has main.from === main.to, so it would otherwise always look
    // "same line" even while parked on a continuation row of a multi-line call.
    const sameLine = range.statement.line === range.statement.endLine;
    let change: ReturnType<typeof resolveDslValueStep>;
    let replaceRange: { from: number; to: number } | null = null;
    let selectionRange: { from: number; to: number } | null = null;
    if (sameLine) {
      const committedLineText = range.statement.line <= this.committedDoc.lines
        ? this.committedDoc.line(range.statement.line).text
        : undefined;
      change = resolveDslValueStep(line.text, element, { start: main.from - line.from, end: main.to - line.from }, direction, { committedLineText });
      if (change) {
        replaceRange = { from: line.from + change.from, to: line.from + change.to };
        selectionRange = { from: line.from + change.selection.start, to: line.from + change.selection.end };
      }
    } else {
      const snapshot = { normalizedSource: this.view.state.doc.toString(), sourceRevision: this.store.getState().sourceRevision };
      const projection = statementProjectionAt(snapshot, main.from);
      if (!projection.ok || !projection.value) return false;
      const logicalText = logicalTextForProjection(projection.value);
      if (!logicalText) return false;
      const logicalFrom = logicalOffsetForPhysicalPosition(projection.value, main.from);
      const logicalTo = logicalOffsetForPhysicalPosition(projection.value, main.to);
      if (logicalFrom === null || logicalTo === null) return false;
      const committedSnapshot = { normalizedSource: this.committedDoc.toString(), sourceRevision: range.statement.sourceRevision };
      const committed = statementProjectionAt(committedSnapshot, range.from);
      const committedLineText = committed.ok && committed.value ? logicalTextForProjection(committed.value) ?? undefined : undefined;
      change = resolveDslValueStep(logicalText, element, { start: logicalFrom, end: logicalTo }, direction, { committedLineText });
      if (change) {
        const replace = singlePhysicalSegment(snapshot, physicalSpanForStatementRange(projection.value, { start: change.from, end: change.to }));
        const nextSelection = singlePhysicalSegment(snapshot, physicalSpanForStatementRange(projection.value, change.selection));
        if (!replace.ok || !nextSelection.ok || !replace.value || !nextSelection.value) return false;
        replaceRange = replace.value;
        selectionRange = nextSelection.value;
      }
    }
    if (!change) {
      if (this.activeValueStepGesture) this.flush("command");
      return false;
    }
    if (!replaceRange || !selectionRange) return false;
    return this.commitStepChange(replaceRange, selectionRange, change.insert, direction);
  }

  /**
   * Dispatches one value-step edit and decides preview-vs-commit, shared by
   * every value-step source (legacy element attribute, typed declaration
   * initializer, `set` RHS). This is the sole owner of the editorTransaction
   * commit/undo behavior for Alt+←/→: keyboard-repeat gesture coalescing
   * (`pendingKeyboardValueStep`/`activeValueStepGesture`) and the
   * one-commitText-per-burst Undo grouping apply identically regardless of
   * which caller resolved the edit, so a new steppable kind never needs its
   * own transaction/undo path - only its own edit-resolution branch above.
   */
  private commitStepChange(
    replaceRange: { from: number; to: number },
    selectionRange: { from: number; to: number },
    insert: string,
    direction: DslValueStepDirection
  ): boolean {
    this.view.dispatch({
      changes: { from: replaceRange.from, to: replaceRange.to, insert },
      selection: EditorSelection.single(selectionRange.from, selectionRange.to),
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

  /**
   * Typed-span counterpart to the legacy branch above, tried only when the
   * cursor is not inside a CadElement statement (typedDeclaration/set
   * statements never have an elementId - see dslParser.ts's nonElementKinds).
   * Requires doc.bindingAnalysis/doc.setStatements to be proven current for
   * the exact live buffer (typedSemanticMetadataFresh) before reading either
   * one - a `set` statement's own RHS span can remain untouched and
   * position-valid while an earlier, unrelated edit (not yet recompiled)
   * changes what its target should resolve to, and that staleness cannot be
   * detected from the span alone. No source re-parse or re-resolution here:
   * every lookup is an existing O(1) map already rebuilt on compile.
   */
  private stepTypedSourceValue(direction: DslValueStepDirection, main: { from: number; to: number }): boolean {
    const repeating = this.repeatingTypedInitializerStep;
    if (repeating && this.activeValueStepGesture) {
      if (main.from >= repeating.span.from && main.to <= repeating.span.to) {
        return this.stepTypedDeclarationInitializer(
          repeating.bindingId,
          repeating.span,
          repeating.declaredType,
          { start: main.from, end: main.to },
          direction,
          repeating.options
        );
      }
    }
    if (!this.typedSemanticMetadataFresh) return false;
    const doc = this.store.getState().doc;
    const selection = { start: main.from, end: main.to };

    const bindingId = typedDeclarationBindingIdAtCursor(this.typedDeclarationRanges, main.from);
    if (bindingId) {
      const span = this.typedDeclarationFieldRanges.get(bindingId)?.initializer;
      if (span && main.from >= span.from && main.from <= span.to) {
        const binding = doc.bindingAnalysis?.catalog.bindingsById.get(bindingId);
        const statement = binding ? doc.statements[binding.statementIndex] : null;
        const numericTypeOptions = statement?.kind === "typedDeclaration" ? statement.numericTypeOptions : undefined;
        return this.stepTypedDeclarationInitializer(
          bindingId,
          span,
          binding?.declaredType ?? null,
          selection,
          direction,
          typedNumericStepOptions(numericTypeOptions)
        );
      }
      return false;
    }

    const statementId = setStatementIdAtCursor(this.setStatementRanges, main.from);
    if (statementId) {
      const fields = this.setStatementFieldRanges.get(statementId);
      const span = fields?.expression;
      if (fields && span && main.from >= span.from && main.from <= span.to) {
        const targetBindingId = doc.setStatements?.get(fields.statementIndex)?.targetBindingId;
        const declaredType = targetBindingId
          ? doc.bindingAnalysis?.catalog.bindingsById.get(targetBindingId)?.declaredType ?? null
          : null;
        return this.stepTypedSpan(span, declaredType, selection, direction);
      }
    }
    return false;
  }

  /** Preserves only a controller-authored declaration initializer target across held-key repeats. */
  private stepTypedDeclarationInitializer(
    bindingId: BindingId,
    span: { from: number; to: number },
    declaredType: ScalarType | null,
    selection: { start: number; end: number },
    direction: DslValueStepDirection,
    options: TypedValueStepOptions
  ): boolean {
    const lengthBefore = this.view.state.doc.length;
    this.applyingTypedInitializerStep = true;
    try {
      const handled = this.stepTypedSpan(span, declaredType, selection, direction, options);
      if (handled && this.activeValueStepGesture) {
        this.repeatingTypedInitializerStep = {
          bindingId,
          span: { from: span.from, to: span.to + this.view.state.doc.length - lengthBefore },
          declaredType,
          options
        };
      }
      return handled;
    } finally {
      this.applyingTypedInitializerStep = false;
    }
  }

  /** Resolves and commits one typed literal step for a span already
   * proven position-valid and semantically fresh by the caller. */
  private stepTypedSpan(
    span: { from: number; to: number },
    declaredType: ScalarType | null,
    selection: { start: number; end: number },
    direction: DslValueStepDirection,
    options?: TypedValueStepOptions
  ): boolean {
    const value = this.view.state.doc.sliceString(span.from, span.to);
    const change = resolveTypedValueStep(value, declaredType, span, selection, direction, options);
    if (!change) {
      if (this.activeValueStepGesture) this.flush("command");
      return false;
    }
    return this.commitStepChange(
      { from: change.from, to: change.to },
      { from: change.selection.start, to: change.selection.end },
      change.insert,
      direction
    );
  }

  /**
   * Resolves only an exact, complete parameter-value selection before delegating
   * to the same point/line/numeric pick commands the Inspector uses. The outer
   * command flushes first, so this always runs against the current committed DSL.
   */
  private startPickFromSelection(): boolean {
    if (this.protocol.composing) return false;
    const ui = this.uiStore.getState();
    if (
      ui.activePointPickTarget ||
      ui.activeNumericReferencePickTarget ||
      ui.activeLinePickTarget ||
      ui.activeTemplateInsertion
    ) return false;

    const selection = this.view.state.selection;
    if (selection.ranges.length !== 1 || selection.main.empty) return false;
    const main = selection.main;
    const elementId = elementIdAtCursor(this.statementRanges, main.from);
    const range = elementId ? this.statementRanges.get(elementId) : null;
    const element = elementId
      ? this.store.getState().elements.find((candidate) => candidate.id === elementId)
      : undefined;
    if (!range || !element) return false;

    const snapshot = { normalizedSource: this.view.state.doc.toString(), sourceRevision: this.store.getState().sourceRevision };
    const projection = statementProjectionAt(snapshot, main.from);
    if (!projection.ok || !projection.value) return false;
    const logicalText = logicalTextForProjection(projection.value);
    if (!logicalText) return false;
    const committed = statementProjectionAt({ normalizedSource: this.committedDoc.toString(), sourceRevision: range.statement.sourceRevision }, range.from);
    const committedLineText = committed.ok && committed.value ? logicalTextForProjection(committed.value) ?? undefined : undefined;
    const target = getParameterDefinitions(element)
      .map((definition) => ({ definition, span: resolveParameterValueSpan(logicalText, element, definition.key, { committedLineText }) }))
      .find(({ span }) => {
        const physical = span ? singlePhysicalSegment(snapshot, physicalSpanForStatementRange(projection.value!, span)) : null;
        return physical?.ok && physical.value?.from === main.from && physical.value.to === main.to;
      });
    if (!target) return false;
    const commandId = parameterPickCommandId(target.definition.kind);
    return commandId ? dispatchCommand(commandId, { elementId: element.id, parameterKey: target.definition.key }) !== false : false;
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
      !this.supersedesApplied(pending, this.appliedEvaluation)) return;
    const wasCurrent = this.appliedEvaluation?.evaluationIsCurrent ?? false;
    this.appliedEvaluation = {
      evaluation: pending.evaluation,
      compiledDocumentRevision: state.compiledDocumentRevision,
      evaluationRequestRevision: pending.evaluationRequestRevision,
      evaluationIsCurrent: pending.evaluationIsCurrent
    };
    this.pendingEvaluations.delete(state.compiledDocumentRevision);
    this.options.onEvaluationPresentationChange?.({ isLastGood: this.isShowingLastGoodEvaluation() });
    this.refreshDecorationIndex();
    // Evaluation changes don't re-arm CodeMirror's linter. Refresh the actual
    // diagnostic state every time, including recovery/re-error sequences.
    // refreshDiagnosticsNow selects the dirty-buffer layer when needed, so an
    // evaluation arriving during an edit cannot project committed diagnostics
    // onto shifted text.
    this.refreshDiagnosticsNow();
    this.retryElementParameterCompletionIfNewlyCurrent(wasCurrent, pending.evaluationIsCurrent);
  }

  /**
   * Element-property completion reports no candidates while evaluation is
   * not current (see cmAutocomplete.ts's elementParameter branch), so a
   * popup withheld purely for that reason never reopens on its own once
   * evaluation catches up - the user would have to retype. This fires
   * exactly once per pending -> current transition, and only when nothing
   * else is already showing (never interrupts an open, unrelated popup) and
   * the cursor is still at an elementParameter position whose candidates
   * (computed from the now-current evaluation) are non-empty - otherwise
   * there is nothing worth reopening, and this must not loop or duplicate.
   */
  private retryElementParameterCompletionIfNewlyCurrent(wasCurrent: boolean, isCurrent: boolean) {
    if (wasCurrent || !isCurrent) return;
    if (this.protocol.composing || this.view.compositionStarted) return;
    if (completionStatus(this.view.state) !== null) return;
    if (!isElementParameterRetryContext(this.autocompleteOptions(), this.view)) return;
    this.view.dispatch({ annotations: Transaction.userEvent.of("input.type") });
  }

  private currentPickCandidates() {
    const ui = this.uiStore.getState();
    const evaluation = this.appliedEvaluation?.evaluation;
    if (!evaluation) return [];
    return pickCandidates(this.store.getState().elements, evaluation, {
      activePointPickTarget: ui.activePointPickTarget,
      activeNumericReferencePickTarget: ui.activeNumericReferencePickTarget,
      activeLinePickTarget: ui.activeLinePickTarget,
      commandLineSession: ui.commandLineSession,
      commandLinePickParentGroupId: ui.commandLineSession
        ? creationPlacementForTarget(
            this.store.getState().elements,
            ui.commandLineSession.insertionTarget,
            this.store.getState().evaluationLimitIndex
          ).parentGroupId
        : undefined
    });
  }

  private runSave() {
    if (this.flush("save") === "blocked-composition") return true;
    dispatchCommand("saveDocument");
    return true;
  }

  private runPickApply() {
    const ui = this.uiStore.getState();
    if (!(ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget)) return false;
    if (this.protocol.composing || this.flush("command") === "blocked-composition") return true;
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
    if (ui.commandLineSession) {
      dispatchCommand("cancelCommandLineSession");
      return true;
    }
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

  /**
   * Task 43: the ordered typed sub-spans (declaration name/type/initializer, or set
   * target/expression) for whichever typed statement's whole-line range contains `pos`,
   * if any. Reads only the compile-time-built, dirty-mapped field indices - never
   * re-parses. Empty when `pos` is not inside a typedDeclaration/set statement, or that
   * statement's fields are not currently resolvable (dirty-dropped, or a fail-closed
   * multi-segment span).
   */
  private typedFieldSpansAtCursor(pos: number): readonly { from: number; to: number }[] {
    const isSpan = (span: { from: number; to: number } | null): span is { from: number; to: number } => span !== null;
    const bindingId = typedDeclarationBindingIdAtCursor(this.typedDeclarationRanges, pos);
    if (bindingId) {
      const fields = this.typedDeclarationFieldRanges.get(bindingId);
      if (fields) return [fields.name, fields.type, fields.initializer].filter(isSpan).sort((a, b) => a.from - b.from);
    }
    const statementId = setStatementIdAtCursor(this.setStatementRanges, pos);
    if (statementId) {
      const fields = this.setStatementFieldRanges.get(statementId);
      if (fields) return [fields.target, fields.expression].filter(isSpan).sort((a, b) => a.from - b.from);
    }
    return [];
  }

  /**
   * Task 43: narrows a text-template attribute's whole-value legacy span to the
   * specific hole `pos` falls inside, when one is tracked (most-specific-wins, mirroring
   * resolveParameterTargetAt's existing convention). Explicitly selects the hole's
   * `inner` (brace-interior) span, not `outer` - the click target is the bound
   * name/expression itself, not its delimiting braces. Falls back to the legacy span
   * itself - never guessed, never re-parsed - when no compiled hole index is available
   * (no template at this occurrence, or dirty-dropped).
   */
  private narrowToTemplateHole(pos: number, legacySpan: { from: number; to: number }): { from: number; to: number } {
    const elementId = elementIdAtCursor(this.statementRanges, pos);
    const statementIndex = elementId ? this.statementRanges.get(elementId)?.statement.statementIndex : undefined;
    if (statementIndex === undefined) return legacySpan;
    const hole = templateHoleAtPosition(this.templateHoleRanges, propertyBindingOccurrenceKey(statementIndex, "text"), pos);
    return hole ? hole.inner : legacySpan;
  }

  /**
   * Selects the whole editable value under a plain click that ended without a drag.
   * Runs on `mouseup` so CodeMirror's own pointer handling (drag-select, Mod-click
   * multi-selection) has already resolved `view.state.selection`; this only acts when
   * that outcome is a single collapsed cursor with no modifier keys held, otherwise it
   * defers entirely.
   *
   * A click on a typed property binding (Task 22's `@name` value) resolves solely
   * through the compile-time `propertyBindingRanges` index and returns before ever
   * calling `dslDocumentValueSpansAt` - that legacy path re-parses the clicked line on
   * every call (via `statementProjectionAt`/`parseDslSnapshot`), which Task 43's
   * plain-offset-index contract forbids for typed navigation. Every other click (an
   * ordinary literal value, a typed declaration/set field, a text-template hole) is
   * unchanged: legacy re-derives spans from the live buffer's line text on every call,
   * so it stays correct while dirty or while the document is fatal, and a click inside a
   * typed declaration/set statement or a text-template hole resolves through the other
   * compile-time typed span indices (Task 43), which stay accurate under dirty edits via
   * CM's own change mapping rather than a re-parse.
   */
  private handleValueClick(event: MouseEvent, view: EditorView) {
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (this.protocol.composing) return false;
    const selection = view.state.selection;
    if (selection.ranges.length !== 1 || !selection.main.empty) return false;
    const pos = selection.main.head;
    const propertySpan = propertyBindingSpanAt(this.propertyBindingRanges, pos);
    if (propertySpan) {
      view.dispatch({
        selection: EditorSelection.single(propertySpan.from, propertySpan.to),
        annotations: Transaction.addToHistory.of(false)
      });
      return true;
    }
    const result = dslDocumentValueSpansAt(
      { normalizedSource: view.state.doc.toString(), sourceRevision: this.store.getState().sourceRevision },
      pos
    );
    const legacySpan = result.ok ? result.value.find((candidate) => pos >= candidate.from && pos < candidate.to) : undefined;
    const span = legacySpan
      ? this.narrowToTemplateHole(pos, legacySpan)
      : this.typedFieldSpansAtCursor(pos).find((candidate) => pos >= candidate.from && pos < candidate.to);
    if (!span) return false;
    view.dispatch({
      selection: EditorSelection.single(span.from, span.to),
      annotations: Transaction.addToHistory.of(false)
    });
    return true;
  }

  /**
   * Tab/Shift-Tab cycles the selection between editable value spans within the current
   * statement (always one line — see dslParser.ts). Reuses dslLineValueSpans/
   * adjacentDslValueSpan, the exact same span source handleValueClick uses, so click and
   * Tab always agree on what's a value and what isn't for an ordinary element statement's
   * own attrs/payload spans - that path and its order/count are unchanged. A
   * typedDeclaration/set statement line (which dslDocumentValueSpansAt always reports as
   * having no spans, see dslParser.ts's nonElementKinds) instead cycles through Task 43's
   * compile-time typed field spans. During IME composition the key is fully consumed (no
   * value-jump, no fallthrough to defaultKeymap's indentMore/indentLess either, since
   * letting that mutate the document mid-composition is unsafe); when there are no spans
   * of either kind or the selection crosses lines, this falls through so Tab keeps its
   * ordinary indent behavior.
   */
  private navigateValueSpan(direction: DslValueSpanDirection): boolean {
    if (this.protocol.composing) return true;
    const main = this.view.state.selection.main;
    if (this.view.state.doc.lineAt(main.from).number !== this.view.state.doc.lineAt(main.to).number) return false;
    const result = dslDocumentValueSpansAt(
      { normalizedSource: this.view.state.doc.toString(), sourceRevision: this.store.getState().sourceRevision },
      main.from
    );
    const spans = result.ok && result.value.length > 0 ? result.value : this.typedFieldSpansAtCursor(main.from);
    if (spans.length === 0) return false;
    const current = spans.find((span) => main.from >= span.from && main.from < span.to);
    const index = current ? spans.indexOf(current) : -1;
    const target = index >= 0
      ? spans[(index + (direction === "next" ? 1 : spans.length - 1)) % spans.length]
      : direction === "next"
        ? spans.find((span) => span.from > main.from) ?? spans[0]
        : [...spans].reverse().find((span) => span.to <= main.from) ?? spans.at(-1)!;
    if (!target) return false;
    this.view.dispatch({
      selection: EditorSelection.single(target.from, target.to),
      annotations: Transaction.addToHistory.of(false)
    });
    return true;
  }

  /** Inserts a continuation only at a complete top-level term boundary. */
  private autoContinueAtTermBoundary(view: EditorView): boolean {
    if (this.protocol.composing || view.compositionStarted) return false;
    const ui = this.uiStore.getState();
    if (ui.activePointPickTarget || ui.activeNumericReferencePickTarget || ui.activeLinePickTarget || ui.activeTemplateInsertion) return true;
    const selection = view.state.selection;
    if (selection.ranges.length !== 1 || !selection.main.empty) return false;
    const pos = selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const local = pos - line.from;
    const { code } = splitDslComment(line.text);
    if (local > code.length) return false;
    let from = local;
    let to = local;
    while (from > 0 && /[ \t]/.test(code[from - 1])) from -= 1;
    while (to < code.length && /[ \t]/.test(code[to])) to += 1;
    if (from === to) return false;
    const terms = splitDslTerms(code);
    const left = terms.find((term) => term.end === from);
    const right = terms.find((term) => term.start === to);
    if (!left || !right || left.text.includes("{") || right.text.includes("}")) return false;
    const elementId = elementIdAtCursor(this.statementRanges, pos);
    const statementStart = elementId ? this.statementRanges.get(elementId)?.from : line.from;
    const baseLine = view.state.doc.lineAt(statementStart ?? line.from);
    const indentation = baseLine.text.match(/^[ \t]*/)?.[0] ?? "";
    const insert = ` \\\n${indentation}  `;
    view.dispatch({
      changes: { from: line.from + from, to: line.from + to, insert },
      selection: EditorSelection.cursor(line.from + from + insert.length),
      annotations: [
        Transaction.userEvent.of("input.continuation"),
        isolateHistory.of("full")
      ]
    });
    return true;
  }

  flush = (reason: FlushReason): SourceEditFlushResult => {
    if (this.destroyed) return "clean";
    this.activeValueStepGesture = null;
    this.pendingKeyboardValueStep = null;
    this.repeatingTypedInitializerStep = null;
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
    this.unregisterSession();
    this.unsubscribe();
    this.unsubscribeUi();
    this.view.destroy();
  };

  /** CodeMirror-owned keys never enter this registry. An editor transaction may
   * decline and fall through; an app-exclusive match always consumes its key. */
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
            const handled = dispatchCommand(binding.commandId, {
              currentCursorElementId: this.currentCursorElementId,
              currentSourceCursor: this.currentSourceCursor,
              currentCursorTypedRenameTargetBindingId: this.currentCursorTypedRenameTargetBindingId
            }) !== false;
            return binding.owner === "editorTransaction" ? handled : true;
          }
        } satisfies KeyBinding];
      })
    );
  }

  private crossFocusShortcutKeymap(): KeyBinding[] {
    return crossFocusShortcutBindings(this.uiStore.getState().shortcutSettings).flatMap((binding) =>
      binding.chords.flatMap((chord) => {
        const key = codeMirrorKeyForChord(chord);
        if (!key) return [];
        return [{
          key,
          run: (view) => {
            if (this.protocol.composing || view.compositionStarted) return true;
            if (binding.commandId === "saveDocument") this.runSave();
            else if (binding.commandId === "focusElementSearch") this.options.onRequestElementSearch?.();
            else dispatchCommand(binding.commandId);
            return true;
          },
          // CodeMirror's matcher treats an extra Shift as compatible with
          // `Mod-k`. Preserve its standard Shift-Mod-k delete-line command
          // instead of opening the app palette.
          ...(binding.commandId === "openCommandPalette"
            ? { shift: () => deleteLine(this.view) }
            : {})
        } satisfies KeyBinding];
      })
    );
  }

  private editorShortcutKeymap(): KeyBinding[] {
    // `Mod-k` opens the app palette, but `Mod-Shift-k` remains CodeMirror's
    // current-line deletion. CM treats the extra Shift as compatible with the
    // shorter binding, so reserve the exact owned chord ahead of cross-focus.
    return [
      { key: "Shift-Mod-k", run: () => deleteLine(this.view) },
      ...this.crossFocusShortcutKeymap(),
      ...this.sourceEditorShortcutKeymap()
    ];
  }

  private editorShortcutBindings(): KeyBinding[] {
    return [
      {
        any: (view, event) =>
          event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"
            ? deleteLine(view)
            : false
      },
      ...this.editorShortcutKeymap()
    ];
  }

  private handleViewUpdate(update: ViewUpdate) {
    if (this.destroyed) return;
    const isExternal = update.transactions.some((transaction) =>
      transaction.annotation(modelPatchOrigin) || transaction.annotation(resetOrigin)
    );
    if (update.docChanged) {
      // Task 48 correction: notify before any commit debounce, so a runtime
      // diagnostic marker becomes dirty/hidden on this exact keystroke.
      this.options.onEditorBufferChanged?.();
      // Any doc change anywhere invalidates typed set/declaration semantic
      // metadata currency immediately; only a fresh compile (refreshStatementRanges)
      // proves doc.bindingAnalysis/doc.setStatements describe this exact buffer again.
      this.typedSemanticMetadataFresh = false;
      if (!this.applyingTypedInitializerStep) this.repeatingTypedInitializerStep = null;
      this.statementRanges = mapStatementRangeIndex(this.statementRanges, update.changes);
      this.printLayoutRanges = mapPrintLayoutRangeIndex(this.printLayoutRanges, update.changes);
      this.typedDeclarationRanges = mapTypedDeclarationRangeIndex(this.typedDeclarationRanges, update.changes);
      this.typedDeclarationFieldRanges = mapTypedDeclarationFieldRangeIndex(this.typedDeclarationFieldRanges, update.changes);
      this.setStatementRanges = mapSetStatementRangeIndex(this.setStatementRanges, update.changes);
      this.setStatementFieldRanges = mapSetStatementFieldRangeIndex(this.setStatementFieldRanges, update.changes);
      this.templateHoleRanges = mapTemplateHoleRangeIndex(this.templateHoleRanges, update.changes);
      this.propertyBindingRanges = mapPropertyBindingRangeIndex(this.propertyBindingRanges, update.changes);
      this.scopeBodyRanges = mapScopeBodyRangeIndex(this.scopeBodyRanges, update.changes);
      this.atStopRange = mapAtStopRange(this.atStopRange, update.changes);
      this.staleDiagnosticBaseline = mapPositionedDiagnostics(this.staleDiagnosticBaseline, update.changes);
      // A dirty edit may have shifted an intact target or invalidated one of
      // its delimiter anchors. Reconcile CM's replacement set immediately;
      // range discovery itself still waits for a valid compiled snapshot.
      this.pendingFoldProjection = true;
      this.requestDecorationRefresh();
      // Do not leave an old runtime marker mapped through the text change for
      // the linter delay. This applies the same dirty-buffer layer the linter
      // will later compute, synchronously after the stale baseline was mapped.
      this.refreshDiagnosticsNow();
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
        const head = this.view.state.selection.main.head;
        const elementId = elementIdAtCursor(this.statementRanges, head);
        if (elementId && this.uiStore.getState().selectedElementId !== elementId) {
          this.publishingCanvasSelection = true;
          try {
            this.uiStore.getState().setSelectedElementId(elementId);
          } finally {
            this.publishingCanvasSelection = false;
          }
        }
        // A cursor position can never be inside both an element statement and a
        // typed declaration statement, so this never races with the branch above.
        const bindingId = typedDeclarationBindingIdAtCursor(this.typedDeclarationRanges, head);
        if (bindingId) {
          const subject = this.uiStore.getState().selectionSubject;
          if (subject.kind !== "binding" || subject.bindingId !== bindingId) {
            this.uiStore.getState().setSelectedBindingId(bindingId);
          }
        }
      }
    }
    if (update.docChanged) this.applyPendingUiSync();
  }

  private runUndo() {
    if (this.protocol.composing) return true;
    if (this.cancelActivePickForHistory()) return true;
    if (this.activeValueStepGesture) this.flush("command");
    // The editor owns only its uncommitted buffer. Never infer ownership from
    // CodeMirror's history depth or command result: a stale/local entry must
    // not prevent a clean editor from reaching the document history, while a
    // dirty buffer must never be flushed or discarded by document Undo.
    if (this.hasPendingText()) {
      undo(this.view);
      this.finishLocalHistoryAtCommitBoundary();
      return true;
    }
    dispatchCommand("undo");
    return true;
  }

  private runRedo() {
    if (this.protocol.composing) return true;
    if (this.cancelActivePickForHistory()) return true;
    if (this.activeValueStepGesture) this.flush("command");
    if (this.hasPendingText()) {
      redo(this.view);
      this.finishLocalHistoryAtCommitBoundary();
      return true;
    }
    dispatchCommand("redo");
    return true;
  }

  /** Restores the clean editor boundary after a local Undo/Redo reaches the
   * committed text. This is deliberately independent from the boolean result
   * of CodeMirror's command. */
  private finishLocalHistoryAtCommitBoundary() {
    if (this.hasPendingText()) return;
    this.cancelCommitTimer();
    this.burstStartCursorLine = null;
    this.activeValueStepGesture = null;
    this.pendingKeyboardValueStep = null;
    this.store.getState().setSourceEditorPreviewText(null);
    this.clearCmHistory();
    this.requestDecorationRefresh();
    forceLinting(this.view);
  }

  /** A command/pick session captures insertion state. Never mutate its source buffer
   * through CodeMirror history while it remains active. Cmd/Ctrl+Z/Y first cancel the
   * session and are consumed; a later press can edit text normally. */
  private cancelActivePickForHistory() {
    const ui = this.uiStore.getState();
    if (ui.commandLineSession) return dispatchCommand("cancelCommandLineSession") !== false;
    if (ui.activePointPickTarget) return dispatchCommand("cancelPointPick") !== false;
    if (ui.activeNumericReferencePickTarget) return dispatchCommand("cancelNumericReferencePick") !== false;
    if (ui.activeLinePickTarget) return dispatchCommand("cancelLinePick") !== false;
    if (ui.activeTemplateInsertion) return dispatchCommand("cancelTemplateInsertion") !== false;
    return false;
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
    if (state.docText !== state.sourceText) {
      // sourceText currently has fatal diagnostics; doc is last-good from before
      // it, so its bindingAnalysis/setStatements no longer describe sourceText.
      this.typedSemanticMetadataFresh = false;
      return;
    }
    if (this.view.state.doc.toString() !== normalizeSourceTextForEditor(state.sourceText)) {
      // Never project a stale committed statement/span into another CM state.
      this.statementRanges = new Map();
      this.printLayoutRanges = new Map();
      this.typedDeclarationRanges = new Map();
      this.typedDeclarationFieldRanges = new Map();
      this.setStatementRanges = new Map();
      this.setStatementFieldRanges = new Map();
      this.templateHoleRanges = new Map();
      this.propertyBindingRanges = new Map();
      this.scopeBodyRanges = [];
      this.atStopRange = null;
      this.typedSemanticMetadataFresh = false;
      this.refreshFoldGutter();
      return;
    }
    this.statementRanges = createStatementRangeIndex(this.view.state.doc, state.doc.statementMap);
    this.printLayoutRanges = createPrintLayoutRangeIndex(this.view.state.doc, state.doc.statementMap);
    this.typedDeclarationRanges = createTypedDeclarationRangeIndex(this.view.state.doc, state.doc.statementMap);
    this.typedDeclarationFieldRanges = createTypedDeclarationFieldRangeIndex(this.view.state.doc, state.doc.statementMap, state.doc.statements);
    this.setStatementRanges = createSetStatementRangeIndex(this.view.state.doc, state.doc.statementMap);
    this.setStatementFieldRanges = createSetStatementFieldRangeIndex(this.view.state.doc, state.doc.statementMap, state.doc.statements);
    this.templateHoleRanges = createTemplateHoleRangeIndex(this.view.state.doc, state.doc.statementMap, state.doc.statements, state.doc.textTemplates);
    this.propertyBindingRanges = createPropertyBindingRangeIndex(this.view.state.doc, state.doc.statementMap, state.doc.statements, state.doc.propertyBindings);
    this.scopeBodyRanges = state.doc.bindingAnalysis
      ? createScopeBodyRangeIndex(this.view.state.doc, state.doc.statementMap, state.doc.bindingAnalysis.catalog.scopeIndex)
      : [];
    this.atStopRange = createAtStopRange(this.view.state.doc, state.doc.statementMap);
    this.staleDiagnosticBaseline = toStaleDiagnostics(this.view.state.doc, state.diagnostics);
    // doc.bindingAnalysis/doc.setStatements were just rebuilt from exactly this
    // live buffer's text - proven current until the next doc-changing transaction.
    this.typedSemanticMetadataFresh = true;
    this.refreshFoldGutter();
  }

  private refreshFoldGutter() {
    this.view.dispatch({
      annotations: [foldGutterRefresh.of("fold-gutter-refresh"), Transaction.addToHistory.of(false)]
    });
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

  /** Extracted so tryApplyPendingEvaluation can recompute the exact same
   * diagnostics the CM linter itself would produce (see the comment there
   * for why forceLinting alone is not reliable for a second push within the
   * same document revision). */
  private diagnosticsExtensionSource(): DiagnosticsExtensionSource {
    return {
      isComposing: () => this.protocol.composing,
      hasPendingText: () => this.hasPendingText(),
      committedDiagnostics: () => [...this.store.getState().diagnostics, ...this.store.getState().bindingIssueDiagnostics],
      runtimeDiagnostics: () => this.runtimeDiagnostics(),
      staleBaseline: () => this.staleDiagnosticBaseline,
      upgradeDslMajorVersion: (target) => this.store.getState().upgradeDslMajorVersion(target)
    };
  }

  /** Imperative counterpart to the linter source. Unlike forceLinting this
   * always replaces CodeMirror's diagnostic state, including two evaluation
   * updates in the same document revision. Never runs during composition,
   * where the lint extension intentionally preserves its last result. */
  private refreshDiagnosticsNow() {
    if (this.destroyed || this.protocol.composing) return;
    this.view.dispatch(setDiagnostics(this.view.state, diagnosticsForCurrentView(this.view, this.diagnosticsExtensionSource())));
  }

  /** Task 45/48: the same isSourceDirty/isEvaluationStale pair
   * InspectorPanel.tsx derives from its own React state (docText !==
   * sourceText - the canonical store-level signal, the only one Inspector
   * can see), recomputed here from this controller's own
   * docText/sourceText/compiledDocumentRevision/appliedEvaluation
   * bookkeeping, OR'd with hasPendingText() - the live, uncommitted
   * CodeMirror buffer state Inspector has no access to at all. A single
   * keystroke makes hasPendingText() true immediately, before the ~50ms
   * debounce that would otherwise update docText/sourceText, so this must be
   * included for isSourceDirty to be correct on the very next read, not just
   * after the next commit. Read live on every call (never cached) - see
   * isRuntimeBindingDisplayFreshForGutter/runtimeDiagnostics, the two callers
   * that both reduce this same input through runtimeBindingFreshness.ts's one
   * shared predicate rather than a second inline rule. */
  private currentRuntimeFreshnessInput() {
    const state = this.store.getState();
    return {
      isSourceDirty: state.docText !== state.sourceText || this.hasPendingText(),
      isEvaluationStale: !this.appliedEvaluation || this.appliedEvaluation.compiledDocumentRevision !== state.compiledDocumentRevision
    };
  }

  private isRuntimeBindingDisplayFreshForGutter() {
    return isRuntimeBindingDisplayFresh(this.currentRuntimeFreshnessInput());
  }

  /** Task 48: fresh TS/Rust ScalarEvaluation runtime errors adapted to
   * DslDiagnostic, for the gutter linter and the Problems popover. Computed
   * fresh on every call - never cached/pushed - so a dirty keystroke or a
   * stale evaluation makes this empty on the very next read, without waiting
   * for the next evaluation round-trip. Never re-parses: reuses this exact
   * compiled document's own Task 48 span context (state.doc.spans) and Task
   * 22's precomputed occurrenceKeysByBindingId, both already O(1)/O(bindings). */
  public runtimeDiagnostics() {
    const state = this.store.getState();
    if (!state.doc.bindingAnalysis) return [];
    return runtimeScalarDiagnostics({
      computedScalarBindings: this.appliedEvaluation?.evaluation.computedScalarBindings,
      bindingAnalysis: state.doc.bindingAnalysis,
      statements: state.doc.statements,
      spans: state.doc.spans,
      elementIdByStatementIndex: state.doc.statementMap.elementIdByStatementIndex,
      propertySourcesByOccurrenceKey: state.doc.propertyBindings ?? new Map(),
      occurrenceKeysByBindingId: state.doc.occurrenceKeysByBindingId ?? new Map(),
      freshness: this.currentRuntimeFreshnessInput()
    });
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
      pickCandidates: this.currentPickCandidates(),
      groupPrintEnabledLookup: this.isRuntimeBindingDisplayFreshForGutter()
        ? { propertyBindings: state.doc.propertyBindings, byElementId: state.doc.statementMap.byElementId }
        : undefined
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

  private handleElementStateGutterAction(lineFrom: number) {
    if (this.protocol.composing || this.flush("command") === "blocked-composition") return false;
    const elementId = elementIdAtCursor(this.statementRanges, lineFrom);
    if (!elementId || !this.store.getState().elements.some((element) => element.id === elementId)) return false;
    return dispatchCommand("cycleElementActivity", { elementId }) !== false;
  }

  private sourceIsApplied() {
    return this.protocol.appliedRevision === this.store.getState().sourceRevision;
  }

  private hasSourceFocus() {
    return this.view.hasFocus;
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
      const target = {
        elementId: parent.id,
        branch: isConditionalGroupElement(parent) && current.conditionalBranch === "else"
          ? "else" as const
          : "primary" as const
      };
      if (!isFoldTargetExpanded(target, this.uiStore.getState().groupFoldById)) {
        this.uiStore.getState().setFoldTargetExpanded(target, true);
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

  /** Keeps placeholder clicks on the same UI-state path as gutter and keyboard folds. */
  private createFoldPlaceholder(view: EditorView) {
    const placeholder = document.createElement("span");
    placeholder.textContent = "…";
    placeholder.setAttribute("aria-label", view.state.phrase("folded code"));
    placeholder.title = view.state.phrase("unfold");
    placeholder.className = "cm-foldPlaceholder";
    placeholder.onclick = (event) => {
      if (!(event.target instanceof Node)) return;
      const position = view.posAtDOM(event.target);
      const target = foldTargets(
        this.statementRanges,
        this.store.getState().elements,
        this.uiStore.getState().groupFoldById
      ).find((candidate) => candidate.from === position);
      if (target) this.changeFold(target, "unfold");
      event.preventDefault();
    };
    return placeholder;
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

  /** Always consumes the click: @codemirror/language's built-in foldGutter click
   * fallback would otherwise mutate CM fold state directly when this returns false,
   * bypassing the app store entirely. */
  private handleFoldGutterClick(lineFrom: number, event: MouseEvent) {
    event.preventDefault();
    const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineFrom);
    if (target) this.changeFold(target, "toggle");
    return true;
  }

  private changeFoldAtCursor(mode: "fold" | "unfold") {
    const lineFrom = this.view.state.doc.lineAt(this.view.state.selection.main.head).from;
    const target = foldTargetAtLine(this.statementRanges, this.store.getState().elements, lineFrom);
    return target ? this.changeFold(target, mode) : false;
  }

  private changeFold(target: { elementId: string; branch: "statement" | "primary" | "else" }, mode: "fold" | "unfold" | "toggle") {
    if (this.protocol.composing) return true;
    const currentExpanded = isFoldTargetExpanded(target, this.uiStore.getState().groupFoldById);
    const expanded = mode === "toggle" ? !currentExpanded : mode === "unfold";
    this.uiStore.getState().setFoldTargetExpanded(target, expanded);
    return true;
  }

  private changeAllFolds(expanded: boolean) {
    if (this.protocol.composing) return true;
    const targets = [...this.statementRanges.values()].flatMap((range) => range.foldTargets);
    this.uiStore.getState().setFoldTargetsExpanded(targets, expanded);
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
