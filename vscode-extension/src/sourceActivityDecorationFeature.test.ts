import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateElementsReference } from "../../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import type { NuiRuntimeEvaluationSnapshot } from "./runtimeEvaluationService";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  lineCount: number;
  getText: () => string;
};

type TestEditor = {
  document: TestDocument;
  selection: { active: { line: number; character: number } };
  setDecorations: ReturnType<typeof vi.fn>;
};

type DecorationType = {
  options: unknown;
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  visibleTextEditors: [] as TestEditor[],
  textDocuments: [] as TestDocument[],
  visibleEditorListeners: [] as Array<() => void>,
  activeEditorListeners: [] as Array<() => void>,
  openListeners: [] as Array<(document: TestDocument) => void>,
  changeListeners: [] as Array<(event: { document: TestDocument; contentChanges: readonly unknown[] }) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>,
  decorationTypes: [] as DecorationType[]
}));

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  const listener = <T>(listeners: T[], value: T) => {
    listeners.push(value);
    return { dispose: () => {
      const index = listeners.indexOf(value);
      if (index >= 0) listeners.splice(index, 1);
    } };
  };
  return {
    Position,
    Range,
    window: {
      get visibleTextEditors() {
        return mocks.visibleTextEditors;
      },
      createTextEditorDecorationType: (options: unknown) => {
        const type = { options, dispose: vi.fn() };
        mocks.decorationTypes.push(type);
        return type;
      },
      onDidChangeVisibleTextEditors: (handler: () => void) => listener(mocks.visibleEditorListeners, handler),
      onDidChangeActiveTextEditor: (handler: () => void) => listener(mocks.activeEditorListeners, handler)
    },
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      onDidOpenTextDocument: (handler: (document: TestDocument) => void) => listener(mocks.openListeners, handler),
      onDidChangeTextDocument: (handler: (event: { document: TestDocument; contentChanges: readonly unknown[] }) => void) => listener(mocks.changeListeners, handler),
      onDidCloseTextDocument: (handler: (document: TestDocument) => void) => listener(mocks.closeListeners, handler)
    }
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import {
  registerNuiSourceActivityDecorationFeature,
  sourceActivityDecorationProjectionFor
} from "./sourceActivityDecorationFeature";

const sourceFor = (lines: readonly string[]): string => lines.join("\n");

const activitySource = sourceFor([
  "nui 1",
  "role seam (name: \"seam\")",
  "view Draft (default: false, seam: false)",
  "activeView Draft",
  "point HiddenSelf = coordinate(x: 0, y: 0, state: hidden)",
  "point DisabledSelf = coordinate(x: 1, y: 1, state: disabled)",
  "group HiddenGroup (state: hidden) {",
  "  point HiddenByGroup = coordinate(x: 2, y: 2)",
  "}",
  "group DisabledGroup (state: disabled) {",
  "  point DisabledByGroup = coordinate(x: 3, y: 3)",
  "}",
  "group ProfileGroup (roles: [seam]) {",
  "  point HiddenByProfile = coordinate(x: 4, y: 4)",
  "}",
  "if (false) {",
  "  point ConditionInactive = coordinate(x: 5, y: 5)",
  "}",
  "point MultiHidden = coordinate(",
  "  x: 0,",
  "  y: 0,",
  "  state: hidden",
  ")"
]);

const snapshotFor = (
  source: string,
  documentKey = "file:///tmp/pattern.nui",
  documentVersion = 1
): NuiRuntimeEvaluationSnapshot => {
  const session = createLanguageAnalysisSession(source);
  const semantic = session.runtimeEvaluationSnapshot();
  if (!semantic) throw new Error("expected exact-current compiled source");
  const evaluation = evaluateElementsReference(
    semantic.compiled.document.elements,
    buildEvaluationOptions({
      compiledDocument: semantic.compiled,
      evaluationLimitIndex: semantic.compiled.document.evaluationLimitIndex
    })
  );
  return {
    proof: {
      documentKey,
      documentVersion,
      sourceRevision: semantic.sourceRevision,
      normalizedSource: semantic.sourceText,
      documentRevision: semantic.documentRevision,
      compiledDocumentRevision: semantic.compiledDocumentRevision
    },
    compiled: semantic.compiled,
    evaluation,
    source: "reference",
    rustEligible: false
  };
};

const documentFor = (
  source: string,
  documentVersion = 1,
  fileName = "/tmp/pattern.nui"
): TestDocument => ({
  fileName,
  version: documentVersion,
  uri: { scheme: "file", toString: () => `file://${fileName}` },
  lineCount: source.split(/\r\n|\n/).length,
  getText: () => source
});

const editorFor = (document: TestDocument): TestEditor => ({
  document,
  selection: { active: { line: 0, character: 0 } },
  setDecorations: vi.fn()
});

const runtimeFor = (snapshots: ReadonlyMap<string, NuiRuntimeEvaluationSnapshot>) => ({
  evaluateCurrent: vi.fn(async (request: { documentKey: string }) => snapshots.get(request.documentKey)),
  invalidateDocument: vi.fn(),
  closeDocument: vi.fn(),
  dispose: vi.fn()
});

const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const resetMocks = (): void => {
  mocks.visibleTextEditors.length = 0;
  mocks.textDocuments.length = 0;
  mocks.visibleEditorListeners.length = 0;
  mocks.activeEditorListeners.length = 0;
  mocks.openListeners.length = 0;
  mocks.changeListeners.length = 0;
  mocks.closeListeners.length = 0;
  mocks.decorationTypes.length = 0;
};

afterEach(resetMocks);

describe("VS Code native Source activity decorations", () => {
  it("uses shared presentation statuses and compiler-owned physical statement lines", () => {
    const snapshot = snapshotFor(activitySource);
    const compiled = snapshot.compiled;
    const projection = sourceActivityDecorationProjectionFor({
      compiled,
      evaluation: snapshot.evaluation
    });
    const nameFor = new Map(compiled.document.elements.map((element) => [element.id, element.name]));
    const names = (ranges: readonly { elementId: string; startLine: number; endLine: number }[]) =>
      ranges.map((range) => ({ ...range, name: nameFor.get(range.elementId) }));

    expect(names(projection.hidden)).toEqual([
      expect.objectContaining({ name: "HiddenSelf", startLine: 5, endLine: 5 }),
      expect.objectContaining({ name: "HiddenGroup", startLine: 7, endLine: 7 }),
      expect.objectContaining({ name: "HiddenByGroup", startLine: 8, endLine: 8 }),
      expect.objectContaining({ name: "ProfileGroup", startLine: 13, endLine: 13 }),
      expect.objectContaining({ name: "HiddenByProfile", startLine: 14, endLine: 14 }),
      expect.objectContaining({ name: "MultiHidden", startLine: 19, endLine: 23 })
    ]);
    expect(names(projection.disabled)).toEqual([
      expect.objectContaining({ name: "DisabledSelf", startLine: 6, endLine: 6 }),
      expect.objectContaining({ name: "DisabledGroup", startLine: 10, endLine: 10 }),
      expect.objectContaining({ name: "DisabledByGroup", startLine: 11, endLine: 11 }),
      expect.objectContaining({ name: "ConditionInactive", startLine: 17, endLine: 17 })
    ]);
  });

  it("creates separate whole-line, fade-only Hidden and Disabled presentations", () => {
    const runtime = runtimeFor(new Map());
    const feature = registerNuiSourceActivityDecorationFeature({
      rustProcessOwner: { get: vi.fn() } as never,
      sessionFor: () => createLanguageAnalysisSession("nui 1\n"),
      runtimeEvaluation: runtime
    });

    expect(mocks.decorationTypes).toHaveLength(2);
    expect(mocks.decorationTypes[0]).not.toBe(mocks.decorationTypes[1]);
    const hidden = mocks.decorationTypes[0]!.options as Record<string, unknown>;
    const disabled = mocks.decorationTypes[1]!.options as Record<string, unknown>;
    expect(hidden).toEqual({
      isWholeLine: true,
      opacity: "0.72"
    });
    expect(disabled).toEqual({
      isWholeLine: true,
      opacity: "0.48"
    });
    for (const decoration of [hidden, disabled]) {
      for (const property of [
        "backgroundColor",
        "border",
        "borderColor",
        "borderStyle",
        "borderWidth",
        "outline",
        "color",
        "textDecoration"
      ]) {
        expect(decoration).not.toHaveProperty(property);
      }
    }

    feature.dispose();
    expect(mocks.decorationTypes[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.decorationTypes[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it("applies only exact-current matching document results to all visible editors", async () => {
    const source = "nui 1\npoint Hidden = coordinate(x: 0, y: 0, state: hidden)";
    const documentA = documentFor(source, 1, "/tmp/a.nui");
    const documentB = documentFor(source, 1, "/tmp/b.nui");
    const editorA1 = editorFor(documentA);
    const editorA2 = editorFor(documentA);
    const editorB = editorFor(documentB);
    mocks.textDocuments.push(documentA, documentB);
    mocks.visibleTextEditors.push(editorA1, editorA2, editorB);
    const snapshotA = snapshotFor(source, documentA.uri.toString(), documentA.version);
    const runtime = runtimeFor(new Map([[documentA.uri.toString(), snapshotA]]));
    const feature = registerNuiSourceActivityDecorationFeature({
      rustProcessOwner: { get: vi.fn() } as never,
      sessionFor: (document) => createLanguageAnalysisSession(document.getText()),
      runtimeEvaluation: runtime
    });
    await flush();

    const nonEmpty = (editor: TestEditor) => editor.setDecorations.mock.calls.filter((call) => (call[1] as unknown[]).length > 0);
    expect(nonEmpty(editorA1)).toHaveLength(1);
    expect(nonEmpty(editorA2)).toHaveLength(1);
    expect(nonEmpty(editorB)).toHaveLength(0);
    expect(editorA1.selection.active).toEqual({ line: 0, character: 0 });
    expect(documentA.getText()).toBe(source);
    feature.dispose();
  });

  it("clears changed/closed documents and discards stale completion", async () => {
    const source = "nui 1\npoint Hidden = coordinate(x: 0, y: 0, state: hidden)";
    let currentSource = source;
    const document = {
      ...documentFor(source),
      getText: () => currentSource
    };
    const editor = editorFor(document);
    mocks.textDocuments.push(document);
    mocks.visibleTextEditors.push(editor);
    let resolveOld!: (snapshot: NuiRuntimeEvaluationSnapshot) => void;
    const oldCompletion = new Promise<NuiRuntimeEvaluationSnapshot>((resolve) => { resolveOld = resolve; });
    const oldSnapshot = snapshotFor(source, document.uri.toString(), 1);
    const runtime = runtimeFor(new Map());
    runtime.evaluateCurrent.mockReturnValueOnce(oldCompletion);
    const feature = registerNuiSourceActivityDecorationFeature({
      rustProcessOwner: { get: vi.fn() } as never,
      sessionFor: (currentDocument) => createLanguageAnalysisSession(currentDocument.getText()),
      runtimeEvaluation: runtime
    });
    await flush();

    currentSource = "nui 1\npoint New = coordinate(x: 1, y: 1)";
    document.version = 2;
    mocks.changeListeners[0]!({ document, contentChanges: [{}] });
    expect(runtime.invalidateDocument).toHaveBeenCalledWith(document.uri.toString());
    resolveOld(oldSnapshot);
    await flush();
    expect(editor.setDecorations.mock.calls.every((call) => (call[1] as unknown[]).length === 0)).toBe(true);

    mocks.closeListeners[0]!(document);
    expect(runtime.closeDocument).toHaveBeenCalledWith(document.uri.toString());
    expect(editor.setDecorations.mock.calls.at(-1)?.[1]).toEqual([]);
    feature.dispose();
  });

  it("refreshes a reopened visible editor and keeps diagnostics outside the adapter", async () => {
    const source = "nui 1\npoint Hidden = coordinate(x: 0, y: 0, state: hidden)";
    const document = documentFor(source);
    const firstEditor = editorFor(document);
    mocks.textDocuments.push(document);
    mocks.visibleTextEditors.push(firstEditor);
    const snapshot = snapshotFor(source, document.uri.toString(), document.version);
    const runtime = runtimeFor(new Map([[document.uri.toString(), snapshot]]));
    const feature = registerNuiSourceActivityDecorationFeature({
      rustProcessOwner: { get: vi.fn() } as never,
      sessionFor: (currentDocument) => createLanguageAnalysisSession(currentDocument.getText()),
      runtimeEvaluation: runtime
    });
    await flush();

    const reopenedEditor = editorFor(document);
    mocks.visibleTextEditors.splice(0, mocks.visibleTextEditors.length, reopenedEditor);
    mocks.visibleEditorListeners[0]!();
    await flush();
    expect(reopenedEditor.setDecorations.mock.calls.some((call) => (call[1] as unknown[]).length > 0)).toBe(true);
    expect(runtime.evaluateCurrent).toHaveBeenCalledTimes(2);
    feature.dispose();
  });

  it("does not declare obsolete Source activity color contributions", async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "vscode-extension/package.json"), "utf8")) as {
      contributes?: { colors?: unknown };
    };
    expect(manifest.contributes?.colors).toBeUndefined();
    expect(manifest.contributes).not.toHaveProperty("colors");
  });
});
