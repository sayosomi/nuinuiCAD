import { describe, expect, it } from "vitest";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import { typedVariableQuickFixes, type TypedVariableQuickFixDescriptor } from "@nuinuicad/nui-language";

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
      const source = ["nui 1", "const x = 5"].join("\n");
      const { descriptors } = fixesFor(source, "missing-declared-type");
      expect(descriptors).toHaveLength(1);
      const action = descriptors[0].action;
      if (action.kind !== "splice") throw new Error("expected a splice action");
      expect(action.expectedOldText).toBe("");
      expect(applySplice(source, action)).toBe(["nui 1", "const x:  = 5"].join("\n"));
    });

    it("offers nothing when the name itself is also missing", () => {
      const source = ["nui 1", "const = 5"].join("\n");
      const { descriptors } = fixesFor(source, "missing-declared-type");
      expect(descriptors).toEqual([]);
    });
  });

  describe("invalid choice literal", () => {
    it("offers one replacement per declared option, in declaration order", () => {
      const source = ["nui 1", "const x: choice(a, b, c) = d"].join("\n");
      const { descriptors } = fixesFor(source, "invalid-choice-literal");
      const replaceIds = descriptors.filter((d) => d.id.startsWith("choice-replace:"));
      expect(replaceIds.map((d) => d.id.split(":")[2])).toEqual(["a", "b", "c"]);
      for (const descriptor of replaceIds) {
        const action = descriptor.action;
        if (action.kind !== "splice") throw new Error("expected a splice action");
        expect(action.expectedOldText).toBe("d");
        expect(applySplice(source, action)).toBe(
          `nui 1\nconst x: choice(a, b, c) = ${descriptor.id.split(":")[2]}`
        );
      }
    });

  });

  describe("malformed/mismatched input", () => {
    it("returns no descriptors for a diagnostic whose line has no statement", () => {
      const source = ["nui 1", "const x: number = 1"].join("\n");
      const compiled = compile(source);
      const fabricated: DslDiagnostic = { severity: "error", line: 999, column: 1, message: "x", code: "missing-declared-type" };
      const result = typedVariableQuickFixes(source, compiled.statements, [fabricated]);
      expect(result).toEqual([[]]);
    });

    it("returns no choice-literal descriptors when the diagnostic's column is out of range", () => {
      const source = ["nui 1", "const x: choice(a, b, c) = d"].join("\n");
      const compiled = compile(source);
      const fabricated: DslDiagnostic = { severity: "error", line: 2, column: 9999, message: "x", code: "invalid-choice-literal" };
      const result = typedVariableQuickFixes(source, compiled.statements, [fabricated]);
      expect(result[0].filter((d) => d.id.startsWith("choice-replace:"))).toEqual([]);
    });

    it("produces nothing at all when there are no diagnostics", () => {
      const source = ["nui 1", "const x: number = 1"].join("\n");
      const compiled = compile(source);
      expect(typedVariableQuickFixes(source, compiled.statements, [])).toEqual([]);
    });
  });
});
