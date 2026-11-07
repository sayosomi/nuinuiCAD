import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { emptyDocument, compileDslDocument, serializeTransformationRecipeLines } from "@nuinuicad/nui-language";
import { describe, expect, it } from "vitest";
import { fixtureFromSource, optionsFor, evaluateWithRustFixture, createRustStdioParityClient } from "./evaluationParitySupport";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { evaluateElements } from "../src/geometry/evaluate";

describe("source-position geometry references (#1567)", () => {
  it("captures the initializer prefix and materializes independent drawable owners", () => {
    const fixture = fixtureFromSource(`nui 1
line L = segment(start: (0, 0), end: (100, 0))
const original: line = @L
move @L(from: (0, 0), to: (10, 0))
const shifted: line = @L
reverse @L()
const reversedStart: point = @L.start
line original_preview = from(source: @original)
line shifted_preview = from(source: @shifted)
point reversed_preview = from(source: @reversedStart)
`);
    const result = evaluateElements(fixture.elements, optionsFor(fixture));
    const rust = evaluationPayloadToResult(evaluateWithRustFixture(process.cwd(), fixture));
    expect(rust.errors).toEqual([]);
    expect([...rust.computedGeometry]).toEqual([...result.computedGeometry]);
    expect(result.errors).toEqual([]);
    const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find((element) => element.name === name)!.id);
    expect(geometry("original_preview")).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    expect(geometry("shifted_preview")).toMatchObject({ start: { x: 10, y: 0 }, end: { x: 110, y: 0 } });
    expect(geometry("reversed_preview")).toMatchObject({ x: 110, y: 0 });
    expect(geometry("L")).toMatchObject({ start: { x: 110, y: 0 }, end: { x: 10, y: 0 } });
    expect(fixture.elements.map((element) => element.name)).toEqual(["L", "original_preview", "shifted_preview", "reversed_preview"]);
  });
  it("binds ordinary anchors, properties and builtins before, between and after recipes", () => {
    const fixture = fixtureFromSource(`nui 1
line L = segment(start: (0, 0), end: (100, 0))
point before = from(source: @L.start)
const beforeX: number = @L.length
move @L(from: @L.start, to: (10, 0), scale: 2)
point between = from(source: @L.end)
const betweenLength: number = distance(@L.start, @L.end)
reverse @L()
point after = from(source: @L.start)
const afterX: number = @L.length
`);
    const result = evaluateElements(fixture.elements, optionsFor(fixture));
    expect(result.errors).toEqual([]);
    const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find((element) => element.name === name)!.id);
    expect(geometry("before")).toMatchObject({ x: 0, y: 0 });
    expect(geometry("between")).toMatchObject({ x: 210, y: 0 });
    expect(geometry("after")).toMatchObject({ x: 210, y: 0 });
    const scalar = (name: string) => result.computedScalarBindings?.get(fixture.compiled!.doc.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === name)!.id);
    expect(scalar("beforeX")).toMatchObject({ status: "ok", value: { value: 100 } });
    expect(scalar("betweenLength")).toMatchObject({ status: "ok", value: { value: 200 } });
    expect(scalar("afterX")).toMatchObject({ status: "ok", value: { value: 200 } });
  });

  it("uses captured point-array members before a subsequent recipe without a false cycle", () => {
    const fixture = fixtureFromSource(`nui 1
line L = segment(start: (0, 0), end: (10, 0))
const original: line = @L
const points: point[] = [@original.start, @original.end]
line Outline = polyline(points: @points, closed: false)
move @L(from: @Outline.start, to: (20, 0))
module M(points: point[]) {
  line Copy = polyline(points: @points, closed: false)
}
instance Use = M(points: [@original.start, @original.end])`);
    const options = optionsFor(fixture);
    const ts = evaluateElements(fixture.elements, options);
    const rust = evaluationPayloadToResult(evaluateWithRustFixture(process.cwd(), fixture));
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    expect([...rust.computedGeometry]).toEqual([...ts.computedGeometry]);
    for (const name of ["Outline", "Copy"]) expect(ts.computedGeometry.get(fixture.elements.find(element => element.name === name)!.id)).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(ts.computedGeometry.get(fixture.elements.find(element => element.name === "L")!.id)).toMatchObject({ start: { x: 20, y: 0 }, end: { x: 30, y: 0 } });
  });

  it.each([
    {
      name: "disabled recipes and independent materialized chains",
      source: `line L = segment(start: (0, 0), end: (100, 0))
const a: line = @L
move @L(from: (0, 0), to: (10, 0), enabled: false)
const b: line = @L
extend @L.end(to: (120, 0))
line A = from(source: @a)
line B = from(source: @b)
move @A(from: (0, 0), to: (0, 20))`,
      lines: { L: [0, 0, 120, 0], A: [0, 20, 100, 20], B: [0, 0, 100, 0] }
    },
    {
      name: "edge and extend preserve independently captured endpoints",
      source: `line A = segment(start: (0, 0), end: (100, 0))
line B = segment(start: (50, -50), end: (50, 50))
const original: line = @A
edge [@A.end, @B.start](index: 0)
const joined: line = @A
extend @A.end(to: (75, 0))
line Original = from(source: @original)
line Joined = from(source: @joined)`,
      lines: { A: [0, 0, 75, 0], B: [50, 0, 50, 50], Original: [0, 0, 100, 0], Joined: [0, 0, 50, 0] }
    },
    {
      name: "coupled recipes read all arguments before mutation",
      source: `line L = segment(start: (0, 0), end: (100, 0))
line K = segment(start: (0, 10), end: (100, 10))
move [@L, @K](from: @L.start, to: @K.start)
line A = from(source: @L)
line B = from(source: @K)`,
      lines: { A: [0, 10, 100, 10], B: [0, 20, 100, 20] }
    },
    {
      name: "Module recipe arguments retain const endpoint prefixes",
      source: `module M() {
line P = segment(start: (0, 0), end: (10, 0))
const saved: line = @P
move @P(from: (0, 0), to: (3, 4))
const shifted: line = @P
line L = segment(start: (11, 23), end: (20, 35))
move @L(from: @saved.start, to: @shifted.start)
}
instance Use = M()`,
      lines: { L: [14, 27, 23, 39] }
    },
    {
      name: "forward geometry declarations read their construction prefix",
      source: `line A = from(source: @L)
line L = segment(start: (0, 0), end: (100, 0))
move @L(from: (0, 0), to: (10, 0))`,
      lines: { A: [0, 0, 100, 0], L: [10, 0, 110, 0] }
    },
    {
      name: "array aliases and value-for retain initializer prefixes",
      source: `line L = segment(start: (0, 0), end: (100, 0))
const originals: line[] = [@L]
move @L(from: (0, 0), to: (10, 0))
const shifted: line[] = [@L]
const aliases: path[] = @originals
const mapped: path[] = for item in @shifted { @item }
path A = from(source: @aliases[0])
path B = from(source: @mapped[0])`,
      lines: { A: [0, 0, 100, 0], B: [10, 0, 110, 0] }
    },
    {
      name: "Module arguments and local captures preserve independent prefixes",
      source: `line L = segment(start: (0, 0), end: (100, 0))
const saved: line = @L
move @L(from: (0, 0), to: (10, 0))
module M(g: line) {
  line Local = from(source: @g)
  const localSaved: line = @Local
  move @Local(from: @Local.start, to: (20, 0))
  line Preview = from(source: @localSaved)
}
instance Old = M(g: @saved)
instance New = M(g: @L)`,
      lines: { Preview: [0, 0, 100, 0] }
    }
  ])("$name", ({ source, lines }) => {
    const fixture = fixtureFromSource(`nui 1\n${source}\n`);
    const results = [evaluateElements(fixture.elements, optionsFor(fixture)), evaluationPayloadToResult(evaluateWithRustFixture(process.cwd(), fixture))];
    for (const result of results) {
      expect(result.errors).toEqual([]);
      for (const [name, coordinates] of Object.entries(lines)) {
        const [x1, y1, x2, y2] = coordinates!;
        const element = fixture.elements.find((candidate) => candidate.name === name)!;
        expect(result.computedGeometry.get(element.id), name).toMatchObject({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
      }
    }
  });

  it("keeps indexed and bulk generated prefixes isolated by occurrence", () => {
    const fixture = fixtureFromSource(`nui 1
for i in range(min: 0, max: 2, step: 1) {
  line L = segment(start: (@i * 100, 0), end: (@i * 100 + 10, 0))
  const saved: line = @L[@i]
  move @L[1](from: (0, 0), to: (0, 10))
  line A = from(source: @saved)
  line B = from(source: @L[@i])
  move @L(from: (0, 0), to: (0, 20))
}
`);
    for (const result of [evaluateElements(fixture.elements, optionsFor(fixture)), evaluationPayloadToResult(evaluateWithRustFixture(process.cwd(), fixture))]) {
      expect(result.errors).toEqual([]);
      for (const name of ["A", "B", "L"]) {
        const template = fixture.elements.find((element) => element.name === name)!;
        const rows = result.forGroupGeneratedRows!.filter((row) => row.templateElementId === template.id);
        expect(rows).toHaveLength(3);
        rows.forEach((row, index) => {
          const y = name === "A" ? 0 : (index === 1 ? 10 : 0) + (name === "L" ? 20 : 0);
          expect(result.computedGeometry.get(row.generatedElementId), `${name}[${index}]`).toMatchObject({ start: { x: index * 100, y }, end: { x: index * 100 + 10, y } });
        });
      }
    }
  });

  it.each([
    "move @L as saved(from: (0, 0), to: (1, 0))",
    "reverse @L.base()", "reverse @L.final()", "reverse @L.saved()",
    "const saved: line = @L.base", "const saved: line = @L.final",
    "const saved: line = @L.saved", "const saved: point = @L.saved.start"
  ])("rejects removed public stage syntax: %s", (statement) => {
    const compiled = compileDslDocument(`nui 1\nline L = segment(start: (0, 0), end: (100, 0))\n${statement}\n`);
    expect(compiled.document).toBeNull();
    expect(compiled.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  });

  it("retains input reflection and ordinary properties", () => {
    const fixture = fixtureFromSource(`nui 1
point Origin = coordinate(x: 3, y: 4)
line L = segment(start: @Origin, end: (103, 4))
move @L(from: (0, 0), to: (10, 0))
point Input = from(source: @L.input.start)
point Current = from(source: @L.start)
const measured: number = @L.length
`);
    const result = evaluateElements(fixture.elements, optionsFor(fixture));
    expect(result.errors).toEqual([]);
    const point = (name: string) => result.computedGeometry.get(fixture.elements.find(element => element.name === name)!.id);
    expect(point("Input")).toMatchObject({ x: 3, y: 4 });
    expect(point("Current")).toMatchObject({ x: 13, y: 4 });
  });

  it("preserves prefixes and authored order through canonical serialization and reopen", () => {
    const source = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
const saved: line = @L
move @L(from: (0, 0), to: (10, 0))
line Preview = from(source: @saved)
`;
    const fixture = fixtureFromSource(source);
    const recipeText = fixture.compiled!.doc.document.transformationRecipes!.flatMap(recipe => serializeTransformationRecipeLines(recipe)).join("\n");
    expect(recipeText).not.toMatch(/\$prefix|\.base|\.final| as /);
    const serialized = fixture.compiled!.sourceText;
    expect(serialized).not.toMatch(/\$prefix|\.base|\.final| as /);
    const reopened = fixtureFromSource(serialized);
    const result = evaluateElements(reopened.elements, optionsFor(reopened));
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(reopened.elements.find(element => element.name === "Preview")!.id)).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  });

  it("reevaluates upstream edits with stable capture identities on cold and warm Rust requests", async () => {
    const source = `nui 1
// authored comment retained on save
const size: number = 100
line L = segment(start: (0, 0), end: (@size, 0))
const saved: line = @L
move @L(from: @L.start, to: (10, 0))
line Preview = from(source: @saved)
`;
    const first = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    const second = compileCanonicalText(first, source.replace("number = 100", "number = 160"));
    expect(second.status).not.toBe("fatal");
    const previewId = first.doc.document.elements.find(element => element.name === "Preview")!.id;
    expect(second.doc.document.elements.find(element => element.name === "Preview")!.id).toBe(previewId);
    expect(second.sourceText).toContain("// authored comment retained on save");
    const rust = createRustStdioParityClient(process.cwd());
    try {
      for (const [compiled, end] of [[first, 100], [second, 160], [first, 100]] as const) {
        const fixture = { compiled, elements: compiled.doc.document.elements };
        const options = optionsFor(fixture);
        const results = [evaluateElements(fixture.elements, options), evaluationPayloadToResult(await rust.evaluate(fixture.elements, options))];
        for (const result of results) {
          expect(result.errors).toEqual([]);
          expect(result.computedGeometry.get(previewId)).toMatchObject({ start: { x: 0, y: 0 }, end: { x: end, y: 0 } });
        }
      }
    } finally { rust.dispose(); }
    const cold = fixtureFromSource(second.sourceText);
    expect(evaluateElements(cold.elements, optionsFor(cold)).computedGeometry.get(cold.elements.find(element => element.name === "Preview")!.id)).toMatchObject({ end: { x: 160, y: 0 } });
    const moved = fixtureFromSource(source.replace("const saved: line = @L\nmove @L(from: @L.start, to: (10, 0))", "move @L(from: @L.start, to: (10, 0))\nconst saved: line = @L"));
    expect(evaluateElements(moved.elements, optionsFor(moved)).computedGeometry.get(moved.elements.find(element => element.name === "Preview")!.id)).toMatchObject({ start: { x: 10, y: 0 }, end: { x: 110, y: 0 } });
  });

  it("keeps genuine construction cycles explicit", () => {
    const compiled = compileDslDocument(`nui 1
line A = from(source: @B)
line B = from(source: @A)
`);
    expect(compiled.diagnostics.some(diagnostic => diagnostic.severity === "error" && /cycle/.test(diagnostic.code ?? ""))).toBe(true);
  });

});
