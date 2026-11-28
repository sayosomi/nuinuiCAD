import { queryDslCompletion, queryDslDocumentSymbols, queryDslFormatting, queryDslSignatureHelp } from "@nuinuicad/nui-language";
import { compileCanonicalText, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateWithRustOptions, fixtureFromSource, normalizeParityPayload, optionsFor } from "./evaluationParitySupport";

const sources = `nui 1
layer finished
layer construction
style outline {
  color: foreground,
}
style guide {
  lineType: dashed,
}

line Shoulder = segment(start: (10, 0), end: (20, 0))
line Side = segment(start: (40, 30), end: (40, 10))
line Dart = segment(start: (-5, 12), end: (0, 3))`;

const evaluate = (source: string) => {
  const fixture = fixtureFromSource(source);
  const options = optionsFor(fixture);
  const payload = evaluateElementsReferencePayload(fixture.elements, options);
  if (import.meta.env.VITE_RUN_RUST_PARITY === "1") {
    expect(normalizeParityPayload(evaluateWithRustOptions(process.cwd(), fixture.elements, options))).toEqual(normalizeParityPayload(payload));
  }
  const result = evaluationPayloadToResult(payload);
  return { fixture, result };
};

const expectEndpoints = (
  evaluated: ReturnType<typeof evaluate>,
  name: string,
  coordinates: [number, number, number, number]
) => {
  const element = evaluated.fixture.elements.find((item) => item.name === name);
  expect(element, name).toBeDefined();
  const geometry = evaluated.result.computedGeometry.get(element!.id);
  expect(geometry, name).toBeDefined();
  expect(geometry).toHaveProperty("start");
  expect(geometry).toHaveProperty("end");
  const { start, end } = geometry as { start: { x: number; y: number }; end: { x: number; y: number } };
  [start.x, start.y, end.x, end.y].forEach((value, index) => expect(value).toBeCloseTo(coordinates[index], 8));
};

describe("#1757 named transformCopy", () => {
  it.each([
    "shoulder: Shoulder, side: Side, dart[guide] in construction: Dart",
    "dart[guide] in construction: Dart, side: Side, shoulder: Shoulder"
  ])("copies the exact disconnected fixture independently with parts [%s]", (parts) => {
    const evaluated = evaluate(`${sources}

transformCopy Copied[outline] in finished(
  startPoint: (0, 0),
  endPoint: (100, 50),
  scale: 1,
  angleDeg: 90,
  mirrorX: false,
  parts: [${parts},],
)`);
    expect(evaluated.fixture.compiled!.diagnostics).toEqual([]);
    expect(evaluated.result.errors).toEqual([]);
    expect(evaluated.result.geometryValueErrors).toEqual([]);
    expectEndpoints(evaluated, "shoulder", [100, 60, 100, 70]);
    expectEndpoints(evaluated, "side", [70, 90, 90, 90]);
    expectEndpoints(evaluated, "dart", [88, 45, 97, 50]);
    expectEndpoints(evaluated, "Shoulder", [10, 0, 20, 0]);
    expectEndpoints(evaluated, "Side", [40, 30, 40, 10]);
    expectEndpoints(evaluated, "Dart", [-5, 12, 0, 3]);
    expect(evaluated.fixture.elements.some((element) => element.name === "Copied")).toBe(false);
  });

  it.each<[string, [number, number, number, number]]>([
    ["", [12, 20, 12, 23]],
    ["angleDeg: 90,", [10, 22, 7, 22]],
    ["scale: 2,", [14, 20, 14, 26]],
    ["mirrorX: true,", [8, 20, 8, 23]],
    ["mirrorX: true, scale: 2, angleDeg: 90,", [10, 16, 4, 16]]
  ])("uses the evaluated startPoint when endPoint is omitted (%s)", (args, endpoints) => {
    const evaluated = evaluate(`nui 1
line L = segment(start: (12, 20), end: (12, 23))
transformCopy Implicit(startPoint: (10, 20), ${args} parts: [implicit: L])
transformCopy Explicit(startPoint: (10, 20), endPoint: (10, 20), ${args} parts: [explicit: L])`);
    expect(evaluated.fixture.compiled!.diagnostics).toEqual([]);
    expect(evaluated.result.errors).toEqual([]);
    expect(evaluated.result.geometryValueErrors).toEqual([]);
    expectEndpoints(evaluated, "implicit", endpoints);
    expectEndpoints(evaluated, "explicit", endpoints);
  });
});

describe("legacy transformCopy syntax rejection", () => {
  it.each(["line Copied", "const Copied: path"])("rejects %s", (declaration) => {
    const compiled = compileFreshCanonicalText(`${sources}
${declaration} = transformCopy(startPoint: (0, 0), endPoint: (100, 50), baseLines: [Shoulder])`);
    expect(compiled.currentCompiled.document).toBeNull();
    expect(compiled.diagnostics).toContainEqual(expect.objectContaining({ code: "retired-transform-copy-construction" }));
  });

  it("copies the first source alone at the independent coordinates", () => {
    const evaluated = evaluate(`${sources}
transformCopy C(startPoint: (0, 0), endPoint: (100, 50), angleDeg: 90, parts: [Copied: Shoulder])`);
    expect(evaluated.result.errors).toEqual([]);
    expectEndpoints(evaluated, "Copied", [100, 60, 100, 70]);
  });
});

describe("#1757 dependencies", () => {
  it.each(["before", "after"])("applies a copied member's later move with a scalar %s the declaration", (position) => {
    const angle = "const angle: number = -45";
    const evaluated = evaluate(`nui 1
${position === "before" ? angle : ""}
line L = segment(start: (0, 0), end: (20, 0))
transformCopy C(startPoint: (0, 0), parts: [copy: L])
${position === "after" ? angle : ""}
move C::copy(from: (0, 0), to: (0, 0), angleDeg: angle)`);
    expect(evaluated.fixture.compiled!.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(evaluated.result.errors).toEqual([]);
    expectEndpoints(evaluated, "L", [0, 0, 20, 0]);
    expectEndpoints(evaluated, "copy", [0, 0, Math.sqrt(200), -Math.sqrt(200)]);
  });

  it("captures separate source recipes and isolates later source and part edits", () => {
    const evaluated = evaluate(`nui 1
line L = segment(start: (0, 0), end: (20, 0))
move L(from: (0, 0), to: (0, 10))
transformCopy C(startPoint: (0, 0), endPoint: (20, 0), parts: [first: L, second: L])
move L(from: (0, 0), to: (0, 30))
move C::second(from: (0, 0), to: (0, -10))`);
    expect(evaluated.result.errors).toEqual([]);
    expectEndpoints(evaluated, "L", [0, 40, 20, 40]);
    expectEndpoints(evaluated, "first", [20, 10, 40, 10]);
    expectEndpoints(evaluated, "second", [20, 0, 40, 0]);
  });

  it("keeps healthy siblings when the other member's source cannot resolve", () => {
    const evaluated = evaluate(`nui 1
line L = segment(start: (0, 0), end: (20, 0))
transformCopy C(startPoint: (0, 0), parts: [bad: Missing, good: L])`);
    expect(evaluated.fixture.compiled!.diagnostics).toHaveLength(1);
    expect(evaluated.fixture.compiled!.diagnostics[0]?.isolatedExtractPart?.boundary).toBe("source");
    expect(evaluated.result.errors).toHaveLength(1);
    expectEndpoints(evaluated, "good", [0, 0, 20, 0]);
    expect(evaluated.result.computedGeometry.has(evaluated.fixture.elements.find(element => element.name === "bad")!.id)).toBe(false);
  });
});

describe("#1757 primitive and publication contracts", () => {
  it("preserves a mirrored arc sweep, closed paths, and independent source orientation", () => {
    const { fixture, result } = evaluate(`nui 1
line AB = segment(start: (0, 0), end: (10, 0))
line BC = segment(start: (20, 0), end: (10, 0))
arc Quarter = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: @counterclockwise)
line Loop = polyline(points: [(0, 0), (6, 0), (0, 8)], closed: true)
transformCopy Parts(startPoint: (0, 0), endPoint: (30, 40), mirrorX: true, scale: 2, angleDeg: 90,
  parts: [p: AB, q: BC, duplicate: AB, arcPart: Quarter, loopPart: Loop])
`);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find(element => element.name === name)!.id);
    for (const [name, from, to] of [["p", 40, 20], ["q", 0, 20], ["duplicate", 40, 20]] as const) {
      expect(geometry(name)).toMatchObject({ segments: [{ kind: "line", start: { x: expect.closeTo(30, 8), y: from }, end: { x: expect.closeTo(30, 8), y: to } }] });
    }
    expect(new Set(["p", "q", "duplicate"].map(name => geometry(name)?.elementId)).size).toBe(3);
    expect(geometry("arcPart")).toMatchObject({
      segments: [{
        kind: "arc", center: { x: 30, y: 40 }, radius: 20, sweepAngleDeg: -90,
        start: { x: 30, y: 20 }, end: { x: 10, y: expect.closeTo(40, 8) }
      }]
    });
    expect(geometry("Quarter")).toMatchObject({ radius: 10, sweepAngleDeg: 90 });
    expect(geometry("loopPart")).toMatchObject({ closed: true, length: 48, segments: [{ kind: "line" }, { kind: "line" }, { kind: "line" }] });
  });

  it("keeps loop-owned copies independent with an outer point and an iteration scalar", () => {
    const { fixture, result } = evaluate(`nui 1
const draw: boolean = true
point A = coordinate(x: 0, y: 0)
line L = segment(start: A, end: (10, 0))
for i in range(min: 0, max: 2, step: 1, showGenerated: draw) {
  if (true) {
    transformCopy C(startPoint: A, endPoint: (0, 5 * i), parts: [edge: L])
  }
}
`);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const template = fixture.elements.find(element => element.name === "edge")!.id;
    const rows = result.forGroupGeneratedRows!.filter(row => row.templateElementId === template);
    expect(new Set(rows.map(row => row.generatedElementId)).size).toBe(3);
    expect(rows.map(row => result.computedGeometry.get(row.generatedElementId))).toMatchObject(
      [0, 5, 10].map(y => ({ start: { x: 0, y }, end: { x: 10, y } }))
    );
  });

  it.each([
    "transformCopy C(parts: [part: L])",
    "transformCopy C(startPoint: (0, 0), endPoint: Missing, parts: [part: L])",
    "transformCopy C(startPoint: (0, 0), parts: [])",
    "transformCopy C(startPoint: (0, 0), parts: [part: L, part: L])",
    "transformCopy C(startPoint: (0, 0), parts: [part: L])\npath Use = from(source: C)"
  ])("rejects an invalid copy declaration or namespace use", (declaration) => {
    const source = `nui 1\nline L = segment(start: (0, 0), end: (10, 0))\n${declaration}`;
    expect(compileFreshCanonicalText(source).diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  });

  it("honors style, layer and visibility independently of the source properties", () => {
    const { fixture, result } = evaluate(`${sources}
style ancestor {
  width: 2px,
}
group G[ancestor] {
  line Hidden[guide] in construction = segment(start: (0, 0), end: (4, 0), visible: false)
  transformCopy Inherited[outline] in finished(startPoint: (0, 0),
    parts: [normal: Hidden, accent[guide] in construction: Shoulder])
  transformCopy Off(startPoint: (0, 0), enabled: false, parts: [disabled: Shoulder])
  transformCopy HiddenCopies(startPoint: (0, 0), visible: false, parts: [hiddenCopy: Shoulder])
}`);
    expect(result.errors).toEqual([]);
    const elements = fixture.elements;
    const normal = elements.find(element => element.name === "normal")!;
    const accent = elements.find(element => element.name === "accent")!;
    const hidden = elements.find(element => element.name === "Hidden")!;
    const disabled = elements.find(element => element.name === "disabled")!;
    const hiddenCopy = elements.find(element => element.name === "hiddenCopy")!;
    expect(normal.modifierNames).toEqual(["outline"]);
    expect(accent.modifierNames).toEqual(["outline", "guide"]);
    const layers = fixture.compiled!.doc.document.sourceLayerMembershipsByElementId;
    expect(layers?.get(normal.id)).toMatchObject({ layerName: "finished" });
    expect(layers?.get(accent.id)).toMatchObject({ layerName: "construction" });
    expect(layers?.get(hidden.id)).toMatchObject({ layerName: "construction" });
    expect(result.effectiveVisibleElementIds?.has(normal.id)).toBe(true);
    expect(result.effectiveVisibleElementIds?.has(hidden.id)).toBe(false);
    expect(result.effectiveVisibleElementIds?.has(hiddenCopy.id)).toBe(false);
    expect(result.computedGeometry.has(hiddenCopy.id)).toBe(true);
    expect(result.computedGeometry.has(disabled.id)).toBe(false);
    expectEndpoints({ fixture, result }, "normal", [0, 0, 4, 0]);
  });
});


describe("#1757 source authoring and save/reload", () => {
  it("preserves a named member and its omitted endpoint through formatting and a source edit", () => {
    const sourceText = `nui 1
// Keep the basis live.
const pivot: number = 10
point Anchor = coordinate(x: pivot, y: 20)
line L = segment(start: (12, 20), end: (12, 23))
transformCopy C(
startPoint: Anchor,
angleDeg: 90,
parts: [part: L],
)`;
    const formatting = queryDslFormatting({ normalizedSource: sourceText, options: { tabSize: 2, insertSpaces: true } });
    const formatted = [...formatting].sort((a, b) => b.range.from - a.range.from).reduce(
      (text, edit) => text.slice(0, edit.range.from) + edit.newText + text.slice(edit.range.to), sourceText);
    expect(formatted).toContain("// Keep the basis live.");
    expect(formatted).not.toContain("endPoint:");
    const first = compileFreshCanonicalText(formatted);
    const compiled = first.currentCompiled;
    expect(first.diagnostics).toEqual([]);
    const snapshot = { normalizedSource: formatted, sourceRevision: compiled.spans.sourceMap.sourceRevision };
    const semantic = { compiled, sourceRevision: snapshot.sourceRevision, sourceText: formatted };
    const signature = queryDslSignatureHelp({
      source: snapshot, semantic, position: formatted.indexOf("startPoint:") + "startPoint: ".length
    });
    expect(signature?.signatures[0]?.parameters).toContainEqual(expect.objectContaining({ name: "endPoint", optional: true }));
    const symbols = queryDslDocumentSymbols({ source: snapshot, statements: compiled.statements, sourceMap: compiled.spans.sourceMap });
    expect(symbols.find(symbol => symbol.name === "C")).toMatchObject({
      kind: "namespace", children: [{ name: "part" }]
    });
    const prefix = "nui 1\ntransformCopy Incomplete(";
    const completions = queryDslCompletion({ source: { normalizedSource: prefix, sourceRevision: 0 }, position: prefix.length });
    expect(completions?.candidates).toContainEqual(expect.objectContaining({ label: "endPoint" }));

    const edited = formatted.replace("pivot: number = 10", "pivot: number = 9");
    const next = compileCanonicalText(first, edited);
    expect(next.diagnostics).toEqual([]);
    const id = (result: typeof first) => result.doc.document.elements.find(element => element.name === "part")!.id;
    expect(id(next)).toBe(id(first));
    expectEndpoints(evaluate(formatted), "part", [10, 22, 7, 22]);
    expectEndpoints(evaluate(edited), "part", [9, 23, 6, 23]);
  });
});
