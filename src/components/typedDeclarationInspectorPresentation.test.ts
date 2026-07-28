import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import type { BindingId } from "../scalars/bindingCatalog";
import { typedDeclarationInspectorPresentation } from "./typedDeclarationInspectorPresentation";

const compileCanonical = (source: string) => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

const bindingIdByName = (
  compiled: ReturnType<typeof compileCanonical>,
  name: string
): BindingId => compiled.bindingAnalysis!.catalog.bindings.find(
  (binding) => binding.kind === "typed" && binding.name === name
)!.id;

describe("typedDeclarationInspectorPresentation", () => {
  it("projects a const number declaration", () => {
    const compiled = compileCanonical(["nui 3", "const width: number = 12"].join("\n"));
    const bindingId = bindingIdByName(compiled, "width");
    const presentation = typedDeclarationInspectorPresentation(compiled.bindingAnalysis!, compiled.statements, bindingId);
    expect(presentation).toEqual({
      bindingId,
      name: "width",
      mutabilityLabel: "const",
      rows: [
        { key: "kind", label: "種別", value: "const" },
        { key: "type", label: "型", value: "number" },
        { key: "initializer", label: "初期化式", value: "12" },
        { key: "bindingId", label: "ID", value: bindingId }
      ],
      invalidMessage: null
    });
  });

  it("projects a let boolean declaration", () => {
    const compiled = compileCanonical(["nui 3", "let shown: boolean = true"].join("\n"));
    const bindingId = bindingIdByName(compiled, "shown");
    const presentation = typedDeclarationInspectorPresentation(compiled.bindingAnalysis!, compiled.statements, bindingId);
    expect(presentation?.mutabilityLabel).toBe("let");
    expect(presentation?.rows).toContainEqual({ key: "type", label: "型", value: "boolean" });
    expect(presentation?.rows).toContainEqual({ key: "initializer", label: "初期化式", value: "true" });
    expect(presentation?.invalidMessage).toBeNull();
  });

  it("formats a string declaration's raw (unescaped) initializer", () => {
    const compiled = compileCanonical(["nui 3", 'const label: string = "front piece"'].join("\n"));
    const bindingId = bindingIdByName(compiled, "label");
    const presentation = typedDeclarationInspectorPresentation(compiled.bindingAnalysis!, compiled.statements, bindingId);
    expect(presentation?.rows).toContainEqual({ key: "type", label: "型", value: "string" });
    expect(presentation?.rows).toContainEqual({ key: "initializer", label: "初期化式", value: '"front piece"' });
  });

  it("formats a choice declaration's type", () => {
    const compiled = compileCanonical(["nui 3", "const side: choice(right, left) = right"].join("\n"));
    const bindingId = bindingIdByName(compiled, "side");
    const presentation = typedDeclarationInspectorPresentation(compiled.bindingAnalysis!, compiled.statements, bindingId);
    expect(presentation?.rows).toContainEqual({ key: "type", label: "型", value: "choice(right, left)" });
  });

  it("surfaces an invalid declaration's diagnostic message", () => {
    const compiled = compileCanonical(
      ["nui 3", "const broken: number = @missing", "const valid: number = 3"].join("\n")
    );
    const bindingId = bindingIdByName(compiled, "broken");
    const presentation = typedDeclarationInspectorPresentation(compiled.bindingAnalysis!, compiled.statements, bindingId);
    expect(presentation?.invalidMessage).toContain("未定義の変数");
    expect(presentation?.rows).toContainEqual({ key: "initializer", label: "初期化式", value: "@missing" });
  });

  it("keeps a recoverable invalid let's metadata visible (Task 40's recovery target stays inspectable)", () => {
    const compiled = compileCanonical(
      ["nui 3", "let broken: number = @missing", "set broken = 5"].join("\n")
    );
    const bindingId = bindingIdByName(compiled, "broken");
    const presentation = typedDeclarationInspectorPresentation(compiled.bindingAnalysis!, compiled.statements, bindingId);
    expect(presentation?.mutabilityLabel).toBe("let");
    expect(presentation?.invalidMessage).toContain("未定義の変数");
  });

  it("returns null for an unknown binding id", () => {
    const compiled = compileCanonical(["nui 3", "const width: number = 12"].join("\n"));
    const presentation = typedDeclarationInspectorPresentation(
      compiled.bindingAnalysis!,
      compiled.statements,
      "binding:does-not-exist"
    );
    expect(presentation).toBeNull();
  });

  it("returns null for a non-typed (forGroup iteration) binding kind", () => {
    const compiled = compileCanonical(
      ["nui 3", "for 繰返し (i from: 0 count: 3 step: 1) {", "  const y: number = 1", "}"].join("\n")
    );
    const iterationBinding = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "iteration");
    expect(iterationBinding).toBeTruthy();
    const presentation = typedDeclarationInspectorPresentation(compiled.bindingAnalysis!, compiled.statements, iterationBinding!.id);
    expect(presentation).toBeNull();
  });
});
