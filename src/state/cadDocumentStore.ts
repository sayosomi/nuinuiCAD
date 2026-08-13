import { create } from "zustand";
import { NEW_DOCUMENT_DSL_MAJOR_VERSION, type DslDocumentData } from "../dsl/dslDocument";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { TypedDependencyGraph } from "../scalars/typedDependencyGraph";
import {
  commitLineSplicePatch,
  commitModelBridge,
  compileCanonicalText,
  regenerateCanonicalFromModel,
  type CanonicalDocumentValue,
  type LastGoodDslDocument
} from "../document/canonicalDocument";
import { assertReconcileSane, assertShadowEquivalent, shadowAssertEnabled } from "../document/shadowTextAssert";
import { initialGroupFoldForLoadedDocument } from "../model/groups";
import { defaultVisibilityProfile, visibilityIdFromName } from "../model/visibilityProfiles";
import {
  createPaletteColor,
  defaultDocumentPalette,
  isValidPaletteColorId
} from "../palette/palette";
import {
  DEFAULT_PRINT_LAYOUT,
  activePrintLayout,
  createDefaultPrintLayout,
  nextPrintLayoutId,
  normalizePrintLayout
} from "../print/printLayout";
import { sampleElements } from "../sampleData";
import type { LineSplice } from "../document/textPatch";
import type { SourceUpdate } from "../editor/sourceEditorTypes";
import { sourceEditSession } from "../editor/sourceEditSession";
import type {
  CadElement,
  DocumentPalette,
  ElementId,
  PaletteColor,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { useCadUiStore, type CadElementSelection } from "./cadUiStore";

export type TextSnapshot = {
  text: string;
  selectionElementIds: ElementId[];
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
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  palette: DocumentPalette;
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  visibilityRoles: VisibilityRole[];
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  visibilityProfiles: VisibilityProfile[];
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  activeVisibilityProfileId: string;
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  printLayouts: PrintLayout[];
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  activePrintLayoutId: string;
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
  commitLineSplices: (splices: readonly LineSplice[]) => DocumentMutationResult;
  setElements: (elements: CadElement[]) => void;
  updateElement: (id: ElementId, patch: Partial<CadElement>) => void;
  setPrintLayout: (printLayout: PrintLayout) => void;
  updatePrintLayout: (patch: Partial<PrintLayout>) => void;
  setActiveVisibilityProfileId: (id: string) => void;
  addVisibilityRole: (name?: string) => void;
  updateVisibilityRole: (id: string, patch: Partial<VisibilityRole>) => void;
  deleteVisibilityRole: (id: string) => void;
  addVisibilityProfile: (name?: string) => void;
  updateVisibilityProfile: (id: string, patch: Partial<VisibilityProfile>) => void;
  deleteVisibilityProfile: (id: string) => void;
  setVisibilityProfileRoleVisible: (profileId: string, roleId: string, visible: boolean) => void;
  setActivePrintLayoutId: (id: string) => void;
  addPrintLayout: () => void;
  duplicatePrintLayout: (id?: string) => void;
  deletePrintLayout: (id: string) => void;
  setPalette: (palette: DocumentPalette) => void;
  updatePaletteColor: (id: string, patch: Partial<PaletteColor>) => void;
  addPaletteColor: () => void;
  deletePaletteColor: (id: string) => void;
  setDefaultColorId: (id: string) => void;
  replaceDocument: (document: DslDocumentData, filePath: string | null) => void;
  replaceTextDocument: (
    sourceText: string,
    options: { currentFilePath: string | null; dirtySinceSave: boolean }
  ) => void;
  markDocumentSaved: (filePath: string, savedSourceText: string) => void;
  undo: () => void;
  redo: () => void;
};

const HISTORY_LIMIT = 200;
type DocumentCompatibilityView = Pick<
  CadDocumentState,
  | "elements"
  | "palette"
  | "visibilityRoles"
  | "visibilityProfiles"
  | "activeVisibilityProfileId"
  | "printLayouts"
  | "activePrintLayoutId"
  | "evaluationLimitIndex"
>;

const documentOf = (state: DocumentCompatibilityView): DslDocumentData => ({
  elements: state.elements,
  palette: state.palette,
  visibilityRoles: state.visibilityRoles,
  visibilityProfiles: state.visibilityProfiles,
  activeVisibilityProfileId: state.activeVisibilityProfileId,
  printLayouts: state.printLayouts,
  activePrintLayoutId: state.activePrintLayoutId,
  evaluationLimitIndex: state.evaluationLimitIndex
});

const compatibilityViewMatchesDoc = (state: CadDocumentState) => {
  const document = state.doc.document;
  return state.elements === document.elements &&
    state.palette === document.palette &&
    state.visibilityRoles === document.visibilityRoles &&
    state.visibilityProfiles === document.visibilityProfiles &&
    state.activeVisibilityProfileId === document.activeVisibilityProfileId &&
    state.printLayouts === document.printLayouts &&
    state.activePrintLayoutId === document.activePrintLayoutId &&
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

const textSnapshot = (
  state: Pick<CadDocumentState, "sourceText">,
  selection: CadElementSelection & { sourceCursorLine: number | null }
): TextSnapshot => ({
  text: state.sourceText,
  selectionElementIds: selection.selectedElementIds,
  cursorLine: selection.sourceCursorLine
});

const appendPast = (past: TextSnapshot[], snapshot: TextSnapshot) =>
  [...past, snapshot].slice(-HISTORY_LIMIT);

const dirtyForText = (state: Pick<CadDocumentState, "savedSourceText">, text: string) =>
  state.savedSourceText !== text;

const canonicalFields = (value: CanonicalDocumentValue) => {
  const document = value.doc.document;
  return {
    sourceText: value.sourceText,
    doc: value.doc,
    docText: value.docText,
    diagnostics: value.diagnostics,
    bindingIssueDiagnostics: value.bindingIssueDiagnostics,
    typedDependencyGraph: value.typedDependencyGraph,
    elements: document.elements,
    palette: document.palette,
    visibilityRoles: document.visibilityRoles,
    visibilityProfiles: document.visibilityProfiles,
    activeVisibilityProfileId: document.activeVisibilityProfileId,
    printLayouts: document.printLayouts,
    activePrintLayoutId: document.activePrintLayoutId,
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
    palette: change.palette ?? before.palette,
    visibilityRoles: change.visibilityRoles ?? before.visibilityRoles,
    visibilityProfiles: change.visibilityProfiles ?? before.visibilityProfiles,
    activeVisibilityProfileId: change.activeVisibilityProfileId ?? before.activeVisibilityProfileId,
    printLayouts: change.printLayouts ?? before.printLayouts,
    activePrintLayoutId: change.activePrintLayoutId ?? before.activePrintLayoutId,
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
      past: appendPast(state.past, textSnapshot(current, previousSelection)),
      future: [],
      dirtySinceSave: dirtyForText(current, value.sourceText),
      ...canonicalRevisionFields(state, value, rebased ? "reset" : updateKind, splices)
    },
    result: { status: "applied" }
  };
};

const initialSnapshot = (): DslDocumentData => ({
  elements: sampleElements,
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [DEFAULT_PRINT_LAYOUT],
  activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
  evaluationLimitIndex: undefined
});

const emptyFileSnapshot = (): DslDocumentData => ({
  elements: [],
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [],
  activePrintLayoutId: "",
  evaluationLimitIndex: undefined
});

export const initialCadDocumentState = (): Omit<CadDocumentState, keyof CadDocumentActions> => {
  const snapshot = initialSnapshot();
  const canonical = regenerateCanonicalFromModel(snapshot, NEW_DOCUMENT_DSL_MAJOR_VERSION);
  return {
    ...canonicalFields(canonical),
    sourceRevision: 0,
    sourceUpdate: { revision: 0, kind: "reset" },
    compiledDocumentRevision: 0,
    ...clearedPreviewState(),
    past: [],
    future: [],
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
  | "setPrintLayout"
  | "updatePrintLayout"
  | "setActiveVisibilityProfileId"
  | "addVisibilityRole"
  | "updateVisibilityRole"
  | "deleteVisibilityRole"
  | "addVisibilityProfile"
  | "updateVisibilityProfile"
  | "deleteVisibilityProfile"
  | "setVisibilityProfileRoleVisible"
  | "setActivePrintLayoutId"
  | "addPrintLayout"
  | "duplicatePrintLayout"
  | "deletePrintLayout"
  | "setPalette"
  | "updatePaletteColor"
  | "addPaletteColor"
  | "deletePaletteColor"
  | "setDefaultColorId"
  | "replaceDocument"
  | "replaceTextDocument"
  | "markDocumentSaved"
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

const elementWithoutColorId = (element: CadElement): CadElement => {
  const rest = { ...element };
  delete rest.colorId;
  return rest as CadElement;
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
      const result = compileCanonicalText(state, nextText);
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
          textSnapshot(state, { ...previousSelection, sourceCursorLine: snapshotCursorLine })
        ),
        future: [],
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
  commitLineSplices: (splices) => {
    const guarded = guardDocumentMutation();
    if (guarded) {
      set(clearedPreviewState());
      return guarded;
    }
    let result: DocumentMutationResult = { status: "noop" };
    set((state) => {
      const previousSelection = useCadUiStore.getState();
      const outcome = commitLineSplicePatch(state, splices);
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
        past: appendPast(state.past, textSnapshot(state, previousSelection)),
        future: [],
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
  setPrintLayout: (printLayout) => {
    const document = documentOf(get());
    get().commitDocumentChange({
      printLayouts: document.printLayouts.map((layout) =>
        layout.id === document.activePrintLayoutId
          ? normalizePrintLayout(printLayout, document.elements, document.visibilityProfiles)
          : layout
      )
    });
  },
  updatePrintLayout: (patch) => {
    const document = documentOf(get());
    const layout = activePrintLayout(document.printLayouts, document.activePrintLayoutId);
    get().setPrintLayout({ ...layout, ...patch });
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
      printLayouts: document.printLayouts.map((layout) =>
        layout.visibilityProfileId === id
          ? { ...layout, visibilityProfileId: visibilityProfiles[0].id }
          : layout
      )
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
  setActivePrintLayoutId: (activePrintLayoutId) =>
    get().commitDocumentChange({ activePrintLayoutId }),
  addPrintLayout: () => {
    const document = documentOf(get());
    const layout = createDefaultPrintLayout(document.printLayouts);
    get().commitDocumentChange({
      printLayouts: [...document.printLayouts, layout],
      activePrintLayoutId: layout.id
    });
  },
  duplicatePrintLayout: (id) => {
    const document = documentOf(get());
    const source = document.printLayouts.find((layout) => layout.id === (id ?? document.activePrintLayoutId));
    if (!source) return;
    const copy = {
      ...source,
      id: nextPrintLayoutId(document.printLayouts),
      name: source.name.trim().length > 0 ? `${source.name.trim()} コピー` : "",
      placements: source.placements.map((placement) => ({ ...placement }))
    };
    get().commitDocumentChange({
      printLayouts: [...document.printLayouts, copy],
      activePrintLayoutId: copy.id
    });
  },
  deletePrintLayout: (id) => {
    const document = documentOf(get());
    if (document.printLayouts.length <= 1 || !document.printLayouts.some((layout) => layout.id === id)) return;
    const printLayouts = document.printLayouts.filter((layout) => layout.id !== id);
    get().commitDocumentChange({
      printLayouts,
      activePrintLayoutId:
        document.activePrintLayoutId === id ? printLayouts[0].id : document.activePrintLayoutId
    });
  },
  setPalette: (palette) => get().commitDocumentChange({ palette }),
  updatePaletteColor: (id, patch) => {
    const palette = documentOf(get()).palette;
    if (!palette.colors.some((color) => color.id === id)) return;
    get().commitDocumentChange({
      palette: {
        ...palette,
        colors: palette.colors.map((color) => color.id === id ? { ...color, ...patch, id } : color)
      }
    });
  },
  addPaletteColor: () => {
    const palette = documentOf(get()).palette;
    get().commitDocumentChange({
      palette: { ...palette, colors: [...palette.colors, createPaletteColor(palette.colors)] }
    });
  },
  deletePaletteColor: (id) => {
    const document = documentOf(get());
    if (id === document.palette.defaultColorId || !document.palette.colors.some((color) => color.id === id)) return;
    get().commitDocumentChange({
      elements: document.elements.map((element) =>
        element.colorId === id ? elementWithoutColorId(element) : element
      ),
      palette: { ...document.palette, colors: document.palette.colors.filter((color) => color.id !== id) }
    });
  },
  setDefaultColorId: (id) => {
    const palette = documentOf(get()).palette;
    if (!isValidPaletteColorId(palette, id) || palette.defaultColorId === id) return;
    get().commitDocumentChange({ palette: { ...palette, defaultColorId: id } });
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
          ...clearedPreviewState(),
          past: [],
          future: [],
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
      const baseline = regenerateCanonicalFromModel(emptyFileSnapshot(), NEW_DOCUMENT_DSL_MAJOR_VERSION);
      const compiled = compileCanonicalText(baseline, sourceText);
      selectionElements = compiled.doc.document.elements;
      return {
        ...canonicalFields(compiled),
        ...clearedPreviewState(),
        past: [],
        future: [],
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
        createdElementIds: previous.selectionElementIds.filter((id) => !currentIds.has(id))
      });
      const restoredSelection: CadElementSelection = {
        selectedElementId: previous.selectionElementIds[0] ?? null,
        selectedElementIds: previous.selectionElementIds,
        selectionAnchorElementId: previous.selectionElementIds[0] ?? null
      };
      selectionResult.value = { elements: restored.doc.document.elements, snapshot: restoredSelection, cursorLine: previous.cursorLine };
      return {
        ...canonicalFields(restored),
        ...clearedPreviewState(),
        past: state.past.slice(0, -1),
        future: [textSnapshot(state, previousSelection), ...state.future],
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
        createdElementIds: next.selectionElementIds.filter((id) => !currentIds.has(id))
      });
      const restoredSelection: CadElementSelection = {
        selectedElementId: next.selectionElementIds[0] ?? null,
        selectedElementIds: next.selectionElementIds,
        selectionAnchorElementId: next.selectionElementIds[0] ?? null
      };
      selectionResult.value = { elements: restored.doc.document.elements, snapshot: restoredSelection, cursorLine: next.cursorLine };
      return {
        ...canonicalFields(restored),
        ...clearedPreviewState(),
        past: appendPast(state.past, textSnapshot(state, previousSelection)),
        future: state.future.slice(1),
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
  if (state.doc.document.elements === previous.doc.document.elements) return;
  useCadUiStore.getState().pruneGroupFold(new Set(state.doc.document.elements.map((element) => element.id)));
  useCadUiStore.getState().reconcileSelectionWithElements(state.doc.document.elements);
});
