import { describe, expect, it } from "vitest";
import { serializeTypedDeclaration } from "./dslDeclarationSerializer";
import { parseDsl } from "./dslParser";
import type { DslStatement } from "./dslTypes";

const declarationOf = (source: string): Extract<DslStatement, { kind: "typedDeclaration" }> => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics).toEqual([]);
  const statement = parsed.statements[0];
  if (statement.kind !== "typedDeclaration") throw new Error("expected a typedDeclaration statement");
  return statement;
};

describe("serializeTypedDeclaration", () => {
  it("emits canonical const/let + type text for every declared type", () => {
    expect(serializeTypedDeclaration(declarationOf("const x: number = 12"))).toBe("const x: number = 12");
    expect(serializeTypedDeclaration(declarationOf('let y: string = "front"'))).toBe('let y: string = "front"');
    expect(serializeTypedDeclaration(declarationOf("const z: boolean = true"))).toBe("const z: boolean = true");
    expect(serializeTypedDeclaration(declarationOf("const d: choice(right, left) = right"))).toBe(
      "const d: choice(right, left) = right"
    );
  });

  it("re-quotes a non-ASCII bare name via formatDslName, matching other statement kinds", () => {
    const source = "const ラベル: string = \"前身頃\"";
    expect(serializeTypedDeclaration(declarationOf(source))).toBe(source);
  });

  it("normalizes the outer shape while leaving the initializer's internal spacing untouched", () => {
    const source = "const   x   :   number   =   12   +   3  ";
    expect(serializeTypedDeclaration(declarationOf(source))).toBe("const x: number = 12   +   3");
  });

  it("normalizes choice option spacing in the type annotation only", () => {
    const source = "const d: choice( right ,left ,  center ) = right";
    expect(serializeTypedDeclaration(declarationOf(source))).toBe("const d: choice(right, left, center) = right");
  });

  it("preserves the initializer's original quote style and escapes byte-for-byte, without canonicalizing them", () => {
    // A single-quoted string with an already-escaped double quote inside: if
    // Task 10 canonicalized the initializer (double-quote + re-escape), this
    // would come out differently. It must not.
    const source = "let note: string = 'has \\\" inside'";
    expect(serializeTypedDeclaration(declarationOf(source))).toBe(source);
  });

  it("is idempotent: serializing a canonical declaration reproduces it exactly", () => {
    const canonical = "const 方向: choice(right, left) = right";
    const once = serializeTypedDeclaration(declarationOf(canonical));
    expect(once).toBe(canonical);
    const twice = serializeTypedDeclaration(declarationOf(once));
    expect(twice).toBe(once);
  });

  it("round-trips through reparse without diagnostics for every declared type", () => {
    for (const source of [
      "const a: number = 1 + 2",
      'let b: string = "x"',
      "const c: boolean = false",
      "let d: choice(a, b, c) = b"
    ]) {
      const serialized = serializeTypedDeclaration(declarationOf(source));
      const reparsed = parseDsl(serialized);
      expect(reparsed.diagnostics).toEqual([]);
      expect(reparsed.statements).toHaveLength(1);
      expect(serializeTypedDeclaration(reparsed.statements[0] as Extract<DslStatement, { kind: "typedDeclaration" }>)).toBe(
        serialized
      );
    }
  });
});
