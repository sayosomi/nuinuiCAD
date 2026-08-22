import { create } from "zustand";
import { NEW_DOCUMENT_DSL_MAJOR_VERSION, type DslDocumentData } from "../dsl/dslDocument";
import type {
  DslDiagnostic } from "../dsl/dslTypes";
import type { TypedDependencyGraph } from "../scalars/typedDependencyGraph";
import {
  commitLineSplicePatch,
  commitModelBridge,
  compileCanonicalText,
  compileFreshCanonicalText,
  regenerateCanonicalFromModel,
  type CanonicalDocumentValue,
  type LastGoodDslDocument,
  type TextCompileResult
} from "../document/canonicalDocument";
import { assertReconcileSane,
  assertShadowEquivalent,
  shadowAssertEnabled } from "../document/shadowTextAssert";
import { initialGroupFoldForLoadedDocument } from "../model/groups";
import { defaultVisibilityProfile,
  visibilityIdFromName } from "../model/visibilityProfiles";
import {
  createPaletteColor,
  defaultDocumentPalette,
  isValidPaletteColorId,
  type LegacyDocumentPalette,
  type LegacyPaletteColor
} from "../palette/palette";
import { sampleElements } from "../sampleData";
import type { LineSplice } from "../document/textPatch";
import type { SourceUpdate } from "../editor/sourceEditorTypes";
import { sourceEditSession } from "../editor/sourceEditSession";
import {
  beginPreviewMutation,
  beginSourceChange,
  bindElementsToActiveSample,
  measureCompile
} from "../performance/benchmarkInstrumentation";
import type {
  CadElement,
  DrawingModifierDefinition,
  DrawingProfile,
  ElementId,
  Layout,
  PrintOutput,
  SvgOutput,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { useCadUiStore, type CadElementSelection } from "./cadUiStore";

export type SelectionSnapshot = {
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
};

export type TextSnapshot = {
  text: string;
  selection: SelectionSnapshot;
  selectionPast: SelectionSnapshot[];
  selectionFuture: SelectionSnapshot[];
  cursorLine: number | null;
};

export type DocumentMutationResult =
  | { status: "applied" | "noop" }
  | { status: "rejected"; reason: "pending-text" | "composition" | "invalid-change" };

export type CommitTextOrigin = "editor" | "file" | "test" | "bridge-internal" | "command";

export type CadDocumentState = {
  /** The only canonical document value. */
  sourceText: string;
  /** Monotonic notification sequence for source editor adapters. */
  sourceRevision: number;
  /** DSL source-map revision for the current source compilation attempt,
   * including fatal source text whose last-good document is retained. */
  currentSourceRevision: number;
  /** Metadata for the latest source revision. Subscribers receive every transition synchronously. */
  sourceUpdate: SourceUpdate;
  /** Last successful compile; never null. */
  doc: LastGoodDslDocument;
  /** Text represented by doc. A mismatch means sourceText currently has fatal diagnostics. */
  docText: string;
  /** Monotonic identity of the last-good compiled document. It is independent from
   * sourceRevision && remains stable while fatal sourceText keeps the prior document. */
  compiledDocumentRevision: number;
  /** Diagnostics for sourceText, including fatal diagnostics while doc remains last-good. */
  diagnostics: DslDiagnostic[];
  /** Task 48: BindingAnalysis.issues adapted to DslDiagnostic, for sourceText,
   * same current/fatal-inclusive lifecycle as `diagnostics` above. Kept
   * separate from `diagnostics` deliberately - see
   * CompiledDslDocument.bindingIssueDiagnostics for why it must never gate
   * compilation. Display surfaces (gutter, Problems popover) concatenate
   * both arrays themselves. */
  bindingIssueDiagnostics: readonly DslDiagnostic[];
  /** Static dependency graph for the current sourceText, including fatal compile attempts. */
  typedDependencyGraph?: TypedDependencyGraph;
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  elements: CadElement[];
  /** @deprecated Derived compatibility view. sourceText remains canonical. */
  modifiers?: DrawingModifierDefinition[];
  /** @deprecated Derived compatibility view. sourceText remains canonical. */
  drawingProfiles: DrawingProfile[];
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  palette: LegacyDocumentPalette;
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  visibilityRoles: VisibilityRole[];
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  visibilityProfiles: VisibilityProfile[];
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  activeVisibilityProfileId: string;
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  layouts: Layout[];
  printOutputs: PrintOutput[];
  svgOutputs: SvgOutput[];
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  evaluationLimitIndex: number | undefined;
  previewElements: CadElement[] | null;
  /** Matching compiled metadata for a valid Source Editor preview. */
  previewCompiledDocument: LastGoodDslDocument | null;
  /** Evaluation divider paired with previewElements when a preview changes insertion order. */
  previewEvaluationLimitIndex: number | undefined | null;
  past: TextSnapshot[];
  future: TextSnapshot[];
  currentFilePath: string | null;
  /** sourceText at the last successful save/load; null means an unsaved import. */
  savedSourceText: string | null;
  dirtySinceSave: boolean;
  /** VS Code Canvas-only selection history inside the current source checkpoint. */
  selectionPast: SelectionSnapshot[];
  selectionFuture: SelectionSnapshot[];
  commitText: (
    nextText: string,
    origin: CommitTextOrigin,
    options?: { cursorLineAtBurstStart: number | null }
  ) => void;
  /** Ephemeral valid DSL projection used while a source-editor gesture is still uncommitted. */
  setSourceEditorPreviewText: (sourceText: string | null) => void;
  previewDocumentChange: (change: Partial<DslDocumentData>) => DocumentMutationResult;
  clearPreviewDocumentChange: () => void;
  commitDocumentChange: (change: Partial<DslDocumentData>) => DocumentMutationResult;
  /** Commits precomputed line splices directly (no element-model diff), tagged
   * "model-patch" so the Source Editor maps existing selection through the
   * change instead of resetting to a line-only cursor restore. Used by
   * non-element text mutations such as the typed binding rename command. */
  commitLineSplices: (
    splices: readonly LineSplice[],
    options?: { createdElementIds?: readonly ElementId[] }
  ) => DocumentMutationResult;
  setElements: (elements: CadElement[]) => void;
  updateElement: (id: ElementId, patch: Partial<CadElement>) => void;
  setActiveVisibilityProfileId: (id: string) => void;
  addVisibilityRole: (name?: string) => void;
  updateVisibilityRole: (id: string, patch: Partial<VisibilityRole>) => void;
  deleteVisibilityRole: (id: string) => void;
  addVisibilityProfile: (name?: string) => void;
  updateVisibilityProfile: (id: string, patch: Partial<VisibilityProfile>) => void;
  deleteVisibilityProfile: (id: string) => void;
  setVisibilityProfileRoleVisible: (profileId: string, roleId: string, visible: boolean) => void;
  setPalette: (palette: LegacyDocumentPalette) => void;
  updatePaletteColor: (id: string, patch: Partial<LegacyPaletteColor>) => void;
  addPaletteColor: () => void;
  deletePaletteColor: (id: string) => void;
  setDefaultColorId: (id: string) => void;
  replaceDocument: (document: DslDocumentData & { palette?: LegacyDocumentPalette }, filePath: string | null) => void;
  replaceTextDocument: (
    sourceText: string,
    options: { currentFilePath: string | null; dirtySinceSave: boolean }
  ) => void;
  markDocumentSaved: (filePath: string, savedSourceText: string) => void;
  recordCanvasSelection: (previousSelection: SelectionSnapshot) => void;
  undoCanvasSelection: () => boolean;
  redoCanvasSelection: () => boolean;
  reconcileAuthoritativeHistory: (sourceText: string, direction: "undo" | "redo") => "reconciled" | "reset";
  undo: () => void;
  redo: () => void;
};

const HISTORY_LIMIT = 200;
type DocumentCompatibilityView = Pick<
  CadDocumentState,
  | "elements"
  | "modifiers"
  | "drawingProfiles"
  | "visibilityRoles"
  | "visibilityProfiles"
  | "activeVisibilityProfileId"
  | "layouts"
  | "printOutputs"
  | "svgOutputs"
  | "evaluationLimitIndex"
>;

const documentOf = (state: DocumentCompatibilityView): DslDocumentData => ({
  elements: state.elements,
  modifiers: state.modifiers ?? [],
  drawingProfiles: state.drawingProfiles ?? [],
  visibilityRoles: state.visibilityRoles,
  visibilityProfiles: state.visibilityProfiles,
  activeVisibilityProfileId: state.activeVisibilityProfileId,
  layouts: state.layouts,
  printOutputs: state.printOutputs,
  svgOutputs: state.svgOutputs,
  evaluationLimitIndex: state.evaluationLimitIndex
});

const compatibilityViewMatchesDoc = (state: CadDocumentState) => {
  const document = state.doc.document;
  return state.elements === document.elements &&
    state.modifiers === document.modifiers &&
    (document.drawingProfiles === undefined
      ? state.drawingProfiles.length === 0
      : state.drawingProfiles === document.drawingProfiles) &&
    state.visibilityRoles === document.visibilityRoles &&
    state.visibilityProfiles === document.visibilityProfiles &&
    state.activeVisibilityProfileId === document.activeVisibilityProfileId &&
    state.layouts === document.layouts &&
    state.printOutputs === document.printOutputs &&
    state.svgOutputs === document.svgOutputs &&
    state.evaluationLimitIndex === document.evaluationLimitIndex;
};

export const effectiveElements = (
  state: Pick<CadDocumentState, "elements" | "previewElements">
) => state.previewElements ?? state.elements;

/** Compiled metadata paired with a valid Source Editor element preview. */
export const effectiveCompiledDocument = (
  state: Pick<CadDocumentState, "doc" | "previewCompiledDocument">
) => state.previewCompiledDocument ?? state.doc;

/** Keeps preview-only insertion/removal evaluation semantics out of canonical document state. */
export const effectiveEvaluationLimitIndex = (
  state: Pick<CadDocumentState, "evaluationLimitIndex" | "previewEvaluationLimitIndex" | "previewElements">
): number | undefined => state.previewElements === null
  ? state.evaluationLimitIndex
  : state.previewEvaluationLimitIndex === null
    ? state.evaluationLimitIndex
    : state.previewEvaluationLimitIndex;

const clearedPreviewState = () => ({
  previewElements: null,
  previewCompiledDocument: null,
  previewEvaluationLimitIndex: null
});

const cloneSelection = (selection: SelectionSnapshot): SelectionSnapshot => ({
  selectedElementId: selection.selectedElementId,
  selectedElementIds: [...selection.selectedElementIds],
  selectionAnchorElementId: selection.selectionAnchorElementId
});

const selectionSnapshot = (selection: CadElementSelection): SelectionSnapshot => cloneSelection(selection);

const selectionEqual = (left: SelectionSnapshot, right: SelectionSnapshot) =>
  left.selectedElementId === right.selectedElementId &&
  left.selectionAnchorElementId === right.selectionAnchorElementId &&
  left.selectedElementIds.length === right.selectedElementIds.length &&
  left.selectedElementIds.every((id, index) => id === right.selectedElementIds[index]);

const cloneSelectionHistory = (history: readonly SelectionSnapshot[]) => history.map(cloneSelection);

const appendSelectionPast = (past: SelectionSnapshot[], snapshot: SelectionSnapshot) =>
  [...past, cloneSelection(snapshot)].slice(-HISTORY_LIMIT);

const textSnapshot = (
  state: Pick<CadDocumentState, "sourceText">,
  selection: CadElementSelection & { sourceCursorLine: number | null },
  selectionPast: readonly SelectionSnapshot[] = [],
  selectionFuture: readonly SelectionSnapshot[] = []
): TextSnapshot => ({
  text: state.sourceText,
  selection: selectionSnapshot(selection),
  selectionPast: cloneSelectionHistory(selectionPast),
  selectionFuture: cloneSelectionHistory(selectionFuture),
  cursorLine: selection.sourceCursorLine
});

const appendPast = (past: TextSnapshot[], snapshot: TextSnapshot) =>
  [...past, snapshot].slice(-HISTORY_LIMIT);

const dirtyForText = (state: Pick<CadDocumentState, "savedSourceText">, text: string) =>
  state.savedSourceText !== text;

const canonicalFields = (value: CanonicalDocumentValue | TextCompileResult) => {
  const document = value.doc.document;
  return {
    sourceText: value.sourceText,
    currentSourceRevision: "currentCompiled" in value
      ? value.currentCompiled.spans.sourceMap.sourceRevision
      : value.doc.statementMap.sourceRevision,
    doc: value.doc,
    docText: value.docText,
    diagnostics: value.diagnostics,
    bindingIssueDiagnostics: value.bindingIssueDiagnostics,
    typedDependencyGraph: value.typedDependencyGraph,
    elements: document.elements,
    modifiers: document.modifiers ?? [],
    drawingProfiles: document.drawingProfiles ?? [],
    visibilityRoles: document.visibilityRoles,
    visibilityProfiles: document.visibilityProfiles,
    activeVisibilityProfileId: document.activeVisibilityProfileId,
    layouts: document.layouts,
    printOutputs: document.printOutputs,
    svgOutputs: document.svgOutputs,
    evaluationLimitIndex: document.evaluationLimitIndex
  };
};

const sourceUpdateFields = (
  state: Pick<CadDocumentState, "sourceRevision">,
  kind: SourceUpdate["kind"],
  splices: readonly LineSplice[] = []
) => {
  const revision = state.sourceRevision + 1;
  const sourceUpdate: SourceUpdate =
    kind === "model-patch"
      ? { revision, kind, splices }
      : { revision, kind };
  return { sourceRevision: revision, sourceUpdate };
};

const canonicalRevisionFields = (
  state: Pick<CadDocumentState, "sourceRevision" | "compiledDocumentRevision" | "doc">,
  value: Pick<CanonicalDocumentValue, "sourceText" | "docText" | "doc">,
  kind: SourceUpdate["kind"],
  splices: readonly LineSplice[] = []
) => {
  const update = sourceUpdateFields(state, kind, splices);
  return {
    ...update,
    compiledDocumentRevision: value.doc === state.doc ? state.compiledDocumentRevision : state.compiledDocumentRevision + 1
  };
};

const documentFromChange = (
  state: CadDocumentState,
  change: Partial<DslDocumentData>
): DslDocumentData => {
  const before = documentOf(state);
  return {
    elements: change.elements ?? before.elements,
    modifiers: change.modifiers ?? before.modifiers ?? [],
    drawingProfiles: change.drawingProfiles ?? before.drawingProfiles ?? [],
    visibilityRoles: change.visibilityRoles ?? before.visibilityRoles,
    visibilityProfiles: change.visibilityProfiles ?? before.visibilityProfiles,
    activeVisibilityProfileId: change.activeVisibilityProfileId ?? before.activeVisibilityProfileId,
    layouts: change.layouts ?? before.layouts,
    printOutputs: change.printOutputs ?? before.printOutputs,
    svgOutputs: change.svgOutputs ?? before.svgOutputs,
    evaluationLimitIndex: Object.hasOwn(change, "evaluationLimitIndex")
      ? change.evaluationLimitIndex
      : before.evaluationLimitIndex
  };
};

const modelCommit = (
  state: CadDocumentState,
  change: Partial<DslDocumentData>
): {
  state: Partial<CadDocumentState>;
  result: DocumentMutationResult;
} => {
  const previousSelection = useCadUiStore.getState();
  let current = state;
  let rebased = false;
  if (!compatibilityViewMatchesDoc(state)) {
    if (state.doc.moduleMaterialization) {
      console.error("[canonicalDocument] Module runtime view is not source-compatible; refusing model rebase.");
      useCadUiStore.getState().clearPickMode();
      useCadUiStore.getState().setCommandErrorMessage("Module文書のsourceとruntimeが同期していないため操作を適用できません。");
      return { state: clearedPreviewState(), result: { status: "rejected", reason: "invalid-change" } };
    }
    // Legacy tests && transitional facade callers may seed the derived view directly.
    // Rebase that setup into canonical text before creating the real history entry.
    const regenerated = regenerateCanonicalFromModel(documentOf(state), state.doc.majorVersion);
    current = { ...state, ...canonicalFields(regenerated) };
    rebased = true;
  }
  const afterDocument = documentFromChange(current, change);
  // `current` is the committed snapshot selected by this mutation boundary.
  // Callers that hold an independently captured snapshot use the optional
  // source-map guard on commitModelBridge; this store path has already chosen
  // the current canonical snapshot (including compatibility rebases).
  const result = commitModelBridge(current, afterDocument);

  if (result.status === "rejected") {
    console.error(`[canonicalDocument] ${result.reason}`);
    useCadUiStore.getState().clearPickMode();
    useCadUiStore.getState().setCommandErrorMessage("現在のDSLテキストにはこの操作を適用できません。");
    return { state: clearedPreviewState(), result: { status: "rejected", reason: "invalid-change" } };
  }
  if (result.status === "unapplied") {
    // Fail closed: do not regenerate a whole document || mutate either source
    // snapshot when a multi-line structural patch cannot preserve layout.
    console.error(`[canonicalDocument] ${result.reason}`);
    useCadUiStore.getState().clearPickMode();
    useCadUiStore.getState().setCommandErrorMessage(result.reason);
    return { state: clearedPreviewState(), result: { status: "rejected", reason: "invalid-change" } };
  }
  if (result.status === "noop") {
    return {
      state: {
        ...canonicalFields(current),
        ...clearedPreviewState()
      },
      result: { status: "noop" }
    };
  }

  let value: CanonicalDocumentValue;
  let updateKind: SourceUpdate["kind"] = "model-patch";
  let splices: readonly LineSplice[] = [];
  if (result.status === "failed") {
    if (current.doc.moduleMaterialization) {
      console.error(`[canonicalDocument] Module source patchを適用できないため変更を破棄します: ${result.reason}`);
      useCadUiStore.getState().clearPickMode();
      useCadUiStore.getState().setCommandErrorMessage("Module文書のsourceを安全に更新できないため操作を適用できません。");
      return { state: clearedPreviewState(), result: { status: "rejected", reason: "invalid-change" } };
    }
    updateKind = "reset";
    if (shadowAssertEnabled) {
      console.error(`[canonicalDocument] 行パッチを適用できないため全体再生成します: ${result.reason}`);
    }
    try {
      value = regenerateCanonicalFromModel(afterDocument, current.doc.majorVersion);
    } catch (error) {
      console.error(`[canonicalDocument] 全体再生成にも失敗したため変更を破棄します: ${String(error)}`);
      useCadUiStore.getState().clearPickMode();
      useCadUiStore.getState().setCommandErrorMessage("現在のDSLテキストにはこの操作を適用できません。");
      return { state: clearedPreviewState(), result: { status: "rejected", reason: "invalid-change" } };
    }
  } else {
    value = result.value;
    splices = result.splices;
  }

  if (shadowAssertEnabled && !current.doc.moduleMaterialization) {
    if (!assertShadowEquivalent(afterDocument, value.doc.document, current.doc.majorVersion)) {
      updateKind = "reset";
      try {
        value = regenerateCanonicalFromModel(afterDocument, current.doc.majorVersion);
      } catch (error) {
        console.error(`[canonicalDocument] 等価assert後の全体再生成に失敗したため変更を破棄します: ${String(error)}`);
        useCadUiStore.getState().clearPickMode();
        useCadUiStore.getState().setCommandErrorMessage("現在のDSLテキストにはこの操作を適用できません。");
      return { state: clearedPreviewState(), result: { status: "rejected", reason: "invalid-change" } };
      }
    }
    assertReconcileSane(current.doc, value.sourceText, afterDocument);
  }

  return {
    state: {
      ...canonicalFields(value),
      ...clearedPreviewState(),
      past: appendPast(
        state.past,
        textSnapshot(current, previousSelection, state.selectionPast, state.selectionFuture)
      ),
      future: [],
      selectionPast: [],
      selectionFuture: [],
      dirtySinceSave: dirtyForText(current, value.sourceText),
      ...canonicalRevisionFields(state, value, rebased ? "reset" : updateKind, splices)
    },
    result: { status: "applied" }
  };
};

const initialSnapshot = (): DslDocumentData => ({
  elements: sampleElements,
  modifiers: [],
  drawingProfiles: [],
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  layouts: [],
  printOutputs: [],
  svgOutputs: [],
  evaluationLimitIndex: undefined
});

export const initialCadDocumentState = (): Omit<CadDocumentState, keyof CadDocumentActions> => {
  const snapshot = initialSnapshot();
  const canonical = regenerateCanonicalFromModel(snapshot, NEW_DOCUMENT_DSL_MAJOR_VERSION);
  return {
    ...canonicalFields(canonical),
    palette: defaultDocumentPalette(),
    sourceRevision: 0,
    sourceUpdate: { revision: 0, kind: "reset" },
    compiledDocumentRevision: 0,
    ...clearedPreviewState(),
    past: [],
    future: [],
    selectionPast: [],
    selectionFuture: [],
    currentFilePath: null,
    savedSourceText: canonical.sourceText,
    dirtySinceSave: false
  };
};

type CadDocumentActions = Pick<
  CadDocumentState,
  | "commitText"
  | "setSourceEditorPreviewText"
  | "previewDocumentChange"
  | "clearPreviewDocumentChange"
  | "commitDocumentChange"
  | "commitLineSplices"
  | "setElements"
  | "updateElement"
  | "setActiveVisibilityProfileId"
  | "addVisibilityRole"
  | "updateVisibilityRole"
  | "deleteVisibilityRole"
  | "addVisibilityProfile"
  | "updateVisibilityProfile"
  | "deleteVisibilityProfile"
  | "setVisibilityProfileRoleVisible"
  | "setPalette"
  | "updatePaletteColor"
  | "addPaletteColor"
  | "deletePaletteColor"
  | "setDefaultColorId"
  | "replaceDocument"
  | "replaceTextDocument"
  | "markDocumentSaved"
  | "recordCanvasSelection"
  | "undoCanvasSelection"
  | "redoCanvasSelection"
  | "reconcileAuthoritativeHistory"
  | "undo"
  | "redo"
>;

const visibilityRoleId = (name: string, roles: VisibilityRole[]) => {
  const base = visibilityIdFromName(name, `role-${roles.length + 1}`);
  const used = new Set(roles.map((role) => role.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
};

const visibilityProfileId = (name: string, profiles: VisibilityProfile[]) => {
  const base = visibilityIdFromName(name, `profile-${profiles.length + 1}`);
  const used = new Set(profiles.map((profile) => profile.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
};


const rejectDocumentMutation = (
  reason: Extract<DocumentMutationResult, { status: "rejected" }>["reason"]
): DocumentMutationResult => {
  const ui = useCadUiStore.getState();
  ui.clearPickMode();
  ui.setCommandErrorMessage(
    reason === "composition"
      ? "日本語入力の確定中は文書を変更できません。入力を確定してから再操作してください。"
      : reason === "pending-text"
        ? "DSL入力を確定しました。最新の文書で操作をもう一度実行してください。"
        : "現在のDSLテキストにはこの操作を適用できません。"
  );
  return { status: "rejected", reason };
};

const guardDocumentMutation = (): DocumentMutationResult | null => {
  if (sourceEditSession.isComposing()) return rejectDocumentMutation("composition");
  if (!sourceEditSession.hasPendingText()) return null;
  const flushResult = sourceEditSession.flush("model-mutation");
  return rejectDocumentMutation(flushResult === "blocked-composition" ? "composition" : "pending-text");
};

const rejectExternalDocumentReset = () => {
  if (!sourceEditSession.isComposing()) return false;
  useCadUiStore.getState().setCommandErrorMessage(
    "日本語入力の確定中は文書を置き換えられません。入力を確定してから再操作してください。"
  );
  return true;
};

export const useCadDocumentStore = create<CadDocumentState>((set, get) => ({
  ...initialCadDocumentState(),
  commitText: (nextText, origin, options) => {
    const sourceChangeTiming = origin === "editor" ? beginSourceChange() : null;
    if (sourceEditSession.isComposing()) {
      useCadUiStore.getState().setCommandErrorMessage(
        "日本語入力の確定中はDSL入力をcommitできません。入力を確定してから再操作してください。"
      );
      return;
    }
    let selectionElements: CadElement[] | null = null;
    set((state) => {
      if (nextText === state.sourceText) return clearedPreviewState();
      const previousSelection = useCadUiStore.getState();
      const result = measureCompile(sourceChangeTiming, () => compileCanonicalText(state, nextText));
      if (sourceChangeTiming && result.docText === result.sourceText) {
        bindElementsToActiveSample(result.doc.document.elements, sourceChangeTiming);
      }
      selectionElements = result.doc.document.elements;
      // A typing burst can move the cursor before it commits; the snapshot must
      // pair the pre-burst text with the pre-burst cursor line, not wherever the
      // cursor ended up after the burst.
      const snapshotCursorLine = options ? options.cursorLineAtBurstStart : previousSelection.sourceCursorLine;
      return {
        ...canonicalFields(result),
        ...clearedPreviewState(),
        past: appendPast(
          state.past,
          textSnapshot(
            state,
            { ...previousSelection, sourceCursorLine: snapshotCursorLine },
            state.selectionPast,
            state.selectionFuture
          )
        ),
        future: [],
        selectionPast: [],
        selectionFuture: [],
        dirtySinceSave: dirtyForText(state, result.sourceText),
        ...canonicalRevisionFields(state, result, origin === "editor" ? "editor" : "reset")
      };
    });
    if (selectionElements) useCadUiStore.getState().reconcileSelectionWithElements(selectionElements);
  },
  setSourceEditorPreviewText: (sourceText) => {
    set((state) => {
      if (sourceText === null || sourceText === state.sourceText) return clearedPreviewState();
      const result = compileCanonicalText(state, sourceText);
      // Preserve the last-good canonical document for invalid live text, matching
      // the normal editor behavior. Value stepping itself always produces valid DSL.
      return result.docText === result.sourceText
        ? {
            previewElements: result.doc.document.elements,
            previewCompiledDocument: result.doc,
            previewEvaluationLimitIndex: null
          }
        : clearedPreviewState();
    });
  },
  previewDocumentChange: (change) => {
    const previewMutationTiming = beginPreviewMutation();
    const guarded = guardDocumentMutation();
    if (guarded) {
      set(clearedPreviewState());
      return guarded;
    }
    if (change.elements === undefined) return { status: "noop" };
    set({
      previewElements: change.elements,
      previewCompiledDocument: null,
      previewEvaluationLimitIndex: Object.hasOwn(change, "evaluationLimitIndex")
        ? change.evaluationLimitIndex
        : null
    });
    if (previewMutationTiming) bindElementsToActiveSample(change.elements, previewMutationTiming);
    return { status: "applied" };
  },
  clearPreviewDocumentChange: () => set(clearedPreviewState()),
  commitDocumentChange: (change) => {
    const guarded = guardDocumentMutation();
    if (guarded) {
      set(clearedPreviewState());
      return guarded;
    }
    let result: DocumentMutationResult = { status: "noop" };
    set((state) => {
      const outcome = modelCommit(state, change);
      result = outcome.result;
      return outcome.state;
    });
    return result;
  },
  commitLineSplices: (splices, options) => {
    const guarded = guardDocumentMutation();
    if (guarded) {
      set(clearedPreviewState());
      return guarded;
    }
    let result: DocumentMutationResult = { status: "noop" };
    set((state) => {
      const previousSelection = useCadUiStore.getState();
      const outcome = commitLineSplicePatch(state, splices, options);
      if (outcome.status === "noop") {
        result = { status: "noop" };
        return { ...canonicalFields(state), ...clearedPreviewState() };
      }
      if (outcome.status === "failed") {
        console.error(`[canonicalDocument] ${outcome.reason}`);
        useCadUiStore.getState().setCommandErrorMessage("現在のDSLテキストにはこの操作を適用できません。");
        result = { status: "rejected", reason: "invalid-change" };
        return clearedPreviewState();
      }
      result = { status: "applied" };
      return {
        ...canonicalFields(outcome.value),
        ...clearedPreviewState(),
        past: appendPast(
          state.past,
          textSnapshot(state, previousSelection, state.selectionPast, state.selectionFuture)
        ),
        future: [],
        selectionPast: [],
        selectionFuture: [],
        dirtySinceSave: dirtyForText(state, outcome.value.sourceText),
        ...canonicalRevisionFields(state, outcome.value, "model-patch", outcome.splices)
      };
    });
    return result;
  },
  setElements: (elements) => get().commitDocumentChange({ elements }),
  updateElement: (id, patch) => {
    const elements = documentOf(get()).elements;
    if (!elements.some((element) => element.id === id)) return;
    get().commitDocumentChange({
      elements: elements.map((element) =>
        element.id === id ? ({ ...element, ...patch } as CadElement) : element
      )
    });
  },
  setActiveVisibilityProfileId: (activeVisibilityProfileId) =>
    get().commitDocumentChange({ activeVisibilityProfileId }),
  addVisibilityRole: (name) => {
    const document = documentOf(get());
    const roleName = name?.trim() || `ロール${document.visibilityRoles.length + 1}`;
    get().commitDocumentChange({
      visibilityRoles: [...document.visibilityRoles, {
        id: visibilityRoleId(roleName, document.visibilityRoles),
        name: roleName
      }]
    });
  },
  updateVisibilityRole: (id, patch) => {
    const roles = documentOf(get()).visibilityRoles;
    if (!roles.some((role) => role.id === id)) return;
    get().commitDocumentChange({
      visibilityRoles: roles.map((role) => role.id === id ? { ...role, ...patch, id } : role)
    });
  },
  deleteVisibilityRole: (id) => {
    const document = documentOf(get());
    if (!document.visibilityRoles.some((role) => role.id === id)) return;
    get().commitDocumentChange({
      visibilityRoles: document.visibilityRoles.filter((role) => role.id !== id),
      visibilityProfiles: document.visibilityProfiles.map((profile) => {
        const roleVisibility = { ...profile.roleVisibility };
        delete roleVisibility[id];
        return { ...profile, roleVisibility };
      }),
      elements: document.elements.map((element) =>
        element.type === "group"
          ? { ...element, visibilityRoleIds: (element.visibilityRoleIds ?? []).filter((roleId) => roleId !== id) }
          : element
      )
    });
  },
  addVisibilityProfile: (name) => {
    const document = documentOf(get());
    const profileName = name?.trim() || `表示${document.visibilityProfiles.length + 1}`;
    const profile = {
      id: visibilityProfileId(profileName, document.visibilityProfiles),
      name: profileName,
      defaultRoleVisible: true,
      roleVisibility: {}
    };
    get().commitDocumentChange({
      visibilityProfiles: [...document.visibilityProfiles, profile],
      activeVisibilityProfileId: profile.id
    });
  },
  updateVisibilityProfile: (id, patch) => {
    const profiles = documentOf(get()).visibilityProfiles;
    if (!profiles.some((profile) => profile.id === id)) return;
    get().commitDocumentChange({
      visibilityProfiles: profiles.map((profile) => profile.id === id ? { ...profile, ...patch, id } : profile)
    });
  },
  deleteVisibilityProfile: (id) => {
    const document = documentOf(get());
    if (document.visibilityProfiles.length <= 1 || !document.visibilityProfiles.some((profile) => profile.id === id)) return;
    const visibilityProfiles = document.visibilityProfiles.filter((profile) => profile.id !== id);
    get().commitDocumentChange({
      visibilityProfiles,
      activeVisibilityProfileId:
        document.activeVisibilityProfileId === id
          ? visibilityProfiles[0].id
          : document.activeVisibilityProfileId,
    });
  },
  setVisibilityProfileRoleVisible: (profileId, roleId, visible) => {
    const document = documentOf(get());
    if (!document.visibilityProfiles.some((profile) => profile.id === profileId)) return;
    if (!document.visibilityRoles.some((role) => role.id === roleId)) return;
    get().commitDocumentChange({
      visibilityProfiles: document.visibilityProfiles.map((profile) =>
        profile.id === profileId
          ? { ...profile, roleVisibility: { ...profile.roleVisibility, [roleId]: visible } }
          : profile
      )
    });
  },
  setPalette: (palette) => set({ palette }),
  updatePaletteColor: (id, patch) => {
    const palette = get().palette;
    if (!palette.colors.some((color) => color.id === id)) return;
    set({
      palette: {
        ...palette,
        colors: palette.colors.map((color) => color.id === id ? { ...color, ...patch, id } : color)
      }
    });
  },
  addPaletteColor: () => {
    const palette = get().palette;
    set({ palette: { ...palette, colors: [...palette.colors, createPaletteColor(palette.colors)] } });
  },
  deletePaletteColor: (id) => {
    const palette = get().palette;
    if (id === palette.defaultColorId || !palette.colors.some((color) => color.id === id)) return;
    set({ palette: { ...palette, colors: palette.colors.filter((color) => color.id !== id) } });
  },
  setDefaultColorId: (id) => {
    const palette = get().palette;
    if (!isValidPaletteColorId(palette, id) || palette.defaultColorId === id) return;
    set({ palette: { ...palette, defaultColorId: id } });
  },
  replaceDocument: (snapshot, currentFilePath) => {
    if (rejectExternalDocumentReset()) return;
    let selectionElements: CadElement[] | null = null;
    set((state) => {
      try {
        const canonical = regenerateCanonicalFromModel(snapshot, NEW_DOCUMENT_DSL_MAJOR_VERSION);
        selectionElements = canonical.doc.document.elements;
        return {
          ...canonicalFields(canonical),
          palette: snapshot.palette ?? state.palette,
          ...clearedPreviewState(),
          past: [],
          future: [],
          selectionPast: [],
          selectionFuture: [],
          currentFilePath,
          savedSourceText: canonical.sourceText,
          dirtySinceSave: false,
          ...canonicalRevisionFields(state, canonical, "reset")
        };
      } catch (error) {
        console.error(`[canonicalDocument] 文書読込の正準化に失敗したため現在の文書を維持します: ${String(error)}`);
        return clearedPreviewState();
      }
    });
    if (selectionElements) {
      useCadUiStore.getState().replaceGroupFoldById(initialGroupFoldForLoadedDocument(selectionElements));
      useCadUiStore.getState().applySelection(selectionElements, {
        selectedElementId: null,
        selectedElementIds: [],
        selectionAnchorElementId: null
      });
      useCadUiStore.getState().setSourceCursorLine(null);
    }
  },
  replaceTextDocument: (sourceText, options) => {
    if (rejectExternalDocumentReset()) return;
    let selectionElements: CadElement[] | null = null;
    const emptySelection: CadElementSelection = {
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    };
    set((state) => {
      const compiled = compileFreshCanonicalText(sourceText);
      selectionElements = compiled.doc.document.elements;
      return {
        ...canonicalFields(compiled),
        ...clearedPreviewState(),
        past: [],
        future: [],
        selectionPast: [],
        selectionFuture: [],
        currentFilePath: options.currentFilePath,
        savedSourceText: options.dirtySinceSave ? null : compiled.sourceText,
        dirtySinceSave: options.dirtySinceSave,
        ...canonicalRevisionFields(state, compiled, "reset")
      };
    });
    if (selectionElements) {
      useCadUiStore.getState().replaceGroupFoldById(initialGroupFoldForLoadedDocument(selectionElements));
      useCadUiStore.getState().applySelection(selectionElements, emptySelection);
      useCadUiStore.getState().setSourceCursorLine(null);
    }
  },
  markDocumentSaved: (currentFilePath, savedSourceText) =>
    set((state) => ({
      currentFilePath,
      savedSourceText,
      dirtySinceSave: state.sourceText !== savedSourceText
    })),
  recordCanvasSelection: (previousSelection) => {
    const nextSelection = selectionSnapshot(useCadUiStore.getState());
    if (selectionEqual(previousSelection, nextSelection)) return;
    set((state) => ({
      selectionPast: appendSelectionPast(state.selectionPast, previousSelection),
      selectionFuture: []
    }));
  },
  undoCanvasSelection: () => {
    let restoredSelection: SelectionSnapshot | null = null;
    set((state) => {
      const previous = state.selectionPast.at(-1);
      if (!previous) return {};
      restoredSelection = cloneSelection(previous);
      return {
        selectionPast: state.selectionPast.slice(0, -1),
        selectionFuture: [selectionSnapshot(useCadUiStore.getState()), ...state.selectionFuture]
      };
    });
    if (!restoredSelection) return false;
    useCadUiStore.getState().applySelection(useCadDocumentStore.getState().elements, restoredSelection);
    return true;
  },
  redoCanvasSelection: () => {
    let restoredSelection: SelectionSnapshot | null = null;
    set((state) => {
      const next = state.selectionFuture[0];
      if (!next) return {};
      restoredSelection = cloneSelection(next);
      return {
        selectionPast: appendSelectionPast(state.selectionPast, selectionSnapshot(useCadUiStore.getState())),
        selectionFuture: state.selectionFuture.slice(1)
      };
    });
    if (!restoredSelection) return false;
    useCadUiStore.getState().applySelection(useCadDocumentStore.getState().elements, restoredSelection);
    return true;
  },
  reconcileAuthoritativeHistory: (sourceText, direction) => {
    let outcome: "reconciled" | "reset" = "reset";
    const selectionResult: {
      value: {
        elements: CadElement[];
        selection: SelectionSnapshot;
        cursorLine: number | null;
      } | null;
    } = { value: null };
    set((state) => {
      const adjacent = direction === "undo" ? state.past.at(-1) : state.future[0];
      if (!adjacent || adjacent.text !== sourceText) {
        const authoritative = compileFreshCanonicalText(sourceText);
        selectionResult.value = {
          elements: authoritative.doc.document.elements,
          selection: {
            selectedElementId: null,
            selectedElementIds: [],
            selectionAnchorElementId: null
          },
          cursorLine: null
        };
        return {
          ...canonicalFields(authoritative),
          ...clearedPreviewState(),
          past: [],
          future: [],
          selectionPast: [],
          selectionFuture: [],
          dirtySinceSave: dirtyForText(state, authoritative.sourceText),
          ...canonicalRevisionFields(state, authoritative, "reset")
        };
      }

      const currentSelection = useCadUiStore.getState();
      const currentSnapshot = textSnapshot(
        state,
        currentSelection,
        state.selectionPast,
        state.selectionFuture
      );
      const currentIds = new Set(state.doc.document.elements.map((element) => element.id));
      const restored = compileCanonicalText(state, adjacent.text, {
        createdElementIds: adjacent.selection.selectedElementIds.filter((id) => !currentIds.has(id))
      });
      selectionResult.value = {
        elements: restored.doc.document.elements,
        selection: cloneSelection(adjacent.selection),
        cursorLine: adjacent.cursorLine
      };
      outcome = "reconciled";
      return {
        ...canonicalFields(restored),
        ...clearedPreviewState(),
        past: direction === "undo"
          ? state.past.slice(0, -1)
          : appendPast(state.past, currentSnapshot),
        future: direction === "undo"
          ? [currentSnapshot, ...state.future]
          : state.future.slice(1),
        selectionPast: cloneSelectionHistory(adjacent.selectionPast),
        selectionFuture: cloneSelectionHistory(adjacent.selectionFuture),
        dirtySinceSave: dirtyForText(state, restored.sourceText),
        ...canonicalRevisionFields(state, restored, "reset")
      };
    });
    if (selectionResult.value) {
      useCadUiStore.getState().applySelection(selectionResult.value.elements, selectionResult.value.selection);
      useCadUiStore.getState().setSourceCursorLine(selectionResult.value.cursorLine);
    }
    return outcome;
  },
  undo: () => {
    if (sourceEditSession.isComposing()) {
      useCadUiStore.getState().setCommandErrorMessage(
        "日本語入力の確定中はUndoできません。入力を確定してから再操作してください。"
      );
      return;
    }
    if (sourceEditSession.hasPendingText()) {
      sourceEditSession.flush("command");
    }
    const selectionResult: {
      value: { elements: CadElement[]; snapshot: CadElementSelection; cursorLine: number | null } | null;
    } = { value: null };
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return clearedPreviewState();
      const previousSelection = useCadUiStore.getState();
      const currentIds = new Set(state.doc.document.elements.map((element) => element.id));
      const restored = compileCanonicalText(state, previous.text, {
        createdElementIds: previous.selection.selectedElementIds.filter((id) => !currentIds.has(id))
      });
      const restoredSelection: CadElementSelection = previous.selection;
      selectionResult.value = { elements: restored.doc.document.elements, snapshot: restoredSelection, cursorLine: previous.cursorLine };
      return {
        ...canonicalFields(restored),
        ...clearedPreviewState(),
        past: state.past.slice(0, -1),
        future: [textSnapshot(state, previousSelection, state.selectionPast, state.selectionFuture), ...state.future],
        selectionPast: previous.selectionPast,
        selectionFuture: previous.selectionFuture,
        dirtySinceSave: dirtyForText(state, restored.sourceText),
        ...canonicalRevisionFields(state, restored, "reset")
      };
    });
    if (selectionResult.value) {
      useCadUiStore.getState().applySelection(selectionResult.value.elements, selectionResult.value.snapshot);
      useCadUiStore.getState().setSourceCursorLine(selectionResult.value.cursorLine);
    }
  },
  redo: () => {
    if (sourceEditSession.isComposing()) {
      useCadUiStore.getState().setCommandErrorMessage(
        "日本語入力の確定中はRedoできません。入力を確定してから再操作してください。"
      );
      return;
    }
    if (sourceEditSession.hasPendingText()) {
      sourceEditSession.flush("command");
    }
    const selectionResult: {
      value: { elements: CadElement[]; snapshot: CadElementSelection; cursorLine: number | null } | null;
    } = { value: null };
    set((state) => {
      const next = state.future[0];
      if (!next) return clearedPreviewState();
      const previousSelection = useCadUiStore.getState();
      const currentIds = new Set(state.doc.document.elements.map((element) => element.id));
      const restored = compileCanonicalText(state, next.text, {
        createdElementIds: next.selection.selectedElementIds.filter((id) => !currentIds.has(id))
      });
      const restoredSelection: CadElementSelection = next.selection;
      selectionResult.value = { elements: restored.doc.document.elements, snapshot: restoredSelection, cursorLine: next.cursorLine };
      return {
        ...canonicalFields(restored),
        ...clearedPreviewState(),
        past: appendPast(state.past, textSnapshot(state, previousSelection, state.selectionPast, state.selectionFuture)),
        future: state.future.slice(1),
        selectionPast: next.selectionPast,
        selectionFuture: next.selectionFuture,
        dirtySinceSave: dirtyForText(state, restored.sourceText),
        ...canonicalRevisionFields(state, restored, "reset")
      };
    });
    if (selectionResult.value) {
      useCadUiStore.getState().applySelection(selectionResult.value.elements, selectionResult.value.snapshot);
      useCadUiStore.getState().setSourceCursorLine(selectionResult.value.cursorLine);
    }
  }
}));

useCadDocumentStore.subscribe((state, previous) => {
  const elementsChanged = state.doc.document.elements !== previous.doc.document.elements;
  const drawingModifiersChanged = state.doc.document.modifiers !== previous.doc.document.modifiers;
  if (!elementsChanged && !drawingModifiersChanged) return;
  useCadUiStore.getState().pruneGroupFold(new Set(state.doc.document.elements.map((element) => element.id)));
  useCadUiStore.getState().reconcileSelectionWithElements(state.doc.document.elements);
});
