import * as vscode from "vscode";
import { DSL_INDENT, type StatementInfo } from "@nuinuicad/nui-language";
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
  type SourceCreationInsertion
} from "../../src/commands/sourceCreationInsertion";
import {
  insertSourceCalculationMeasurementSnippet,
  insertSourceGeometryValueSnippet,
  insertSourceControlFlowSnippet,
  insertSourceOutputTemplateSnippet
} from "./sourceCreationSnippetAdapter";
import { runSourceCreationFlow } from "./sourceCreationFlow";
import { createSourceCreationMru } from "./sourceCreationMru";
import { nativeShowQuickPick } from "./nativeQuickInput";

export const VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID = "nuinuiCAD.createGeometry";
export const VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID = "nuinuiCAD.insertTemplate";

const SOURCE_TEMPLATE_STALE_MESSAGE =
  "nuinuiCAD: The Source changed while Insert Template was open. Retry the command.";
const SOURCE_TEMPLATE_UNSAFE_INSERTION_MESSAGE =
  "nuinuiCAD: Could not establish a safe Source statement boundary. Move the caret between statements and retry.";

type SourceTemplateTarget = {
  editor: vscode.TextEditor;
  document: vscode.TextDocument;
  documentUri: string;
  documentVersion: number;
  rawSource: string;
  sourceRevision: number;
  caret: vscode.Position;
  context: SourceTemplateInsertionContext;
  session: NuiLanguageAnalysisSession;
};

const isWritableSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor => {
  if (!editor) return false;
  const { document } = editor;
  if (
    document.languageId !== "nui" ||
    document.uri.scheme !== "file" ||
    !document.fileName.endsWith(".nui")
  ) return false;
  return vscode.workspace.fs?.isWritableFileSystem(document.uri.scheme) !== false;
};

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
  languageAnalysisSessionFor: ((document: vscode.TextDocument) => NuiLanguageAnalysisSession) | undefined
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
  const cursor: SourceCreationCursor = {
    sourceRevision: source.sourceRevision,
    line: caret.line + 1,
    lineCount: lineCountFor(document, rawSource),
    elementId: elementIdForLine(semantic.compiled, caret.line + 1)
  };
  const insertion = resolveSourceTemplateInsertion({ cursor, compiled: semantic.compiled });
  if (insertion.kind !== "safe") return null;
  return {
    editor,
    document,
    documentUri: document.uri.toString(),
    documentVersion: document.version,
    rawSource,
    sourceRevision: source.sourceRevision,
    caret,
    context: insertion.context,
    session
  };
};

const sourcePositionForInsertion = (insertion: SourceCreationInsertion): vscode.Position =>
  new vscode.Position(Math.max(0, insertion.sourceInsertionLine - 1), 0);

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
    insertionPosition
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
    {
      ...(target.context.scope === "direct-layout-body" ? { prefixText: DSL_INDENT } : {}),
      appendNewline: true
    }
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
    {
      ...(target.context.scope === "direct-layout-body" ? { prefixText: DSL_INDENT } : {}),
      appendNewline: true
    }
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
    {
      ...(target.context.scope === "direct-layout-body" ? { prefixText: DSL_INDENT } : {}),
      appendNewline: true
    }
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
    async (): Promise<boolean | undefined> => {
      const editor = activeSourceEditor();
      if (!isWritableSourceEditor(editor)) return undefined;

      const target = currentSourceTemplateTargetFor(editor, languageAnalysisSessionFor);
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
        target.session.getSource() === target.rawSource;

      const family = await nativeShowQuickPick(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS);
      if (!isCurrent()) {
        showStaleMessage();
        return undefined;
      }
      if (!family) return undefined;

      const insertionPosition = sourcePositionForInsertion(target.context.insertion);
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
              snippetOptions: {
                ...(target.context.scope === "direct-layout-body" ? { prefixText: DSL_INDENT } : {}),
                appendNewline: true
              },
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
