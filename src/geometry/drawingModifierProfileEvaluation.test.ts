import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { evaluateElementsReference } from "./evaluationEngine";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const source = [
  "nui 4",
  "profile Print",
  "modifier HideInPrint {",
  "  for @Print {",
  "    state: hidden,",
  "  }",
  "}",
  "modifier DisableInPrint {",
  "  for @Print {",
  "    state: disabled,",
  "  }",
  "}",
  "modifier ReenableInPrint {",
  "  for @Print {",
  "    state: visible,",
  "  }",
  "}",
  "point ProfileHidden [HideInPrint] = coordinate(x: 0, y: 0)",
  "point ProfileDisabled [DisableInPrint] = coordinate(x: 10, y: 0)",
  "point Dependent = offset(from: @ProfileDisabled, dx: 1, dy: 0)",
  "point DirectHidden [ReenableInPrint] = coordinate(x: 20, y: 0, state: hidden)",
  "point DirectDisabled [ReenableInPrint] = coordinate(x: 30, y: 0, state: disabled)"
].join("\n");

describe("Drawing Profile evaluator integration", () => {
  it("applies selected profile activity while preserving geometry and direct hard gates", () => {
    const compiled = compileFreshCanonicalText(source);
    if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
    const profile = compiled.doc.document.drawingProfiles?.find((candidate) => candidate.name === "Print");
    if (!profile) throw new Error("Print Drawing Profile was not compiled");

    const evaluation = evaluateElementsReference(
      compiled.doc.document.elements,
      buildEvaluationOptions({
        compiledDocument: compiled.doc,
        evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex,
        selectedDrawingProfileId: profile.id
      })
    );
    const element = (name: string) => {
      const found = compiled.doc.document.elements.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`missing element ${name}`);
      return found;
    };

    const profileHidden = element("ProfileHidden");
    expect(evaluation.evaluatedElementIds).toContain(profileHidden.id);
    expect(evaluation.computedGeometry.has(profileHidden.id)).toBe(true);
    expect(evaluation.effectiveVisibleElementIds).not.toContain(profileHidden.id);
    expect(evaluation.effectiveEnabledElementIds).toContain(profileHidden.id);

    const profileDisabled = element("ProfileDisabled");
    expect(evaluation.evaluatedElementIds).toContain(profileDisabled.id);
    expect(evaluation.computedGeometry.has(profileDisabled.id)).toBe(false);
    expect(evaluation.effectiveVisibleElementIds).not.toContain(profileDisabled.id);
    expect(evaluation.effectiveEnabledElementIds).not.toContain(profileDisabled.id);

    const dependent = element("Dependent");
    expect(evaluation.effectiveEnabledElementIds).toContain(dependent.id);
    expect(evaluation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        elementId: dependent.id,
        missingDependencyId: profileDisabled.id
      })
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
