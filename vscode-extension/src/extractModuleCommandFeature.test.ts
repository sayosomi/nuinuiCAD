import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerCommand: vi.fn(),
  executeCommand: vi.fn(() => Promise.resolve()),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showTextDocument: vi.fn(),
  commandHandler: undefined as (() => unknown) | undefined,
  activeEditorListeners: [] as Array<() => void>,
  selectionListeners: [] as Array<(event: { textEditor: unknown }) => void>
}));

vi.mock("vscode", () => {
  const disposable = () => ({ dispose: vi.fn() });
  return {
    commands: {
      registerCommand: mocks.registerCommand,
      executeCommand: mocks.executeCommand
    },
    window: {
      onDidChangeActiveTextEditor: (listener: () => void) => {
        mocks.activeEditorListeners.push(listener);
        return disposable();
      },
      onDidChangeTextEditorSelection: (listener: (event: { textEditor: unknown }) => void) => {
        mocks.selectionListeners.push(listener);
        return disposable();
      },
      tabGroups: {},
      visibleTextEditors: [],
      showInputBox: mocks.showInputBox,
      showQuickPick: mocks.showQuickPick,
      showTextDocument: mocks.showTextDocument,
      showErrorMessage: mocks.showErrorMessage,
      showInformationMessage: mocks.showInformationMessage
    },
    Disposable: {
      from: (...items: Array<{ dispose: () => void }>) => ({
        dispose: () => items.forEach((item) => item.dispose())
      })
    }
  };
});

import {
  collectExtractModuleCanvasTargets,
  collectExtractModuleSourceTargets,
  registerVscodeExtractModuleCommandFeature,
  VSCODE_EXTRACT_MODULE_COMMAND_ID,
  type ExtractModuleCanvasEndpoint
} from "./extractModuleCommandFeature";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { selectedElementSourcesForCanvasObservation } from "../../src/vscode/canvasObservation";
import { applyLineSplices, type LineSplice } from "../../src/document/textPatch";

const source = [
  "nui 1",
  "const width: number = 10",
  "const first: number = @width + 1",
  "const second: number = @first + 1",
  "const after: number = @second + 1"
].join("\n");

const moduleSource = [
  "nui 1",
  "module Stamp() {",
  "  group Body {",
  "    point Anchor = coordinate(x: 0, y: 0)",
  "  }",
  "}",
  "instance First = Stamp()",
  "instance Second = Stamp()",
  "point Ordinary = coordinate(x: 1, y: 1)"
].join("\n");

const positionAtOffset = (text: string, offset: number): { line: number; character: number } => {
  const prefix = text.slice(0, offset);
  const line = prefix.split("\n").length - 1;
  return { line, character: offset - (prefix.lastIndexOf("\n") + 1) };
};

const editorFor = (
  documentSource: () => string,
  selection: { start: number; end: number; active: number },
  uri = "file:///extract.nui"
) => {
  const document = {
    uri: { scheme: "file", toString: () => uri },
    fileName: uri.replace("file://", ""),
    version: 1,
    getText: () => documentSource(),
    offsetAt: (position: { line: number; character: number }) => {
      const lines = documentSource().split("\n");
      return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character;
    }
  };
  return {
    document,
    selection: {
      start: positionAtOffset(documentSource(), selection.start),
      end: positionAtOffset(documentSource(), selection.end),
      active: positionAtOffset(documentSource(), selection.active)
    }
  };
};

const statementNamesFor = (
  invocation: ReturnType<typeof collectExtractModuleSourceTargets>
): string[] => {
  if (!invocation) return [];
  return invocation.targets.flatMap((statementId) => {
    const index = invocation.compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    const statement = index === undefined ? undefined : invocation.compiled.statements[index];
    return statement?.name ? [statement.name] : [];
  });
};

const observationFor = (input: {
  documentVersion?: number;
  selectedElementIds: readonly string[];
  selectedElementSources: NonNullable<ReturnType<typeof selectedElementSourcesForCanvasObservation>>;
  isCurrent?: boolean;
}) => ({
  documentVersion: input.documentVersion ?? 1,
  selectedElementIds: input.selectedElementIds,
  selectedElementSources: input.selectedElementSources,
  selectionSubject: { kind: "elements" as const },
  canvasCanSelectInstance: true,
  compiledDocumentRevision: 1,
  previewActive: false,
  evaluationRevision: 1,
  evaluationRequestRevision: 1,
  evaluationStatus: "ready" as const,
  evaluationSource: "reference" as const,
  rustEligible: true,
  isStale: false,
  isCurrent: input.isCurrent ?? true,
  errorCount: 0,
  warningCount: 0,
  errorSummaries: [],
  warningSummaries: []
});

const compiledFor = (text: string) => {
  const session = createLanguageAnalysisSession(text);
  const sourceSnapshot = {
    normalizedSource: text,
    sourceRevision: session.getSourceRevision()
  };
  const compiled = session.definitionSemanticSnapshot(sourceSnapshot)?.compiled;
  if (!compiled) throw new Error("expected a compiled fixture");
  return { session, sourceSnapshot, compiled };
};

const commandFeatureFor = (input: {
  editor?: ReturnType<typeof editorFor>;
  canvasEditor?: ReturnType<typeof editorFor>;
  session: ReturnType<typeof createLanguageAnalysisSession>;
  endpoint?: ExtractModuleCanvasEndpoint | null;
  navigate?: (endpoint: ExtractModuleCanvasEndpoint, sourceOffset: number) => boolean;
  apply?: (
    editor: unknown,
    version: number,
    expectedSource: string,
    splices: readonly LineSplice[]
  ) => Promise<boolean>;
}) => {
  mocks.registerCommand.mockImplementation((id: string, handler: () => unknown) => {
    if (id === VSCODE_EXTRACT_MODULE_COMMAND_ID) mocks.commandHandler = handler;
    return { dispose: vi.fn() };
  });
  return registerVscodeExtractModuleCommandFeature({
    languageAnalysisSessionFor: () => input.session,
    activeSourceEditor: () => input.editor as never,
    sourceEditorForDocument: () => (input.canvasEditor ?? input.editor) as never,
    activeCanvasEndpoint: () => input.endpoint ?? null,
    navigateCanvasToSourceOffset: input.navigate ?? vi.fn(() => true),
    applySourceLineSplices: input.apply ?? (async () => true)
  });
};

const flushCommand = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  mocks.registerCommand.mockReset();
  mocks.executeCommand.mockClear();
  mocks.showInputBox.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.showInformationMessage.mockReset();
  mocks.showTextDocument.mockReset();
  mocks.commandHandler = undefined;
  mocks.activeEditorListeners.length = 0;
  mocks.selectionListeners.length = 0;
});

describe("VS Code Extract Module command feature", () => {
  it("collects all complete intersected authored statements and one caret statement", () => {
    const session = createLanguageAnalysisSession(source);
    const firstOffset = source.indexOf("const first");
    const secondEnd = source.indexOf("\nconst after");
    const selected = collectExtractModuleSourceTargets(
      editorFor(() => source, { start: firstOffset + 3, end: secondEnd - 2, active: firstOffset + 3 }) as never,
      () => session
    );
    expect(statementNamesFor(selected)).toEqual(["first", "second"]);

    const caretOffset = source.indexOf("const second") + 8;
    const caret = collectExtractModuleSourceTargets(
      editorFor(() => source, { start: caretOffset, end: caretOffset, active: caretOffset }) as never,
      () => session
    );
    expect(statementNamesFor(caret)).toEqual(["second"]);
  });

  it("recovers Source availability from the current selection or caret without planner legality", () => {
    const session = createLanguageAnalysisSession(source);
    let start = source.indexOf("const first");
    const editor = editorFor(() => source, { start, end: start, active: start });
    expect(collectExtractModuleSourceTargets(editor as never, () => session)?.targets).toHaveLength(1);

    start = source.indexOf("const width");
    editor.selection.start = positionAtOffset(source, start);
    editor.selection.end = positionAtOffset(source, start);
    editor.selection.active = positionAtOffset(source, start);
    expect(collectExtractModuleSourceTargets(editor as never, () => session)?.targets).toHaveLength(1);
    expect(mocks.executeCommand).not.toHaveBeenCalledWith("planExtractModule", expect.anything());
  });

  it("projects ordinary, concrete module-instance, and repeated Canvas selections in source order", () => {
    const { compiled, sourceSnapshot } = compiledFor(moduleSource);
    const elements = compiled.document?.elements ?? [];
    const first = elements.find((element) => element.name === "First");
    const second = elements.find((element) => element.name === "Second");
    const ordinary = elements.find((element) => element.name === "Ordinary");
    const body = elements.find((element) => element.name === "Body");
    expect(first && second && ordinary && body).toBeTruthy();
    if (!first || !second || !ordinary || !body) return;
    const selectedIds = [second.id, ordinary.id, first.id, second.id, body.id];
    const selectedSources = selectedElementSourcesForCanvasObservation(selectedIds, compiled, elements);
    const targets = collectExtractModuleCanvasTargets({
      snapshot: observationFor({ selectedElementIds: selectedIds, selectedElementSources: selectedSources }),
      source: sourceSnapshot,
      compiled
    });
    const names = targets.flatMap((statementId) => {
      const index = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
      const statement = index === undefined ? undefined : compiled.statements[index];
      return statement?.name ? [statement.name] : [];
    });
    expect(names).toEqual(["First", "Second", "Ordinary"]);
  });

  it("rejects a mixed authored and moduleBody Canvas selection before naming or mutation", async () => {
    const { session, compiled, sourceSnapshot } = compiledFor(moduleSource);
    const elements = compiled.document?.elements ?? [];
    const first = elements.find((element) => element.name === "First");
    const body = elements.find((element) => element.name === "Body");
    expect(first && body).toBeTruthy();
    if (!first || !body) return;
    const selectedElementIds = [first.id, body.id];
    const selectedElementSources = selectedElementSourcesForCanvasObservation(selectedElementIds, compiled, elements);
    const editor = editorFor(() => moduleSource, { start: 0, end: 0, active: 0 }, "file:///mixed-extract.nui");
    const endpoint: ExtractModuleCanvasEndpoint = {
      document: editor.document as never,
      panel: { webview: {} } as never,
      isAuthoritativeReady: () => true,
      observation: () => observationFor({ selectedElementIds, selectedElementSources, documentVersion: 1 }) as never
    };
    const apply = vi.fn(async () => true);
    mocks.showInputBox.mockImplementation(() => {
      throw new Error("naming flow must not start for a mixed moduleBody selection");
    });
    const feature = commandFeatureFor({ session, canvasEditor: editor, endpoint, apply });

    await mocks.commandHandler?.();
    await flushCommand();

    expect(mocks.showInputBox).not.toHaveBeenCalled();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("moduleBody descendant"));
    expect(collectExtractModuleCanvasTargets({ snapshot: observationFor({ selectedElementIds, selectedElementSources }), source: sourceSnapshot, compiled })).toHaveLength(1);
    feature.dispose();
  });

  it("rejects a moduleBody-only Canvas selection and stale observation", () => {
    const { compiled, sourceSnapshot } = compiledFor(moduleSource);
    const body = compiled.document?.elements.find((element) => element.name === "Body");
    expect(body).toBeDefined();
    if (!body) return;
    const selectedSources = selectedElementSourcesForCanvasObservation([body.id], compiled, compiled.document?.elements ?? []);
    expect(selectedSources).toHaveLength(1);
    expect(collectExtractModuleCanvasTargets({
      snapshot: observationFor({ selectedElementIds: [body.id], selectedElementSources: selectedSources }),
      source: sourceSnapshot,
      compiled
    })).toEqual([]);
    expect(collectExtractModuleCanvasTargets({
      snapshot: observationFor({ selectedElementIds: [body.id], selectedElementSources: selectedSources, isCurrent: false }),
      source: sourceSnapshot,
      compiled
    })).toEqual([]);
  });

  it("follows InputBox and QuickPick normal naming and applies the complete planner batch once", async () => {
    const editor = editorFor(() => source, {
      start: source.indexOf("const first"),
      end: source.indexOf("const first") + "const first: number = @width + 1".length,
      active: source.indexOf("const first")
    });
    const { session } = compiledFor(source);
    mocks.showInputBox.mockResolvedValue("Part");
    mocks.showQuickPick.mockResolvedValue({ label: "Use module name: PartModule" });
    const apply = vi.fn(async () => true);
    const navigate = vi.fn(() => true);
    const feature = commandFeatureFor({ editor, session, apply, navigate });

    await mocks.commandHandler?.();
    await flushCommand();

    expect(mocks.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ title: "Instance name", prompt: "Instance name" }));
    expect(mocks.showQuickPick).toHaveBeenCalledWith([
      { label: "Use module name: PartModule" },
      { label: "Rename module..." }
    ], { title: "Module name" });
    expect(apply).toHaveBeenCalledTimes(1);
    const applyCall = apply.mock.calls[0] as unknown as [unknown, number, string, readonly LineSplice[]] | undefined;
    expect(applyCall?.[3].length ?? 0).toBeGreaterThan(0);
    expect(navigate).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("uses the explicit Rename module... second InputBox", async () => {
    const editor = editorFor(() => source, {
      start: source.indexOf("const first"),
      end: source.indexOf("const first") + "const first: number = @width + 1".length,
      active: source.indexOf("const first")
    });
    const { session } = compiledFor(source);
    mocks.showInputBox.mockResolvedValueOnce("Part").mockResolvedValueOnce("Custom");
    mocks.showQuickPick.mockResolvedValue({ label: "Rename module..." });
    const apply = vi.fn(async () => true);
    const feature = commandFeatureFor({ editor, session, apply });

    await mocks.commandHandler?.();
    await flushCommand();

    expect(mocks.showInputBox).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: "Module name", prompt: "Module name" }));
    expect(apply).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("requires explicit rename for an invalid or colliding deterministic module candidate", async () => {
    const collisionSource = [
      "nui 1",
      "module PartModule() {",
      "}",
      "const value: number = 1"
    ].join("\n");
    const targetOffset = collisionSource.indexOf("const value");
    const editor = editorFor(() => collisionSource, { start: targetOffset, end: targetOffset, active: targetOffset });
    const { session } = compiledFor(collisionSource);
    mocks.showInputBox.mockResolvedValue("Part");
    mocks.showQuickPick.mockResolvedValue({ label: "Use module name: PartModule" });
    const apply = vi.fn(async () => true);
    const feature = commandFeatureFor({ editor, session, apply });

    await mocks.commandHandler?.();
    await flushCommand();

    expect(apply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage.mock.calls.some(([message]) => String(message).includes("既存 declaration"))).toBe(true);
    feature.dispose();
  });

  it.each([
    ["instance InputBox", undefined, undefined],
    ["QuickPick", "Part", undefined],
    ["module InputBox", "Part", "Rename module..."]
  ])("cancelling at %s leaves Source unchanged", async (_stage, instanceName, choice) => {
    const editor = editorFor(() => source, {
      start: source.indexOf("const first"),
      end: source.indexOf("const first") + "const first: number = @width + 1".length,
      active: source.indexOf("const first")
    });
    const { session } = compiledFor(source);
    if (instanceName === undefined) {
      mocks.showInputBox.mockResolvedValue(undefined);
    } else if (choice === undefined) {
      mocks.showInputBox.mockResolvedValue(instanceName);
      mocks.showQuickPick.mockResolvedValue(undefined);
    } else {
      mocks.showInputBox.mockResolvedValueOnce(instanceName).mockResolvedValueOnce(undefined);
      mocks.showQuickPick.mockResolvedValue({ label: choice });
    }
    const apply = vi.fn(async () => true);
    const feature = commandFeatureFor({ editor, session, apply });

    await mocks.commandHandler?.();
    await flushCommand();

    expect(apply).not.toHaveBeenCalled();
    expect(editor.document.getText()).toBe(source);
    feature.dispose();
  });

  it("propagates planner rejection and performs no edit", async () => {
    const versionOffset = 0;
    const editor = editorFor(() => source, { start: versionOffset, end: versionOffset, active: versionOffset });
    const { session } = compiledFor(source);
    mocks.showInputBox.mockResolvedValue("Part");
    mocks.showQuickPick.mockResolvedValue({ label: "Use module name: PartModule" });
    const apply = vi.fn(async () => true);
    const feature = commandFeatureFor({ editor, session, apply });

    await mocks.commandHandler?.();
    await flushCommand();

    expect(apply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("nuinuiCAD:"));
    feature.dispose();
  });

  it("fails closed when Source changes while naming is in progress", async () => {
    let currentSource = source;
    const editor = editorFor(() => currentSource, {
      start: source.indexOf("const first"),
      end: source.indexOf("const first") + "const first: number = @width + 1".length,
      active: source.indexOf("const first")
    });
    const { session } = compiledFor(source);
    mocks.showInputBox.mockImplementation(async () => {
      currentSource = `${source}\nconst changed: number = 1`;
      editor.document.version = 2;
      return "Part";
    });
    mocks.showQuickPick.mockResolvedValue({ label: "Use module name: PartModule" });
    const apply = vi.fn(async () => true);
    const feature = commandFeatureFor({ editor, session, apply });

    await mocks.commandHandler?.();
    await flushCommand();

    expect(apply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("state changed"));
    feature.dispose();
  });

  it("waits for the authoritative new Canvas state, resolves the generated instance, and navigates by new source offset", async () => {
    let currentSource = moduleSource;
    const initial = compiledFor(moduleSource);
    const { session } = initial;
    const editor = editorFor(() => currentSource, { start: 0, end: 0, active: 0 }, "file:///canvas-extract.nui");
    editor.document.getText = () => currentSource;
    const first = initial.compiled.document?.elements.find((element) => element.name === "First");
    expect(first).toBeDefined();
    if (!first) return;
    const initialSources = selectedElementSourcesForCanvasObservation([first.id], initial.compiled, initial.compiled.document?.elements ?? []);
    let currentObservation = observationFor({ selectedElementIds: [first.id], selectedElementSources: initialSources });
    let authoritativeReady = true;
    const endpoint: ExtractModuleCanvasEndpoint = {
      document: editor.document as never,
      panel: { webview: {} } as never,
      isAuthoritativeReady: () => authoritativeReady,
      observation: () => currentObservation as never
    };
    const navigate = vi.fn(() => true);
    mocks.showInputBox.mockResolvedValue("Part");
    mocks.showQuickPick.mockResolvedValue({ label: "Use module name: PartModule" });
    mocks.registerCommand.mockImplementation((id: string, handler: () => unknown) => {
      if (id === VSCODE_EXTRACT_MODULE_COMMAND_ID) mocks.commandHandler = handler;
      return { dispose: vi.fn() };
    });
    let appliedSource = "";
    const apply = vi.fn(async (_editor, version, expectedSource, splices) => {
      expect(version).toBe(1);
      expect(expectedSource).toBe(moduleSource);
      authoritativeReady = false;
      appliedSource = applyLineSplices(expectedSource, splices);
      currentSource = appliedSource;
      editor.document.version = 2;
      session.replaceSource(currentSource);
      const next = session.definitionSemanticSnapshot({
        normalizedSource: currentSource,
        sourceRevision: session.getSourceRevision()
      })?.compiled;
      if (!next) throw new Error("expected post-edit compilation");
      const generated = next.document?.elements.find((element) => element.name === "First");
      expect(generated).toBeDefined();
      currentObservation = observationFor({
        documentVersion: 2,
        selectedElementIds: generated ? [generated.id] : [],
        selectedElementSources: generated
          ? selectedElementSourcesForCanvasObservation([generated.id], next, next.document?.elements ?? [])
          : []
      });
      return true;
    });
    const feature = registerVscodeExtractModuleCommandFeature({
      languageAnalysisSessionFor: () => session,
      activeSourceEditor: () => undefined,
      sourceEditorForDocument: () => editor as never,
      activeCanvasEndpoint: () => endpoint,
      navigateCanvasToSourceOffset: navigate,
      applySourceLineSplices: apply
    });

    await mocks.commandHandler?.();
    await flushCommand();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    authoritativeReady = true;
    feature.handleCanvasAuthoritativeDocumentReady(editor.document as never, 2);

    expect(appliedSource).toContain("instance Part = PartModule()");
    expect(navigate).toHaveBeenCalledWith(endpoint, expect.any(Number));
    feature.dispose();
  });
});
