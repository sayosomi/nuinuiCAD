import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  activeTextEditor: undefined as TestEditor | undefined,
  writable: true,
  activeEditorListeners: [] as Array<(editor: TestEditor | undefined) => void>,
  selectionListeners: [] as Array<(event: { textEditor: TestEditor }) => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument }) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>
}));

type TestPosition = { offset: number };
type TestRange = { start: TestPosition; end: TestPosition };
type TestSelection = TestRange & { active: TestPosition; anchor: TestPosition };
type TestDocument = {
  version: number;
  languageId: string;
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: TestPosition) => number;
  positionAt: (offset: number) => TestPosition;
};
type TestEditor = {
  document: TestDocument;
  selection: TestSelection;
  selections: TestSelection[];
  edit: ReturnType<typeof vi.fn>;
};

const disposableFor = (dispose: () => void = () => undefined) => ({ dispose });
const removeListener = <T,>(listeners: T[], listener: T) => {
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
};

vi.mock("vscode", () => {
  class Range {
    constructor(public start: TestPosition, public end: TestPosition) {}
  }
  class Selection extends Range {
    public active: TestPosition;
    public anchor: TestPosition;
    constructor(start: TestPosition, end: TestPosition) {
      super(start, end);
      this.anchor = start;
      this.active = end;
    }
  }
  return {
    Range,
    Selection,
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
        mocks.documentCloseListeners.push(listener);
        return disposableFor(() => removeListener(mocks.documentCloseListeners, listener));
      }
    }
  };
});

import {
  registerVscodeSourceValueStepFeature,
  VSCODE_SOURCE_VALUE_STEP_CONTEXT_KEY,
  VSCODE_SOURCE_VALUE_STEP_BACKWARD_KEYBINDING_COMMAND_ID,
  VSCODE_SOURCE_VALUE_STEP_FORWARD_COMMAND_ID,
  VSCODE_SOURCE_VALUE_STEP_FORWARD_KEYBINDING_COMMAND_ID
} from "./sourceValueStepCommandFeature";

const cursor = (offset: number): TestSelection => ({
  start: { offset },
  end: { offset },
  anchor: { offset },
  active: { offset }
});

const createEditor = (initialSource: string, selectionOffset: number) => {
  let source = initialSource;
  const document: TestDocument = {
    version: 7,
    languageId: "nui",
    fileName: "/tmp/value-step.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/value-step.nui" },
    getText: () => source,
    offsetAt: (position) => position.offset,
    positionAt: (offset) => ({ offset })
  };
  const selection = cursor(selectionOffset);
  const editor: TestEditor = {
    document,
    selection,
    selections: [selection],
    edit: vi.fn(async (callback: (builder: { replace: (range: TestRange, text: string) => void }) => void) => {
      let replacement: { range: TestRange; text: string } | null = null;
      callback({ replace: (range, text) => { replacement = { range, text }; } });
      if (!replacement) return false;
      const applied = replacement as { range: TestRange; text: string };
      source = `${source.slice(0, applied.range.start.offset)}${applied.text}${source.slice(applied.range.end.offset)}`;
      document.version += 1;
      return true;
    })
  };
  return { editor, document, source: () => source };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.activeTextEditor = undefined;
  mocks.writable = true;
  mocks.activeEditorListeners = [];
  mocks.selectionListeners = [];
  mocks.documentChangeListeners = [];
  mocks.documentCloseListeners = [];
});

describe("VS Code Source Value Step feature", () => {
  it("projects target availability from the shared exact-current query", async () => {
    const source = ["nui 1", "let count: number = 1.50"].join("\n");
    const { editor } = createEditor(source, source.indexOf("1.50"));
    mocks.activeTextEditor = editor;
    const session = createLanguageAnalysisSession(source);
    const feature = registerVscodeSourceValueStepFeature({ languageAnalysisSessionFor: () => session });

    await flush();
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      VSCODE_SOURCE_VALUE_STEP_CONTEXT_KEY,
      true
    );

    editor.selections = [cursor(source.indexOf("1.50")), cursor(source.indexOf("1.50"))];
    for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
    await flush();
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      VSCODE_SOURCE_VALUE_STEP_CONTEXT_KEY,
      false
    );
    feature.dispose();
  });

  it("applies one exact edit, normalizes formatting, and selects the replacement", async () => {
    const source = ["nui 1", "let count: number(step: 0.5) = 1.50"].join("\n");
    const start = source.indexOf("1.50");
    const { editor, source: currentSource } = createEditor(source, start);
    mocks.activeTextEditor = editor;
    const session = createLanguageAnalysisSession(source);
    const feature = registerVscodeSourceValueStepFeature({ languageAnalysisSessionFor: () => session });
    const command = mocks.commands.get(VSCODE_SOURCE_VALUE_STEP_FORWARD_COMMAND_ID);
    if (!command) throw new Error("Source Value Step command was not registered");

    await command();

    expect(currentSource()).toContain("= 2");
    expect(editor.edit).toHaveBeenCalledWith(expect.any(Function), {
      undoStopBefore: true,
      undoStopAfter: true
    });
    expect(editor.selection.start.offset).toBe(start);
    expect(editor.selection.end.offset).toBe(start + 1);
    feature.dispose();
  });

  it("keeps broad keybinding dispatch separate from target-enabled Palette commands", async () => {
    const source = ["nui 1", "let count: number = 1"].join("\n");
    const start = source.lastIndexOf("1");
    const { editor, source: currentSource } = createEditor(source, start);
    mocks.activeTextEditor = editor;
    const session = createLanguageAnalysisSession(source);
    const feature = registerVscodeSourceValueStepFeature({ languageAnalysisSessionFor: () => session });

    expect(mocks.commands.has(VSCODE_SOURCE_VALUE_STEP_FORWARD_KEYBINDING_COMMAND_ID)).toBe(true);
    expect(mocks.commands.has(VSCODE_SOURCE_VALUE_STEP_BACKWARD_KEYBINDING_COMMAND_ID)).toBe(true);
    await mocks.commands.get(VSCODE_SOURCE_VALUE_STEP_FORWARD_KEYBINDING_COMMAND_ID)!();
    expect(currentSource()).toContain("= 2");
    await mocks.commands.get(VSCODE_SOURCE_VALUE_STEP_BACKWARD_KEYBINDING_COMMAND_ID)!();
    expect(currentSource()).toContain("= 1");

    feature.dispose();
  });

  it("projects normalized query offsets back onto a CRLF TextDocument", async () => {
    const source = "nui 1\r\nlet count: number = 1.50\r\n";
    const start = source.indexOf("1.50");
    const { editor, source: currentSource } = createEditor(source, start);
    mocks.activeTextEditor = editor;
    const session = createLanguageAnalysisSession(source);
    const feature = registerVscodeSourceValueStepFeature({ languageAnalysisSessionFor: () => session });
    await mocks.commands.get(VSCODE_SOURCE_VALUE_STEP_FORWARD_COMMAND_ID)!();

    expect(currentSource()).toContain("count: number = 2.5\r\n");
    expect(editor.selection.start.offset).toBe(start);
    expect(editor.selection.end.offset).toBe(start + 3);
    feature.dispose();
  });

  it("silently no-ops for a fixed color and for read-only Source", async () => {
    const source = ["nui 1", "modifier Fixed {", "  color: #336699", "}"].join("\n");
    const { editor } = createEditor(source, source.indexOf("#336699"));
    mocks.activeTextEditor = editor;
    const session = createLanguageAnalysisSession(source);
    const feature = registerVscodeSourceValueStepFeature({ languageAnalysisSessionFor: () => session });
    const command = mocks.commands.get(VSCODE_SOURCE_VALUE_STEP_FORWARD_COMMAND_ID)!;
    await command();
    expect(editor.edit).not.toHaveBeenCalled();

    mocks.writable = false;
    for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
    await flush();
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      VSCODE_SOURCE_VALUE_STEP_CONTEXT_KEY,
      false
    );
    feature.dispose();
  });

  it("revalidates the captured document version before applying", async () => {
    const source = ["nui 1", "let count: number = 1"].join("\n");
    const { editor, document } = createEditor(source, source.lastIndexOf("1"));
    const base = createLanguageAnalysisSession(source);
    let invalidated = false;
    const session = base;
    const originalStep = base.sourceValueStepForSelection.bind(base);
    vi.spyOn(session, "sourceValueStepForSelection").mockImplementation((selection, direction) => {
      if (!invalidated) {
        invalidated = true;
        document.version += 1;
      }
      return originalStep(selection, direction);
    });
    const feature = registerVscodeSourceValueStepFeature({ languageAnalysisSessionFor: () => session });
    mocks.activeTextEditor = editor;
    const command = mocks.commands.get(VSCODE_SOURCE_VALUE_STEP_FORWARD_COMMAND_ID)!;
    await command();
    expect(editor.edit).not.toHaveBeenCalled();
    feature.dispose();
  });
});
