import { describe, expect, it } from "vitest";
import { serializeSetStatement } from "./dslSetSerializer";
import { parseDsl } from "./dslParser";
import type { DslStatement } from "./dslTypes";

const setOf = (source: string): Extract<DslStatement, { kind: "set" }> => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics).toEqual([]);
  const statement = parsed.statements[0];
  if (statement.kind !== "set") throw new Error("expected a set statement");
  return statement;
};

describe("serializeSetStatement", () => {
  it("emits canonical set + target + expression text", () => {
    expect(serializeSetStatement(setOf("set x = 12"))).toBe("set x = 12");
    expect(serializeSetStatement(setOf('set label = "front"'))).toBe('set label = "front"');
    expect(serializeSetStatement(setOf("set flag = true"))).toBe("set flag = true");
  });

  it("re-quotes a non-ASCII bare name via formatDslName, matching other statement kinds", () => {
    const source = "set 表示する = false";
    expect(serializeSetStatement(setOf(source))).toBe(source);
  });

  it("normalizes the outer shape while leaving the RHS's internal spacing untouched", () => {
    const source = "set   x   =   12   +   3  ";
    expect(serializeSetStatement(setOf(source))).toBe("set x = 12   +   3");
  });

  it("preserves the RHS's original quote style and escapes byte-for-byte, without canonicalizing them", () => {
    const source = "set note = 'has \\\" inside'";
    expect(serializeSetStatement(setOf(source))).toBe(source);
  });

  it("is idempotent: serializing a canonical set statement reproduces it exactly", () => {
    const canonical = "set 方向 = right";
    const once = serializeSetStatement(setOf(canonical));
    expect(once).toBe(canonical);
    const twice = serializeSetStatement(setOf(once));
    expect(twice).toBe(once);
  });

  it("round-trips through reparse without diagnostics for a variety of RHS shapes", () => {
    for (const source of [
      "set a = 1 + 2",
      'set b = "x"',
      "set c = false",
      "set d = @other + 1"
    ]) {
      const serialized = serializeSetStatement(setOf(source));
      const reparsed = parseDsl(serialized);
      expect(reparsed.diagnostics).toEqual([]);
      expect(reparsed.statements).toHaveLength(1);
      expect(serializeSetStatement(reparsed.statements[0] as Extract<DslStatement, { kind: "set" }>)).toBe(serialized);
    }
  });
});
