// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileFreshCanonicalText, compileCanonicalText, commitModelBridge,
} from "@nuinuicad/nui-language/document";
import {
  serializeDocumentToDsl, queryDslReferencePickTarget, queryDslCompletion,
  planDslRenameEdits, resolveParameterValueSpan,
} from "@nuinuicad/nui-language";
import { evaluateWithRustFixture, fixtureFromSource, normalizeParityPayload, optionsFor } from "../../test/evaluationParitySupport";
import { evaluateElementsReferencePayload } from "../geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../geometry/evaluationPayload";
import type { CadElement } from "../types/geometry";

const knot = (point = "@B", angle = "90", incoming = "2", outgoing = "4") => `knot(point: ${point}, angle: ${angle}, incoming: ${incoming}, outgoing: ${outgoing})`;
const prefix = `nui 1
point A = coordinate(x: 1, y: 2)
point B = coordinate(x: 5, y: 7)
point C = coordinate(x: 9, y: 4)
point D = coordinate(x: 12, y: 3)
`;
const sourceFor = (knots: string, declaration = "curve Curve") => prefix + `${declaration} = bezier(start: @A, end: @D, startAngle: 0, startLength: 2, endAngle: 90, endLength: 3${knots ? `, intermediates: ${knots}` : ""})`;
const curveFor = (state: ReturnType<typeof compileFreshCanonicalText>) => {
  const curve = state.doc.document.elements.find(element => element.type === "bezierCurve");
  if (curve?.type !== "bezierCurve") throw new Error("missing curve");
  return curve;
};
const evaluate = (source: string) => {
  const fixture = fixtureFromSource(source);
  expect(fixture.compiled!.diagnostics).toEqual([]);
  const result = evaluationPayloadToResult(evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture)));
  expect(result.errors).toEqual([]);
  return { fixture, result, geometry: (name: string) => result.computedGeometry.get(fixture.elements.find(element => element.name === name)!.id) };
};
const semanticFor = (state: ReturnType<typeof compileFreshCanonicalText>) => ({ compiled: state.currentCompiled, sourceRevision: state.currentCompiled.spans.sourceMap.sourceRevision });
const querySource = (state: ReturnType<typeof compileFreshCanonicalText>) => ({ normalizedSource: state.sourceText, sourceRevision: state.currentCompiled.spans.sourceMap.sourceRevision });

describe("Bezier named knots (#1537)", () => {
  it.each(["", "[]", `[${knot()}]`, `[${knot()}, ${knot("@C", "0", "3", "5")}]`])("round-trips ordered knots: %s", knots => {
    const state = compileFreshCanonicalText(sourceFor(knots));
    expect(state.diagnostics).toEqual([]);
    const curve = curveFor(state);
    expect(curve.intermediatePoints).toHaveLength(knots === "" || knots === "[]" ? 0 : knots.includes("@C") ? 2 : 1);
    const text = serializeDocumentToDsl(state.doc.document, 1);
    const reopened = compileFreshCanonicalText(text);
    expect(reopened.diagnostics).toEqual([]);
    expect(curveFor(reopened).intermediatePoints.map(value => ({ handleAngleDeg: value.handleAngleDeg, incomingHandleLength: value.incomingHandleLength, outgoingHandleLength: value.outgoingHandleLength, point: value.point.mode })))
      .toEqual(curve.intermediatePoints.map(value => ({ handleAngleDeg: value.handleAngleDeg, incomingHandleLength: value.incomingHandleLength, outgoingHandleLength: value.outgoingHandleLength, point: value.point.mode })));
    if (curve.intermediatePoints.length) expect(text).toContain("knot(point: @B, angle: 90, incoming: 2, outgoing: 4)");
  });

  it.each([
    "[@B:90:2:4]", `[@B:90:2:4; ${knot()}]`, `[${knot()}; ${knot("@C")}]`,
    "[knot(point: @B, angle: 90, incoming: 2)]", "[knot(point: @B, incoming: 2, outgoing: 4)]",
    "[knot(angle: 90, incoming: 2, outgoing: 4)]", "[knot(point: @B, angle: 90, outgoing: 4)]",
    `[${knot().replace("angle: 90", "angle: 90, angle: 45")}]`,
    `[${knot().replace("angle: 90", "oops: 90")}]`,
    `[${knot().replace("angle: 90", 'angle: "bad"')}]`, `[${knot("true")}]`,
    `[${knot().replace("incoming: 2", "incoming: true")}]`, `[${knot().replace("outgoing: 4", "outgoing: @B")}]`,
    `[${knot().replace(", angle", " angle")}]`, `[${knot()},, ${knot()}]`, "[wrong()]",
  ])("rejects invalid knots with source spans: %s", knots => {
    for (const declaration of ["curve Curve", "const Curve: path"]) {
      const state = compileFreshCanonicalText(sourceFor(knots, declaration));
      const errors = state.diagnostics.filter(diagnostic => diagnostic.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(diagnostic => diagnostic.physicalSpan?.segments.length)).toBe(true);
      if (knots.includes("; ") || knots.startsWith("[@B:")) expect(errors.some(diagnostic => diagnostic.message.includes("knot("))).toBe(true);
    }
  });

  it("uses immutable Base controls and length, and an analytic oracle for multiple knots", () => {
    // Frozen old-Base oracle: issue-1462 B04, df566c918198598dc2f6145d6ad1b1caa79581f4.
    const { geometry } = evaluate(sourceFor(`[${knot()}]`));
    expect(geometry("Curve")).toMatchObject({ kind: "bezierCurve", segments: [
      { start: { x: 1, y: 2 }, control1: { x: 3, y: 2 }, control2: { x: 5, y: 5 }, end: { x: 5, y: 7 } },
      { start: { x: 5, y: 7 }, control1: { x: 5, y: 11 }, control2: { x: 12, y: 0 }, end: { x: 12, y: 3 } },
    ] });
    const curve = geometry("Curve");
    if (curve?.kind !== "bezierCurve") throw new Error("curve");
    expect(curve.length).toBeCloseTo(17.057290767248052, 9);
    const multiple = evaluate(sourceFor(`[${knot()}, ${knot("@C", "0", "3", "5")}]`)).geometry("Curve");
    if (multiple?.kind !== "bezierCurve") throw new Error("curve");
    expect(multiple.segments).toHaveLength(3);
    expect(multiple.segments[1]).toMatchObject({ start: { x: 5, y: 7 }, control1: { x: 5, y: 11 }, control2: { x: 6, y: 4 }, end: { x: 9, y: 4 } });
    expect(multiple.segments[2]).toMatchObject({ start: { x: 9, y: 4 }, control1: { x: 14, y: 4 }, control2: { x: 12, y: 0 }, end: { x: 12, y: 3 } });
    const frozen = JSON.parse(readFileSync(new URL("../../test/fixtures/issue-1537/base-oracle.json", import.meta.url), "utf8")) as { length: number; segments: unknown[] };
    expect(multiple.segments).toMatchObject(frozen.segments);
    expect(multiple.length).toBeCloseTo(frozen.length, 9);
  });

  it("preserves saved traversal references and transformed geometry after reopen", () => {
    const source = sourceFor(`[${knot()}, ${knot("@C", "0", "3", "5")}]`) + `
point Read = coordinate(x: @Curve.intermediatePoints[1].x, y: @Curve.intermediatePoints[1].incomingHandleAngleDeg)
move @Curve(from: (0, 0), to: (10, -5))`;
    const state = compileFreshCanonicalText(source);
    const saved = serializeDocumentToDsl(state.doc.document, 1);
    for (const text of [source, saved]) {
      const { geometry } = evaluate(text);
      expect(geometry("Read")).toMatchObject({ kind: "point", x: 5, y: 270 });
      expect(geometry("Curve")).toMatchObject({ kind: "bezierCurve", segments: [
        { end: { x: 15, y: 2 } }, { end: { x: 19, y: -1 } }, { end: { x: 22, y: -2 } }
      ] });
    }
    const reordered = evaluate(source.replace(`${knot()}, ${knot("@C", "0", "3", "5")}`, `${knot("@C", "0", "3", "5")}, ${knot()}`));
    expect(reordered.geometry("Read")).toMatchObject({ kind: "point", x: 9, y: 180 });
  });

  it("matches the production Rust boundary for the named-knot evaluation fixture", () => {
    const source = readFileSync(new URL("../../test/fixtures/evaluation/nui1-bezier-named-knots.nui", import.meta.url), "utf8");
    const fixture = fixtureFromSource(source);
    expect(fixture.compiled!.diagnostics).toEqual([]);
    const ts = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    const rust = evaluateWithRustFixture(fileURLToPath(new URL("../../", import.meta.url)), fixture);
    expect(normalizeParityPayload(rust)).toEqual(normalizeParityPayload(ts));
    const result = evaluationPayloadToResult(rust);
    expect(result.errors).toEqual([]);
    const rendered = result.computedGeometry.get(fixture.elements.find(element => element.name === "PureRendered")!.id);
    if (rendered?.kind !== "bezierCurve") throw new Error("missing Rust Bezier");
    expect(rendered.segments).toHaveLength(2);
    expect(rendered.length).toBeCloseTo(17.057290767248052, 9);
  });

  it("lowers pure values, Module parameters, record fields and numeric dependencies through existing semantics", () => {
    const source = prefix + `record Handles(angle: number, incoming: number, outgoing: number)
const handles: Handles = Handles(angle: 90, incoming: 2, outgoing: 4)
module Shape(p: point, h: Handles) {
  const pathValue: path = bezier(start: (1, 2), end: (12, 3), startAngle: 0, startLength: 2, endAngle: 90, endLength: 3, intermediates: [knot(outgoing: @h.outgoing, point: @p, incoming: @h.incoming, angle: @h.angle)])
  export path Result = from(source: @pathValue)
}
instance Use = Shape(p: @B, h: @handles)`;
    const { result } = evaluate(source);
    const curve = [...result.computedGeometry.values()].find(geometry => geometry.kind === "bezierCurve");
    expect(curve).toMatchObject({ kind: "bezierCurve", segments: [{ control2: { x: 5, y: 5 } }, { control1: { x: 5, y: 11 } }] });
  });

  it("preserves unique identity through field edits, insertion, deletion, reorder, and Source Undo/Redo", () => {
    let source = sourceFor(`[${knot()}, ${knot("@C", "0", "3", "5")}]`);
    let state = compileFreshCanonicalText(source);
    const [first, second] = curveFor(state).intermediatePoints.map(knot => knot.id);
    for (const [before, after] of [["angle: 90", "angle: 80"], ["incoming: 2", "incoming: 6"], ["outgoing: 4", "outgoing: 8"], ["point: @B", "point: @A"]]) {
      source = source.replace(before!, after!);
      state = compileCanonicalText(state, source);
      expect(curveFor(state).intermediatePoints.map(knot => knot.id)).toEqual([first, second]);
    }
    const edited = source;
    const one = knot("@A", "80", "6", "8");
    source = source.replace(`${one}, ${knot("@C", "0", "3", "5")}`, `${knot("@C", "0", "3", "5")}, ${one}`);
    state = compileCanonicalText(state, source);
    expect(curveFor(state).intermediatePoints.map(knot => knot.id)).toEqual([second, first]);
    const reordered = source;
    source = source.replace(`, ${one}`, "");
    state = compileCanonicalText(state, source, { restoreKnotHistory: true });
    expect(curveFor(state).intermediatePoints.map(knot => knot.id)).toEqual([second]);
    state = compileCanonicalText(state, reordered, { restoreKnotHistory: true });
    expect(curveFor(state).intermediatePoints.map(knot => knot.id)).toEqual([second, first]);
    state = compileCanonicalText(state, edited, { restoreKnotHistory: true });
    expect(curveFor(state).intermediatePoints.map(knot => knot.id)).toEqual([first, second]);
    state = compileCanonicalText(state, source, { restoreKnotHistory: true });
    expect(curveFor(state).intermediatePoints.map(knot => knot.id)).toEqual([second]);
    state = compileCanonicalText(state, source.replace("intermediates: [", `intermediates: [${knot("@D", "15", "1", "7")}, `));
    expect(curveFor(state).intermediatePoints[1]!.id).toBe(second);
  });

  it("preserves source-owned knot identities and Canvas handle edits in Module instances", () => {
    const source = `nui 1
module Shape() {
  export curve C = bezier(start: (0, 0), end: (10, 0), intermediates: [knot(point: (5, 2), angle: 90, incoming: 1, outgoing: 2)])
}
instance One = Shape()
instance Two = Shape()`;
    const state = compileFreshCanonicalText(source);
    expect(state.diagnostics).toEqual([]);
    const before = state.doc.document.elements.filter(element => element.type === "bezierCurve");
    expect(before).toHaveLength(2);
    const changed = compileCanonicalText(state, source.replace("angle: 90", "angle: 80"));
    expect(changed.diagnostics).toEqual([]);
    expect(changed.doc.document.elements.filter(element => element.type === "bezierCurve").map(curve => curve.intermediatePoints[0]!.id))
      .toEqual(before.map(curve => curve.intermediatePoints[0]!.id));
    const curve = before[0]!;
    const result = commitModelBridge(state, { ...state.doc.document, elements: state.doc.document.elements.map(element => element.id === curve.id
      ? { ...curve, intermediatePoints: curve.intermediatePoints.map(knot => ({ ...knot, outgoingHandleLength: 7 })) } : element) });
    if (result.status !== "committed") throw new Error(JSON.stringify(result));
    expect(result.value.sourceText).toBe(source.replace("outgoing: 2", "outgoing: 7"));
  });

  it("resolves distinct point fields even when both knots have identical handle values", () => {
    const state = compileFreshCanonicalText(sourceFor(`[${knot()}, ${knot("@C")}]`));
    const curve = curveFor(state);
    const line = state.sourceText.split("\n").at(-1)!;
    for (const [index, point] of ["@B", "@C"].entries()) {
      const span = resolveParameterValueSpan(line, curve, `intermediate:${curve.intermediatePoints[index]!.id}:point`, { committedLineText: line });
      expect(span).not.toBeNull();
      expect(line.slice(span!.start, span!.end)).toBe(point);
    }
  });

  it("retains Canvas array identities across insertion, reorder, deletion and Undo", () => {
    const original = compileFreshCanonicalText(sourceFor(`[${knot()}, ${knot("@C", "0", "3", "5")}]`));
    let state = original;
    const [first, second] = curveFor(state).intermediatePoints;
    const inserted = { ...first!, id: "inserted-knot", handleAngleDeg: 15 };
    for (const knots of [[inserted, first!, second!], [second!, inserted, first!], [second!, first!]]) {
      const curve = curveFor(state);
      const result = commitModelBridge(state, { ...state.doc.document, elements: state.doc.document.elements.map(element => element.id === curve.id ? { ...curve, intermediatePoints: knots } : element) });
      if (result.status !== "committed") throw new Error(JSON.stringify(result));
      state = { ...state, ...result.value, currentCompiled: result.value.doc };
      expect(curveFor(state).intermediatePoints.map(knot => knot.id)).toEqual(knots.map(knot => knot.id));
    }
    const restored = compileCanonicalText(state, original.sourceText, { restoreKnotHistory: true });
    expect(curveFor(restored).intermediatePoints.map(knot => knot.id)).toEqual([first!.id, second!.id]);
  });

  it("restores deleted IDs only for explicit history, never an ordinary insertion at the same index", () => {
    const original = compileFreshCanonicalText(sourceFor(`[${knot()}]`));
    const id = curveFor(original).intermediatePoints[0]!.id;
    const deleted = compileCanonicalText(original, sourceFor("[]"));
    const inserted = compileCanonicalText(deleted, original.sourceText);
    expect(curveFor(inserted).intermediatePoints[0]!.id).not.toBe(id);
    const undo = compileCanonicalText(deleted, original.sourceText, { restoreKnotHistory: true });
    expect(curveFor(undo).intermediatePoints[0]!.id).toBe(id);
  });

  it("fails closed when identical historical Source text represents different inserted knots", () => {
    const original = compileFreshCanonicalText(sourceFor(`[${knot()}]`));
    const first = curveFor(original).intermediatePoints[0]!.id;
    const deleted = compileCanonicalText(original, sourceFor("[]"));
    const inserted = compileCanonicalText(deleted, original.sourceText);
    const second = curveFor(inserted).intermediatePoints[0]!.id;
    expect(second).not.toBe(first);
    const deletedAgain = compileCanonicalText(inserted, sourceFor("[]"));
    const ambiguous = compileCanonicalText(deletedAgain, original.sourceText, { restoreKnotHistory: true });
    expect([first, second]).not.toContain(curveFor(ambiguous).intermediatePoints[0]!.id);
  });

  it("fails closed for ambiguous duplicates and never resolves a deleted knot by coincident index", () => {
    const initial = compileFreshCanonicalText(sourceFor(`[${knot()}, ${knot("@C", "0", "3", "5")}]`));
    const curve = curveFor(initial);
    const deleted = compileCanonicalText(initial, sourceFor(`[${knot("@C", "0", "3", "5")}]`));
    expect(curveFor(deleted).intermediatePoints[0]!.id).toBe(curve.intermediatePoints[1]!.id);
    expect(resolveParameterValueSpan(deleted.sourceText.split("\n").at(-1)!, curveFor(deleted), `intermediate:${curve.intermediatePoints[0]!.id}:handleAngleDeg`, { committedLineText: deleted.sourceText.split("\n").at(-1)! })).toBeNull();
    const duplicate = compileCanonicalText(initial, sourceFor(`[${knot()}, ${knot()}]`));
    expect(curveFor(duplicate).intermediatePoints.map(knot => knot.id)).not.toContain(curve.intermediatePoints[0]!.id);
  });

  it.each(["@B", ""]) ("picks exactly the intended multiline point value (%s), rejects stale queries, and supports F2 rename", value => {
    const source = sourceFor(`[\n  knot(point: ${value}, angle: 90, incoming: 2, outgoing: 4),\n  ${knot("@C", "0", "3", "5")}\n]`);
    const state = compileFreshCanonicalText(source);
    const position = source.indexOf(`point: ${value}`, source.indexOf("intermediates")) + "point: ".length + value.length;
    const target = queryDslReferencePickTarget({ source: querySource(state), position, semantic: semanticFor(state) });
    expect(target).toMatchObject({ expectedGeometryInterface: "point", multiplicity: "single" });
    expect(source.slice(target!.range.from, target!.range.to)).toBe(value);
    const replacement = source.slice(0, target!.range.from) + "@A" + source.slice(target!.range.to);
    const next = compileCanonicalText(state, replacement);
    expect(next.diagnostics).toEqual([]);
    expect(replacement).toBe(source.replace(`point: ${value},`, "point: @A,"));
    expect(queryDslReferencePickTarget({ source: { ...querySource(state), sourceRevision: 99 }, position, semantic: semanticFor(state) })).toBeNull();
    if (value) {
      const plan = planDslRenameEdits({ source: querySource(state), semantic: semanticFor(state) }, position - 1, "Renamed");
      expect(plan).not.toBeNull();
      expect(plan!.edits.some(edit => source.slice(edit.from, edit.to) === "B")).toBe(true);
    }
  });

  it("recognizes knot constructors, all four fields, point and numeric reference completion", () => {
    for (const [text, needle, labels] of [
      ["[kn]", "kn", ["knot"]],
      ["[knot()]", "knot(", ["point", "angle", "incoming", "outgoing"]],
      [`[${knot("@B")}]`, "point: @B", ["B"]],
      [`[${knot("@B", "@N")}]`, "angle: @N", ["N"]],
    ] as const) {
      const source = sourceFor(text).replace("curve Curve", "const N: number = 90\ncurve Curve");
      const state = compileFreshCanonicalText(source);
      const position = source.indexOf(needle, source.indexOf("intermediates")) + needle.length;
      const result = queryDslCompletion({ source: querySource(state), position, semantic: semanticFor(state) });
      expect(result?.candidates.map(candidate => candidate.label)).toEqual(expect.arrayContaining([...labels]));
    }
  });

  it("keeps Canvas model knot IDs through the source patch boundary", () => {
    const state = compileFreshCanonicalText(sourceFor(`[${knot()}]`));
    const curve = curveFor(state);
    const updated: CadElement[] = state.doc.document.elements.map(element => element.id === curve.id ? { ...curve, intermediatePoints: curve.intermediatePoints.map(knot => ({ ...knot, outgoingHandleLength: 9 })) } : element);
    const result = commitModelBridge(state, { ...state.doc.document, elements: updated });
    if (result.status !== "committed") throw new Error(JSON.stringify(result));
    expect(result.value.sourceText).toContain("outgoing: 9");
    const next = result.value.doc.document.elements.find(element => element.type === "bezierCurve")!;
    expect(next.intermediatePoints[0]!.id).toBe(curve.intermediatePoints[0]!.id);
  });
});
