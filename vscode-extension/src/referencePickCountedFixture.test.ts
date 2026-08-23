import { describe, expect, it, vi } from "vitest";
import { createLogicalStatementSourceMap } from "../../src/dsl/logicalStatementSourceMap";
import { queryDslReferencePickTarget } from "../../src/dsl/dslReferencePickQuery";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

vi.mock("vscode", () => ({}));
vi.mock("./referencePickSourceBridge", () => ({
  createVscodeReferencePickSourceBridge: vi.fn()
}));

import { referencePickSourceOffsetForEditor } from "./referencePickCommandFeature";

const source = [
  "nui 4",
  "",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 80, y: 0)",
  "point C = coordinate(x: 40, y: 60)",
  "",
  "line Base = segment(start: @A, end: @B)",
  "line Other = segment(start: @A, end: @C)",
  "curve Curve = bezier(start: @A, end: @C, startAngle: 0, startLength: 25, endAngle: 180, endLength: 25)",
  "arc Arc = arc(center: @C, radius: 20, start: 0, end: 180)",
  "",
  "point OffsetPoint = offset(from: @A, dx: 20, dy: 10)",
  "line Seam = offset(sources: [@Base], distance: 10, side: left, closed: false, suppressTrimWarnings: false)",
  "",
  "module PickModule(anchor: point, straight: line, broad: path) {",
  "}",
  "",
  "instance PickInstance = PickModule(",
  "  anchor: @A,",
  "  straight: @Base,",
  "  broad: @Curve,",
  ")",
  "",
  "const DistancePoints: number = distance(@A, @B)",
  "const AnglePoints: number = angle(@A, @B)",
  "const DistancePointLine: number = lineDistance(@A, @Base)",
  "const AngleLines: number = lineAngle(@Base, @Other)",
  "const NumericLiteral: number = 20",
  "const NumericProperty: number = @Base.length",
  ""
].join("\n");

type TestPosition = { offset: number };
type TestDocument = {
  version: number;
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: TestPosition) => number;
};

type TestEditor = {
  document: TestDocument;
  selection: { active: TestPosition };
};

const editorAt = (offset: number): TestEditor => ({
  document: {
    version: 1,
    fileName: "/tmp/say-99-counted.nui",
    uri: { scheme: "file", toString: () => "file:///tmp/say-99-counted.nui" },
    getText: () => source,
    offsetAt: (position) => position.offset
  },
  selection: { active: { offset } }
});

const atEndOf = (fragment: string, after = 0): number => {
  const from = source.indexOf(fragment, after);
  if (from < 0) throw new Error(`missing fixture fragment: ${fragment}`);
  return from + fragment.length;
};

describe("SAY-99 counted-run Reference Pick fixture", () => {
  it("has an exact-current semantic snapshot suitable for Reference Pick", () => {
    const languageSession = createLanguageAnalysisSession(source);
    expect(languageSession.getDiagnostics()).toEqual([]);
  });

  it("keeps the production statement identity aligned for the first Pick target", () => {
    const languageSession = createLanguageAnalysisSession(source);
    const sourceSnapshot = {
      normalizedSource: source,
      sourceRevision: languageSession.getSourceRevision()
    };
    const semantic = languageSession.definitionSemanticSnapshot(sourceSnapshot);
    expect(semantic).toBeDefined();
    const compiled = semantic!.compiled;
    const offsetPointLine = source.indexOf("point OffsetPoint");
    const offset = atEndOf("@A", offsetPointLine);
    const logicalMap = createLogicalStatementSourceMap(sourceSnapshot);
    const statementIndex = logicalMap.statements.findIndex((statement) =>
      offset >= statement.range.from && offset <= statement.range.to
    );
    expect(statementIndex).toBeGreaterThanOrEqual(0);

    const statementMapId = compiled.statementMap?.statementIdByStatementIndex.get(statementIndex);
    const namespaceDeclarationIds = compiled.sourceLexicalNamespace?.allDeclarations
      .filter((declaration) => declaration.statementIndex === statementIndex)
      .map((declaration) => declaration.statementId) ?? [];
    const scopeId = compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(statementIndex);

    expect(namespaceDeclarationIds).toEqual([statementMapId]);
    expect(scopeId).toBeTruthy();
    expect(queryDslReferencePickTarget({
      source: sourceSnapshot,
      position: offset,
      semantic
    })).not.toBeNull();
  });

  it("resolves the production VS Code adapter target at representative contracted sites", () => {
    const languageSession = createLanguageAnalysisSession(source);
    const offsetPointLine = source.indexOf("point OffsetPoint");
    const instanceLine = source.indexOf("instance PickInstance");
    const distanceLine = source.indexOf("const DistancePoints");
    const numericLine = source.indexOf("const NumericLiteral");
    const propertyLine = source.indexOf("const NumericProperty");

    const offsets = [
      atEndOf("@A", offsetPointLine),
      atEndOf("@A", instanceLine),
      atEndOf("@A", distanceLine),
      atEndOf("20", numericLine),
      atEndOf("@Base", propertyLine)
    ];

    for (const offset of offsets) {
      expect(referencePickSourceOffsetForEditor(editorAt(offset) as never, languageSession)).toBe(offset);
    }
  });
});
