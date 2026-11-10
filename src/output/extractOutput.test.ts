import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { buildOutputPlan, PX_TO_MM } from "./outputCore";
import { canvasLayerVisibleElementIds, projectCanvasLayerPresentation } from "../model/canvasLayerPresentation";

const compile = (source: string) => {
  const c = compileFreshCanonicalText(source);
  if (c.status === "fatal") throw new Error(JSON.stringify(c.diagnostics));
  const doc = c.doc;
  const evaluation = evaluateElementsReference(doc.document.elements, buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: undefined }));
  const plan = (name: string) => {
    const output = [...doc.document.svgOutputs, ...doc.document.printOutputs].find(o => o.name === name)!;
    return buildOutputPlan({ compiledDocument: doc, output, evaluation });
  };
  return { doc, evaluation, plan };
};

const crossGroup = (place: string, layers: string, bad = "@Parent::B::Cut", upperLayer = "finished") => `nui 1
layer draft
layer finished
group Parent {
  group A {
    line L in @draft = segment(start: (0,0), end: (100,0))
  }
  group B {
    point Cut = coordinate(x: 40, y: 0)
    extract E in @finished(source: @Parent::A::L, parts: [lower: start..@Parent::B::Cut, upper in @${upperLayer}: ${bad}..end])
  }
}
layout Layout {
  ${place}
}
svg S(layout: @Layout, layers: [${layers}], margin: 0)
print P(layout: @Layout, layers: [${layers}], paper: a4, overlap: 0)`;

const cases = [
  ["@Parent::A", "@draft", ["L"]], ["@Parent::A", "@finished", []],
  ["@Parent::B", "@draft", []], ["@Parent::B", "@finished", ["lower", "upper"]],
  ["@Parent", "@draft", ["L"]], ["@Parent", "@finished", ["lower", "upper"]],
  ["@Parent", "@draft, @finished", ["L", "lower", "upper"]]
] as const;

describe("extract Canvas and output ownership", () => {
  it.each(["@missing", "@Off"])("blocks a selected dependency of invalid excluded part %s", bound => {
    const source = `nui 1\nlayer draft\nlayer finished\ngroup G {\n  line L in @draft = segment(start: (0,0), end: (100,0))\n  point Off = coordinate(x: 40, y: 9)\n  extract E(source: @L, parts: [bad in @draft: ${bound}..end, good in @finished: start..end])\n  path Dependent in @finished = from(source: @E::bad)\n}\nlayout Layout {\n  place @G(at: (0,0))\n}\nsvg S(layout: @Layout, layers: [@finished])`;
    expect(() => compile(source).plan("S")).toThrow();
    expect(compile(source.replace("  path Dependent in @finished = from(source: @E::bad)\n", "")).plan("S").drawables.map(d => d.name)).toEqual(["good"]);
  });
  it("isolates invalid Module parts per layer while retaining two runtime owners", () => {
    const { plan } = compile(`nui 1
module M() {
  layer draft
  line L in @draft = segment(start: (0,0), end: (100,0))
  extract E(source: @L, parts: [bad in @draft: @missing..end, good: start..end])
}
group G {
  instance One = M()
  instance Two = M()
}
layout Layout {
  place @G(at: (0,0))
}
svg S(layout: @Layout, layers: [@default])`);
    expect(plan("S").drawables.map(d => d.name)).toEqual(["good", "good"]);
  });
  it.each(cases)("keeps placement %s and layers %s independent", (group, layers, expected) => {
    const { plan } = compile(crossGroup(`place ${group}(at: (0,0))`, layers));
    for (const format of ["S", "P"]) expect(plan(format).drawables.map(d => d.name).sort()).toEqual([...expected].sort());
  });
  it("retains source and parts in separate placements without suppression", () => {
    const { plan } = compile(crossGroup("place @Parent::A(at: (0,0))\nplace @Parent::B(at: (200,0))", "@draft, @finished"));
    const shapes = plan("S").drawables;
    expect(shapes.map(d => d.name).sort()).toEqual(["L", "lower", "upper"]);
    expect(shapes.find(d => d.name === "L")).toMatchObject({ start: { x: 0, y: 0 } });
    expect(shapes.find(d => d.name === "lower")).toMatchObject({ segments: [{ start: { x: 200, y: 0 } }] });
  });
  it.each([[false,false,["L","lower","upper"]], [true,false,["lower","upper"]], [false,true,["L"]], [true,true,[]]] as const)("applies Canvas draft/finished hiding %s/%s", (hideDraft, hideFinished, expected) => {
    const { doc, evaluation, plan } = compile(crossGroup("place @Parent(at: (0,0))", "@draft, @finished"));
    const projection = projectCanvasLayerPresentation({ compiledDocument: doc, elements: doc.document.elements, evaluation });
    const hidden = new Set(projection.layers.filter(l => l.name === "draft" ? hideDraft : l.name === "finished" && hideFinished).map(l => l.id));
    const ids = canvasLayerVisibleElementIds(evaluation.effectiveVisibleElementIds!, { ...projection, hiddenLayerIds: hidden });
    expect(doc.document.elements.filter(e => ids.has(e.id) && ["L","lower","upper"].includes(e.name)).map(e => e.name).sort()).toEqual([...expected].sort());
    expect(plan("S").drawables).toHaveLength(3);
  });
  it.each([["", "", "default"], [" in @finished", "", "finished"], ["", " in @draft", "draft"], [" in @finished", " in @draft", "draft"]])("resolves head/part layer precedence %s / %s", (head, part, expected) => {
    const { doc } = compile(`nui 1
layer draft
layer finished
group G {
  line L in @draft = segment(start: (0,0), end: (100,0))
  extract E${head}(source: @L, parts: [whole${part}: start..end])
}
layout Layout {
  place @G(at: (0,0))
}
svg S(layout: @Layout, layers: [@default, @draft, @finished])`);
    const id = doc.document.elements.find(e => e.name === "whole")!.id;
    expect(doc.document.sourceLayerMembershipsByElementId?.get(id)?.layerName).toBe(expected);
  });
  it("cascades group/head/part Style properties without inheriting source Style or visibility", () => {
    const { doc, evaluation, plan } = compile(`nui 1
style Parent {
  color: #123456,
  width: 2px,
}
style Source {
  visible: false,
  color: #ff0000,
  width: 9px,
}
style Shared {
  color: #abcdef,
}
style Local {
  width: 4px,
}
group G[Parent] {
  line L[Source] = segment(start: (0,0), end: (100,0))
  point Cut = coordinate(x: 40, y: 0)
  extract E[Shared](source: @L, parts: [lower: start..@Cut, upper[Local]: @Cut..end])
}
layout Layout {
  place @G(at: (0,0))
}
svg S(layout: @Layout, layers: [@default])`);
    const source = doc.document.elements.find(e => e.name === "L")!;
    expect(evaluation.effectiveVisibleElementIds?.has(source.id)).toBe(false);
    const shapes = plan("S").drawables;
    expect(shapes.map(d => d.name).sort()).toEqual(["lower", "upper"]);
    const lower = shapes.find(d => d.name === "lower")!, upper = shapes.find(d => d.name === "upper")!;
    expect("stroke" in lower ? lower.stroke : undefined).toMatchObject({ colorHex: "#abcdef", widthMm: 2*PX_TO_MM });
    expect("stroke" in upper ? upper.stroke : undefined).toMatchObject({ colorHex: "#abcdef", widthMm: 4*PX_TO_MM });
  });
  it.each(["@missing", "@Parent::B::Off"])("scopes invalid part %s to selected layer and placement", bad => {
    let source = crossGroup("place @Parent(at: (0,0))", "@finished", bad, "draft");
    if (bad.endsWith("Off")) source = source.replace("point Cut =", "point Off = coordinate(x: 50, y: 10)\n    point Cut =");
    const healthy = compile(source);
    for (const format of ["S", "P"]) expect(healthy.plan(format).drawables.map(d => d.name)).toEqual(["lower"]);
    const selected = compile(source.replaceAll("layers: [@finished]", "layers: [@draft]"));
    for (const format of ["S", "P"]) expect(() => selected.plan(format)).toThrow();
    const excluded = compile(source.replace("place @Parent(at:", "place @Parent::A(at:"));
    expect(excluded.plan("S").drawables).toEqual([]);
  });
});
