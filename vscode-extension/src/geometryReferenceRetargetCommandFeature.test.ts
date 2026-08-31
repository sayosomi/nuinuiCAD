import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession, type NuiLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  activeTextEditor: undefined as TestEditor | undefined,
  writable: true,
  activeEditorListeners: [] as Array<(editor: TestEditor | undefined) => void>,
  selectionListeners: [] as Array<(event: { textEditor: TestEditor }) => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument }) => void>,
  closeListeners: [] as Array<(document: TestDocument) => void>
}));

type TestPosition = { line: number; character: number };
type TestRange = { start: TestPosition; end: TestPosition };
type TestSelection = TestRange & { active: TestPosition; anchor: TestPosition };
type TestDocument = {
  readonly uri: { scheme: string; toString: () => string };
  readonly fileName: string;
  readonly languageId: string;
  readonly version: number;
  getText: () => string;
  offsetAt: (position: TestPosition) => number;
  positionAt: (offset: number) => TestPosition;
};
type TestEditor = {
  document: TestDocument;
  selection: TestSelection;
  edit: ReturnType<typeof vi.fn>;
  replaceCalls: Array<{ range: TestRange; text: string }>;
};

const disposableFor = (dispose: () => void = () => undefined) => ({ dispose });
const removeListener = <T,>(listeners: T[], listener: T): void => {
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
};

vi.mock("vscode", () => {
  class Range {
    constructor(public readonly start: TestPosition, public readonly end: TestPosition) {}
  }
  return {
    Range,
    Disposable: {
      from: (...items: Array<{ dispose: () => void }>) => disposableFor(() => {
        for (const item of items) item.dispose();
      })
    },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        mocks.commands.set(id, handler);
        return disposableFor(() => mocks.commands.delete(id));
      },
      executeCommand: mocks.executeCommand
    },
    window: {
      get activeTextEditor() {
        return mocks.activeTextEditor;
      },
      showErrorMessage: mocks.showErrorMessage,
      showQuickPick: mocks.showQuickPick,
      onDidChangeActiveTextEditor: (listener: (editor: TestEditor | undefined) => void) => {
        mocks.activeEditorListeners.push(listener);
        return disposableFor(() => removeListener(mocks.activeEditorListeners, listener));
      },
      onDidChangeTextEditorSelection: (listener: (event: { textEditor: TestEditor }) => void) => {
        mocks.selectionListeners.push(listener);
        return disposableFor(() => removeListener(mocks.selectionListeners, listener));
      }
    },
    workspace: {
      fs: { isWritableFileSystem: () => mocks.writable },
      onDidChangeTextDocument: (listener: (event: { document: TestDocument }) => void) => {
        mocks.documentChangeListeners.push(listener);
        return disposableFor(() => removeListener(mocks.documentChangeListeners, listener));
      },
      onDidCloseTextDocument: (listener: (document: TestDocument) => void) => {
        mocks.closeListeners.push(listener);
        return disposableFor(() => removeListener(mocks.closeListeners, listener));
      }
    }
  };
});

import {
  geometryReferenceRetargetTargetForEditor,
  registerVscodeGeometryReferenceRetargetFeature,
  VSCODE_GEOMETRY_REFERENCE_RETARGET_COMMAND_ID,
  VSCODE_GEOMETRY_REFERENCE_RETARGET_CONTEXT_KEY
} from "./geometryReferenceRetargetCommandFeature";

const sourceWithReplacement = (lineEnding = "\n"): string => [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 20, y: 0)",
  "point First = offset(from: @A, dx: 1, dy: 0)",
  "point Second = offset(from: @A, dx: 2, dy: 0)"
].join(lineEnding);

const sourceWithoutReplacement = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point Use = offset(from: @A, dx: 1, dy: 0)"
].join("\n");

const createEditor = (initialSource: string, selectionOffset: number) => {
  const state = { source: initialSource, version: 7 };
  const document: TestDocument = {
    uri: { scheme: "file", toString: () => "file:///tmp/retarget.nui" },
    fileName: "/tmp/retarget.nui",
    languageId: "nui",
    get version() { return state.version; },
    getText: () => state.source,
    offsetAt: (position) => {
      const starts = [0];
      for (const match of state.source.matchAll(/\r?\n/g)) starts.push((match.index ?? 0) + match[0].length);
      const line = Math.min(Math.max(position.line, 0), starts.length - 1);
      return Math.min(starts[line]! + Math.max(position.character, 0), state.source.length);
    },
    positionAt: (offset) => {
      const bounded = Math.min(Math.max(offset, 0), state.source.length);
      const prefix = state.source.slice(0, bounded);
      const line = [...prefix.matchAll(/\r?\n/g)].length;
      const lastNewline = prefix.lastIndexOf("\n");
      return { line, character: bounded - (lastNewline + 1) };
    }
  };
  const position = document.positionAt(selectionOffset);
  const selection: TestSelection = {
    start: position,
    end: position,
    active: position,
    anchor: position
  };
  const replaceCalls: Array<{ range: TestRange; text: string }> = [];
  const editor: TestEditor = {
    document,
    selection,
    replaceCalls,
    edit: vi.fn(async (callback: (builder: { replace: (range: TestRange, text: string) => void }) => void) => {
      const replacements: Array<{ from: number; to: number; range: TestRange; text: string }> = [];
      callback({
        replace: (range, text) => {
          const from = document.offsetAt(range.start);
          const to = document.offsetAt(range.end);
          replacements.push({ from, to, range, text });
          replaceCalls.push({ range, text });
        }
      });
      for (const replacement of [...replacements].sort((left, right) => right.from - left.from)) {
        state.source = `${state.source.slice(0, replacement.from)}${replacement.text}${state.source.slice(replacement.to)}`;
      }
      state.version += 1;
      return true;
    })
  };
  return {
    editor,
    document,
    source: () => state.source,
    bumpSource: (nextSource: string) => {
      state.source = nextSource;
      state.version += 1;
    },
    setSelectionOffset: (offset: number) => {
      const next = document.positionAt(offset);
      editor.selection = { start: next, end: next, active: next, anchor: next };
    }
  };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const registerFor = async (fixture: ReturnType<typeof createEditor>) => {
  mocks.activeTextEditor = fixture.editor;
  const sessions = new Map<string, NuiLanguageAnalysisSession>();
  const feature = registerVscodeGeometryReferenceRetargetFeature({
    languageAnalysisSessionFor: (document) => {
      const key = document.uri.toString();
      const existing = sessions.get(key);
      if (existing) return existing;
      const session = createLanguageAnalysisSession(document.getText());
      sessions.set(key, session);
      return session;
    }
  });
  await flush();
  return { feature, command: mocks.commands.get(VSCODE_GEOMETRY_REFERENCE_RETARGET_COMMAND_ID)! };
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.showErrorMessage.mockReset();
  mocks.showErrorMessage.mockResolvedValue(undefined);
  mocks.showQuickPick.mockReset();
  mocks.activeTextEditor = undefined;
  mocks.writable = true;
  mocks.activeEditorListeners = [];
  mocks.selectionListeners = [];
  mocks.documentChangeListeners = [];
  mocks.closeListeners = [];
});

describe("VS Code geometry-reference retarget feature", () => {
  it("projects the exact semantic target context key and clears it for a declaration", async () => {
    const source = sourceWithReplacement();
    const fixture = createEditor(source, source.indexOf("@A") + 1);
    const { feature } = await registerFor(fixture);

    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      VSCODE_GEOMETRY_REFERENCE_RETARGET_CONTEXT_KEY,
      true
    );

    fixture.setSelectionOffset(source.indexOf("point A") + "point ".length);
    for (const listener of mocks.selectionListeners) listener({ textEditor: fixture.editor });
    await flush();

    const contextCalls = mocks.executeCommand.mock.calls.filter(([command, key]) =>
      command === "setContext" && key === VSCODE_GEOMETRY_REFERENCE_RETARGET_CONTEXT_KEY
    );
    expect(contextCalls.at(-1)?.[2]).toBe(false);
    feature.dispose();
  });

  it("returns no target for unsupported editors", () => {
    const source = sourceWithReplacement();
    const fixture = createEditor(source, source.indexOf("@A") + 1);
    Object.defineProperty(fixture.editor.document, "languageId", { value: "plaintext" });
    expect(geometryReferenceRetargetTargetForEditor(
      fixture.editor,
      createLanguageAnalysisSession(source)
    )).toBeNull();
  });

  it("fails closed on a non-target caret without mutation", async () => {
    const fixture = createEditor(sourceWithReplacement(), 0);
    const { feature, command } = await registerFor(fixture);

    await command();

    expect(fixture.editor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Place the Source caret on an exact geometry reference to replace it."
    );
    feature.dispose();
  });

  it("passes searchable, disambiguated candidate presentation to native QuickPick", async () => {
    const source = [
      "nui 1",
      "group Outer {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "group Other {",
      "  point B = coordinate(x: 20, y: 0)",
      "}",
      "point Use = offset(from: @Outer::A, dx: 1, dy: 0)"
    ].join("\n");
    const fixture = createEditor(source, source.indexOf("@Outer::A") + "@Outer::A".length);
    mocks.showQuickPick.mockResolvedValue(undefined);
    const { feature, command } = await registerFor(fixture);

    await command();

    const [items, options] = mocks.showQuickPick.mock.calls[0] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      label: "B",
      description: "point geometry",
      detail: "Reference path: @Other::B"
    });
    expect(options).toMatchObject({ matchOnDescription: true, matchOnDetail: true });
    expect(fixture.editor.edit).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("reports zero compatible candidates without opening a picker or editing", async () => {
    const source = sourceWithoutReplacement;
    const fixture = createEditor(source, source.indexOf("@A") + 1);
    const { feature, command } = await registerFor(fixture);

    await command();

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(fixture.editor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: No compatible geometry replacement is available for this reference."
    );
    feature.dispose();
  });

  it("applies every planned replacement in one native edit transaction", async () => {
    const source = sourceWithReplacement();
    const fixture = createEditor(source, source.indexOf("@A") + 1);
    mocks.showQuickPick.mockImplementation(async (items: readonly unknown[]) => items[0]);
    const { feature, command } = await registerFor(fixture);

    await command();

    expect(fixture.source()).toBe(source.replace(/@A/g, "@B"));
    expect(fixture.editor.edit).toHaveBeenCalledTimes(1);
    expect(fixture.editor.replaceCalls).toHaveLength(2);
    expect(fixture.editor.edit.mock.calls[0]?.[1]).toEqual({ undoStopBefore: true, undoStopAfter: true });
    feature.dispose();
  });

  it("cancels without editing when the document version changes while QuickPick is active", async () => {
    const source = sourceWithReplacement();
    const fixture = createEditor(source, source.indexOf("@A") + 1);
    let resolvePick: ((item: unknown) => void) | undefined;
    mocks.showQuickPick.mockImplementation(() => new Promise((resolve) => {
      resolvePick = resolve;
    }));
    const { feature, command } = await registerFor(fixture);
    const pending = command();
    await flush();

    const item = mocks.showQuickPick.mock.calls[0]?.[0]?.[0];
    fixture.bumpSource(source.replace("dx: 1", "dx: 9"));
    resolvePick?.(item);
    await pending;

    expect(fixture.editor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Source changed while choosing a replacement. No changes were made."
    );
    feature.dispose();
  });

  it("reports planner rejection without editing", async () => {
    const source = sourceWithReplacement();
    const fixture = createEditor(source, source.indexOf("@A") + 1);
    mocks.showQuickPick.mockImplementation(async (items: readonly { candidate: { identity: unknown } }[]) => {
      const item = items[0]!;
      return {
        ...item,
        candidate: {
          ...item.candidate,
          identity: { kind: "element", elementId: "missing" }
        }
      };
    });
    const { feature, command } = await registerFor(fixture);

    await command();

    expect(fixture.editor.edit).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: The selected geometry is no longer an available replacement. Run the command again."
    );
    feature.dispose();
  });

  it("maps normalized plans to CRLF raw ranges without offset drift", async () => {
    const source = sourceWithReplacement("\r\n");
    const fixture = createEditor(source, source.indexOf("@A") + 1);
    mocks.showQuickPick.mockImplementation(async (items: readonly unknown[]) => items[0]);
    const { feature, command } = await registerFor(fixture);

    await command();

    expect(fixture.source()).toBe(source.replace(/@A/g, "@B"));
    expect(fixture.editor.replaceCalls.map(({ range, text }) => ({
      start: range.start,
      end: range.end,
      text
    }))).toEqual([
      {
        start: fixture.document.positionAt(source.indexOf("A", source.indexOf("@A"))),
        end: fixture.document.positionAt(source.indexOf("A", source.indexOf("@A")) + 1),
        text: "B"
      },
      {
        start: fixture.document.positionAt(source.lastIndexOf("A")),
        end: fixture.document.positionAt(source.lastIndexOf("A") + 1),
        text: "B"
      }
    ]);
    feature.dispose();
  });
});
