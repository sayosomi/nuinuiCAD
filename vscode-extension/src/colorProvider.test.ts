import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class Color {
    constructor(
      public readonly red: number,
      public readonly green: number,
      public readonly blue: number,
      public readonly alpha: number
    ) {}
  }
  class ColorInformation {
    constructor(public readonly range: Range, public readonly color: Color) {}
  }
  class ColorPresentation {
    textEdit?: TextEdit;

    constructor(public readonly label: string) {}
  }
  class TextEdit {
    constructor(public readonly range: Range, public readonly newText: string) {}

    static replace(range: Range, newText: string) {
      return new TextEdit(range, newText);
    }
  }
  return { Position, Range, Color, ColorInformation, ColorPresentation, TextEdit };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import { createNuiColorProvider } from "./colorProvider";

const documentFor = (initialSource: string, fileName = "/tmp/guide.nui") => {
  let source = initialSource;
  const positionAt = (offset: number) => {
    const before = source.slice(0, offset);
    const line = before.split("\n").length - 1;
    return new vscode.Position(line, before.length - (before.lastIndexOf("\n") + 1));
  };
  const offsetAt = (position: vscode.Position) => {
    const lines = source.split("\n");
    return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character;
  };
  const document = {
    uri: { scheme: "file", toString: () => `file://${fileName}` },
    fileName,
    getText: () => source,
    positionAt,
    offsetAt,
    version: 1,
    setSourceText: (nextSource: string) => {
      source = nextSource;
      document.version += 1;
    }
  };
  return document as unknown as vscode.TextDocument & { setSourceText: (nextSource: string) => void; version: number };
};

describe("VS Code fixed-color provider", () => {
  it("projects independent exact modifier fixed colors through CRLF source offsets", () => {
    const source = [
      "nui 4",
      "modifier Guide {",
      "  color: #0a10ff",
      "}",
      "modifier Accent {",
      "  color: #ff8000",
      "}",
      "modifier Theme {",
      "  color: accent",
      "}"
    ].join("\r\n");
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiColorProvider(() => session);

    const colors = provider.provideDocumentColors(documentFor(source)) as vscode.ColorInformation[];

    expect(colors).toHaveLength(2);
    expect(colors[0]).toMatchObject({
      range: {
        start: { line: 2, character: "  color: ".length },
        end: { line: 2, character: "  color: #0a10ff".length }
      },
      color: { red: 10 / 255, green: 16 / 255, blue: 1, alpha: 1 }
    });
    expect(colors[1]).toMatchObject({
      range: {
        start: { line: 5, character: "  color: ".length },
        end: { line: 5, character: "  color: #ff8000".length }
      },
      color: { red: 1, green: 128 / 255, blue: 0, alpha: 1 }
    });
  });

  it("offers one canonical token-only edit after revalidating the exact current range", () => {
    const source = ["nui 4", "modifier Guide {", "  color: #0a10ff", "}"].join("\n");
    const document = documentFor(source);
    const provider = createNuiColorProvider(() => createLanguageAnalysisSession(source));
    const start = source.indexOf("#0a10ff");
    const range = new vscode.Range(document.positionAt(start), document.positionAt(start + "#0a10ff".length));

    const presentations = provider.provideColorPresentations(
      new vscode.Color(1.2, 0.5, -0.1, 0.25),
      { document, range } as vscode.ColorPresentationContext
    );

    expect(presentations).toEqual([expect.objectContaining({
      label: "#ff8000",
      textEdit: expect.objectContaining({ range, newText: "#ff8000" })
    })]);
  });

  it("rejects a stale presentation range, source change, and unsupported document", () => {
    const source = ["nui 4", "modifier Guide {", "  color: #0a10ff", "}"].join("\n");
    const document = documentFor(source);
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiColorProvider(() => session);
    const start = source.indexOf("#0a10ff");
    const range = new vscode.Range(document.positionAt(start), document.positionAt(start + "#0a10ff".length));
    const staleRange = new vscode.Range(document.positionAt(start + 1), document.positionAt(start + "#0a10ff".length));

    expect(provider.provideColorPresentations(new vscode.Color(1, 0, 0, 1), {
      document,
      range: staleRange
    } as vscode.ColorPresentationContext)).toEqual([]);

    const originalSnapshot = session.fixedColorSemanticSnapshot;
    session.fixedColorSemanticSnapshot = (snapshot) => {
      document.setSourceText(source.replace("#0a10ff", "#00ff00"));
      return originalSnapshot(snapshot);
    };
    expect(provider.provideColorPresentations(new vscode.Color(1, 0, 0, 1), {
      document,
      range
    } as vscode.ColorPresentationContext)).toEqual([]);

    const unsupported = documentFor(source, "/tmp/guide.txt");
    expect(provider.provideDocumentColors(unsupported)).toEqual([]);
    expect(provider.provideColorPresentations(new vscode.Color(1, 0, 0, 1), {
      document: unsupported,
      range
    } as vscode.ColorPresentationContext)).toEqual([]);
  });
});
