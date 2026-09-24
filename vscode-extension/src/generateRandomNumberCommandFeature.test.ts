import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  activeTextEditor: undefined as TestEditor | undefined,
  writable: true
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

const disposable = { dispose: () => undefined };

vi.mock("vscode", () => ({
  Range: class Range {
    constructor(public start: TestPosition, public end: TestPosition) {}
  },
  Selection: class Selection {
    public anchor: TestPosition;
    public active: TestPosition;
    constructor(public start: TestPosition, public end: TestPosition) {
      this.anchor = start;
      this.active = end;
    }
  },
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return { dispose: () => mocks.commands.delete(id) };
    }
  },
  window: {
    get activeTextEditor() {
      return mocks.activeTextEditor;
    }
  },
  workspace: { fs: { isWritableFileSystem: () => mocks.writable } },
  Disposable: { from: () => disposable }
}));

import {
  randomDecimalLiteral,
  registerVscodeGenerateRandomNumberFeature,
  VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID
} from "./generateRandomNumberCommandFeature";

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
    fileName: "/tmp/random-number.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/random-number.nui" },
    getText: () => source,
    offsetAt: (position) => position.offset,
    positionAt: (offset) => ({ offset })
  };
  const selection = cursor(selectionOffset);
  let operationCount = 0;
  const editor: TestEditor = {
    document,
    selection,
    selections: [selection],
    edit: vi.fn(async (callback: (builder: { replace: (range: TestRange, text: string) => void }) => void) => {
      const edits: Array<{ range: TestRange; text: string }> = [];
      callback({ replace: (range, text) => edits.push({ range, text }) });
      operationCount = edits.length;
      if (edits.length !== 1) return false;
      const edit = edits[0]!;
      source = `${source.slice(0, edit.range.start.offset)}${edit.text}${source.slice(edit.range.end.offset)}`;
      document.version += 1;
      return true;
    })
  };
  return {
    editor,
    document,
    source: () => source,
    replaceSource: (next: string) => { source = next; },
    operationCount: () => operationCount
  };
};

const register = (source: string, random = vi.fn(() => 0.25)) => {
  const session = createLanguageAnalysisSession(source);
  const feature = registerVscodeGenerateRandomNumberFeature({
    languageAnalysisSessionFor: () => session,
    random
  });
  return { session, feature, random };
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.activeTextEditor = undefined;
  mocks.writable = true;
});

describe("VS Code Generate Random Number feature", () => {
  it("registers the command", () => {
    const { feature } = register("nui 1\n");
    expect(mocks.commands.has(VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID)).toBe(true);
    feature.dispose();
  });

  it("replaces a numeric literal with the injected random value in one native undoable edit", async () => {
    const source = "nui 1\nconst width: number = 12.34";
    const start = source.indexOf("12.34");
    const { editor, source: currentSource, operationCount } = createEditor(source, start + 2);
    mocks.activeTextEditor = editor;
    const random = vi.fn(() => 0.25);
    const { feature } = register(source, random);

    await mocks.commands.get(VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID)!();

    expect(random).toHaveBeenCalledTimes(1);
    expect(currentSource()).toBe(source.replace("12.34", "0.25"));
    expect(editor.edit).toHaveBeenCalledTimes(1);
    expect(operationCount()).toBe(1);
    expect(editor.edit).toHaveBeenCalledWith(expect.any(Function), {
      undoStopBefore: true,
      undoStopAfter: true
    });
    expect(editor.selection.start.offset).toBe(start);
    expect(editor.selection.end.offset).toBe(start + 4);
    feature.dispose();
  });

  it("inserts at an empty caret and selects the inserted literal", async () => {
    const source = "nui 1\nconst width: number = 12.34\n";
    const at = source.length;
    const { editor, source: currentSource } = createEditor(source, at);
    mocks.activeTextEditor = editor;
    const { feature } = register(source, vi.fn(() => 0.75));

    await mocks.commands.get(VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID)!();

    expect(currentSource()).toBe(`${source}0.75`);
    expect(editor.selection.start.offset).toBe(at);
    expect(editor.selection.end.offset).toBe(at + 4);
    feature.dispose();
  });

  it("does nothing for multiple selections or an arbitrary non-empty selection", async () => {
    const source = "nui 1\nconst width: number = 12.34";
    const start = source.indexOf("width");
    const { editor } = createEditor(source, start);
    mocks.activeTextEditor = editor;
    const { feature } = register(source);
    const command = mocks.commands.get(VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID)!;

    editor.selections = [cursor(start), cursor(start + 1)];
    await command();
    expect(editor.edit).not.toHaveBeenCalled();

    editor.selections = [{
      start: { offset: start },
      end: { offset: start + 5 },
      anchor: { offset: start },
      active: { offset: start + 5 }
    }];
    await command();
    expect(editor.edit).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("does nothing when the captured document version changes during planning", async () => {
    const source = "nui 1\nconst width: number = 12.34";
    const { editor, document } = createEditor(source, source.indexOf("12.34") + 1);
    mocks.activeTextEditor = editor;
    const { session, feature } = register(source);
    const original = session.randomNumberSourceEditForSelections.bind(session);
    vi.spyOn(session, "randomNumberSourceEditForSelections").mockImplementation((selections, literal) => {
      const plan = original(selections, literal);
      document.version += 1;
      return plan;
    });

    await mocks.commands.get(VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID)!();

    expect(editor.edit).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("does nothing when the expected target text is stale", async () => {
    const source = "nui 1\nconst width: number = 12.34";
    const { editor } = createEditor(source, source.indexOf("12.34") + 1);
    mocks.activeTextEditor = editor;
    const { session, feature } = register(source);
    const original = session.randomNumberSourceEditForSelections.bind(session);
    vi.spyOn(session, "randomNumberSourceEditForSelections").mockImplementation((selections, literal) => {
      const plan = original(selections, literal);
      return plan ? { ...plan, edit: { ...plan.edit, expectedText: "stale" } } : null;
    });

    await mocks.commands.get(VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID)!();

    expect(editor.edit).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("does nothing for unsupported or read-only Source editors", async () => {
    const source = "nui 1\nconst width: number = 12.34";
    const { editor } = createEditor(source, source.length);
    mocks.activeTextEditor = editor;
    const { feature } = register(source);
    const command = mocks.commands.get(VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID)!;

    editor.document.languageId = "plaintext";
    await command();
    expect(editor.edit).not.toHaveBeenCalled();

    editor.document.languageId = "nui";
    mocks.writable = false;
    await command();
    expect(editor.edit).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("formats finite values as normal decimals and rejects out-of-range RNG values", () => {
    expect(randomDecimalLiteral(() => 0.25)).toBe("0.25");
    expect(randomDecimalLiteral(() => 1e-7)).toBe("0.0000001");
    expect(randomDecimalLiteral(() => 0)).toBe("0");
    expect(randomDecimalLiteral(() => 1)).toBeNull();
    expect(randomDecimalLiteral(() => Number.NaN)).toBeNull();
  });
});
