import { describe, expect, it } from "vitest";
import {
  compileDslDocument, parseDslSnapshot, queryDslReferencePickTarget,
  createNuiLanguageSession, queryDslCompletion, queryDslTypoSuggestions,
  serializeDocumentToDsl
} from "@nuinuicad/nui-language";
import { sourceCreationTemplatePlanForLegacyCommand } from "../commands/sourceCreationTemplatePlan";
import { materializeSourceCreationTemplate } from "../commands/sourceCreationTemplateMaterializer";
import { referencePickReplacementText } from "../vscode/referencePickProtocol";
import { evaluateElements } from "../geometry/evaluate";

const base = "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\n";
const errors = (text: string) => compileDslDocument(text).diagnostics.filter((d) => d.severity === "error");
const compileCurrent = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, i) => [i, `at-test:${i}`]))
  });
};
const operations = [
  ["edge", "[@A.end, @B.start]", "index: 0", "addEdge", "endpoint", "multiple"],
  ["extend", "@A.end", "to: (15, 0)", "addExtendTrim", "endpoint", "single"],
  ["move", "[@A, @B]", "from: (0, 0), to: (1, 0)", "addMove", "geometry", "multiple"],
  ["mirrorMove", "[@A, @B]", "axis1: (0, 0), axis2: (0, 1)", "addSymmetricMove", "geometry", "multiple"],
  ["reverse", "@A", "", "reverseSelectedPath", "geometry", "single"]
] as const;
const twoLines = base + "line B = segment(start: (10, -10), end: (10, 10))\n";

describe("mandatory transformation target @ cutover", () => {
  it("accepts @ targets and rejects bare targets", () => {
    expect(errors(`${base}reverse A()`)).not.toEqual([]);
    expect(errors(`${base}reverse @A()`)).toEqual([]);
    expect(errors(`${base}reverse A()`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "malformed-transformation-target" })
    ]));
  });

  it.each(operations)("round-trips %s without final-value dependencies", (operation, targets, args) => {
    const source = `${twoLines}${operation} ${targets}(${args})`;
    const compiled = compileCurrent(source);
    expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(compiled.transformationRecipes?.[0]?.targets.every((target) => target.source.startsWith("@"))).toBe(true);
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain(`${operation} ${targets} (`);
    expect(errors(serialized)).toEqual([]);
    expect(evaluateElements(compiled.document!.elements, {
      transformationRecipes: compiled.runtimeTransformationRecipes ?? compiled.transformationRecipes
    }).errors).toEqual([]);
    expect(errors(`${twoLines}${operation} ${targets.replaceAll("@", "")}(${args})`))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "malformed-transformation-target" })]));
    expect(errors(`${twoLines}${operation}(${args})`))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "malformed-transformation-target" })]));
  });

  it.each(operations)("picks completed and unfinished %s headers with the operation's type/count", (operation, targets, args, _command, role, multiplicity) => {
    for (const header of [targets, "", "@", "[@A, ]", "[@A, @]", "[@A, ", "[@A, @"]) {
      const source = `${twoLines}${operation} ${header}(${args}) // comment`;
      const start = twoLines.length + operation.length + 1;
      const compiled = compileCurrent(source);
      const position = start + (header.startsWith("[") ? header.indexOf(",") + 2 : header.length);
      const result = queryDslReferencePickTarget({
        source: { normalizedSource: source, sourceRevision: 1 }, position,
        semantic: { sourceRevision: 1, sourceText: source, compiled }
      });
      expect(result, `${operation} ${header}`).toMatchObject({ role, multiplicity, syntax: "transformationTarget" });
      expect(source.slice(result!.range.from, result!.range.to)).toBe(header.trimEnd());
      const replacement = referencePickReplacementText(multiplicity, role === "endpoint"
        ? operation === "edge" ? [{ base: "A", pointKey: "end" }, { base: "B", pointKey: "start" }] : [{ base: "A", pointKey: "end" }]
        : [{ base: "A" }])!;
      const edited = source.slice(0, result!.range.from) + replacement + source.slice(result!.range.to);
      expect(edited).toContain(`(${args}) // comment`);
      expect(errors(edited)).toEqual([]);
      expect(queryDslReferencePickTarget({
        source: { normalizedSource: source, sourceRevision: 2 }, position,
        semantic: { sourceRevision: 1, sourceText: source, compiled }
      })).toBeNull();
    }
  });

  it.each(operations)("fills the %s production template into compilable current source", (operation, targets, _args, command) => {
    const materialization = materializeSourceCreationTemplate(sourceCreationTemplatePlanForLegacyCommand(command)!, 0)!;
    const source = materialization.parts.map((part) => {
      if (part.kind === "text") return part.text;
      if (part.hole.role === "target") return targets;
      if (part.hole.role === "name") throw new Error("transformation has no name hole");
      return part.hole.kind === "number" ? "1" : "(0, 0)";
    }).join("");
    expect(source).toMatch(new RegExp(`^${operation} `));
    expect(source).not.toMatch(/\b(?:targets|target|end1|end2|end):/);
    expect(errors(twoLines + source)).toEqual([]);
  });

  it("rejects mixed lists and reports an unresolved owner at its exact source range", () => {
    expect(errors(`${twoLines}move [@A, B](from: (0, 0), to: (1, 0))`))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "malformed-transformation-target" })]));
    const source = `${base}reverse @Missing()`;
    const diagnostic = compileCurrent(source).diagnostics.find((d) => d.code === "unresolved-transformation-target")!;
    const segment = diagnostic.physicalSpan!.segments[0]!;
    expect(source.slice(segment.from, segment.to)).toBe("Missing");
  });

  it("shares canonical owner identity across target hover, navigation, references and rename", () => {
    const source = `${base}reverse @A()\nreverse @A()`;
    const session = createNuiLanguageSession(source);
    const offset = source.lastIndexOf("@A") + 1;
    expect(session.transformationHover(offset)?.kind).toBe("transformationTarget");
    expect(session.definition(offset)?.declarationRange).toBeDefined();
    expect(session.references(offset)?.referenceRanges).toHaveLength(2);
    const renamed = session.rename(offset, "Outline");
    expect(renamed.status).toBe("ok");
    if (renamed.status !== "ok") return;
    let edited = source;
    for (const edit of [...renamed.plan.edits].sort((a, b) => b.from - a.from)) {
      edited = edited.slice(0, edit.from) + edit.newText + edited.slice(edit.to);
    }
    expect(edited).toContain("reverse @Outline()");
    expect(edited).toContain("reverse @Outline()");
    expect(errors(edited)).toEqual([]);
  });

  it.each(["reverse ", "reverse @", "move [@A, @", "move [@A, "])("completes %s with exactly one @", (header) => {
    const source = base + header;
    const compiled = compileCurrent(source);
    const result = queryDslCompletion({ source: { normalizedSource: source, sourceRevision: 1 }, position: source.length,
      semantic: { sourceRevision: 1, compiled } })!;
    const candidate = result.candidates.find((c) => c.label === "A")!;
    expect(candidate).toBeDefined();
    const edited = source.slice(0, result.replacementRange.from) + candidate.sourceText + source.slice(result.replacementRange.to);
    expect(edited.endsWith("@A")).toBe(true);
    expect(edited).not.toContain("@@");
  });

  it("offers a source-preserving owner typo fix without rewriting bare legacy source", () => {
    const source = `${base}reverse @a()`;
    const compiled = compileCurrent(source);
    const diagnostic = compiled.diagnostics.find((d) => d.code === "unresolved-transformation-target")!;
    const result = queryDslTypoSuggestions({ source: { normalizedSource: source, sourceRevision: 1 }, diagnostic,
      semantic: { sourceRevision: 1, sourceText: source, compiled } });
    expect(result?.candidates.map((c) => c.label)).toContain("A");
    const legacy = compileCurrent(`${base}reverse A()`);
    expect(legacy.diagnostics.some((d) => d.code === "unresolved-transformation-target")).toBe(false);
  });

  it("completes indexed owners without offering stage selectors", () => {
    const source = "nui 1\nfor i in range(min: 0, max: 1, step: 1) {\nline Mark = segment(start: (0, 0), end: (10, 0))\nmove @Mark(from: (0, 0), to: (1, 0))\nreverse @Mark[1].\n}";
    const compiled = compileCurrent(source);
    const result = queryDslCompletion({ source: { normalizedSource: source, sourceRevision: 1 }, position: source.indexOf("@Mark[1].") + "@Mark[1].".length,
      semantic: { sourceRevision: 1, compiled } });
    expect(result?.candidates.map((c) => c.label)).toEqual(["Mark[1]"]);
    expect(result?.candidates.some(candidate => /base|shifted|\$prefix/.test(candidate.label))).toBe(false);
    expect(result?.candidates.some((c) => c.label.includes("final"))).toBe(false);
  });

  it.each(["reverse", "extend"])("keeps qualified %s completion on drawable path owners", (operation) => {
    const prefix = "nui 1\nmodule M() {\nexport point P = coordinate(x: 0, y: 0)\nexport line L = segment(start: (0, 0), end: (10, 0))\nexport const amount: number = 1\n}\ninstance front = M()\n";
    const source = prefix + `${operation} @front::`;
    const compiled = compileCurrent(source);
    const result = queryDslCompletion({ source: { normalizedSource: source, sourceRevision: 1 }, position: source.length,
      semantic: { sourceRevision: 1, compiled } });
    expect(result?.candidates.map((c) => c.label)).toEqual(operation === "extend" ? ["L.start", "L.end"] : ["L"]);
  });

  it("keeps quoted Unicode owner ranges and comments through target rename", () => {
    const source = "nui 1\nline \"肩線, 前\" = segment(start: (0, 0), end: (10, 0))\nreverse @\"肩線, 前\"() // keep";
    expect(errors(source)).toEqual([]);
    const session = createNuiLanguageSession(source);
    const result = session.rename(source.lastIndexOf("肩線") + 1, "脇線");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    let edited = source;
    for (const edit of [...result.plan.edits].sort((a, b) => b.from - a.from)) edited = edited.slice(0, edit.from) + edit.newText + edited.slice(edit.to);
    expect(edited).toContain("reverse @脇線() // keep");
    expect(errors(edited)).toEqual([]);
  });

  it("writes @ on Canvas target replacements", () => {
    expect(referencePickReplacementText("single", [{ base: "A" }])).toBe("@A");
  });

  it("materializes a declarative target hole", () => {
    const plan = sourceCreationTemplatePlanForLegacyCommand("addExtendTrim")!;
    const parts = materializeSourceCreationTemplate(plan, 0)!.parts;
    expect(parts[0]).toEqual({ kind: "text", text: "extend " });
    expect(parts[1]).toMatchObject({ kind: "hole", hole: { role: "target" } });
  });

  it.each(["reverse |()", "reverse @|()", "move [@A, |](from: (0, 0), to: (1, 0))"])(
    "picks an incomplete header: %s", (marked) => {
      const source = base + marked.replace("|", "");
      const position = base.length + marked.indexOf("|");
      const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 1 });
      const compiled = compileDslDocument(source, {
        preparsed: parsed,
        assignedStatementIds: new Map(parsed.statements.map((_, i) => [i, `at-test:${i}`]))
      });
      expect(queryDslReferencePickTarget({
        source: { normalizedSource: source, sourceRevision: 1 }, position,
        semantic: { sourceRevision: 1, sourceText: source, compiled }
      })).toMatchObject({ syntax: "transformationTarget", role: "geometry" });
    }
  );
});
