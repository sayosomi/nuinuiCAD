import { describe, expect, it, vi } from "vitest";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import {
  createLanguageAnalysisSession,
  currentCompiledSemanticSnapshotFor
} from "./languageAnalysisSession";

vi.mock("vscode", () => ({}));
vi.mock("./referencePickSourceBridge", () => ({
  createVscodeReferencePickSourceBridge: vi.fn()
}));

import { referencePickSourceOffsetForEditor } from "./referencePickCommandFeature";

const source = [
  "nui 1",
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

  it("resolves a host-neutral target after top-level blank lines", () => {
    const languageSession = createLanguageAnalysisSession(source);
    const sourceSnapshot = {
      normalizedSource: source,
      sourceRevision: languageSession.getSourceRevision()
    };
    const semantic = currentCompiledSemanticSnapshotFor(languageSession, sourceSnapshot);
    expect(semantic).toBeDefined();
    const offsetPointLine = source.indexOf("point OffsetPoint");
    const offset = atEndOf("@A", offsetPointLine);

    expect(queryDslReferencePickTarget({
      source: sourceSnapshot,
      position: offset,
      semantic
    })).toMatchObject({
      expectedGeometryInterface: "point",
      role: "geometry",
      multiplicity: "single",
      range: {
        from: offset - "@A".length,
        to: offset
      }
    });
  });

  it("resolves the production VS Code adapter target across counted-run target families", () => {
    const languageSession = createLanguageAnalysisSession(source);
    const offsetPointLine = source.indexOf("point OffsetPoint");
    const seamLine = source.indexOf("line Seam");
    const instanceLine = source.indexOf("instance PickInstance");
    const anchorLine = source.indexOf("anchor: @A", instanceLine);
    const straightLine = source.indexOf("straight: @Base", instanceLine);
    const broadLine = source.indexOf("broad: @Curve", instanceLine);
    const distanceLine = source.indexOf("const DistancePoints");
    const angleLine = source.indexOf("const AnglePoints");
    const lineDistanceLine = source.indexOf("const DistancePointLine");
    const lineAngleLine = source.indexOf("const AngleLines");
    const numericLine = source.indexOf("const NumericLiteral");
    const propertyLine = source.indexOf("const NumericProperty");

    const offsets = [
      atEndOf("@A", offsetPointLine),
      atEndOf("@Base", seamLine),
      atEndOf("@A", anchorLine),
      atEndOf("@Base", straightLine),
      atEndOf("@Curve", broadLine),
      atEndOf("@A", distanceLine),
      atEndOf("@A", angleLine),
      atEndOf("@A", lineDistanceLine),
      atEndOf("@Base", lineDistanceLine),
      atEndOf("@Base", lineAngleLine),
      atEndOf("@Other", lineAngleLine),
      atEndOf("20", numericLine),
      atEndOf("@Base", propertyLine)
    ];

    for (const offset of offsets) {
      expect(referencePickSourceOffsetForEditor(editorAt(offset) as never, languageSession)).toBe(offset);
    }
  });
});
