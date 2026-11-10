import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { extractEditingSourceFor } from "../model/extractEditingSource";
import { projectCanvasLayerPresentation } from "../model/canvasLayerPresentation";
import { useCanvasOverlayData } from "./useCanvasOverlayData";

const fixture = (text: string) => {
  const compiled = compileFreshCanonicalText(text).doc;
  const evaluation = evaluateElementsReference(compiled.document.elements, buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }));
  return { compiled, evaluation, elements: compiled.document.elements };
};
describe("extract source editing overlays", () => {
  it("links through a captured const to the exact source prefix and never publishes a helper drawable", () => {
    const input = fixture(`nui 1\nline L = segment(start: (0,0), end: (100,0))\nmove @L(from: (0,0), to: (0,10))\nconst Frozen: path = @L\nextract E(source: @Frozen, parts: [whole: start..end])\nmove @L(from: (0,0), to: (0,20))\nmove @E::whole(from: (0,0), to: (0,40))`);
    const part = input.elements.find(e => e.name === "whole")!;
    const helper = extractEditingSourceFor(input.compiled, input.evaluation, input.elements, part.id);
    expect(helper?.geometry).toMatchObject({ kind: "line", start: { x: 0, y: 10 } });
    expect(input.evaluation.computedGeometry.get(part.id)).toMatchObject({ start: { x: 0, y: 50 } });
    expect(input.evaluation.computedGeometry.size).toBe(2);
    expect(extractEditingSourceFor(input.compiled, input.evaluation, input.elements, input.elements.find(e => e.name === "L")!.id)).toBeNull();
  });
  it("shows dashed source and existing Bezier handles for a selected part even with the original layer hidden", () => {
    const text = `nui 1\nlayer draft\nlayer finished\ncurve C in @draft = bezier(start: (0,0), startAngle: 90, startLength: 40, end: (100,0), endAngle: 270, endLength: 40)\nextract E in @finished(source: @C, parts: [whole: start..end])`;
    const input = fixture(text), part = input.elements.find(e => e.name === "whole")!, source = input.elements.find(e => e.name === "C")!;
    const layerPresentation = projectCanvasLayerPresentation({ compiledDocument: input.compiled, elements: input.elements, evaluation: input.evaluation });
    const { result, rerender } = renderHook(({ selected }: { selected: string | null }) => useCanvasOverlayData({
      compiledDocument: input.compiled, evaluation: input.evaluation, elements: input.elements,
      selectedElementId: selected, pointPickCandidates: [], viewportSize: { width: 500, height: 400 }, canvasViewport: { panX: 0, panY: 0, zoom: 1 }, visibilityProfiles: [], activeVisibilityProfileId: null,
      canvasLayerPresentation: { ...layerPresentation, hiddenLayerIds: new Set([layerPresentation.layers.find(l => l.name === "draft")!.id]) },
      resolveImageSourceUrl: path => path
    }), { initialProps: { selected: part.id as string | null } });
    expect(result.current.selectedExtractEditingHelper?.points.length).toBeGreaterThan(2);
    expect(result.current.selectedBezierHandles.map(handle => handle.curveId)).toEqual([source.id, source.id]);
    rerender({ selected: null });
    expect(result.current.selectedExtractEditingHelper).toBeNull();
    expect(result.current.selectedBezierHandles).toEqual([]);
    const edited = compileCanonicalText({ ...compileFreshCanonicalText(text) }, text.replace("startLength: 40", "startLength: 60"));
    const reevaluated = evaluateElementsReference(edited.doc.document.elements, buildEvaluationOptions({ compiledDocument: edited.doc, evaluationLimitIndex: undefined }));
    expect(reevaluated.computedGeometry.get(part.id)).not.toEqual(input.evaluation.computedGeometry.get(part.id));
  });
  it("uses a generated part's explicit ancestor provenance to find an outer source", () => {
    const input = fixture(`nui 1\nfor outer in range(min: 0, max: 1, step: 1) {\n  line L = segment(start: (0,0), end: (100 + 10 * @outer,0))\n  for inner in range(min: 0, max: 1, step: 1) {\n    extract E(source: @L, parts: [whole: start..end])\n  }\n}`);
    const templateId = input.elements.find(e => e.name === "whole")!.id;
    const parts = input.evaluation.forGroupGeneratedRows!.filter(row => row.templateElementId === templateId);
    expect(parts).toHaveLength(4);
    expect(parts.map(row => extractEditingSourceFor(input.compiled, input.evaluation, input.elements, row.generatedElementId)?.geometry).map(g => g && "length" in g ? g.length : null)).toEqual([100,100,110,110]);
  });
});
