import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNuiLanguageSession, queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { createRustStdioParityClient, fixtureFromSource, optionsFor } from "../../test/evaluationParitySupport";
import { evaluateElements } from "../geometry/evaluate";
import { evaluationPayloadToResult } from "../geometry/evaluationPayload";
import { referencePickCandidates } from "./referencePickCandidates";
import { hitTestReferencePickPoints, filterReferencePickGeometryHits } from "./referencePickHitTest";
import { hitTestCanvasGeometryAll } from "../components/DrawingCanvasHitTest";
import { referencePickCanvasEvaluationFor } from "../vscode/referencePickCanvasSession";
import { referencePickTargetProofFor } from "../vscode/referencePickProtocol";
import { planVscodeReferencePickSourceEdit } from "../vscode/referencePickSourceEdit";

let rust: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 30_000);
afterAll(() => rust?.dispose());
const both = async (fixture: ReturnType<typeof fixtureFromSource>) => [
  evaluateElements(fixture.elements, optionsFor(fixture)),
  evaluationPayloadToResult(await rust.evaluate(fixture.elements, optionsFor(fixture)))
];

const pickAt = (source: string, fragment: string) => {
  const fixture = fixtureFromSource(source);
  const compiled = fixture.compiled!.doc;
  const snapshot = { normalizedSource: source, sourceRevision: compiled.spans.sourceMap.sourceRevision };
  const position = source.indexOf(fragment) + fragment.indexOf("@") + 1;
  const target = queryDslReferencePickTarget({ source: snapshot, position,
    semantic: { sourceRevision: snapshot.sourceRevision, sourceText: source, compiled } });
  if (!target) throw new Error(`missing production pick target: ${fragment}`);
  const evaluation = evaluateElements(fixture.elements, optionsFor(fixture));
  expect(evaluation.errors).toEqual([]);
  const candidates = referencePickCandidates({ compiled, evaluation, target });
  return { fixture, compiled, snapshot, position, target, evaluation, candidates };
};

describe("Reference Pick source-position values (#1567 MEDIUM-01)", () => {
  it("presents the endpoint read before reverse, rather than the final drawable endpoint", () => {
    const source = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
point P = from(source: @L.end)
reverse @L()`;
    const pick = pickAt(source, "source: @L.end");
    const line = pick.fixture.elements.find(element => element.name === "L")!;
    const point = pick.fixture.elements.find(element => element.name === "P")!;
    expect(pick.evaluation.computedGeometry.get(line.id)).toMatchObject({ end: { x: 0, y: 0 } });
    expect(pick.evaluation.computedGeometry.get(point.id)).toMatchObject({ x: 100, y: 0 });
    const option = pick.candidates.find(candidate => candidate.elementId === line.id)!.options.find(option =>
      option.kind === "point" && option.reference.pointKey === "end")!;
    expect(option).toMatchObject({ kind: "point", reference: { base: "L", pointKey: "end" }, point: { x: 100, y: 0 } });
    const edit = planVscodeReferencePickSourceEdit({ source: pick.snapshot, compiled: pick.compiled,
      normalizedSourceOffset: pick.position, targetProof: referencePickTargetProofFor(source, pick.target)!,
      references: [option.reference], allowedCandidateReferences: [option.reference] });
    expect(edit?.replacement).toBe("@L.end");
  });

  it.each([
    { name: "before move and reverse", body: "point P = from(source: @L.start)\nmove @L(from: (0, 0), to: (10, 0))\nreverse @L()", end: 100 },
    { name: "between move and reverse", body: "move @L(from: (0, 0), to: (10, 0))\npoint P = from(source: @L.start)\nreverse @L()", end: 110 },
    { name: "after move and reverse", body: "move @L(from: (0, 0), to: (10, 0))\nreverse @L()\npoint P = from(source: @L.start)", end: 10 },
    { name: "after disabled move", body: "move @L(from: (0, 0), to: (10, 0), enabled: false)\npoint P = from(source: @L.start)\nreverse @L()", end: 100 }
  ])("inserts the point shown $name in TS and Rust", async ({ body, end }) => {
    const source = `nui 1\nline L = segment(start: (0, 0), end: (100, 0))\n${body}`;
    const pick = pickAt(source, "source: @L.start");
    for (const evaluation of await both(pick.fixture)) {
      const candidates = referencePickCandidates({ ...pick, evaluation });
      const option = candidates.flatMap(candidate => candidate.options).find(option => option.kind === "point" &&
        option.reference.base === "L" && option.reference.pointKey === "end")!;
      expect(option).toMatchObject({ kind: "point", point: { x: end, y: 0 } });
      const hits = hitTestReferencePickPoints({ screen: { x: end, y: 0 }, candidates,
        worldToScreen: point => point, hitRadiusPx: 0.1 });
      expect(hits.some(hit => hit.option === option)).toBe(true);
      const edit = planVscodeReferencePickSourceEdit({ source: pick.snapshot, compiled: pick.compiled,
        normalizedSourceOffset: pick.position, targetProof: referencePickTargetProofFor(source, pick.target)!,
        references: [option.reference], allowedCandidateReferences: candidates.flatMap(candidate => candidate.options.map(option => option.reference)) })!;
      expect(edit.replacement).toBe("@L.end");
      const changedSource = source.slice(0, edit.range.from) + edit.replacement + source.slice(edit.range.to);
      const definition = createNuiLanguageSession(changedSource).definition(changedSource.indexOf("@L.end") + 1);
      expect(definition?.declarationRange && changedSource.slice(definition.declarationRange.from, definition.declarationRange.to)).toBe("L");
      const changed = fixtureFromSource(changedSource);
      for (const result of await both(changed)) {
        expect(result.errors).toEqual([]);
        const point = changed.elements.find(element => element.name === "P")!;
        expect(result.computedGeometry.get(point.id)).toMatchObject({ x: end, y: 0 });
      }
    }
  });

  it("preserves a legitimate forward owner declaration", async () => {
    const source = `nui 1
point P = from(source: @L.end)
line L = segment(start: (0, 0), end: (100, 0))
move @L(from: (0, 0), to: (10, 0))`;
    const pick = pickAt(source, "source: @L.end");
    for (const evaluation of await both(pick.fixture)) {
      expect(referencePickCandidates({ ...pick, evaluation }).flatMap(candidate => candidate.options))
        .toContainEqual(expect.objectContaining({ reference: { base: "L", pointKey: "end" }, point: expect.objectContaining({ x: 100, y: 0 }) }));
    }
  });

  it.each([
    ["Before", [10, 30]], ["Between", [15, 35]], ["After", [15, 25]]
  ] as const)("keeps generated ordinals and bulk/indexed prefixes at %s", async (name, ends) => {
    const source = `nui 1
for i in range(min: 0, max: 1, step: 1) {
 line L = segment(start: (@i * 20, 0), end: (@i * 20 + 10, 0))
point Before = from(source: @L[@i].start)
move @L(from: (0, 0), to: (5, 0))
point Between = from(source: @L[@i].start)
reverse @L[1]()
point After = from(source: @L[@i].start)
}`;
    const pick = pickAt(source, `point ${name} = from(source: @L[@i].start)`);
    for (const evaluation of await both(pick.fixture)) {
      expect(evaluation.errors).toEqual([]);
      // Map traversal order is not occurrence identity.
      const reordered = { ...evaluation, computedGeometry: new Map([...evaluation.computedGeometry].reverse()) };
      const candidates = referencePickCandidates({ ...pick, evaluation: reordered });
      const options = candidates.flatMap(candidate => candidate.options).filter(option => option.kind === "point" && option.reference.base === "L" && option.reference.pointKey === "end");
      expect(options.map(option => option.reference)).toEqual([{ base: "L", occurrenceIndex: 0, pointKey: "end" }, { base: "L", occurrenceIndex: 1, pointKey: "end" }]);
      expect(options.map(option => option.kind === "point" ? option.point.x : null)).toEqual(ends);
      for (const [index, option] of options.entries()) {
        const edit = planVscodeReferencePickSourceEdit({ source: pick.snapshot, compiled: pick.compiled,
          normalizedSourceOffset: pick.position, targetProof: referencePickTargetProofFor(source, pick.target)!,
          references: [option.reference], allowedCandidateReferences: options.map(option => option.reference) })!;
        expect(edit.replacement).toBe(`@L[${index}].end`);
        const changed = fixtureFromSource(source.slice(0, edit.range.from) + edit.replacement + source.slice(edit.range.to));
        for (const result of await both(changed)) {
          const template = changed.elements.find(element => element.name === name)!;
          const rows = result.forGroupGeneratedRows!.filter(row => row.templateElementId === template.id);
          expect(rows).toHaveLength(2);
          expect(result.computedGeometry.get(rows[1]!.generatedElementId)).toMatchObject({ x: ends[index], y: 0 });
          if (index === 0) {
            expect(result.errors).toEqual([]);
            expect(result.computedGeometry.get(rows[0]!.generatedElementId)).toMatchObject({ x: ends[0], y: 0 });
          } else {
            // A future occurrence is unavailable in the first frame; it must
            // report that error rather than silently resolving occurrence zero.
            expect(result.computedGeometry.has(rows[0]!.generatedElementId)).toBe(false);
            expect(result.errors.map(error => error.elementId)).toContain(rows[0]!.generatedElementId);
          }
        }
      }
    }
  });

  it("shares source-use geometry with body rendering, hit testing and Fit without changing final drawables", async () => {
    const source = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
line Copy = from(source: @L)
move @L(from: (0, 0), to: (300, 0))`;
    const pick = pickAt(source, "source: @L");
    const owner = pick.fixture.elements.find(element => element.name === "L")!;
    for (const evaluation of await both(pick.fixture)) {
      const candidates = referencePickCandidates({ ...pick, evaluation });
      const projected = referencePickCanvasEvaluationFor({ target: pick.target, candidates }, evaluation);
      const line = projected.computedGeometry.get(owner.id)!;
      expect(line).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
      expect(evaluation.computedGeometry.get(owner.id)).toMatchObject({ start: { x: 300, y: 0 } });
      if (line.kind !== "line") throw new Error("expected line projection");
      const hit = (x: number) => filterReferencePickGeometryHits(hitTestCanvasGeometryAll({ screen: { x, y: 0 },
        lines: [{ line, start: line.start, end: line.end }], arcs: [], curves: [], offsetLines: [], joinedPaths: [], polylines: [], images: [], texts: [], points: [] }), candidates);
      expect(hit(50).map(hit => hit.elementId)).toEqual([owner.id]);
      expect(hit(350)).toEqual([]);
    }
  });

  it("omits an unavailable prefix instead of substituting final geometry", () => {
    const source = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
move @L(from: (0, 0), to: (10, 0))
point P = from(source: @L.end)
reverse @L()`;
    const pick = pickAt(source, "source: @L.end");
    expect(referencePickCandidates({ ...pick, evaluation: { ...pick.evaluation, transformationStageGeometry: new Map() } })
      .flatMap(candidate => candidate.options).some(option => option.reference.base === "L")).toBe(false);
  });

  it("keeps mutation-selector presentation distinct from a value read", () => {
    const source = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
point P = from(source: @L.end)
reverse @L()`;
    const pick = pickAt(source, "reverse @L");
    expect(pick.target.syntax).toBe("transformationTarget");
    expect(pick.candidates.flatMap(candidate => candidate.options).map(option => option.reference)).toEqual([{ base: "L" }]);
    expect(pick.candidates.every(candidate => candidate.geometry === undefined)).toBe(true);
    expect(referencePickCanvasEvaluationFor(pick, pick.evaluation).computedGeometry).toBe(pick.evaluation.computedGeometry);
  });

  it("keeps numeric properties and inserted coordinates on the selected prefix", async () => {
    const source = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
move @L(from: (0, 0), to: (10, 0), scale: 2)
point P = coordinate(x: @L.length, y: 0)
reverse @L()`;
    const pick = pickAt(source, "@L.length");
    for (const evaluation of await both(pick.fixture)) {
      const candidate = referencePickCandidates({ ...pick, evaluation }).find(candidate => candidate.options.some(option => option.reference.base === "L"))!;
      expect(candidate.geometry).toMatchObject({ length: 200, end: { x: 210, y: 0 } });
      const option = candidate.options.find(option => option.kind === "numericProperty" && option.properties.includes("endPoint.x"))!;
      if (option.kind !== "numericProperty") throw new Error("missing endpoint numeric option");
      expect(option.point).toMatchObject({ x: 210, y: 0 });
      const edit = planVscodeReferencePickSourceEdit({ source: pick.snapshot, compiled: pick.compiled,
        normalizedSourceOffset: pick.position, targetProof: referencePickTargetProofFor(source, pick.target)!,
        references: [], allowedCandidateReferences: [], numericProperty: { reference: option.reference, property: "endPoint.x" },
        allowedNumericCandidates: [{ reference: option.reference, properties: option.properties }] })!;
      expect(edit.replacement).toBe("@L.endPoint.x");
      const changed = fixtureFromSource(source.slice(0, edit.range.from) + edit.replacement + source.slice(edit.range.to));
      for (const result of await both(changed)) {
        expect(result.errors).toEqual([]);
        expect(result.computedGeometry.get(changed.elements.find(element => element.name === "P")!.id)).toMatchObject({ x: 210, y: 0 });
      }
    }
  });

  it("uses definition-local prefixes per Module instance and completed prefixes across export ownership", async () => {
    const source = `nui 1
module M(width: number) {
 line L = segment(start: (0, 0), end: (@width, 0))
 move @L(from: (0, 0), to: (10, 0))
 point P = from(source: @L.start)
 reverse @L()
 export line Out = from(source: @L)
}
instance One = M(width: 100)
instance Two = M(width: 200)
point Outside = from(source: @One::Out.start)`;
    const pick = pickAt(source, "source: @L.start");
    for (const evaluation of await both(pick.fixture)) {
      const options = referencePickCandidates({ ...pick, evaluation }).flatMap(candidate => candidate.options)
        .filter(option => option.kind === "point" && option.reference.base === "L" && option.reference.pointKey === "end");
      expect(options.map(option => option.kind === "point" ? option.point.x : null)).toEqual([110, 210]);
      const edit = planVscodeReferencePickSourceEdit({ source: pick.snapshot, compiled: pick.compiled,
        normalizedSourceOffset: pick.position, targetProof: referencePickTargetProofFor(source, pick.target)!,
        references: [options[0]!.reference], allowedCandidateReferences: options.map(option => option.reference) })!;
      expect(edit.replacement).toBe("@L.end");
      const changed = fixtureFromSource(source.slice(0, edit.range.from) + edit.replacement + source.slice(edit.range.to));
      for (const result of await both(changed)) {
        expect(result.errors).toEqual([]);
        expect(changed.elements.filter(element => element.name === "P").map(element => result.computedGeometry.get(element.id)))
          .toEqual([expect.objectContaining({ x: 110, y: 0 }), expect.objectContaining({ x: 210, y: 0 })]);
      }
      const outsideTarget = queryDslReferencePickTarget({ source: pick.snapshot,
        position: source.indexOf("@One::Out.start") + 1,
        semantic: { sourceRevision: pick.snapshot.sourceRevision, sourceText: source, compiled: pick.compiled } })!;
      expect(referencePickCandidates({ ...pick, target: outsideTarget, evaluation }).flatMap(candidate => candidate.options))
        .toContainEqual(expect.objectContaining({ reference: { base: "One::Out", pointKey: "end" }, point: expect.objectContaining({ x: 10, y: 0 }) }));
    }
  });
});
