import * as vscode from "vscode";
import {
  DSL_INDENT,
  sourceModuleTemplateCandidates,
  type CompiledDslDocument,
  type StatementInfo,
  type SourceModuleTemplateCandidate,
  type SourceModuleTemplateInsertionLocation
} from "@nuinuicad/nui-language";
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import { normalizedSourceFor } from "./sourceOffsetAdapter";
import {
  SOURCE_OUTPUT_TEMPLATE_DEFINITIONS,
  sourceOutputTemplateIsLegalIn,
  sourceOutputTemplateSnippetFor,
  type SourceOutputTemplateId
} from "../../src/commands/sourceOutputTemplateCatalog";
import {
  SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS,
  type SourceControlFlowTemplatePresentation
} from "../../src/commands/sourceControlFlowTemplateCatalog";
import { materializeSourceControlFlowTemplate } from "../../src/commands/sourceControlFlowTemplateMaterializer";
import {
  SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS,
  type SourceValueMatchTemplatePresentation
} from "../../src/commands/sourceValueMatchTemplateCatalog";
import { materializeSourceValueMatchTemplate } from "../../src/commands/sourceValueMatchTemplateMaterializer";
import {
  SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS,
  type SourceModuleTemplatePresentation
} from "../../src/commands/sourceModuleTemplateCatalog";
import { materializeSourceModuleTemplate } from "../../src/commands/sourceModuleTemplateMaterializer";
import {
  SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS,
  type SourceStyleProfileTemplatePresentation
} from "../../src/commands/sourceStyleProfileTemplateCatalog";
import { materializeSourceStyleProfileTemplate } from "../../src/commands/sourceStyleProfileTemplateMaterializer";
import {
  SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS,
  resolveSourceTemplateInsertion,
  sourceTemplateRouteFor,
  type SourceTemplateInsertionContext
} from "../../src/commands/sourceTemplateCatalog";
import {
  sourceGeometryValueTemplateGroups,
  type SourceGeometryValueConstructionPlan,
  type SourceGeometryValueTemplateForm,
  type SourceGeometryValueTemplateGroup
} from "../../src/commands/sourceGeometryValueTemplateCatalog";
import { materializeSourceGeometryValueTemplate } from "../../src/commands/sourceGeometryValueTemplateMaterializer";
import {
  sourceCalculationMeasurementTemplatePlans,
  type SourceCalculationMeasurementTemplatePlan
} from "../../src/commands/sourceCalculationMeasurementTemplateCatalog";
import { materializeSourceCalculationMeasurementTemplate } from "../../src/commands/sourceCalculationMeasurementTemplateMaterializer";
import {
  type SourceCreationCursor,
  type SourceCreationInsertion,
  resolveDocumentEndSourceCreationInsertion,
  type SourceCreationInsertionOrigin
} from "../../src/commands/sourceCreationInsertion";
import {
  insertSourceCalculationMeasurementSnippet,
  insertSourceGeometryValueSnippet,
  insertSourceControlFlowSnippet,
  insertSourceValueMatchSnippet,
  insertSourceOutputTemplateSnippet,
  insertSourceModuleTemplateSnippet,
  insertSourceStyleProfileTemplateSnippet
} from "./sourceCreationSnippetAdapter";
import { runSourceCreationFlow } from "./sourceCreationFlow";
import { createSourceCreationMru } from "./sourceCreationMru";
import { nativeShowQuickPick } from "./nativeQuickInput";

export const VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID = "nuinuiCAD.createGeometry";
export const VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID = "nuinuiCAD.insertTemplate";

export type SourceCreationInternalInvocation = {
  documentUri: string;
  expectedDocumentVersion: number;
  insertionOrigin: "document-end";
};

const isSourceCreationInternalInvocation = (value: unknown): value is SourceCreationInternalInvocation => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SourceCreationInternalInvocation>;
  return typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.expectedDocumentVersion) &&
    candidate.insertionOrigin === "document-end";
};

const SOURCE_TEMPLATE_STALE_MESSAGE =
  "nuinuiCAD: The Source changed while Insert Template was open. Retry the command.";
const SOURCE_TEMPLATE_UNSAFE_INSERTION_MESSAGE =
  "nuinuiCAD: Could not establish a safe Source statement boundary. Move the caret between statements and retry.";
const SOURCE_MODULE_TEMPLATE_NO_CANDIDATES_MESSAGE =
  "nuinuiCAD: No legal Module callees are available at this Source insertion target.";
const SOURCE_MODULE_TEMPLATE_EXPORT_SCOPE_MESSAGE =
  "nuinuiCAD: Export Module is legal only at the document top level.";
const SOURCE_STYLE_PROFILE_TEMPLATE_PROFILE_SCOPE_MESSAGE =
  "nuinuiCAD: Profile is legal only at the document top level.";

type SourceTemplateTarget = {
  editor: vscode.TextEditor;
  document: vscode.TextDocument;
  documentUri: string;
  documentVersion: number;
  rawSource: string;
  sourceRevision: number;
  caret: vscode.Position;
  context: SourceTemplateInsertionContext;
  insertionOrigin: SourceCreationInsertionOrigin;
  compiled: CompiledDslDocument;
  session: NuiLanguageAnalysisSession;
};

export const isWritableSourceDocument = (document: vscode.TextDocument): boolean => {
  if (
    document.languageId !== "nui" ||
    document.uri.scheme !== "file" ||
    !document.fileName.endsWith(".nui")
  ) return false;
  return vscode.workspace.fs?.isWritableFileSystem(document.uri.scheme) !== false;
};

export const isWritableSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  editor !== undefined && isWritableSourceDocument(editor.document);

const lineCountFor = (document: vscode.TextDocument, rawSource: string): number =>
  Number.isInteger(document.lineCount) && document.lineCount > 0
    ? document.lineCount
    : normalizedSourceFor(rawSource).split("\n").length;

const sourceElementOwnsLine = (info: StatementInfo, line: number): boolean => {
  const blockElement = info.closeBraceLine !== undefined && info.closeBraceLine > info.endLine;
  return info.range.startLine <= line && (
    blockElement
      ? line <= info.endLine || line === info.closeBraceLine
      : line <= info.range.endLine
  );
};

const elementIdForLine = (
  compiled: NonNullable<ReturnType<typeof currentCompiledSemanticSnapshotFor>>["compiled"],
  line: number
): SourceCreationCursor["elementId"] => {
  const statementMap = compiled.statementMap;
  if (!statementMap) return null;
  const candidates = [...statementMap.byElementId.entries()]
    .filter(([, info]) => sourceElementOwnsLine(info, line))
    .sort(([, left], [, right]) => {
      const depth = right.indentDepth - left.indentDepth;
      if (depth !== 0) return depth;
      return (left.range.endLine - left.range.startLine) - (right.range.endLine - right.range.startLine);
    });
  return candidates[0]?.[0] ?? null;
};

const currentSourceTemplateTargetFor = (
  editor: vscode.TextEditor,
  languageAnalysisSessionFor: ((document: vscode.TextDocument) => NuiLanguageAnalysisSession) | undefined,
  insertionOrigin: SourceCreationInsertionOrigin = "source-cursor"
): SourceTemplateTarget | null => {
  if (!languageAnalysisSessionFor || !isWritableSourceEditor(editor)) return null;
  const document = editor.document;
  const rawSource = document.getText();
  const session = languageAnalysisSessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: session.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(session, source);
  if (!semantic) return null;
  const caret = editor.selection.active;
  const insertion = insertionOrigin === "document-end"
    ? resolveDocumentEndSourceCreationInsertion({
        sourceText: rawSource,
        documentText: rawSource,
        sourceRevision: source.sourceRevision,
        elements: [...semantic.compiled.sourceElementsByStatementIndex.values()],
        statementMap: semantic.compiled.statementMap
      })
    : resolveSourceTemplateInsertion({
        cursor: {
          sourceRevision: source.sourceRevision,
          line: caret.line + 1,
          lineCount: lineCountFor(document, rawSource),
          elementId: elementIdForLine(semantic.compiled, caret.line + 1)
        },
        compiled: semantic.compiled
      });
  if (insertion.kind !== "safe") return null;
  return {
    editor,
    document,
    documentUri: document.uri.toString(),
    documentVersion: document.version,
    rawSource,
    sourceRevision: source.sourceRevision,
    caret,
    context: insertionOrigin === "document-end"
      ? { insertion: insertion.insertion, scope: "top-level" }
      : insertion.context,
    insertionOrigin,
    compiled: semantic.compiled,
    session
  };
};

const sourcePositionForInsertion = (insertion: SourceCreationInsertion): vscode.Position =>
  new vscode.Position(Math.max(0, insertion.sourceInsertionLine - 1), 0);

const sourcePositionForTarget = (target: SourceTemplateTarget): vscode.Position =>
  target.insertionOrigin === "document-end"
    ? target.document.positionAt(target.rawSource.length)
    : sourcePositionForInsertion(target.context.insertion);

const sourceCreationSnippetOptionsFor = (target: SourceTemplateTarget) =>
  target.insertionOrigin === "document-end" && !target.rawSource.endsWith("\n")
    ? { prefixText: "\n", appendNewline: true }
    : {
        ...(target.context.scope === "direct-layout-body" ? { prefixText: DSL_INDENT } : {}),
        appendNewline: true
      };

const sourceOutputSnippetOptionsFor = (target: SourceTemplateTarget) =>
  target.insertionOrigin === "document-end" && !target.rawSource.endsWith("\n")
    ? { prefixText: "\n" }
    : undefined;

const stableStatementIdFor = (compiled: CompiledDslDocument, statementIndex: number): string | undefined =>
  compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex) ??
  compiled.statementMap?.elementIdByStatementIndex.get(statementIndex) ??
  compiled.sourceLexicalNamespace?.allDeclarations.find((declaration) => declaration.statementIndex === statementIndex)?.statementId ??
  compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.statementIndex === statementIndex)?.statementId;

const sourceModuleScopeIdFor = (
  compiled: CompiledDslDocument,
  info: StatementInfo,
  insertionLine: number
): string | undefined => {
  const statement = compiled.statements[info.statementIndex];
  const statementId = stableStatementIdFor(compiled, info.statementIndex);
  if (!statementId || !statement) return undefined;
  if (statement.kind === "moduleDefinition") return `module:${statementId}`;
  if (statement.kind === "layout") return `layout:${statementId}`;
  if (statement.kind === "group") return `group:${statementId}`;
  if (statement.kind !== "element") return undefined;
  if (statement.type === "forGroup") return `for:${statementId}`;
  if (statement.type === "conditionalGroup") {
    return `if:${statementId}:${info.elseLine !== undefined && insertionLine > info.elseLine ? "else" : "then"}`;
  }
  return undefined;
};

const sourceModuleTemplateInsertionFor = (
  compiled: CompiledDslDocument,
  insertion: SourceCreationInsertion
): SourceModuleTemplateInsertionLocation => {
  const infos = compiled.statementMap?.statements ?? [];
  const openingBraceLineFor = (info: StatementInfo): number | undefined =>
    info.openBraceLine ?? (info.range.endLine > info.endLine ? info.endLine : undefined);
  const enclosing = infos
    .filter((info) =>
      openingBraceLineFor(info) !== undefined &&
      info.closeBraceLine !== undefined &&
      openingBraceLineFor(info)! < insertion.sourceInsertionLine &&
      insertion.sourceInsertionLine <= info.closeBraceLine
    )
    .sort((left, right) => right.indentDepth - left.indentDepth)[0];
  const statementIndex = enclosing?.statementIndex ?? infos
    .filter((info) => info.endLine < insertion.sourceInsertionLine)
    .sort((left, right) => right.endLine - left.endLine)[0]?.statementIndex ??
    infos[0]?.statementIndex ?? 0;
  const scopeId = enclosing
    ? sourceModuleScopeIdFor(compiled, enclosing, insertion.sourceInsertionLine)
    : compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(statementIndex);
  return {
    statementIndex,
    ...(scopeId ? { scopeId } : {}),
    sourceOrderIndex: statementIndex
  };
};

const outputTemplateIdForLabel = (label: string): SourceOutputTemplateId | null =>
  SOURCE_OUTPUT_TEMPLATE_DEFINITIONS.find((template) => template.label === label)?.id ?? null;

const illegalScopeMessageFor = (templateId: SourceOutputTemplateId): string =>
  templateId === "place"
    ? "nuinuiCAD: Place is legal only directly inside a layout body."
    : "nuinuiCAD: This template is legal only at the document top level.";

const insertOutputTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void
): Promise<boolean | undefined> => {
  const outputTemplateLabel = await nativeShowQuickPick(
    SOURCE_OUTPUT_TEMPLATE_DEFINITIONS.map((template) => template.label)
  );
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!outputTemplateLabel) return undefined;
  const templateId = outputTemplateIdForLabel(outputTemplateLabel);
  if (!templateId) return undefined;
  if (!sourceOutputTemplateIsLegalIn(templateId, target.context.scope)) {
    void vscode.window.showErrorMessage(illegalScopeMessageFor(templateId));
    return undefined;
  }

  return insertSourceOutputTemplateSnippet(
    target.editor,
    sourceOutputTemplateSnippetFor(templateId),
    insertionPosition,
    sourceOutputSnippetOptionsFor(target)
  );
};

type SourceGeometryValueGroupPickerItem = {
  label: string;
  group: SourceGeometryValueTemplateGroup;
};

type SourceGeometryValueConstructionPickerItem = {
  label: string;
  plan: SourceGeometryValueConstructionPlan;
};

type SourceGeometryValueFormPickerItem = {
  label: string;
  form: SourceGeometryValueTemplateForm;
};

const geometryValueGroupPickerItemsFor = (): SourceGeometryValueGroupPickerItem[] =>
  sourceGeometryValueTemplateGroups().map((group) => ({
    label: group.label,
    group
  }));

const geometryValueConstructionPickerItemsFor = (
  group: SourceGeometryValueTemplateGroup
): SourceGeometryValueConstructionPickerItem[] =>
  group.plans.map((plan) => ({
    label: plan.construction,
    plan
  }));

const geometryValueFormPickerItemsFor = (
  plan: SourceGeometryValueConstructionPlan
): SourceGeometryValueFormPickerItem[] =>
  plan.forms.map((form) => ({
    label: form.exclusiveChoices.map(({ selectedArgName }) => selectedArgName).join(" + "),
    form
  }));

const insertGeometryValueTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void
): Promise<boolean | undefined> => {
  const groupItem = await nativeShowQuickPick(geometryValueGroupPickerItemsFor());
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!groupItem) return undefined;

  const constructionItem = await nativeShowQuickPick(
    geometryValueConstructionPickerItemsFor(groupItem.group)
  );
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!constructionItem) return undefined;

  let form = constructionItem.plan.forms[0];
  if (!form) return undefined;
  if (constructionItem.plan.forms.length > 1) {
    const formItem = await nativeShowQuickPick(geometryValueFormPickerItemsFor(constructionItem.plan));
    if (!isCurrent()) {
      showStaleMessage();
      return undefined;
    }
    if (!formItem) return undefined;
    form = formItem.form;
  }

  const materialization = materializeSourceGeometryValueTemplate(constructionItem.plan, form);
  if (!materialization) return undefined;
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }

  return insertSourceGeometryValueSnippet(
    target.editor,
    materialization,
    insertionPosition,
    sourceCreationSnippetOptionsFor(target)
  );
};

type SourceCalculationMeasurementPickerItem = {
  label: string;
  plan: SourceCalculationMeasurementTemplatePlan;
};

const calculationMeasurementPickerItemsFor = (): SourceCalculationMeasurementPickerItem[] =>
  sourceCalculationMeasurementTemplatePlans().map((plan) => ({
    label: plan.label,
    plan
  }));

const insertCalculationMeasurementTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void
): Promise<boolean | undefined> => {
  const item = await nativeShowQuickPick(calculationMeasurementPickerItemsFor());
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!item) return undefined;

  const materialization = materializeSourceCalculationMeasurementTemplate(item.plan);
  if (!materialization) return undefined;
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }

  return insertSourceCalculationMeasurementSnippet(
    target.editor,
    materialization,
    insertionPosition,
    sourceCreationSnippetOptionsFor(target)
  );
};

const insertControlFlowTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void
): Promise<boolean | undefined> => {
  const item = await nativeShowQuickPick<SourceControlFlowTemplatePresentation>(
    SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS
  );
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!item) return undefined;

  const materialization = materializeSourceControlFlowTemplate(item.id);
  if (!materialization) return undefined;
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }

  return insertSourceControlFlowSnippet(
    target.editor,
    materialization,
    insertionPosition,
    sourceCreationSnippetOptionsFor(target)
  );
};

const insertValueMatchTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void
): Promise<boolean | undefined> => {
  const item = await nativeShowQuickPick<SourceValueMatchTemplatePresentation>(
    SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS
  );
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!item) return undefined;

  const materialization = materializeSourceValueMatchTemplate(item.id);
  if (!materialization) return undefined;
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }

  return insertSourceValueMatchSnippet(
    target.editor,
    materialization,
    insertionPosition,
    sourceCreationSnippetOptionsFor(target)
  );
};

const insertModuleTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void
): Promise<boolean | undefined> => {
  const item = await nativeShowQuickPick<SourceModuleTemplatePresentation>(
    SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS
  );
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!item) return undefined;

  const templateId = item.id;
  if (templateId === "export-module" && target.context.scope !== "top-level") {
    void vscode.window.showErrorMessage(SOURCE_MODULE_TEMPLATE_EXPORT_SCOPE_MESSAGE);
    return undefined;
  }

  let candidate: SourceModuleTemplateCandidate | undefined;
  if (templateId === "module-instance") {
    const insertion = sourceModuleTemplateInsertionFor(target.compiled, target.context.insertion);
    const candidates = sourceModuleTemplateCandidates({
      compiled: target.compiled,
      insertion
    });
    if (candidates.length === 0) {
      void vscode.window.showErrorMessage(SOURCE_MODULE_TEMPLATE_NO_CANDIDATES_MESSAGE);
      return undefined;
    }
    candidate = await nativeShowQuickPick(candidates);
    if (!isCurrent()) {
      showStaleMessage();
      return undefined;
    }
    if (!candidate) return undefined;
  }

  const materialization = materializeSourceModuleTemplate(templateId, candidate);
  if (!materialization) return undefined;
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }

  return insertSourceModuleTemplateSnippet(
    target.editor,
    materialization,
    insertionPosition,
    sourceCreationSnippetOptionsFor(target)
  );
};

const insertStyleProfileTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void
): Promise<boolean | undefined> => {
  const item = await nativeShowQuickPick<SourceStyleProfileTemplatePresentation>(
    SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS
  );
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!item) return undefined;

  if (item.id === "profile" && target.context.scope !== "top-level") {
    void vscode.window.showErrorMessage(SOURCE_STYLE_PROFILE_TEMPLATE_PROFILE_SCOPE_MESSAGE);
    return undefined;
  }

  const materialization = materializeSourceStyleProfileTemplate(item.id);
  if (!materialization) return undefined;
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }

  return insertSourceStyleProfileTemplateSnippet(
    target.editor,
    materialization,
    insertionPosition,
    sourceCreationSnippetOptionsFor(target)
  );
};

const unreachableSourceTemplateRoute = (route: never): never => {
  throw new Error(`Unsupported Source Template route: ${String(route)}`);
};

export const registerVscodeSourceCreationCommandFeature = ({
  activeSourceEditor,
  displayLanguageFor,
  languageAnalysisSessionFor
}: {
  activeSourceEditor: () => vscode.TextEditor | undefined;
  displayLanguageFor: () => string;
  languageAnalysisSessionFor?: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
}): vscode.Disposable => {
  const sourceCreationMru = createSourceCreationMru();
  const createGeometryCommand = vscode.commands.registerCommand(
    VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID,
    async (): Promise<boolean | undefined> => {
      const editor = activeSourceEditor();
      if (!editor) return undefined;
      const position = editor.selection.active;
      return runSourceCreationFlow(editor, position, displayLanguageFor(), sourceCreationMru);
    }
  );
  const insertTemplateCommand = vscode.commands.registerCommand(
    VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID,
    async (invocationArgument?: unknown): Promise<boolean | undefined> => {
      const internalInvocation = invocationArgument === undefined
        ? undefined
        : isSourceCreationInternalInvocation(invocationArgument)
          ? invocationArgument
          : null;
      if (internalInvocation === null) return undefined;
      const editor = activeSourceEditor();
      if (!isWritableSourceEditor(editor)) return undefined;
      if (internalInvocation && (
        editor.document.uri.toString() !== internalInvocation.documentUri ||
        editor.document.version !== internalInvocation.expectedDocumentVersion
      )) return undefined;

      const target = currentSourceTemplateTargetFor(
        editor,
        languageAnalysisSessionFor,
        internalInvocation?.insertionOrigin ?? "source-cursor"
      );
      if (!target) {
        void vscode.window.showErrorMessage(SOURCE_TEMPLATE_UNSAFE_INSERTION_MESSAGE);
        return undefined;
      }

      let staleMessageShown = false;
      const showStaleMessage = (): void => {
        if (staleMessageShown) return;
        staleMessageShown = true;
        void vscode.window.showErrorMessage(SOURCE_TEMPLATE_STALE_MESSAGE);
      };
      const isCurrent = (): boolean =>
        target.editor.document === target.document &&
        target.editor.document.uri.toString() === target.documentUri &&
        target.document.version === target.documentVersion &&
        target.session.getSourceRevision() === target.sourceRevision &&
        target.session.getSource() === target.rawSource &&
        (!internalInvocation || (() => {
          const currentEditor = activeSourceEditor();
          return isWritableSourceEditor(currentEditor) &&
            currentEditor.document.uri.toString() === internalInvocation.documentUri &&
            currentEditor.document.version === internalInvocation.expectedDocumentVersion;
        })());

      const family = await nativeShowQuickPick(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS);
      if (!isCurrent()) {
        showStaleMessage();
        return undefined;
      }
      if (!family) return undefined;

      const insertionPosition = sourcePositionForTarget(target);
      const route = sourceTemplateRouteFor(family.id);
      switch (route.kind) {
        case "geometry":
          return runSourceCreationFlow(
            target.editor,
            target.caret,
            displayLanguageFor(),
            sourceCreationMru,
            {
              insertionPosition,
              snippetOptions: sourceCreationSnippetOptionsFor(target),
              isCurrent,
              onStale: showStaleMessage
            }
          );
        case "geometry-value":
          return insertGeometryValueTemplate(
            target,
            insertionPosition,
            isCurrent,
            showStaleMessage
          );
        case "calculation-measurement":
          return insertCalculationMeasurementTemplate(
            target,
            insertionPosition,
            isCurrent,
            showStaleMessage
          );
        case "control-flow":
          return insertControlFlowTemplate(
            target,
            insertionPosition,
            isCurrent,
            showStaleMessage
          );
        case "value-match":
          return insertValueMatchTemplate(
            target,
            insertionPosition,
            isCurrent,
            showStaleMessage
          );
        case "module":
          return insertModuleTemplate(
            target,
            insertionPosition,
            isCurrent,
            showStaleMessage
          );
        case "style-profile":
          return insertStyleProfileTemplate(
            target,
            insertionPosition,
            isCurrent,
            showStaleMessage
          );
        case "output-print":
          return insertOutputTemplate(
            target,
            insertionPosition,
            isCurrent,
            showStaleMessage
          );
      }
      return unreachableSourceTemplateRoute(route);
    }
  );
  return {
    dispose: (): void => {
      createGeometryCommand.dispose();
      insertTemplateCommand.dispose();
    }
  };
};
