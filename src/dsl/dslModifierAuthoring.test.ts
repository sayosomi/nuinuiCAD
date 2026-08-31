import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslCompletion } from "./dslCompletionQuery";
import { queryDslDefinition } from "./dslDefinitionQuery";
import { planDslRenameEditsResult } from "./dslRenameQuery";
import { parseDslSnapshot } from "./dslParser";
import { createModifierAuthoringIndex } from "./dslModifierAuthoringIndex";

const source = [
  "nui 1",
  'modifier "Guide Line" {',
  "  state: visible,",
  "  width: 1.5px,",
  "  style: dotted,",
  "  color: accent,",
  "}",
  "profile Print",
  "point A = coordinate(x: 0, y: 0)",
  'line L ["Guide Line"] = segment(start: @A, end: @A)'
].join("\n");

const compiled = (text = source, revision = 1) => {
  const parsed = parseDslSnapshot({ normalizedSource: text, sourceRevision: revision });
  return compileDslDocument(text, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `modifier-test:${index}`]))
  });
};

const completion = (text: string, marker: string) => queryDslCompletion({
  source: { normalizedSource: text, sourceRevision: 1 },
  position: text.indexOf(marker) + marker.length,
  semantic: { sourceRevision: 1, compiled: compiled(text) }
});

const completionAt = (text: string, position: number) => queryDslCompletion({
  source: { normalizedSource: text, sourceRevision: 1 },
  position,
  semantic: { sourceRevision: 1, compiled: compiled(text) }
});

describe("modifier authoring semantics", () => {
  it("keeps exact parser-owned width/unit and color sub-token spans", () => {
    const result = compiled();
    const property = result.statements.find((statement) => statement.kind === "modifierProperty" && statement.property.key === "width");
    expect(property?.kind === "modifierProperty" ? property.property.authoringTokens : []).toEqual([
      { kind: "width", span: { start: 7, end: 10 } },
      { kind: "unit", span: { start: 10, end: 12 } }
    ]);
    const color = result.statements.find((statement) => statement.kind === "modifierProperty" && statement.property.key === "color");
    expect(color?.kind === "modifierProperty" ? color.property.authoringTokens?.[0]?.kind : null).toBe("themeRole");
    expect(createModifierAuthoringIndex(result).properties.find((property) => property.key === "width")?.tokens).toEqual([
      { kind: "width", range: { from: source.indexOf("1.5px"), to: source.indexOf("1.5px") + 3 } },
      { kind: "unit", range: { from: source.indexOf("1.5px") + 3, to: source.indexOf("1.5px") + 5 } }
    ]);
  });

  it("provides modifier reference, partial property, and value completion from shared metadata", () => {
    const referenceSource = source.replace('"Guide Line"]', 'Gui]');
    const reference = completionAt(referenceSource, referenceSource.lastIndexOf("Gui") + 3);
    expect(reference?.category).toBe("modifierReference");
    expect(reference?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Guide Line", sourceText: '"Guide Line"' })
    ]));

    const propertySource = source.replace("  style: dotted,", "  str");
    const property = completion(propertySource, "str");
    expect(property?.category).toBe("modifierProperty");
    expect(property?.candidates.map((candidate) => candidate.label)).toContain("style");
    expect(property?.candidates.map((candidate) => candidate.label)).not.toContain("state");

    const valueSource = source.replace("style: dotted", "style: d");
    const value = completion(valueSource, "style: d");
    expect(value?.category).toBe("modifierValue");
    expect(value?.candidates.map((candidate) => candidate.label)).toEqual(["solid", "dashed", "dotted"]);

    const profileSource = source.replace("  color: accent,", "  for @Pri");
    const profile = completion(profileSource, "Pri");
    expect(profile?.category).toBe("modifierProfile");
    expect(profile?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Print", sourceText: "Print" })
    ]));

    const fixedColor = completion(source.replace("color: accent", "color: #ff"), "#ff");
    expect(fixedColor).toBeNull();
  });

  it("navigates and renames only exact document-global modifier semantics", () => {
    const result = compiled();
    const reference = source.lastIndexOf('"Guide Line"');
    const definition = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 1 },
      position: reference + 2,
      semantic: { sourceRevision: 1, compiled: result }
    });
    expect(source.slice(definition!.declarationRange.from, definition!.declarationRange.to)).toBe('"Guide Line"');

    const renamed = planDslRenameEditsResult({
      source: { normalizedSource: source, sourceRevision: 1 },
      semantic: { sourceRevision: 1, compiled: result }
    }, reference + 2, "Guide");
    expect(renamed.status).toBe("ok");
    expect(renamed.status === "ok" && renamed.plan.edits.map((edit) => edit.newText)).toEqual(["Guide", "Guide"]);
  });
});
