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
  "point Dependent = offset(from: @StyledHidden, dx: 1, dy: 0)",
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
});
