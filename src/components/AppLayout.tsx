import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { dispatchCommand } from "../commands/commands";
import { loadCommandRibbonSettings } from "../commandRibbons/commandRibbonSettings";
import { registerUnsavedChangesGuard } from "../document/unsavedChangesGuard";
import { buildPropertyBindingRuntimeEntries } from "../geometry/propertyBindingRuntime";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import {
  buildConditionalMutationOwners,
  conditionalOwnerIdByElementId
} from "../scalars/conditionalMutationControl";
import {
  buildForGroupMutationOwners,
  forGroupMutationOwnerByElementId
} from "../scalars/forGroupMutationControl";
import {
  buildConditionalGroupConditionsByElementId,
  buildControlBooleanRuntimeEntries
} from "../geometry/controlBooleanRuntime";
import {
  buildTextPropertyBindingRuntimeEntries,
  buildTextTemplateEntriesByElementId
} from "../geometry/textTemplateRuntime";
import { evaluationStateIsCurrentFor, useEvaluationEngine } from "../geometry/useEvaluationEngine";
import { loadShortcutSettings } from "../keyboard/shortcutSettingsStorage";
import {
  isSourceEditorDslKeyboardTarget,
  isSourceEditorKeyboardTarget,
  isSourceEditorSearchKeyboardTarget,
  keyboardCommandForEvent
} from "../keyboard/shortcuts";
import { loadLayoutSettings, saveLayoutSettings } from "../layout/layoutSettingsStorage";
import { MIN_LEFT_PANEL_WIDTH, useLeftPanelResize } from "../layout/leftPanelWidth";
import {
  effectiveElements,
  effectiveEvaluationLimitIndex,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { CommandPalette } from "./CommandPalette";
import { DrawingCanvas } from "./DrawingCanvas";
import { CommandLineBar } from "./CommandLineBar";
import { RightPanel } from "./RightPanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { SourceEditorPane } from "./SourceEditorPane";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { registerTauriMenuCommandListener } from "../commands/tauriMenuEvents";
import { selectTextInputValue } from "./textInputSelection";
import { PickModeStatus } from "./PickModeStatus";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { DrawingCanvasHandle } from "./DrawingCanvas";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { isCommandLineInputComposing } from "../commands/commandLineInputComposition";
import { cancelCommandLineEscape } from "../commands/commandLineSessionCommands";
import { currentStep } from "../commands/commandLineSession";
import { creationRecipeForLegacyCommand, legacyCreationCommandIds } from "../commands/legacyCreationRecipes";
import { COMMAND_LINE_PICK_TARGET_ID } from "../commands/commandLinePickRouting";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ElementId } from "../types/geometry";
import type { ModuleSemanticTarget } from "../dsl/moduleSemanticEditor";

const commandLineCreationCommandIds = new Set(legacyCreationCommandIds);

const GroupTemplateLibraryDialog = lazy(() =>
  import("./GroupTemplateLibraryDialog").then((module) => ({
    default: module.GroupTemplateLibraryDialog
  }))
);
const ImageImportDialog = lazy(() =>
  import("./ImageImportDialog").then((module) => ({ default: module.ImageImportDialog }))
);
const PaletteSettingsDialog = lazy(() =>
  import("./PalettePanel").then((module) => ({ default: module.PaletteSettingsDialog }))
);
const VisibilityProfileSettingsDialog = lazy(() =>
  import("./VisibilityProfilePanel").then((module) => ({
    default: module.VisibilityProfileSettingsDialog
  }))
);
const PrintLayoutCanvas = lazy(() =>
  import("./PrintLayoutView").then((module) => ({ default: module.PrintLayoutCanvas }))
);
const PrintLayoutPanel = lazy(() =>
  import("./PrintLayoutView").then((module) => ({ default: module.PrintLayoutPanel }))
);
const PrintLayoutPreviewWindow = lazy(() =>
  import("./PrintLayoutPreviewWindow").then((module) => ({
    default: module.PrintLayoutPreviewWindow
  }))
);
const ShortcutSettingsDialog = lazy(() =>
  import("./ShortcutSettingsDialog").then((module) => ({
    default: module.ShortcutSettingsDialog
  }))
);
const CommandRibbonSettingsDialog = lazy(() =>
  import("./CommandRibbonSettingsDialog").then((module) => ({
    default: module.CommandRibbonSettingsDialog
  }))
);
const SelectionColorPickerDialog = lazy(() =>
  import("./SelectionColorPickerDialog").then((module) => ({
    default: module.SelectionColorPickerDialog
  }))
);
const RenameElementDialog = lazy(() =>
  import("./RenameElementDialog").then((module) => ({ default: module.RenameElementDialog }))
);
const RenameTypedBindingDialog = lazy(() =>
  import("./RenameTypedBindingDialog").then((module) => ({ default: module.RenameTypedBindingDialog }))
);
const RenameModuleSemanticDialog = lazy(() =>
  import("./RenameModuleSemanticDialog").then((module) => ({ default: module.RenameModuleSemanticDialog }))
);
const TemplateInsertionPanel = lazy(() =>
  import("./TemplateInsertionPanel").then((module) => ({
    default: module.TemplateInsertionPanel
  }))
);

const saveLeftPanelWidth = (leftPanelWidth: number) => {
  void loadLayoutSettings()
    .then((settings) => saveLayoutSettings({ ...settings, leftPanelWidth }))
    .catch((error: unknown) => {
      console.error("failed to save layout settings", error);
    });
};

export const AppLayout = () => {
  const elements = useCadDocumentStore(effectiveElements);
  const evaluationLimitIndex = useCadDocumentStore(effectiveEvaluationLimitIndex);
  const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
  // Task 23: scalarProgram/propertyBindings are read from the last-good
  // compiled document (state.doc), not from `elements` above - `elements` is
  // `effectiveElements` (previewElements may substitute it during an
  // in-progress command preview), while property bindings are keyed against
  // the canonical compiled document's own element ids/statement indices.
  const scalarProgram = useCadDocumentStore((state) => state.doc.scalarProgram);
  const bindingVersions = useCadDocumentStore((state) => state.doc.bindingVersions);
  const propertyBindings = useCadDocumentStore((state) => state.doc.propertyBindings);
  const numericBindings = useCadDocumentStore((state) => state.doc.numericBindings);
  const materializedPropertyBindings = useCadDocumentStore((state) => state.doc.materializedPropertyBindings);
  const materializedNumericBindings = useCadDocumentStore((state) => state.doc.materializedNumericBindings);
  const materializedTextTemplates = useCadDocumentStore((state) => state.doc.materializedTextTemplates);
  const conditionalGroupConditions = useCadDocumentStore((state) => state.doc.conditionalGroupConditions);
  const materializedConditionalGroupConditions = useCadDocumentStore((state) => state.doc.materializedConditionalGroupConditions);
  // Task 27: textTemplates is read the same way as the other compiled-
  // document fields above (last-good doc.textTemplates, keyed against the
  // canonical elementIdByStatementIndex below) - unlike scalarProgram/
  // propertyBindings, it's populated for every nui 3 document regardless of
  // typed declarations (Task 26's compileTextTemplates runs unconditionally
  // once majorVersion === 3), so its own entry builder below isn't gated on
  // `scalarProgram` the way propertyBindingEntries/controlBooleanEntries are.
  const textTemplates = useCadDocumentStore((state) => state.doc.textTemplates);
  const canonicalElements = useCadDocumentStore((state) => state.doc.document.elements);
  const sourceExecutionPositionByElementId = useCadDocumentStore(
    (state) => state.doc.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  );
  const scalarExecutionPositionByElementId = useCadDocumentStore(
    (state) => state.doc.scalarExecutionPositionByRuntimeElementId
  );
  const moduleConditionalOwnerStatementIdByElementId = useCadDocumentStore(
    (state) => state.doc.moduleConditionalOwnerStatementIdByElementId
  );
  const moduleForGroupMutationOwnerByElementId = useCadDocumentStore(
    (state) => state.doc.moduleForGroupMutationOwnerByElementId
  );
  const elementIdByStatementIndex = useCadDocumentStore((state) => state.doc.statementMap.elementIdByStatementIndex);
  const statementInfoByElementId = useCadDocumentStore((state) => state.doc.statementMap.byElementId);
  const statementIdByStatementIndex = useCadDocumentStore((state) => state.doc.statementMap.statementIdByStatementIndex);
  const shortcutSettings = useCadUiStore((state) => state.shortcutSettings);
  const showPrintLayout = useCadUiStore((state) => state.showPrintLayout);
  const showPrintPreviewWindow = useCadUiStore((state) => state.showPrintPreviewWindow);
  const showPaletteSettings = useCadUiStore((state) => state.showPaletteSettings);
  const showVisibilityProfileSettings = useCadUiStore(
    (state) => state.showVisibilityProfileSettings
  );
  const showGroupTemplateLibrary = useCadUiStore((state) => state.showGroupTemplateLibrary);
  const showShortcutSettings = useCadUiStore((state) => state.showShortcutSettings);
  const showCommandRibbonSettings = useCadUiStore((state) => state.showCommandRibbonSettings);
  const showSelectionColorPicker = useCadUiStore((state) => state.showSelectionColorPicker);
  const renameElementPromptTargetId = useCadUiStore((state) => state.renameElementPromptTargetId);
  const renameTypedBindingPromptTargetId = useCadUiStore((state) => state.renameTypedBindingPromptTargetId);
  const renameModuleSemanticPromptTarget = useCadUiStore((state) => state.renameModuleSemanticPromptTarget);
  const pendingImageImport = useCadUiStore((state) => state.pendingImageImport);
  const imageImportError = useCadUiStore((state) => state.imageImportError);
  const setPrintPreviewWindow = useCadUiStore((state) => state.setPrintPreviewWindow);
  const activeTemplateInsertion = useCadUiStore((state) => state.activeTemplateInsertion);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const commandLineSession = useCadUiStore((state) => state.commandLineSession);
  const isPickMode = useCadUiStore(
    (state) =>
      Boolean(state.activePointPickTarget) ||
      Boolean(state.activeNumericReferencePickTarget) ||
      Boolean(state.activeLinePickTarget) ||
      Boolean(state.activeTemplateInsertion)
  );
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const appShellRef = useRef<HTMLElement>(null);
  const canvasWorkspaceRef = useRef<HTMLDivElement>(null);
  const commandRibbonDockRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<SourceEditorHandle>(null);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const {
    isResizing: isResizingLeftPanel,
    leftPanelWidth,
    maximumLeftPanelWidth,
    setSavedWidth: setSavedLeftPanelWidth,
    startResize: startLeftPanelResize,
    decreaseWidth: decreaseLeftPanelWidth,
    increaseWidth: increaseLeftPanelWidth,
    resetWidth: resetLeftPanelWidth
  } = useLeftPanelResize({ onWidthCommitted: saveLeftPanelWidth });
  const propertyBindingEntries = useMemo(
    () =>
      scalarProgram && propertyBindings
        ? buildPropertyBindingRuntimeEntries({ propertyBindings, elementIdByStatementIndex, materializedPropertyBindings }, canonicalElements)
        : undefined,
    [scalarProgram, propertyBindings, materializedPropertyBindings, elementIdByStatementIndex, canonicalElements]
  );
  const controlBooleanEntries = useMemo(
    () =>
      scalarProgram && propertyBindings
        ? buildControlBooleanRuntimeEntries({ propertyBindings, elementIdByStatementIndex, materializedPropertyBindings }, canonicalElements)
        : undefined,
    [scalarProgram, propertyBindings, materializedPropertyBindings, elementIdByStatementIndex, canonicalElements]
  );
  const numericBindingEntries = useMemo(
    () =>
      scalarProgram && numericBindings
        ? buildNumericBindingRuntimeEntries({ numericBindings, elementIdByStatementIndex, materializedNumericBindings }, canonicalElements)
        : undefined,
    [scalarProgram, numericBindings, materializedNumericBindings, elementIdByStatementIndex, canonicalElements]
  );
  const conditionalGroupConditionsByElementId = useMemo(
    () =>
      scalarProgram && (conditionalGroupConditions || materializedConditionalGroupConditions)
        ? new Map([
            ...(conditionalGroupConditions
              ? buildConditionalGroupConditionsByElementId(conditionalGroupConditions, elementIdByStatementIndex)
              : new Map()),
            ...(materializedConditionalGroupConditions ?? []).map((entry) => [entry.elementId, entry.expression] as const)
          ])
        : undefined,
    [scalarProgram, conditionalGroupConditions, materializedConditionalGroupConditions, elementIdByStatementIndex]
  );
  // Task 27: built once per compiled document (only re-runs when
  // doc.textTemplates/elementIdByStatementIndex change), never per render or
  // per evaluation - mirrors the three memos above. No scalarProgram gate
  // here (see the read above); the bare `@binding` text.text entries below
  // do keep the same scalarProgram+propertyBindings gate as
  // propertyBindingEntries/controlBooleanEntries, since a bound reference
  // always implies a typed declaration exists.
  const textTemplateEntriesByElementId = useMemo(
    () => (textTemplates || materializedTextTemplates
      ? buildTextTemplateEntriesByElementId({ textTemplates: textTemplates ?? new Map(), elementIdByStatementIndex, materializedTextTemplates })
      : undefined),
    [textTemplates, materializedTextTemplates, elementIdByStatementIndex]
  );
  const textPropertyBindingEntries = useMemo(
    () =>
      scalarProgram && propertyBindings
      ? buildTextPropertyBindingRuntimeEntries({ propertyBindings, elementIdByStatementIndex, materializedPropertyBindings }, canonicalElements)
        : undefined,
    [scalarProgram, propertyBindings, materializedPropertyBindings, elementIdByStatementIndex, canonicalElements]
  );
  const conditionalOwnerStatementIdByElementId = useMemo(
    () => bindingVersions
      ? new Map([
          ...conditionalOwnerIdByElementId(buildConditionalMutationOwners(
            bindingVersions,
            canonicalElements,
            statementInfoByElementId,
            statementIdByStatementIndex,
            new Set(moduleConditionalOwnerStatementIdByElementId?.values() ?? [])
          )),
          ...(moduleConditionalOwnerStatementIdByElementId ? [...moduleConditionalOwnerStatementIdByElementId] : [])
        ])
      : undefined,
    [bindingVersions, canonicalElements, statementInfoByElementId, statementIdByStatementIndex, moduleConditionalOwnerStatementIdByElementId]
  );
  const forGroupMutationOwnersByElementId = useMemo(
    () => bindingVersions
      ? new Map([
          ...forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
            bindingVersions,
            canonicalElements,
            statementInfoByElementId,
            statementIdByStatementIndex,
            new Set(moduleForGroupMutationOwnerByElementId
              ? [...moduleForGroupMutationOwnerByElementId.values()].map((owner) => owner.ownerStatementId)
              : [])
          )),
          ...(moduleForGroupMutationOwnerByElementId ? [...moduleForGroupMutationOwnerByElementId] : [])
        ])
      : undefined,
    [bindingVersions, canonicalElements, statementInfoByElementId, statementIdByStatementIndex, moduleForGroupMutationOwnerByElementId]
  );
  const evaluationOptions = useMemo(
    () => ({
      evaluationLimitIndex,
      ...(scalarProgram ? { scalarProgram } : {}),
      ...(bindingVersions ? {
        bindingVersions, statementInfoByElementId, sourceExecutionPositionByElementId, scalarExecutionPositionByElementId, statementIdByStatementIndex,
        conditionalOwnerStatementIdByElementId, forGroupMutationOwnerByElementId: forGroupMutationOwnersByElementId,
        moduleConditionalOwnerStatementIdByElementId, moduleForGroupMutationOwnerByElementId
      } : {}),
      ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
      ...(numericBindingEntries?.length ? { numericBindingEntries } : {}),
      ...(controlBooleanEntries?.length ? { controlBooleanEntries } : {}),
      ...(conditionalGroupConditionsByElementId?.size ? { conditionalGroupConditionsByElementId } : {}),
      ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
      ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
    }),
    [
      evaluationLimitIndex,
      scalarProgram,
      bindingVersions,
      statementInfoByElementId,
      sourceExecutionPositionByElementId,
      scalarExecutionPositionByElementId,
      statementIdByStatementIndex,
      conditionalOwnerStatementIdByElementId,
      forGroupMutationOwnersByElementId,
      moduleConditionalOwnerStatementIdByElementId,
      moduleForGroupMutationOwnerByElementId,
      propertyBindingEntries,
      numericBindingEntries,
      controlBooleanEntries,
      conditionalGroupConditionsByElementId,
      textTemplateEntriesByElementId,
      textPropertyBindingEntries
    ]
  );
  const evaluationState = useEvaluationEngine(elements, evaluationOptions, compiledDocumentRevision);
  const { evaluation, evaluationRevision, evaluationRequestRevision } = evaluationState;
  // Element-property completion (CommandLineBar, Source Editor) must never
  // treat a not-yet-current evaluation as a confirmed empty/candidate
  // result - Rust evaluation is asynchronous and can lag a freshly compiled
  // element by a render or two (see elementParameterCandidateState). Reuse
  // the engine's own currency check rather than re-deriving it ad hoc.
  const evaluationIsCurrent = evaluationStateIsCurrentFor(evaluationState, compiledDocumentRevision);
  const commandLineStep = currentStep(commandLineSession);
  const isMultiLinePicking = Boolean(activeLinePickTarget && (
    (activeLinePickTarget.elementId === COMMAND_LINE_PICK_TARGET_ID &&
      commandLineStep?.kind === "lineList" &&
      commandLineStep.key === activeLinePickTarget.parameterKey) ||
    (() => {
      const target = elements.find((element) => element.id === activeLinePickTarget.elementId);
      return target && findParameterDefinition(target, activeLinePickTarget.parameterKey)?.kind === "lineReferenceList";
    })()
  ));

  useEffect(() => {
    if (isMultiLinePicking) canvasFocusRef.current?.focus();
  }, [isMultiLinePicking]);

  useEffect(() => {
    // Publish with the revisions the engine captured when this evaluation request
    // started. Never substitute the store's current compiledDocumentRevision here:
    // async Rust results may arrive after the document advanced, and stamping the
    // current revision would mislabel a stale result as fresh.
    sourceEditorRef.current?.setEvaluation({
      evaluation,
      compiledDocumentRevision: evaluationRevision,
      evaluationRequestRevision,
      evaluationIsCurrent
    });
  }, [evaluation, evaluationRevision, evaluationRequestRevision, evaluationIsCurrent]);
  const commandContext = useMemo(() => ({
    focusCanvas: () => canvasFocusRef.current?.focus(),
    focusSourceEditor: () => sourceEditorRef.current?.focus(),
    focusElementSearch: () => sourceEditorRef.current?.focusSearch(),
    currentCursorElementId: () => sourceEditorRef.current?.currentCursorElementId?.() ?? null,
    currentSourceCursor: () => sourceEditorRef.current?.currentSourceCursor?.() ?? null,
    currentCursorTypedRenameTargetBindingId: () => sourceEditorRef.current?.currentCursorTypedRenameTargetBindingId?.() ?? null,
    currentCursorModuleSemanticTarget: () => sourceEditorRef.current?.currentCursorModuleSemanticTarget?.() ?? null,
    currentCursorModuleSemanticResolution: () => sourceEditorRef.current?.currentCursorModuleSemanticResolution?.() ?? { kind: "none" },
    goToSourceDefinitionAtCursor: () => sourceEditorRef.current?.goToSourceDefinitionAtCursor?.() ?? false,
    focusSourceEditorAtElementEnd: (elementId: ElementId) => sourceEditorRef.current?.jumpToElementEnd(elementId),
    focusSourceEditorAtLineEnd: (line: number) => sourceEditorRef.current?.jumpToLineEnd(line),
    clearPendingCanvasPointerIntent: () => drawingCanvasRef.current?.clearPendingCanvasPointerIntent(),
    clearSourceEditorFocusReservation: () => drawingCanvasRef.current?.clearEditorFocusReservation(),
    getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
    evaluation
  }), [evaluation]);
  const handleRenameElementConfirmed = useCallback((elementId: ElementId) => {
    sourceEditorRef.current?.jumpToElement(elementId);
    commandContext.focusSourceEditor?.();
  }, [commandContext]);
  const handleRenameTypedBindingConfirmed = useCallback((bindingId: BindingId) => {
    sourceEditorRef.current?.jumpToBindingDeclaration(bindingId);
    commandContext.focusSourceEditor?.();
  }, [commandContext]);
  const handleRenameModuleSemanticConfirmed = useCallback((target: ModuleSemanticTarget) => {
    sourceEditorRef.current?.jumpToModuleSemanticTarget?.(target);
    commandContext.focusSourceEditor?.();
  }, [commandContext]);

  useEffect(() => {
    let cancelled = false;
    void loadLayoutSettings()
      .then((settings) => {
        if (!cancelled) {
          setSavedLeftPanelWidth(settings.leftPanelWidth);
          setPrintPreviewWindow(settings.printPreviewWindow);
        }
      })
      .catch((error: unknown) => {
        console.error("failed to load layout settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, [setPrintPreviewWindow, setSavedLeftPanelWidth]);

  useEffect(() => {
    return registerUnsavedChangesGuard();
  }, []);

  useEffect(() => registerTauriMenuCommandListener(commandContext), [commandContext]);

  useEffect(() => {
    let cancelled = false;
    useCadUiStore.getState().setShortcutSettingsLoading(true);
    void loadShortcutSettings()
      .then((settings) => {
        if (cancelled) return;
        useCadUiStore.getState().setShortcutSettings(settings);
        useCadUiStore.getState().setShortcutSettingsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        useCadUiStore
          .getState()
          .setShortcutSettingsError(
            error instanceof Error ? error.message : "ショートカット設定を読み込めません。"
          );
      })
      .finally(() => {
        if (!cancelled) useCadUiStore.getState().setShortcutSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    useCadUiStore.getState().setCommandRibbonSettingsLoading(true);
    void loadCommandRibbonSettings()
      .then((settings) => {
        if (cancelled) return;
        useCadUiStore.getState().setCommandRibbonSettings(settings);
        useCadUiStore.getState().setCommandRibbonSettingsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        useCadUiStore
          .getState()
          .setCommandRibbonSettingsError(
            error instanceof Error ? error.message : "コマンドリボン設定を読み込めません。"
          );
      })
      .finally(() => {
        if (!cancelled) useCadUiStore.getState().setCommandRibbonSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The bar owns every Escape from itself. This capture listener otherwise
      // runs before the bar's bubble handler and would cancel an edit twice.
      if (
        event.key === "Escape" &&
        event.target instanceof Element &&
        event.target.closest(".command-line-bar")
      ) {
        return;
      }
      const isSourceEditorTarget = isSourceEditorKeyboardTarget(event);
      // DSL and the lens are handled by CodeMirror. The React element-search field
      // admits only cross-focus commands; menus/docks keep their own keyboard UI.
      if (isSourceEditorTarget && isSourceEditorDslKeyboardTarget(event)) return;
      if (isSourceEditorTarget && !isSourceEditorSearchKeyboardTarget(event)) return;
      if (isImeComposingKeyEvent(event) || isCommandLineInputComposing()) return;
      if (useCadUiStore.getState().showShortcutSettings) return;
      if (useCadUiStore.getState().showPaletteSettings) return;
      if (useCadUiStore.getState().showGroupTemplateLibrary) return;
      if (useCadUiStore.getState().showCommandRibbonSettings) return;
      if (useCadUiStore.getState().showSelectionColorPicker) return;
      if (useCadUiStore.getState().renameElementPromptTargetId) return;
      if (useCadUiStore.getState().renameTypedBindingPromptTargetId) return;
      if (useCadUiStore.getState().renameModuleSemanticPromptTarget) return;
      if (useCadUiStore.getState().pendingImageImport || useCadUiStore.getState().imageImportError) return;
      const commandLineSession = useCadUiStore.getState().commandLineSession;
      const keyboardOptions = {
        settings: useCadUiStore.getState().shortcutSettings,
        isPickMode: Boolean(
          useCadUiStore.getState().activePointPickTarget ||
            useCadUiStore.getState().activeNumericReferencePickTarget ||
            useCadUiStore.getState().activeLinePickTarget ||
            useCadUiStore.getState().activeTemplateInsertion
        ),
        allowModifiedEditableCommandIds: commandLineSession
          ? commandLineCreationCommandIds
          : undefined,
        scopes: isSourceEditorTarget ? (["crossFocus"] as const) : undefined
      };
      const keyboardCommand = keyboardCommandForEvent(event, keyboardOptions) ??
        (commandLineSession
          ? (() => {
              const normalCommand = keyboardCommandForEvent(event, {
                ...keyboardOptions,
                isPickMode: false
              });
              return normalCommand && creationRecipeForLegacyCommand(normalCommand.commandId)
                ? normalCommand
                : null;
            })()
          : null);
      if (useCadUiStore.getState().commandLineSession && event.key === "Escape") {
        event.preventDefault();
        cancelCommandLineEscape();
        return;
      }
      if (useCadUiStore.getState().activeTemplateInsertion && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelTemplateInsertion");
        return;
      }
      if (useCadUiStore.getState().activePointPickTarget && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelPointPick");
        return;
      }
      if (useCadUiStore.getState().activeNumericReferencePickTarget && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelNumericReferencePick");
        return;
      }
      if (useCadUiStore.getState().activeLinePickTarget && event.key === "Escape") {
        event.preventDefault();
        dispatchCommand("cancelLinePick");
        return;
      }
      if (!keyboardCommand) return;
      if (
        useCadUiStore.getState().showShortcutHelp &&
        keyboardCommand.commandId !== "toggleShortcutHelp"
      ) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      dispatchCommand(keyboardCommand.commandId, {
        ...commandContext,
        ...keyboardCommand.context
      });
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [commandContext, shortcutSettings]);

  return (
    <main
      ref={appShellRef}
      className={`app-shell ${isResizingLeftPanel ? "is-resizing-left-panel" : ""} ${isPickMode ? "is-pick-mode" : ""} ${isMultiLinePicking ? "is-multi-line-picking" : ""}`}
      style={{ "--left-panel-width": `${leftPanelWidth}px` } as CSSProperties}
      onFocusCapture={(event) => selectTextInputValue(event.target)}
      onKeyDownCapture={(event) => {
        if (
          isMultiLinePicking &&
          event.target instanceof HTMLElement &&
          !event.target.closest(".canvas-workspace, .pick-mode-status, .command-line-bar")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <SourceEditorPane
        ref={sourceEditorRef}
        canvasFocusRef={canvasFocusRef}
        commandContext={commandContext}
        commandRibbonDockRef={commandRibbonDockRef}
        inert={isMultiLinePicking}
      />
      <div
        className="left-panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="左パネル幅を変更"
        aria-valuemin={MIN_LEFT_PANEL_WIDTH}
        aria-valuemax={maximumLeftPanelWidth}
        aria-valuenow={leftPanelWidth}
        title="ドラッグで左パネル幅を変更 / ダブルクリックでリセット"
        tabIndex={0}
        inert={isMultiLinePicking || undefined}
        onPointerDown={startLeftPanelResize}
        onDoubleClick={resetLeftPanelWidth}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            decreaseLeftPanelWidth(event.shiftKey ? 40 : 10);
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            increaseLeftPanelWidth(event.shiftKey ? 40 : 10);
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            resetLeftPanelWidth();
          }
        }}
      />
      {showPrintLayout ? (
        <Suspense fallback={null}>
          <PrintLayoutCanvas evaluation={evaluation} canvasFocusRef={canvasFocusRef} />
          <PrintLayoutPanel evaluation={evaluation} />
        </Suspense>
      ) : (
        <>
          <div className="canvas-workspace" ref={canvasWorkspaceRef}>
            <DrawingCanvas
              ref={drawingCanvasRef}
              evaluation={evaluation}
              evaluationState={evaluationState}
              canvasFocusRef={canvasFocusRef}
              commandContext={commandContext}
              leftPanelDockRef={commandRibbonDockRef}
            />
            <CommandLineBar commandContext={commandContext} evaluation={evaluation} evaluationIsCurrent={evaluationIsCurrent} />
            {showPrintPreviewWindow ? (
              <Suspense fallback={null}>
                <PrintLayoutPreviewWindow
                  evaluation={evaluation}
                  workspaceRef={canvasWorkspaceRef}
                />
              </Suspense>
            ) : null}
          </div>
          <RightPanel
            evaluation={evaluation}
            evaluationState={evaluationState}
            sourceEditorRef={sourceEditorRef}
            inert={isMultiLinePicking}
          />
        </>
      )}
      <CommandPalette commandContext={commandContext} />
      <PickModeStatus />
      {activeTemplateInsertion ? (
        <Suspense fallback={null}>
          <TemplateInsertionPanel />
        </Suspense>
      ) : null}
      <ShortcutHelpOverlay isPickMode={isPickMode} />
      {showPaletteSettings ? (
        <Suspense fallback={null}>
          <PaletteSettingsDialog />
        </Suspense>
      ) : null}
      {showVisibilityProfileSettings ? (
        <Suspense fallback={null}>
          <VisibilityProfileSettingsDialog />
        </Suspense>
      ) : null}
      {showGroupTemplateLibrary ? (
        <Suspense fallback={null}>
          <GroupTemplateLibraryDialog />
        </Suspense>
      ) : null}
      {showSelectionColorPicker ? (
        <Suspense fallback={null}>
          <SelectionColorPickerDialog />
        </Suspense>
      ) : null}
      {renameElementPromptTargetId ? (
        <Suspense fallback={null}>
          <RenameElementDialog onConfirmed={handleRenameElementConfirmed} />
        </Suspense>
      ) : null}
      {renameTypedBindingPromptTargetId ? (
        <Suspense fallback={null}>
          <RenameTypedBindingDialog onConfirmed={handleRenameTypedBindingConfirmed} />
        </Suspense>
      ) : null}
      {renameModuleSemanticPromptTarget ? (
        <Suspense fallback={null}>
          <RenameModuleSemanticDialog onConfirmed={handleRenameModuleSemanticConfirmed} />
        </Suspense>
      ) : null}
      {pendingImageImport || imageImportError ? (
        <Suspense fallback={null}>
          <ImageImportDialog />
        </Suspense>
      ) : null}
      {showShortcutSettings ? (
        <Suspense fallback={null}>
          <ShortcutSettingsDialog />
        </Suspense>
      ) : null}
      {showCommandRibbonSettings ? (
        <Suspense fallback={null}>
          <CommandRibbonSettingsDialog />
        </Suspense>
      ) : null}
    </main>
  );
};
