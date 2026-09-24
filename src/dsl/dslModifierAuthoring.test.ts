import { describe, expect, it } from "vitest";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { queryDslCompletion } from "@nuinuicad/nui-language";
import { queryDslDefinition } from "@nuinuicad/nui-language";
import { planDslRenameEditsResult } from "@nuinuicad/nui-language";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import { createModifierAuthoringIndex } from "@nuinuicad/nui-language";
import {
  parseModifierColorValue,
  parseModifierFillOpacityValue,
  parseModifierFillValue,
  parseModifierLineTypeValue,
  parseModifierVisibleValue,
  parseModifierWidthValue,
  resolveModifierValueStep
} from "@nuinuicad/nui-language";

const source = [
  "nui 1",
  'style "Guide Line" {',
  "  ",
  "  width: 1.5px,",
  "  lineType: dotted,",
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

describe("style authoring semantics", () => {
  it("attaches stable codes to producer-owned invalid modifier values", () => {
    expect(parseModifierWidthValue("0px")).toEqual({
      message: "style の width は正の有限な10進数pxリテラルで指定してください(例: 1.5px)。",
      code: "style-width-invalid"
    });
    expect(parseModifierLineTypeValue("stripe")).toEqual({
      message: "style の lineType は solid / dashed / dotted のいずれかで指定してください。",
      code: "style-line-type-invalid"
    });
    expect(parseModifierVisibleValue("maybe")).toEqual({
      message: "style の visible は true / false のいずれかで指定してください。",
      code: "style-visible-invalid"
    });
    expect(parseModifierColorValue("#12")).toEqual({
      message: "style の color 固定色は #RRGGBB の形式で指定してください。",
      code: "style-color-fixed-invalid"
    });
    expect(parseModifierColorValue("brand")).toEqual({
      message: "style の color は foreground / muted / accent / info / warning / error または #RRGGBB で指定してください。",
      code: "style-color-invalid"
    });
    expect(parseModifierFillValue("brand")).toEqual({
      message: "style の fill は foreground / muted / accent / info / warning / error、#RRGGBB、または none で指定してください。",
      code: "style-fill-invalid"
    });
    expect(parseModifierFillOpacityValue("wat")).toEqual({
      message: "style の fillOpacity は有限な数値で指定してください。",
      code: "style-fill-opacity-invalid-number"
    });
    expect(parseModifierFillOpacityValue("1.1")).toEqual({
      message: "style の fillOpacity は 0 以上 1 以下で指定してください。",
      code: "style-fill-opacity-out-of-range"
    });
    expect(resolveModifierValueStep("width", "width", "1.5", 1)).toEqual({ insert: "1.6" });
    expect(resolveModifierValueStep("fillOpacity", "value", "0.5", 1)).toEqual({ insert: "0.6" });
  });

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

  it("provides style reference, partial property, and value completion from shared metadata", () => {
    const referenceSource = source.replace('"Guide Line"]', 'Gui]');
    const reference = completionAt(referenceSource, referenceSource.lastIndexOf("Gui") + 3);
    expect(reference?.category).toBe("modifierReference");
    expect(reference?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Guide Line", sourceText: '"Guide Line"' })
    ]));

    const propertySource = source.replace("  lineType: dotted,", "  str");
    const property = completion(propertySource, "str");
    expect(property?.category).toBe("modifierProperty");
    expect(property?.candidates.map((candidate) => candidate.label)).toContain("lineType");
    expect(property?.candidates.map((candidate) => candidate.label)).toEqual(expect.arrayContaining(["fill", "fillOpacity"]));
    expect(property?.candidates.map((candidate) => candidate.label)).not.toContain("state");

    const valueSource = source.replace("lineType: dotted", "lineType: d");
    const value = completion(valueSource, "lineType: d");
    expect(value?.category).toBe("modifierValue");
    expect(value?.candidates.map((candidate) => candidate.label)).toEqual(["solid", "dashed", "dotted"]);

    const fillValue = completion(source.replace("  color: accent,", "  fill: a,"), "fill: a");
    expect(fillValue?.category).toBe("modifierValue");
    expect(fillValue?.candidates.map((candidate) => candidate.label)).toEqual([
      "foreground", "muted", "accent", "info", "warning", "error", "none"
    ]);
    const colorValue = completion(source.replace("  color: accent,", "  color: n"), "color: n");
    expect(colorValue?.candidates.map((candidate) => candidate.label)).not.toContain("none");

    const fillOpacityValue = completion(source.replace("  color: accent,", "  fillOpacity: 0."), "fillOpacity: 0.");
    expect(fillOpacityValue?.category).toBe("modifierValue");
    expect(fillOpacityValue?.candidates.map((candidate) => candidate.label)).toEqual(["0", "0.25", "0.5", "0.75", "1"]);

    const profileSource = source.replace("  color: accent,", "  for @Pri");
    const profile = completion(profileSource, "Pri");
    expect(profile?.category).toBe("modifierProfile");
    expect(profile?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Print", sourceText: "Print" })
    ]));

    const fixedColor = completion(source.replace("color: accent", "color: #ff"), "#ff");
    expect(fixedColor).toBeNull();
  });

  it("navigates and renames only exact document-global style semantics", () => {
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
