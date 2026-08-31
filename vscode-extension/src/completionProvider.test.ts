import { afterEach, describe, expect, it, vi } from "vitest";

const vscodeMocks = vi.hoisted(() => ({
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
  multiDocumentHost: null as { languageSemanticSnapshotFor: ReturnType<typeof vi.fn> } | null
}));

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class SnippetString {
    constructor(public readonly value: string) {}
  }
  class CompletionItem {
    detail?: string;
    filterText?: string;
    sortText?: string;
    preselect?: boolean;
    range?: Range;
    insertText?: string | SnippetString;

    constructor(public readonly label: string, public readonly kind: number) {}
  }
  return {
    CompletionItemKind: vscodeMocks.CompletionItemKind,
    Position,
    Range,
    SnippetString,
    CompletionItem,
    env: { language: "en" }
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

vi.mock("./multiDocumentHost", () => ({
  activeVscodeMultiDocumentHost: () => vscodeMocks.multiDocumentHost
}));

import * as vscode from "vscode";
import { compileDslDocument } from "../../src/dsl/dslDocument";
import { queryDslCompletion } from "../../src/dsl/dslCompletionQuery";
import { createModuleRuntimeContext } from "../../src/dsl/moduleRuntimeContext";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "../../src/document/multiDocumentModuleSemantics";
import { buildMultiDocumentImportGraph } from "../../src/document/multiDocumentImportGraph";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost
} from "../../src/document/multiDocumentPrimitives";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiCompletionProvider,
  normalizedOffsetAt,
  normalizedPositionAt,
  nuiCompletionSelector,
  nuiCompletionTriggerCharacters,
  projectDslCompletionItems
} from "./completionProvider";

type TestDocument = {
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
};

const documentFor = (source: string, fileName = "/tmp/pattern.nui"): TestDocument => ({
  fileName,
  uri: { scheme: "file", toString: () => `file://${fileName}` },
  getText: () => source
});

const itemsFor = (source: string, line = source.split(/\r?\n/).length - 1, character?: number) => {
  const document = documentFor(source);
  const normalized = source.replace(/\r\n/g, "\n");
  const session = createLanguageAnalysisSession(source);
  const provider = createNuiCompletionProvider(() => session);
  const position = new vscode.Position(line, character ?? normalized.split("\n")[line]!.length);
  return provider.provideCompletionItems(document as vscode.TextDocument, position, undefined as never, undefined as never) as vscode.CompletionItem[];
};

const optionalModuleSource = [
  "nui 1",
  "module M(",
  "  value?: number,",
  ") {",
  "  if (hasValue(@value)) {",
  "    const probe: number = @value",
  "  }",
  "}",
  "instance Use = M()"
].join("\n");

const transientOptionalModuleSource = optionalModuleSource.replace(
  "instance Use = M()",
  "instance Use = M(\n  v\n)"
);

const importedModuleSnapshotFor = async (source: string, librarySource: string) => {
  const library = {
    kind: "dependency-saved" as const,
    documentId: documentIdFromHost("provider-library"),
    savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:provider-library"),
    normalizedSource: librarySource
  };
  const root = {
    kind: "root-current" as const,
    documentId: documentIdFromHost("provider-root"),
    normalizedSource: source,
    sourceRevision: 1
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: {
      loadSavedDependency: async () => ({ status: "loaded" as const, snapshot: library })
    },
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  const rootNode = graph.nodes.get(root.documentId)!;
  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  return { sourceRevision: 1, sourceText: source, compiled };
};

afterEach(() => {
  vscodeMocks.multiDocumentHost = null;
});

describe("VS Code native nui completion provider", () => {
  it("routes exact imported Module candidates through the native provider", async () => {
    const source = [
      "nui 1",
      "import \"./library.nui\" as lib",
      "instance use = lib::Panel()"
    ].join("\n");
    const snapshot = await importedModuleSnapshotFor(source, [
      "nui 1",
      "export module Panel() {",
      "}"
    ].join("\n"));
    const host = {
      languageSemanticSnapshotFor: vi.fn(async () => snapshot)
    };
    vscodeMocks.multiDocumentHost = host;
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiCompletionProvider(() => session);
    const document = documentFor(source);
    const items = await provider.provideCompletionItems(
      document as vscode.TextDocument,
      new vscode.Position(2, source.split("\n")[2]!.indexOf("lib::Pa") + "lib::Pa".length),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];

    expect(host.languageSemanticSnapshotFor).toHaveBeenCalledWith(document);
    expect(items.map((item) => item.label)).toContain("Panel");
    expect(items.find((item) => item.label === "Panel")?.kind).toBe(vscodeMocks.CompletionItemKind.Module);
  });

  it("keeps the established local completion path when the host snapshot is unavailable", async () => {
    const source = "nui 1\nconst value: number = ab";
    const host = {
      languageSemanticSnapshotFor: vi.fn(async () => null)
    };
    vscodeMocks.multiDocumentHost = host;
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiCompletionProvider(() => session);
    const items = await provider.provideCompletionItems(
      documentFor(source) as vscode.TextDocument,
      new vscode.Position(1, source.split("\n")[1]!.length),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];

    expect(host.languageSemanticSnapshotFor).toHaveBeenCalledOnce();
    expect(items.map((item) => item.label)).toContain("abs");
  });

  it("projects modifier authoring candidates through the native provider", () => {
    const source = [
      "nui 1",
      'modifier "Guide Line" {',
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "line L [Gui] = segment(start: @A, end: @A)"
    ].join("\n");
    const items = itemsFor(source, 5, "line L [Gui".length);
    const guide = items.find((item) => item.label === "Guide Line");
    expect(guide?.insertText).toBe('"Guide Line"');
    expect(guide?.range).toMatchObject({
      start: { line: 5, character: "line L [".length },
      end: { line: 5, character: "line L [Gui".length }
    });
  });

  it("uses the file-scoped selector and all requested trigger characters", () => {
    expect(nuiCompletionSelector).toEqual({ language: "nui", scheme: "file" });
    expect(nuiCompletionTriggerCharacters).toEqual(["@", ".", ":", "=", "(", ",", "[", "{"]);
  });

  it("projects query candidates, kinds, details, and absolute replacement ranges", () => {
    const source = "nui 1\nconst value: number = ab";
    const items = itemsFor(source);
    const abs = items.find((item) => item.label === "abs")!;

    expect(abs.kind).toBe(vscodeMocks.CompletionItemKind.Function);
    expect(abs.detail).toContain("abs");
    expect(abs.range).toMatchObject({
      start: { line: 1, character: "nui 1\nconst value: number = ".length - "nui 1\n".length },
      end: { line: 1, character: "const value: number = ab".length }
    });
    expect(abs.filterText).toBeUndefined();
    expect(abs.sortText).toBeUndefined();
    expect(abs.preselect).toBeUndefined();
  });

  it("projects a query-selected choice geometry property through the native provider", () => {
    const source = [
      "nui 1",
      "arc A = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: clockwise)",
      "let direction: choice(counterclockwise, clockwise) = clockwise",
      "set direction = @A."
    ].join("\n");
    const line = source.split("\n")[3]!;
    const items = itemsFor(source);
    const direction = items.find((item) => item.label === "direction")!;

    expect(direction.kind).toBe(vscodeMocks.CompletionItemKind.Property);
    expect(direction.insertText).toBe("direction");
    expect(direction.range).toMatchObject({
      start: { line: 3, character: line.length },
      end: { line: 3, character: line.length }
    });
  });

  it("inserts named arguments with a trailing colon and space", () => {
    const source = "nui 1\nconst value: number = spreadAngle(";
    const items = itemsFor(source);

    expect(items.filter((item) => item.label === "length" || item.label === "spread").map((item) => item.insertText)).toEqual([
      "length: ",
      "spread: "
    ]);
  });

  it("maps multiline argument ranges to the physical line", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(",
      "  from: @A",
      "  d",
      ")"
    ].join("\n");
    const items = itemsFor(source, 4, 3);

    expect(items[0]?.range).toMatchObject({
      start: { line: 4, character: 2 },
      end: { line: 4, character: 3 }
    });
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["dx", "dy"]));
  });

  it("offers tolerant call arguments across a blank line with physical insertion ranges", () => {
    const constructionSource = "nui 1\npoint P = coordinate(\n  \n)";
    const constructionItems = itemsFor(constructionSource, 2, 2);
    expect(constructionItems.map((item) => item.label)).toEqual(expect.arrayContaining(["x", "y"]));

    const builtinSource = "nui 1\nconst a: number = spreadAngle(\n  \n)";
    const builtinItems = itemsFor(builtinSource, 2, 2);
    expect(builtinItems.map((item) => item.label)).toEqual(["length", "spread"]);

    const liveSource = optionalModuleSource.replace("instance Use = M()", "instance Use = M(\n  \n)");
    const session = createLanguageAnalysisSession(optionalModuleSource);
    const provider = createNuiCompletionProvider(() => session);
    session.replaceSource(liveSource);
    const moduleItems = provider.provideCompletionItems(
      documentFor(liveSource) as vscode.TextDocument,
      new vscode.Position(9, 2),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];
    const value = moduleItems.find((item) => item.label === "value")!;
    expect(moduleItems.map((item) => item.label)).toContain("value");
    expect(value.insertText).toBe("value: ");
    expect(value.range).toMatchObject({
      start: { line: 9, character: 2 },
      end: { line: 9, character: 2 }
    });
  });

  it("offers current-source Module labels when the incomplete call is opened cold", () => {
    const source = [
      "nui 1",
      "",
      "module M(",
      "value: number,",
      "optional?: number,",
      ") {",
      "}",
      "",
      "instance Use = M(",
      "",
      ")"
    ].join("\n");
    const statementLine = source.split("\n").findIndex((line) => line === "instance Use = M(");
    const sameLineItems = itemsFor(source, statementLine, "instance Use = M(".length);
    const sameLineValue = sameLineItems.find((item) => item.label === "value")!;

    expect(sameLineItems.map((item) => item.label)).toEqual(expect.arrayContaining(["value", "optional"]));
    expect(sameLineValue.insertText).toBe("value: ");
    expect(sameLineValue.range).toMatchObject({
      start: { line: statementLine, character: "instance Use = M(".length },
      end: { line: statementLine, character: "instance Use = M(".length }
    });

    const callLine = statementLine + 1;
    const items = itemsFor(source, callLine, 0);
    const value = items.find((item) => item.label === "value")!;

    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["value", "optional"]));
    expect(value.insertText).toBe("value: ");
    expect(value.range).toMatchObject({
      start: { line: callLine, character: 0 },
      end: { line: callLine, character: 0 }
    });

    const unresolvedSource = source.replace("instance Use = M(\n", "instance Use = Other(\n");
    const unresolvedStatementLine = unresolvedSource.split("\n").findIndex((line) => line === "instance Use = Other(");
    const unresolvedSameLineItems = itemsFor(unresolvedSource, unresolvedStatementLine, "instance Use = Other(".length);
    expect(unresolvedSameLineItems.map((item) => item.label)).not.toContain("value");
    expect(unresolvedSameLineItems.map((item) => item.label)).not.toContain("optional");

    const unresolvedCallLine = unresolvedSource.split("\n").findIndex((line) => line === "instance Use = Other(") + 1;
    const unresolvedItems = itemsFor(unresolvedSource, unresolvedCallLine, 0);
    expect(unresolvedItems.map((item) => item.label)).not.toContain("value");
    expect(unresolvedItems.map((item) => item.label)).not.toContain("optional");
  });

  it("filters a later in-call argument without changing the blank-line range", () => {
    const source = [
      "nui 1",
      "point P = coordinate(",
      "",
      "y: 20",
      ")"
    ].join("\n");
    const items = itemsFor(source, 2, 0);

    expect(items.map((item) => item.label)).toContain("x");
    expect(items.map((item) => item.label)).not.toContain("y");
    const x = items.find((item) => item.label === "x")!;
    expect(x.range).toMatchObject({
      start: { line: 2, character: 0 },
      end: { line: 2, character: 0 }
    });
  });

  it("supports the manual E2E cases for incomplete argument, qualified member, and property completion", () => {
    const argumentSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(",
      "  from: @A,",
      "  d",
      ")"
    ].join("\n");
    const argumentItems = itemsFor(argumentSource, 4, 3);
    const argument = argumentItems.find((item) => item.label === "dx")!;
    expect(argumentItems.map((item) => item.label)).toEqual(expect.arrayContaining(["dx", "dy"]));
    expect(argument.range).toMatchObject({
      start: { line: 4, character: 2 },
      end: { line: 4, character: 3 }
    });

    const qualifiedSource = [
      "nui 1",
      "group 前身頃 {",
      "  point か = coordinate(x: 0, y: 0)",
      "}",
      "point 使用 = offset(from: @前身頃::, dx: 0, dy: 0)"
    ].join("\n");
    const qualifiedLine = qualifiedSource.split("\n")[4]!;
    const qualifiedPosition = qualifiedLine.indexOf("@前身頃::") + "@前身頃::".length;
    const qualified = itemsFor(qualifiedSource, 4, qualifiedPosition).find((item) => item.label === "か")!;
    expect(qualified.insertText).toBe("か");
    expect(qualified.range).toMatchObject({
      start: { line: 4, character: qualifiedPosition },
      end: { line: 4, character: qualifiedPosition }
    });

    const propertySource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: @A, end: @A)",
      "const value: number = @AB.le"
    ].join("\n");
    const propertyLine = propertySource.split("\n")[3]!;
    const propertyPosition = propertyLine.indexOf("@AB.le") + "@AB.le".length;
    const property = itemsFor(propertySource, 3, propertyPosition).find((item) => item.label === "length")!;
    expect(property.insertText).toBe("length");
    expect(property.range).toMatchObject({
      start: { line: 3, character: propertyPosition - 2 },
      end: { line: 3, character: propertyPosition }
    });
  });

  it("keeps @, module ::, and property . prefixes outside the replacement", () => {
    const referenceSource = [
      "nui 1",
      "const width: number = 1",
      "const value: number = @se"
    ].join("\n");
    const reference = itemsFor(referenceSource).find((item) => item.label === "width")!;
    expect(reference.insertText).toBe("width");
    expect(reference.range).toMatchObject({ start: { line: 2, character: 23 }, end: { line: 2, character: 25 } });

    const qualifiedSource = [
      "nui 1",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "point X = offset(from: @G::P, dx: 0, dy: 0)"
    ].join("\n");
    const qualifiedLine = qualifiedSource.split("\n")[4]!;
    const qualified = itemsFor(qualifiedSource, 4, qualifiedLine.indexOf("@G::P") + "@G::P".length).find((item) => item.label === "P")!;
    expect(qualified.insertText).toBe("P");
    expect(qualified.range).toMatchObject({ start: { line: 4, character: 27 }, end: { line: 4, character: 28 } });

    const propertySource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: @A, end: @A)",
      "const value: number = @AB.length"
    ].join("\n");
    const propertyLine = propertySource.split("\n")[3]!;
    const property = itemsFor(propertySource, 3, propertyLine.indexOf("@AB.length") + "@AB.length".length).find((item) => item.label === "length")!;
    expect(property.insertText).toBe("length");
    expect(property.range).toMatchObject({ start: { line: 3, character: 26 }, end: { line: 3, character: 32 } });
  });

  it("preserves UTF-16 Japanese ranges and removes CRLF only for the query", () => {
    const normalized = [
      "nui 1",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用 = offset(from: @前身頃, dx: 0, dy: 0)"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const japaneseLine = normalized.split("\n")[2]!;
    const items = itemsFor(source, 2, japaneseLine.indexOf("@前身頃") + "@前身頃".length);
    const candidate = items.find((item) => item.label === "前身頃")!;
    const line = normalized.split("\n")[2]!;
    const from = line.indexOf("@前身頃") + 1;
    expect(candidate.range).toMatchObject({
      start: { line: 2, character: from },
      end: { line: 2, character: from + "前身頃".length }
    });
  });

  it("uses a snippet only for the choice type and keeps set targets bare", () => {
    const choice = itemsFor("nui 1\nconst value: cho").find((item) => item.label === "choice")!;
    expect(choice.insertText).toBeInstanceOf(vscode.SnippetString);
    expect((choice.insertText as vscode.SnippetString).value).toBe("choice($0)");

    const setSource = [
      "nui 1",
      "let target: number = 1",
      "set target = 1"
    ].join("\n");
    const target = itemsFor(setSource, 2, "set target".length).find((item) => item.label === "target")!;
    expect(target.insertText).toBe("target");
  });

  it("adds @ only for bare binding and geometry references", () => {
    const result = {
      context: {} as never,
      category: "typedInitializer" as const,
      replacementRange: { from: 10, to: 10 },
      candidates: [
        { kind: "binding" as const, label: "width" },
        { kind: "geometry" as const, label: "A" }
      ]
    };
    const items = projectDslCompletionItems("const x = ", result);
    expect(items.map((item) => item.insertText)).toEqual(["@width", "@A"]);
  });

  it("does not add call parentheses and does not truncate query results", () => {
    const construction = itemsFor("nui 1\npoint P = co").find((item) => item.label === "coordinate")!;
    expect(construction.insertText).toBe("coordinate");

    const points = Array.from({ length: 12 }, (_, index) => `point P${index} = coordinate(x: ${index}, y: 0)`);
    const source = [
      "nui 1",
      ...points,
      "line L = segment(start: @P0, end: @P1)"
    ].join("\n");
    const manyLine = source.split("\n")[13]!;
    const items = itemsFor(source, 13, manyLine.indexOf("@P0") + "@P0".length);
    expect(items.filter((item) => /^P\d+$/.test(String(item.label)))).toHaveLength(12);
    expect(items.find((item) => item.label === "P11")?.insertText).toBe("P11");
    for (const item of items) {
      expect(item.filterText).toBeUndefined();
      expect(item.sortText).toBeUndefined();
      expect(item.preselect).toBeUndefined();
    }
  });

  it("offers transformCopy and its existing argument names through the native provider", () => {
    const constructionItems = itemsFor("nui 1\nline L = tran");
    expect(constructionItems.map((item) => item.label)).toContain("transformCopy");
    expect(constructionItems.map((item) => item.label)).not.toContain("copy");
    expect(constructionItems.find((item) => item.label === "transformCopy")?.insertText).toBe("transformCopy");

    const argumentItems = itemsFor("nui 1\nline L = transformCopy(");
    expect(argumentItems.map((item) => item.label)).toEqual(expect.arrayContaining([
      "startPoint", "endPoint", "scale", "angleDeg", "mirrorX", "baseLines"
    ]));
  });

  it("keeps Module template-hole completion scoped to Module parameters and locals", () => {
    const source = [
      "nui 1",
      "const outer: number = 10",
      "module M(width: number) {",
      "  const local: number = 1",
      "  text Label = label(text: \"width=${@}\", anchor: (0, 0))",
      "}"
    ].join("\n");
    const lines = source.split("\n");
    const line = lines.findIndex((value) => value.includes('text Label = label(text: "width='));
    const lineText = lines[line]!;
    const items = itemsFor(source, line, lineText.indexOf("${@") + 3);

    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["width", "local"]));
    expect(items.map((item) => item.label)).not.toContain("outer");
  });

  it("returns syntax candidates for incomplete source and does not require Rust", () => {
    const source = "nui 1\npoint P = co";
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiCompletionProvider(() => session);
    const result = provider.provideCompletionItems(
      documentFor(source) as vscode.TextDocument,
      new vscode.Position(1, source.split("\n")[1]!.length),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];

    expect(result.map((item) => item.label)).toContain("coordinate");
    expect(session.getSource()).toBe(source);
  });

  it("projects normalized offsets in both directions without CRLF drift", () => {
    const source = "nui 1\r\n日本語";
    const normalized = source.replace(/\r\n/g, "\n");
    expect(normalizedOffsetAt(normalized, new vscode.Position(1, 2))).toBe(8);
    expect(normalizedPositionAt(normalized, 8)).toMatchObject({ line: 1, character: 2 });
  });

  it("does not use stale semantic candidates after a fatal edit", () => {
    const source = "nui 1\nconst old: number = 1\nconst value: number = @old";
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiCompletionProvider(() => session);
    session.replaceSource("nui 1\npoint Broken = coordinate(");
    const items = provider.provideCompletionItems(
      documentFor("nui 1\npoint Broken = coordinate(") as vscode.TextDocument,
      new vscode.Position(1, "point Broken = coordinate(".length),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];

    expect(items.map((item) => item.label)).not.toContain("old");
  });

  it("recovers Module argument labels from the last-good call identity while typing", () => {
    const session = createLanguageAnalysisSession(optionalModuleSource);
    const provider = createNuiCompletionProvider(() => session);
    session.replaceSource(transientOptionalModuleSource);

    const items = provider.provideCompletionItems(
      documentFor(transientOptionalModuleSource) as vscode.TextDocument,
      new vscode.Position(9, 3),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];
    const value = items.find((item) => item.label === "value")!;

    expect(items.map((item) => item.label)).toContain("value");
    expect(value.insertText).toBe("value: ");
    expect(value.range).toMatchObject({
      start: { line: 9, character: 2 },
      end: { line: 9, character: 3 }
    });
  });

  it("does not recover stale Module labels after the callee loses its proven identity", () => {
    const session = createLanguageAnalysisSession(optionalModuleSource);
    const provider = createNuiCompletionProvider(() => session);
    const changedCalleeSource = transientOptionalModuleSource.replace("M(\n  v", "Other(\n  v");
    session.replaceSource(changedCalleeSource);

    const items = provider.provideCompletionItems(
      documentFor(changedCalleeSource) as vscode.TextDocument,
      new vscode.Position(9, 3),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];

    expect(items.map((item) => item.label)).not.toContain("value");
  });

  it("keeps the provider limited to the query result", () => {
    const source = "nui 1\nconst value: number = ab";
    const session = createLanguageAnalysisSession(source);
    const provider = createNuiCompletionProvider(() => session);
    const normalized = source.replace(/\r\n/g, "\n");
    const query = queryDslCompletion({
      source: { normalizedSource: normalized, sourceRevision: session.getSourceRevision() },
      position: normalized.length,
      semantic: session.completionSemanticSnapshot({ normalizedSource: normalized, sourceRevision: session.getSourceRevision() })
    });
    const items = provider.provideCompletionItems(
      documentFor(source) as vscode.TextDocument,
      new vscode.Position(1, "const value: number = ab".length),
      undefined as never,
      undefined as never
    ) as vscode.CompletionItem[];
    expect(items).toHaveLength(query?.candidates.length ?? 0);
  });
});
