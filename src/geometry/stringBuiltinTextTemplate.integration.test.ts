import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "./textTemplateRuntime";

const productionEvaluationOptions = (compiled: ReturnType<typeof compileDslDocument>): EvaluateElementsOptions => {
  const elementIdByStatementIndex = compiled.statementMap?.elementIdByStatementIndex ?? new Map();
  const textTemplateEntriesByElementId = compiled.textTemplates
    ? buildTextTemplateEntriesByElementId({ textTemplates: compiled.textTemplates, elementIdByStatementIndex })
    : undefined;
  const propertyBindingEntries = compiled.scalarProgram && compiled.propertyBindings
    ? buildPropertyBindingRuntimeEntries(
        { propertyBindings: compiled.propertyBindings, elementIdByStatementIndex },
        compiled.document?.elements ?? []
      )
    : undefined;
  const textPropertyBindingEntries = compiled.scalarProgram && compiled.propertyBindings
    ? buildTextPropertyBindingRuntimeEntries(
        { propertyBindings: compiled.propertyBindings, elementIdByStatementIndex },
        compiled.document?.elements ?? []
      )
    : undefined;
  return {
    ...(compiled.scalarProgram ? { scalarProgram: compiled.scalarProgram } : {}),
    ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
  };
};

describe("nui1 string(choice) production text-template evaluation", () => {
  it("renders the canonical choice token through the existing text-template runtime", () => {
    const source = [
      "nui 1",
      "const side: choice(right, left) = right",
      'text T = label(text: "side=${string(@side)}", anchor: none, size: 3)'
    ].join("\n");
    const compiled = compileDslDocument(source, { assignedStatementIds: new Map([[1, "test:side"]]) });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const elements = compiled.document!.elements;
    const options = productionEvaluationOptions(compiled);
    const textElement = elements.find((element) => element.type === "text" && element.name === "T");
    const result = evaluateElements(elements, options);

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(textElement!.id)).toMatchObject({ kind: "text", text: "side=right" });
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });
});
