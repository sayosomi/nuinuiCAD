import { describe, expect, it } from "vitest";
import { dslTypedDeclarationTypeNames } from "./dslDeclarationParser";
import { declaredTypeCompletionContextAt } from "./dslDeclaredTypeCompletionContext";
import { dslCompletionContextAt } from "./dslCompletionContext";

describe("declaredTypeCompletionContextAt", () => {
  it.each([
    "const x:",
    "const x: n",
    "const x: num =",
    "const x: cho"
  ])("recognizes the in-progress declaration %s", (source) => {
    const pos = source.endsWith("=") ? source.indexOf(" =") : source.length;
    const expectedFrom = source.indexOf(":") + 1 + (source.slice(source.indexOf(":") + 1).match(/^\s*/)?.[0].length ?? 0);
    expect(declaredTypeCompletionContextAt(source, pos)).toEqual({ from: expectedFrom, to: pos, bindingKind: "const" });
    expect(dslCompletionContextAt(source, pos)).toEqual({ kind: "declaredType", from: expectedFrom, to: pos, bindingKind: "const" });
  });

  it("uses the grammar's declared type names as the completion catalog", () => {
    expect(dslTypedDeclarationTypeNames).toEqual([
      "number", "string", "boolean", "choice", "point[]", "line[]", "path[]"
    ]);
  });

  it("does not offer a type completion after the type name, in type details, or in an initializer", () => {
    expect(declaredTypeCompletionContextAt("const x: number =", "const x: number =".length)).toBeNull();
    expect(declaredTypeCompletionContextAt("const x: number(step: 5)", "const x: number(step".length)).toBeNull();
    expect(declaredTypeCompletionContextAt("const x: choice(left, right)", "const x: choice(left".length)).toBeNull();
    expect(declaredTypeCompletionContextAt("const x: number = 12", "const x: number = 12".length)).toBeNull();
  });
});