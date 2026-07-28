import { describe, expect, it } from "vitest";
import { setCompletionContextAt } from "./dslSetCompletionContext";

describe("setCompletionContextAt", () => {
  it("returns null for a non-set statement", () => {
    expect(setCompletionContextAt("const foo: number = 1", 8)).toBeNull();
  });

  it("returns null while still inside the \"set\" keyword itself", () => {
    expect(setCompletionContextAt("set foo = 1", 2)).toBeNull();
  });

  describe("target region", () => {
    it("offers a target context with nothing typed yet right after \"set \"", () => {
      const line = "set ";
      const context = setCompletionContextAt(line, line.length);
      expect(context).toEqual({ kind: "target", from: line.length, to: line.length });
    });

    it("offers a target context for a bare name with no \"=\" typed yet", () => {
      const line = "set fo";
      const context = setCompletionContextAt(line, line.length);
      expect(context).toEqual({ kind: "target", from: line.indexOf("fo"), to: line.length });
    });

    it("scopes the target word to the identifier ending at the cursor mid-edit", () => {
      const line = "set foo = 1";
      const pos = line.indexOf("foo") + 2; // cursor between "fo" and "o"
      const context = setCompletionContextAt(line, pos);
      expect(context).toEqual({ kind: "target", from: line.indexOf("foo"), to: pos });
    });

    it("offers a target context right at the end of a fully-typed name, before \"=\"", () => {
      const line = "set foo = 1";
      const pos = line.indexOf(" =");
      const context = setCompletionContextAt(line, pos);
      expect(context).toEqual({ kind: "target", from: line.indexOf("foo"), to: pos });
    });
  });

  describe("dead zones", () => {
    it("returns null in the whitespace gap between a fully-typed name and \"=\"", () => {
      const line = "set foo  = 1";
      const pos = line.indexOf("foo") + "foo".length + 1; // one space past the name, still before "="
      expect(setCompletionContextAt(line, pos)).toBeNull();
    });
  });

  describe("RHS region", () => {
    it("offers an RHS operand context with nothing typed yet right after \"=\"", () => {
      const line = "set foo = ";
      const context = setCompletionContextAt(line, line.length);
      expect(context).toMatchObject({ kind: "rhs", from: line.length, to: line.length, targetName: "foo" });
    });

    it("offers an RHS operand context at the very moment \"=\" is typed, before any space", () => {
      const line = "set foo =";
      const context = setCompletionContextAt(line, line.length);
      expect(context?.kind).toBe("rhs");
    });

    it("scopes an in-progress @reference to just the @partial text", () => {
      const line = "set foo = @b";
      const context = setCompletionContextAt(line, line.length);
      expect(context).toMatchObject({ kind: "rhs", from: line.indexOf("@b"), to: line.length, targetName: "foo" });
    });

    it("classifies the position right after a completed literal operand as an operator boundary", () => {
      const line = "set foo = 5 ";
      const context = setCompletionContextAt(line, line.length);
      expect(context?.kind).toBe("rhs");
      expect(context).toMatchObject({ from: line.length, to: line.length });
    });

    it("carries the current target name text even while it is itself still unresolved", () => {
      const line = "set doesNotExist = ";
      const context = setCompletionContextAt(line, line.length);
      expect(context).toMatchObject({ kind: "rhs", targetName: "doesNotExist" });
    });
  });

  describe("dirty-buffer context switch", () => {
    it("classifies as target before \"=\" and as RHS after it, for the same statement text", () => {
      const line = "set foo = @bar";
      const targetPos = line.indexOf("foo") + 2;
      const rhsPos = line.length;
      expect(setCompletionContextAt(line, targetPos)?.kind).toBe("target");
      expect(setCompletionContextAt(line, rhsPos)?.kind).toBe("rhs");
    });
  });
});
