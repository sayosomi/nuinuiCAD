import * as vscode from "vscode";
import { createElementPresentationStatusIndex, type ElementPresentationStatus } from "../../src/model/elementPresentationStatus";
import type { LastGoodDslDocument } from "../../src/document/canonicalDocument";
import type { EvaluationResult } from "../../src/types/geometry";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiRuntimeEvaluationService,
  type NuiRuntimeEvaluationService
} from "./runtimeEvaluationService";
import type { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";

export const nuiSourceActivityDecorationSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export type SourceActivityLineRange = {
  elementId: string;
  startLine: number;
  endLine: number;
};

export type SourceActivityDecorationProjection = {
  hidden: readonly SourceActivityLineRange[];
  disabled: readonly SourceActivityLineRange[];
};

export type SourceActivityRuntimeSnapshot = {
  compiled: LastGoodDslDocument;
  evaluation: EvaluationResult;
};

const emptyProjection = (): SourceActivityDecorationProjection => ({
  hidden: [],
  disabled: []
});

const isHidden = (status: ElementPresentationStatus): boolean =>
  status.hiddenSelf || status.hiddenByGroup || status.hiddenByProfile;

const isDisabled = (status: ElementPresentationStatus): boolean =>
  status.disabledSelf || status.disabledByGroup || status.conditionInactive;

/**
 * Projects the shared presentation status onto compiler-owned authored
 * statements. The map's `line`/`endLine` pair is the physical statement span;
 * it includes continuation lines for multiline calls without claiming nested
 * block children as part of their parent's Source decoration.
 */
export const sourceActivityDecorationProjectionFor = ({
  compiled,
  evaluation
}: SourceActivityRuntimeSnapshot): SourceActivityDecorationProjection => {
  const statementMap = compiled.statementMap;
  const document = compiled.document;
  if (!statementMap || !document) return emptyProjection();

  const statusesByElementId = createElementPresentationStatusIndex({
    elements: document.elements,
    evaluation,
    // Fold state is presentation-only and has no bearing on hidden/disabled
    // activity inheritance. Native Source has no separate fold owner.
    groupFoldById: new Map(),
    visibilityProfiles: document.visibilityProfiles,
    activeVisibilityProfileId: document.activeVisibilityProfileId
  });
  const hidden: SourceActivityLineRange[] = [];
  const disabled: SourceActivityLineRange[] = [];

  for (const element of document.elements) {
    const status = statusesByElementId.get(element.id);
    const statement = statementMap.byElementId.get(element.id);
    if (!status || !statement) continue;
    if (
      statement.sourceRevision !== statementMap.sourceRevision ||
      statement.sourceRevision !== compiled.spans.sourceMap.sourceRevision ||
      statement.line < 1 ||
      statement.endLine < statement.line ||
      statement.endLine > compiled.sourceLines.length
    ) continue;

    const range = {
      elementId: element.id,
      startLine: statement.line,
      endLine: statement.endLine
    };
    // An element cannot be both hidden and disabled under the shared activity
    // model. Keep disabled as the defensive precedence if a future semantic
    // result supplies both families for one element.
    if (isDisabled(status)) disabled.push(range);
    else if (isHidden(status)) hidden.push(range);
  }

  return { hidden, disabled };
};

type RuntimeEvaluation = Pick<
  NuiRuntimeEvaluationService,
  "evaluateCurrent" | "invalidateDocument" | "closeDocument" | "dispose"
>;

export type SourceActivityDecorationFeatureDependencies = {
  rustProcessOwner: Pick<RustEvaluationProcessOwner, "get">;
  sessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  /** Focused-test seam; production uses the established runtime service. */
  runtimeEvaluation?: RuntimeEvaluation;
};

type SourceActivityEditor = vscode.TextEditor;

const isSupportedNuiDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const sourceActivityLineRanges = (
  document: vscode.TextDocument,
  ranges: readonly SourceActivityLineRange[]
): vscode.Range[] => {
  const result: vscode.Range[] = [];
  const lineCount = document.lineCount;
  for (const range of ranges) {
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      const lineIndex = line - 1;
      if (lineIndex < 0 || lineIndex >= lineCount) continue;
      result.push(new vscode.Range(new vscode.Position(lineIndex, 0), new vscode.Position(lineIndex, 0)));
    }
  }
  return result;
};

const noopDisposable = (): vscode.Disposable => ({ dispose: () => undefined });

const visibleTextEditors = (): readonly SourceActivityEditor[] =>
  vscode.window.visibleTextEditors ?? [];

const currentDocumentFor = (document: vscode.TextDocument): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((candidate) => candidate === document);

const currentDocumentSnapshot = (
  document: vscode.TextDocument,
  documentVersion: number,
  rawSource: string
): boolean => {
  const current = currentDocumentFor(document);
  return current !== undefined &&
    current.version === documentVersion &&
    current.getText() === rawSource;
};

const createDecorationTypes = (): {
  hidden: vscode.TextEditorDecorationType;
  disabled: vscode.TextEditorDecorationType;
} | null => {
  const create = (vscode.window as typeof vscode.window & {
    createTextEditorDecorationType?: typeof vscode.window.createTextEditorDecorationType;
  }).createTextEditorDecorationType;
  if (typeof create !== "function") return null;

  return {
    hidden: create.call(vscode.window, {
      isWholeLine: true,
      opacity: "0.72"
    }),
    disabled: create.call(vscode.window, {
      isWholeLine: true,
      opacity: "0.48"
    })
  };
};

export const registerNuiSourceActivityDecorationFeature = ({
  rustProcessOwner,
  sessionFor,
  runtimeEvaluation: suppliedRuntimeEvaluation
}: SourceActivityDecorationFeatureDependencies): vscode.Disposable => {
  const decorations = createDecorationTypes();
  // Focused Extension Host tests may intentionally omit the decoration API;
  // production VS Code always provides it.
  if (!decorations) return noopDisposable();

  const runtimeEvaluation = suppliedRuntimeEvaluation ?? createNuiRuntimeEvaluationService({
    rustProcessOwner,
    isDocumentCurrent: (key, version) => vscode.workspace.textDocuments.some((document) =>
      documentKey(document) === key && document.version === version
    )
  });
  const trackedEditorsByDocument = new Map<string, Set<SourceActivityEditor>>();
  let disposed = false;

  const clearEditor = (editor: SourceActivityEditor): void => {
    editor.setDecorations(decorations.hidden, []);
    editor.setDecorations(decorations.disabled, []);
  };

  const clearDocument = (key: string): void => {
    const editors = new Set(trackedEditorsByDocument.get(key) ?? []);
    for (const editor of visibleTextEditors()) {
      if (documentKey(editor.document) === key) editors.add(editor);
    }
    for (const editor of editors) clearEditor(editor);
    trackedEditorsByDocument.delete(key);
  };

  const editorsForDocument = (document: vscode.TextDocument): SourceActivityEditor[] =>
    visibleTextEditors().filter((editor) => editor.document === document);

  const applyProjection = (
    document: vscode.TextDocument,
    projection: SourceActivityDecorationProjection
  ): void => {
    const key = documentKey(document);
    const visibleEditors = editorsForDocument(document);
    const visibleSet = new Set(visibleEditors);
    const trackedEditors = trackedEditorsByDocument.get(key) ?? new Set<SourceActivityEditor>();
    for (const editor of trackedEditors) {
      if (!visibleSet.has(editor)) {
        clearEditor(editor);
        trackedEditors.delete(editor);
      }
    }
    for (const editor of visibleEditors) {
      trackedEditors.add(editor);
      editor.setDecorations(decorations.hidden, sourceActivityLineRanges(editor.document, projection.hidden));
      editor.setDecorations(decorations.disabled, sourceActivityLineRanges(editor.document, projection.disabled));
    }
    if (trackedEditors.size > 0) trackedEditorsByDocument.set(key, trackedEditors);
    else trackedEditorsByDocument.delete(key);
  };

  const refreshDocument = async (document: vscode.TextDocument): Promise<void> => {
    if (disposed || !isSupportedNuiDocument(document)) return;
    const key = documentKey(document);
    const documentVersion = document.version;
    const rawSource = document.getText();
    clearDocument(key);

    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: session.getSourceRevision()
    };
    const snapshot = await runtimeEvaluation.evaluateCurrent({
      documentKey: key,
      documentVersion,
      source,
      session,
      isCancelled: () => !currentDocumentSnapshot(document, documentVersion, rawSource)
    });

    if (!currentDocumentSnapshot(document, documentVersion, rawSource)) return;
    if (
      !snapshot ||
      snapshot.proof.documentKey !== key ||
      snapshot.proof.documentVersion !== documentVersion ||
      snapshot.proof.normalizedSource !== source.normalizedSource ||
      snapshot.proof.sourceRevision !== source.sourceRevision
    ) {
      clearDocument(key);
      return;
    }
    applyProjection(document, sourceActivityDecorationProjectionFor(snapshot));
  };

  const refreshDocumentSafely = (document: vscode.TextDocument): void => {
    const documentVersion = document.version;
    const rawSource = document.getText();
    void refreshDocument(document).catch(() => {
      if (currentDocumentSnapshot(document, documentVersion, rawSource)) clearDocument(documentKey(document));
    });
  };

  const refreshVisibleDocuments = (): void => {
    const currentVisibleEditors = visibleTextEditors().filter((editor) =>
      isSupportedNuiDocument(editor.document)
    );
    const currentVisibleSet = new Set(currentVisibleEditors);
    for (const [key, editors] of trackedEditorsByDocument) {
      for (const editor of editors) {
        if (!currentVisibleSet.has(editor)) {
          clearEditor(editor);
          editors.delete(editor);
        }
      }
      if (editors.size === 0) trackedEditorsByDocument.delete(key);
    }

    const documents = new Map<string, vscode.TextDocument>();
    for (const editor of currentVisibleEditors) documents.set(documentKey(editor.document), editor.document);
    for (const document of documents.values()) refreshDocumentSafely(document);
  };

  const listeners: vscode.Disposable[] = [];
  listeners.push(vscode.workspace.onDidOpenTextDocument((document) => {
    if (editorsForDocument(document).length > 0) refreshDocumentSafely(document);
  }));
  listeners.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (!isSupportedNuiDocument(event.document) || event.contentChanges.length === 0) return;
    const key = documentKey(event.document);
    runtimeEvaluation.invalidateDocument(key);
    clearDocument(key);
    if (editorsForDocument(event.document).length > 0) {
      refreshDocumentSafely(event.document);
    }
  }));
  listeners.push(vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isSupportedNuiDocument(document)) return;
    const key = documentKey(document);
    runtimeEvaluation.closeDocument(key);
    clearDocument(key);
  }));

  const optionalWindow = vscode.window as typeof vscode.window & {
    onDidChangeVisibleTextEditors?: typeof vscode.window.onDidChangeVisibleTextEditors;
  };
  if (typeof optionalWindow.onDidChangeVisibleTextEditors === "function") {
    listeners.push(optionalWindow.onDidChangeVisibleTextEditors(refreshVisibleDocuments));
  }
  listeners.push(vscode.window.onDidChangeActiveTextEditor(refreshVisibleDocuments));

  refreshVisibleDocuments();

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const listener of listeners) listener.dispose();
      for (const key of [...trackedEditorsByDocument.keys()]) clearDocument(key);
      trackedEditorsByDocument.clear();
      runtimeEvaluation.dispose();
      decorations.hidden.dispose();
      decorations.disabled.dispose();
    }
  };
};
