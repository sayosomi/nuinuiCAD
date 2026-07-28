import { describe, expect, it } from "vitest";
import { typedDeclarationInitializerCompletionContext } from "./dslTypedDeclarationCompletionContext";

describe("typedDeclarationInitializerCompletionContext", () => {
  it("returns null for a non-declaration statement", () => {
    expect(typedDeclarationInitializerCompletionContext("point A = freePoint(x: 1, y: 2)", 10)).toBeNull();
  });

  it("returns null when the cursor is inside the name span", () => {
    const line = "const foo: number = 1";
    expect(typedDeclarationInitializerCompletionContext(line, 8)).toBeNull();
  });

  it("returns null when the cursor is inside the type annotation span", () => {
    const line = "const foo: number = 1";
    expect(typedDeclarationInitializerCompletionContext(line, 13)).toBeNull();
  });

  it("returns null when the type annotation itself failed to parse", () => {
    const line = "const foo: nope = 1";
    expect(typedDeclarationInitializerCompletionContext(line, line.length)).toBeNull();
  });

  it("offers an operand context right after `=` with nothing typed yet", () => {
    const line = "const flag: boolean = ";
    const context = typedDeclarationInitializerCompletionContext(line, line.length);
    expect(context?.declaredType).toEqual({ kind: "boolean" });
    expect(context?.positionContext).toEqual({
      kind: "operand",
      from: line.length,
      to: line.length,
      referenceOnly: false,
      literalOnly: false,
      expectedType: { kind: "boolean" }
    });
  });

  it("offers an operand context at the very moment `=` is typed with a trailing space", () => {
    const line = "const flag: boolean =";
    // Cursor right after "=", before any space has even been typed.
    const context = typedDeclarationInitializerCompletionContext(line, line.length);
    expect(context?.positionContext.kind).toBe("operand");
  });

  it("scopes the in-progress reference span to just the @partial text", () => {
    const line = "const side: choice(right, left) = @o";
    const context = typedDeclarationInitializerCompletionContext(line, line.length);
    expect(context?.positionContext).toMatchObject({ kind: "operand", referenceOnly: true, from: line.indexOf("@o"), to: line.length });
  });

  it("offers an operator context right after a completed literal", () => {
    const line = "const n: number = 1 ";
    const context = typedDeclarationInitializerCompletionContext(line, line.length);
    expect(context?.positionContext.kind).toBe("operator");
  });

  it("resolves choice declarations with the declared option order preserved on the type", () => {
    const line = "const side: choice(right, left) = ";
    const context = typedDeclarationInitializerCompletionContext(line, line.length);
    expect(context?.declaredType).toEqual({ kind: "choice", options: ["right", "left"] });
  });
});
