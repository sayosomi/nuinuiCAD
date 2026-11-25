import { evaluateElementsReference } from "../../src/geometry/evaluationEngine";
import { evaluationResultToPayload } from "../../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import {
  compileDslDocument,
  createModuleRuntimeContext,
  isDslOutputPreviewRevealSourceTargetStructurallyAvailable,
  queryDslOutputPreviewRevealSourceTarget,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { LEGACY_CANVAS_THEME } from "../../src/components/canvasTheme";
import {
  CANVAS_GRID_ENABLED_SETTING,
  CANVAS_GRID_MAJOR_EVERY_SETTING,
  CANVAS_GRID_SNAP_ENABLED_SETTING,
  CANVAS_GRID_SPACING_SETTING
} from "../../src/components/canvasGrid";
import type { ExtensionToVscodeMessage, VscodeCanvasObservationSnapshot, VscodeWebviewApi } from "../../src/vscode/protocol";
import { OutputPreviewApp } from "../../src/vscode/OutputPreviewApp";
import { projectVscodeMultiDocumentCanvasRuntime } from "../../src/vscode/multiDocumentRuntimeTransport";
import { vscodeMultiDocumentGraphSnapshot, type VscodeMultiDocumentGraphPublication } from "../../src/vscode/multiDocumentGraphTransport";
import { createRustStdioParityClient } from "../../test/evaluationParitySupport";
import type { EvaluateDocumentInput } from "../../src/geometry/rustEvaluationInput";
import type { EvaluationPayload } from "../../src/geometry/evaluationPayload";
import { canvasImageSourceUrl } from "../../src/vscode/canvasImageResources";
import { selectElement } from "../../src/commands/selectionCommands";
import { initialCadDocumentState, useCadDocumentStore } from "../../src/state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../../src/state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../../src/test/canvasSelectionTestUtils";
import { inlineModuleCanvasTargetProofsFor } from "../../src/vscode/inlineModuleCanvas";
import { selectedElementSourcesForCanvasObservation } from "../../src/vscode/canvasObservation";
import { vscodeObservationState } from "./vscodeObservationState";
import {
  canvasVisualPickSourceStatementIndexesFor,
  coordinatePointConversionCanvasTargetsFor
} from "./coordinatePointConversionCommandFeature";
import type { NuiElementsTreeNode } from "./elementsTreeProvider";
import { canonicalVscodeDocumentId, type VscodeMultiDocumentDiagnosticsState } from "./multiDocumentHost";
import { createVscodeModuleMultiDocumentHost } from "./moduleMultiDocumentHost";
import { publishVscodeMultiDocumentGraphPublication } from "../../src/vscode/vscodeWebviewSession";
import type { WebviewEditableFocusContext } from "./webviewEditableFocusContext";

type MockPosition = { line: number; character: number };
type MockSelection = {
  anchor: MockPosition;
  active: MockPosition;
  start: MockPosition;
  end: MockPosition;
};

type TestDocument = {
  fileName: string;
  languageId?: string;
  version: number;
  readonly lineCount: number;
  uri: { scheme: string; fsPath: string; toString: () => string };
  isDirty?: boolean;
  getText: () => string;
  offsetAt: (position: { line: number; character: number }) => number;
  positionAt: (offset: number) => { line: number; character: number };
  lineAt: (line: number) => {
    text: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  setSourceText: (text: string) => void;
  onGetText?: () => void;
};

type TestDocumentChangeEvent = {
  document: TestDocument;
  reason?: number;
  contentChanges: readonly unknown[];
};

type TestEditor = {
  document: TestDocument;
  viewColumn?: number;
  selection: MockSelection;
  selections: MockSelection[];
  edit: ReturnType<typeof vi.fn>;
  editBuilder: { replace: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
  revealRange?: ReturnType<typeof vi.fn>;
};

type TestPanel = {
  title: string;
  active: boolean;
  visible: boolean;
  canvasSelection?: string;
  webview: {
    cspSource: string;
    html: string;
    options: { enableScripts?: boolean; localResourceRoots?: unknown[] };
    asWebviewUri: (uri: unknown) => unknown;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
  onDidChangeViewState: ReturnType<typeof vi.fn>;
};

type TestRustProcess = {
  request: ReturnType<typeof vi.fn>;
  exportOutput: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

type TestDiagnosticCollection = {
  name: string;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as TestEditor | null,
  displayLanguage: "en",
  visibleTextEditors: [] as TestEditor[],
  textDocuments: [] as TestDocument[],
  commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  activeEditorListeners: [] as Array<(editor?: TestEditor) => void>,
  tabListeners: [] as Array<() => void>,
  tabGroupListeners: [] as Array<() => void>,
  selectionChangeListeners: [] as Array<(event: { textEditor: TestEditor; kind?: number }) => void>,
  activeColorThemeListeners: [] as Array<() => void>,
  documentOpenListeners: [] as Array<(document: TestDocument) => void>,
  documentChangeListeners: [] as Array<(event: TestDocumentChangeEvent) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  panels: [] as TestPanel[],
  rustProcesses: [] as TestRustProcess[],
  evaluateRust: undefined as ((input: EvaluateDocumentInput) => Promise<EvaluationPayload>) | undefined,
  diagnosticCollections: [] as TestDiagnosticCollection[],
  multiDocumentHost: null as {
    diagnosticsStateFor: ReturnType<typeof vi.fn>;
    onDiagnosticsChanged: ReturnType<typeof vi.fn>;
    isCanvasGraphCommitAuthorityCurrent?: ReturnType<typeof vi.fn>;
    isSavedGraphSnapshotCurrent?: ReturnType<typeof vi.fn>;
    languageSemanticSnapshotFor?: ReturnType<typeof vi.fn>;
    canvasSourceDefinitionFor?: ReturnType<typeof vi.fn>;
  } | null,
  multiDocumentDiagnosticsListeners: [] as Array<(documentUri: string) => void>,
  contexts: [] as Array<{ subscriptions: Array<{ dispose: () => void }> }>,
  completionRegistrations: [] as Array<{ selector: unknown; provider: unknown; triggerCharacters: string[]; disposable: { dispose: () => void } }>,
  signatureHelpRegistrations: [] as Array<{ selector: unknown; provider: unknown; triggerCharacters: string[]; disposable: { dispose: () => void } }>,
  definitionRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  renameRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  referenceRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  codeActionRegistrations: [] as Array<{ selector: unknown; provider: unknown; providedCodeActionKinds: unknown[]; disposable: { dispose: () => void } }>,
  foldingRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  documentSymbolRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  colorRegistrations: [] as Array<{ selector: unknown; provider: unknown; disposable: { dispose: () => void } }>,
  globalStateValues: {} as Record<string, unknown>,
  globalStateUpdates: [] as Array<{ key: string; value: unknown }>,
  canvasGridSettings: {} as Record<string, unknown>,
  canvasGridConfigurationInspection: {} as Record<string, unknown>,
  configurationUpdates: [] as Array<{ section: string; value: unknown; target: unknown }>,
  configurationScopes: [] as Array<{ section?: string; scope?: unknown }>,
  configurationChangeListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showSaveDialog: vi.fn(),
  createOutputChannel: vi.fn(),
  bakeSettings: {} as Record<string, boolean>,
  showTextDocument: vi.fn(),
  openTextDocument: vi.fn(),
  applyEdit: vi.fn(),
  workspaceEdits: [] as Array<{ replacements: Array<{ uri: unknown; range: unknown; replacement: string }> }>,
  executeCommand: vi.fn(),
  createWebviewPanel: vi.fn(),
  createDiagnosticCollection: vi.fn(),
  registerCompletionItemProvider: vi.fn(),
  registerSignatureHelpProvider: vi.fn(),
  registerDefinitionProvider: vi.fn(),
  registerRenameProvider: vi.fn(),
  registerReferenceProvider: vi.fn(),
  registerCodeActionsProvider: vi.fn(),
  registerFoldingRangeProvider: vi.fn(),
  registerDocumentSymbolProvider: vi.fn(),
  registerColorProvider: vi.fn(),
  registerElementsTreeFeature: vi.fn(),
  elementsTreeFeatures: [] as Array<{ dispose: () => void }>,
  registerCommand: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  onDidChangeTextEditorSelection: vi.fn(),
  onDidChangeActiveColorTheme: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  savedFileWatchers: [] as Array<{
    change?: (uri: TestDocument["uri"]) => void;
    create?: (uri: TestDocument["uri"]) => void;
    delete?: (uri: TestDocument["uri"]) => void;
  }>,
  activeTabInput: null as unknown,
  TabInputText: class {
    constructor(public readonly uri: unknown) {}
  },
  TabInputWebview: class {
    constructor(public readonly viewType: string) {}
  },
  getConfiguration: vi.fn(),
  onDidChangeConfiguration: vi.fn(),
  asRelativePath: vi.fn()
}));

const observationInstrumentation = vi.hoisted(() => ({
  diagnosticCallSites: [] as string[]
}));

vi.mock("./languageAnalysisSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./languageAnalysisSession")>();
  return {
    ...actual,
    createLanguageAnalysisSession: (sourceText: string) => {
      const session = actual.createLanguageAnalysisSession(sourceText);
      const getDiagnostics = session.getDiagnostics.bind(session);
      session.getDiagnostics = () => {
        observationInstrumentation.diagnosticCallSites.push(new Error().stack ?? "");
        return getDiagnostics();
      };
      return session;
    }
  };
});

const extractModuleHosts = vi.hoisted(() => ({
  hosts: [] as Array<{
    activeCanvasEndpoint: () => unknown;
    navigateCanvasToSourceOffset: (endpoint: unknown, normalizedSourceOffset: number) => unknown;
  }>
}));

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  }
  class WorkspaceEdit {
    readonly replacements: Array<{ uri: unknown; range: unknown; replacement: string }> = [];

    constructor() {
      mocks.workspaceEdits.push(this);
    }

    replace(uri: unknown, range: unknown, replacement: string): void {
      this.replacements.push({ uri, range, replacement });
    }
  }
  class Selection {
    readonly start: MockPosition;
    readonly end: MockPosition;

    constructor(public readonly anchor: MockPosition, public readonly active: MockPosition) {
      const anchorBeforeActive = anchor.line < active.line ||
        (anchor.line === active.line && anchor.character <= active.character);
      this.start = anchorBeforeActive ? anchor : active;
      this.end = anchorBeforeActive ? active : anchor;
    }
  }
  class Diagnostic {
    code?: string | number;
    source?: string;
    relatedInformation?: unknown[];

    constructor(
      public readonly range: unknown,
      public readonly message: string,
      public readonly severity: number
    ) {}
  }
  class Location {
    constructor(public readonly uri: unknown, public readonly range: unknown) {}
  }
  class DiagnosticRelatedInformation {
    constructor(public readonly location: unknown, public readonly message: string) {}
  }
  class CompletionItem {
    detail?: string;
    range?: unknown;
    insertText?: unknown;

    constructor(public readonly label: string, public readonly kind: number) {}
  }
  class ColorPresentation {
    textEdit?: unknown;

    constructor(public readonly label: string) {}
  }
  class TextEdit {
    constructor(public readonly range: unknown, public readonly newText: string) {}

    static replace(range: unknown, newText: string) {
      return new TextEdit(range, newText);
    }
  }
  class SnippetString {
    constructor(public value = "") {}
    appendText(text: string) { this.value += text; return this; }
    appendTabstop(index: number) { this.value += "$" + index; return this; }
    appendChoice(values: readonly string[], index: number) {
      this.value += "${" + index + "|" + values.join(",") + "|}";
      return this;
    }
  }
  class FoldingRange {
    constructor(
      public readonly start: number,
      public readonly end: number,
      public readonly kind?: unknown
    ) {}
  }
  return {
    env: {
      get language() {
        return mocks.displayLanguage;
      }
    },
    window: {
      get activeTextEditor() {
        return mocks.activeTextEditor;
      },
      get visibleTextEditors() {
        return mocks.visibleTextEditors;
      },
      createWebviewPanel: mocks.createWebviewPanel,
      onDidChangeActiveTextEditor: mocks.onDidChangeActiveTextEditor,
      onDidChangeTextEditorSelection: mocks.onDidChangeTextEditorSelection,
      onDidChangeActiveColorTheme: mocks.onDidChangeActiveColorTheme,
      showErrorMessage: mocks.showErrorMessage,
      showWarningMessage: mocks.showWarningMessage,
      showInformationMessage: mocks.showInformationMessage,
      showQuickPick: mocks.showQuickPick,
      showSaveDialog: mocks.showSaveDialog,
      createOutputChannel: mocks.createOutputChannel,
      showTextDocument: mocks.showTextDocument,
      tabGroups: {
        get activeTabGroup() {
          return {
            activeTab: mocks.activeTabInput === null
              ? undefined
              : { input: mocks.activeTabInput }
          };
        },
        onDidChangeTabs: (listener: () => void) => {
          mocks.tabListeners.push(listener);
          return disposable();
        },
        onDidChangeTabGroups: (listener: () => void) => {
          mocks.tabGroupListeners.push(listener);
          return disposable();
        }
      }
    },
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      fs: {
        isWritableFileSystem: () => true,
        readFile: (uri: TestDocument["uri"]) => readFile(uri.fsPath)
      },
      onDidOpenTextDocument: mocks.onDidOpenTextDocument,
      onDidChangeTextDocument: mocks.onDidChangeTextDocument,
      onDidCloseTextDocument: mocks.onDidCloseTextDocument,
      onDidSaveTextDocument: () => disposable(),
      createFileSystemWatcher: () => {
        const listeners: (typeof mocks.savedFileWatchers)[number] = {};
        mocks.savedFileWatchers.push(listeners);
        return {
          onDidChange: (callback: NonNullable<typeof listeners.change>) => { listeners.change = callback; return disposable(); },
          onDidCreate: (callback: NonNullable<typeof listeners.create>) => { listeners.create = callback; return disposable(); },
          onDidDelete: (callback: NonNullable<typeof listeners.delete>) => { listeners.delete = callback; return disposable(); },
          dispose: () => undefined
        };
      },
      openTextDocument: mocks.openTextDocument,
      applyEdit: mocks.applyEdit,
      getConfiguration: mocks.getConfiguration,
      onDidChangeConfiguration: mocks.onDidChangeConfiguration,
      asRelativePath: mocks.asRelativePath
    },
    commands: { registerCommand: mocks.registerCommand, executeCommand: mocks.executeCommand },
    Disposable: {
      from: (...items: Array<{ dispose: () => void }>) => ({
        dispose: () => {
          for (const item of items) item.dispose();
        }
      })
    },
    languages: {
      createDiagnosticCollection: mocks.createDiagnosticCollection,
      registerCompletionItemProvider: mocks.registerCompletionItemProvider,
      registerSignatureHelpProvider: mocks.registerSignatureHelpProvider,
      registerDefinitionProvider: mocks.registerDefinitionProvider,
      registerRenameProvider: mocks.registerRenameProvider,
      registerReferenceProvider: mocks.registerReferenceProvider,
      registerCodeActionsProvider: mocks.registerCodeActionsProvider,
      registerFoldingRangeProvider: mocks.registerFoldingRangeProvider,
      registerDocumentSymbolProvider: mocks.registerDocumentSymbolProvider,
      registerColorProvider: mocks.registerColorProvider
    },
    Uri: {
      joinPath: vi.fn((...parts: unknown[]) => parts.join("/")),
      file: vi.fn((fsPath: string) => ({ scheme: "file", fsPath, toString: () => `file://${fsPath}` })),
      parse: vi.fn((value: string) => ({
        scheme: value.split(":", 1)[0] ?? "",
        fsPath: value.replace(/^file:\/\//, ""),
        toString: () => value
      }))
    },
    ViewColumn: { Beside: 2 },
    FileSystemError: class extends Error {},
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    SymbolKind: {
      Module: 1,
      Object: 2,
      Namespace: 3,
      Constant: 4,
      Variable: 5,
      Enum: 6,
      Struct: 7,
      Property: 8,
      Field: 9,
      String: 10,
      File: 11
    },
    CompletionItemKind: {
      Keyword: 1,
      Function: 2,
      Property: 3,
      Variable: 4,
      Reference: 5,
      Module: 6,
      Value: 7,
      Operator: 8
    },
    CodeActionKind: {
      QuickFix: "quickfix",
      RefactorExtract: "refactor.extract",
      RefactorInline: "refactor.inline",
      RefactorRewrite: "refactor.rewrite"
    },
    FoldingRangeKind: { Comment: "comment" },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    TextDocumentChangeReason: { Undo: 1, Redo: 2 },
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2 },
    TabInputText: mocks.TabInputText,
    TabInputWebview: mocks.TabInputWebview,
    Position,
    Range,
    WorkspaceEdit,
    Selection,
    TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
    Diagnostic,
    Location,
    DiagnosticRelatedInformation,
    CompletionItem,
    ColorPresentation,
    TextEdit,
    SnippetString,
    FoldingRange
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

vi.mock("./rustEvaluationProcess", () => ({
  RustEvaluationProcess: class {
    readonly request = vi.fn(async (input: EvaluateDocumentInput) => mocks.evaluateRust?.(input) ?? { input });
    readonly exportOutput = vi.fn(async () => ({ exported: true }));
    readonly dispose = vi.fn();

    constructor() {
      mocks.rustProcesses.push(this);
    }
  }
}));

vi.mock("./multiDocumentHost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./multiDocumentHost")>();
  return {
    ...actual,
    activeVscodeMultiDocumentHost: () => mocks.multiDocumentHost ?? actual.activeVscodeMultiDocumentHost(),
    canonicalVscodeDocumentId: (uri: { toString: () => string }) => uri.toString()
  };
});

vi.mock("./elementsTreeFeature", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./elementsTreeFeature")>();
  return {
    ...actual,
    registerNuiElementsTreeFeature: (
      ...args: Parameters<typeof actual.registerNuiElementsTreeFeature>
    ) => {
      mocks.registerElementsTreeFeature(...args);
      const feature = actual.registerNuiElementsTreeFeature(...args);
      mocks.elementsTreeFeatures.push(feature);
      return feature;
    }
  };
});

vi.mock("./extractModuleCommandFeature", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./extractModuleCommandFeature")>();
  return {
    ...actual,
    registerVscodeExtractModuleCommandFeature: (
      host: Parameters<typeof actual.registerVscodeExtractModuleCommandFeature>[0]
    ) => {
      extractModuleHosts.hosts.push({
        activeCanvasEndpoint: host.activeCanvasEndpoint,
        navigateCanvasToSourceOffset: host.navigateCanvasToSourceOffset
      });
      return actual.registerVscodeExtractModuleCommandFeature(host);
    }
  };
});

import { activate, registerModulePreviewBakeFallback, registerModulePreviewHistoryFallback } from "./extension";

const disposable = () => ({ dispose: vi.fn() });

const documentFor = (
  fileName = "/tmp/pattern.nui",
  uri = `file://${fileName}`,
  initialSource = "nui 1\n"
): TestDocument => {
  let sourceText = initialSource;
  const lineStartsFor = (): number[] => {
    const starts = [0];
    for (let index = 0; index < sourceText.length; index += 1) {
      if (sourceText[index] === "\n") starts.push(index + 1);
    }
    return starts;
  };
  const lineBoundsFor = (line: number): { line: number; start: number; end: number } => {
    const starts = lineStartsFor();
    const boundedLine = Math.min(Math.max(line, 0), starts.length - 1);
    const start = starts[boundedLine]!;
    let end = boundedLine + 1 < starts.length ? starts[boundedLine + 1]! : sourceText.length;
    if (sourceText[end - 1] === "\n") end -= 1;
    if (sourceText[end - 1] === "\r") end -= 1;
    return { line: boundedLine, start, end };
  };
  const document: TestDocument = {
    fileName,
    version: 1,
    get lineCount() { return lineStartsFor().length; },
    uri: { scheme: uri.startsWith("file:") ? "file" : "untitled", fsPath: fileName, toString: () => uri },
    isDirty: false,
    getText: () => {
      document.onGetText?.();
      return sourceText;
    },
    offsetAt: (position) => {
      const bounds = lineBoundsFor(position.line);
      const character = Math.min(Math.max(position.character, 0), bounds.end - bounds.start);
      return bounds.start + character;
    },
    positionAt: (offset) => {
      const starts = lineStartsFor();
      const clampedOffset = Math.min(Math.max(offset, 0), sourceText.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clampedOffset) line += 1;
      return { line, character: clampedOffset - starts[line]! };
    },
    lineAt: (line) => {
      const bounds = lineBoundsFor(line);
      return {
        text: sourceText.slice(bounds.start, bounds.end),
        range: {
          start: { line: bounds.line, character: 0 },
          end: { line: bounds.line, character: bounds.end - bounds.start }
        }
      };
    },
    setSourceText: (nextText) => { sourceText = nextText; }
  };
  return document;
};

const issue1654ImageDefinition = [
  "image Ref = image(",
  '  source: "./reference.png",',
  "  origin: (0, 0),",
  "  naturalWidthPx: 600,",
  "  naturalHeightPx: 400,",
  "  sourceDpi: 150,",
  "  targetPixelsPerMm: 5.905511811,",
  "  scale: 1,",
  ")"
].join("\n");
const issue1654ProbeSource = [
  "nui 1",
  "export module Probe(x: number) {",
  "  point marker = coordinate(x: x, y: 0)",
  "}"
].join("\n");
const issue1654CaseCSource = [
  "nui 1",
  'import "./probe.nui" as probe',
  issue1654ImageDefinition,
  "instance N = probe::Probe(x: 20)"
].join("\n");
const issue1654CaseC2Source = issue1654CaseCSource.replace(
  "instance N = probe::Probe(x: 20)",
  "// instance N = probe::Probe(x: 20)"
);

const issue1654GraphSnapshotFor = async (
  document: TestDocument,
  sourceText = document.getText(),
  documentVersion = document.version,
  graphRevision = 41,
  dependencySource = issue1654ProbeSource
) => {
  const root: RootCurrentSourceSnapshot = {
    kind: "root-current",
    documentId: documentIdFromHost(document.uri.toString()),
    normalizedSource: sourceText,
    sourceRevision: documentVersion
  };
  const dependency: DependencySavedSourceSnapshot = {
    kind: "dependency-saved",
    documentId: documentIdFromHost("file:///tmp/probe.nui"),
    savedSourceFingerprint: savedSourceFingerprintFromHost(`saved:${dependencySource}`),
    normalizedSource: dependencySource
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: {
      loadSavedDependency: async (importerDocumentId, importPath) =>
        importerDocumentId === root.documentId && importPath === "./probe.nui"
          ? { status: "loaded", snapshot: dependency }
          : { status: "failed", reason: "missing" }
    },
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const moduleRuntimeContext = createModuleRuntimeContext(graph, analysis);
  const rootNode = graph.nodes.get(root.documentId);
  if (!rootNode) throw new Error("missing #1654 imported graph root");
  const compiled = compileDslDocument(sourceText, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext
  });
  if (!graph.valid || !analysis.valid || !moduleRuntimeContext.valid || compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("invalid #1654 imported Module graph snapshot");
  }
  return {
    documentVersion,
    sourceDocumentUri: document.uri.toString(),
    rootDocumentId: String(root.documentId),
    graphRevision,
    sourceRevision: root.sourceRevision,
    sourceText,
    compiled
  };
};

const h3Source = [
  "nui 1",
  "point Left = coordinate(x: -50, y: 0)",
  "point Right = coordinate(x: 50, y: 0)",
  "line Guide = segment(start: Left, end: Right)"
].join("\n");

const editorFor = (document = documentFor()): TestEditor => {
  const editBuilder = { replace: vi.fn(), insert: vi.fn() };
  const editor = {
    document,
    selection: {
      anchor: { line: 1, character: 0 },
      active: { line: 1, character: 0 },
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 }
    },
    selections: [],
    editBuilder,
    revealRange: vi.fn(),
    edit: vi.fn(async (callback: (builder: typeof editBuilder) => void) => {
      callback(editBuilder);
      return true;
    })
  } as TestEditor;
  return editor;
};

const contextFor = () => ({
  extensionUri: "extension",
  extensionPath: "/tmp/extension",
  subscriptions: [] as Array<{ dispose: () => void }>,
  globalState: {
    get: (key: string) => mocks.globalStateValues[key],
    update: async (key: string, value: unknown) => {
      mocks.globalStateUpdates.push({ key, value });
      mocks.globalStateValues[key] = value;
    }
  }
});

const panelFor = (): TestPanel => {
  const panel = {
    title: "",
    active: true,
    visible: true,
    webview: {
      cspSource: "csp",
      html: "",
      options: { enableScripts: true },
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn()
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(),
    onDidChangeViewState: vi.fn()
  } as TestPanel;
  panel.webview.onDidReceiveMessage.mockImplementation((handler: (message: unknown) => Promise<void>) => {
    (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler = handler;
    return disposable();
  });
  panel.onDidDispose.mockImplementation((handler: () => void) => {
    (panel as TestPanel & { disposeHandler: () => void }).disposeHandler = handler;
    panel.dispose.mockImplementation(() => (panel as TestPanel & { disposeHandler: () => void }).disposeHandler?.());
    return disposable();
  });
  panel.onDidChangeViewState.mockImplementation((handler: () => void) => {
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler = handler;
    return disposable();
  });
  mocks.panels.push(panel);
  return panel;
};

const messageHandlerFor = (panel: TestPanel) =>
  (panel as TestPanel & { messageHandler: (message: unknown) => Promise<void> }).messageHandler;

const emitPanelViewState = (panel: TestPanel): void =>
  (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

const commandHandlerFor = (command: string): ((...args: unknown[]) => unknown) | undefined => {
  const handler = mocks.commandHandlers.get(command);
  return handler;
};

type CoordinatePointCreationStartMessage = { requestId: number; documentVersion: number };

const coordinatePointCreationStartFor = async (panel: TestPanel): Promise<CoordinatePointCreationStartMessage> => {
  await commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
  const start = panel.webview.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === "canvasCoordinatePointCreationStart")
    .at(-1) as CoordinatePointCreationStartMessage | undefined;
  if (!start) throw new Error("missing Host coordinate-point creation start request");
  return start;
};

const acceptCoordinatePointCreationStart = async (
  panel: TestPanel,
  start: CoordinatePointCreationStartMessage
): Promise<void> => {
  const handler = messageHandlerFor(panel);
  await handler({
    type: "canvasCoordinatePointCreationState",
    active: true,
    modeRunId: start.requestId,
    documentVersion: start.documentVersion
  });
  await handler({
    type: "canvasCoordinatePointCreationStartResult",
    requestId: start.requestId,
    documentVersion: start.documentVersion,
    status: "started"
  });
};

const finishCoordinatePointCreationRun = async (
  panel: TestPanel,
  modeRunId: number,
  documentVersion: number
): Promise<void> => messageHandlerFor(panel)({
  type: "canvasCoordinatePointCreationState",
  active: false,
  modeRunId,
  documentVersion
});

const coordinatePointCreationClick = async (
  panel: TestPanel,
  documentVersion: number,
  pointer: { x: number; y: number }
): Promise<number> => {
  const handler = messageHandlerFor(panel);
  const start = await coordinatePointCreationStartFor(panel);
  await acceptCoordinatePointCreationStart(panel, start);
  await handler({ type: "canvasCoordinatePointCreationClick", modeRunId: start.requestId, documentVersion, pointer });
  return start.requestId;
};

const coordinatePointCreationClickOnly = async (
  panel: TestPanel,
  documentVersion: number,
  pointer: { x: number; y: number },
  modeRunId: number
): Promise<void> => {
  await messageHandlerFor(panel)({ type: "canvasCoordinatePointCreationClick", modeRunId, documentVersion, pointer });
};

const extractModuleHostFor = () => {
  const host = extractModuleHosts.hosts.at(-1);
  if (!host) throw new Error("missing Extract Module host");
  return host;
};

const setup = (
  benchmark = false,
  activeEditor: TestEditor | null = editorFor(),
  openDocuments?: TestDocument[],
  webviewEditableFocusContext?: WebviewEditableFocusContext,
  startHost?: () => void
) => {
  if (benchmark) process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG = JSON.stringify({ runId: "run-1", resultPath: "/tmp/result.json" });
  else delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  mocks.activeTextEditor = activeEditor;
  mocks.visibleTextEditors = activeEditor ? [activeEditor] : [];
  mocks.textDocuments = openDocuments ?? (activeEditor ? [activeEditor.document] : []);
  mocks.activeTabInput = activeEditor ? new mocks.TabInputText(activeEditor.document.uri) : null;
  const context = contextFor();
  mocks.contexts.push(context);
  mocks.registerCommand.mockImplementation((name: string, handler: (...args: unknown[]) => unknown) => {
    mocks.commandHandlers.set(name, handler);
    return disposable();
  });
  mocks.createWebviewPanel.mockImplementation(() => panelFor());
  mocks.createOutputChannel.mockImplementation(() => ({
    clear: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn()
  }));
  mocks.onDidChangeActiveTextEditor.mockImplementation((listener: (editor?: TestEditor) => void) => {
    mocks.activeEditorListeners.push(listener);
    return disposable();
  });
  mocks.onDidChangeTextEditorSelection.mockImplementation(
    (listener: (event: { textEditor: TestEditor; kind?: number }) => void) => {
      mocks.selectionChangeListeners.push(listener);
      return disposable();
    }
  );
  mocks.onDidChangeActiveColorTheme.mockImplementation((listener: () => void) => {
    mocks.activeColorThemeListeners.push(listener);
    return disposable();
  });
  mocks.createDiagnosticCollection.mockImplementation((name: string) => {
    const collection: TestDiagnosticCollection = {
      name,
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn()
    };
    mocks.diagnosticCollections.push(collection);
    return collection;
  });
  mocks.registerCompletionItemProvider.mockImplementation((selector: unknown, provider: unknown, ...triggerCharacters: string[]) => {
    const registration = disposable();
    mocks.completionRegistrations.push({ selector, provider, triggerCharacters, disposable: registration });
    return registration;
  });
  mocks.registerSignatureHelpProvider.mockImplementation((selector: unknown, provider: unknown, ...triggerCharacters: string[]) => {
    const registration = disposable();
    mocks.signatureHelpRegistrations.push({ selector, provider, triggerCharacters, disposable: registration });
    return registration;
  });
  mocks.registerDefinitionProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.definitionRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.registerRenameProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.renameRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.registerReferenceProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.referenceRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.registerCodeActionsProvider.mockImplementation((
    selector: unknown,
    provider: unknown,
    options: { providedCodeActionKinds: unknown[] }
  ) => {
    const registration = disposable();
    mocks.codeActionRegistrations.push({
      selector,
      provider,
      providedCodeActionKinds: options.providedCodeActionKinds,
      disposable: registration
    });
    return registration;
  });
  mocks.registerFoldingRangeProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.foldingRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.registerDocumentSymbolProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.documentSymbolRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.registerColorProvider.mockImplementation((selector: unknown, provider: unknown) => {
    const registration = disposable();
    mocks.colorRegistrations.push({ selector, provider, disposable: registration });
    return registration;
  });
  mocks.onDidOpenTextDocument.mockImplementation((listener: (document: TestDocument) => void) => {
    mocks.documentOpenListeners.push(listener);
    return disposable();
  });
  mocks.onDidChangeTextDocument.mockImplementation((listener: (event: TestDocumentChangeEvent) => void) => {
    mocks.documentChangeListeners.push(listener);
    return disposable();
  });
  mocks.onDidCloseTextDocument.mockImplementation((listener: (document: TestDocument) => void) => {
    mocks.documentCloseListeners.push(listener);
    return disposable();
  });
  if (mocks.multiDocumentHost) {
    mocks.multiDocumentHost.onDiagnosticsChanged.mockImplementation((listener: (documentUri: string) => void) => {
      mocks.multiDocumentDiagnosticsListeners.push(listener);
      return disposable();
    });
  }
  mocks.getConfiguration.mockImplementation((section?: string, scope?: unknown) => {
    mocks.configurationScopes.push({ section, scope });
    return {
      get: <T>(key: string, defaultValue?: T) => {
        const fullKey = section ? `${section}.${key}` : key;
        if (fullKey === CANVAS_GRID_ENABLED_SETTING) return mocks.canvasGridSettings.enabled as T;
        if (fullKey === CANVAS_GRID_SPACING_SETTING) return mocks.canvasGridSettings.spacingMm as T;
        if (fullKey === CANVAS_GRID_MAJOR_EVERY_SETTING) return mocks.canvasGridSettings.majorEvery as T;
        if (fullKey === CANVAS_GRID_SNAP_ENABLED_SETTING) return mocks.canvasGridSettings.snapEnabled as T;
        return Object.hasOwn(mocks.bakeSettings, fullKey)
          ? mocks.bakeSettings[fullKey] as T
          : defaultValue as T;
      },
      inspect: (key: string) => [
        CANVAS_GRID_ENABLED_SETTING,
        CANVAS_GRID_SPACING_SETTING,
        CANVAS_GRID_MAJOR_EVERY_SETTING,
        CANVAS_GRID_SNAP_ENABLED_SETTING
      ].includes(key as typeof CANVAS_GRID_ENABLED_SETTING)
        ? { ...mocks.canvasGridConfigurationInspection }
        : undefined,
      update: (key: string, value: unknown, target: unknown) => {
        mocks.configurationUpdates.push({ section: key, value, target });
        if (key === CANVAS_GRID_ENABLED_SETTING) mocks.canvasGridSettings.enabled = value;
        if (key === CANVAS_GRID_SPACING_SETTING) mocks.canvasGridSettings.spacingMm = value;
        if (key === CANVAS_GRID_MAJOR_EVERY_SETTING) mocks.canvasGridSettings.majorEvery = value;
        if (key === CANVAS_GRID_SNAP_ENABLED_SETTING) mocks.canvasGridSettings.snapEnabled = value;
        if ([
          CANVAS_GRID_ENABLED_SETTING,
          CANVAS_GRID_SPACING_SETTING,
          CANVAS_GRID_MAJOR_EVERY_SETTING,
          CANVAS_GRID_SNAP_ENABLED_SETTING
        ].includes(key as typeof CANVAS_GRID_ENABLED_SETTING)) {
          if (target === 1) mocks.canvasGridConfigurationInspection.globalValue = value;
          if (target === 2) mocks.canvasGridConfigurationInspection.workspaceValue = value;
        }
        return Promise.resolve();
      }
    };
  });
  mocks.onDidChangeConfiguration.mockImplementation((listener: (event: { affectsConfiguration: (section: string) => boolean }) => void) => {
    mocks.configurationChangeListeners.push(listener);
    return disposable();
  });
  startHost?.();
  activate(context as unknown as Parameters<typeof activate>[0], webviewEditableFocusContext);
  return context;
};

const emitDocumentChange = (
  document: TestDocument,
  reason?: number,
  contentChanges: readonly unknown[] = [{}]
): void => {
  for (const listener of mocks.documentChangeListeners) listener({ document, reason, contentChanges });
};

const emitDocumentOpen = (document: TestDocument): void => {
  for (const listener of mocks.documentOpenListeners) listener(document);
};

const emitDocumentClose = (document: TestDocument): void => {
  for (const listener of mocks.documentCloseListeners) listener(document);
};

const emitActiveEditorChange = (editor?: TestEditor): void => {
  for (const listener of mocks.activeEditorListeners) listener(editor);
};

const emitTabsChange = (): void => {
  for (const listener of mocks.tabListeners) listener();
};

const emitTabGroupsChange = (): void => {
  for (const listener of mocks.tabGroupListeners) listener();
};

const openPanelFor = (editor = mocks.activeTextEditor!): TestPanel => {
  mocks.activeTextEditor = editor;
  mocks.visibleTextEditors = [editor];
  mocks.textDocuments = [editor.document];
  mocks.activeTabInput = new mocks.TabInputText(editor.document.uri);
  commandHandlerFor("nuinuiCAD.openCanvas")?.();
  mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
  return mocks.panels.at(-1)!;
};

const openOutputPreviewPanelFor = (editor = mocks.activeTextEditor!): TestPanel => {
  mocks.activeTextEditor = editor;
  mocks.visibleTextEditors = [editor];
  mocks.textDocuments = [editor.document];
  mocks.activeTabInput = new mocks.TabInputText(editor.document.uri);
  commandHandlerFor("nuinuiCAD.openOutputPreview")?.();
  mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.outputPreview");
  return mocks.panels.at(-1)!;
};

const runtimeDiagnosticFor = (
  code = "runtime-test",
  options: { exactSpan?: boolean } = {}
) => ({
  severity: "error" as const,
  line: 2,
  column: 7,
  code,
  message: `runtime ${code}`,
  exactSpanOnly: true as const,
  ...(options.exactSpan === false ? {} : {
    physicalSpan: {
      segments: [{ from: 12, to: 13 }],
      sourceRevision: 1
    }
  }),
  origin: "runtime" as const,
  bindingId: `binding:${code}`,
  navigationTarget: { kind: "binding" as const, bindingId: `binding:${code}` }
});

const canvasObservationSnapshotFor = (
  documentVersion: number
): VscodeCanvasObservationSnapshot => ({
  documentVersion,
  selectedElementIds: ["point-a"],
  canvasCanSelectInstance: false,
  selectionSubject: { kind: "elements" },
  compiledDocumentRevision: 8,
  previewActive: false,
  evaluationRevision: 8,
  evaluationRequestRevision: 13,
  evaluationStatus: "ready",
  evaluationSource: "rust",
  rustEligible: true,
  isStale: false,
  isCurrent: true,
  errorCount: 0,
  warningCount: 0,
  errorSummaries: [],
  warningSummaries: []
});

const publishCanvasObservation = (
  panel: TestPanel,
  snapshot: VscodeCanvasObservationSnapshot
): Promise<void> => messageHandlerFor(panel)({
  type: "canvasObservationPublication",
  snapshot
});

const publishCanvasTheme = (
  panel: TestPanel,
  documentVersion: number,
  themeOrBackground: typeof LEGACY_CANVAS_THEME | string = LEGACY_CANVAS_THEME,
  generation = 0
): Promise<void> => messageHandlerFor(panel)({
  type: "canvasThemePublication",
  documentVersion,
  generation,
  theme: typeof themeOrBackground === "string"
    ? { ...LEGACY_CANVAS_THEME, background: themeOrBackground }
    : themeOrBackground
});

const latestContextValueFor = (key: string): boolean | undefined => {
  const calls = mocks.executeCommand.mock.calls.filter(([command, candidate]) =>
    command === "setContext" && candidate === key
  );
  return calls.at(-1)?.[2] as boolean | undefined;
};

const elementIdFor = (document: TestDocument, name: string): string => {
  const registrationHost = mocks.registerElementsTreeFeature.mock.calls[0]?.[0] as {
    languageAnalysisSessionFor?: (document: TestDocument) => {
      getSource: () => string;
      getSourceRevision: () => number;
      runtimeEvaluationSnapshot: () =>
        { compiled: { document: { elements: Array<{ name?: string; id: string }> } } } | undefined;
    };
  } | undefined;
  const session = registrationHost?.languageAnalysisSessionFor?.(document);
  if (!session) throw new Error("missing language analysis session");
  const semantic = session.runtimeEvaluationSnapshot();
  const element = semantic?.compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing compiled element ${name}`);
  return element.id;
};

afterEach(() => {
  delete process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  delete process.env.NUINUICAD_VSCODE_CANVAS_OPEN_CAPTURE_CONFIG;
  mocks.activeTextEditor = null;
  mocks.displayLanguage = "en";
  mocks.activeTabInput = null;
  mocks.visibleTextEditors.length = 0;
  mocks.textDocuments.length = 0;
  mocks.commandHandlers.clear();
  mocks.activeEditorListeners.length = 0;
  mocks.tabListeners.length = 0;
  mocks.tabGroupListeners.length = 0;
  mocks.selectionChangeListeners.length = 0;
  mocks.activeColorThemeListeners.length = 0;
  mocks.documentOpenListeners.length = 0;
  mocks.documentChangeListeners.length = 0;
  mocks.documentCloseListeners.length = 0;
  mocks.savedFileWatchers.length = 0;
  mocks.globalStateValues = {};
  mocks.globalStateUpdates.length = 0;
  mocks.canvasGridSettings = {};
  mocks.canvasGridConfigurationInspection = {};
  mocks.configurationUpdates.length = 0;
  mocks.configurationScopes.length = 0;
  mocks.configurationChangeListeners.length = 0;
  mocks.panels.length = 0;
  mocks.rustProcesses.length = 0;
  mocks.evaluateRust = undefined;
  mocks.diagnosticCollections.length = 0;
  mocks.multiDocumentHost = null;
  mocks.multiDocumentDiagnosticsListeners.length = 0;
  mocks.contexts.length = 0;
  mocks.completionRegistrations.length = 0;
  mocks.signatureHelpRegistrations.length = 0;
  mocks.definitionRegistrations.length = 0;
  mocks.renameRegistrations.length = 0;
  mocks.referenceRegistrations.length = 0;
  mocks.codeActionRegistrations.length = 0;
  mocks.foldingRegistrations.length = 0;
  mocks.documentSymbolRegistrations.length = 0;
  mocks.colorRegistrations.length = 0;
  mocks.elementsTreeFeatures.length = 0;
  mocks.showErrorMessage.mockReset();
  mocks.showWarningMessage.mockReset();
  mocks.showInformationMessage.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.showSaveDialog.mockReset();
  mocks.createOutputChannel.mockReset();
  mocks.bakeSettings = {};
  mocks.showTextDocument.mockReset();
  mocks.openTextDocument.mockReset();
  mocks.applyEdit.mockReset();
  mocks.workspaceEdits.length = 0;
  mocks.executeCommand.mockReset();
  mocks.createWebviewPanel.mockReset();
  mocks.createDiagnosticCollection.mockReset();
  mocks.registerCompletionItemProvider.mockReset();
  mocks.registerSignatureHelpProvider.mockReset();
  mocks.registerDefinitionProvider.mockReset();
  mocks.registerRenameProvider.mockReset();
  mocks.registerReferenceProvider.mockReset();
  mocks.registerCodeActionsProvider.mockReset();
  mocks.registerFoldingRangeProvider.mockReset();
  mocks.registerDocumentSymbolProvider.mockReset();
  mocks.registerColorProvider.mockReset();
  mocks.registerElementsTreeFeature.mockReset();
  mocks.registerCommand.mockReset();
  mocks.onDidChangeActiveTextEditor.mockReset();
  mocks.onDidChangeTextEditorSelection.mockReset();
  mocks.onDidChangeActiveColorTheme.mockReset();
  mocks.onDidOpenTextDocument.mockReset();
  mocks.onDidChangeTextDocument.mockReset();
  mocks.onDidCloseTextDocument.mockReset();
  mocks.getConfiguration.mockReset();
  mocks.onDidChangeConfiguration.mockReset();
  mocks.asRelativePath.mockReset();
  extractModuleHosts.hosts.length = 0;
  observationInstrumentation.diagnosticCallSites.length = 0;
});

describe("VS Code production document lifecycle", () => {
  it("sends Canvas-open config before the source snapshot and ignores foreign frame acknowledgements", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nuinui-canvas-open-extension-test-"));
    const document = documentFor("/tmp/canvas-open.nui", "file:///tmp/canvas-open.nui", "nui 1\npoint A = coordinate(x: 0, y: 0)");
    const config = {
      schemaVersion: 2,
      runId: "run-1",
      resultPath: join(directory, "result.json"),
      statusPath: join(directory, "status.json"),
      mode: "cold",
      warmupCount: 0,
      measuredSampleCount: 1,
      panelTimeoutMs: 60_000,
      hostTimeoutMs: 120_000,
      fixture: {
        id: "single-root",
        hash: `sha256:${"a".repeat(64)}`,
        rootSourceSha256: "b".repeat(64),
        kind: "single-root",
        expectedDependencyCount: 0,
        minimumRuntimeElementCount: 1,
        minimumComputedGeometryCount: 1,
        minimumDrawablePrimitiveCount: 1
      }
    };
    process.env.NUINUICAD_VSCODE_CANVAS_OPEN_CAPTURE_CONFIG = JSON.stringify(config);
    let panel: TestPanel | undefined;
    try {
      setup(false, editorFor(document), [document]);
      panel = mocks.panels[0];
      expect(panel).toBeDefined();
      if (!panel) throw new Error("Canvas-open panel did not start");
      await messageHandlerFor(panel)({ type: "webviewReady" });
      const postedMessages = panel.webview.postMessage.mock.calls.map(([message]) => message as { type?: string });
      const configIndex = postedMessages.findIndex((message) => message.type === "canvasOpenCaptureConfig");
      const sourceIndex = postedMessages.findIndex((message) => message.type === "replaceTextDocument");
      expect(configIndex).toBeGreaterThanOrEqual(0);
      expect(sourceIndex).toBeGreaterThan(configIndex);

      await messageHandlerFor(panel)({
        type: "canvasOpenFrameAcknowledgement",
        acknowledgement: {
          runId: "foreign-run",
          openId: "foreign-open",
          documentToken: "foreign-document",
          mode: "cold",
          phase: "measured",
          sampleIndex: 0,
          documentVersion: 1,
          sourceRevision: 1,
          graphRevision: 1,
          rustEvaluationRequestId: 1,
          evaluationRequestRevision: 1,
          runtimeElementCount: 1,
          computedGeometryCount: 1,
          drawablePrimitiveCount: 1,
          webviewElapsedMs: 1,
          webviewUserAgent: "test",
          renderSurface: { cssWidthPx: 1, cssHeightPx: 1, backingWidthPx: 1, backingHeightPx: 1, devicePixelRatio: 1 },
          phaseEvidence: { clockOrigin: "webview", events: [] }
        }
      });
      expect(mocks.executeCommand.mock.calls.some(([command]) => command === "workbench.action.quit")).toBe(false);
    } finally {
      panel?.dispose();
      delete process.env.NUINUICAD_VSCODE_CANVAS_OPEN_CAPTURE_CONFIG;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("registers and subscribes the Elements Tree lifecycle feature once", () => {
    const context = setup();

    expect(mocks.registerElementsTreeFeature).toHaveBeenCalledTimes(1);
    expect(context.subscriptions).toContain(mocks.elementsTreeFeatures[0]);
  });

  it("registers the standard file-backed nui Signature Help provider", () => {
    setup();

    expect(mocks.signatureHelpRegistrations).toHaveLength(1);
    expect(mocks.signatureHelpRegistrations[0]).toMatchObject({
      selector: { language: "nui", scheme: "file" },
      triggerCharacters: ["(", ",", ":"]
    });
  });

  it("publishes Module diagnostic related information through the current document URI", () => {
    const source = [
      "nui 1",
      "module M(required: number) {",
      "}",
      "instance Use = M()"
    ].join("\n");
    const document = documentFor("/tmp/related.nui", "file:///tmp/related.nui", source);
    setup(false, editorFor(document), [document]);

    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      relatedInformation?: Array<{
        message: string;
        location: { uri: unknown; range: { start: MockPosition; end: MockPosition } };
      }>;
    }>;
    const missing = published.find((item) => item.code === "module-missing-argument");

    expect(missing).toBeDefined();
    expect(missing?.relatedInformation).toHaveLength(1);
    expect(missing?.relatedInformation?.[0]).toMatchObject({
      location: {
        uri: document.uri,
        range: {
          start: { line: 1, character: 9 },
          end: { line: 1, character: 17 }
        }
      }
    });
    expect(missing?.relatedInformation?.[0]?.message).toEqual(expect.any(String));
  });

  it("aggregates exact-current runtime diagnostics after compiler diagnostics", async () => {
    const source = "nui 1\npoint A = offset(from: missing, dx: 1, dy: 2)\n";
    const document = documentFor("/tmp/runtime-diagnostics.nui", "file:///tmp/runtime-diagnostics.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const collection = mocks.diagnosticCollections[0]!;
    const compilerPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    expect(compilerPublished.length).toBeGreaterThan(0);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    collection.set.mockClear();

    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-current")]
    });

    const published = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    expect(published.slice(0, compilerPublished.length).map(({ code, message }) => ({ code, message }))).toEqual(
      compilerPublished.map(({ code, message }) => ({ code, message }))
    );
    expect(published.at(-1)?.code).toBe("runtime-current");
  });

  it("ignores stale and non-current-session runtime diagnostic publications", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-stale.nui", "file:///tmp/runtime-stale.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await handler({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-current")]
    });
    const collection = mocks.diagnosticCollections[0]!;
    collection.set.mockClear();

    await handler({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version - 1,
      diagnostics: [runtimeDiagnosticFor("runtime-stale")]
    });
    expect(collection.set).not.toHaveBeenCalled();

    panel.dispose();
    await handler({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-after-dispose")]
    });
    expect(collection.set).not.toHaveBeenCalled();
  });

  it("clears runtime diagnostics synchronously on source change", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-change.nui", "file:///tmp/runtime-change.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-before-change")]
    });

    document.setSourceText("nui 1\nconst y: number = 2\n");
    document.version += 1;
    emitDocumentChange(document);

    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(published.map((item) => item.code)).not.toContain("runtime-before-change");
  });

  it("treats a current empty runtime publication as clearing only the runtime layer", async () => {
    const source = "nui 1\npoint A = offset(from: missing, dx: 1, dy: 2)\n";
    const document = documentFor("/tmp/runtime-empty.nui", "file:///tmp/runtime-empty.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const collection = mocks.diagnosticCollections[0]!;
    const compilerPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-to-clear")]
    });

    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: []
    });

    const published = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;
    expect(published.map(({ code, message }) => ({ code, message }))).toEqual(
      compilerPublished.map(({ code, message }) => ({ code, message }))
    );
  });

  it("retains runtime diagnostics across Canvas close but clears them on document close", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-close.nui", "file:///tmp/runtime-close.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-retained")]
    });
    const collection = mocks.diagnosticCollections[0]!;

    panel.dispose();
    collection.set.mockClear();
    emitDocumentChange(document, undefined, []);
    const retained = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(retained.map((item) => item.code)).toContain("runtime-retained");

    emitDocumentClose(document);
    const reopened = documentFor("/tmp/runtime-close.nui", "file:///tmp/runtime-close.nui", source);
    mocks.textDocuments = [reopened];
    emitDocumentOpen(reopened);
    const reopenedPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(reopenedPublished.map((item) => item.code)).not.toContain("runtime-retained");
  });

  it("preserves exactSpanOnly fail-closed projection for runtime diagnostics", async () => {
    const source = "nui 1\nconst x: number = 1\n";
    const document = documentFor("/tmp/runtime-span.nui", "file:///tmp/runtime-span.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });

    await messageHandlerFor(panel)({
      type: "runtimeDiagnosticsPublication",
      documentVersion: document.version,
      diagnostics: [runtimeDiagnosticFor("runtime-no-span", { exactSpan: false })]
    });

    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;
    expect(published.map((item) => item.code)).not.toContain("runtime-no-span");
  });

  it("invalidates the exact-current Canvas runtime through the root source-change path", async () => {
    const document = documentFor("/tmp/observation-change.nui", "file:///tmp/observation-change.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas).not.toBeNull();

    document.version += 1;
    emitDocumentChange(document);

    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("does not revive a selected Canvas point through current-version publications after invalid Source edits", async () => {
    const validSource = "nui 1\npoint A = coordinate(x: 5, y: 0)\n";
    const invalidSource = "nui 1\npoint A = coordinate(x: , y: 0)\n";
    const document = documentFor(
      "/tmp/observation-stale-selection.nui",
      "file:///tmp/observation-stale-selection.nui",
      validSource
    );
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    vi.doMock("../../src/vscode/VSCodeDrawingCanvas", () => ({
      VSCodeDrawingCanvas: () => null
    }));
    vi.doMock("../../src/geometry/useEvaluationEngine", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/geometry/useEvaluationEngine")>();
      return {
        ...actual,
        evaluationStateIsCurrentFor: () => true,
        useEvaluationEngine: () => ({
          evaluation: { computedGeometry: new Map(), errors: [], warnings: [] }
        })
      };
    });
    const { VSCodeApp } = await import("../../src/vscode/VSCodeApp");
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    const webviewMessages: Promise<void>[] = [];
    const queuedHostMessages: unknown[] = [];
    let webviewMounted = false;
    const handler = messageHandlerFor(panel);
    const api: VscodeWebviewApi = {
      postMessage: (message) => {
        webviewMessages.push(handler(message));
      }
    };
    panel.webview.postMessage.mockImplementation((message: unknown) => {
      if (webviewMounted) window.dispatchEvent(new MessageEvent("message", { data: message }));
      else queuedHostMessages.push(message);
      return Promise.resolve(true);
    });
    const flushWebviewMessages = async () => {
      while (webviewMessages.length > 0) {
        await Promise.all(webviewMessages.splice(0));
      }
    };
    render(createElement(VSCodeApp, { api }));
    webviewMounted = true;
    await act(async () => {
      while (queuedHostMessages.length > 0) {
        for (const message of queuedHostMessages.splice(0)) {
          window.dispatchEvent(new MessageEvent("message", { data: message }));
        }
        await flushWebviewMessages();
      }
      await Promise.resolve();
    });

    const webviewPointA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(webviewPointA).toBeDefined();
    const pointAId = webviewPointA!.id;
    act(() => publishTestCanvasSelectionEligibility());
    act(() => {
      selectElement(pointAId, "replace", true);
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([pointAId]);

    document.setSourceText(`${validSource}\n// publish the selected Canvas state`);
    document.isDirty = true;
    document.version += 1;
    await act(async () => {
      emitDocumentChange(document);
      await flushWebviewMessages();
    });
    await vi.waitFor(() => expect(latestContextValueFor("nuinuiCAD.canvasHasSelection")).toBe(true));

    document.setSourceText(invalidSource);
    document.isDirty = true;
    document.version += 1;
    await act(async () => {
      emitDocumentChange(document);
      await flushWebviewMessages();
    });
    await vi.waitFor(() => expect(latestContextValueFor("nuinuiCAD.canvasHasSelection")).toBe(false));

    const invalidDiagnostics = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string;
    }>;
    const invalidDiagnosticCodes = invalidDiagnostics.map((diagnostic) => diagnostic.code);
    await vi.waitFor(() => expect(vscodeObservationState.cachedSnapshot().documents[0]?.canvas).not.toBeNull());
    const invalidSourceCanvas = vscodeObservationState.cachedSnapshot().documents[0]?.canvas;
    const invalidSourceHasSelection = latestContextValueFor("nuinuiCAD.canvasHasSelection");

    document.setSourceText(validSource);
    document.isDirty = false;
    document.version += 1;
    await act(async () => {
      emitDocumentChange(document);
      await flushWebviewMessages();
    });
    await vi.waitFor(() => expect(vscodeObservationState.cachedSnapshot().documents[0]?.canvas).not.toBeNull());
    const restoredSourceCanvas = vscodeObservationState.cachedSnapshot().documents[0]?.canvas;
    const restoredSourceHasSelection = latestContextValueFor("nuinuiCAD.canvasHasSelection");

    expect.soft(invalidDiagnosticCodes).toContain("missing-attribute-value");
    expect.soft(invalidSourceCanvas?.selectedElementIds).not.toContain(pointAId);
    expect.soft(invalidSourceHasSelection).toBe(false);
    expect.soft(restoredSourceCanvas?.selectedElementIds).not.toContain(pointAId);
    expect.soft(restoredSourceHasSelection).toBe(false);
  });

  it("removes the closed document through the root close lifecycle", async () => {
    const document = documentFor("/tmp/observation-close.nui", "file:///tmp/observation-close.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));

    mocks.textDocuments = [];
    emitDocumentClose(document);

    expect(vscodeObservationState.snapshot()).toEqual({ activeDocumentUri: null, documents: [] });
  });

  it("invalidates Canvas observation when the production Canvas session is disposed", async () => {
    const document = documentFor("/tmp/observation-canvas-close.nui", "file:///tmp/observation-canvas-close.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));

    panel.dispose();

    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("accepts current Canvas publication and rejects stale root-supplied versions", async () => {
    const document = documentFor("/tmp/observation-freshness.nui", "file:///tmp/observation-freshness.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas?.documentVersion).toBe(1);

    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version - 1));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas?.documentVersion).toBe(1);

    document.version += 1;
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version - 1));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();

    panel.dispose();
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("isolates Observation context refreshes from full-document scans at the Extension Host boundary", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)\n";
    const documentA = documentFor("/tmp/observation-context-a.nui", "file:///tmp/observation-context-a.nui", source);
    const documentB = documentFor("/tmp/observation-context-b.nui", "file:///tmp/observation-context-b.nui", source);
    const editorA = editorFor(documentA);
    const textReadSites = new Map<TestDocument, string[]>([
      [documentA, []],
      [documentB, []]
    ]);
    for (const document of [documentA, documentB]) {
      document.onGetText = () => {
        textReadSites.get(document)?.push(new Error().stack ?? "");
      };
    }

    setup(false, editorA, [documentA, documentB]);
    const isObservationCall = (site: string): boolean =>
      site.includes("observationHostDocuments") || site.includes("observationHostFacts");
    const isExtractSourceRead = (site: string): boolean => site.includes("exactSourceStateFor");
    const observationTextReadCount = (): number => [...textReadSites.values()]
      .flat()
      .filter(isObservationCall)
      .length;
    const observationDiagnosticReadCount = (): number => observationInstrumentation.diagnosticCallSites
      .filter(isObservationCall)
      .length;
    const startupDiagnosticReads = observationInstrumentation.diagnosticCallSites
      .filter((site) => site.includes("publishCurrentDiagnostics"));
    const initializationMetrics = {
      observationTextReads: observationTextReadCount(),
      observationDiagnosticReads: observationDiagnosticReadCount(),
      ordinaryStartupDiagnosticReads: startupDiagnosticReads.length
    };

    const analysisHost = mocks.registerElementsTreeFeature.mock.calls[0]?.[0] as {
      languageAnalysisSessionFor?: (document: TestDocument) => { getDiagnostics: () => readonly unknown[] };
    } | undefined;
    expect(analysisHost?.languageAnalysisSessionFor?.(documentA)).toBeDefined();
    expect(analysisHost?.languageAnalysisSessionFor?.(documentB)).toBeDefined();

    const panel = openPanelFor(editorA);
    mocks.textDocuments = [documentA, documentB];
    expect(mocks.textDocuments).toEqual([documentA, documentB]);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: documentA.version });

    const events: Array<{ name: string; run: () => void | Promise<void> }> = [
      { name: "Canvas publication", run: () => publishCanvasObservation(panel, canvasObservationSnapshotFor(documentA.version)) },
      { name: "active editor", run: () => {
        mocks.activeTextEditor = null;
        emitActiveEditorChange(undefined);
      } },
      { name: "Tabs", run: emitTabsChange },
      { name: "Tab Groups", run: emitTabGroupsChange }
    ];
    const eventMetrics: Record<string, {
      observationTextReads: number;
      observationDiagnosticReads: number;
      allDiagnosticReads: number;
      extractModuleSourceReads: number;
      secondDocumentExtractSourceReads: number;
    }> = {};

    for (const event of events) {
      for (const sites of textReadSites.values()) sites.length = 0;
      observationInstrumentation.diagnosticCallSites.length = 0;
      await event.run();
      await vi.waitFor(() => {
        expect(latestContextValueFor("nuinuiCAD.canvasHasSelection")).toBe(true);
        expect(latestContextValueFor("nuinuiCAD.canvasCanSelectInstance")).toBe(false);
        expect(latestContextValueFor("nuinuiCAD.canvasHasCoordinatePointConversionTarget")).toBe(false);
      });
      if (event.name === "Canvas publication") {
        expect.soft(vscodeObservationState.cachedSnapshot().documents[0]).toMatchObject({
          activeSurface: "canvas",
          canvas: { selectedElementIds: ["point-a"] }
        });
      }
      const documentASites = textReadSites.get(documentA) ?? [];
      const documentBSites = textReadSites.get(documentB) ?? [];
      eventMetrics[event.name] = {
        observationTextReads: observationTextReadCount(),
        observationDiagnosticReads: observationDiagnosticReadCount(),
        allDiagnosticReads: observationInstrumentation.diagnosticCallSites.length,
        extractModuleSourceReads: documentASites.filter(isExtractSourceRead).length,
        secondDocumentExtractSourceReads: documentBSites.filter(isExtractSourceRead).length
      };
    }

    expect.soft(mocks.textDocuments).toContain(documentA);
    expect.soft(mocks.textDocuments).toContain(documentB);
    expect.soft(initializationMetrics.ordinaryStartupDiagnosticReads).toBe(2);
    expect.soft(initializationMetrics.observationTextReads).toBe(0);
    expect.soft(initializationMetrics.observationDiagnosticReads).toBe(0);
    for (const metrics of Object.values(eventMetrics)) {
      expect.soft(metrics.observationTextReads).toBe(0);
      expect.soft(metrics.observationDiagnosticReads).toBe(0);
      expect.soft(metrics.allDiagnosticReads).toBe(0);
      expect.soft(metrics.extractModuleSourceReads).toBeGreaterThan(0);
      expect.soft(metrics.secondDocumentExtractSourceReads).toBe(0);
    }
  });

  it("refreshes Module-refactoring contexts on the Reveal-established Canvas activation", async () => {
    const source = [
      "nui 1",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance Top = Stamp()"
    ].join("\n");
    const document = documentFor("/tmp/module-context-activation.nui", "file:///tmp/module-context-activation.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });

    const registrationHost = mocks.registerElementsTreeFeature.mock.calls[0]?.[0] as {
      languageAnalysisSessionFor: (candidate: TestDocument) => {
        getSourceRevision: () => number;
        runtimeEvaluationSnapshot: () => { compiled: CompiledDslDocument } | undefined;
      };
    };
    const session = registrationHost.languageAnalysisSessionFor(document);
    const runtime = session.runtimeEvaluationSnapshot();
    expect(runtime).toBeDefined();
    const compiled = runtime?.compiled;
    const target = compiled?.document?.elements.find((element: { name?: string; type?: string }) => element.name === "Top");
    expect(compiled && target).toBeTruthy();
    if (!compiled || !target) return;
    const sourceSnapshot = {
      normalizedSource: source,
      sourceRevision: session.getSourceRevision()
    };
    const publicationTargets = inlineModuleCanvasTargetProofsFor({
      source: sourceSnapshot,
      compiled,
      elements: compiled.document?.elements ?? [],
      selectedElementIds: [target.id],
      moduleMaterialization: compiled.moduleMaterialization
    });
    expect(publicationTargets).toHaveLength(1);
    const selectedElementSources = selectedElementSourcesForCanvasObservation(
      [target.id],
      compiled,
      compiled.document?.elements ?? []
    );

    panel.active = false;
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    mocks.executeCommand.mockClear();
    await handler({
      type: "inlineModuleCanvasTargetsPublication",
      documentVersion: document.version,
      normalizedSource: source,
      targets: publicationTargets
    });
    await handler({
      type: "canvasObservationPublication",
      snapshot: {
        ...canvasObservationSnapshotFor(document.version),
        selectedElementIds: [target.id],
        selectedElementSources
      }
    });
    await vi.waitFor(() => expect(latestContextValueFor("nuinuiCAD.inlineModuleCanvasTarget")).toBe(false));
    expect(latestContextValueFor("nuinuiCAD.extractModuleCanvasTarget")).toBe(false);

    panel.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    await vi.waitFor(() => {
      expect(latestContextValueFor("nuinuiCAD.inlineModuleCanvasTarget")).toBe(true);
      expect(latestContextValueFor("nuinuiCAD.extractModuleCanvasTarget")).toBe(true);
    });

    panel.active = false;
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    await vi.waitFor(() => {
      expect(latestContextValueFor("nuinuiCAD.inlineModuleCanvasTarget")).toBe(false);
      expect(latestContextValueFor("nuinuiCAD.extractModuleCanvasTarget")).toBe(false);
    });
  });

  it("resets observation state and detaches the host projection on Extension Host disposal", async () => {
    const document = documentFor("/tmp/observation-dispose.nui", "file:///tmp/observation-dispose.nui");
    const editor = editorFor(document);
    const context = setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await publishCanvasObservation(panel, canvasObservationSnapshotFor(document.version));
    expect(vscodeObservationState.snapshot().documents).toHaveLength(1);

    for (const subscription of context.subscriptions) subscription.dispose();
    mocks.textDocuments = [document];

    expect(vscodeObservationState.snapshot()).toEqual({ activeDocumentUri: null, documents: [] });
  });

  it("registers and opens the Output Preview production surface", () => {
    setup();

    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.openOutputPreview", expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.fitOutputPreview", expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.clearOutputPreviewFocus", expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.exportCurrentOutput", expect.any(Function));
    const panel = openOutputPreviewPanelFor();
    expect(mocks.createWebviewPanel.mock.calls[0]?.[0]).toBe("nuinuiCAD.outputPreview");
    expect(panel.webview.html).toContain('<html lang="en" data-nuinui-surface="outputPreview">');
  });

  it("uses the Extension Host locale for Canvas and Output Preview HTML and ready publication", async () => {
    mocks.displayLanguage = "ja-JP";
    setup();

    const outputPanel = openOutputPreviewPanelFor();
    expect(outputPanel.webview.html).toContain('<html lang="ja" data-nuinui-surface="outputPreview">');
    await messageHandlerFor(outputPanel)({ type: "webviewReady" });
    expect(outputPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "webviewPresentation",
      presentation: expect.objectContaining({
        locale: "ja",
        strings: expect.objectContaining({ "output.noOutputs": "印刷またはSVGの出力がありません" })
      })
    }));

    const canvasPanel = openPanelFor();
    expect(canvasPanel.webview.html).toContain('<html lang="ja" data-nuinui-surface="canvas">');
    await messageHandlerFor(canvasPanel)({ type: "webviewReady" });
    expect(canvasPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "webviewPresentation",
      presentation: expect.objectContaining({ locale: "ja" })
    }));
  });

  it("reveals the existing Output Preview instead of creating a second panel", () => {
    setup();
    const panel = openOutputPreviewPanelFor();

    mocks.activeTabInput = new mocks.TabInputText(mocks.activeTextEditor!.document.uri);
    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(2);
  });

  it("enables Source Reveal in Output Preview for an exact current imported Module root", async () => {
    const source = [
      "nui 1",
      'import "./probe.nui" as probe',
      "group G {",
      "  instance N = probe::Probe(x: 20)",
      "  line edge = segment(start: (0, 0), end: (20, 0))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg Probe(layout: L, layers: [default], margin: 1)"
    ].join("\n");
    const document = documentFor("/tmp/import-output-reveal.nui", "file:///tmp/import-output-reveal.nui", source);
    document.languageId = "nui";
    const editor = editorFor(document);
    const position = source.indexOf("group G") + "group ".length;
    const cursor = document.positionAt(position);
    editor.selection = { anchor: cursor, active: cursor, start: cursor, end: cursor };
    editor.selections = [editor.selection];
    const semantic = await issue1654GraphSnapshotFor(document);
    const target = queryDslOutputPreviewRevealSourceTarget({
      source: { normalizedSource: source, sourceRevision: semantic.sourceRevision },
      compiled: semantic.compiled,
      position
    });
    if (target.status !== "resolved") throw new Error(`missing exact Host Reveal target: ${target.reason}`);
    expect(isDslOutputPreviewRevealSourceTargetStructurallyAvailable({
      target: target.target, compiled: semantic.compiled
    })).toBe(true);
    const graph = semantic.compiled.moduleRuntimeContext!.graph;
    const snapshot = {
      documentVersion: document.version, rootGeneration: 1, graphRevision: semantic.graphRevision,
      graph, compiled: semantic.compiled, diagnostics: []
    };
    const current = {
      status: "current", owner: "multi-document", documentVersion: document.version, rootGeneration: 1, snapshot
    } as const;
    let diagnosticsState: VscodeMultiDocumentDiagnosticsState = current;
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => diagnosticsState),
      languageSemanticSnapshotFor: vi.fn(async () => semantic),
      onDiagnosticsChanged: vi.fn()
    };
    setup(false, editor, [document]);
    await vi.waitFor(() => {
      expect(latestContextValueFor("nuinuiCAD.revealInOutputPreviewSourceTarget")).toBe(true);
    });
    diagnosticsState = { status: "building", documentVersion: document.version, rootGeneration: 2 };
    for (const listener of mocks.multiDocumentDiagnosticsListeners) listener(document.uri.toString());
    await vi.waitFor(() => {
      expect(latestContextValueFor("nuinuiCAD.revealInOutputPreviewSourceTarget")).toBe(false);
    });
    commandHandlerFor("nuinuiCAD.revealInOutputPreview")?.();
    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();

    diagnosticsState = {
      ...current, rootGeneration: 2,
      snapshot: { ...snapshot, rootGeneration: 2, graphRevision: semantic.graphRevision + 1 }
    };
    for (const listener of mocks.multiDocumentDiagnosticsListeners) listener(document.uri.toString());
    await vi.waitFor(() => {
      expect(latestContextValueFor("nuinuiCAD.revealInOutputPreviewSourceTarget")).toBe(true);
    });
  });

  it("runs imported Output Preview through the registered panel, retained graph and actual Rust evaluator", async () => {
    const dependency = [
      "nui 1",
      "export module DartCenter() {",
      "  export line center = segment(start: (3, 7), end: (13, 7))",
      "}"
    ].join("\n");
    const noOutputs = [
      "nui 1", 'import "./probe.nui" as probe',
      "group G {",
      "  instance dart_center = probe::DartCenter()",
      "  line copied = mirrorCopy(axis1: (0, 0), axis2: (20, 0), baseLines: [dart_center::center])",
      "}"
    ].join("\n");
    const populated = `${noOutputs}\nlayout L {\n  place G(at: (0, 0))\n}\nsvg Probe(layout: L, layers: [default], margin: 1)`;
    const document = documentFor("/tmp/import-output-roundtrip.nui", "file:///tmp/import-output-roundtrip.nui", noOutputs);
    document.languageId = "nui";
    const editor = editorFor(document);
    const uri = document.uri.toString();
    let diagnosticState: VscodeMultiDocumentDiagnosticsState = { status: "building", documentVersion: 1, rootGeneration: 1 };
    const publish = (publication: VscodeMultiDocumentGraphPublication) => {
      for (const listener of mocks.multiDocumentDiagnosticsListeners) listener(uri);
      publishVscodeMultiDocumentGraphPublication(uri, publication);
    };
    const publishCurrent = async (revision: number, saved = dependency) => {
      const semantic = await issue1654GraphSnapshotFor(document, document.getText(), document.version, revision, saved);
      const { compiled } = semantic;
      const graph = compiled.moduleRuntimeContext!.graph;
      const canvasRuntime = projectVscodeMultiDocumentCanvasRuntime({ graph, compiled, graphRevision: revision });
      expect(canvasRuntime?.preparedRustEvaluation.rustEligible).toBe(true);
      diagnosticState = {
        status: "current", owner: "multi-document", rootGeneration: revision, documentVersion: semantic.documentVersion,
        snapshot: {
          documentVersion: semantic.documentVersion, rootGeneration: revision, graphRevision: revision,
          graph, compiled, diagnostics: []
        }
      };
      publish({
        type: "multiDocumentGraphPublication", status: "current", documentVersion: semantic.documentVersion,
        hostDocumentUri: uri, graph: vscodeMultiDocumentGraphSnapshot(graph, revision), canvasRuntime
      });
      return canvasRuntime!;
    };
    const messagesFor = (panel: TestPanel) => panel.webview.postMessage.mock.calls
      .map(([message]) => message as ExtensionToVscodeMessage);
    const planResultsFor = (panel: TestPanel) => messagesFor(panel)
      .filter(message => message.type === "outputPreviewPlanResult" && "plan" in message);
    const bridgeErrors: unknown[] = [];
    const mount = (panel: TestPanel) => {
      panel.webview.postMessage.mockImplementation((message: ExtensionToVscodeMessage) => {
        const data = JSON.parse(JSON.stringify(message));
        queueMicrotask(() => act(() => { window.dispatchEvent(new MessageEvent("message", { data })); }));
        return Promise.resolve(true);
      });
      const api: VscodeWebviewApi = {
        postMessage: (message) => { void messageHandlerFor(panel)(message).catch(error => bridgeErrors.push(error)); }
      };
      return render(createElement(OutputPreviewApp, { api }));
    };
    const binary = inject("rustStdioParityBinaryPath" as never) as unknown as string;
    const rust = createRustStdioParityClient(process.cwd(), { prebuiltBinaryPath: binary });
    mocks.evaluateRust = rust.evaluateInput;
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => diagnosticState),
      isSavedGraphSnapshotCurrent: vi.fn(async (_document, snapshot) =>
        diagnosticState.status === "current" && diagnosticState.owner === "multi-document" && diagnosticState.snapshot === snapshot),
      onDiagnosticsChanged: vi.fn()
    };
    try {
      await publishCurrent(1);
      setup(false, editor, [document]);
      const panel = openOutputPreviewPanelFor(editor);
      const mounted = mount(panel);
      expect(await screen.findByText("No print or SVG outputs")).toBeInTheDocument();
      const hydrated = messagesFor(panel);
      expect(hydrated.findIndex(message => message.type === "replaceTextDocument")).toBeLessThan(
        hydrated.findIndex(message => message.type === "multiDocumentGraphPublication" && !!message.outputPreview?.sourceEditing)
      );

      let finishOpeningSource!: (value: TestEditor) => void;
      mocks.showTextDocument.mockImplementationOnce(() => new Promise(resolve => { finishOpeningSource = resolve; }));
      fireEvent.click(screen.getByRole("button", { name: "Insert Template…" }));
      await waitFor(() => expect(mocks.showTextDocument).toHaveBeenCalledTimes(1));
      diagnosticState = { status: "invalidated", documentVersion: 1, rootGeneration: 2 };
      publish({ type: "multiDocumentGraphPublication", status: "invalidated", documentVersion: 1, hostDocumentUri: uri, graph: null });
      await act(async () => { finishOpeningSource(editor); });
      expect(mocks.executeCommand).not.toHaveBeenCalledWith("nuinuiCAD.insertTemplate", expect.anything());

      await publishCurrent(2);
      expect(await screen.findByRole("button", { name: "Insert Template…" })).toBeInTheDocument();
      const insertSnippet = vi.fn(async () => true);
      Object.assign(editor, { insertSnippet });
      mocks.showTextDocument.mockImplementation(async () => {
        mocks.activeTabInput = new mocks.TabInputText(document.uri);
        return editor;
      });
      mocks.executeCommand.mockImplementation(async (command: string, ...args: unknown[]) => {
        if (command === "nuinuiCAD.insertTemplate") return commandHandlerFor(command)?.(...args);
        return undefined;
      });
      mocks.showQuickPick.mockImplementation(async (items: readonly unknown[]) => items[0]);
      fireEvent.click(screen.getByRole("button", { name: "Insert Template…" }));
      await waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith("nuinuiCAD.insertTemplate", {
        documentUri: uri, expectedDocumentVersion: 1, insertionOrigin: "document-end", preselectedFamilyId: "output-print",
        graphAuthority: { hostDocumentUri: uri, documentVersion: 1, graphRevision: 2, rootSourceRevision: 1 }
      }));
      await waitFor(() => expect(insertSnippet).toHaveBeenCalledWith(
        expect.objectContaining({ value: expect.stringContaining("\nlayout ") }),
        document.positionAt(noOutputs.length)
      ));

      document.version = 2;
      document.setSourceText(populated);
      emitDocumentChange(document);
      const first = await publishCurrent(3);
      expect(await screen.findByLabelText(/^output preview$/i)).toBeInTheDocument();
      expect(mocks.rustProcesses[0]?.request).toHaveBeenCalledWith(first.preparedRustEvaluation.input);
      expect(planResultsFor(panel).at(-1)).toMatchObject({
        graphAuthority: { graphRevision: 3, documentVersion: 2 },
        plan: { drawables: expect.arrayContaining([
          expect.objectContaining({ start: { x: 3, y: 7 }, end: { x: 13, y: 7 } })
        ]) }
      });

      const position = document.positionAt(populated.indexOf("group G") + "group ".length);
      editor.selection = { anchor: position, active: position, start: position, end: position };
      mocks.activeTabInput = new mocks.TabInputText(document.uri);
      commandHandlerFor("nuinuiCAD.revealInOutputPreview")?.();
      await waitFor(() => expect(panel.reveal).toHaveBeenCalledWith(2, false));
      expect(messagesFor(panel)).toContainEqual(expect.objectContaining({
        type: "outputPreviewReveal", graphAuthority: expect.objectContaining({ graphRevision: 3 }),
        runtimeTarget: expect.objectContaining({ kind: "group" })
      }));

      // A saved dependency rebuild changes the graph without changing the root TextDocument.
      mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.outputPreview");
      let completeSaveDialog!: (choice: unknown) => void;
      mocks.showSaveDialog.mockImplementationOnce(() => new Promise(resolve => { completeSaveDialog = resolve; }));
      commandHandlerFor("nuinuiCAD.exportCurrentOutput")?.();
      await waitFor(() => expect(mocks.showSaveDialog).toHaveBeenCalledTimes(1));
      diagnosticState = { status: "building", documentVersion: 2, rootGeneration: 4 };
      publish({ type: "multiDocumentGraphPublication", status: "building", hostDocumentUri: uri, documentVersion: 2, graph: null });
      await waitFor(() => expect(screen.queryByLabelText(/^output preview$/i)).toBeNull());
      completeSaveDialog({ scheme: "file", fsPath: "/tmp/stale-import.svg" });
      await waitFor(() => expect(messagesFor(panel)).toContainEqual(expect.objectContaining({
        type: "outputPreviewExportResult", status: "failed"
      })));
      expect(mocks.rustProcesses[0]?.exportOutput).not.toHaveBeenCalled();

      await publishCurrent(4, dependency.replaceAll(", 7)", ", 9)"));
      expect(await screen.findByLabelText(/^output preview$/i)).toBeInTheDocument();
      expect(planResultsFor(panel).at(-1)).toMatchObject({
        graphAuthority: { graphRevision: 4, documentVersion: 2 },
        plan: { drawables: expect.arrayContaining([
          expect.objectContaining({ start: { x: 3, y: 9 }, end: { x: 13, y: 9 } })
        ]) }
      });

      mounted.unmount();
      (panel.dispose as unknown as () => void)();
      const reopened = openOutputPreviewPanelFor(editor);
      expect(reopened).not.toBe(panel);
      mount(reopened);
      expect(await screen.findByLabelText(/^output preview$/i)).toBeInTheDocument();
      const updatedPlan = planResultsFor(reopened).at(-1);
      expect(updatedPlan).toMatchObject({ graphAuthority: { documentVersion: 2, graphRevision: 4 } });
      mocks.showSaveDialog.mockResolvedValue({ scheme: "file", fsPath: "/tmp/current-import" });
      commandHandlerFor("nuinuiCAD.exportCurrentOutput")?.();
      await waitFor(() => expect(mocks.rustProcesses[0]?.exportOutput).toHaveBeenCalledWith({
        path: "/tmp/current-import.svg",
        payload: updatedPlan && "plan" in updatedPlan ? updatedPlan.plan.rustPayload : undefined
      }));
      expect(bridgeErrors).toEqual([]);
    } finally {
      rust.dispose();
    }
  }, 30_000);

  it.each([
    "unchanged", "dirty editor", "saved write", "saved delete", "pending plan",
    "retained publication", "before save dialog", "Source Reveal", "template picker", "navigation", "placement commit"
  ] as const)(
    "guards Output Preview against a saved dependency race (%s)",
    async (scenario) => {
      const directory = await mkdtemp(join(realpathSync(tmpdir()), "nuinui-1717-freshness-"));
      const rootPath = join(directory, "root.nui");
      const modulePath = join(directory, "dart.nui");
      const dependency = (y: number) => `nui 1\nexport module DartCenter() {\n  export line center = segment(start: (3, ${y}), end: (13, ${y}))\n}\n`;
      const group = [
        "nui 1", 'import "./bridge.nui" as bridge',
        "group G {", "  instance dart = bridge::DartCenter()", "}"
      ];
      const source = (scenario === "template picker" ? group : [
        ...group,
        "layout L {", "  place G(at: (0, 0))", "}",
        "svg Probe(layout: L, layers: [default], margin: 1)"
      ]).join("\n");
      await Promise.all([
        writeFile(rootPath, source),
        writeFile(join(directory, "bridge.nui"), 'nui 1\nimport "./dart.nui" as dart\nexport dart::DartCenter\n'),
        writeFile(modulePath, dependency(7))
      ]);
      const document = documentFor(rootPath, `file://${rootPath}`, source);
      document.languageId = "nui";
      const dirty = documentFor(modulePath, `file://${modulePath}`, dependency(99));
      dirty.isDirty = true;
      const documents = scenario === "dirty editor" ? [document, dirty] : [document];
      const editor = editorFor(document);
      const host = createVscodeModuleMultiDocumentHost();
      const binary = inject("rustStdioParityBinaryPath" as never) as unknown as string;
      const rust = createRustStdioParityClient(process.cwd(), { prebuiltBinaryPath: binary });
      let releaseEvaluation!: () => void;
      const evaluationGate = new Promise<void>(resolve => { releaseEvaluation = resolve; });
      let heldEvaluation = false;
      let evaluationReady = false;
      mocks.evaluateRust = async input => {
        const shouldHold = scenario === "pending plan" && !heldEvaluation;
        if (shouldHold) heldEvaluation = true;
        const evaluated = await rust.evaluateInput(input);
        if (shouldHold) {
          evaluationReady = true;
          await evaluationGate;
        }
        return evaluated;
      };
      const context = setup(false, editor, documents, undefined, () => host.start());
      const panel = openOutputPreviewPanelFor(editor);
      mocks.textDocuments = documents;
      const messages = () => panel.webview.postMessage.mock.calls.map(([value]) => value as ExtensionToVscodeMessage);
      const planAt = (y: number) => messages().find(message =>
        message.type === "outputPreviewPlanResult" && "plan" in message &&
        message.plan.drawables.some(drawable => drawable.kind === "line" && drawable.start.y === y && drawable.end.y === y));
      const pending = new Set<Promise<unknown>>();
      const bridgeErrors: unknown[] = [];
      let finishNativeWait: ((selection?: unknown) => void) | undefined;
      let exportAvailable = false;
      let graphAvailable = false;
      const api: VscodeWebviewApi = {
        postMessage: message => {
          if (message.type === "outputPreviewExportAvailability") {
            exportAvailable = message.format === "svg";
            graphAvailable = message.graphAuthority !== undefined;
          }
          const request = messageHandlerFor(panel)(message).catch(error => { bridgeErrors.push(error); });
          pending.add(request);
          void request.then(() => pending.delete(request));
        }
      };
      panel.webview.postMessage.mockImplementation((message: ExtensionToVscodeMessage) => {
        const data = JSON.parse(JSON.stringify(message));
        queueMicrotask(() => act(() => { window.dispatchEvent(new MessageEvent("message", { data })); }));
        return Promise.resolve(true);
      });
      const hostDocument = document as unknown as Parameters<typeof host.diagnosticsStateFor>[0];
      let mounted: ReturnType<typeof render> | undefined;
      const currentGraph = () => {
        const state = host.diagnosticsStateFor(hostDocument);
        if (state.status !== "current" || state.owner !== "multi-document") throw new Error("expected current imported graph");
        return state;
      };
      const changeSavedDependency = async (remove = false) => {
        const old = currentGraph();
        if (remove) await rm(modulePath);
        else await writeFile(modulePath, dependency(9));
        // The VS Code watcher is deliberately withheld. Its graph cache is still current.
        expect(host.diagnosticsStateFor(hostDocument)).toEqual(old);
      };
      const drainAction = async (complete?: () => void) => {
        await act(async () => {
          complete?.();
          await Promise.all([...pending]);
        });
      };
      try {
        if (scenario === "retained publication") {
          await waitFor(() => expect(currentGraph().snapshot.graph.valid).toBe(true));
          await changeSavedDependency();
        }
        mounted = render(createElement(OutputPreviewApp, { api }));
        if (scenario === "pending plan") {
          await waitFor(() => expect(evaluationReady).toBe(true));
          await changeSavedDependency();
          await drainAction(releaseEvaluation);
          expect(planAt(7), "stale Rust plan from the cached graph").toBeUndefined();
          await waitFor(() => expect(planAt(9)).toBeDefined());
        } else if (scenario === "retained publication") {
          await waitFor(() => expect(planAt(9)).toBeDefined());
          expect(planAt(7)).toBeUndefined();
          expect(messages().some(message => message.type === "multiDocumentGraphPublication" &&
            message.status === "current" && message.outputPreview?.sourceEditing &&
            message.graph.nodes.some(node => node.source.normalizedSource === dependency(7)))).toBe(false);
        } else if (scenario === "template picker") {
          const insertSnippet = vi.fn(async () => true);
          Object.assign(editor, { insertSnippet });
          mocks.showTextDocument.mockImplementation(async () => {
            mocks.activeTabInput = new mocks.TabInputText(document.uri);
            return editor;
          });
          mocks.executeCommand.mockImplementation(async (id: string, ...args: unknown[]) =>
            id === "nuinuiCAD.insertTemplate" ? commandHandlerFor(id)?.(...args) : undefined);
          let choice: unknown;
          mocks.showQuickPick.mockImplementation((items: readonly unknown[]) => new Promise(resolve => {
            choice = items[0];
            finishNativeWait = resolve;
          }));
          await waitFor(() => expect(graphAvailable).toBe(true));
          fireEvent.click(screen.getByRole("button", { name: "Insert Template…" }));
          await waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledOnce());
          await changeSavedDependency();
          await drainAction(() => finishNativeWait?.(choice));
          expect(insertSnippet).not.toHaveBeenCalled();
          expect(mocks.showErrorMessage).toHaveBeenCalled();
        } else {
          expect(await screen.findByLabelText(/^output preview$/i)).toBeInTheDocument();
          expect(planAt(7), "initial plan uses saved bytes").toBeDefined();
          if (scenario === "Source Reveal") {
            const position = document.positionAt(source.indexOf("group G") + "group ".length);
            editor.selection = { anchor: position, active: position, start: position, end: position };
            mocks.activeTabInput = new mocks.TabInputText(document.uri);
            panel.reveal.mockClear();
            await changeSavedDependency();
            await commandHandlerFor("nuinuiCAD.revealInOutputPreview")?.();
            expect(panel.reveal).not.toHaveBeenCalled();
            expect(messages()).not.toContainEqual(expect.objectContaining({ type: "outputPreviewReveal" }));
          } else if (scenario === "navigation") {
            mocks.showTextDocument.mockImplementation(() => new Promise(resolve => { finishNativeWait = resolve; }));
            fireEvent.click(screen.getByRole("button", { name: "Go to Source" }));
            await waitFor(() => expect(mocks.showTextDocument).toHaveBeenCalledOnce());
            await changeSavedDependency();
            await drainAction(() => finishNativeWait?.(editor));
            expect(mocks.executeCommand).not.toHaveBeenCalledWith("editor.unfold");
            expect(editor.revealRange).not.toHaveBeenCalled();
          } else if (scenario === "placement commit") {
            const plan = planAt(7);
            if (!plan || plan.type !== "outputPreviewPlanResult") throw new Error("missing current placement plan");
            const from = source.indexOf("0, 0");
            const commit = {
              type: "outputPreviewPlaceCommit", documentVersion: document.version, graphAuthority: plan.graphAuthority,
              normalizedSourceSnapshot: source, statementRange: { from: source.indexOf("place G"), to: source.indexOf("))") + 2 },
              patches: [{ range: { from, to: from + 1 }, expectedText: "0", replacement: "1" }]
            };
            mocks.applyEdit.mockResolvedValue(true);
            await messageHandlerFor(panel)(commit);
            expect(mocks.applyEdit).toHaveBeenCalledOnce();
            mocks.applyEdit.mockClear();
            await changeSavedDependency();
            await messageHandlerFor(panel)(commit);
            expect(mocks.applyEdit).not.toHaveBeenCalled();
          } else {
            mocks.showSaveDialog.mockImplementation(() => new Promise(resolve => { finishNativeWait = resolve; }));
            await waitFor(() => expect(exportAvailable).toBe(true));
            if (scenario === "before save dialog") await changeSavedDependency();
            await commandHandlerFor("nuinuiCAD.exportCurrentOutput")?.();
            if (scenario === "before save dialog") {
              await waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
                type: "outputPreviewExportResult", status: "failed"
              })));
              expect(mocks.showSaveDialog).not.toHaveBeenCalled();
            } else {
              await waitFor(() => expect(mocks.showSaveDialog).toHaveBeenCalledOnce());
              if (scenario === "saved write" || scenario === "saved delete") {
                await changeSavedDependency(scenario === "saved delete");
              }
              await drainAction(() => finishNativeWait?.({ scheme: "file", fsPath: join(directory, "probe.svg") }));
              const exportMock = mocks.rustProcesses[0]?.exportOutput;
              if (scenario === "unchanged" || scenario === "dirty editor") {
                expect(exportMock).toHaveBeenCalledOnce();
              } else {
                expect(exportMock, "stale export from the cached graph").not.toHaveBeenCalled();
                expect(messages()).toContainEqual(expect.objectContaining({ type: "outputPreviewExportResult", status: "failed" }));
              }
            }
            if (scenario === "saved delete") {
              await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
              expect(screen.queryByLabelText(/^output preview$/i)).toBeNull();
              await writeFile(modulePath, dependency(9));
              mocks.savedFileWatchers[0]?.create?.(dirty.uri);
            }
          }
          if (scenario !== "unchanged" && scenario !== "dirty editor") {
            await waitFor(() => expect(planAt(9)).toBeDefined());
          }
          if (scenario === "saved write") {
            const recovered = currentGraph().snapshot.graphRevision;
            mocks.savedFileWatchers[0]?.change?.(dirty.uri);
            mocks.savedFileWatchers[0]?.change?.(dirty.uri);
            await waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
              type: "outputPreviewPlanResult", graphAuthority: expect.objectContaining({ graphRevision: recovered + 1 }),
              plan: expect.objectContaining({ drawables: expect.arrayContaining([
                expect.objectContaining({ start: { x: 3, y: 9 }, end: { x: 13, y: 9 } })
              ]) })
            })));
          }
        }
        expect(document.version).toBe(1);
        expect(bridgeErrors).toEqual([]);
      } finally {
        mounted?.unmount();
        finishNativeWait?.();
        releaseEvaluation();
        await Promise.all([...pending]);
        for (const subscription of context.subscriptions) subscription.dispose();
        host.dispose();
        rust.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    }, 30_000
  );

  it("opens Output Preview for the active Canvas document without a source cursor", async () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const editorA = editorFor(documentA);
    setup(false, editorA, [documentA]);
    const canvas = openPanelFor(editorA);
    canvas.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    const preview = mocks.panels.at(-1)!;
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(preview.webview.html).toContain('<html lang="en" data-nuinui-surface="outputPreview">');

    await messageHandlerFor(preview)({ type: "webviewReady" });
    await messageHandlerFor(preview)({ type: "webviewAuthoritativeDocumentReady", documentVersion: documentA.version });
    expect(preview.webview.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewOpen",
      documentVersion: documentA.version,
      normalizedSourceOffset: null
    });
  });

  it("keeps active Canvas document identity when another document already has an Output Preview", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA, documentB]);
    const canvasA = openPanelFor(editorA);
    const previewB = openOutputPreviewPanelFor(editorB);
    canvasA.active = true;
    previewB.active = false;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(3);
    expect(mocks.createWebviewPanel.mock.calls.at(-1)?.[1]).toBe("a.nui — Output Preview");
    expect(mocks.panels.at(-1)?.webview.html).toContain('<html lang="en" data-nuinui-surface="outputPreview">');
    expect(previewB.reveal).not.toHaveBeenCalled();
  });

  it("opens Canvas for the active Output Preview document", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const editorA = editorFor(documentA);
    setup(false, editorA, [documentA]);
    const preview = openOutputPreviewPanelFor(editorA);
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.outputPreview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(mocks.panels.at(-1)?.webview.html).toContain('<html lang="en" data-nuinui-surface="canvas">');
    expect(preview.reveal).not.toHaveBeenCalled();
  });

  it("fails closed for an unrelated active webview instead of using the active text editor", () => {
    setup();
    mocks.activeTabInput = new mocks.TabInputWebview("unrelated.webview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Activate a .nui Text Editor or Output Preview before running this command."
    );
  });

  it("reveals an existing cross-surface target without duplicating it", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const editorA = editorFor(documentA);
    setup(false, editorA, [documentA]);
    const canvas = openPanelFor(editorA);
    const preview = openOutputPreviewPanelFor(editorA);
    preview.active = true;
    canvas.active = false;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.outputPreview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(canvas.reveal).toHaveBeenCalledWith(2);
  });

  it("never resolves a cross-surface open command through another document", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA, documentB]);
    const previewA = openOutputPreviewPanelFor(editorA);
    const canvasB = openPanelFor(editorB);
    previewA.active = true;
    canvasB.active = false;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.outputPreview");

    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(3);
    expect(mocks.panels.at(-1)?.webview.html).toContain('<html lang="en" data-nuinui-surface="canvas">');
    expect(canvasB.reveal).not.toHaveBeenCalled();
  });

  it("fails closed when the active webview has no matching live session", () => {
    setup();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith("nuinuiCAD: Output Preview requires an active .nui Text Editor or Canvas.");
  });

  it("keeps Canvas and Output Preview sessions independent for one document", () => {
    setup();
    const canvas = openPanelFor();
    const preview = openOutputPreviewPanelFor();

    preview.dispose();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(canvas.dispose).not.toHaveBeenCalled();
  });

  it("hydrates and live-syncs the authoritative TextDocument in Output Preview", async () => {
    setup();
    const document = mocks.activeTextEditor!.document;
    const panel = openOutputPreviewPanelFor();

    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      documentVersion: document.version
    }));
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewOpen",
      documentVersion: document.version,
      normalizedSourceOffset: expect.any(Number)
    }));

    document.setSourceText("nui 1\n// changed\n");
    document.version += 1;
    emitDocumentChange(document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      sourceText: "nui 1\n// changed\n",
      documentVersion: document.version
    }));
  });

  it("routes Fit Output Preview through the active Preview session", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.fitOutputPreview")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewFit" });
  });

  it("routes Reset before authoritative document readiness while Fit remains document-current gated", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    await messageHandlerFor(panel)({ type: "webviewReady" });
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({ type: "outputPreviewResetView" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewResetView" });

    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.resetOutputPreviewView")?.();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewResetView" });

    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.fitOutputPreview")?.();
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith({ type: "outputPreviewFit" });
  });

  it("routes Reset through the last active Output Preview session during a transient inactive panel state", async () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA, documentB]);
    const previewA = openOutputPreviewPanelFor(editorA);
    const previewB = openOutputPreviewPanelFor(editorB);

    previewA.active = false;
    previewB.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.outputPreview");
    (previewB as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    await messageHandlerFor(previewB)({ type: "webviewReady" });
    previewB.active = false;
    previewA.webview.postMessage.mockClear();
    previewB.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.resetOutputPreviewView")?.();

    expect(previewB.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewResetView" });
    expect(previewA.webview.postMessage).not.toHaveBeenCalledWith({ type: "outputPreviewResetView" });
  });

  it("does not route Reset to an inactive session when another surface is active", () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    panel.webview.postMessage.mockClear();
    mocks.activeTabInput = new mocks.TabInputWebview("unrelated.webview");

    commandHandlerFor("nuinuiCAD.resetOutputPreviewView")?.();

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith({ type: "outputPreviewResetView" });
  });

  it("routes Clear Output Preview Focus through the active Preview session", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.clearOutputPreviewFocus")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewClearFocus" });
  });

  it("routes Export Current Output only through a current active Preview", async () => {
    setup();
    commandHandlerFor("nuinuiCAD.exportCurrentOutput")?.();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Export Current Output is only available from an active Output Preview."
    );

    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "print:output-a",
      format: "pdf"
    });
    panel.webview.postMessage.mockClear();

    commandHandlerFor("nuinuiCAD.exportCurrentOutput")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "outputPreviewExport" });
  });

  it("saves the current PDF payload with the output-based default name", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "print:output-a",
      format: "pdf"
    });
    mocks.showSaveDialog.mockResolvedValue({ scheme: "file", fsPath: "/tmp/chosen", toString: () => "file:///tmp/chosen" });
    const payload = { version: 1, kind: "print" };

    await messageHandlerFor(panel)({
      type: "outputPreviewExportRequest",
      requestId: 4,
      documentVersion: document.version,
      outputKey: "print:output-a",
      outputName: "家庭用A4",
      format: "pdf",
      payload
    });

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultUri: expect.objectContaining({ fsPath: "/tmp/pattern_家庭用A4.pdf" }),
      filters: { "PDF document": ["pdf"] },
      saveLabel: "Export PDF"
    }));
    expect(mocks.rustProcesses[0]?.exportOutput).toHaveBeenCalledWith({
      path: "/tmp/chosen.pdf",
      payload
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewExportResult",
      requestId: 4,
      status: "saved"
    });
    expect(mocks.showInformationMessage).toHaveBeenCalledWith("nuinuiCAD: Saved chosen.pdf.");
  });

  it("cancels silently and never writes an output file", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "svg:output-b",
      format: "svg"
    });
    mocks.showSaveDialog.mockResolvedValue(undefined);

    await messageHandlerFor(panel)({
      type: "outputPreviewExportRequest",
      requestId: 5,
      documentVersion: document.version,
      outputKey: "svg:output-b",
      outputName: "型紙SVG",
      format: "svg",
      payload: { version: 1, kind: "svg" }
    });

    expect(mocks.rustProcesses).toHaveLength(0);
    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewExportResult",
      requestId: 5,
      status: "cancelled"
    });
  });

  it("does not write when the document changes while the save dialog is open", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({
      type: "outputPreviewExportAvailability",
      documentVersion: document.version,
      outputKey: "print:output-a",
      format: "pdf"
    });
    let resolveDialog!: (value: unknown) => void;
    mocks.showSaveDialog.mockImplementation(() => new Promise((resolve) => { resolveDialog = resolve; }));
    const exportRequest = messageHandlerFor(panel)({
      type: "outputPreviewExportRequest",
      requestId: 6,
      documentVersion: document.version,
      outputKey: "print:output-a",
      outputName: "A",
      format: "pdf",
      payload: { version: 1, kind: "print" }
    });

    document.version += 1;
    document.setSourceText("nui 1\n// changed\n");
    emitDocumentChange(document);
    resolveDialog({ scheme: "file", fsPath: "/tmp/stale.pdf", toString: () => "file:///tmp/stale.pdf" });
    await exportRequest;

    expect(mocks.rustProcesses).toHaveLength(0);
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Output Preview changed while the save dialog was open. Export again."
    );
  });

  it("fails closed for stale Output Preview source-navigation requests", async () => {
    setup();
    const panel = openOutputPreviewPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({
      type: "outputPreviewSourceNavigation",
      documentVersion: document.version - 1,
      range: { from: 0, to: 4 }
    });

    expect(mocks.showTextDocument).not.toHaveBeenCalled();
  });

  it("routes a current Output Preview place commit through one native WorkspaceEdit", async () => {
    const source = "nui 1\nvalue: 10\n";
    const document = documentFor("/tmp/place.nui", "file:///tmp/place.nui", source);
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openOutputPreviewPanelFor(editor);
    const valueStart = source.indexOf("10");
    mocks.applyEdit.mockResolvedValue(true);

    await messageHandlerFor(panel)({
      type: "outputPreviewPlaceCommit",
      documentVersion: document.version,
      normalizedSourceSnapshot: source,
      statementRange: { from: source.indexOf("value:"), to: source.length - 1 },
      patches: [{
        range: { from: valueStart, to: valueStart + 2 },
        expectedText: "10",
        replacement: "20"
      }]
    });

    expect(mocks.applyEdit).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceEdits).toHaveLength(1);
    expect(mocks.workspaceEdits[0]?.replacements).toHaveLength(1);
    expect(mocks.workspaceEdits[0]?.replacements[0]).toMatchObject({
      uri: document.uri,
      replacement: "20"
    });
  });

  it("disposes all matching sessions when the source document closes", () => {
    setup();
    const canvas = openPanelFor();
    const preview = openOutputPreviewPanelFor();

    emitDocumentClose(mocks.activeTextEditor!.document);

    expect(canvas.dispose).toHaveBeenCalledTimes(1);
    expect(preview.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not create a panel during normal startup, then uses the command path", () => {
    setup();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.openCanvas", expect.any(Function));
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("uses the production canvas view type and a unique document title", () => {
    const document = documentFor("/tmp/front.nui", "file:///tmp/front.nui");
    setup(false, editorFor(document));
    const panel = openPanelFor();

    expect(mocks.createWebviewPanel.mock.calls[0]?.[0]).toBe("nuinuiCAD.canvas");
    expect(panel.title).toBe("front.nui — nuinuiCAD");
  });

  it("publishes evaluated string image paths from the host snapshot rather than a Webview evaluation request", async () => {
    const sourceText = 'nui 1\nconst Path: string = "./bound.png"\nimage Ref = image(source: Path, origin: (0, 0))';
    setup(false, editorFor(documentFor("/tmp/front.nui", "file:///tmp/front.nui", sourceText)));
    const panel = openPanelFor();
    panel.webview.asWebviewUri = (uri) => `https://file.vscode-resource.test${new URL(String(uri)).pathname}`;
    await messageHandlerFor(panel)({ type: "rustEvaluationRequest", id: 0, input: { forgedImagePath: "/private/outside.png" } });
    const process = mocks.rustProcesses[0]!;
    const compiled = createLanguageAnalysisSession(sourceText).runtimeEvaluationSnapshot()!.compiled;
    process.request.mockResolvedValue(evaluationResultToPayload(evaluateElementsReference(compiled.document.elements,
      buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }))));
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument", sourceText, documentVersion: 1,
      imageResources: { "./bound.png": "https://file.vscode-resource.test/tmp/bound.png" }
    })));
    expect(process.request).toHaveBeenCalledTimes(2);
    expect(process.request.mock.calls[1]?.[0]).not.toHaveProperty("forgedImagePath");
    expect(panel.webview.options.localResourceRoots?.map(String)).toEqual(["extension/dist", "file:///tmp"]);
  });

  it("publishes document-relative image resources and authorizes their Webview origin", async () => {
    const sourceText = 'nui 1\nimage Ref = image(source: "./reference.png", origin: (0, 0))';
    setup(false, editorFor(documentFor("/tmp/front.nui", "file:///tmp/front.nui", sourceText)));
    const panel = openPanelFor();
    panel.webview.asWebviewUri = (uri) => `https://file.vscode-resource.test${new URL(String(uri)).pathname}`;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      sourceText,
      imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" }
    }));
    expect(panel.webview.html).toContain("img-src csp blob: data:;");
    expect(panel.webview.html).toContain("default-src 'none';");
    expect(panel.webview.html).toMatch(/script-src 'nonce-[^']+';/);
    expect(panel.webview.html).not.toContain("'unsafe-inline'");
    expect(panel.webview.options.localResourceRoots?.map(String)).toEqual(["extension/dist", "file:///tmp"]);

    const document = mocks.activeTextEditor!.document;
    document.version = 2;
    document.setSourceText(sourceText + "\nimage Broken = image(");
    emitDocumentChange(document);
    const latestText = () => panel.webview.postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message.type === "commitText").at(-1);
    expect(latestText()).toMatchObject({ documentVersion: 2, imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" } });
    document.version = 3;
    document.setSourceText(sourceText.replace("reference.png", "next.webp"));
    emitDocumentChange(document);
    expect(latestText()).toMatchObject({ documentVersion: 3, imageResources: { "./next.webp": "https://file.vscode-resource.test/tmp/next.webp" } });
    expect(latestText().imageResources).not.toHaveProperty("./reference.png");
    document.version = 4;
    document.setSourceText(sourceText);
    emitDocumentChange(document, 1);
    expect(latestText()).toMatchObject({ documentVersion: 4, reason: "undo", imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" } });
    await messageHandlerFor(panel)({ type: "canvasImageResources", sourcePaths: ["/etc/private.png"], documentVersion: 4 });
    expect(panel.webview.options.localResourceRoots?.map(String)).toEqual(["extension/dist", "file:///tmp"]);
  });

  it("#1654 cold-opens and reopens an imported-instance Canvas through graph-owned image authority", async () => {
    const document = documentFor("/tmp/front_import_instance.nui", "file:///tmp/front_import_instance.nui", issue1654CaseCSource);
    const editor = editorFor(document);
    const snapshot = await issue1654GraphSnapshotFor(document);
    const authorityCheck = vi.fn(async () => true);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      languageSemanticSnapshotFor: vi.fn(async () => snapshot),
      isCanvasGraphCommitAuthorityCurrent: authorityCheck
    };
    setup(false, editor);

    const assertPublishedRootImage = async (panel: TestPanel) => {
      panel.webview.asWebviewUri = (uri) => `https://file.vscode-resource.test${new URL(String(uri)).pathname}`;
      await messageHandlerFor(panel)({ type: "webviewReady" });
      await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "replaceTextDocument",
        sourceText: issue1654CaseCSource,
        documentVersion: 1,
        imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" }
      })));
      expect(panel.webview.options.localResourceRoots?.map(String)).toEqual(["extension/dist", "file:///tmp"]);
      const publications = panel.webview.postMessage.mock.calls.map(([message]) => message)
        .filter((message) => message.type === "replaceTextDocument");
      expect(publications[0]?.imageResources ?? {}).toEqual({});
      expect(canvasImageSourceUrl("./reference.png", publications.at(-1)?.imageResources ?? {}))
        .toBe("https://file.vscode-resource.test/tmp/reference.png");
    };

    const firstPanel = openPanelFor(editor);
    await assertPublishedRootImage(firstPanel);
    expect(authorityCheck).toHaveBeenCalledWith(document, {
      rootDocumentId: snapshot.rootDocumentId,
      graphRevision: snapshot.graphRevision
    });

    firstPanel.dispose();
    const reopenedPanel = openPanelFor(editor);
    await assertPublishedRootImage(reopenedPanel);
  });

  it("#1654 keeps graph-owned image grants through same-panel edits, Undo and Redo", async () => {
    const document = documentFor("/tmp/front_import_instance.nui", "file:///tmp/front_import_instance.nui", issue1654CaseCSource);
    const editor = editorFor(document);
    let snapshot = await issue1654GraphSnapshotFor(document);
    const authorityCheck = vi.fn(async () => true);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: document.version, rootGeneration: document.version })),
      onDiagnosticsChanged: vi.fn(),
      languageSemanticSnapshotFor: vi.fn(async () => snapshot),
      isCanvasGraphCommitAuthorityCurrent: authorityCheck
    };
    setup(false, editor);
    const panel = openPanelFor(editor);
    panel.webview.asWebviewUri = (uri) => `https://file.vscode-resource.test${new URL(String(uri)).pathname}`;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      documentVersion: 1,
      imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" }
    })));

    document.version = 2;
    document.setSourceText(issue1654CaseC2Source);
    emitDocumentChange(document);
    const commitFor = (version: number) => panel.webview.postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message.type === "commitText" && message.documentVersion === version).at(-1);
    expect(commitFor(2)).toMatchObject({
      reason: "edit",
      imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" }
    });

    document.version = 3;
    document.setSourceText(issue1654CaseCSource);
    snapshot = await issue1654GraphSnapshotFor(document, issue1654CaseCSource, 3, 43);
    emitDocumentChange(document, 2);
    expect(commitFor(3)).toMatchObject({
      reason: "redo",
      imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" }
    });
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      documentVersion: 3,
      imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" }
    })));

    document.version = 4;
    document.setSourceText(issue1654CaseC2Source);
    emitDocumentChange(document, 1);
    expect(commitFor(4)).toMatchObject({
      reason: "undo",
      imageResources: { "./reference.png": "https://file.vscode-resource.test/tmp/reference.png" }
    });
    expect(authorityCheck).toHaveBeenCalledWith(document, {
      rootDocumentId: snapshot.rootDocumentId,
      graphRevision: snapshot.graphRevision
    });
  });

  it("#1654 rejects stale graph completions after source edits, dependency invalidation and invalid graphs", async () => {
    const document = documentFor("/tmp/front_import_instance.nui", "file:///tmp/front_import_instance.nui", issue1654CaseCSource);
    const editor = editorFor(document);
    const staleSnapshot = await issue1654GraphSnapshotFor(document, issue1654CaseCSource, 1, 51);
    let resolveStale!: (snapshot: Awaited<ReturnType<typeof issue1654GraphSnapshotFor>>) => void;
    const pendingStale = new Promise<Awaited<ReturnType<typeof issue1654GraphSnapshotFor>>>((resolve) => {
      resolveStale = resolve;
    });
    let currentSnapshot: Awaited<ReturnType<typeof issue1654GraphSnapshotFor>> | null = null;
    const authorityCheck = vi.fn(async () => false);
    const semanticSnapshotFor = vi.fn()
      .mockReturnValueOnce(pendingStale)
      .mockImplementationOnce(async () => currentSnapshot)
      .mockResolvedValueOnce(null);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: document.version, rootGeneration: document.version })),
      onDiagnosticsChanged: vi.fn(),
      languageSemanticSnapshotFor: semanticSnapshotFor,
      isCanvasGraphCommitAuthorityCurrent: authorityCheck
    };
    setup(false, editor);
    const panel = openPanelFor(editor);
    panel.webview.asWebviewUri = (uri) => `https://file.vscode-resource.test${new URL(String(uri)).pathname}`;
    await messageHandlerFor(panel)({ type: "webviewReady" });

    const editedSource = issue1654CaseC2Source.replace("./reference.png", "./edited.png");
    document.version = 2;
    document.setSourceText(editedSource);
    emitDocumentChange(document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 2,
      imageResources: { "./edited.png": "https://file.vscode-resource.test/tmp/edited.png" }
    }));

    resolveStale(staleSnapshot);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authorityCheck).not.toHaveBeenCalled();
    expect(panel.webview.postMessage.mock.calls.map(([message]) => message).some((message) =>
      message.type === "replaceTextDocument" && message.documentVersion === 1 &&
      message.imageResources?.["./reference.png"] !== undefined
    )).toBe(false);

    document.version = 3;
    document.setSourceText(issue1654CaseCSource);
    currentSnapshot = await issue1654GraphSnapshotFor(document, issue1654CaseCSource, 3, 53);
    emitDocumentChange(document);
    await vi.waitFor(() => expect(authorityCheck).toHaveBeenCalledWith(document, {
      rootDocumentId: currentSnapshot!.rootDocumentId,
      graphRevision: currentSnapshot!.graphRevision
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 3,
      imageResources: { "./edited.png": "https://file.vscode-resource.test/tmp/edited.png" }
    }));
    expect(panel.webview.postMessage.mock.calls.map(([message]) => message).some((message) =>
      message.type === "replaceTextDocument" && message.documentVersion === 3 &&
      message.imageResources?.["./reference.png"] !== undefined
    )).toBe(false);

    document.version = 4;
    document.setSourceText(issue1654CaseCSource);
    emitDocumentChange(document);
    await vi.waitFor(() => expect(semanticSnapshotFor).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authorityCheck).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 4,
      imageResources: { "./edited.png": "https://file.vscode-resource.test/tmp/edited.png" }
    }));
  });

  it("#1654 does not publish an outstanding graph grant after panel close and document switch", async () => {
    const document = documentFor("/tmp/front_import_instance.nui", "file:///tmp/front_import_instance.nui", issue1654CaseCSource);
    const editor = editorFor(document);
    const snapshot = await issue1654GraphSnapshotFor(document);
    let resolveSnapshot!: (value: typeof snapshot) => void;
    const pendingSnapshot = new Promise<typeof snapshot>((resolve) => { resolveSnapshot = resolve; });
    const authorityCheck = vi.fn(async () => true);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      languageSemanticSnapshotFor: vi.fn(async () => pendingSnapshot),
      isCanvasGraphCommitAuthorityCurrent: authorityCheck
    };
    setup(false, editor);
    const closedPanel = openPanelFor(editor);
    closedPanel.webview.asWebviewUri = (uri) => `https://file.vscode-resource.test${new URL(String(uri)).pathname}`;
    await messageHandlerFor(closedPanel)({ type: "webviewReady" });
    const closedPanelMessageCount = closedPanel.webview.postMessage.mock.calls.length;
    closedPanel.dispose();

    const otherSource = 'nui 1\nimage Other = image(source: "./other.png", origin: (0, 0))';
    const otherDocument = documentFor("/tmp/other.nui", "file:///tmp/other.nui", otherSource);
    const otherPanel = openPanelFor(editorFor(otherDocument));
    otherPanel.webview.asWebviewUri = (uri) => `https://file.vscode-resource.test${new URL(String(uri)).pathname}`;
    await messageHandlerFor(otherPanel)({ type: "webviewReady" });
    const otherPanelMessages = otherPanel.webview.postMessage.mock.calls.map(([message]) => message);
    expect(otherPanelMessages).toContainEqual(expect.objectContaining({
      type: "replaceTextDocument",
      sourceText: otherSource,
      imageResources: { "./other.png": "https://file.vscode-resource.test/tmp/other.png" }
    }));

    resolveSnapshot(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closedPanel.webview.postMessage.mock.calls).toHaveLength(closedPanelMessageCount);
    expect(otherPanel.webview.postMessage.mock.calls.map(([message]) => message).some((message) =>
      message.sourceText === issue1654CaseCSource || message.imageResources?.["./reference.png"] !== undefined
    )).toBe(false);
    expect(authorityCheck).not.toHaveBeenCalled();
  });

  it("marks the Canvas Webview body with its host-specific layout class", () => {
    setup();
    const panel = openPanelFor();

    expect(panel.webview.html).toContain('<body class="vscode-canvas-webview">');
    expect(panel.webview.html).toContain('<html lang="en" data-nuinui-surface="canvas">');
  });

  it("attaches the production Canvas Webview to the shared editable-focus owner", () => {
    const attachment = disposable();
    const webviewEditableFocusContext = {
      attach: vi.fn(() => ({ ...attachment, setHostFocused: vi.fn() })),
      dispose: vi.fn()
    } satisfies WebviewEditableFocusContext;
    setup(false, editorFor(), undefined, webviewEditableFocusContext);
    const panel = openPanelFor();

    expect(webviewEditableFocusContext.attach).toHaveBeenCalledWith(panel.webview);
    panel.dispose();
    expect(attachment.dispose).toHaveBeenCalledTimes(1);
  });

  it("reuses and reveals the existing panel when the same document command runs twice", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputText(mocks.activeTextEditor!.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(2);
  });

  it("routes Canvas command palette commands to the active Canvas webview", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    for (const command of [
      "nuinuiCAD.clearCanvasSelection",
      "nuinuiCAD.selectParentGroup",
      "nuinuiCAD.selectInstance",
      "nuinuiCAD.resetCanvasView",
      "nuinuiCAD.fitDrawing",
      "nuinuiCAD.toggleCanvasPointNames",
      "nuinuiCAD.toggleCanvasGeometryNames",
      "nuinuiCAD.toggleCanvasDirectionArrows",
      "nuinuiCAD.toggleCanvasElementNames",
      "nuinuiCAD.toggleCanvasPoints",
      "nuinuiCAD.duplicateAsSnapshot"
    ]) {
      commandHandlerFor(command)?.();
    }

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "clearCanvasSelection" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "selectParentGroup" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "selectInstance" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "resetCanvasView" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "fitDrawing" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasPointNames" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasGeometryNames" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasDirectionArrows" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasElementNames" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "toggleCanvasPoints" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "duplicateAsSnapshot" });
  });

  it("accepts the direct Canvas TabInputWebview representation", () => {
    setup();
    const panel = openPanelFor();

    commandHandlerFor("nuinuiCAD.clearCanvasSelection")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommand",
      commandId: "clearCanvasSelection"
    });
  });

  it("routes Bake Current Shape from a dynamic Canvas tab to Canvas", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["current", "nuinuiCAD.bakeCurrentShape"],
    ["base", "nuinuiCAD.bakeBaseShape"]
  ] as const)("completes a cold-start Source Bake %s after one readiness cycle", async (mode, command) => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "point Derived = between(",
      "  start: A,",
      "  end: B,",
      "  ratio: 0.25,",
      ")"
    ].join("\n");
    const document = documentFor("/tmp/cold-start-bake.nui", "file:///tmp/cold-start-bake.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("Derived"));
    setup(false, editor, [document]);

    commandHandlerFor(command)?.();

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
    const panel = mocks.panels[0]!;
    expect(panel.reveal).toHaveBeenCalledWith(2, true);
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "bakeSourceRequest")).toHaveLength(0);

    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "bakeSourceRequest")).toHaveLength(0);

    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    const requestsAfterReadiness = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "bakeSourceRequest");
    expect(requestsAfterReadiness).toHaveLength(1);
    expect(requestsAfterReadiness[0]).toMatchObject({
      type: "bakeSourceRequest",
      documentVersion: document.version,
      normalizedSourceOffset: source.indexOf("Derived"),
      mode
    });

    panel.active = false;
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    commandHandlerFor(command)?.();

    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "bakeSourceRequest")).toHaveLength(1);
  });

  it("drops a cold-start Source Bake when the Canvas document becomes stale before readiness", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const document = documentFor("/tmp/stale-cold-start-bake.nui", "file:///tmp/stale-cold-start-bake.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("A"));
    setup(false, editor, [document]);

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();
    const panel = mocks.panels[0]!;
    document.version = 2;
    document.setSourceText(`${source}\n// newer authoritative text`);
    emitDocumentChange(document);

    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });

    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "bakeSourceRequest")).toHaveLength(0);
  });

  it("routes Go to Source Definition from a dynamic Canvas tab to Canvas", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasSourceDefinitionRequest"
    }));
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("resolves the Canvas context command through a dynamic Canvas tab", () => {
    setup();
    const panel = openPanelFor();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    // The webview/context contribution invokes this same registered command.
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasSourceDefinitionRequest"
    }));
  });

  it("resolves all Bake settings in the Extension Host before Canvas routing", () => {
    mocks.bakeSettings = {
      "nuinuiCAD.bake.emitSkippedComments": false,
      "nuinuiCAD.bake.includeHiddenGeometry": true,
      "nuinuiCAD.bake.includeDisabledGeometry": true
    };
    setup();
    const panel = openPanelFor();

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommand",
      commandId: "bakeCurrentShape",
      emitSkippedComments: false,
      includeHiddenGeometry: true,
      includeDisabledGeometry: true
    });
  });

  it.each([
    ["current", "nuinuiCAD.bakeCurrentShape"],
    ["base", "nuinuiCAD.bakeBaseShape"]
  ] as const)("routes active Module Preview Bake %s with the existing settings", (mode, command) => {
    mocks.bakeSettings = {
      "nuinuiCAD.bake.emitSkippedComments": false,
      "nuinuiCAD.bake.includeHiddenGeometry": true,
      "nuinuiCAD.bake.includeDisabledGeometry": true
    };
    setup();
    const canvasPanel = openPanelFor();
    canvasPanel.active = false;
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.modulePreview");
    const fallback = vi.fn(() => true);
    const registration = registerModulePreviewBakeFallback(fallback);

    commandHandlerFor(command)?.();

    expect(fallback).toHaveBeenCalledWith(mode, {
      emitSkippedComments: false,
      includeHiddenGeometry: true,
      includeDisabledGeometry: true
    });
    expect(canvasPanel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommand" }));
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    registration.dispose();
  });

  it("keeps active normal Canvas Bake precedence ahead of Module Preview fallback", () => {
    setup();
    const canvasPanel = openPanelFor();
    const fallback = vi.fn(() => true);
    const registration = registerModulePreviewBakeFallback(fallback);

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(fallback).not.toHaveBeenCalled();
    expect(canvasPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    registration.dispose();
  });

  it("keeps Bake routed to the last active Canvas while the Command Palette owns focus", () => {
    setup();
    const sourceEditor = mocks.activeTextEditor!;
    const panel = openPanelFor(sourceEditor);
    const viewStateHandler = (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler;
    viewStateHandler();
    panel.canvasSelection = "NormalArc";

    mocks.activeTextEditor = sourceEditor;
    mocks.visibleTextEditors = [sourceEditor];
    panel.active = false;
    viewStateHandler();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "bakeSourceRequest"
    }));
    expect(panel.canvasSelection).toBe("NormalArc");
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("routes Bake through Source after switching from Canvas while the Canvas remains visible", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "point Derived = between(",
      "  start: A,",
      "  end: B,",
      "  ratio: 0.25,",
      ")"
    ].join("\n");
    const document = documentFor("/tmp/routing.nui", "file:///tmp/routing.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("Derived"));
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    panel.active = false;
    panel.canvasSelection = "NormalArc";
    mocks.activeTabInput = new mocks.TabInputText(document.uri);

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "bakeSourceRequest",
      normalizedSourceOffset: source.indexOf("Derived")
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(panel.canvasSelection).toBe("NormalArc");
  });

  it("routes Case K through Source when Palette focus leaves a stale Canvas tab input", async () => {
    const source = [
      "nui 1",
      "style Guide {",
      "  visible: true,",
      "}",
      "module Reusable() {",
      "  point P0 = coordinate(x: 0, y: 0)",
      "  point P1 = coordinate(x: 100, y: 0)",
      "  export line PublicEdge [Guide] = segment(",
      "    start: P0,",
      "    end: P1,",
      "  )",
      "}",
      "instance InstanceOne = Reusable()"
    ].join("\n");
    const document = documentFor("/tmp/case-k.nui", "file:///tmp/case-k.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("start: P0"));
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    panel.canvasSelection = "InstanceOne::PublicEdge";
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    panel.active = true;
    mocks.activeTextEditor = editor;
    mocks.visibleTextEditors = [editor];
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    emitActiveEditorChange(editor);
    panel.active = false;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");

    commandHandlerFor("nuinuiCAD.bakeCurrentShape")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "bakeSourceRequest"
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommand",
      commandId: "bakeCurrentShape"
    }));
    expect(document.getText()).toBe(source);
  });

  it("routes Canvas Undo/Redo to the active Canvas webview", () => {
    setup();
    const panel = openPanelFor();

    commandHandlerFor("nuinuiCAD.canvasUndo")?.();
    commandHandlerFor("nuinuiCAD.canvasRedo")?.();

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "undo" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "redo" });
  });

  it.each(["undo", "redo"] as const)(
    "falls back to the active Module Preview for Canvas %s when no Canvas history session owns it",
    (direction) => {
      setup();
      const panel = openPanelFor();
      panel.active = false;
      mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.modulePreview");
      const fallback = vi.fn(() => true);
      const registration = registerModulePreviewHistoryFallback(fallback);

      commandHandlerFor(direction === "undo" ? "nuinuiCAD.canvasUndo" : "nuinuiCAD.canvasRedo")?.();

      expect(fallback).toHaveBeenCalledWith(direction);
      expect(mocks.showErrorMessage).not.toHaveBeenCalled();
      expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommand" }));
      registration.dispose();
    }
  );

  it("keeps active Canvas history routing ahead of the Module Preview fallback", () => {
    setup();
    const panel = openPanelFor();
    const fallback = vi.fn(() => true);
    const registration = registerModulePreviewHistoryFallback(fallback);

    commandHandlerFor("nuinuiCAD.canvasUndo")?.();

    expect(fallback).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "undo" });
    registration.dispose();
  });

  it.each(["undo", "redo"] as const)("uses the requested Canvas history direction when the native change has no explicit reason (%s)", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "setContext") return;
      expect(command).toBe(direction);
      document.version = 2;
      document.setSourceText(`nui 1\n// native ${direction}\n`);
      emitDocumentChange(document);
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      preserveFocus: false,
      preview: false
    }));
    expect(mocks.executeCommand).toHaveBeenCalledWith(direction);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 2,
      reason: direction
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction,
      status: "completed",
      documentVersion: 2
    });
    expect(panel.reveal).toHaveBeenCalledWith(2, false);
  });

  it.each(["undo", "redo"] as const)("waits for a delayed native Canvas %s change event before completing history", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "setContext") return;
      expect(command).toBe(direction);
      document.version = 2;
      document.setSourceText(`nui 1\n// native ${direction}\n`);
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasHistoryResult" }));
    expect(panel.reveal).not.toHaveBeenCalled();

    emitDocumentChange(document);

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasHistoryResult" }));
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      documentVersion: 2,
      reason: direction
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction,
      status: "completed",
      documentVersion: 2
    });
    expect(panel.reveal).toHaveBeenCalledWith(2, false);
  });

  it("completes changed Canvas history before releasing a deferred free-point invocation", async () => {
    const document = documentFor("/tmp/history-free-point.nui", "file:///tmp/history-free-point.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });
    const modeRun = await coordinatePointCreationStartFor(panel);
    await acceptCoordinatePointCreationStart(panel, modeRun);
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "setContext") return;
      if (command === "undo") {
        document.version = 2;
        document.setSourceText("nui 1\n// undone\n");
        emitDocumentChange(document);
      }
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasHistoryResult" }));

    panel.webview.postMessage.mockClear();
    await messageHandlerFor(panel)({
      type: "canvasCoordinatePointCreationClick",
      modeRunId: modeRun.requestId,
      documentVersion: 2,
      pointer: { x: 24, y: -13 }
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer"
    }));

    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    const messages = panel.webview.postMessage.mock.calls.map(([message]) => message);
    const historyResultIndex = messages.findIndex((message) => message?.type === "canvasHistoryResult");
    const freePointIndex = messages.findIndex((message) => message?.type === "canvasFreePointAtPointer");
    expect(historyResultIndex).toBeGreaterThanOrEqual(0);
    expect(freePointIndex).toBeGreaterThan(historyResultIndex);
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
  });

  it.each(["undo", "redo"] as const)("treats native Canvas %s with no document version change as a completed no-op", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockResolvedValue(editor);

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });

    expect(mocks.executeCommand).toHaveBeenCalledWith(direction);
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument" }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction,
      status: "completed",
      documentVersion: 1
    });
    expect(panel.reveal).toHaveBeenCalledWith(2, false);
  });

  it("restores the Canvas panel when native history fails after source focus is transferred", async () => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    panel.reveal.mockImplementation(() => {
      panel.active = true;
    });
    mocks.executeCommand.mockImplementation(async (command: string) => {
      if (command === "setContext") return;
      throw new Error("native history failed");
    });

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(mocks.executeCommand).not.toHaveBeenCalledWith("setContext", "nuinuiCAD.canvasHistoryHandoff", false);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument" }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction: "undo",
      status: "failed",
      documentVersion: 1
    });

    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      false
    ));
  });

  it("resyncs and never executes native history for a stale Canvas document version", async () => {
    setup();
    const panel = openPanelFor();

    await messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "redo",
      expectedDocumentVersion: 99
    });

    expect(
      mocks.executeCommand.mock.calls.filter(([command]) => command !== "setContext")
    ).toHaveLength(0);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      documentVersion: 1
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryResult",
      direction: "redo",
      status: "resynced",
      documentVersion: 1
    });
  });

  it("fails safely when no Canvas webview is active", () => {
    setup();
    const panel = openPanelFor();
    panel.active = false;

    commandHandlerFor("nuinuiCAD.fitDrawing")?.();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: No active Canvas is available. Open Canvas and try again."
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommand" }));
  });

  it.each(["undo", "redo"] as const)("routes a second Canvas %s through the handoff session while native history is in flight", async (direction) => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    let resolveNativeHistory!: () => void;
    const nativeHistory = new Promise<void>((resolve) => {
      resolveNativeHistory = resolve;
    });
    const historyCommand = direction === "undo" ? "nuinuiCAD.canvasUndo" : "nuinuiCAD.canvasRedo";
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    panel.reveal.mockImplementation(() => {
      panel.active = true;
    });
    mocks.executeCommand.mockImplementation((command: string) => {
      if (command === "setContext") return Promise.resolve();
      if (command === direction) return nativeHistory;
      return Promise.resolve();
    });

    const firstRequest = messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction,
      expectedDocumentVersion: 1
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(direction));

    const setContextTrueCall = mocks.executeCommand.mock.calls.find(([command, key, enabled]) =>
      command === "setContext" && key === "nuinuiCAD.canvasHistoryHandoff" && enabled === true
    );
    expect(setContextTrueCall).toBeDefined();
    const setContextTrueCallIndex = mocks.executeCommand.mock.calls.indexOf(setContextTrueCall!);
    expect(mocks.executeCommand.mock.invocationCallOrder[setContextTrueCallIndex]).toBeLessThan(mocks.showTextDocument.mock.invocationCallOrder[0]!);

    commandHandlerFor(historyCommand)?.();

    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: direction });

    mocks.showErrorMessage.mockClear();
    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.fitDrawing")?.();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: No active Canvas is available. Open Canvas and try again."
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommand" }));

    resolveNativeHistory();
    await firstRequest;

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(mocks.executeCommand).not.toHaveBeenCalledWith("setContext", "nuinuiCAD.canvasHistoryHandoff", false);

    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      false
    ));
  });

  it("clears the Canvas history handoff context when its session is disposed", async () => {
    const document = documentFor("/tmp/history.nui", "file:///tmp/history.nui");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    let resolveNativeHistory!: () => void;
    const nativeHistory = new Promise<void>((resolve) => {
      resolveNativeHistory = resolve;
    });
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    mocks.executeCommand.mockImplementation((command: string) => {
      if (command === "setContext") return Promise.resolve();
      if (command === "undo") return nativeHistory;
      return Promise.resolve();
    });

    const firstRequest = messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      true
    ));

    (panel.dispose as unknown as () => void)();
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      false
    ));

    resolveNativeHistory();
    await firstRequest;
  });

  it.each(["nuinuiCAD.canvasUndo", "nuinuiCAD.canvasRedo"])("rejects %s when no Canvas is active and no history handoff exists", (command) => {
    setup();
    const panel = openPanelFor();
    panel.active = false;

    commandHandlerFor(command)?.();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: No active Canvas is available. Open Canvas and try again."
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommand" }));
  });

  it("keeps two document sessions independent", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    expect(panelA.title).toBe("a.nui — nuinuiCAD");
    expect(panelB.title).toBe("b.nui — nuinuiCAD");

    documentA.version = 2;
    documentA.setSourceText("nui 1\nA changed\n");
    emitDocumentChange(documentA);

    expect(mocks.panels).toHaveLength(2);
    expect(panelA.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
    expect(panelB.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
  });

  it("invalidates every open Canvas and Output Preview session when the active VS Code theme changes", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;
    commandHandlerFor("nuinuiCAD.openOutputPreview")?.();
    const outputPreviewPanel = mocks.panels[2]!;

    expect(mocks.activeColorThemeListeners).toHaveLength(1);
    mocks.activeColorThemeListeners[0]!();

    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });
    expect(outputPreviewPanel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });
    expect(panelA.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(panelB.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(outputPreviewPanel.webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it("adds directory context to all sessions when basenames collide", () => {
    const documentA = documentFor("/workspace/patterns/front.nui", "file:///workspace/patterns/front.nui");
    const documentB = documentFor("/workspace/archive/front.nui", "file:///workspace/archive/front.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    mocks.asRelativePath.mockImplementation((uri: { toString: () => string }) =>
      uri.toString().replace("file:///workspace/", "")
    );
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    expect(panelA.title).toBe("patterns/front.nui — nuinuiCAD");
    expect(panelB.title).toBe("archive/front.nui — nuinuiCAD");
    expect(mocks.asRelativePath).toHaveBeenCalledWith(documentA.uri, true);
    expect(mocks.asRelativePath).toHaveBeenCalledWith(documentB.uri, true);
  });

  it("returns the remaining session to its basename title after a collision is disposed", () => {
    const documentA = documentFor("/workspace/patterns/front.nui", "file:///workspace/patterns/front.nui");
    const documentB = documentFor("/workspace/archive/front.nui", "file:///workspace/archive/front.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    mocks.asRelativePath.mockImplementation((uri: { toString: () => string }) =>
      uri.toString().replace("file:///workspace/", "")
    );
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    (panelA.dispose as unknown as () => void)();

    expect(panelB.title).toBe("front.nui — nuinuiCAD");
  });

  it("disposing panel A leaves panel B alive and syncing its document", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    (panelA.dispose as unknown as () => void)();
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentB.version = 2;
    documentB.setSourceText("nui 1\n// panel B change\n");
    emitDocumentChange(documentB);

    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "commitText",
      sourceText: "nui 1\n// panel B change\n",
      documentVersion: 2
    }));
  });

  it("panel disposal does not dispose the shared Rust process used by another panel", async () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    await messageHandlerFor(panelA)({ type: "rustEvaluationRequest", id: 1, input: { request: "first" } });
    expect(mocks.rustProcesses).toHaveLength(1);
    const sharedProcess = mocks.rustProcesses[0]!;

    (panelA.dispose as unknown as () => void)();
    expect(sharedProcess.dispose).not.toHaveBeenCalled();

    await messageHandlerFor(panelB)({ type: "rustEvaluationRequest", id: 2, input: { request: "second" } });
    expect(mocks.rustProcesses).toHaveLength(1);
    expect(sharedProcess.request).toHaveBeenCalledTimes(2);
    expect(sharedProcess.dispose).not.toHaveBeenCalled();
  });

  it("auto-starts once when benchmark config exists and an active .nui editor becomes ready", () => {
    setup(true, null);

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    mocks.activeTextEditor = editorFor();
    mocks.visibleTextEditors = [mocks.activeTextEditor];
    mocks.textDocuments = [mocks.activeTextEditor.document];
    emitActiveEditorChange(mocks.activeTextEditor);
    emitActiveEditorChange(mocks.activeTextEditor);
    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps benchmark lifecycle behavior without document sync or canvas edits", async () => {
    setup(true);
    const panel = mocks.panels[0]!;
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\n// webview change\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
    // Diagnostics, Explorer, Reference Pick, Geometry Reference Retarget,
    // Source Value Step, and the Canvas pointer-creation feature each observe
    // document changes without mutating the benchmark Source document.
    expect(mocks.onDidChangeTextDocument).toHaveBeenCalledTimes(6);
    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
  });

  it("hydrates from the current authoritative document and ignores unrelated changes", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "replaceTextDocument",
      documentVersion: 1,
      hostDocumentUri: String(canonicalVscodeDocumentId(document.uri))
    }));

    document.version = 2;
    document.setSourceText("nui 1\n// changed\n");
    emitDocumentChange(document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });

  it("replays a retained graph after the current Canvas acknowledges authoritative Source", async () => {
    const document = documentFor(
      "/tmp/cold-graph-replay.nui",
      "file:///tmp/cold-graph-replay.nui",
      "nui 1\n"
    );
    const editor = editorFor(document);
    const publication = {
      type: "multiDocumentGraphPublication" as const,
      documentVersion: document.version,
      status: "building" as const,
      graph: null
    };
    publishVscodeMultiDocumentGraphPublication(document.uri.toString(), publication);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);

    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });

    const messages = panel.webview.postMessage.mock.calls.map(([message]) => message);
    const replaceTextIndex = messages.findIndex((message) => message?.type === "replaceTextDocument");
    const publicationIndexes = messages
      .map((message, index) => message?.type === publication.type &&
        message.documentVersion === publication.documentVersion &&
        message.status === publication.status ? index : -1)
      .filter((index) => index >= 0);
    expect(publicationIndexes).toHaveLength(2);
    expect(publicationIndexes[1]).toBeGreaterThan(replaceTextIndex);
    expect(messages.filter((message) => message?.type === publication.type).every((message) =>
      message.hostDocumentUri === String(canonicalVscodeDocumentId(document.uri))
    )).toBe(true);
  });

  it("rejects a racing graph-backed Canvas commit without overwriting the Host Source", async () => {
    const source = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const document = documentFor("/tmp/canvas-commit-race.nui", "file:///tmp/canvas-commit-race.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    const hostDocumentUri = String(canonicalVscodeDocumentId(document.uri));
    const racedSource = `${source}\n// host race`;
    await handler({
      type: "canvasCommit",
      sourceText: "nui 1\npoint Root = coordinate(x: 99, y: 0)",
      expectedDocumentVersion: 1,
      hostDocumentUri: "file:///different/root.nui",
      mutationKind: "reset",
      operationId: -2
    });
    expect(document.getText()).toBe(source);
    expect(editor.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: -2,
      status: "rejected",
      documentVersion: 1
    });
    panel.webview.postMessage.mockClear();
    editor.edit.mockImplementationOnce(async () => {
      document.version = 2;
      document.setSourceText(racedSource);
      emitDocumentChange(document);
      return false;
    });

    await handler({
      type: "canvasCommit",
      sourceText: "nui 1\npoint Root = coordinate(x: 20, y: 0)",
      expectedDocumentVersion: 1,
      hostDocumentUri,
      mutationKind: "reset",
      operationId: -1
    });

    expect(document.getText()).toBe(racedSource);
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: -1,
      status: "rejected",
      documentVersion: 2
    });
  });

  it("rejects a prepared graph-backed coordinate-point insertion after imported dependency authority invalidates", async () => {
    const source = [
      "nui 1",
      'import "./library.nui" as lib',
      "point Root = coordinate(x: 0, y: 0)",
      "instance S = lib::Sample()"
    ].join("\n");
    const document = documentFor("/tmp/canvas-dependency-race.nui", "file:///tmp/canvas-dependency-race.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    const authority = { rootDocumentId: String(canonicalVscodeDocumentId(document.uri)), graphRevision: 43 };
    const authorityCheck = vi.fn(async () => false);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(),
      onDiagnosticsChanged: vi.fn(),
      isCanvasGraphCommitAuthorityCurrent: authorityCheck
    };

    await handler({
      type: "canvasCommit",
      sourceText: `${source}\npoint = coordinate(\n  x: 24,\n  y: 0,\n)`,
      expectedDocumentVersion: 1,
      hostDocumentUri: String(canonicalVscodeDocumentId(document.uri)),
      graphAuthority: authority,
      mutationKind: "model-patch",
      splices: [{
        startLine: 5,
        endLine: 4,
        replacementLines: ["point = coordinate(", "  x: 24,", "  y: 0,", ")"]
      }],
      operationId: -43
    });

    expect(authorityCheck).toHaveBeenCalledWith(document, authority);
    expect(document.getText()).toBe(source);
    expect(editor.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: -43,
      status: "rejected",
      documentVersion: 1
    });
  });

  it("commits a graph-backed coordinate-point insertion while imported dependency authority is current", async () => {
    const source = [
      "nui 1",
      'import "./library.nui" as lib',
      "point Root = coordinate(x: 0, y: 0)",
      "instance S = lib::Sample()"
    ].join("\n");
    const document = documentFor("/tmp/canvas-current-insertion.nui", "file:///tmp/canvas-current-insertion.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    const authority = { rootDocumentId: String(canonicalVscodeDocumentId(document.uri)), graphRevision: 44 };
    const authorityCheck = vi.fn(async () => true);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(),
      onDiagnosticsChanged: vi.fn(),
      isCanvasGraphCommitAuthorityCurrent: authorityCheck
    };
    const replacementLines = ["point = coordinate(", "  x: 24,", "  y: 0,", ")"];

    await handler({
      type: "canvasCommit",
      sourceText: `${source}\n${replacementLines.join("\n")}`,
      expectedDocumentVersion: 1,
      hostDocumentUri: String(canonicalVscodeDocumentId(document.uri)),
      graphAuthority: authority,
      mutationKind: "model-patch",
      splices: [{ startLine: 5, endLine: 4, replacementLines }],
      operationId: -44
    });

    expect(authorityCheck).toHaveBeenCalledWith(document, authority);
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(editor.editBuilder.replace).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: -44,
      status: "accepted",
      documentVersion: 1
    });
  });

  it("does not replay a retained graph for a stale or non-current Canvas acknowledgement", async () => {
    const document = documentFor(
      "/tmp/stale-cold-graph-replay.nui",
      "file:///tmp/stale-cold-graph-replay.nui",
      "nui 1\n"
    );
    const editor = editorFor(document);
    const publication = {
      type: "multiDocumentGraphPublication" as const,
      documentVersion: document.version,
      status: "building" as const,
      graph: null
    };
    publishVscodeMultiDocumentGraphPublication(document.uri.toString(), publication);
    setup(false, editor, [document]);
    const firstPanel = openPanelFor(editor);
    const firstHandler = messageHandlerFor(firstPanel);
    await firstHandler({ type: "webviewReady" });

    document.version = 2;
    firstPanel.webview.postMessage.mockClear();
    await firstHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    expect(firstPanel.webview.postMessage).not.toHaveBeenCalledWith(publication);

    document.version = 1;
    firstPanel.dispose();
    const secondPanel = openPanelFor(editor);
    const secondHandler = messageHandlerFor(secondPanel);
    await secondHandler({ type: "webviewReady" });
    secondPanel.webview.postMessage.mockClear();
    firstPanel.webview.postMessage.mockClear();

    await firstHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    expect(firstPanel.webview.postMessage).not.toHaveBeenCalledWith(publication);
    expect(secondPanel.webview.postMessage).not.toHaveBeenCalledWith(publication);
  });

  it("retains an immediate Canvas free-point invocation until the changed document is authoritative again", async () => {
    const document = documentFor("/tmp/free-point-sync.nui", "file:///tmp/free-point-sync.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });
    await messageHandlerFor(panel)({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 12, y: -8 }
    });

    const modeRunId = await coordinatePointCreationClick(panel, 1, { x: 12, y: -8 });
    const firstRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasFreePointAtPointer") as {
        requestId: number;
      } | undefined;
    expect(firstRequest).toBeDefined();

    const committedSource = "nui 1\n// free point\n";
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(committedSource);
      emitDocumentChange(document);
      return true;
    });
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: committedSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: firstRequest!.requestId
    });
    await messageHandlerFor(panel)({
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequest!.requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 1, character: "// free point".length }
    });

    panel.webview.postMessage.mockClear();
    await coordinatePointCreationClickOnly(panel, 2, { x: 91, y: -37 }, modeRunId);
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer"
    }));

    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer",
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 2, line: 1, character: "// free point".length }
    }));
  });

  it("projects coordinate-point availability from current Canvas authority without a Source anchor", async () => {
    const document = documentFor("/tmp/free-point-availability.nui", "file:///tmp/free-point-availability.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);

    await handler({ type: "webviewReady" });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(false);

    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(true);

    // No Webview pointer or Source selection event is sent: active Canvas tab state owns availability.
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(true);

    panel.active = false;
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    emitPanelViewState(panel);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(false);

    for (const viewType of ["nuinuiCAD.outputPreview", "other.webview"]) {
      mocks.activeTabInput = new mocks.TabInputWebview(viewType);
      emitPanelViewState(panel);
      expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(false);
    }

    panel.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
    emitPanelViewState(panel);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(true);

    document.version = 2;
    emitDocumentChange(document);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(false);

    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(true);
    panel.dispose();
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationAvailable")).toBe(false);
  });

  it("projects active Canvas tab context independently of Webview interior focus", () => {
    setup();
    const panel = openPanelFor();

    expect(latestContextValueFor("nuinuiCAD.activeCanvasTab")).toBe(false);
    emitTabsChange();
    expect(latestContextValueFor("nuinuiCAD.activeCanvasTab")).toBe(true);

    mocks.activeTabInput = new mocks.TabInputText(mocks.activeTextEditor!.document.uri);
    emitTabsChange();
    expect(latestContextValueFor("nuinuiCAD.activeCanvasTab")).toBe(false);

    for (const viewType of [
      "nuinuiCAD.outputPreview",
      "nuinuiCAD.modulePreview",
      "unrelated.webview"
    ]) {
      mocks.activeTabInput = new mocks.TabInputWebview(viewType);
      emitTabsChange();
      expect(latestContextValueFor("nuinuiCAD.activeCanvasTab")).toBe(false);
    }

    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");
    emitTabsChange();
    expect(latestContextValueFor("nuinuiCAD.activeCanvasTab")).toBe(true);
    panel.dispose();
    expect(latestContextValueFor("nuinuiCAD.activeCanvasTab")).toBe(false);
  });

  it("starts, finishes, and re-enters coordinate-point mode without a Source anchor", async () => {
    const document = documentFor("/tmp/free-point-reentry.nui", "file:///tmp/free-point-reentry.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const startMessages = () => panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message): message is {
        type: "canvasCoordinatePointCreationStart";
        requestId: number;
        documentVersion: number;
      } => message?.type === "canvasCoordinatePointCreationStart");
    const requestStart = async () => {
      await commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
      return startMessages().at(-1);
    };

    const first = await requestStart();
    expect(first).toBeDefined();
    await handler({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: first!.requestId,
      documentVersion: first!.documentVersion
    });
    await handler({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: first!.requestId,
      documentVersion: first!.documentVersion,
      status: "started"
    });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);
    const startCountBeforeDuplicate = panel.webview.postMessage.mock.calls
      .filter(([message]) => message?.type === "canvasCoordinatePointCreationStart").length;
    await commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
    expect(panel.webview.postMessage.mock.calls
      .filter(([message]) => message?.type === "canvasCoordinatePointCreationStart")).toHaveLength(startCountBeforeDuplicate);

    await handler({
      type: "canvasCoordinatePointCreationState",
      active: false,
      modeRunId: first!.requestId,
      documentVersion: 1
    });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);
    const second = await requestStart();
    expect(second).toBeDefined();
    expect(second!.requestId).not.toBe(first!.requestId);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("clears the matching coordinate-point mode when its OFF arrives with an old document version", async () => {
    const document = documentFor("/tmp/free-point-stale-off.nui", "file:///tmp/free-point-stale-off.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    await commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
    const starts = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasCoordinatePointCreationStart") as Array<{
        type: "canvasCoordinatePointCreationStart";
        requestId: number;
        documentVersion: number;
      }>;
    const firstRun = starts.at(-1);
    expect(firstRun).toBeDefined();
    await handler({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: firstRun!.requestId,
      documentVersion: firstRun!.documentVersion
    });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);
    await handler({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: firstRun!.requestId,
      documentVersion: firstRun!.documentVersion,
      status: "started"
    });

    document.version = firstRun!.documentVersion + 1;
    document.setSourceText("nui 1\n// changed while coordinate-point mode was active\n");
    emitDocumentChange(document);
    await handler({
      type: "canvasCoordinatePointCreationState",
      active: false,
      modeRunId: firstRun!.requestId,
      documentVersion: firstRun!.documentVersion
    });

    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
    const nextRun = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasCoordinatePointCreationStart")
      .at(-1) as { requestId: number; documentVersion: number } | undefined;
    expect(nextRun).toBeDefined();
    expect(nextRun!.requestId).not.toBe(firstRun!.requestId);
    expect(nextRun!.documentVersion).toBe(document.version);
  });

  it("ignores stale ON and OFF from a completed coordinate-point mode run", async () => {
    const document = documentFor("/tmp/free-point-mode-run-fence.nui", "file:///tmp/free-point-mode-run-fence.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const runA = await coordinatePointCreationStartFor(panel);
    await acceptCoordinatePointCreationStart(panel, runA);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);
    await finishCoordinatePointCreationRun(panel, runA.requestId, runA.documentVersion);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);

    await handler({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: runA.requestId,
      documentVersion: runA.documentVersion
    });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);

    const runB = await coordinatePointCreationStartFor(panel);
    expect(runB.requestId).not.toBe(runA.requestId);
    await acceptCoordinatePointCreationStart(panel, runB);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);

    await handler({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: runA.requestId,
      documentVersion: runA.documentVersion
    });
    await finishCoordinatePointCreationRun(panel, runA.requestId, runA.documentVersion);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);
    await finishCoordinatePointCreationRun(panel, runB.requestId, runB.documentVersion);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);
  });

  it("clears coordinate-point mode membership on Webview reinitialization", async () => {
    const document = documentFor("/tmp/free-point-webview-reinit.nui", "file:///tmp/free-point-webview-reinit.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const oldRun = await coordinatePointCreationStartFor(panel);
    await acceptCoordinatePointCreationStart(panel, oldRun);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);

    await handler({ type: "webviewReady" });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);
    await finishCoordinatePointCreationRun(panel, oldRun.requestId, oldRun.documentVersion);
    await handler({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: oldRun.requestId,
      documentVersion: oldRun.documentVersion
    });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);

    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const newRun = await coordinatePointCreationStartFor(panel);
    expect(newRun.requestId).not.toBe(oldRun.requestId);
    await acceptCoordinatePointCreationStart(panel, newRun);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);
  });

  it("ignores mode messages from a disposed Canvas session after its replacement starts", async () => {
    const document = documentFor("/tmp/free-point-replaced-session.nui", "file:///tmp/free-point-replaced-session.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const oldPanel = openPanelFor(editor);
    const oldHandler = messageHandlerFor(oldPanel);
    await oldHandler({ type: "webviewReady" });
    await oldHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const oldRun = await coordinatePointCreationStartFor(oldPanel);
    await acceptCoordinatePointCreationStart(oldPanel, oldRun);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);

    oldPanel.dispose();
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);
    const replacementPanel = openPanelFor(editor);
    const replacementHandler = messageHandlerFor(replacementPanel);
    await replacementHandler({ type: "webviewReady" });
    await replacementHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    const replacementRun = await coordinatePointCreationStartFor(replacementPanel);
    expect(replacementRun.requestId).not.toBe(oldRun.requestId);
    await acceptCoordinatePointCreationStart(replacementPanel, replacementRun);

    await oldHandler({
      type: "canvasCoordinatePointCreationState",
      active: false,
      modeRunId: oldRun.requestId,
      documentVersion: oldRun.documentVersion
    });
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(true);
    await finishCoordinatePointCreationRun(replacementPanel, replacementRun.requestId, 1);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);
  });

  it("fences an ended mode from queuing another point after Host OFF", async () => {
    const document = documentFor("/tmp/free-point-ended-queue.nui", "file:///tmp/free-point-ended-queue.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });
    const modeRunId = await coordinatePointCreationClick(panel, 1, { x: 12, y: -8 });
    const firstRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasFreePointAtPointer") as { requestId: number } | undefined;
    expect(firstRequest).toBeDefined();

    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText("nui 1\n// first click\n");
      emitDocumentChange(document);
      return true;
    });
    await handler({
      type: "canvasCommit",
      sourceText: "nui 1\n// first click\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: firstRequest!.requestId
    });

    await coordinatePointCreationClickOnly(panel, 2, { x: 91, y: -37 }, modeRunId);
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasFreePointAtPointer")).toHaveLength(1);
    await finishCoordinatePointCreationRun(panel, modeRunId, 2);
    expect(latestContextValueFor("nuinuiCAD.canvasCoordinatePointCreationActive")).toBe(false);

    await handler({
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequest!.requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 1, character: "// first click".length }
    });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasFreePointAtPointer")).toHaveLength(1);
  });

  it("shows a rejected stale-version coordinate-creation start for the same current Host session", async () => {
    const document = documentFor("/tmp/free-point-stale-start.nui", "file:///tmp/free-point-stale-start.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();
    const start = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasCoordinatePointCreationStart");
    expect(start).toMatchObject({
      type: "canvasCoordinatePointCreationStart",
      documentVersion: 1,
      hostDocumentUri: String(canonicalVscodeDocumentId(document.uri))
    });

    document.version = 2;
    document.setSourceText("nui 1\n// changed before start acknowledgement\n");
    emitDocumentChange(document);
    mocks.showErrorMessage.mockClear();
    await handler({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: start!.requestId,
      documentVersion: 1,
      status: "rejected",
      errorMessage: "Coordinate point creation was rejected because the Source version is stale."
    });

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "Coordinate point creation was rejected because the Source version is stale."
    );
    expect(document.getText()).toBe("nui 1\n// changed before start acknowledgement\n");
  });

  it("clears ignored coordinate-creation requests, retries after modal exit, and ignores acknowledgements from before Webview reinitialization", async () => {
    const document = documentFor("/tmp/free-point-ignored-start.nui", "file:///tmp/free-point-ignored-start.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });

    const startMessages = () => panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message): message is {
        type: "canvasCoordinatePointCreationStart";
        requestId: number;
        documentVersion: number;
      } => message?.type === "canvasCoordinatePointCreationStart");
    const requestStart = () => commandHandlerFor("nuinuiCAD.createFreePointAtPointer")?.();

    requestStart();
    const first = startMessages()[0];
    expect(first).toBeDefined();
    requestStart();
    expect(startMessages()).toHaveLength(1);

    mocks.showErrorMessage.mockClear();
    await handler({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: first!.requestId,
      documentVersion: first!.documentVersion,
      status: "ignored"
    });
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();

    await handler({
      type: "canvasCoordinatePointCreationState",
      active: false,
      modeRunId: first!.requestId,
      documentVersion: 1
    });
    requestStart();
    const second = startMessages()[1];
    expect(second).toBeDefined();
    expect(second!.requestId).not.toBe(first!.requestId);

    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });
    requestStart();
    const third = startMessages()[2];
    expect(third).toBeDefined();
    expect(third!.requestId).not.toBe(second!.requestId);

    await handler({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: second!.requestId,
      documentVersion: second!.documentVersion,
      status: "ignored"
    });
    requestStart();
    expect(startMessages()).toHaveLength(3);

    await handler({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: third!.requestId,
      documentVersion: third!.documentVersion,
      status: "ignored"
    });
    requestStart();
    expect(startMessages()).toHaveLength(4);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("serializes Canvas free-point invocations through the authoritative session boundary", async () => {
    const document = documentFor("/tmp/free-point-queue.nui", "file:///tmp/free-point-queue.nui", "nui 1\n");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    for (const listener of mocks.selectionChangeListeners) listener({ textEditor: editor, kind: 1 });

    await handler({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 12, y: -8 }
    });
    const modeRunId = await coordinatePointCreationClick(panel, 1, { x: 12, y: -8 });

    const freePointMessages = (): Array<{
      requestId: number;
      documentVersion: number;
      pointer: { x: number; y: number };
      sourcePosition: { documentVersion: number; line: number; character: number };
    }> => panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message): message is {
        type: "canvasFreePointAtPointer";
        requestId: number;
        documentVersion: number;
        pointer: { x: number; y: number };
        sourcePosition: { documentVersion: number; line: number; character: number };
      } => message?.type === "canvasFreePointAtPointer");
    expect(freePointMessages()).toHaveLength(1);
    const firstRequest = freePointMessages()[0]!;
    expect(firstRequest.pointer).toEqual({ x: 12, y: -8 });

    const committedSource = "nui 1\n// free point A\n";
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(committedSource);
      emitDocumentChange(document);
      return true;
    });
    await handler({
      type: "canvasCommit",
      sourceText: committedSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: firstRequest.requestId
    });

    mocks.showErrorMessage.mockClear();
    await coordinatePointCreationClickOnly(panel, 2, { x: 91, y: -37 }, modeRunId);
    expect(freePointMessages()).toHaveLength(1);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();

    await handler({
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequest.requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: { line: 1, character: "// free point A".length }
    });

    panel.webview.postMessage.mockClear();
    expect(freePointMessages()).toHaveLength(0);
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });

    expect(freePointMessages()).toHaveLength(1);
    expect(freePointMessages()[0]).toMatchObject({
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 2, line: 1, character: "// free point A".length }
    });
  });

  it("creates two consecutive free points from the real H3 Source anchor across native edits", async () => {
    const document = documentFor("/tmp/free-point-consecutive.nui", "file:///tmp/free-point-consecutive.nui", h3Source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const sourceDefinitionStart = h3Source.indexOf("Guide");
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const sourceDefinitionRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as {
        requestId: number;
      } | undefined;
    expect(sourceDefinitionRequest).toBeDefined();
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      mocks.activeTextEditor = editor;
      return editor;
    });
    await handler({
      type: "canvasSourceDefinitionResult",
      requestId: sourceDefinitionRequest!.requestId,
      documentVersion: 1,
      range: { from: sourceDefinitionStart, to: sourceDefinitionStart + "Guide".length }
    });
    panel.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");

    await handler({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 12, y: -8 }
    });
    const modeRunId = await coordinatePointCreationClick(panel, 1, { x: 12, y: -8 });
    const firstRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasFreePointAtPointer") as {
        requestId: number;
        documentVersion: number;
        pointer: { x: number; y: number };
        sourcePosition: { documentVersion: number; line: number; character: number };
      } | undefined;
    expect(firstRequest).toMatchObject({
      documentVersion: 1,
      pointer: { x: 12, y: -8 },
      sourcePosition: { documentVersion: 1, line: 3, character: "line ".length }
    });

    const firstSource = [
      h3Source,
      "point = coordinate(",
      "  x: 12,",
      "  y: -8,",
      ")"
    ].join("\n");
    const firstSourcePosition = document.positionAt(firstSource.indexOf("point = coordinate("));
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(firstSource);
      emitDocumentChange(document);
      return true;
    });
    await handler({
      type: "canvasCommit",
      sourceText: firstSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: firstRequest!.requestId
    });

    await coordinatePointCreationClickOnly(panel, 2, { x: 91, y: -37 }, modeRunId);
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasFreePointAtPointer")).toHaveLength(1);

    await handler({
      type: "canvasFreePointAtPointerResult",
      requestId: firstRequest!.requestId,
      status: "applied",
      documentVersion: 2,
      nextSourcePosition: firstSourcePosition
    });

    panel.webview.postMessage.mockClear();
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    const secondRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasFreePointAtPointer") as {
        requestId: number;
        documentVersion: number;
        pointer: { x: number; y: number };
        sourcePosition: { documentVersion: number; line: number; character: number };
      } | undefined;
    expect(secondRequest).toMatchObject({
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: { documentVersion: 2, line: firstSourcePosition.line, character: firstSourcePosition.character }
    });

    const secondSource = [
      firstSource,
      "point = coordinate(",
      "  x: 91,",
      "  y: -37,",
      ")"
    ].join("\n");
    const secondSourcePosition = document.positionAt(secondSource.indexOf("point = coordinate(", firstSource.length));
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 3;
      document.setSourceText(secondSource);
      emitDocumentChange(document);
      return true;
    });
    await handler({
      type: "canvasCommit",
      sourceText: secondSource,
      expectedDocumentVersion: 2,
      mutationKind: "reset",
      operationId: secondRequest!.requestId
    });
    await handler({
      type: "canvasFreePointAtPointerResult",
      requestId: secondRequest!.requestId,
      status: "applied",
      documentVersion: 3,
      nextSourcePosition: secondSourcePosition
    });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 3 });

    const pointDeclarations = document.getText().match(/^point(?: [A-Za-z_][A-Za-z0-9_]*)? = coordinate\(/gm) ?? [];
    expect(pointDeclarations).toHaveLength(4);
    expect(document.getText().indexOf("line Guide = segment(start: Left, end: Right)")).toBeLessThan(
      document.getText().indexOf("point = coordinate(\n  x: 12,\n  y: -8,\n)")
    );
    expect(document.getText().indexOf("point = coordinate(\n  x: 12,\n  y: -8,\n)")).toBeLessThan(
      document.getText().indexOf("point = coordinate(\n  x: 91,\n  y: -37,\n)")
    );
    expect(editor.edit).toHaveBeenCalledTimes(2);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("disposes only the matching panel when a document closes and creates a fresh session on reopen", async () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui");
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    emitDocumentClose(documentA);
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(panelB.dispose).not.toHaveBeenCalled();

    documentA.version = 4;
    documentA.setSourceText("nui 1\n// reopened\n");
    mocks.activeTextEditor = editorA;
    mocks.visibleTextEditors = [editorA];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorA.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const reopened = mocks.panels[2]!;
    await messageHandlerFor(reopened)({ type: "webviewReady" });
    expect(reopened).not.toBe(panelA);
    expect(reopened.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      imageResources: {},
      sourceText: "nui 1\n// reopened\n",
      documentVersion: 4,
      hostDocumentUri: String(canonicalVscodeDocumentId(documentA.uri))
    });
  });

  it("reopens a fresh panel after panel-only disposal and hydrates current document text and version", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panelA = openPanelFor(editor);

    (panelA.dispose as unknown as () => void)();
    editor.document.version = 6;
    editor.document.setSourceText("nui 1\n// panel reopened\n");
    const panelB = openPanelFor(editor);
    await messageHandlerFor(panelB)({ type: "webviewReady" });

    expect(mocks.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(panelB).not.toBe(panelA);
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      imageResources: {},
      sourceText: "nui 1\n// panel reopened\n",
      documentVersion: 6,
      hostDocumentUri: String(canonicalVscodeDocumentId(editor.document.uri))
    });
  });

  it("fails closed and resyncs when the expected document version is stale", async () => {
    setup();
    const panel = openPanelFor();
    const document = mocks.activeTextEditor!.document;
    document.version = 2;
    document.setSourceText("nui 1\n// authoritative\n");
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\n// stale\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(mocks.activeTextEditor!.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      imageResources: {},
      sourceText: "nui 1\n// authoritative\n",
      documentVersion: 2,
      hostDocumentUri: String(canonicalVscodeDocumentId(mocks.activeTextEditor!.document.uri))
    });
  });

  it("applies a valid model patch as one snapshot-coordinate edit transaction", async () => {
    const source = "nui 1\nA\nB\n";
    const document = documentFor("/tmp/pattern.nui", "file:///tmp/pattern.nui", source);
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\nA changed\nB\n",
      expectedDocumentVersion: 1,
      mutationKind: "model-patch",
      splices: [{ startLine: 2, endLine: 2, replacementLines: ["A changed"] }]
    });

    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(editor.edit).toHaveBeenCalledWith(expect.any(Function), { undoStopBefore: true, undoStopAfter: true });
    expect(editor.editBuilder.replace).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));
  });

  it("applies a guarded Canvas text insertion with one zero-length Host edit", async () => {
    const source = "nui 1\r\npoint A = coordinate(x: 0, y: 0)\r\npoint B = coordinate(x: 1, y: 1)";
    const document = documentFor("/tmp/canvas-text-insertion.nui", "file:///tmp/canvas-text-insertion.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    const offset = source.indexOf("point A") + "point A = coordinate(x: ".length;
    const insertedText = "\r\npoint = coordinate(\r\n  x: 12,\r\n  y: -4,\r\n)\r\n";
    const expectedSource = `${source.slice(0, offset)}${insertedText}${source.slice(offset)}`;

    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: expectedSource,
      expectedDocumentVersion: 1,
      hostDocumentUri: String(canonicalVscodeDocumentId(document.uri)),
      mutationKind: "text-insertion",
      textInsertion: { originalSourceText: source, offset, insertedText },
      operationId: -1664
    });

    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(editor.edit).toHaveBeenCalledWith(expect.any(Function), { undoStopBefore: true, undoStopAfter: true });
    expect(editor.editBuilder.insert).toHaveBeenCalledTimes(1);
    expect(editor.editBuilder.insert).toHaveBeenCalledWith(document.positionAt(offset), insertedText);
    expect(editor.editBuilder.replace).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: -1664,
      status: "accepted",
      documentVersion: 1
    });
  });

  it("revalidates Host text after awaiting graph authority for an exact insertion", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)\n";
    const document = documentFor("/tmp/canvas-text-insertion-race.nui", "file:///tmp/canvas-text-insertion-race.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    const hostDocumentUri = String(canonicalVscodeDocumentId(document.uri));
    const graphAuthority = { rootDocumentId: hostDocumentUri, graphRevision: 1664 };
    const racedSource = `${source}// changed while graph authority was checked`;
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(),
      onDiagnosticsChanged: vi.fn(),
      isCanvasGraphCommitAuthorityCurrent: vi.fn(async () => {
        document.version = 2;
        document.setSourceText(racedSource);
        emitDocumentChange(document);
        return true;
      })
    };
    const offset = source.indexOf("point A") + "point A".length;
    const insertedText = "\npoint = coordinate()\n";

    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: `${source.slice(0, offset)}${insertedText}${source.slice(offset)}`,
      expectedDocumentVersion: 1,
      hostDocumentUri,
      graphAuthority,
      mutationKind: "text-insertion",
      textInsertion: { originalSourceText: source, offset, insertedText },
      operationId: -1666
    });

    expect(document.getText()).toBe(racedSource);
    expect(editor.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: -1666,
      status: "rejected",
      documentVersion: 2
    });
  });

  it.each(["Host URI", "document version", "original Source", "resulting Source"]) (
    "rejects a Canvas text insertion with a mismatched %s",
    async (failure) => {
      const source = "nui 1\npoint A = coordinate(x: 0, y: 0)\n";
      const document = documentFor("/tmp/canvas-text-insertion-conflict.nui", "file:///tmp/canvas-text-insertion-conflict.nui", source);
      const editor = editorFor(document);
      setup(false, editor, [document]);
      const panel = openPanelFor(editor);
      await messageHandlerFor(panel)({ type: "webviewReady" });
      const hostDocumentUri = String(canonicalVscodeDocumentId(document.uri));
      const offset = source.indexOf("point A") + "point A".length;
      const insertedText = "\npoint = coordinate()\n";
      const originalSourceText = failure === "original Source" ? `${source}// host changed` : source;
      const resultingSourceText = `${originalSourceText.slice(0, offset)}${insertedText}${originalSourceText.slice(offset)}`;
      const message = {
        type: "canvasCommit" as const,
        sourceText: failure === "resulting Source" ? `${resultingSourceText}// mismatch` : resultingSourceText,
        expectedDocumentVersion: 1,
        hostDocumentUri: failure === "Host URI" ? "file:///tmp/foreign.nui" : hostDocumentUri,
        mutationKind: "text-insertion" as const,
        textInsertion: { originalSourceText, offset, insertedText },
        operationId: -1665
      };
      if (failure === "document version") document.version = 2;

      await messageHandlerFor(panel)(message);

      expect(editor.edit).not.toHaveBeenCalled();
      expect(document.getText()).toBe(source);
      expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "canvasCommitResult",
        operationId: -1665,
        status: "rejected"
      }));
    }
  );

  it("fails closed when a model patch source does not match its LineSplices", async () => {
    const document = documentFor("/tmp/pattern.nui", "file:///tmp/pattern.nui", "nui 1\nA\n");
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\nnot the patch result\n",
      expectedDocumentVersion: 1,
      mutationKind: "model-patch",
      splices: [{ startLine: 2, endLine: 2, replacementLines: ["A changed"] }]
    });

    expect(editor.edit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));
  });

  it("resyncs when TextEditor.edit returns false", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    editor.edit.mockImplementationOnce(async () => false);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\n// reset\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "replaceTextDocument", documentVersion: 1 }));
  });

  it("uses whole-document replacement only for reset mutations", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\n// reset\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(editor.editBuilder.replace).toHaveBeenCalledTimes(1);
  });

  it("uses the normal document change echo as the only successful commit acknowledgement", async () => {
    setup();
    const editor = mocks.activeTextEditor!;
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: "nui 1\n// committed\n",
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitText" }));

    editor.document.version = 2;
    editor.document.setSourceText("nui 1\n// committed\n");
    emitDocumentChange(editor.document);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "commitText", documentVersion: 2 }));
  });

  it("does not forward non-content TextDocument changes during a Canvas commit", async () => {
    const preDrag = "nui 1\n// pre-drag\n";
    const postDrag = "nui 1\n// post-drag\n";
    const document = documentFor("/tmp/drag.nui", "file:///tmp/drag.nui", preDrag);
    const editor = editorFor(document);
    setup(false, editor);
    const panel = openPanelFor(editor);
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      emitDocumentChange(document, undefined, []);
      document.version = 2;
      document.setSourceText(postDrag);
      emitDocumentChange(document, undefined, [{ text: postDrag }]);
      return true;
    });

    await messageHandlerFor(panel)({
      type: "canvasCommit",
      sourceText: postDrag,
      expectedDocumentVersion: 1,
      mutationKind: "reset"
    });

    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "commitText")).toEqual([
      [{
        type: "commitText",
        imageResources: {},
        sourceText: postDrag,
        documentVersion: 2,
        reason: "edit",
        hostDocumentUri: String(canonicalVscodeDocumentId(document.uri))
      }]
    ]);
  });

  it.each([
    ["nuinuiCAD.convertPointToXYOffset", "xy"],
    ["nuinuiCAD.convertPointToAngleDistanceOffset", "angle-distance"]
  ] as const)("starts native QuickPick conversion from the exact Explorer node for %s", async (command, mode) => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/explorer-conversion.nui", "file:///tmp/explorer-conversion.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string; baseKey?: string }[]) =>
      items.find((item) => item.kind === "base")
    );

    commandHandlerFor(command)?.({
      symbol: {
        name: "Target",
        detail: "point",
        kind: "object",
        range: {
          from: source.indexOf("point Target"),
          to: source.indexOf("point Target") + "point Target = coordinate(x: 10, y: 5)".length
        },
        selectionRange: {
          from: source.indexOf("Target"),
          to: source.indexOf("Target") + "Target".length
        },
        children: []
      }
    });

    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    expect(mocks.showQuickPick.mock.calls[0]?.[1]).toMatchObject({
      placeHolder: mode === "xy" ? "Select a shared base point for XY offset" : "Select a shared base point for angle-distance offset",
      matchOnDescription: true,
      matchOnDetail: true
    });
    expect(editor.edit).toHaveBeenCalledTimes(1);
  });

  it("refreshes Explorer conversion eligibility when the Source caret is ineligible", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)",
      "line Guide = segment(start: Base, end: Target)"
    ].join("\n");
    const document = documentFor("/tmp/explorer-conversion-context.nui", "file:///tmp/explorer-conversion-context.nui", source);
    const editor = editorFor(document);
    editor.selection = {
      anchor: { line: 0, character: 0 },
      active: { line: 0, character: 0 },
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 }
    };
    setup(false, editor, [document]);
    emitActiveEditorChange(editor);

    const treeHost = mocks.registerElementsTreeFeature.mock.calls[0]?.[0] as {
      treeItemContextValueFor?: (node: NuiElementsTreeNode) => string | undefined;
    };
    const treeNodeFor = (name: string, detail: string): NuiElementsTreeNode => {
      const from = source.indexOf(`${detail} ${name}`);
      return {
        symbol: {
          name,
          detail,
          kind: "object",
          range: { from, to: from + `${detail} ${name}`.length },
          selectionRange: { from, to: from + name.length },
          children: []
        }
      };
    };

    await vi.waitFor(() => expect(treeHost.treeItemContextValueFor?.(treeNodeFor("Target", "point"))).toBe(
      "nuinuiCAD.coordinatePointConversionTarget"
    ));
    expect(treeHost.treeItemContextValueFor?.(treeNodeFor("Guide", "line"))).toBeUndefined();
  });

  it.each([
    ["nuinuiCAD.convertPointToXYOffset", "xy"],
    ["nuinuiCAD.convertPointToAngleDistanceOffset", "angle-distance"]
  ] as const)("routes a Source editor resource argument to native QuickPick for %s", async (command, mode) => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/source-context-conversion.nui", "file:///tmp/source-context-conversion.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 2, character: source.split("\n")[2]!.indexOf("Target") };
    setup(false, editor, [document]);
    mocks.activeTabInput = new mocks.TabInputText(document.uri);
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string; baseKey?: string }[]) =>
      items.find((item) => item.kind === "base")
    );

    commandHandlerFor(command)?.(document.uri);

    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    expect(mocks.showQuickPick.mock.calls[0]?.[1]).toMatchObject({
      placeHolder: mode === "xy" ? "Select a shared base point for XY offset" : "Select a shared base point for angle-distance offset",
      matchOnDescription: true,
      matchOnDetail: true
    });
    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["nuinuiCAD.convertPointToXYOffset", "xy"],
    ["nuinuiCAD.convertPointToAngleDistanceOffset", "angle-distance"]
  ] as const)("uses native QuickPick for Canvas-origin conversion without changing routing for %s", async (command, mode) => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/canvas-context-conversion.nui", "file:///tmp/canvas-context-conversion.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    const extensionHostTargetId = elementIdFor(document, "Target");
    const canvasTargetId = "webview-target";
    expect(extensionHostTargetId).not.toBe(canvasTargetId);
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: [canvasTargetId],
      selectedElementSources: [{
        runtimeElementId: canvasTargetId,
        sourceStatementIndex: 2,
        elementType: "point"
      }]
    });
    expect(coordinatePointConversionCanvasTargetsFor(vscodeObservationState.cachedSnapshot().documents[0]?.canvas)).toEqual([{
      runtimeElementId: canvasTargetId,
      sourceStatementIndex: 2
    }]);
    expect(vscodeObservationState.cachedSnapshot().documents[0]?.activeSurface).toBe("canvas");
    expect(vscodeObservationState.cachedSnapshot().documents[0]?.canvas?.coordinatePointConversionTargetIds).toEqual([canvasTargetId]);
    panel.webview.postMessage.mockClear();
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string }[]) =>
      items.find((item) => item.kind === "base")
    );

    commandHandlerFor(command)?.();

    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(editor.edit).toHaveBeenCalledTimes(1));
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "coordinatePointConversionSelection",
      requestId: expect.any(Number),
      documentVersion: document.version,
      successfulTargetSourceStatementIndexes: [2]
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      mode,
      origin: "canvas"
    }));
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("cancels native conversion without mutating Source when QuickPick returns Esc", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-cancel.nui", "file:///tmp/conversion-cancel.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 2, character: source.split("\n")[2]!.indexOf("Target") };
    setup(false, editor, [document]);
    mocks.showQuickPick.mockResolvedValue(undefined);

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();
    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    expect(editor.edit).not.toHaveBeenCalled();
    expect(document.getText()).toBe(source);
  });

  it("represents every legal shared base with searchable canonical references and an explicit Canvas affordance", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "line Guide = segment(start: Base, end: (20, 0))",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-candidates.nui", "file:///tmp/conversion-candidates.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 3, character: source.split("\n")[3]!.indexOf("Target") };
    setup(false, editor, [document]);
    mocks.showQuickPick.mockResolvedValue(undefined);

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();

    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    const items = mocks.showQuickPick.mock.calls[0]?.[0] as Array<{ label: string; kind?: string; detail?: string }>;
    expect(items.find((item) => item.kind === "canvas")?.label).toContain("Canvas");
    expect(items.filter((item) => item.kind === "base").map((item) => item.label)).toEqual(
      expect.arrayContaining(["Base", "Guide.start", "Guide.end"])
    );
    expect(items.filter((item) => item.kind === "base").every((item) => item.detail?.includes(item.label))).toBe(true);
  });

  it.each([
    ["en", "nuinuiCAD: Could not apply coordinate-point conversion (revalidation failed ×1).", "Skipped target details", "Show Details"],
    ["ja", "nuinuiCAD: 座標点の変換を適用できませんでした (再検証に失敗 ×1)。", "スキップした対象の詳細", "詳細を表示"]
  ] as const)("uses host-localized native revalidation presentation when Source changes (%s)", async (language, notification, details, showDetails) => {
    mocks.displayLanguage = language;
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-stale.nui", "file:///tmp/conversion-stale.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 2, character: source.split("\n")[2]!.indexOf("Target") };
    setup(false, editor, [document]);
    let resolvePick: ((value: unknown) => void) | undefined;
    mocks.showQuickPick.mockImplementation(() => new Promise((resolve) => { resolvePick = resolve; }));

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();
    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    document.version = 2;
    document.setSourceText(`${source}\n// changed`);
    emitDocumentChange(document);
    const base = (mocks.showQuickPick.mock.calls[0]?.[0] as Array<{ kind?: string }>).find((item) => item.kind === "base");
    resolvePick?.(base);

    await vi.waitFor(() => expect(mocks.showErrorMessage).toHaveBeenCalledWith(notification, showDetails));
    const output = mocks.createOutputChannel.mock.results.at(-1)?.value as {
      appendLine: ReturnType<typeof vi.fn>;
    } | undefined;
    expect(output?.appendLine).toHaveBeenCalledWith(expect.stringContaining(details));
    expect(editor.edit).not.toHaveBeenCalled();
  });

  it("fails closed when Canvas-origin targets change before native apply", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-canvas-stale.nui", "file:///tmp/conversion-canvas-stale.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    const canvasTargetId = "webview-target";
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: [canvasTargetId],
      selectedElementSources: [{
        runtimeElementId: canvasTargetId,
        sourceStatementIndex: 2,
        elementType: "point"
      }]
    });
    let resolvePick: ((value: unknown) => void) | undefined;
    mocks.showQuickPick.mockImplementation(() => new Promise((resolve) => { resolvePick = resolve; }));

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();
    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: [canvasTargetId],
      selectedElementSources: [{
        runtimeElementId: canvasTargetId,
        sourceStatementIndex: 1,
        elementType: "point"
      }]
    });
    const base = (mocks.showQuickPick.mock.calls[0]?.[0] as Array<{ kind?: string }>).find((item) => item.kind === "base");
    resolvePick?.(base);

    await vi.waitFor(() => expect(mocks.showErrorMessage).toHaveBeenCalled());
    expect(editor.edit).not.toHaveBeenCalled();
  });

  it("fails closed when a Canvas conversion target has no ordinary Source owner", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-canvas-missing-source-owner.nui", "file:///tmp/conversion-canvas-missing-source-owner.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: ["webview-target"],
      selectedElementSources: []
    });

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();

    await Promise.resolve();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(editor.edit).not.toHaveBeenCalled();
  });

  it.each([
    ["ambiguous", [
      { runtimeElementId: "webview-target", sourceStatementIndex: 2, elementType: "point" },
      { runtimeElementId: "webview-target", sourceStatementIndex: 2, elementType: "point" }
    ]],
    ["Module", [{ runtimeElementId: "webview-target", runtimeKind: "moduleBody", sourceStatementPath: [2] }]]
  ] as const)("fails closed for %s Canvas Source ownership", (_label, selectedElementSources) => {
    expect(coordinatePointConversionCanvasTargetsFor({
      ...canvasObservationSnapshotFor(1),
      coordinatePointConversionTargetIds: ["webview-target"],
      selectedElementSources
    })).toEqual([]);
  });

  it("hands off Canvas-origin native QuickPick to Canvas with Canvas runtime target IDs", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-canvas-visual-pick.nui", "file:///tmp/conversion-canvas-visual-pick.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    const extensionHostTargetId = elementIdFor(document, "Target");
    const canvasTargetId = "webview-target";
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: [canvasTargetId],
      selectedElementSources: [{
        runtimeElementId: canvasTargetId,
        sourceStatementIndex: 2,
        elementType: "point"
      }]
    });
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string }[]) =>
      items.find((item) => item.kind === "canvas")
    );

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();

    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      mode: "xy",
      origin: "canvas",
      canvasBasePick: true,
      targetIds: [canvasTargetId]
    })));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      origin: "canvas",
      targetIds: [extensionHostTargetId]
    }));
  });

  it("hands off to the existing Canvas point-pick path only after the explicit native affordance", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-visual-pick.nui", "file:///tmp/conversion-visual-pick.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 2, character: source.split("\n")[2]!.indexOf("Target") };
    setup(false, editor, [document]);
    const targetId = elementIdFor(document, "Target");
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string }[]) =>
      items.find((item) => item.kind === "canvas")
    );

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();
    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    const panel = mocks.panels.at(-1)!;
    expect(panel.reveal).toHaveBeenCalled();
    const extensionMessageHandler = panel.webview.onDidReceiveMessage.mock.calls[0]?.[0] as (message: unknown) => Promise<void>;
    await extensionMessageHandler({ type: "webviewReady" });
    await extensionMessageHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await vi.waitFor(() => expect(panel.webview.onDidReceiveMessage).toHaveBeenCalledTimes(2));
    const conversionMessageHandler = panel.webview.onDidReceiveMessage.mock.calls.at(-1)?.[0] as (message: unknown) => Promise<void>;
    await conversionMessageHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      mode: "xy",
      origin: "source",
      canvasBasePick: true,
      targetIds: [targetId]
    })));
  });

  it("keeps the explicit Canvas conversion commit connected to one terminal result", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-lifecycle.nui", "file:///tmp/conversion-lifecycle.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 2, character: source.split("\n")[2]!.indexOf("Target") };
    setup(false, editor, [document]);
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string }[]) =>
      items.find((item) => item.kind === "canvas")
    );

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();
    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    const panel = mocks.panels.at(-1)!;
    await vi.waitFor(() => expect(panel.webview.onDidReceiveMessage).toHaveBeenCalledTimes(2));
    const extensionMessageHandler = panel.webview.onDidReceiveMessage.mock.calls[0]?.[0] as
      (message: unknown) => Promise<void>;
    await extensionMessageHandler({ type: "webviewReady" });
    await extensionMessageHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    const conversionMessageHandler = panel.webview.onDidReceiveMessage.mock.calls.at(-1)?.[0] as
      (message: unknown) => Promise<void>;
    await conversionMessageHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    const startRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "coordinatePointConversionStart") as {
        requestId: number;
        documentUri: string;
        targetIds: readonly string[];
      };
    expect(startRequest).toBeDefined();

    const committedSource = `${source}\n// converted\n`;
    editor.edit.mockImplementationOnce(async (callback: (builder: typeof editor.editBuilder) => void) => {
      callback(editor.editBuilder);
      document.version = 2;
      document.setSourceText(committedSource);
      emitDocumentChange(document);
      return true;
    });
    await extensionMessageHandler({
      type: "canvasCommit",
      sourceText: committedSource,
      expectedDocumentVersion: 1,
      mutationKind: "reset",
      operationId: 77,
      coordinatePointConversionRequestId: startRequest.requestId
    });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasCommitResult",
      operationId: 77,
      status: "accepted",
      documentVersion: 2
    });

    mocks.showTextDocument.mockClear();
    mocks.showInformationMessage.mockClear();
    const terminalResult = {
      type: "coordinatePointConversionResult" as const,
      requestId: startRequest.requestId,
      operationId: 77,
      documentUri: startRequest.documentUri,
      documentVersion: 2,
      origin: "source" as const,
      mode: "xy" as const,
      status: "applied" as const,
      classification: "all-success" as const,
      successfulTargetIds: startRequest.targetIds,
      successfulTargetCount: startRequest.targetIds.length,
      skippedTargets: [],
      skippedTargetCount: 0
    };
    await conversionMessageHandler(terminalResult);
    await conversionMessageHandler(terminalResult);

    expect(mocks.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
  });

  it("maps accepted Canvas visual-pick terminal successes to Source statement indexes in result order", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point First = coordinate(x: 10, y: 5)",
      "point Skipped = coordinate(x: 20, y: 5)",
      "point Last = coordinate(x: 30, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-canvas-visual-terminal.nui", "file:///tmp/conversion-canvas-visual-terminal.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: ["canvas-last", "canvas-skipped", "canvas-first"],
      selectedElementSources: [
        { runtimeElementId: "canvas-first", sourceStatementIndex: 2, elementType: "point" },
        { runtimeElementId: "canvas-skipped", sourceStatementIndex: 3, elementType: "point" },
        { runtimeElementId: "canvas-last", sourceStatementIndex: 4, elementType: "point" }
      ]
    });
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string }[]) =>
      items.find((item) => item.kind === "canvas")
    );

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();

    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      origin: "canvas",
      canvasBasePick: true,
      targetIds: ["canvas-last", "canvas-skipped", "canvas-first"]
    })));
    const startRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "coordinatePointConversionStart") as {
        requestId: number;
        documentUri: string;
      };
    const conversionMessageHandler = panel.webview.onDidReceiveMessage.mock.calls.at(-1)?.[0] as
      (message: unknown) => Promise<void>;
    panel.webview.postMessage.mockClear();

    await conversionMessageHandler({
      type: "coordinatePointConversionResult",
      requestId: startRequest.requestId,
      operationId: 77,
      documentUri: startRequest.documentUri,
      documentVersion: 2,
      origin: "canvas",
      mode: "xy",
      status: "applied",
      classification: "partial-success",
      successfulTargetIds: ["canvas-last", "canvas-first"],
      successfulTargetCount: 2,
      skippedTargets: [{
        targetId: "canvas-skipped",
        reason: { code: "target-not-eligible", message: "skipped" }
      }],
      skippedTargetCount: 1
    });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "coordinatePointConversionSelection",
      requestId: startRequest.requestId,
      documentVersion: 2,
      successfulTargetSourceStatementIndexes: [4, 2]
    });
  });

  it("keeps Canvas visual-pick terminal handling across Source-to-Canvas focus transfer", async () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point TargetA = coordinate(x: 10, y: 5)",
      "point TargetB = coordinate(x: 20, y: 5)"
    ].join("\n");
    const document = documentFor("/tmp/conversion-canvas-focus-transfer.nui", "file:///tmp/conversion-canvas-focus-transfer.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: ["canvas-target-a", "canvas-target-b"],
      selectedElementSources: [
        { runtimeElementId: "canvas-target-a", sourceStatementIndex: 2, elementType: "point" },
        { runtimeElementId: "canvas-target-b", sourceStatementIndex: 3, elementType: "point" }
      ]
    });
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string }[]) =>
      items.find((item) => item.kind === "canvas")
    );

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();

    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      origin: "canvas",
      canvasBasePick: true,
      targetIds: ["canvas-target-a", "canvas-target-b"]
    })));
    const startRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "coordinatePointConversionStart") as {
        requestId: number;
        documentUri: string;
      };
    const conversionMessageHandler = panel.webview.onDidReceiveMessage.mock.calls.at(-1)?.[0] as
      (message: unknown) => Promise<void>;
    panel.webview.postMessage.mockClear();
    mocks.showWarningMessage.mockClear();

    mocks.activeTextEditor = null;
    mocks.visibleTextEditors = [];
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
    emitActiveEditorChange(undefined);

    const terminalResult = {
      type: "coordinatePointConversionResult" as const,
      requestId: startRequest.requestId,
      operationId: 77,
      documentUri: startRequest.documentUri,
      documentVersion: document.version,
      origin: "canvas" as const,
      mode: "xy" as const,
      status: "applied" as const,
      classification: "partial-success" as const,
      successfulTargetIds: ["canvas-target-b"],
      successfulTargetCount: 1,
      skippedTargets: [{
        targetId: "canvas-target-a",
        reason: { code: "target-not-eligible", message: "skipped" }
      }],
      skippedTargetCount: 1
    };
    await conversionMessageHandler(terminalResult);
    await conversionMessageHandler(terminalResult);

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "coordinatePointConversionSelection",
      requestId: startRequest.requestId,
      documentVersion: document.version,
      successfulTargetSourceStatementIndexes: [3]
    });
    expect(mocks.showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", ["canvas-missing"]],
    ["duplicate", ["canvas-target", "canvas-target"]]
  ] as const)("fails closed for %s Canvas visual-pick terminal target mapping", (_label, successfulTargetIds) => {
    expect(canvasVisualPickSourceStatementIndexesFor([
      { runtimeElementId: "canvas-target", sourceStatementIndex: 2 },
      { runtimeElementId: "canvas-other", sourceStatementIndex: 3 }
    ], successfulTargetIds)).toBeNull();
  });

  it.each(["rejected", "noop"] as const)("does not post Canvas selection for a %s visual-pick result", async (status) => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const document = documentFor(`/tmp/conversion-canvas-visual-${status}.nui`, `file:///tmp/conversion-canvas-visual-${status}.nui`, source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    await publishCanvasObservation(panel, {
      ...canvasObservationSnapshotFor(document.version),
      coordinatePointConversionTargetIds: ["canvas-target"],
      selectedElementSources: [{ runtimeElementId: "canvas-target", sourceStatementIndex: 2, elementType: "point" }]
    });
    mocks.showQuickPick.mockImplementation(async (items: readonly { kind?: string }[]) =>
      items.find((item) => item.kind === "canvas")
    );

    commandHandlerFor("nuinuiCAD.convertPointToXYOffset")?.();
    await vi.waitFor(() => expect(mocks.showQuickPick).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionStart",
      origin: "canvas"
    })));
    const startRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "coordinatePointConversionStart") as {
        requestId: number;
        documentUri: string;
      };
    const conversionMessageHandler = panel.webview.onDidReceiveMessage.mock.calls.at(-1)?.[0] as
      (message: unknown) => Promise<void>;
    panel.webview.postMessage.mockClear();

    await conversionMessageHandler({
      type: "coordinatePointConversionResult",
      requestId: startRequest.requestId,
      operationId: 77,
      documentUri: startRequest.documentUri,
      documentVersion: 2,
      origin: "canvas",
      mode: "xy",
      status,
      classification: status === "noop" ? "all-skipped" : "all-success",
      successfulTargetIds: ["canvas-target"],
      successfulTargetCount: 1,
      skippedTargets: [],
      skippedTargetCount: 0
    });

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionSelection"
    }));
  });
});

describe("VS Code explicit Canvas navigation lifecycle", () => {
  const prepareExtractCanvasHost = async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/extract-host-navigation.nui", "file:///tmp/extract-host-navigation.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    const host = extractModuleHostFor();
    const endpoint = host.activeCanvasEndpoint();
    if (!endpoint) throw new Error("expected an active Canvas endpoint");
    return { document, editor, panel, host, endpoint };
  };

  it("classifies loss of Canvas command-active qualification as retryable", async () => {
    const { document, panel, host, endpoint } = await prepareExtractCanvasHost();
    mocks.activeTabInput = new mocks.TabInputText(document.uri);

    expect(host.navigateCanvasToSourceOffset(endpoint, 0)).toEqual({ accepted: false, retryable: true });

    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
    expect(host.navigateCanvasToSourceOffset(endpoint, 0)).toEqual({ accepted: true });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationRequest",
      requestId: expect.any(Number),
      normalizedSourceOffset: 0,
      documentVersion: document.version
    });
  });

  it("classifies Canvas history in flight as retryable", async () => {
    const { document, editor, panel, host, endpoint } = await prepareExtractCanvasHost();
    let resolveNativeHistory!: () => void;
    const nativeHistory = new Promise<void>((resolve) => {
      resolveNativeHistory = resolve;
    });
    mocks.showTextDocument.mockResolvedValue(editor);
    mocks.executeCommand.mockImplementation((command: string) =>
      command === "undo" ? nativeHistory : Promise.resolve()
    );
    const historyRequest = messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: document.version
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      true
    ));

    expect(host.navigateCanvasToSourceOffset(endpoint, 0)).toEqual({ accepted: false, retryable: true });

    resolveNativeHistory();
    await historyRequest;
  });

  it.each(["session", "panel", "open document"] as const)(
    "classifies an actual invalid Canvas %s condition as terminal",
    async (condition) => {
      const { panel, host, endpoint } = await prepareExtractCanvasHost();
      let invalidEndpoint = endpoint;
      if (condition === "session") {
        panel.dispose();
      } else if (condition === "panel") {
        invalidEndpoint = {
          ...(endpoint as Record<string, unknown>),
          panel: panelFor()
        };
      } else {
        mocks.textDocuments = [];
      }

      expect(host.navigateCanvasToSourceOffset(invalidEndpoint, 0)).toEqual({
        accepted: false,
        retryable: false
      });
    }
  );

  it("carries the exact graph-resolved Source target and revision for an imported caller", async () => {
    const librarySource = [
      "nui 1",
      "export module Panel(value: number) {",
      "  point P = coordinate(x: value, y: 0)",
      "}"
    ].join("\n");
    const source = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n");
    const document = documentFor("/tmp/imported-reveal.nui", "file:///tmp/imported-reveal.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("Direct"));
    const languageSession = createLanguageAnalysisSession(source);
    const root: RootCurrentSourceSnapshot = {
      kind: "root-current",
      documentId: documentIdFromHost(document.uri.toString()),
      normalizedSource: source,
      sourceRevision: languageSession.getSourceRevision()
    };
    const library: DependencySavedSourceSnapshot = {
      kind: "dependency-saved",
      documentId: documentIdFromHost("file:///tmp/library.nui"),
      savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:extension-reveal-library"),
      normalizedSource: librarySource
    };
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: {
        loadSavedDependency: async (importerDocumentId, importPath) =>
          importerDocumentId === root.documentId && importPath === "./library.nui"
            ? { status: "loaded", snapshot: library }
            : { status: "failed", reason: "missing" }
      },
      declarationContributors: [moduleDeclarationContributor]
    });
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    const moduleRuntimeContext = createModuleRuntimeContext(graph, analysis);
    const rootNode = graph.nodes.get(root.documentId);
    if (!rootNode) throw new Error("missing imported graph root");
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext
    });
    if (!graph.valid || !analysis.valid || !moduleRuntimeContext.valid || !compiled.moduleMaterialization) {
      throw new Error("missing genuine imported Module graph materialization");
    }
    const rootDirect = compiled.moduleMaterialization.executionStatements.find((entry) =>
      entry.type === "moduleInstance" &&
      entry.sourceStatementIndex === 2 &&
      String(entry.origin?.sourceDocumentId) === document.uri.toString()
    );
    const dependencyCollision = compiled.moduleMaterialization.executionStatements.find((entry) =>
      entry.sourceStatementIndex === 2 &&
      String(entry.origin?.sourceDocumentId) === "file:///tmp/library.nui"
    );
    expect(rootDirect).toBeDefined();
    expect(dependencyCollision).toBeDefined();
    expect(rootDirect!.runtimeElementId).not.toBe(dependencyCollision!.runtimeElementId);
    const semanticSnapshot = {
      documentVersion: document.version,
      rootDocumentId: document.uri.toString(),
      graphRevision: 41,
      sourceRevision: root.sourceRevision,
      sourceText: source,
      compiled
    };
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      languageSemanticSnapshotFor: vi.fn(async () => semanticSnapshot)
    };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasNavigationRequest",
      documentVersion: document.version,
      graphRevision: 41,
      sourceRevision: semanticSnapshot.sourceRevision,
      sourceTarget: { kind: "statement-owner", sourceStatementIndex: rootDirect!.sourceStatementIndex },
      runtimeProjection: { candidates: [rootDirect!.runtimeElementId] }
    })));
  });

  const prepareNavigation = async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/navigation-focus.nui", "file:///tmp/navigation-focus.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const navigationRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasNavigationRequest")
      .at(-1) as { requestId: number };
    return { document, panel, navigationRequest };
  };

  const focusMessagesFor = (panel: TestPanel) => panel.webview.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === "focusCanvas");

  it("does not open Canvas when the source cursor has no runtime target", () => {
    const source = "nui 1\n// comment only";
    const document = documentFor("/tmp/no-target.nui", "file:///tmp/no-target.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: 3 };
    setup(false, editor, [document]);

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("reports source analysis unavailable for a fatal exact-current source without opening Canvas", () => {
    const source = "nui 1\npoint Broken = coordinate(";
    const document = documentFor("/tmp/reveal-fatal.nui", "file:///tmp/reveal-fatal.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: 8 };
    setup(false, editor, [document]);

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "Reveal in Canvas is unavailable because source analysis is not ready."
    );
  });

  it("waits for authoritative Webview hydration and latest request wins", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/reveal.nui", "file:///tmp/reveal.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    setup(false, editor, [document]);

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const panel = mocks.panels[0]!;
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    expect(panel.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationRequest")).toHaveLength(0);

    await messageHandlerFor(panel)({ type: "webviewReady" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "replaceTextDocument",
      imageResources: {},
      sourceText: source,
      documentVersion: 1,
      hostDocumentUri: String(canonicalVscodeDocumentId(document.uri))
    });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    const navigationRequests = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasNavigationRequest");
    expect(navigationRequests).toHaveLength(1);
    expect(navigationRequests[0]).toMatchObject({
      type: "canvasNavigationRequest",
      documentVersion: 1,
      normalizedSourceOffset: source.indexOf("A")
    });
    expect(navigationRequests[0]).not.toHaveProperty("sourceTarget");
    expect(navigationRequests[0]).not.toHaveProperty("runtimeProjection");
  });

  it("defers Canvas focus while the destination panel is inactive", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("flushes one deferred Canvas focus when the destination becomes active", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toEqual([{
      type: "focusCanvas",
      requestId: navigationRequest.requestId
    }]);
  });

  it("does not duplicate deferred Canvas focus for repeated active view-state events", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    panel.active = true;
    const viewStateHandler = (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler;
    viewStateHandler();
    viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(1);
  });

  it("sends Canvas focus immediately when the destination panel is already active", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(focusMessagesFor(panel)).toEqual([{
      type: "focusCanvas",
      requestId: navigationRequest.requestId
    }]);
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    expect(focusMessagesFor(panel)).toHaveLength(1);
  });

  it("clears deferred Canvas focus when navigation completes", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });
    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "focused"
    });

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("prevents a superseded deferred request from focusing the Canvas", async () => {
    const { panel, navigationRequest: firstRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: firstRequest.requestId,
      status: "resolved",
      degradations: []
    });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const secondRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasNavigationRequest")
      .at(-1) as { requestId: number };

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();
    expect(focusMessagesFor(panel)).toHaveLength(0);

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: firstRequest.requestId,
      status: "resolved",
      degradations: []
    });
    expect(focusMessagesFor(panel)).toHaveLength(0);

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: secondRequest.requestId,
      status: "resolved",
      degradations: []
    });
    expect(focusMessagesFor(panel)).toEqual([{
      type: "focusCanvas",
      requestId: secondRequest.requestId
    }]);
  });

  it("prevents an invalidated deferred request from focusing after a document reset", async () => {
    const { document, panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });
    document.version = 2;
    emitDocumentChange(document);

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("clears deferred Canvas focus when navigation fails", async () => {
    const { panel, navigationRequest } = await prepareNavigation();
    panel.active = false;
    panel.webview.postMessage.mockClear();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });
    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "failed",
      reason: "source-mismatch"
    });

    panel.active = true;
    (panel as TestPanel & { viewStateHandler: () => void }).viewStateHandler();

    expect(focusMessagesFor(panel)).toHaveLength(0);
  });

  it("keeps Reveal and Canvas-to-Source navigation isolated per document session", async () => {
    const sourceA = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const sourceB = [
      "nui 1",
      "point B = coordinate(x: 10, y: 0)"
    ].join("\n");
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui", sourceA);
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui", sourceB);
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    editorA.selection.active = { line: 1, character: "point A = coordinate(x: 0, y: 0)".indexOf("A") };
    editorB.selection.active = { line: 1, character: "point B = coordinate(x: 10, y: 0)".indexOf("B") };
    setup(false, editorA, [documentA, documentB]);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels[1]!;

    await messageHandlerFor(panelB)({ type: "webviewReady" });
    await messageHandlerFor(panelB)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasNavigationRequest",
      normalizedSourceOffset: sourceB.indexOf("B")
    }));
    expect(panelA.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasNavigationRequest" }));

    panelA.active = true;
    panelB.active = false;
    mocks.activeTextEditor = editorA;
    mocks.visibleTextEditors = [editorA, editorB];
    mocks.activeTabInput = new mocks.TabInputWebview("mainThreadWebview-nuinuiCAD.canvas");
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panelA.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as { requestId: number } | undefined;
    expect(request).toBeDefined();

    mocks.showTextDocument.mockResolvedValue(editorA);
    await messageHandlerFor(panelA)({
      type: "canvasSourceDefinitionResult",
      requestId: request!.requestId,
      documentVersion: 1,
      range: { from: sourceA.indexOf("A"), to: sourceA.indexOf("A") + 1 }
    });

    expect(mocks.showTextDocument).toHaveBeenCalledWith(documentA, expect.objectContaining({ preserveFocus: false }));
    expect(mocks.showTextDocument).not.toHaveBeenCalledWith(documentB, expect.anything());
  });

  it("reuses an already-visible cross-file Source Definition editor", async () => {
    const rootSource = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const targetSource = "nui 1\npoint Dependency = coordinate(x: 10, y: 20)";
    const rootDocument = documentFor("/tmp/source-definition-root.nui", "file:///tmp/source-definition-root.nui", rootSource);
    const targetDocument = documentFor("/tmp/source-definition-dependency.nui", "file:///tmp/source-definition-dependency.nui", targetSource);
    const rootEditor = editorFor(rootDocument);
    const targetEditor = editorFor(targetDocument);
    rootEditor.viewColumn = 1;
    targetEditor.viewColumn = 3;
    const targetFrom = targetSource.indexOf("Dependency");

    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      canvasSourceDefinitionFor: vi.fn().mockResolvedValue({
        handled: true,
        value: {
          targetUri: targetDocument.uri,
          normalizedSource: targetSource,
          range: { from: targetFrom, to: targetFrom + "Dependency".length },
          sourceIdentity: { kind: "dependency-saved", documentId: targetDocument.uri.toString() }
        }
      })
    };
    setup(false, rootEditor, [rootDocument, targetDocument]);
    const panel = openPanelFor(rootEditor);
    mocks.visibleTextEditors = [rootEditor, targetEditor];
    mocks.textDocuments = [rootDocument, targetDocument];
    mocks.openTextDocument.mockResolvedValue(targetDocument);
    mocks.showTextDocument.mockResolvedValue(targetEditor);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as { requestId: number };
    const targetStart = targetDocument.positionAt(targetFrom);
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      runtimeElementId: "dependency-runtime"
    });

    expect(mocks.multiDocumentHost.canvasSourceDefinitionFor).toHaveBeenCalledWith(rootDocument, "dependency-runtime");
    expect(mocks.showTextDocument).toHaveBeenCalledWith(targetDocument, expect.objectContaining({
      viewColumn: targetEditor.viewColumn,
      preserveFocus: false,
      preview: false,
      selection: expect.objectContaining({ start: targetStart, end: targetStart })
    }));
    expect(mocks.showTextDocument.mock.calls[0]?.[1].viewColumn).not.toBe(rootEditor.viewColumn);
    expect(mocks.executeCommand).toHaveBeenCalledWith("editor.unfold");
    expect(targetEditor.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: targetStart, end: targetDocument.positionAt(targetFrom + "Dependency".length) }),
      1
    );
  });

  it("keeps the root-column fallback for a cross-file Source Definition target that is not visible", async () => {
    const rootSource = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const targetSource = "nui 1\npoint Dependency = coordinate(x: 10, y: 20)";
    const rootDocument = documentFor("/tmp/source-definition-fallback-root.nui", "file:///tmp/source-definition-fallback-root.nui", rootSource);
    const targetDocument = documentFor("/tmp/source-definition-fallback-dependency.nui", "file:///tmp/source-definition-fallback-dependency.nui", targetSource);
    const rootEditor = editorFor(rootDocument);
    const targetEditor = editorFor(targetDocument);
    rootEditor.viewColumn = 4;
    targetEditor.viewColumn = 6;
    const targetFrom = targetSource.indexOf("Dependency");

    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      canvasSourceDefinitionFor: vi.fn().mockResolvedValue({
        handled: true,
        value: {
          targetUri: targetDocument.uri,
          normalizedSource: targetSource,
          range: { from: targetFrom, to: targetFrom + "Dependency".length },
          sourceIdentity: { kind: "dependency-saved", documentId: targetDocument.uri.toString() }
        }
      })
    };
    setup(false, rootEditor, [rootDocument, targetDocument]);
    const panel = openPanelFor(rootEditor);
    mocks.visibleTextEditors = [rootEditor];
    mocks.textDocuments = [rootDocument, targetDocument];
    mocks.openTextDocument.mockResolvedValue(targetDocument);
    mocks.showTextDocument.mockResolvedValue(targetEditor);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as { requestId: number };
    const targetStart = targetDocument.positionAt(targetFrom);
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      runtimeElementId: "dependency-runtime"
    });

    expect(mocks.visibleTextEditors).not.toContain(targetEditor);
    expect(mocks.showTextDocument).toHaveBeenCalledWith(targetDocument, expect.objectContaining({
      viewColumn: rootEditor.viewColumn,
      preserveFocus: false,
      preview: false,
      selection: expect.objectContaining({ start: targetStart, end: targetStart })
    }));
    expect(mocks.executeCommand).toHaveBeenCalledWith("editor.unfold");
    expect(targetEditor.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: targetStart, end: targetDocument.positionAt(targetFrom + "Dependency".length) }),
      1
    );
  });

  it("falls back to the current root Source range when the multi-document host declines ownership", async () => {
    const source = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const document = documentFor("/tmp/source-definition-local.nui", "file:///tmp/source-definition-local.nui", source);
    const editor = editorFor(document);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      canvasSourceDefinitionFor: vi.fn().mockResolvedValue({ handled: false })
    };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls.find(([message]) => message?.type === "canvasSourceDefinitionRequest")?.[0] as { requestId: number };
    const range = { from: source.indexOf("Root"), to: source.indexOf("Root") + "Root".length };
    mocks.showTextDocument.mockResolvedValue(editor);

    await handler({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      runtimeElementId: "webview-local-runtime",
      range
    });

    expect(mocks.multiDocumentHost.canvasSourceDefinitionFor).toHaveBeenCalledWith(
      document,
      "webview-local-runtime"
    );
    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      preserveFocus: false,
      selection: expect.objectContaining({
        start: document.positionAt(range.from),
        end: document.positionAt(range.from)
      })
    }));
  });

  it("does not use a Webview range when the host owns the request without a target", async () => {
    const source = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const document = documentFor("/tmp/source-definition-owned-no-target.nui", "file:///tmp/source-definition-owned-no-target.nui", source);
    const editor = editorFor(document);
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      canvasSourceDefinitionFor: vi.fn().mockResolvedValue({ handled: true, value: undefined })
    };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const requestRange = { from: source.indexOf("Root"), to: source.indexOf("Root") + "Root".length };

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls.find(([message]) => message?.type === "canvasSourceDefinitionRequest")?.[0] as { requestId: number };

    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      runtimeElementId: "graph-owned-runtime",
      range: requestRange
    });

    expect(mocks.multiDocumentHost.canvasSourceDefinitionFor).toHaveBeenCalledWith(document, "graph-owned-runtime");
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
  });

  it("routes a graph-projected Canvas ID to the host-owned root definition", async () => {
    const source = [
      "nui 1",
      'import "./probe.nui" as probe',
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor(
      "/tmp/source-definition-graph-root.nui",
      "file:///tmp/source-definition-graph-root.nui",
      source
    );
    const editor = editorFor(document);
    const graphRuntimeId = "graph-compiled-runtime-A";
    const definitionFrom = source.indexOf("A =");
    mocks.multiDocumentHost = {
      diagnosticsStateFor: vi.fn(() => ({ status: "current", owner: "local", documentVersion: 1, rootGeneration: 1 })),
      onDiagnosticsChanged: vi.fn(),
      canvasSourceDefinitionFor: vi.fn().mockResolvedValue({
        handled: true,
        value: {
          targetUri: document.uri,
          normalizedSource: source,
          range: { from: definitionFrom, to: definitionFrom + 1 },
          sourceIdentity: {
            kind: "root-current",
            documentId: document.uri.toString(),
            sourceRevision: 12
          }
        }
      })
    };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    mocks.openTextDocument.mockResolvedValue(document);
    mocks.showTextDocument.mockResolvedValue(editor);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as { requestId: number };
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      runtimeElementId: graphRuntimeId,
      range: { from: 0, to: 5 }
    });

    expect(mocks.multiDocumentHost.canvasSourceDefinitionFor).toHaveBeenCalledWith(document, graphRuntimeId);
    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      preserveFocus: false,
      selection: expect.objectContaining({
        start: document.positionAt(definitionFrom),
        end: document.positionAt(definitionFrom)
      })
    }));
  });

  it("does not transfer focus for stale or no-target navigation results", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/navigation-stale.nui", "file:///tmp/navigation-stale.nui", source);
    const editor = editorFor(document);
    const initialActive = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    editor.selection.active = initialActive;
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const sourceRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasSourceDefinitionRequest") as { requestId: number };
    document.version = 2;
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: sourceRequest.requestId,
      documentVersion: 1,
      range: { from: source.indexOf("A"), to: source.indexOf("A") + 1 }
    });
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(editor.selection.active).toEqual(initialActive);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const noTargetRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message, index) => message?.type === "canvasSourceDefinitionRequest" && index > 0) as { requestId: number };
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: noTargetRequest.requestId,
      documentVersion: 2,
      range: null
    });
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    expect(editor.selection.active).toEqual(initialActive);

    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 2 });
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const navigationRequest = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasNavigationRequest") as { requestId: number };
    panel.webview.postMessage.mockClear();
    panel.reveal.mockClear();
    document.version = 3;
    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: navigationRequest.requestId,
      status: "resolved",
      degradations: []
    });

    expect(panel.reveal).not.toHaveBeenCalledWith(2, false);
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "focusCanvas" }));
  });

  it("blocks navigation during Canvas history and its handoff context", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/navigation-history.nui", "file:///tmp/navigation-history.nui", source);
    const editor = editorFor(document);
    editor.selection.active = { line: 1, character: source.split("\n")[1]!.indexOf("A") };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    let resolveNativeHistory!: () => void;
    const nativeHistory = new Promise<void>((resolve) => {
      resolveNativeHistory = resolve;
    });
    mocks.showTextDocument.mockImplementation(async () => {
      panel.active = false;
      return editor;
    });
    mocks.executeCommand.mockImplementation((command: string) => {
      if (command === "setContext") return Promise.resolve();
      if (command === "undo") return nativeHistory;
      return Promise.resolve();
    });

    const historyRequest = messageHandlerFor(panel)({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.canvasHistoryHandoff",
      true
    ));

    panel.active = true;
    panel.webview.postMessage.mockClear();
    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasSourceDefinitionRequest"
    }));
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasNavigationRequest"
    }));

    resolveNativeHistory();
    await historyRequest;
  });

  it("establishes the main-thread Rename caret through showTextDocument for named Canvas navigation", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0",
      ")",
      "",
      "point B = coordinate(",
      "  x: 100,",
      "  y: 0",
      ")",
      "",
      "line BaseLine = segment(",
      "  start: A,",
      "  end: B",
      ")"
    ].join("\n");
    const document = documentFor("/tmp/go-to-source.nui", "file:///tmp/go-to-source.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    document.languageId = "nui";
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls.find(([message]) => message?.type === "canvasSourceDefinitionRequest")?.[0] as { requestId: number };
    expect(request).toBeDefined();

    let mainThreadPosition: MockPosition | null = null;
    mocks.showTextDocument.mockImplementation(async (
      _document: TestDocument,
      options: { selection?: { start: MockPosition; end: MockPosition } }
    ) => {
      const selection = options.selection;
      expect(selection).toBeDefined();
      mainThreadPosition = selection!.end;
      panel.active = false;
      mocks.activeTextEditor = editor;
      return editor;
    });
    const identifierFrom = source.indexOf("BaseLine");
    const identifierTo = identifierFrom + "BaseLine".length;
    const identifierStart = document.positionAt(identifierFrom);
    const identifierEnd = document.positionAt(identifierTo);
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      range: { from: identifierFrom, to: identifierTo }
    });

    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      preserveFocus: false,
      selection: expect.objectContaining({ start: identifierStart, end: identifierStart })
    }));
    expect(mocks.activeTextEditor).toBe(editor);
    expect(panel.active).toBe(false);
    expect(mainThreadPosition).toEqual(identifierStart);
    const renameProvider = mocks.renameRegistrations[0]!.provider as {
      prepareRename: (document: TestDocument, position: { line: number; character: number }) => {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        placeholder: string;
      };
    };
    expect(renameProvider.prepareRename(document, mainThreadPosition!)).toMatchObject({
      range: { start: identifierStart, end: identifierEnd },
      placeholder: "BaseLine"
    });
    expect(mocks.executeCommand).toHaveBeenCalledWith("editor.unfold");
    expect(editor.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: identifierStart, end: identifierEnd }),
      1
    );

    panel.active = true;
    mocks.activeTabInput = new mocks.TabInputWebview("nuinuiCAD.canvas");
    await messageHandlerFor(panel)({
      type: "canvasPointerPublication",
      documentVersion: 1,
      pointer: { x: 5, y: -2 }
    });
    await coordinatePointCreationClick(panel, 1, { x: 5, y: -2 });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointer",
      sourcePosition: {
        documentVersion: 1,
        line: identifierStart.line,
        character: identifierStart.character
      }
    }));
  });

  it("keeps unnamed Canvas keyword navigation exact without adding Rename support", async () => {
    const source = [
      "nui 1",
      "point = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document = documentFor("/tmp/go-to-unnamed-source.nui", "file:///tmp/go-to-unnamed-source.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    commandHandlerFor("nuinuiCAD.goToSourceDefinition")?.();
    const request = panel.webview.postMessage.mock.calls.find(([message]) => message?.type === "canvasSourceDefinitionRequest")?.[0] as { requestId: number };
    expect(request).toBeDefined();

    let mainThreadPosition: MockPosition | null = null;
    mocks.showTextDocument.mockImplementation(async (
      _document: TestDocument,
      options: { selection?: { start: MockPosition; end: MockPosition } }
    ) => {
      const selection = options.selection;
      expect(selection).toBeDefined();
      mainThreadPosition = selection!.end;
      return editor;
    });
    await messageHandlerFor(panel)({
      type: "canvasSourceDefinitionResult",
      requestId: request.requestId,
      documentVersion: 1,
      range: { from: source.indexOf("point"), to: source.indexOf("point") + "point".length }
    });

    const keywordStart = document.positionAt(source.indexOf("point"));
    const keywordEnd = document.positionAt(source.indexOf("point") + "point".length);
    expect(mocks.showTextDocument).toHaveBeenCalledWith(document, expect.objectContaining({
      selection: expect.objectContaining({ start: keywordStart, end: keywordStart })
    }));
    expect(mainThreadPosition).toEqual(keywordStart);
    const renameProvider = mocks.renameRegistrations[0]!.provider as {
      prepareRename: (document: TestDocument, position: { line: number; character: number }) => unknown;
    };
    expect(() => renameProvider.prepareRename(document, mainThreadPosition!)).toThrow(
      "Rename is not available at this position."
    );
    expect(mocks.executeCommand).toHaveBeenCalledWith("editor.unfold");
    expect(editor.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: keywordStart, end: keywordEnd }),
      1
    );
  });
});

describe("VS Code compiler diagnostics lifecycle", () => {
  const invalidSource = "nui 1\npoint A = coordinate(x: 0, y: )\n";

  const collectionFor = (): TestDiagnosticCollection => mocks.diagnosticCollections[0]!;

  it("bootstraps already-open supported documents without opening Canvas", () => {
    const document = documentFor("/tmp/bootstrap.nui", "file:///tmp/bootstrap.nui", invalidSource);
    const context = setup(false, null, [document]);
    const collection = collectionFor();

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.createDiagnosticCollection).toHaveBeenCalledWith("nuinuiCAD");
    expect(collection.set).toHaveBeenCalledWith(document.uri, [
      expect.objectContaining({
        message: "Argument 'y' has no value.",
        code: "missing-attribute-value",
        source: "nuinuiCAD",
        severity: 0
      })
    ]);
    expect(context.subscriptions).toContain(collection);
  });

  it("publishes lint warnings through the existing single DiagnosticCollection alongside correctness warnings", () => {
    const document = documentFor(
      "/tmp/lint.nui",
      "file:///tmp/lint.nui",
      [
        "nui 1",
        "const Unused: number = 1",
        "style UnusedStyle {",
        "  visible: true,",
        "}"
      ].join("\n")
    );
    setup(false, null, [document]);

    expect(mocks.createDiagnosticCollection).toHaveBeenCalledTimes(1);
    expect(collectionFor().set).toHaveBeenCalledWith(document.uri, expect.arrayContaining([
      expect.objectContaining({ code: "unused-typed-declaration", severity: 1 }),
      expect.objectContaining({ code: "unused-drawing-style", severity: 1 })
    ]));
  });

  it("publishes exact graph-qualified imported diagnostics and clears them during invalidation", () => {
    const rootSource = "nui 1\nimport \"./dependency.nui\" as dependency\n";
    const dependencySource = "nui 1\nexport module Broken() {\n}\n";
    const root = documentFor("/tmp/importer.nui", "file:///tmp/importer.nui", rootSource);
    const dependency = documentFor("/tmp/dependency.nui", "file:///tmp/dependency.nui", dependencySource);
    const rootId = root.uri.toString();
    const dependencyId = dependency.uri.toString();
    const snapshot = {
      documentVersion: root.version,
      rootGeneration: 1,
      graphRevision: 1,
      graph: {
        nodes: new Map([
          [rootId, { artifact: { source: { kind: "root-current", documentId: rootId, normalizedSource: rootSource, sourceRevision: 1 } } }],
          [dependencyId, { artifact: { source: { kind: "dependency-saved", documentId: dependencyId, normalizedSource: dependencySource, savedSourceFingerprint: "sha256:dependency" } } }]
        ])
      },
      compiled: null,
      diagnostics: [{
        severity: "error",
        code: "import-invalid-dependency",
        message: "dependency is invalid",
        location: {
          source: { kind: "dependency-saved", documentId: dependencyId, savedSourceFingerprint: "sha256:dependency" },
          range: { from: dependencySource.indexOf("Broken"), to: dependencySource.indexOf("Broken") + "Broken".length }
        },
        relatedInformation: [{
          message: "importer reference",
          location: {
            source: { kind: "root-current", documentId: rootId, sourceRevision: 1 },
            range: { from: rootSource.indexOf("dependency"), to: rootSource.indexOf("dependency") + "dependency".length }
          }
        }]
      }]
    } as unknown as import("./multiDocumentHost").VscodeMultiDocumentDiagnosticSnapshot;
    let diagnosticState: VscodeMultiDocumentDiagnosticsState = {
      status: "current",
      owner: "multi-document",
      documentVersion: root.version,
      rootGeneration: 1,
      snapshot
    };
    const localState = {
      status: "current",
      owner: "local",
      documentVersion: dependency.version,
      rootGeneration: 1
    };
    const host = {
      diagnosticsStateFor: vi.fn((document: TestDocument) => document === root ? diagnosticState : localState),
      onDiagnosticsChanged: vi.fn()
    };
    mocks.multiDocumentHost = host;
    setup(false, null, [root, dependency]);
    const collection = collectionFor();

    const dependencyPublication = collection.set.mock.calls.find(([uri]) => uri === dependency.uri)?.[1] as Array<{
      code?: string;
      relatedInformation?: Array<{ location: { uri: { toString: () => string } } }>;
    }> | undefined;
    expect(dependencyPublication).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "import-invalid-dependency",
        relatedInformation: [expect.objectContaining({
          location: expect.objectContaining({ uri: root.uri })
        })]
      })
    ]));
    expect(mocks.multiDocumentDiagnosticsListeners).toHaveLength(2);
    diagnosticState = { status: "building", documentVersion: root.version, rootGeneration: 2 };
    for (const listener of mocks.multiDocumentDiagnosticsListeners) listener(root.uri.toString());
    expect(collection.set).toHaveBeenLastCalledWith(dependency.uri, []);
  });

  it("publishes invalid choice literals for typed declarations", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const mode: choice(front, back) = @center"
    ].join("\n");
    const document = documentFor("/tmp/invalid-choice.nui", "file:///tmp/invalid-choice.nui", source);
    setup(false, null, [document]);

    const published = collectionFor().set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      message: string;
      range: { start: MockPosition; end: MockPosition };
      severity: number;
      source?: string;
    }>;
    const diagnostic = published.find((item) => item.code === "invalid-choice-literal");

    expect(diagnostic).toMatchObject({
      code: "invalid-choice-literal",
      source: "nuinuiCAD",
      severity: 0,
      range: {
        start: { line: 2, character: 34 },
        end: { line: 2, character: 41 }
      }
    });
    expect(published.filter((item) => item.code === "invalid-choice-literal")).toHaveLength(1);
  });

  it("creates diagnostics for documents opened after activation", () => {
    setup(false, null, []);
    const document = documentFor("/tmp/opened.nui", "file:///tmp/opened.nui", invalidSource);
    mocks.textDocuments.push(document);

    emitDocumentOpen(document);

    expect(collectionFor().set).toHaveBeenCalledWith(document.uri, expect.any(Array));
  });

  it("recompiles unsaved current text on change and publishes binding issues", () => {
    const document = documentFor(
      "/tmp/changed.nui",
      "file:///tmp/changed.nui",
      "nui 1\nconst x: number = 1\nconst x: number = 2\n"
    );
    setup(false, null, [document]);
    const collection = collectionFor();
    const initialCallCount = collection.set.mock.calls.length;

    document.version = 2;
    document.setSourceText("nui 1\npoint A = coordinate(x: 0, y: 1)\n");
    emitDocumentChange(document);

    expect(initialCallCount).toBe(1);
    expect(collection.set).toHaveBeenLastCalledWith(document.uri, []);
  });

  it("keeps document diagnostics isolated when another URI closes", () => {
    const documentA = documentFor("/tmp/a.nui", "file:///tmp/a.nui", invalidSource);
    const documentB = documentFor("/tmp/b.nui", "file:///tmp/b.nui", invalidSource);
    setup(false, null, [documentA, documentB]);
    const collection = collectionFor();

    emitDocumentClose(documentA);
    expect(collection.delete).toHaveBeenCalledWith(documentA.uri);
    expect(collection.delete).not.toHaveBeenCalledWith(documentB.uri);

    documentB.version = 2;
    documentB.setSourceText("nui 1\npoint B = coordinate(x: 0, y: 1)\n");
    emitDocumentChange(documentB);
    expect(collection.set).toHaveBeenLastCalledWith(documentB.uri, []);
  });

  it("ignores untitled and non-nui documents", () => {
    const untitled = documentFor("/tmp/untitled.nui", "untitled:/tmp/untitled.nui", invalidSource);
    const textFile = documentFor("/tmp/pattern.txt", "file:///tmp/pattern.txt", invalidSource);
    setup(false, null, [untitled, textFile]);
    const collection = collectionFor();

    emitDocumentOpen(untitled);
    emitDocumentOpen(textFile);
    emitDocumentChange(untitled);
    emitDocumentChange(textFile);

    expect(collection.set).not.toHaveBeenCalled();
    expect(collection.delete).not.toHaveBeenCalled();
  });

  it("does not publish when the document version changes during compilation", () => {
    const document = documentFor("/tmp/stale.nui", "file:///tmp/stale.nui", "nui 1\n");
    setup(false, null, [document]);
    const collection = collectionFor();
    const initialCallCount = collection.set.mock.calls.length;

    document.version = 2;
    document.setSourceText(invalidSource);
    document.onGetText = () => { document.version = 3; };
    emitDocumentChange(document);

    expect(collection.set.mock.calls).toHaveLength(initialCallCount);
  });

  it("does not publish an old session after close and same-URI reopen", () => {
    const document = documentFor("/tmp/reopen.nui", "file:///tmp/reopen.nui", "nui 1\n");
    setup(false, null, [document]);
    const collection = collectionFor();
    const reopened = documentFor("/tmp/reopen.nui", "file:///tmp/reopen.nui", invalidSource);

    document.version = 2;
    document.setSourceText(invalidSource);
    document.onGetText = () => {
      mocks.textDocuments = [reopened];
      emitDocumentClose(document);
      emitDocumentOpen(reopened);
    };
    emitDocumentChange(document);

    expect(collection.set).toHaveBeenCalledTimes(2);
    expect(collection.set).toHaveBeenLastCalledWith(reopened.uri, expect.any(Array));
  });
});

describe("VS Code Canvas theme warning lifecycle", () => {
  const sourceFor = (color: string): string => [
    "nui 1",
    "style Guide {",
    `  color: ${color},`,
    "}"
  ].join("\n");

  const warningCodesFor = (collection: TestDiagnosticCollection): Array<string | number | undefined> => {
    const diagnostics = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }> | undefined;
    return diagnostics?.map((diagnostic) => diagnostic.code) ?? [];
  };

  const synchronizeCanvasTheme = async (
    panel: TestPanel,
    documentVersion: number,
    background: string,
    generation = 0
  ): Promise<void> => {
    const handler = messageHandlerFor(panel);
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion });
    await publishCanvasTheme(panel, documentVersion, background, generation);
  };

  it("publishes an authoritative initial background into the existing Source diagnostics", async () => {
    const source = sourceFor("#999999");
    const document = documentFor("/tmp/contrast-initial.nui", "file:///tmp/contrast-initial.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const collection = mocks.diagnosticCollections[0]!;

    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, document.version, "#ffffff");

    expect(warningCodesFor(collection)).toContain("style-fixed-color-low-contrast");
    const warning = (collection.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      message: string;
      range: { start: MockPosition; end: MockPosition };
      severity: number;
      source?: string;
    }>).find((diagnostic) => diagnostic.code === "style-fixed-color-low-contrast");
    expect(warning).toMatchObject({
      severity: 1,
      source: "nuinuiCAD",
      message: "Fixed style color #999999 has low contrast against the current Canvas background.",
      range: {
        start: { line: 2, character: "  color: ".length },
        end: { line: 2, character: "  color: #999999".length }
      }
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasWarning" }));
  });

  it("preserves the exact fixed-color token range for CRLF Source documents", async () => {
    const source = sourceFor("#999999").replace(/\n/g, "\r\n");
    const document = documentFor("/tmp/contrast-crlf.nui", "file:///tmp/contrast-crlf.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, document.version, "#ffffff");

    const diagnostics = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      range: { start: MockPosition; end: MockPosition };
    }>;
    expect(diagnostics.find((diagnostic) => diagnostic.code === "style-fixed-color-low-contrast")?.range).toEqual({
      start: { line: 2, character: "  color: ".length },
      end: { line: 2, character: "  color: #999999".length }
    });
  });

  it("reevaluates low-to-high and high-to-low only after fresh publication for the new document version", async () => {
    const document = documentFor(
      "/tmp/contrast-edit.nui",
      "file:///tmp/contrast-edit.nui",
      sourceFor("#999999")
    );
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, 1, "#ffffff");
    const collection = mocks.diagnosticCollections[0]!;
    expect(warningCodesFor(collection)).toContain("style-fixed-color-low-contrast");

    document.version = 2;
    document.setSourceText(sourceFor("#0000ff"));
    emitDocumentChange(document);
    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");
    await synchronizeCanvasTheme(panel, 2, "#ffffff");
    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");

    document.version = 3;
    document.setSourceText(sourceFor("#999999"));
    emitDocumentChange(document);
    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");
    await synchronizeCanvasTheme(panel, 3, "#ffffff");
    expect(warningCodesFor(collection)).toContain("style-fixed-color-low-contrast");
  });

  it("rejects stale and wrong-session background publications", async () => {
    const document = documentFor("/tmp/contrast-stale.nui", "file:///tmp/contrast-stale.nui", sourceFor("#999999"));
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const firstPanel = openPanelFor(editor);
    const firstHandler = messageHandlerFor(firstPanel);
    await firstHandler({ type: "webviewReady" });
    await synchronizeCanvasTheme(firstPanel, 1, "#ffffff");
    const collection = mocks.diagnosticCollections[0]!;
    const callsAfterFresh = collection.set.mock.calls.length;

    await publishCanvasTheme(firstPanel, 0, "#000000");
    expect(collection.set.mock.calls).toHaveLength(callsAfterFresh);

    firstPanel.dispose();
    const secondPanel = openPanelFor(editor);
    const secondHandler = messageHandlerFor(secondPanel);
    await secondHandler({ type: "webviewReady" });
    await secondHandler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    await firstHandler({
      type: "canvasThemePublication",
      documentVersion: 1,
      generation: 0,
      theme: { ...LEGACY_CANVAS_THEME, background: "#ffffff" }
    });
    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");
  });

  it("invalidates on theme change before refresh and clears on Canvas close", async () => {
    const document = documentFor("/tmp/contrast-theme.nui", "file:///tmp/contrast-theme.nui", sourceFor("#999999"));
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await synchronizeCanvasTheme(panel, 1, "#ffffff");
    const collection = mocks.diagnosticCollections[0]!;
    expect(warningCodesFor(collection)).toContain("style-fixed-color-low-contrast");

    mocks.activeColorThemeListeners[0]!();
    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });

    await publishCanvasTheme(panel, 1, "#000000", 0);
    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");

    panel.dispose();
    expect(warningCodesFor(collection)).not.toContain("style-fixed-color-low-contrast");
  });

  it("does not guess a warning before Canvas is opened", () => {
    const document = documentFor("/tmp/contrast-no-canvas.nui", "file:///tmp/contrast-no-canvas.nui", sourceFor("#999999"));
    setup(false, null, [document]);

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(warningCodesFor(mocks.diagnosticCollections[0]!)).not.toContain("style-fixed-color-low-contrast");
  });
});

describe("VS Code native completion lifecycle", () => {
  it("registers the provider with the requested selector, triggers, and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.completionRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.triggerCharacters).toEqual(["@", ".", ":", "=", "(", ",", "[", "{"]);
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("shares the URI-scoped analysis session and does not start Rust for completion", () => {
    const document = documentFor(
      "/tmp/completion.nui",
      "file:///tmp/completion.nui",
      "nui 1\nconst value: number = ab"
    );
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [document]);
    const registration = mocks.completionRegistrations[0]!;
    const provider = registration.provider as {
      provideCompletionItems: (document: TestDocument, position: { line: number; character: number }, token: unknown, context: unknown) => unknown;
    };

    const items = provider.provideCompletionItems(document, { line: 1, character: "const value: number = ab".length }, undefined, undefined) as Array<{ label: string }>;

    expect(fromSource).toHaveBeenCalledTimes(1);
    expect(items.map((item) => item.label)).toContain("abs");
    expect(mocks.rustProcesses).toHaveLength(0);
    fromSource.mockRestore();
  });

  it("works for an open document without creating Canvas", () => {
    const document = documentFor("/tmp/no-canvas.nui", "file:///tmp/no-canvas.nui", "nui 1\npoint P = co");
    setup(false, null, [document]);
    const registration = mocks.completionRegistrations[0]!;
    const provider = registration.provider as {
      provideCompletionItems: (document: TestDocument, position: { line: number; character: number }, token: unknown, context: unknown) => unknown;
    };

    const items = provider.provideCompletionItems(document, { line: 1, character: "point P = co".length }, undefined, undefined) as Array<{ label: string }>;

    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(items.map((item) => item.label)).toContain("coordinate");
  });
});

describe("VS Code native structural folding lifecycle", () => {
  it("registers one nui/file folding provider in the extension lifecycle", () => {
    const context = setup(false, null, []);
    const registration = mocks.foldingRegistrations[0]!;

    expect(mocks.foldingRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({ provideFoldingRanges: expect.any(Function) }));
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("reuses URI-scoped sessions while isolating documents across close and reopen", () => {
    const sourceA = [
      "group A {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const sourceB = "// one\n// two\n";
    const documentA = documentFor("/tmp/folding-a.nui", "file:///tmp/folding-a.nui", sourceA);
    const documentB = documentFor("/tmp/folding-b.nui", "file:///tmp/folding-b.nui", sourceB);
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [documentA, documentB]);
    const provider = mocks.foldingRegistrations[0]!.provider as {
      provideFoldingRanges: (document: TestDocument) => Array<{ start: number; end: number; kind?: unknown }>;
    };

    expect(provider.provideFoldingRanges(documentA)).toEqual([
      expect.objectContaining({ start: 0, end: 2 })
    ]);
    expect(provider.provideFoldingRanges(documentB)).toEqual([
      expect.objectContaining({ start: 0, end: 1, kind: "comment" })
    ]);

    emitDocumentClose(documentA);
    const reopened = documentFor(
      "/tmp/folding-a.nui",
      "file:///tmp/folding-a.nui",
      "// reopened\n// document\n"
    );
    mocks.textDocuments = [documentB, reopened];
    emitDocumentOpen(reopened);
    expect(provider.provideFoldingRanges(reopened)).toEqual([
      expect.objectContaining({ start: 0, end: 1, kind: "comment" })
    ]);
    expect(provider.provideFoldingRanges(documentB)).toEqual([
      expect.objectContaining({ start: 0, end: 1, kind: "comment" })
    ]);
    expect(fromSource).toHaveBeenCalledTimes(3);
    fromSource.mockRestore();
  });
});

describe("VS Code native document symbol lifecycle", () => {
  it("registers one nui/file document symbol provider with the session lifecycle", () => {
    const context = setup(false, null, []);
    const registration = mocks.documentSymbolRegistrations[0]!;

    expect(mocks.documentSymbolRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({ provideDocumentSymbols: expect.any(Function) }));
    expect(context.subscriptions).toContain(registration.disposable);
  });
});

describe("VS Code native fixed-color lifecycle", () => {
  it("registers one nui/file color provider with the session lifecycle", () => {
    setup(false, null, []);
    const registration = mocks.colorRegistrations[0]!;

    expect(mocks.colorRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({
      provideDocumentColors: expect.any(Function),
      provideColorPresentations: expect.any(Function)
    }));
  });

  it("refreshes one current registration as Canvas theme availability changes", async () => {
    const source = ["nui 1", "style Guide {", "  color: accent", "}"].join("\n");
    const document = documentFor("/tmp/colors.nui", "file:///tmp/colors.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);

    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    await publishCanvasTheme(panel, 1, { ...LEGACY_CANVAS_THEME, accent: "#123456" });
    expect(mocks.colorRegistrations).toHaveLength(2);
    expect(mocks.colorRegistrations[0]!.disposable.dispose).toHaveBeenCalledTimes(1);

    mocks.activeColorThemeListeners[0]!();
    expect(mocks.colorRegistrations).toHaveLength(3);
    expect(mocks.colorRegistrations[1]!.disposable.dispose).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasThemeChanged", generation: 1 });

    await publishCanvasTheme(panel, 1, { ...LEGACY_CANVAS_THEME, accent: "#654321" }, 1);
    expect(mocks.colorRegistrations).toHaveLength(4);
    expect(mocks.colorRegistrations[2]!.disposable.dispose).toHaveBeenCalledTimes(1);

    panel.dispose();
    expect(mocks.colorRegistrations).toHaveLength(5);
    expect(mocks.colorRegistrations[3]!.disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it("converts semantic color edits without wiring an error notification", async () => {
    const source = ["nui 1", "style Guide {", "  color: accent", "}"].join("\n");
    const document = documentFor("/tmp/colors.nui", "file:///tmp/colors.nui", source);
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    const handler = messageHandlerFor(panel);

    await handler({ type: "webviewReady" });
    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: 1 });
    await publishCanvasTheme(panel, 1, { ...LEGACY_CANVAS_THEME, accent: "#123456" });
    const provider = mocks.colorRegistrations.at(-1)!.provider as {
      provideColorPresentations: (
        color: { red: number; green: number; blue: number; alpha: number },
        context: { document: TestDocument; range: { start: unknown; end: unknown } }
      ) => Array<{ label: string; textEdit?: unknown }>;
    };
    const start = source.indexOf("accent");
    const range = {
      start: document.positionAt(start),
      end: document.positionAt(start + "accent".length)
    };

    const first = provider.provideColorPresentations({ red: 1, green: 0, blue: 0, alpha: 1 }, { document, range });
    const second = provider.provideColorPresentations({ red: 0, green: 1, blue: 0, alpha: 1 }, { document, range });

    expect(first).toEqual([expect.objectContaining({
      label: "#ff0000",
      textEdit: expect.objectContaining({ range, newText: "#ff0000" })
    })]);
    expect(second).toEqual([expect.objectContaining({
      label: "#00ff00",
      textEdit: expect.objectContaining({ range, newText: "#00ff00" })
    })]);
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });
});

describe("VS Code native definition lifecycle", () => {
  it("registers the provider with the requested selector and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.definitionRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("shares the diagnostic session for definition lookup without Canvas or Rust", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: A, dx: 1, dy: 0)"
    ].join("\n");
    const document = documentFor("/tmp/definition.nui", "file:///tmp/definition.nui", source);
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [document]);
    const registration = mocks.definitionRegistrations[0]!;
    const provider = registration.provider as {
      provideDefinition: (
        document: TestDocument,
        position: { line: number; character: number },
        token: unknown
      ) => unknown;
    };
    const referenceLine = source.split("\n")[2]!;
    const links = provider.provideDefinition(
      document,
      { line: 2, character: referenceLine.indexOf("A") + "A".length },
      undefined
    ) as Array<{ targetSelectionRange: { start: { line: number; character: number } } }> | undefined;

    expect(fromSource).toHaveBeenCalledTimes(1);
    expect(links).toHaveLength(1);
    expect(links?.[0]?.targetSelectionRange.start).toEqual({ line: 1, character: "point ".length });
    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.rustProcesses).toHaveLength(0);
    fromSource.mockRestore();
  });
});

describe("VS Code native rename lifecycle", () => {
  it("registers the provider with the requested selector and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.renameRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(context.subscriptions).toContain(registration.disposable);
  });

  it("shares the URI-scoped analysis session without Canvas or Rust", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: A, dx: 1, dy: 0)"
    ].join("\n");
    const document = documentFor("/tmp/rename.nui", "file:///tmp/rename.nui", source);
    const fromSource = vi.spyOn(AutomationDocument, "fromSource");
    setup(false, null, [document]);
    const registration = mocks.renameRegistrations[0]!;
    const provider = registration.provider as {
      prepareRename: (
        document: TestDocument,
        position: { line: number; character: number },
        token: unknown
      ) => unknown;
    };
    const referenceLine = source.split("\n")[2]!;
    const result = provider.prepareRename(
      document,
      { line: 2, character: referenceLine.indexOf("from: A") + "from: ".length },
      undefined
    );

    expect(fromSource).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ placeholder: "A" });
    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();
    expect(mocks.rustProcesses).toHaveLength(0);
    fromSource.mockRestore();
  });
});

describe("VS Code native references lifecycle", () => {
  it("registers the provider with the requested selector and lifecycle disposable", () => {
    const context = setup(false, null, []);
    const registration = mocks.referenceRegistrations[0]!;

    expect(mocks.referenceRegistrations).toHaveLength(1);
    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.provider).toEqual(expect.objectContaining({ provideReferences: expect.any(Function) }));
    expect(context.subscriptions).toContain(registration.disposable);
  });
});

describe("VS Code native choice Quick Fix lifecycle", () => {
  it("registers only QuickFix CodeActions and the internal apply command", () => {
    const context = setup(false, null, []);
    const registration = mocks.codeActionRegistrations[0]!;

    expect(registration.selector).toEqual({ language: "nui", scheme: "file" });
    expect(registration.providedCodeActionKinds).toEqual(["quickfix"]);
    expect(context.subscriptions).toContain(registration.disposable);
    expect(mocks.registerCommand).toHaveBeenCalledWith(
      "nuinuiCAD.applyChoiceQuickFix",
      expect.any(Function)
    );
    expect(commandHandlerFor("nuinuiCAD.applyChoiceQuickFix")).toEqual(expect.any(Function));
    expect(commandHandlerFor("nuinuiCAD.openCanvas")).toEqual(expect.any(Function));
  });
});

describe("VS Code native Refactor Code Action lifecycle", () => {
  it("registers exactly one nui/file provider with the three Refactor child kinds while preserving Quick Fix", () => {
    const context = setup(false, null, []);
    const quickFixRegistrations = mocks.codeActionRegistrations.filter((registration) =>
      registration.providedCodeActionKinds.includes("quickfix")
    );
    const refactorRegistrations = mocks.codeActionRegistrations.filter((registration) =>
      registration.providedCodeActionKinds.every((kind) => kind !== "quickfix")
    );

    expect(quickFixRegistrations).toHaveLength(1);
    expect(refactorRegistrations).toHaveLength(1);
    expect(refactorRegistrations[0]).toMatchObject({
      selector: { language: "nui", scheme: "file" },
      providedCodeActionKinds: ["refactor.extract", "refactor.inline", "refactor.rewrite"]
    });
    expect(refactorRegistrations[0]?.provider).toEqual(expect.objectContaining({
      provideCodeActions: expect.any(Function)
    }));
    expect(context.subscriptions).toContain(refactorRegistrations[0]?.disposable);
  });
});

describe("VS Code fixed Canvas Ribbon lifecycle", () => {
  it("registers Zoom commands through the existing Canvas command owner", () => {
    const document = documentFor("/tmp/canvas-zoom.nui", "file:///tmp/canvas-zoom.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.zoomInCanvas", expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.zoomOutCanvas", expect.any(Function));
    commandHandlerFor("nuinuiCAD.zoomInCanvas")?.();
    commandHandlerFor("nuinuiCAD.zoomOutCanvas")?.();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "zoomInCanvas" });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "canvasCommand", commandId: "zoomOutCanvas" });
  });

  it("restores independently validated position data from Extension global state", async () => {
    const stateKey = "nuinuiCAD.canvasRibbonPositions";
    mocks.globalStateValues[stateKey] = {
      viewport: { x: 20, y: 36 },
      display: { x: "corrupt", y: 84 },
      grid: { x: 8, y: 132 },
      legacyRibbon: { x: 500, y: 600 }
    };
    const document = documentFor("/tmp/canvas-ribbon-restore.nui", "file:///tmp/canvas-ribbon-restore.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasRibbonPositions",
      positions: { viewport: { x: 20, y: 36 }, grid: { x: 8, y: 132 } }
    });
    expect(mocks.globalStateUpdates).toEqual([]);
    expect(JSON.stringify(mocks.configurationScopes)).not.toContain("canvasRibbon.ribbons");
  });

  it("persists only a moved fixed Ribbon position and broadcasts the update to Canvas sessions", async () => {
    const stateKey = "nuinuiCAD.canvasRibbonPositions";
    const initialPositions = {
      viewport: { x: 8, y: 10 },
      display: { x: 8, y: 80 },
      grid: { x: 8, y: 150 }
    };
    mocks.globalStateValues[stateKey] = initialPositions;
    const documentA = documentFor("/tmp/canvas-ribbon-a.nui", "file:///tmp/canvas-ribbon-a.nui");
    const documentB = documentFor("/tmp/canvas-ribbon-b.nui", "file:///tmp/canvas-ribbon-b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA]);
    const panelA = openPanelFor(editorA);
    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels.at(-1)!;
    panelA.webview.postMessage.mockClear();
    panelB.webview.postMessage.mockClear();

    const nextPositions = {
      viewport: initialPositions.viewport,
      display: { x: 44, y: 96 },
      grid: initialPositions.grid
    };
    await messageHandlerFor(panelA)({ type: "canvasRibbonPositionCommit", ribbonId: "display", x: 44, y: 96 });

    expect(mocks.globalStateUpdates).toEqual([{ key: stateKey, value: nextPositions }]);
    expect(mocks.globalStateValues[stateKey]).toEqual(nextPositions);
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ type: "canvasRibbonPositions", positions: nextPositions });
    expect(panelB.webview.postMessage).toHaveBeenCalledWith({ type: "canvasRibbonPositions", positions: nextPositions });

    await messageHandlerFor(panelA)({ type: "canvasRibbonPositionCommit", ribbonId: "custom", x: 1, y: 2 } as never);
    await messageHandlerFor(panelA)({ type: "canvasRibbonPositionCommit", ribbonId: "grid", x: Number.NaN, y: 2 });
    await messageHandlerFor(panelA)({ type: "canvasRibbonPositionCommit", ribbonId: "grid", x: Number.POSITIVE_INFINITY, y: 2 });
    expect(mocks.globalStateUpdates).toHaveLength(1);
  });
});

describe("VS Code Canvas Grid configuration lifecycle", () => {
  it.each([
    ["workspace when it owns the effective value", { globalValue: true, workspaceValue: false }, 2],
    ["global when it is the only explicit value", { globalValue: false }, 1],
    ["global when no explicit value exists", {}, 1]
  ] as const)("toggles Canvas Grid Snap at the %s configuration target", async (_caseName, inspection, target) => {
    const document = documentFor("/tmp/grid-snap-target.nui", "file:///tmp/grid-snap-target.nui");
    const editor = editorFor(document);
    mocks.canvasGridSettings = { snapEnabled: false };
    mocks.canvasGridConfigurationInspection = { ...inspection };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.toggleCanvasGridSnap", expect.any(Function));
    await commandHandlerFor("nuinuiCAD.toggleCanvasGridSnap")?.();

    expect(mocks.configurationUpdates).toEqual([{
      section: CANVAS_GRID_SNAP_ENABLED_SETTING,
      value: true,
      target
    }]);
    expect(mocks.configurationScopes).toContainEqual({ section: undefined, scope: undefined });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasGridConfiguration" }));
  });

  it.each([
    ["workspace when it owns the effective value", { globalValue: true, workspaceValue: false }, 2],
    ["global when it is the only explicit value", { globalValue: false }, 1],
    ["global when no explicit value exists", {}, 1]
  ] as const)("toggles Canvas Grid at the %s configuration target", async (_caseName, inspection, target) => {
    const document = documentFor("/tmp/grid-target.nui", "file:///tmp/grid-target.nui");
    const editor = editorFor(document);
    mocks.canvasGridSettings = { enabled: false, spacingMm: 10, majorEvery: 5, snapEnabled: false };
    mocks.canvasGridConfigurationInspection = { ...inspection };
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    expect(mocks.registerCommand).toHaveBeenCalledWith("nuinuiCAD.toggleCanvasGrid", expect.any(Function));
    await commandHandlerFor("nuinuiCAD.toggleCanvasGrid")?.();

    expect(mocks.configurationUpdates).toEqual([{
      section: CANVAS_GRID_ENABLED_SETTING,
      value: true,
      target
    }]);
    expect(mocks.configurationScopes).toContainEqual({ section: undefined, scope: undefined });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasGridConfiguration" }));
  });

  it("routes the Ribbon host action through the canonical Grid Snap command", async () => {
    const document = documentFor("/tmp/grid-snap-host-action.nui", "file:///tmp/grid-snap-host-action.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    await messageHandlerFor(panel)({ type: "toggleCanvasGridSnap" });

    expect(mocks.executeCommand).toHaveBeenCalledWith("nuinuiCAD.toggleCanvasGridSnap");
    expect(mocks.configurationUpdates).toEqual([]);
  });

  it("routes Canvas Grid Ribbon host actions through the canonical native commands", async () => {
    const document = documentFor("/tmp/grid-host-actions.nui", "file:///tmp/grid-host-actions.nui");
    const editor = editorFor(document);
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);

    await messageHandlerFor(panel)({ type: "toggleCanvasGrid" });
    await messageHandlerFor(panel)({ type: "configureCanvasGrid" });

    expect(mocks.executeCommand).toHaveBeenCalledWith("nuinuiCAD.toggleCanvasGrid");
    expect(mocks.executeCommand).toHaveBeenCalledWith("nuinuiCAD.configureCanvasGrid");
    expect(mocks.configurationUpdates).toEqual([]);
  });

  it("publishes Canvas grid configuration initially and live without broadcasting to Output Preview", async () => {
    mocks.canvasGridSettings = { enabled: false, spacingMm: 2.5, majorEvery: 1, snapEnabled: true };
    const documentA = documentFor("/tmp/grid-a.nui", "file:///tmp/grid-a.nui");
    const documentB = documentFor("/tmp/grid-b.nui", "file:///tmp/grid-b.nui");
    const editorA = editorFor(documentA);
    const editorB = editorFor(documentB);
    setup(false, editorA, [documentA]);
    const panelA = openPanelFor(editorA);
    await messageHandlerFor(panelA)({ type: "webviewReady" });

    expect(panelA.webview.postMessage).toHaveBeenCalledWith({
      type: "canvasGridConfiguration",
      settings: { enabled: false, spacingMm: 2.5, majorEvery: 1, snapEnabled: true }
    });
    expect(mocks.configurationScopes).toContainEqual({ section: undefined, scope: undefined });

    mocks.activeTextEditor = editorB;
    mocks.visibleTextEditors = [editorB];
    mocks.textDocuments = [documentA, documentB];
    mocks.activeTabInput = new mocks.TabInputText(editorB.document.uri);
    commandHandlerFor("nuinuiCAD.openCanvas")?.();
    const panelB = mocks.panels.at(-1)!;
    const outputPanel = openOutputPreviewPanelFor(editorA);
    panelA.webview.postMessage.mockClear();
    panelB.webview.postMessage.mockClear();
    outputPanel.webview.postMessage.mockClear();

    mocks.canvasGridSettings = { enabled: true, spacingMm: 20, majorEvery: 3, snapEnabled: false };
    for (const listener of mocks.configurationChangeListeners) {
      listener({
        affectsConfiguration: (section) => section === CANVAS_GRID_SNAP_ENABLED_SETTING
      });
    }

    const expected = {
      type: "canvasGridConfiguration",
      settings: { enabled: true, spacingMm: 20, majorEvery: 3, snapEnabled: false }
    };
    expect(panelA.webview.postMessage).toHaveBeenCalledWith(expected);
    expect(panelB.webview.postMessage).toHaveBeenCalledWith(expected);
    expect(panelA.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasGridConfiguration"))
      .toEqual([[expected]]);
    expect(panelB.webview.postMessage.mock.calls.filter(([message]) => message?.type === "canvasGridConfiguration"))
      .toEqual([[expected]]);
    expect(outputPanel.webview.postMessage).not.toHaveBeenCalledWith(expected);
    expect(mocks.configurationScopes).toContainEqual({ section: undefined, scope: undefined });
  });
});


describe("SAY-81 Module instance Reveal feedback", () => {
  it("treats a resolved Module instance as selectable even when viewport pan has no bounds", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, visible: false)",
      "}",
      "instance A = M()"
    ].join("\n");
    const document = documentFor("/tmp/instance.nui", "file:///tmp/instance.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("A = M"));
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();
    mocks.showErrorMessage.mockClear();

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const request = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasNavigationRequest") as { requestId: number } | undefined;
    expect(request).toBeDefined();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: request!.requestId,
      status: "resolved",
      degradations: []
    });

    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "focusCanvas",
      requestId: request!.requestId
    });
  });
});
