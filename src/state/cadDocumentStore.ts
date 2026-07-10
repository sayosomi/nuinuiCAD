import { create } from "zustand";
import type { DslDocumentData } from "../dsl/dslDocument";
import type { DslDiagnostic } from "../dsl/dslTypes";
import {
  commitModelBridge,
  compileCanonicalText,
  regenerateCanonicalFromModel,
  type CanonicalDocumentValue,
  type LastGoodDslDocument
} from "../document/canonicalDocument";
import {
  docToLegacySnapshot,
  type CadDocumentSelectionSnapshot,
  type CadDocumentSnapshot
} from "../document/documentFormat";
import { assertReconcileSane, assertShadowEquivalent, shadowAssertEnabled } from "../document/shadowTextAssert";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import { defaultVisibilityProfile, visibilityIdFromName } from "../model/visibilityProfiles";
import { normalizeParameterKey, type ParameterKey } from "../parameters/parameterDefinitions";
import {
  createPaletteColor,
  defaultDocumentPalette,
  isValidPaletteColorId
} from "../palette/palette";
import {
  DEFAULT_PRINT_LAYOUT,
  createDefaultPrintLayout,
  nextPrintLayoutId,
  normalizePrintLayout
} from "../print/printLayout";
import { sampleElements } from "../sampleData";
import type {
  CadElement,
  DocumentPalette,
  ElementId,
  PaletteColor,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { useCadUiStore } from "./cadUiStore";

export type { CadDocumentSnapshot } from "../document/documentFormat";

export type TextSnapshot = {
  text: string;
  selectionElementIds: ElementId[];
  cursorLine: number | null;
};

export type CommitTextOrigin = "file" | "test" | "bridge-internal";

export type CadDocumentState = CadDocumentSelectionSnapshot & {
  /** The only canonical document value. */
  sourceText: string;
  /** Last successful compile; never null. */
  doc: LastGoodDslDocument;
  /** Text represented by doc. A mismatch means sourceText currently has fatal diagnostics. */
  docText: string;
  /** Diagnostics for sourceText, including fatal diagnostics while doc remains last-good. */
  diagnostics: DslDiagnostic[];
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
  /** @deprecated Legacy active-layout mirror. */
  printLayout: PrintLayout;
  /** @deprecated Derived compatibility views. sourceText remains canonical. */
  evaluationLimitIndex: number;
  previewElements: CadElement[] | null;
  past: TextSnapshot[];
  future: TextSnapshot[];
  currentFilePath: string | null;
  dirtySinceSave: boolean;
  setSelectedElementId: (id: ElementId | null) => void;
  setSelectedElementIds: (ids: ElementId[], primaryId?: ElementId | null) => void;
  setSelectedElementRange: (anchorId: ElementId, targetId: ElementId) => void;
  setSelectedParameterKey: (selectedParameterKey: ParameterKey | null) => void;
  commitText: (nextText: string, origin: CommitTextOrigin) => void;
  previewDocumentChange: (change: Partial<CadDocumentSnapshot>) => void;
  commitDocumentChange: (change: Partial<CadDocumentSnapshot>) => void;
  commitDocumentChangeFromSnapshot: (
    before: CadDocumentSnapshot,
    change: Partial<CadDocumentSnapshot>
  ) => void;
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
  renameElement: (id: ElementId, requestedName: string) => void;
  replaceDocument: (snapshot: CadDocumentSnapshot, filePath: string | null) => void;
  markDocumentSaved: (filePath: string) => void;
  undo: () => void;
  redo: () => void;
};

const HISTORY_LIMIT = 200;
const uniqueElementIds = (ids: ElementId[]) => Array.from(new Set(ids));
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

const selectionOf = (state: CadDocumentSelectionSnapshot): CadDocumentSelectionSnapshot => ({
  selectedElementId: state.selectedElementId,
  selectedElementIds: state.selectedElementIds,
  selectionAnchorElementId: state.selectionAnchorElementId,
  selectedParameterKey: state.selectedParameterKey
});

export const currentDocumentSnapshot = (
  state: DocumentCompatibilityView & CadDocumentSelectionSnapshot
): CadDocumentSnapshot => docToLegacySnapshot(documentOf(state), selectionOf(state));

const normalizedSelection = (
  elements: CadElement[],
  selection: CadDocumentSelectionSnapshot
): CadDocumentSelectionSnapshot => {
  const existingIds = new Set(elements.map((element) => element.id));
  const selectedElementIds = uniqueElementIds(selection.selectedElementIds).filter((id) => existingIds.has(id));
  const selectedElementId =
    selection.selectedElementId && existingIds.has(selection.selectedElementId)
      ? selection.selectedElementId
      : selectedElementIds[0] ?? elements[0]?.id ?? null;
  const normalizedIds =
    selectedElementId && !selectedElementIds.includes(selectedElementId)
      ? [...selectedElementIds, selectedElementId]
      : selectedElementIds;
  const selectionAnchorElementId =
    selection.selectionAnchorElementId && existingIds.has(selection.selectionAnchorElementId)
      ? selection.selectionAnchorElementId
      : selectedElementId;
  const selectedElement = elements.find((element) => element.id === selectedElementId);
  return {
    selectedElementId,
    selectedElementIds: normalizedIds,
    selectionAnchorElementId,
    selectedParameterKey: selectedElement
      ? normalizeParameterKey(selectedElement, selection.selectedParameterKey)
      : null
  };
};

const textSnapshot = (state: CadDocumentState): TextSnapshot => ({
  text: state.sourceText,
  selectionElementIds: state.selectedElementIds,
  cursorLine: state.selectedElementId
    ? state.doc.statementMap.byElementId.get(state.selectedElementId)?.range.startLine ?? null
    : null
});

const appendPast = (past: TextSnapshot[], snapshot: TextSnapshot) =>
  [...past, snapshot].slice(-HISTORY_LIMIT);

const canonicalFields = (value: CanonicalDocumentValue) => {
  const document = value.doc.document;
  return {
    sourceText: value.sourceText,
    doc: value.doc,
    docText: value.docText,
    diagnostics: value.diagnostics,
    elements: document.elements,
    palette: document.palette,
    visibilityRoles: document.visibilityRoles,
    visibilityProfiles: document.visibilityProfiles,
    activeVisibilityProfileId: document.activeVisibilityProfileId,
    printLayouts: document.printLayouts,
    activePrintLayoutId: document.activePrintLayoutId,
    printLayout:
      document.printLayouts.find((layout) => layout.id === document.activePrintLayoutId) ??
      document.printLayouts[0] ??
      DEFAULT_PRINT_LAYOUT,
    evaluationLimitIndex: document.evaluationLimitIndex
  };
};

const selectionFromChange = (
  state: CadDocumentState,
  change: Partial<CadDocumentSnapshot>
): CadDocumentSelectionSnapshot => ({
  selectedElementId: change.selectedElementId === undefined ? state.selectedElementId : change.selectedElementId,
  selectedElementIds: change.selectedElementIds ?? state.selectedElementIds,
  selectionAnchorElementId:
    change.selectionAnchorElementId === undefined
      ? state.selectionAnchorElementId
      : change.selectionAnchorElementId,
  selectedParameterKey:
    change.selectedParameterKey === undefined ? state.selectedParameterKey : change.selectedParameterKey
});

const documentFromChange = (
  state: CadDocumentState,
  change: Partial<CadDocumentSnapshot>
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
    evaluationLimitIndex: change.evaluationLimitIndex ?? before.evaluationLimitIndex
  };
};

const modelCommit = (
  state: CadDocumentState,
  change: Partial<CadDocumentSnapshot>
): Partial<CadDocumentState> => {
  let current = state;
  if (!compatibilityViewMatchesDoc(state)) {
    // Legacy tests and transitional facade callers may seed the derived view directly.
    // Rebase that setup into canonical text before creating the real history entry.
    const rebased = regenerateCanonicalFromModel(documentOf(state));
    current = { ...state, ...canonicalFields(rebased) };
  }
  const afterDocument = documentFromChange(current, change);
  const requestedSelection = selectionFromChange(state, change);
  const result = commitModelBridge(current, afterDocument);

  if (result.status === "rejected") {
    console.error(`[canonicalDocument] ${result.reason}`);
    return { previewElements: null };
  }
  if (result.status === "noop") {
    return {
      ...canonicalFields(current),
      ...normalizedSelection(documentOf(current).elements, requestedSelection),
      previewElements: null
    };
  }

  let value: CanonicalDocumentValue;
  if (result.status === "failed") {
    if (shadowAssertEnabled) {
      console.error(`[canonicalDocument] 行パッチを適用できないため全体再生成します: ${result.reason}`);
    }
    try {
      value = regenerateCanonicalFromModel(afterDocument);
    } catch (error) {
      console.error(`[canonicalDocument] 全体再生成にも失敗したため変更を破棄します: ${String(error)}`);
      return { previewElements: null };
    }
  } else {
    value = result.value;
  }

  if (shadowAssertEnabled) {
    if (!assertShadowEquivalent(afterDocument, value.doc.document)) {
      try {
        value = regenerateCanonicalFromModel(afterDocument);
      } catch (error) {
        console.error(`[canonicalDocument] 等価assert後の全体再生成に失敗したため変更を破棄します: ${String(error)}`);
        return { previewElements: null };
      }
    }
    assertReconcileSane(current.doc, value.sourceText, afterDocument);
  }

  return {
    ...canonicalFields(value),
    ...normalizedSelection(value.doc.document.elements, requestedSelection),
    previewElements: null,
    past: appendPast(state.past, textSnapshot(current)),
    future: [],
    dirtySinceSave: true
  };
};

const initialSnapshot = (): CadDocumentSnapshot => ({
  elements: sampleElements,
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  printLayouts: [DEFAULT_PRINT_LAYOUT],
  activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
  printLayout: DEFAULT_PRINT_LAYOUT,
  evaluationLimitIndex: sampleElements.length,
  selectedElementId: sampleElements[0]?.id ?? null,
  selectedElementIds: sampleElements[0] ? [sampleElements[0].id] : [],
  selectionAnchorElementId: sampleElements[0]?.id ?? null,
  selectedParameterKey: sampleElements[0] ? normalizeParameterKey(sampleElements[0], null) : null
});

export const initialCadDocumentState = (): Omit<CadDocumentState, keyof CadDocumentActions> => {
  const snapshot = initialSnapshot();
  const canonical = regenerateCanonicalFromModel(snapshot);
  return {
    ...canonicalFields(canonical),
    ...normalizedSelection(canonical.doc.document.elements, snapshot),
    previewElements: null,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  };
};

type CadDocumentActions = Pick<
  CadDocumentState,
  | "setSelectedElementId"
  | "setSelectedElementIds"
  | "setSelectedElementRange"
  | "setSelectedParameterKey"
  | "commitText"
  | "previewDocumentChange"
  | "commitDocumentChange"
  | "commitDocumentChangeFromSnapshot"
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
  | "renameElement"
  | "replaceDocument"
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

export const useCadDocumentStore = create<CadDocumentState>((set, get) => ({
  ...initialCadDocumentState(),
  setSelectedElementId: (selectedElementId) =>
    set((state) => normalizedSelection(documentOf(state).elements, {
      selectedElementId,
      selectedElementIds: selectedElementId ? [selectedElementId] : [],
      selectionAnchorElementId: selectedElementId,
      selectedParameterKey: state.selectedParameterKey
    })),
  setSelectedElementIds: (selectedElementIds, primaryId) =>
    set((state) => normalizedSelection(documentOf(state).elements, {
      selectedElementId: primaryId ?? selectedElementIds[0] ?? null,
      selectedElementIds,
      selectionAnchorElementId: primaryId ?? selectedElementIds[0] ?? null,
      selectedParameterKey: state.selectedParameterKey
    })),
  setSelectedElementRange: (anchorId, targetId) =>
    set((state) => {
      const elements = documentOf(state).elements;
      const anchorIndex = elements.findIndex((element) => element.id === anchorId);
      const targetIndex = elements.findIndex((element) => element.id === targetId);
      if (anchorIndex < 0 || targetIndex < 0) return {};
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      return normalizedSelection(elements, {
        selectedElementId: targetId,
        selectedElementIds: elements.slice(start, end + 1).map((element) => element.id),
        selectionAnchorElementId: anchorId,
        selectedParameterKey: state.selectedParameterKey
      });
    }),
  setSelectedParameterKey: (selectedParameterKey) =>
    set((state) => normalizedSelection(documentOf(state).elements, {
      ...selectionOf(state),
      selectedParameterKey
    })),
  commitText: (nextText) =>
    set((state) => {
      const normalized = nextText.replace(/\r\n/g, "\n");
      if (normalized === state.sourceText) return { previewElements: null };
      const result = compileCanonicalText(state, normalized);
      return {
        ...canonicalFields(result),
        ...normalizedSelection(result.doc.document.elements, selectionOf(state)),
        previewElements: null,
        past: appendPast(state.past, textSnapshot(state)),
        future: [],
        dirtySinceSave: true
      };
    }),
  previewDocumentChange: (change) =>
    set(() => (change.elements === undefined ? {} : { previewElements: change.elements })),
  commitDocumentChange: (change) => set((state) => modelCommit(state, change)),
  commitDocumentChangeFromSnapshot: (_before, change) => set((state) => modelCommit(state, change)),
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
    const layout = document.printLayouts.find((item) => item.id === document.activePrintLayoutId) ??
      document.printLayouts[0] ?? DEFAULT_PRINT_LAYOUT;
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
      placements: source.placements.map((placement) => ({ ...placement })),
      numericVariables: source.numericVariables?.map((variable) => ({ ...variable })) ?? []
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
  renameElement: (id, requestedName) => {
    const document = documentOf(get());
    const element = document.elements.find((item) => item.id === id);
    if (!element) return;
    const name = makeUniqueElementName({
      elements: document.elements,
      elementId: id,
      requestedName,
      fallbackBaseName: fallbackElementName(element.type),
      parentGroupId: element.parentGroupId
    });
    if (name === element.name) return;
    get().commitDocumentChange({
      elements: document.elements.map((item) => item.id === id ? { ...item, name } : item)
    });
  },
  replaceDocument: (snapshot, currentFilePath) =>
    set(() => {
      try {
        const canonical = regenerateCanonicalFromModel(snapshot);
        return {
          ...canonicalFields(canonical),
          ...normalizedSelection(canonical.doc.document.elements, snapshot),
          previewElements: null,
          past: [],
          future: [],
          currentFilePath,
          dirtySinceSave: false
        };
      } catch (error) {
        console.error(`[canonicalDocument] 文書読込の正準化に失敗したため現在の文書を維持します: ${String(error)}`);
        return { previewElements: null };
      }
    }),
  markDocumentSaved: (currentFilePath) => set({ currentFilePath, dirtySinceSave: false }),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return { previewElements: null };
      const currentIds = new Set(state.doc.document.elements.map((element) => element.id));
      const restored = compileCanonicalText(state, previous.text, {
        createdElementIds: previous.selectionElementIds.filter((id) => !currentIds.has(id))
      });
      const selection = normalizedSelection(restored.doc.document.elements, {
        selectedElementId: previous.selectionElementIds[0] ?? null,
        selectedElementIds: previous.selectionElementIds,
        selectionAnchorElementId: previous.selectionElementIds[0] ?? null,
        selectedParameterKey: state.selectedParameterKey
      });
      return {
        ...canonicalFields(restored),
        ...selection,
        previewElements: null,
        past: state.past.slice(0, -1),
        future: [textSnapshot(state), ...state.future],
        dirtySinceSave: true
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return { previewElements: null };
      const currentIds = new Set(state.doc.document.elements.map((element) => element.id));
      const restored = compileCanonicalText(state, next.text, {
        createdElementIds: next.selectionElementIds.filter((id) => !currentIds.has(id))
      });
      const selection = normalizedSelection(restored.doc.document.elements, {
        selectedElementId: next.selectionElementIds[0] ?? null,
        selectedElementIds: next.selectionElementIds,
        selectionAnchorElementId: next.selectionElementIds[0] ?? null,
        selectedParameterKey: state.selectedParameterKey
      });
      return {
        ...canonicalFields(restored),
        ...selection,
        previewElements: null,
        past: appendPast(state.past, textSnapshot(state)),
        future: state.future.slice(1),
        dirtySinceSave: true
      };
    })
}));

useCadDocumentStore.subscribe((state, previous) => {
  if (state.doc.document.elements === previous.doc.document.elements) return;
  useCadUiStore.getState().pruneGroupFold(new Set(state.doc.document.elements.map((element) => element.id)));
});
