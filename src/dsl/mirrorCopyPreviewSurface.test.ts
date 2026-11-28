import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDslSnapshot,
  planDslRenameEdits,
  queryDslCompletion,
  queryDslDefinition,
  queryDslReferences,
  queryDslRenameTarget
} from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { referencePickCandidates } from "../model/referencePickCandidates";

const revision = 11;
const compile = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: revision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `mirror-preview:${index}`]))
  });
};
const snapshot = (source: string) => ({ normalizedSource: source, sourceRevision: revision });
const semantic = (source: string) => ({ sourceRevision: revision, sourceText: source, compiled: compile(source) });

describe("mirrorCopy preview language and pick boundaries", () => {
  it("keeps its owner out of geometry completion, Definition, References, Rename, and Reference Pick", () => {
    const validSource = [
      "nui 1",
      "line Base = segment(start: (2, 3), end: (7, 11))",
      "line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Base])"
    ].join("\n");
    const compiled = compile(validSource);
    const preview = compiled.document!.elements.find((element) => element.name === "Preview")!;
    const useStart = validSource.indexOf("baseLines: [") + "baseLines: [".length;
    const completion = queryDslCompletion({ source: snapshot(validSource), position: useStart, semantic: semantic(validSource) });

    expect(completion?.candidates.map((candidate) => candidate.label)).toContain("Base");
    expect(completion?.candidates.map((candidate) => candidate.label)).not.toContain("Preview");
    const evaluation = evaluateElements(
      compiled.document!.elements,
      buildEvaluationOptions({ compiledDocument: compiled as LastGoodDslDocument, evaluationLimitIndex: undefined })
    );
    const candidates = referencePickCandidates({ compiled, evaluation, target: null });
    expect(candidates.map((candidate) => candidate.elementId)).not.toContain(preview.id);
    expect(evaluation.mirrorCopyPreviews?.has(preview.id)).toBe(true);
    expect(evaluation.computedGeometry.has(preview.id)).toBe(false);

    const invalidSource = `${validSource}\nline Use = segment(start: Preview.start, end: (20, 0))`;
    const invalidCompiled = compile(invalidSource);
    const previewUse = invalidSource.indexOf("Preview.start", invalidSource.indexOf("line Use"));
    expect(invalidCompiled.diagnostics.some((diagnostic) => diagnostic.code === "mirror-copy-preview-not-referenceable")).toBe(true);
    expect(queryDslDefinition({ source: snapshot(invalidSource), position: previewUse + 1, semantic: semantic(invalidSource) })).toBeNull();
    expect(queryDslReferences({ source: snapshot(invalidSource), position: previewUse + 1, semantic: semantic(invalidSource) })).toBeNull();
    expect(queryDslRenameTarget({ source: snapshot(invalidSource), semantic: semantic(invalidSource) }, previewUse + 1)).toBeNull();
    expect(planDslRenameEdits({ source: snapshot(invalidSource), semantic: semantic(invalidSource) }, previewUse + 1, "Renamed")).toBeNull();
  });

  it("rejects a mirrorCopy group selector in ordinary path-list consumers", () => {
    const compiled = compile([
      "nui 1",
      "group Piece {",
      "  line Base = segment(start: (0, 0), end: (10, 0))",
      "}",
      "line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Piece])",
      "transformCopy Moved(startPoint: (0, 0), endPoint: (10, 0), parts: [moved: Piece])"
    ].join("\n"));

    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "mirror-copy-group-undefined")).toBe(false);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === "mirror-copy-preview-not-referenceable")).toBe(false);
    const ordinaryConsumerError = compiled.diagnostics.find((diagnostic) =>
      diagnostic.severity === "error" && diagnostic.line === 6
    );
    expect(ordinaryConsumerError).toBeDefined();
    expect(ordinaryConsumerError?.code?.startsWith("mirror-copy-group-")).toBe(false);
  });
});
