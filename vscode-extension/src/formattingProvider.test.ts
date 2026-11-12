import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class TextEdit {
    constructor(public readonly range: Range, public readonly newText: string) {}
    static replace(range: Range, newText: string) { return new TextEdit(range, newText); }
  }
  return {
    Position,
    Range,
    TextEdit,
    EndOfLine: { LF: 1, CRLF: 2 },
    languages: {
      registerDocumentFormattingEditProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerDocumentRangeFormattingEditProvider: vi.fn(() => ({ dispose: vi.fn() }))
    },
    workspace: {
      onWillSaveTextDocument: vi.fn(),
      onDidSaveTextDocument: vi.fn(),
      getConfiguration: vi.fn(() => ({ get: vi.fn(() => false) }))
    }
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import {
  createNuiDocumentFormattingProvider,
  createNuiDocumentRangeFormattingProvider,
  nuiFormattingSelector,
  registerNuiFormattingProviders
} from "./formattingProvider";

type TestDocument = {
  fileName: string;
  uri: { scheme: string };
  eol: number;
  getText: () => string;
  positionAt: (offset: number) => { line: number; character: number };
};

const documentFor = (
  source: string,
  options: { fileName?: string; scheme?: string; eol?: number } = {}
): TestDocument => ({
  fileName: options.fileName ?? "/tmp/pattern.nui",
  uri: { scheme: options.scheme ?? "file" },
  eol: options.eol ?? vscode.EndOfLine.LF,
  getText: () => source,
  positionAt: (offset) => {
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < offset && index < source.length; index += 1) {
      if (source[index] === "\n") {
        line += 1;
        lineStart = index + 1;
      }
    }
    return new vscode.Position(line, offset - lineStart);
  }
});

const defaultOptions = { tabSize: 2, insertSpaces: true };

describe("VS Code native .nui formatting providers", () => {
  beforeEach(() => {
    vi.mocked(vscode.languages.registerDocumentFormattingEditProvider).mockClear();
    vi.mocked(vscode.languages.registerDocumentRangeFormattingEditProvider).mockClear();
    vi.mocked(vscode.workspace.onWillSaveTextDocument).mockClear();
    vi.mocked(vscode.workspace.onDidSaveTextDocument).mockClear();
  });

  it("provides document edits and preserves CRLF line endings", () => {
    const source = "group G {\r\npoint P = coordinate(x:0,y:0)\r\n}";
    const provider = createNuiDocumentFormattingProvider();
    const edits = provider.provideDocumentFormattingEdits(
      documentFor(source, { eol: vscode.EndOfLine.CRLF }) as unknown as vscode.TextDocument,
      defaultOptions
    );

    expect(edits).toHaveLength(1);
    expect(edits[0]!.range.start).toMatchObject({ line: 1, character: 0 });
    expect(edits[0]!.newText).toContain("\r\n");
    expect(edits[0]!.newText).toContain("\r\n    x: 0,");
  });

  it("formats only the exact requested selection through the range provider", () => {
    const source = [
      "point before = coordinate(x:0,y:0)",
      "point selected = coordinate(x:0,y:0)",
      "point after = coordinate(x:0,y:0)"
    ].join("\n");
    const start = source.indexOf("point selected");
    const end = source.indexOf("\n", start);
    const range = new vscode.Range(
      new vscode.Position(1, 0),
      new vscode.Position(1, end - start)
    );
    const provider = createNuiDocumentRangeFormattingProvider();
    const edits = provider.provideDocumentRangeFormattingEdits(
      documentFor(source) as unknown as vscode.TextDocument,
      range,
      defaultOptions
    );

    expect(edits).toHaveLength(1);
    expect(edits[0]!.range).toMatchObject({
      start: { line: 1, character: 0 },
      end: { line: 1, character: end - start }
    });
    expect(edits[0]!.newText).toContain("point selected = coordinate(\n  x: 0,\n  y: 0,\n)");
  });

  it("uses the nui file selector and registers both native providers for disposal", () => {
    expect(nuiFormattingSelector).toEqual({ language: "nui", scheme: "file" });
    const registered = registerNuiFormattingProviders();

    expect(vscode.languages.registerDocumentFormattingEditProvider).toHaveBeenCalledWith(
      nuiFormattingSelector,
      expect.objectContaining({ provideDocumentFormattingEdits: expect.any(Function) })
    );
    expect(vscode.languages.registerDocumentRangeFormattingEditProvider).toHaveBeenCalledWith(
      nuiFormattingSelector,
      expect.objectContaining({ provideDocumentRangeFormattingEdits: expect.any(Function) })
    );
    expect(registered).toHaveLength(2);
    registered.forEach((disposable) => disposable.dispose());
  });

  it("does not force format-on-save or install an independent save listener", () => {
    registerNuiFormattingProviders();

    expect(vscode.workspace.onWillSaveTextDocument).not.toHaveBeenCalled();
    expect(vscode.workspace.onDidSaveTextDocument).not.toHaveBeenCalled();
    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
  });

  it("ignores non-file and non-.nui documents", () => {
    const provider = createNuiDocumentFormattingProvider();
    expect(provider.provideDocumentFormattingEdits(
      documentFor("point P", { fileName: "/tmp/pattern.txt" }) as unknown as vscode.TextDocument,
      defaultOptions
    )).toEqual([]);
    expect(provider.provideDocumentFormattingEdits(
      documentFor("point P", { scheme: "untitled" }) as unknown as vscode.TextDocument,
      defaultOptions
    )).toEqual([]);
  });
});
