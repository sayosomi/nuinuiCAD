import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { DslDiagnostic } from "../dsl/dslTypes";
import { typedVariableQuickFixes, type TypedVariableQuickFixDescriptor } from "./typedVariableQuickFixes";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
};

const diagnosticsWithCode = (diagnostics: readonly DslDiagnostic[], code: string) =>
  diagnostics.filter((diagnostic) => diagnostic.code === code);

/** Runs the module against a real compile && returns descriptors for every
 * diagnostic carrying `code`, asserting there is exactly one such diagnostic
 * unless `expectCount` says otherwise. */
const fixesFor = (
  source: string,
  code: string,
  expectCount = 1
): { diagnostics: readonly DslDiagnostic[]; descriptors: readonly TypedVariableQuickFixDescriptor[] } => {
  const compiled = compile(source);
  const matching = diagnosticsWithCode(compiled.diagnostics, code);
  expect(matching.length).toBe(expectCount);
  const all = typedVariableQuickFixes(source, compiled.statements, compiled.diagnostics);
  const index = compiled.diagnostics.indexOf(matching[0]);
  return { diagnostics: compiled.diagnostics, descriptors: all[index] };
};

const applySplice = (source: string, action: Extract<TypedVariableQuickFixDescriptor["action"], { kind: "splice" }>) =>
  `${source.slice(0, action.from)}${action.insert}${source.slice(action.to)}`;

describe("typedVariableQuickFixes", () => {
  describe("missing declared type", () => {
    it("inserts a bare colon skeleton right after the name", () => {
      const source = ["nui 4", "let x = 5"].join("\n");
      const { descriptors } = fixesFor(source, "missing-declared-type");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      expect(action.expectedOldText).toBe("");
      expect(applySplice(source, action)).toBe(["nui 4", "let x:  = 5"].join("\n"));
    });

    it("offers nothing when the name itself is also missing", () => {
      const source = ["nui 4", "let = 5"].join("\n");
      const { descriptors } = fixesFor(source, "missing-declared-type");
      expect(descriptors).toEqual([]);
    });
  });

  describe("invalid choice literal", () => {
    it("offers one replacement per declared option, in declaration order, for a let", () => {
      const source = ["nui 4", "let x: choice(a, b, c) = d"].join("\n");
      const { descriptors } = fixesFor(source, "invalid-choice-literal");
      const replaceIds = descriptors.filter((d) => d.id.startsWith("choice-replace:"));
      expect(replaceIds.map((d) => d.id.split(":")[2])).toEqual(["a", "b", "c"]);
      for (const descriptor of replaceIds) {
        const action = descriptor.action;
        if (action.kind !== "splice") throw new Error("expected a splice action");
        expect(action.expectedOldText).toBe("d");
        expect(applySplice(source, action)).toBe(
          `nui 4\nlet x: choice(a, b, c) = ${descriptor.id.split(":")[2]}`
        );
      }
      // A let with a known declared type also gets the recovery skeleton.
      expect(descriptors.some((d) => d.id.startsWith("set-skeleton-recovery:"))).toBe(true);
    });

    it("offers replacements but not the set-skeleton recovery for a const", () => {
      const source = ["nui 4", "const x: choice(a, b, c) = d"].join("\n");
      const { descriptors } = fixesFor(source, "invalid-choice-literal");
      expect(descriptors.filter((d) => d.id.startsWith("choice-replace:"))).toHaveLength(3);
      expect(descriptors.some((d) => d.id.startsWith("set-skeleton-recovery:"))).toBe(false);
    });

    it("offers nothing for a `set` statement's invalid choice literal RHS", () => {
      const source = ["nui 4", "let x: choice(a, b) = a", "set x = c"].join("\n");
      const { descriptors } = fixesFor(source, "invalid-choice-literal");
      expect(descriptors).toEqual([]);
    });
  });

  describe("const-assignment guidance", () => {
    it("offers no action at all", () => {
      const source = ["nui 4", "const x: number = 1", "set x = 2"].join("\n");
      const { descriptors } = fixesFor(source, "const-assignment");
      expect(descriptors).toEqual([]);
    });
  });

  describe("invalid-let set-skeleton recovery", () => {
    it("fires for scalar-type-mismatch on a let's own initializer", () => {
      const source = ["nui 4", "let x: number = \"hello\"", "let y: number = 1"].join("\n");
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      const applied = applySplice(source, action);
      expect(applied).toBe(["nui 4", "let x: number = \"hello\"", "set x = ", "let y: number = 1"].join("\n"));
    });

    it("does not fire for a const with a mismatched initializer", () => {
      const source = ["nui 4", "const x: number = \"hello\""].join("\n");
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      expect(descriptors).toEqual([]);
    });

    it("inserts before the next statement, not on the declaration's own line, when there is a trailing same-line comment", () => {
      const source = ["nui 4", "let x: number = \"hello\"  # note", "let y: number = 1"].join("\n");
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      const applied = applySplice(source, action);
      expect(applied).toBe(
        ["nui 4", "let x: number = \"hello\"  # note", "set x = ", "let y: number = 1"].join("\n")
      );
    });

    it("inserts before the closing brace when the declaration is the last statement in a block", () => {
      const source = ["nui 4", "group g {", "let x: number = \"hello\"", "}"].join("\n");
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      const applied = applySplice(source, action);
      expect(applied).toBe(["nui 4", "group g {", "let x: number = \"hello\"", "set x = ", "}"].join("\n"));
    });

    it("appends a fresh trailing line at true EOF with no trailing newline", () => {
      const source = ["nui 4", "let x: number = \"hello\""].join("\n");
      expect(source.endsWith("\n")).toBe(false);
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      const applied = applySplice(source, action);
      expect(applied).toBe(`${["nui 4", "let x: number = \"hello\"", "set x = "].join("\n")}\n`);
    });

    it("does not double a blank line at true EOF when the source already ends with a newline", () => {
      const source = `${["nui 4", "let x: number = \"hello\""].join("\n")}\n`;
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      const applied = applySplice(source, action);
      expect(applied).toBe(`${["nui 4", "let x: number = \"hello\"", "set x = "].join("\n")}\n`);
    });

    it("normalizes CRLF input and computes offsets against the LF form (matching a live EditorView, which is always LF)", () => {
      const source = ["nui 4", "let x: number = \"hello\"", "let y: number = 1"].join("\r\n");
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      const normalized = source.replace(/\r\n/g, "\n");
      expect(descriptors[0].sourceSnapshot).toBe(normalized);
      const applied = applySplice(normalized, action);
      expect(applied).toBe(["nui 4", "let x: number = \"hello\"", "set x = ", "let y: number = 1"].join("\n"));
    });

    it("preserves indentation from the declaration's own line", () => {
      const source = ["nui 4", "group g {", "  let x: number = \"hello\"", "}"].join("\n");
      const { descriptors } = fixesFor(source, "scalar-type-mismatch");
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      expect(action.insert).toBe("  set x = \n");
    });
  });

  describe("malformed/mismatched input", () => {
    it("returns no descriptors for a diagnostic whose line has no statement", () => {
      const source = ["nui 4", "let x: number = 1"].join("\n");
      const compiled = compile(source);
      const fabricated: DslDiagnostic = { severity: "error", line: 999, column: 1, message: "x", code: "missing-declared-type" };
      const result = typedVariableQuickFixes(source, compiled.statements, [fabricated]);
      expect(result).toEqual([[]]);
    });

    it("returns no choice-literal descriptors when the diagnostic's column is out of range", () => {
      const source = ["nui 4", "let x: choice(a, b, c) = d"].join("\n");
      const compiled = compile(source);
      const fabricated: DslDiagnostic = { severity: "error", line: 2, column: 9999, message: "x", code: "invalid-choice-literal" };
      const result = typedVariableQuickFixes(source, compiled.statements, [fabricated]);
      expect(result[0].filter((d) => d.id.startsWith("choice-replace:"))).toEqual([]);
    });

    it("produces nothing at all when there are no diagnostics", () => {
      const source = ["nui 4", "let x: number = 1"].join("\n");
      const compiled = compile(source);
      expect(typedVariableQuickFixes(source, compiled.statements, [])).toEqual([]);
    });
  });
});
