import { describe, expect, it } from "vitest";
import { createNuiLanguageSession } from "@nuinuicad/nui-language";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslCompletion } from "./dslCompletionQuery";
import { queryDslTypoSuggestions } from "./dslTypoSuggestionQuery";
import { queryDslReferencePickTarget } from "./dslReferencePickQuery";
import { referencePickSourceForReference } from "../vscode/referencePickProtocol";
import { evaluateElements } from "../geometry/evaluate";

const compile = (source: string) => {
  const sourceRevision = 41;
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `recipe-language:${index}`]))
  });
  return { sourceRevision, compiled };
};

describe("declarative transformation language integration", () => {
  it("keeps target completion bare while ordinary reference completion remains @-based", () => {
    const targetSource = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "reverse "
    ].join("\n");
    const target = compile(targetSource);
    const targetResult = queryDslCompletion({
      source: { normalizedSource: targetSource, sourceRevision: target.sourceRevision },
      position: targetSource.length,
      semantic: { sourceRevision: target.sourceRevision, compiled: target.compiled }
    });
    expect(targetResult?.category).toBe("transformationTarget");
    expect(targetResult?.candidates.find((candidate) => candidate.label === "A")).toMatchObject({
      sourceText: "A"
    });

    const referenceSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @"
    ].join("\n");
    const reference = compile(referenceSource);
    const referenceResult = queryDslCompletion({
      source: { normalizedSource: referenceSource, sourceRevision: reference.sourceRevision },
      position: referenceSource.length,
      semantic: { sourceRevision: reference.sourceRevision, compiled: reference.compiled }
    });
    expect(referenceResult?.candidates.find((candidate) => candidate.label === "A")).toMatchObject({
      kind: "geometry"
    });
    expect(referenceResult?.candidates.find((candidate) => candidate.label === "A")?.sourceText).toBeUndefined();
  });

  it("uses the Module export candidate authority for qualified target completion", () => {
    const source = [
      "nui 1",
      "module Dress() {",
      "  export line outline = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance front = Dress()",
      "reverse front::outline ()"
    ].join("\n");
    const { sourceRevision, compiled } = compile(source);
    const position = source.lastIndexOf("front::") + "front::".length;
    const result = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision },
      position,
      semantic: { sourceRevision, compiled }
    });
    expect(result?.context).toMatchObject({ kind: "moduleQualifiedMember", targetSyntax: true });
    expect(result?.candidates.find((candidate) => candidate.label === "outline")).toMatchObject({ kind: "geometry" });
  });

  it("offers as/stage intelligence, shared typo candidates, and exact stage navigation", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as shifted (from: (0, 0), to: (5, 0))",
      "reverse A "
    ].join("\n");
    const { sourceRevision, compiled } = compile(source);
    const asPosition = source.length;
    const asResult = queryDslCompletion({
      source: { normalizedSource: source, sourceRevision },
      position: asPosition,
      semantic: { sourceRevision, compiled }
    });
    expect(asResult?.category).toBe("transformationAs");
    expect(asResult?.candidates.map((candidate) => candidate.label)).toContain("as");

    const stageReferenceSource = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as shifted (from: (0, 0), to: (5, 0))",
      "move A (from: @A., to: (1, 0))"
    ].join("\n");
    const stageReference = compile(stageReferenceSource);
    const stageReferenceResult = queryDslCompletion({
      source: { normalizedSource: stageReferenceSource, sourceRevision: stageReference.sourceRevision },
      position: stageReferenceSource.indexOf("@A.") + "@A.".length,
      semantic: { sourceRevision: stageReference.sourceRevision, compiled: stageReference.compiled }
    });
    expect(stageReferenceResult?.category).toBe("transformationStageReference");
    expect(stageReferenceResult?.candidates.map((candidate) => candidate.label)).toContain("shifted");

    const typoSource = source.replace("reverse A ", "reverse A.shiftd ()");
    const typo = compile(typoSource);
    const diagnostic = typo.compiled.diagnostics.find((candidate) => candidate.code === "unresolved-transformation-stage");
    expect(diagnostic).toBeDefined();
    const typoResult = queryDslTypoSuggestions({
      source: { normalizedSource: typoSource, sourceRevision: typo.sourceRevision },
      diagnostic: diagnostic!,
      semantic: { sourceRevision: typo.sourceRevision, sourceText: typoSource, compiled: typo.compiled }
    });
    expect(typoResult?.candidates.map((candidate) => candidate.label)).toContain("shifted");

    const sessionSource = source.replace("reverse A ", "reverse A.shifted ()");
    const session = createNuiLanguageSession(sessionSource);
    const stageOffset = sessionSource.lastIndexOf("shifted") + 2;
    expect(session.transformationHover(stageOffset)?.kind).toBe("transformationStage");
    expect(session.definition(stageOffset)?.declarationRange).toBeDefined();
    expect(session.references(stageOffset)?.referenceRanges).toHaveLength(1);
  });

  it("uses the shared Pick lifecycle with a bare target replacement", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "reverse A ()"
    ].join("\n");
    const { sourceRevision, compiled } = compile(source);
    const position = source.lastIndexOf("A") + 1;
    const target = queryDslReferencePickTarget({
      source: { normalizedSource: source, sourceRevision },
      position,
      semantic: { sourceRevision, sourceText: source, compiled }
    });
    expect(target?.syntax).toBe("transformationTarget");
    expect(referencePickSourceForReference({ base: "B" }, target?.syntax ?? "reference")).toBe("B");
    expect(referencePickSourceForReference({ base: "B" }, "reference")).toBe("@B");
  });

  it("lowers module recipes per instance and keeps stages instance-local", () => {
    const source = [
      "nui 1",
      "module Dress() {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  move A as shifted (from: (0, 0), to: (5, 0))",
      "  reverse A.shifted ()",
      "}",
      "instance one = Dress()",
      "instance two = Dress()"
    ].join("\n");
    const { compiled } = compile(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.transformationRecipes?.filter((recipe) => recipe.stageName === "shifted")).toHaveLength(1);
    expect(compiled.runtimeTransformationRecipes?.filter((recipe) => recipe.stageName === "shifted")).toHaveLength(2);

    const evaluation = evaluateElements(compiled.document!.elements, {
      transformationRecipes: compiled.runtimeTransformationRecipes,
      sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
    });
    expect(evaluation.errors).toEqual([]);
    expect([...evaluation.transformationStageGeometry!.keys()].filter((key) => key.endsWith("shifted"))).toHaveLength(2);
    const session = createNuiLanguageSession(source);
    const targetOffset = source.indexOf("move A") + "move ".length + 1;
    expect(session.transformationHover(targetOffset)?.kind).toBe("transformationTarget");
  });

  it("resolves module-qualified transformation targets through materialized exports", () => {
    const source = [
      "nui 1",
      "module Dress() {",
      "  export line outline = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance front = Dress()",
      "reverse front::outline as reversed ()"
    ].join("\n");
    const { compiled } = compile(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.transformationRecipes?.find((recipe) => recipe.stageName === "reversed")).toMatchObject({
      targets: [{ ownerId: "recipe-language:2" }]
    });
    expect(compiled.runtimeTransformationRecipes?.find((recipe) => recipe.stageName === "reversed")?.targets[0].ownerId)
      .not.toBe("recipe-language:2");

    const evaluation = evaluateElements(compiled.document!.elements, {
      transformationRecipes: compiled.runtimeTransformationRecipes,
      sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
    });
    expect(evaluation.errors).toEqual([]);
    expect([...evaluation.transformationStageGeometry!.keys()].some((key) => key.endsWith("reversed"))).toBe(true);
  });

  it("navigates module-qualified targets and their immutable stages", () => {
    const source = [
      "nui 1",
      "module Dress() {",
      "  export line outline = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance front = Dress()",
      "reverse front::outline as reversed ()",
      "reverse front::outline.reversed ()"
    ].join("\n");
    const session = createNuiLanguageSession(source);
    const targetOffset = source.indexOf("front::outline") + "front::".length + 2;
    expect(session.transformationHover(targetOffset)?.kind).toBe("transformationTarget");
    const stageOffset = source.lastIndexOf("reversed") + 2;
    expect(session.transformationHover(stageOffset)?.kind).toBe("transformationStage");
    expect(session.definition(stageOffset)?.declarationRange).toBeDefined();
    expect(session.references(stageOffset)?.referenceRanges).toHaveLength(1);
  });

  it("renames module-local stages with statement edits only", () => {
    const source = [
      "nui 1",
      "// keep this comment",
      "",
      "module Dress() {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "  move A as shifted (from: (0, 0), to: (5, 0))",
      "  reverse A.shifted ()",
      "}",
      "instance dress = Dress()"
    ].join("\n");
    const session = createNuiLanguageSession(source);
    const result = session.rename(source.lastIndexOf("shifted") + 2, "moved");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.edits).toHaveLength(2);
    let edited = source;
    for (const edit of [...result.plan.edits].sort((left, right) => right.from - left.from)) {
      edited = `${edited.slice(0, edit.from)}${edit.newText}${edited.slice(edit.to)}`;
    }
    expect(edited).toContain("// keep this comment\n\nmodule Dress");
    expect(edited).toContain("move A as moved");
    expect(edited).toContain("reverse A.moved ()");
  });
});
