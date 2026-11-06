// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { createRustStdioParityClient, optionsFor, normalizeParityPayload } from "./evaluationParitySupport";
import { matrix, renameSource, renamedSource } from "./fixtures/issue-1535/matrix";

const accepted = new Set<string>();
const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
const evidence = process.env.ISSUE1535_EVIDENCE;
const compile = (source: string, current = initial) => {
  const compiled = compileCanonicalText(current, source);
  if (compiled.status === "valid" && ![...compiled.diagnostics, ...compiled.bindingIssueDiagnostics].some(d => d.severity === "error")) accepted.add(source);
  expect(accepted.size).toBeLessThanOrEqual(256);
  return compiled;
};
describe("#1535 closed 188-cell conformance matrix", () => {
  let rust: ReturnType<typeof createRustStdioParityClient>;
  const targetDirectory = mkdtempSync(join(tmpdir(), "nuinuicad-issue1535-rust-"));
  beforeAll(() => { rust = createRustStdioParityClient(process.cwd(), { targetDirectory }); }, 120_000);
  afterAll(() => {
    rust?.dispose();
    rmSync(targetDirectory, { recursive: true, force: true });
    console.info(`#1535 distinct accepted matrix/control sources: ${accepted.size}`);
    if (evidence) appendFileSync(evidence, JSON.stringify({ accepted: [...accepted].map(source => ({ source, sha256: createHash("sha256").update(source).digest("hex") })) }) + "\n");
  });
  it("evaluates all four exact Issue acceptance examples and their one-line control", async () => {
    const reference = readFileSync("docs/dsl/en/syntax.md", "utf8");
    const source = [...reference.matchAll(/```nui\n([\s\S]*?)\n```/g)].map(match => match[1]).find(source => source.includes("const parenthesized:"))!;
    expect(source).toBeDefined();
    const oneLine = source.replace(/\n {2}/g, " ");
    let previous = initial;
    for (const text of [source, oneLine]) {
      const compiled = compile(text, previous);
      expect(compiled.diagnostics).toEqual([]);
      previous = compiled;
      const elements = compiled.doc.document.elements;
      const options = optionsFor({ compiled, elements });
      const ts = evaluateElementsReferencePayload(elements, options);
      const production = await rust.evaluate(elements, options);
      expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(ts));
      const result = evaluationPayloadToResult(production);
      expect(result.errors).toEqual([]);
      for (const [name, value] of [["result", 3], ["leading", 3], ["trailing", 3], ["parenthesized", 1]] as const) {
        const id = compiled.doc.bindingAnalysis!.catalog.bindings.find(binding => binding.name === name)!.id;
        expect(result.computedScalarBindings?.get(id)).toMatchObject({ status: "ok", value: { value } });
      }
    }
  });
  it("accepts the nearby source-preserving rename controls", () => {
    for (const source of [renameSource, renamedSource]) expect(compile(source).diagnostics).toEqual([]);
  });
  it("has exactly the authorized cells", () => {
    expect(matrix).toHaveLength(188);
    expect(new Set(matrix.map(c => c.id)).size).toBe(188);
  });
  for (const cell of matrix) it(cell.id, async () => {
    const compiled = compile(cell.source);
    let actualValue: number | boolean | undefined;
    if (cell.rejected) {
      expect(compiled.diagnostics.some(d => d.severity === "error"), cell.source).toBe(true);
      expect(compiled.diagnostics.length).toBeLessThan(12);
      if (!cell.eof) {
        // Fatal source keeps last-good geometry by design. Prove recovery in
        // exact-current parser products, then independently evaluate the intact
        // statement's unmodified physical source through both evaluators.
        const current = compiled.currentCompiled;
        const intact = current.statements.find(s => s.kind === "typedDeclaration" && s.name === "intact")!;
        expect(intact).toBeDefined();
        const expectedEnclosing = cell.id.startsWith("N1/next/") && !cell.id.endsWith("/brace")
          ? current.statements.find(s => s.kind === "next")!.enclosing : null;
        expect(intact.enclosing).toEqual(expectedEnclosing);
        expect(current.diagnostics.some(d => d.severity === "error" && d.line >= intact.line)).toBe(false);
        const range = intact.documentRange;
        const recovered = compile("nui 1\n" + cell.source.slice(range.from, range.to));
        expect(recovered.diagnostics).toEqual([]);
        const elements = recovered.doc.document.elements;
        const options = optionsFor({ compiled: recovered, elements });
        const reference = evaluateElementsReferencePayload(elements, options);
        const production = await rust.evaluate(elements, options);
        expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(reference));
        const result = evaluationPayloadToResult(production);
        const id = recovered.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === "intact")!.id;
        expect(result.computedScalarBindings?.get(id)).toMatchObject({ status: "ok", value: { value: 20 } });
      }
    } else {
      const check = async (source: string) => {
        const candidate = source === cell.source ? compiled : compile(source, compiled);
        expect(candidate.diagnostics, source).toEqual([]);
        expect(candidate.status).toBe("valid");
        const elements = candidate.doc.document.elements;
        const options = optionsFor({ compiled: candidate, elements });
        const reference = evaluateElementsReferencePayload(elements, options);
        const production = await rust.evaluate(elements, options);
        expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(reference));
        const result = evaluationPayloadToResult(production);
        expect(result.errors).toEqual([]);
        const id = candidate.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === "result")!.id;
        const observed = result.computedScalarBindings?.get(id);
        expect(observed).toMatchObject({ status: "ok", value: { value: cell.expected } });
        if (observed?.status === "ok" && (observed.value.kind === "number" || observed.value.kind === "boolean")) actualValue = observed.value.value;
        // Canonical compiles assign stable statement identities independently of physical lines.
        return { graph: candidate.doc.typedDependencyGraph, references: candidate.doc.bindingAnalysis!.initializerReferences.map(r => r.resolution.kind) };
      };
      const actual = await check(cell.source);
      if (cell.control) expect(await check(cell.control)).toEqual(actual);
    }
    if (evidence) appendFileSync(evidence, JSON.stringify({ id: cell.id, status: "PASS", source: cell.source, expected: cell.expected, actual: actualValue, diagnostics: compiled.diagnostics.map(d => ({ code: d.code, line: d.line, column: d.column })) }) + "\n");
  }, 15_000);
});
