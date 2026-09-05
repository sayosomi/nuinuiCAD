import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerCommand: vi.fn(),
  executeCommand: vi.fn(() => Promise.resolve()),
  getConfiguration: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
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
    workspace: {
      getConfiguration: mocks.getConfiguration
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
      showTextDocument: mocks.showTextDocument,
      showErrorMessage: mocks.showErrorMessage,
      showWarningMessage: mocks.showWarningMessage,
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
  collectInlineModuleSourceTargets,
  inlineModulePolicyForSettings,
  reproveInlineModuleCanvasTargets,
  registerVscodeInlineModuleCommandFeature,
  VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID
} from "./inlineModuleCommandFeature";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticBridgeFor
} from "./languageAnalysisSession";
import { inlineModuleCanvasTargetProofsFor } from "../../src/vscode/inlineModuleCanvas";
import * as inlineModulePlanner from "../../src/document/inlineModulePlanner";
import { applyLineSplices, type LineSplice } from "../../src/document/textPatch";

const source = [
  "nui 1",
  "module Stamp() {",
  "  point Anchor = coordinate(x: 0, y: 0)",
  "}",
  "module Outer() {",
  "  instance Child = Stamp()",
  "}",
  "instance Top = Outer()",
  "point Ordinary = coordinate(x: 1, y: 1)"
].join("\n");

const positionAtOffset = (text: string, offset: number): { line: number; character: number } => {
  const prefix = text.slice(0, offset);
  const line = prefix.split("\n").length - 1;
  return { line, character: offset - (prefix.lastIndexOf("\n") + 1) };
};

const editorFor = (
  documentSource: string,
  selection: { start: number; end: number; active: number }
) => {
  const document = {
    uri: { scheme: "file", toString: () => "file:///inline.nui" },
    fileName: "/inline.nui",
    version: 1,
    getText: () => documentSource,
    offsetAt: (position: { line: number; character: number }) => {
      const lines = documentSource.split("\n");
      return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character;
    }
  };
  return {
    document,
    selection: {
      start: positionAtOffset(documentSource, selection.start),
      end: positionAtOffset(documentSource, selection.end),
      active: positionAtOffset(documentSource, selection.active)
    }
  };
};

const sessionFor = (() => {
  const session = createLanguageAnalysisSession(source);
  return () => session;
})();

const canvasFixtureFor = (canvasSource: string) => {
  let currentSource = canvasSource;
  const document = {
    uri: { scheme: "file", toString: () => "file:///canvas-inline.nui" },
    fileName: "/canvas-inline.nui",
    version: 1,
    getText: () => currentSource
  };
  const editor = { document };
  const session = createLanguageAnalysisSession(canvasSource);
  const sourceSnapshot = {
    normalizedSource: canvasSource,
    sourceRevision: session.getSourceRevision()
  };
  const compiled = currentCompiledSemanticBridgeFor(session, sourceSnapshot)!.compiled;
  const runtimeEntry = compiled.moduleMaterialization!.executionStatements.find((entry) => entry.type === "moduleInstance")!;
  const elements = [{
    id: runtimeEntry.runtimeElementId,
    name: runtimeEntry.statement.name,
    type: "moduleInstance",
    activity: "visible"
  }];
  const targets = inlineModuleCanvasTargetProofsFor({
    source: sourceSnapshot,
    compiled,
    elements: elements as never,
    selectedElementIds: [runtimeEntry.runtimeElementId],
    moduleMaterialization: compiled.moduleMaterialization
  });
  const postMessage = vi.fn(() => Promise.resolve(true));
  const endpoint = {
    document,
    panel: { webview: { postMessage } },
    isAuthoritativeReady: () => true
  };
  const apply = vi.fn(async (
    _editor: unknown,
    expectedVersion: number,
    expectedSource: string,
    splices: readonly LineSplice[]
  ) => {
    if (document.version !== expectedVersion || currentSource !== expectedSource) return false;
    currentSource = applyLineSplices(expectedSource, splices);
    document.version = expectedVersion + 1;
    session.replaceSource(currentSource);
    return true;
  });
  return {
    document,
    editor,
    endpoint,
    session,
    initialPublication: {
      type: "inlineModuleCanvasTargetsPublication" as const,
      documentVersion: 1,
      normalizedSource: canvasSource,
      targets
    },
    apply,
    postMessage,
    getCurrentSource: () => currentSource
  };
};

describe("VS Code Inline Module command feature", () => {
  it("collects authored Module instances for selections and caret positions, including nested body instances", () => {
    const childOffset = source.indexOf("instance Child");
    const childEditor = editorFor(source, { start: childOffset, end: childOffset, active: childOffset });
    const child = collectInlineModuleSourceTargets(childEditor as never, sessionFor);
    expect(child?.targets).toHaveLength(1);

    const selectedEditor = editorFor(source, { start: 0, end: source.length, active: source.length });
    const selected = collectInlineModuleSourceTargets(selectedEditor as never, sessionFor);
    const compiled = currentCompiledSemanticBridgeFor(sessionFor(), {
      normalizedSource: source,
      sourceRevision: sessionFor().getSourceRevision()
    })!.compiled!;
    const selectedNames = selected!.targets.map((target) => {
      const index = compiled.statementMap!.statementIndexByStatementId!.get(target.statementId)!;
      return compiled.statements[index]!.name;
    });
    expect(selectedNames).toEqual(["Child", "Top"]);
    expect(selectedNames).not.toContain("Ordinary");

    const ordinaryOffset = source.indexOf("point Ordinary");
    const ordinary = collectInlineModuleSourceTargets(
      editorFor(source, { start: ordinaryOffset, end: ordinaryOffset, active: ordinaryOffset }) as never,
      sessionFor
    );
    expect(ordinary?.targets).toEqual([]);
  });

  it("reads the three Inline Module settings with the settled defaults", () => {
    mocks.getConfiguration.mockReturnValue({
      get: (_key: string, fallback: unknown) => fallback
    });
    expect(inlineModulePolicyForSettings()).toEqual({
      emitOmittedBranchComments: true,
      includeHiddenInstances: false,
      includeDisabledInstances: false
    });
  });

  it("re-proves Canvas authored owners against the current materialization and rejects stale proof", () => {
    const session = createLanguageAnalysisSession(source);
    const sourceSnapshot = {
      normalizedSource: source,
      sourceRevision: session.getSourceRevision()
    };
    const compiled = currentCompiledSemanticBridgeFor(session, sourceSnapshot)!.compiled;
    const runtimeEntry = compiled.moduleMaterialization!.executionStatements.find((entry) => entry.type === "moduleInstance");
    expect(runtimeEntry).toBeDefined();
    if (!runtimeEntry) return;

    const proofs = inlineModuleCanvasTargetProofsFor({
      source: sourceSnapshot,
      compiled,
      elements: [{
        id: runtimeEntry.runtimeElementId,
        name: runtimeEntry.statement.name,
        type: "moduleInstance",
        activity: "visible"
      } as never],
      selectedElementIds: [runtimeEntry.runtimeElementId],
      moduleMaterialization: compiled.moduleMaterialization
    });
    expect(proofs).toHaveLength(1);
    const publication = {
      type: "inlineModuleCanvasTargetsPublication" as const,
      documentVersion: 1,
      normalizedSource: source,
      targets: proofs
    };
    expect(reproveInlineModuleCanvasTargets({ publication, source: sourceSnapshot, compiled })).toEqual([
      { documentKey: null, statementId: proofs[0]!.sourceStatementId }
    ]);
    expect(reproveInlineModuleCanvasTargets({
      publication: {
        ...publication,
        targets: [{ ...proofs[0]!, sourceStatementId: "stale-canvas-id" }]
      },
      source: sourceSnapshot,
      compiled
    })).toEqual([]);
    expect(reproveInlineModuleCanvasTargets({
      publication,
      source: { ...sourceSnapshot, sourceRevision: sourceSnapshot.sourceRevision + 1 },
      compiled
    })).toEqual([]);
  });

  it("forwards the execution-time policy unchanged to the planner", async () => {
    const policySource = [
      "nui 1",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance Hidden(state: hidden) = Stamp()",
      "instance Disabled(state: disabled) = Stamp()"
    ].join("\n");
    const hiddenOffset = policySource.indexOf("instance Hidden");
    const editor = editorFor(policySource, { start: hiddenOffset, end: policySource.length, active: hiddenOffset });
    const session = createLanguageAnalysisSession(policySource);
    const apply = vi.fn(async () => true);
    const plannerSpy = vi.spyOn(inlineModulePlanner, "planInlineModule");
    mocks.getConfiguration.mockReturnValue({
      get: (key: string, fallback: unknown) => ({
        "inlineModule.emitOmittedBranchComments": false,
        "inlineModule.includeHiddenInstances": true,
        "inlineModule.includeDisabledInstances": true
      }[key] ?? fallback)
    });
    mocks.registerCommand.mockImplementation((id: string, handler: () => unknown) => {
      if (id === VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID) mocks.commandHandler = handler;
      return { dispose: vi.fn() };
    });

    const feature = registerVscodeInlineModuleCommandFeature({
      languageAnalysisSessionFor: () => session,
      activeSourceEditor: () => editor,
      sourceEditorForDocument: () => editor,
      activeCanvasEndpoint: () => null,
      applySourceLineSplices: apply
    });
    await mocks.commandHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(plannerSpy).toHaveBeenCalledWith(expect.objectContaining({
      policy: {
        emitOmittedBranchComments: false,
        includeHiddenInstances: true,
        includeDisabledInstances: true
      }
    }));
    expect(apply).toHaveBeenCalledTimes(1);
    plannerSpy.mockRestore();
    feature.dispose();
  });

  it("executes from a current Canvas target and requests post-edit selection by generated group", async () => {
    const canvasSource = [
      "nui 1",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance Top = Stamp()"
    ].join("\n");
    const fixture = canvasFixtureFor(canvasSource);
    expect(fixture.initialPublication.targets).toHaveLength(1);
    mocks.getConfiguration.mockReturnValue({ get: (_key: string, fallback: unknown) => fallback });
    mocks.registerCommand.mockImplementation((id: string, handler: () => unknown) => {
      if (id === VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID) mocks.commandHandler = handler;
      return { dispose: vi.fn() };
    });
    const feature = registerVscodeInlineModuleCommandFeature({
      languageAnalysisSessionFor: () => fixture.session,
      activeSourceEditor: () => undefined,
      sourceEditorForDocument: () => fixture.editor,
      activeCanvasEndpoint: () => fixture.endpoint,
      applySourceLineSplices: fixture.apply
    });
    feature.handleCanvasTargetsPublication(fixture.document as never, fixture.initialPublication);

    await mocks.commandHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.apply).toHaveBeenCalledTimes(1);
    expect(fixture.getCurrentSource()).not.toBe(canvasSource);

    const currentSourceSnapshot = {
      normalizedSource: fixture.getCurrentSource(),
      sourceRevision: fixture.session.getSourceRevision()
    };
    const currentCompiled = currentCompiledSemanticBridgeFor(fixture.session, currentSourceSnapshot)!.compiled;
    const generatedGroupIndex = currentCompiled.statements.findIndex((statement) =>
      statement.kind === "group" && statement.name === "Top"
    );
    const generatedGroup = currentCompiled.statements[generatedGroupIndex];
    expect(generatedGroup?.kind).toBe("group");
    if (generatedGroupIndex < 0 || generatedGroup?.kind !== "group") return;

    feature.handleCanvasTargetsPublication(fixture.document as never, {
      type: "inlineModuleCanvasTargetsPublication",
      documentVersion: fixture.document.version,
      normalizedSource: fixture.getCurrentSource(),
      targets: []
    });

    const request = fixture.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "inlineModuleSelectionRequest");
    expect(request).toMatchObject({
      type: "inlineModuleSelectionRequest",
      documentVersion: fixture.document.version,
      normalizedSource: fixture.getCurrentSource(),
      generatedGroups: [{
        sourceStatementIndex: generatedGroupIndex,
        sourceRange: {
          from: generatedGroup.documentRange.from,
          to: generatedGroup.documentRange.to
        },
        generatedGroupName: "Top"
      }]
    });
    expect(request).not.toHaveProperty("runtimeElementId");
    feature.dispose();
  });

  it("does not mutate when Canvas proof or authoritative readiness becomes stale", async () => {
    const canvasSource = [
      "nui 1",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance Top = Stamp()"
    ].join("\n");
    const staleProofFixture = canvasFixtureFor(canvasSource);
    const staleProof = {
      ...staleProofFixture.initialPublication,
      targets: [{
        ...staleProofFixture.initialPublication.targets[0]!,
        sourceRange: {
          from: staleProofFixture.initialPublication.targets[0]!.sourceRange.from,
          to: staleProofFixture.initialPublication.targets[0]!.sourceRange.to + 1
        }
      }]
    };
    mocks.showErrorMessage.mockClear();
    mocks.getConfiguration.mockReturnValue({ get: (_key: string, fallback: unknown) => fallback });
    mocks.registerCommand.mockImplementation((id: string, handler: () => unknown) => {
      if (id === VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID) mocks.commandHandler = handler;
      return { dispose: vi.fn() };
    });
    const staleProofFeature = registerVscodeInlineModuleCommandFeature({
      languageAnalysisSessionFor: () => staleProofFixture.session,
      activeSourceEditor: () => undefined,
      sourceEditorForDocument: () => staleProofFixture.editor,
      activeCanvasEndpoint: () => staleProofFixture.endpoint,
      applySourceLineSplices: staleProofFixture.apply
    });
    staleProofFeature.handleCanvasTargetsPublication(staleProofFixture.document as never, staleProof);
    await mocks.commandHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(staleProofFixture.apply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: No concrete Module instance is selected on the current Canvas."
    );
    staleProofFeature.dispose();

    const staleStateFixture = canvasFixtureFor(canvasSource);
    let authoritativeReady = true;
    staleStateFixture.endpoint.isAuthoritativeReady = () => authoritativeReady;
    mocks.showErrorMessage.mockClear();
    mocks.getConfiguration.mockReturnValue({
      get: (_key: string, fallback: unknown) => {
        authoritativeReady = false;
        return fallback;
      }
    });
    const staleStateFeature = registerVscodeInlineModuleCommandFeature({
      languageAnalysisSessionFor: () => staleStateFixture.session,
      activeSourceEditor: () => undefined,
      sourceEditorForDocument: () => staleStateFixture.editor,
      activeCanvasEndpoint: () => staleStateFixture.endpoint,
      applySourceLineSplices: staleStateFixture.apply
    });
    staleStateFeature.handleCanvasTargetsPublication(staleStateFixture.document as never, staleStateFixture.initialPublication);
    await mocks.commandHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(staleStateFixture.apply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Source or Canvas state changed. No changes were made; run Inline Module again."
    );
    staleStateFeature.dispose();
  });

  it("keeps targetless Source unavailable and rejects a stale Source before mutation", async () => {
    mocks.showErrorMessage.mockClear();
    mocks.executeCommand.mockClear();
    const ordinaryOffset = source.indexOf("point Ordinary");
    const targetlessEditor = editorFor(source, {
      start: ordinaryOffset,
      end: ordinaryOffset,
      active: ordinaryOffset
    });
    const targetlessApply = vi.fn(async () => true);
    const targetlessFeature = registerVscodeInlineModuleCommandFeature({
      languageAnalysisSessionFor: sessionFor,
      activeSourceEditor: () => targetlessEditor,
      sourceEditorForDocument: () => targetlessEditor,
      activeCanvasEndpoint: () => null,
      applySourceLineSplices: targetlessApply
    });
    await mocks.commandHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(targetlessApply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: No authored Module instance is selected at the current Source position."
    );
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.inlineModuleSourceTarget",
      false
    );
    targetlessFeature.dispose();

    let currentSource = source;
    const staleDocument = {
      uri: { scheme: "file", toString: () => "file:///stale-inline.nui" },
      fileName: "/stale-inline.nui",
      version: 1,
      getText: () => currentSource,
      offsetAt: (position: { line: number; character: number }) => {
        const lines = currentSource.split("\n");
        return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character;
      }
    };
    const topOffset = source.indexOf("instance Top");
    const staleEditor = {
      document: staleDocument,
      selection: {
        start: positionAtOffset(source, topOffset),
        end: positionAtOffset(source, topOffset),
        active: positionAtOffset(source, topOffset)
      }
    };
    const staleSession = createLanguageAnalysisSession(source);
    const staleApply = vi.fn(async () => true);
    let changedDuringSettings = false;
    mocks.getConfiguration.mockReturnValue({
      get: (_key: string, fallback: unknown) => {
        if (!changedDuringSettings) {
          changedDuringSettings = true;
          currentSource = `${source}\n// changed while planning`;
          staleDocument.version = 2;
        }
        return fallback;
      }
    });
    const staleFeature = registerVscodeInlineModuleCommandFeature({
      languageAnalysisSessionFor: () => staleSession,
      activeSourceEditor: () => staleEditor,
      sourceEditorForDocument: () => staleEditor,
      activeCanvasEndpoint: () => null,
      applySourceLineSplices: staleApply
    });
    await mocks.commandHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(staleApply).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Source or Canvas state changed. No changes were made; run Inline Module again."
    );
    staleFeature.dispose();
  });

  it("registers one shared target-contextual command and applies one source splice batch", async () => {
    const editor = editorFor(source, {
      start: source.indexOf("instance Top"),
      end: source.indexOf("instance Top"),
      active: source.indexOf("instance Top")
    });
    const apply = vi.fn(async () => true);
    const session = createLanguageAnalysisSession(source);
    const activeSourceEditor = vi.fn(() => editor);
    mocks.registerCommand.mockImplementation((id: string, handler: () => unknown) => {
      if (id === VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID) mocks.commandHandler = handler;
      return { dispose: vi.fn() };
    });
    mocks.getConfiguration.mockReturnValue({ get: (_key: string, fallback: unknown) => fallback });

    const feature = registerVscodeInlineModuleCommandFeature({
      languageAnalysisSessionFor: () => session,
      activeSourceEditor,
      sourceEditorForDocument: () => editor,
      activeCanvasEndpoint: () => null,
      applySourceLineSplices: apply
    });

    expect(mocks.registerCommand).toHaveBeenCalledWith(VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID, expect.any(Function));
    await mocks.commandHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[3]).toHaveLength(1);
    expect(mocks.showTextDocument).not.toHaveBeenCalled();
    feature.dispose();
  });
});
