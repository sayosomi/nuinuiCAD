import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class WorkspaceEdit {
    readonly edits: Array<{ uri: unknown; range: Range; newText: string }> = [];

    replace(uri: unknown, range: Range, newText: string): void {
      this.edits.push({ uri, range, newText });
    }
  }
  return { Position, Range, WorkspaceEdit };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { compileDslDocument, createDslSemanticOccurrenceIndex, parseDslSnapshot } from "@nuinuicad/nui-language";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiRenameProvider,
  nuiRenameSelector,
  renameRejectionMessage
} from "./renameProvider";

type TestDocument = {
  fileName: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: vscode.Position) => number;
  positionAt: (offset: number) => vscode.Position;
  setSourceText: (text: string) => void;
  onGetText?: () => void;
};

type TestWorkspaceEdit = {
  edits: Array<{ uri: unknown; range: vscode.Range; newText: string }>;
};

type QualifiedProviderRenameCase = {
  label: string;
  source: string;
  expectedSource: string;
  oldName: string;
  newName: string;
  sourceReference: string;
  expectedReference: string;
};

const qualifiedProviderRenameCases: readonly QualifiedProviderRenameCase[] = [
  {
    label: "A group-qualified reference",
    source: [
      "nui 1",
      "group Front {",
      "  const dart_close_angle: number = 15",
      "}",
      "const outside_angle: number = @Front::dart_close_angle + 30"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "group Front {",
      "  const chest_dart_angle: number = 15",
      "}",
      "const outside_angle: number = @Front::chest_dart_angle + 30"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "chest_dart_angle",
    sourceReference: "@Front::dart_close_angle",
    expectedReference: "@Front::chest_dart_angle"
  },
  {
    label: "B absolute root without a shadow",
    source: [
      "nui 1",
      "const dart_close_angle: number = 15",
      "group Inside {",
      "  const outside_angle: number = @::dart_close_angle + 30",
      "}"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "const chest_dart_angle: number = 15",
      "group Inside {",
      "  const outside_angle: number = @::chest_dart_angle + 30",
      "}"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "chest_dart_angle",
    sourceReference: "@::dart_close_angle",
    expectedReference: "@::chest_dart_angle"
  },
  {
    label: "C absolute root with a same-named group shadow",
    source: [
      "nui 1",
      "const dart_close_angle: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = @::dart_close_angle + 30",
      "}"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "const chest_dart_angle: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = @::chest_dart_angle + 30",
      "}"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "chest_dart_angle",
    sourceReference: "@::dart_close_angle",
    expectedReference: "@::chest_dart_angle"
  },
  {
    label: "C renamed to test",
    source: [
      "nui 1",
      "const dart_close_angle: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = @::dart_close_angle + 30",
      "}"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "const test: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = @::test + 30",
      "}"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "test",
    sourceReference: "@::dart_close_angle",
    expectedReference: "@::test"
  }
];

const documentFor = (
  initialSource: string,
  fileName = "/tmp/pattern.nui",
  scheme = "file"
): TestDocument => {
  let source = initialSource;
  const document: TestDocument = {
    fileName,
    version: 1,
    uri: { scheme, toString: () => `${scheme}://${fileName}` },
    getText: () => {
      document.onGetText?.();
      return source;
    },
    offsetAt: (position) => {
      const starts = lineStartsFor(source);
      const line = Math.min(Math.max(position.line, 0), starts.length - 1);
      const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : source.length;
      const character = Math.min(Math.max(position.character, 0), lineEnd - starts[line]!);
      return starts[line]! + character;
    },
    positionAt: (offset) => {
      const starts = lineStartsFor(source);
      const clampedOffset = Math.min(Math.max(offset, 0), source.length);
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= clampedOffset) line += 1;
      return new vscode.Position(line, clampedOffset - starts[line]!);
    },
    setSourceText: (nextSource) => { source = nextSource; }
  };
  return document;
};

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const positionAtText = (document: TestDocument, source: string, token: string, offset = 0): vscode.Position =>
  document.positionAt(source.indexOf(token) + offset);

const providerFor = (source: string, document: TestDocument = documentFor(source)) => {
  const session = createLanguageAnalysisSession(source);
  return { document, provider: createNuiRenameProvider(() => session), session };
};

const prepareAt = (provider: vscode.RenameProvider, document: TestDocument, position: vscode.Position) =>
  provider.prepareRename!(document as unknown as vscode.TextDocument, position, undefined as never);

const editsAt = (
  provider: vscode.RenameProvider,
  document: TestDocument,
  position: vscode.Position,
  newName: string
) => provider.provideRenameEdits!(
  document as unknown as vscode.TextDocument,
  position,
  newName,
  undefined as never
) as TestWorkspaceEdit | undefined;

const applyWorkspaceEdits = (
  source: string,
  document: TestDocument,
  edits: TestWorkspaceEdit["edits"]
) => [...edits]
  .map((edit) => ({
    from: document.offsetAt(edit.range.start),
    to: document.offsetAt(edit.range.end),
    newText: edit.newText
  }))
  .sort((left, right) => right.from - left.from || right.to - left.to)
  .reduce((text, edit) => text.slice(0, edit.from) + edit.newText + text.slice(edit.to), source);

const compileRenameOracle = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, "provider-rename-oracle:" + index]))
  });
};

const assertProviderRenameIdentityOracle = (testCase: QualifiedProviderRenameCase) => {
  const before = compileRenameOracle(testCase.source);
  const expected = compileRenameOracle(testCase.expectedSource);
  expect(before.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(expected.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const target = before.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === testCase.oldName);
  expect(target).toBeDefined();
  if (!target) return;
  const renamedTarget = expected.bindingAnalysis?.catalog.bindings.find((binding) =>
    binding.kind === "typed" && binding.name === testCase.newName && binding.statementIndex === target.statementIndex
  );
  expect(renamedTarget?.id).toBe(target.id);
  const referenceFrom = testCase.expectedSource.indexOf(testCase.expectedReference) + testCase.expectedReference.length - testCase.newName.length;
  const reference = createDslSemanticOccurrenceIndex(expected).occurrences.find((occurrence) =>
    occurrence.kind === "reference" && occurrence.from === referenceFrom && occurrence.to === referenceFrom + testCase.newName.length && occurrence.identity.kind === "typed"
  );
  expect(reference?.identity).toEqual({ kind: "typed", bindingId: target.id });
};

describe("VS Code native nui rename provider", () => {
  it.each(qualifiedProviderRenameCases)("preserves only the terminal leaf for $label", (testCase) => {
    assertProviderRenameIdentityOracle(testCase);
    const { document, provider } = providerFor(testCase.source);
    const declarationFrom = testCase.source.indexOf("const " + testCase.oldName) + "const ".length;
    let observed: {
      status: "ok" | "rejected" | "unavailable";
      rejection: string | null;
      edits: Array<{ from: number; to: number; oldText: string; newText: string }>;
      candidateSource: string | null;
    };
    try {
      const workspaceEdit = editsAt(provider, document, document.positionAt(declarationFrom), testCase.newName);
      if (!workspaceEdit) {
        observed = { status: "unavailable", rejection: null, edits: [], candidateSource: null };
      } else {
        const edits = workspaceEdit.edits.map((edit) => {
          const from = document.offsetAt(edit.range.start);
          const to = document.offsetAt(edit.range.end);
          return { from, to, oldText: testCase.source.slice(from, to), newText: edit.newText };
        }).sort((left, right) => left.from - right.from);
        observed = {
          status: "ok",
          rejection: null,
          edits,
          candidateSource: applyWorkspaceEdits(testCase.source, document, workspaceEdit.edits)
        };
      }
    } catch (error) {
      observed = {
        status: "rejected",
        rejection: error instanceof Error ? error.message : String(error),
        edits: [],
        candidateSource: null
      };
    }

    const referenceFrom = testCase.source.indexOf(testCase.sourceReference) + testCase.sourceReference.length - testCase.oldName.length;
    const expectedEdits = [
      { from: declarationFrom, to: declarationFrom + testCase.oldName.length, oldText: testCase.oldName, newText: testCase.newName },
      { from: referenceFrom, to: referenceFrom + testCase.oldName.length, oldText: testCase.oldName, newText: testCase.newName }
    ].sort((left, right) => left.from - right.from);
    expect(observed).toEqual({
      status: "ok",
      rejection: null,
      edits: expectedEdits,
      candidateSource: testCase.expectedSource
    });
  });

  it("renames nested qualified and unqualified uses and leaves comments and strings alone", () => {
    const source = [
      "nui 1",
      "group Front {",
      "  group Inner {",
      "    const dart_close_angle: number = 15",
      "    const inside_use: number = @dart_close_angle + 1",
      "  }",
      "}",
      "const first_use: number = @Front::Inner::dart_close_angle + 2",
      "const second_use: number = @Front::Inner::dart_close_angle + 3",
      "// @Front::Inner::dart_close_angle in a comment stays authored",
      "const note: string = \"@Front::Inner::dart_close_angle\"",
      "group Other {",
      "  const dart_close_angle: number = 99",
      "}"
    ].join("\n");
    const expectedSource = [
      "nui 1",
      "group Front {",
      "  group Inner {",
      "    const chest_dart_angle: number = 15",
      "    const inside_use: number = @chest_dart_angle + 1",
      "  }",
      "}",
      "const first_use: number = @Front::Inner::chest_dart_angle + 2",
      "const second_use: number = @Front::Inner::chest_dart_angle + 3",
      "// @Front::Inner::dart_close_angle in a comment stays authored",
      "const note: string = \"@Front::Inner::dart_close_angle\"",
      "group Other {",
      "  const dart_close_angle: number = 99",
      "}"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const declarationFrom = source.indexOf("const dart_close_angle") + "const ".length;
    const workspaceEdit = editsAt(provider, document, document.positionAt(declarationFrom), "chest_dart_angle");
    expect(workspaceEdit).toBeDefined();
    expect(workspaceEdit && applyWorkspaceEdits(source, document, workspaceEdit.edits)).toBe(expectedSource);
    expect(workspaceEdit?.edits.map((edit) => {
      const from = document.offsetAt(edit.range.start);
      const to = document.offsetAt(edit.range.end);
      return { from, to, oldText: source.slice(from, to), newText: edit.newText };
    })).toEqual([
      { from: declarationFrom, to: declarationFrom + "dart_close_angle".length, oldText: "dart_close_angle", newText: "chest_dart_angle" },
      { from: source.indexOf("@dart_close_angle") + "@dart_close_angle".length - "dart_close_angle".length, to: source.indexOf("@dart_close_angle") + "@dart_close_angle".length, oldText: "dart_close_angle", newText: "chest_dart_angle" },
      ...[...source.matchAll(/@Front::Inner::dart_close_angle/g)].slice(0, 2).map((match) => {
        const from = match.index! + "@Front::Inner::dart_close_angle".length - "dart_close_angle".length;
        return { from, to: from + "dart_close_angle".length, oldText: "dart_close_angle", newText: "chest_dart_angle" };
      })
    ].sort((left, right) => left.from - right.from));
  });

  it("projects style declaration and reference edits as one WorkspaceEdit", () => {
    const source = [
      "nui 1",
      'style "Guide Line" {',
      "  visible: true,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      'line L ["Guide Line"] = segment(start: @A, end: @A)'
    ].join("\n");
    const { document, provider } = providerFor(source);
    const reference = source.lastIndexOf("Guide Line") + 1;
    expect(prepareAt(provider, document, document.positionAt(reference))).toMatchObject({ placeholder: "Guide Line" });
    const edits = editsAt(provider, document, document.positionAt(reference), "Guide");
    expect(edits?.edits.map((edit) => edit.newText)).toEqual(["Guide", "Guide"]);
  });

  it("uses the file-scoped selector and rejects unsupported documents", () => {
    expect(nuiRenameSelector).toEqual({ language: "nui", scheme: "file" });

    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const unsupportedCase = providerFor(source, documentFor(source, "/tmp/pattern.txt"));
    const untitledCase = providerFor(source, documentFor(source, "/tmp/pattern.nui", "untitled"));

    expect(prepareAt(unsupportedCase.provider, unsupportedCase.document, new vscode.Position(1, 6))).toBeUndefined();
    expect(prepareAt(untitledCase.provider, untitledCase.document, new vscode.Position(1, 6))).toBeUndefined();
  });

  it("prepares declaration and reference renames with exact identifier ranges", () => {
    const source = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Use = offset(from: @Base, dx: 1, dy: 0)"
    ].join("\n");
    const { document, provider } = providerFor(source);

    const declaration = prepareAt(provider, document, positionAtText(document, source, "Base"));
    const reference = prepareAt(provider, document, positionAtText(document, source, "@Base", 1));

    expect(declaration).toMatchObject({
      range: {
        start: { line: 1, character: "point ".length },
        end: { line: 1, character: "point Base".length }
      },
      placeholder: "Base"
    });
    expect(reference).toMatchObject({
      range: {
        start: { line: 2, character: source.split("\n")[2]!.indexOf("@Base") + 1 },
        end: { line: 2, character: source.split("\n")[2]!.indexOf("@Base") + 1 + "Base".length }
      },
      placeholder: "Base"
    });
  });

  it("keeps @, ::, dot, and property names outside rename ranges", () => {
    const source = [
      "nui 1",
      "group Front {",
      "  point Shoulder = coordinate(x: 0, y: 0)",
      "}",
      "point Use = offset(from: @Front::Shoulder, dx: 1, dy: 0)",
      "point WithProperty = coordinate(x: @Front::Shoulder.x, y: 0)"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const qualified = "@Front::Shoulder";
    const frontOffset = source.indexOf(qualified) + 1;
    const shoulderOffset = source.indexOf(qualified) + "@Front::".length;
    const propertyOffset = source.indexOf(".x") + 1;

    expect(prepareAt(provider, document, document.positionAt(frontOffset))).toMatchObject({ placeholder: "Front" });
    expect(prepareAt(provider, document, document.positionAt(frontOffset))).toMatchObject({
      range: { start: document.positionAt(frontOffset), end: document.positionAt(frontOffset + "Front".length) }
    });
    expect(prepareAt(provider, document, document.positionAt(shoulderOffset))).toMatchObject({ placeholder: "Shoulder" });
    expect(() => prepareAt(provider, document, document.positionAt(propertyOffset))).toThrow(
      "Rename is not available at this position."
    );
  });

  it("projects every Task 7 edit into one same-document WorkspaceEdit", () => {
    const source = [
      "nui 1",
      "point Base = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "// Base remains unrelated text",
      "point Use = offset(",
      "  from: @Base,",
      "  dx: 1,",
      "  dy: 0,",
      ")",
      "point BaseCopy = coordinate(",
      "  x: 2,",
      "  y: 0,",
      ")"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const position = positionAtText(document, source, "@Base", 1);
    const edit = editsAt(provider, document, position, "Renamed");

    expect(edit).toBeDefined();
    expect(edit?.edits).toHaveLength(2);
    expect(edit?.edits.every((entry) => entry.uri === document.uri && entry.newText === "Renamed")).toBe(true);
    expect(edit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["Base", "Base"]);
    expect(source).toContain("// Base remains unrelated text");
    expect(source).toContain("BaseCopy");
  });

  it("projects Module parameter declaration, references, and call labels", () => {
    const source = [
      "nui 1",
      "module Measure(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Call = Measure(width: 10)"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const edit = editsAt(provider, document, positionAtText(document, source, "width: number"), "length");

    expect(edit).toBeDefined();
    expect(edit?.edits).toHaveLength(3);
    expect(edit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["width", "width", "width"]);
    expect(edit?.edits.every((entry) => entry.uri === document.uri)).toBe(true);
  });

  it("keeps UTF-16 ranges exact for CRLF, Japanese identifiers, and an earlier surrogate pair", () => {
    const normalized = [
      "nui 1",
      "// 😀",
      "point 前身頃 = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point 使用 = offset(",
      "  from: @前身頃,",
      "  dx: 1,",
      "  dy: 0,",
      ")"
    ].join("\n");
    const source = normalized.replace(/\n/g, "\r\n");
    const document = documentFor(source);
    const { provider } = providerFor(source, document);
    const referenceLine = normalized.split("\n")[7]!;
    const referenceStart = referenceLine.indexOf("@前身頃");
    const prepared = prepareAt(provider, document, new vscode.Position(7, referenceStart + 1));
    const edit = editsAt(provider, document, new vscode.Position(7, referenceStart + 1), "後身頃");

    expect(prepared).toMatchObject({
      range: {
        start: { line: 7, character: referenceStart + 1 },
        end: { line: 7, character: referenceStart + 1 + "前身頃".length }
      },
      placeholder: "前身頃"
    });
    expect(edit?.edits).toHaveLength(2);
    expect(edit?.edits.map((entry) => ({
      start: entry.range.start,
      end: entry.range.end,
      text: entry.newText
    }))).toEqual([
      {
        start: { line: 2, character: "point ".length },
        end: { line: 2, character: "point 前身頃".length },
        text: "後身頃"
      },
      {
        start: { line: 7, character: referenceStart + 1 },
        end: { line: 7, character: referenceStart + 1 + "前身頃".length },
        text: "後身頃"
      }
    ]);
  });

  it("synchronizes an existing session from the current unsaved TextDocument", () => {
    const initialSource = "nui 1\npoint Old = coordinate(x: 0, y: 0)";
    const currentSource = [
      "nui 1",
      "point Current = coordinate(x: 0, y: 0)",
      "point Use = offset(from: @Current, dx: 1, dy: 0)"
    ].join("\n");
    const session = createLanguageAnalysisSession(initialSource);
    const document = documentFor(currentSource);
    const provider = createNuiRenameProvider(() => session);
    const prepared = prepareAt(provider, document, positionAtText(document, currentSource, "@Current", 1));

    expect(session.getSource()).toBe(currentSource);
    expect(prepared).toMatchObject({ placeholder: "Current" });
  });

  it("explains semantic rename rejections and fails closed for unavailable renames", () => {
    const valid = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const fatalDocument = documentFor("nui 1\npoint A = coordinate(x: 0, y: ");
    const fatalSession = createLanguageAnalysisSession(valid);
    fatalSession.replaceSource(fatalDocument.getText());
    const fatalProvider = createNuiRenameProvider(() => fatalSession);
    expect(() => prepareAt(fatalProvider, fatalDocument, new vscode.Position(1, 6))).toThrow(
      "Rename is unavailable because the current Source has errors. Fix them and try again."
    );
    expect(() => editsAt(fatalProvider, fatalDocument, new vscode.Position(1, 6), "Renamed")).toThrow(
      "Rename is unavailable because the current Source has errors. Fix them and try again."
    );

    const collisionSource = [
      "nui 1",
      "const width: number = 10",
      "const result: number = @width + 5"
    ].join("\n");
    const { document: collisionDocument, provider: collisionProvider } = providerFor(collisionSource);
    expect(() => editsAt(
      collisionProvider,
      collisionDocument,
      positionAtText(collisionDocument, collisionSource, "@width", 1),
      "result"
    )).toThrow("'result' already exists in this scope on line 3.");
    expect(() => editsAt(
      collisionProvider,
      collisionDocument,
      positionAtText(collisionDocument, collisionSource, "@width", 1),
      ""
    )).toThrow("Enter a valid name.");

    const captureSource = [
      "nui 1",
      "const outer: number = 1",
      "group G {",
      "  const inner: number = 2",
      "  const use: number = @outer",
      "}"
    ].join("\n");
    const { document: captureDocument, provider: captureProvider } = providerFor(captureSource);
    expect(() => editsAt(
      captureProvider,
      captureDocument,
      positionAtText(captureDocument, captureSource, "@outer", 1),
      "inner"
    )).toThrow("Rename would change the reference resolved by 'outer'.");

    const moduleCollisionSource = [
      "nui 1",
      "module Measure(width: number, length: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Call = Measure(width: 10, length: 20)"
    ].join("\n");
    const { document: moduleCollisionDocument, provider: moduleCollisionProvider } = providerFor(moduleCollisionSource);
    expect(() => editsAt(
      moduleCollisionProvider,
      moduleCollisionDocument,
      positionAtText(moduleCollisionDocument, moduleCollisionSource, "width: number"),
      "length"
    )).toThrow("'length' already exists in this scope on line 2.");

    const elementCollisionSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 0)"
    ].join("\n");
    const { document: elementCollisionDocument, provider: elementCollisionProvider } = providerFor(elementCollisionSource);
    expect(() => editsAt(
      elementCollisionProvider,
      elementCollisionDocument,
      positionAtText(elementCollisionDocument, elementCollisionSource, "A ="),
      "B"
    )).toThrow("'B' already exists in this scope on line 3.");

    expect(renameRejectionMessage({
      reason: "same-scope-collision",
      conflictingName: "result"
    })).toBe("'result' already exists in this scope.");

    expect(renameRejectionMessage({
      reason: "same-scope-collision",
      conflictingName: "result"
    }, "ja-JP")).toBe("'result' はこのスコープですでに存在します。");

    expect(renameRejectionMessage({
      reason: "same-scope-collision",
      conflictingName: "result",
      conflictingLine: 3
    }, "ja-JP")).toBe("'result' はこのスコープの 3 行目にすでに存在します。");

    const iterationSource = [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const { document: iterationDocument, provider: iterationProvider } = providerFor(iterationSource);
    expect(() => prepareAt(
      iterationProvider,
      iterationDocument,
      positionAtText(iterationDocument, iterationSource, "i in")
    )).toThrow("Rename is not available at this position.");
    expect(() => editsAt(
      iterationProvider,
      iterationDocument,
      positionAtText(iterationDocument, iterationSource, "i in"),
      "j"
    )).toThrow("Rename could not be applied.");
  });

  it("rejects a stale document and a plan whose expected source text is not exact", () => {
    const source = "nui 1\npoint Base = coordinate(x: 0, y: 0)\npoint Use = offset(from: @Base, dx: 1, dy: 0)";
    const staleDocument = documentFor(source);
    const stale = providerFor(source, staleDocument);
    let reads = 0;
    staleDocument.onGetText = () => {
      reads += 1;
      if (reads === 2) {
        staleDocument.version = 2;
        staleDocument.setSourceText(`${source}\n// changed during rename`);
      }
    };
    expect(() => editsAt(
      stale.provider,
      staleDocument,
      positionAtText(staleDocument, source, "@Base", 1),
      "Renamed"
    )).toThrow("Rename could not be applied.");

    const exactnessDocument = documentFor(source);
    const exactness = providerFor(source, exactnessDocument);
    const planSpy = vi.spyOn(exactness.session, "rename").mockReturnValue({
      status: "ok",
      plan: {
        sourceRevision: 1,
        target: { sourceRevision: 1, oldName: "Base", range: { from: 0, to: 4 } },
        edits: [{ from: 0, to: 4, expectedText: "wrong", newText: "Renamed" }]
      }
    });
    try {
      expect(() => editsAt(
        exactness.provider,
        exactnessDocument,
        positionAtText(exactnessDocument, source, "@Base", 1),
        "Renamed"
      )).toThrow("Rename could not be applied.");
    } finally {
      planSpy.mockRestore();
    }
  });

  it("renames ordinary and typed source targets in a mixed Module document", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = @width + 5",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用点 = offset(from: @前身頃, dx: 10, dy: 0)",
      "const 前身頃X: number = @前身頃.x",
      "module Measure(input: point) {",
      "  point P = offset(from: @input, dx: 10, dy: 0)",
      "}",
      "instance Call = Measure(input: @前身頃)"
    ].join("\n");
    const { document, provider } = providerFor(source);
    const elementEdit = editsAt(provider, document, positionAtText(document, source, "@前身頃", 1), "後身頃");
    const widthEdit = editsAt(provider, document, positionAtText(document, source, "@width", 1), "renamedWidth");

    expect(elementEdit?.edits).toHaveLength(4);
    expect(elementEdit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["前身頃", "前身頃", "前身頃", "前身頃"]);
    expect(widthEdit?.edits).toHaveLength(2);
    expect(widthEdit?.edits.map((entry) => source.slice(
      document.offsetAt(entry.range.start),
      document.offsetAt(entry.range.end)
    ))).toEqual(["width", "width"]);
  });

  it("does not expose unexpected core errors from prepareRename", () => {
    const source = "nui 1\npoint Base = coordinate(x: 0, y: 0)";
    const { document, session } = providerFor(source);
    const provider = createNuiRenameProvider(() => session);
    const querySpy = vi.spyOn(session, "prepareRename").mockImplementation(() => {
      throw new Error("bindingResolution: internal invariant");
    });
    try {
      expect(() => prepareAt(provider, document, positionAtText(document, source, "Base"))).toThrow(
        "Rename is not available at this position."
      );
      expect(() => prepareAt(provider, document, positionAtText(document, source, "Base"))).not.toThrow(
        "bindingResolution: internal invariant"
      );
    } finally {
      querySpy.mockRestore();
    }
  });

  it("does not expose unexpected core errors from provideRenameEdits", () => {
    const source = "nui 1\npoint Base = coordinate(x: 0, y: 0)";
    const { document, session } = providerFor(source);
    const provider = createNuiRenameProvider(() => session);
    const planSpy = vi.spyOn(session, "rename").mockImplementation(() => {
      throw new Error("bindingResolution: internal invariant");
    });
    try {
      expect(() => editsAt(provider, document, positionAtText(document, source, "Base"), "Renamed")).toThrow(
        "Rename could not be applied."
      );
      expect(() => editsAt(provider, document, positionAtText(document, source, "Base"), "Renamed")).not.toThrow(
        "bindingResolution: internal invariant"
      );
    } finally {
      planSpy.mockRestore();
    }
  });
});
