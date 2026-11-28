import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { evaluateElementsReference } from "./evaluationEngine";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const source = [
  "nui 1",
  "style Hidden {",
  "  visible: false,",
  "}",
  "style Shown {",
  "  visible: true,",
  "}",
  "point StyledHidden [Hidden] = coordinate(x: 0, y: 0)",
  "point Dependent = offset(from: StyledHidden, dx: 1, dy: 0)",
  "point DirectHidden [Shown] = coordinate(x: 20, y: 0, visible: false)",
  "point DirectDisabled [Shown] = coordinate(x: 30, y: 0, enabled: false)"
].join("\n");

describe("Style evaluator integration", () => {
  it("keeps ordinary Style visibility separate from geometry and direct hard gates", () => {
    const compiled = compileFreshCanonicalText(source);
    if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));

    const evaluation = evaluateElementsReference(
      compiled.doc.document.elements,
      buildEvaluationOptions({
        compiledDocument: compiled.doc,
        evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex
      })
    );
    const element = (name: string) => {
      const found = compiled.doc.document.elements.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`missing element ${name}`);
      return found;
    };

    const styledHidden = element("StyledHidden");
    expect(evaluation.evaluatedElementIds).toContain(styledHidden.id);
    expect(evaluation.computedGeometry.has(styledHidden.id)).toBe(true);
    expect(evaluation.effectiveVisibleElementIds).not.toContain(styledHidden.id);
    expect(evaluation.effectiveEnabledElementIds).toContain(styledHidden.id);

    const dependent = element("Dependent");
    expect(evaluation.effectiveEnabledElementIds).toContain(dependent.id);
    expect(evaluation.errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: dependent.id, missingDependencyId: styledHidden.id })
    ]));

    const directHidden = element("DirectHidden");
    expect(evaluation.computedGeometry.has(directHidden.id)).toBe(true);
    expect(evaluation.effectiveVisibleElementIds).not.toContain(directHidden.id);
    expect(evaluation.effectiveEnabledElementIds).toContain(directHidden.id);

    const directDisabled = element("DirectDisabled");
    expect(evaluation.computedGeometry.has(directDisabled.id)).toBe(false);
    expect(evaluation.effectiveVisibleElementIds).not.toContain(directDisabled.id);
    expect(evaluation.effectiveEnabledElementIds).not.toContain(directDisabled.id);
  });

  it("keeps explicit zero, cascade provenance, inheritance, and the default width distinct", () => {
    const compiled = compileFreshCanonicalText([
      "nui 1",
      "style Zero {",
      "  width: 0px,",
      "}",
      "style Positive {",
      "  width: 1.5px,",
      "}",
      "style LaterPositive {",
      "  width: 2.5px,",
      "}",
      "group InheritedGroup [Zero] {",
      "  line Inherited = segment(start: (0, 0), end: (10, 0))",
      "  line ExplicitPositive [Positive] = segment(start: (0, 1), end: (10, 1))",
      "  line LaterPositiveWins [Positive, Zero, LaterPositive] = segment(start: (0, 2), end: (10, 2))",
      "}",
      "line ExplicitZero [Zero] = segment(start: (0, 3), end: (10, 3))",
      "line DefaultWidth = segment(start: (0, 4), end: (10, 4))"
    ].join("\n"));
    if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));

    const doc = compiled.doc;
    const evaluation = evaluateElementsReference(
      doc.document.elements,
      buildEvaluationOptions({
        compiledDocument: doc,
        evaluationLimitIndex: doc.document.evaluationLimitIndex
      })
    );
    const element = (name: string) => {
      const found = doc.document.elements.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`missing element ${name}`);
      return found;
    };
    const groupId = element("InheritedGroup").id;
    const inherited = element("Inherited");
    const explicitZero = element("ExplicitZero");
    const defaultWidth = element("DefaultWidth");

    expect(evaluation.effectiveDrawingModifierResolutions?.get(inherited.id)?.widthPx).toEqual({
      value: 0,
      winner: { ownerElementId: groupId, modifierName: "Zero" }
    });
    expect(evaluation.effectiveDrawingModifierStrokes?.get(inherited.id)?.widthPx).toBe(0);
    expect(evaluation.effectiveDrawingModifierResolutions?.get(explicitZero.id)?.widthPx).toEqual({
      value: 0,
      winner: { ownerElementId: explicitZero.id, modifierName: "Zero" }
    });
    expect(evaluation.effectiveDrawingModifierResolutions?.get(element("ExplicitPositive").id)?.widthPx).toMatchObject({
      value: 1.5,
      winner: { modifierName: "Positive" }
    });
    expect(evaluation.effectiveDrawingModifierResolutions?.get(element("LaterPositiveWins").id)?.widthPx).toMatchObject({
      value: 2.5,
      winner: { modifierName: "LaterPositive" }
    });
    expect(evaluation.effectiveDrawingModifierResolutions?.get(defaultWidth.id)?.widthPx).toEqual({ value: 1, winner: null });
  });
});
