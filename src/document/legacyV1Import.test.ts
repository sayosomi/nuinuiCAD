import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "../dsl/dslDocument";
import { comparableLayouts, normalizeForComparison } from "../dsl/dslDocumentTestUtils";
import sampleV1 from "../dsl/__fixtures__/sample.v1.nui?raw";
import { parseLegacyV1Document } from "./legacyDsl/parseLegacyV1Document";
import { importLegacyV1Document } from "./legacyV1Import";

describe("importLegacyV1Document", () => {
  it("converts the frozen v1 sample to valid, canonical v2 text without changing document semantics", () => {
    const legacy = parseLegacyV1Document(sampleV1);
    const result = importLegacyV1Document(sampleV1);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const converted = compileDslDocument(result.sourceText);

    expect(result.sourceText.startsWith("nui 2\n")).toBe(true);
    expect(converted.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(converted.document).not.toBeNull();
    expect(normalizeForComparison(converted.document!.elements)).toEqual(normalizeForComparison(legacy.elements));
    expect(converted.document).toMatchObject({
      palette: legacy.palette,
      visibilityRoles: legacy.visibilityRoles,
      visibilityProfiles: legacy.visibilityProfiles,
      activeVisibilityProfileId: legacy.activeVisibilityProfileId,
      activePrintLayoutId: legacy.activePrintLayoutId,
      evaluationLimitIndex: legacy.evaluationLimitIndex
    });
    const legacyLayouts = comparableLayouts(legacy.printLayouts, legacy.elements);
    expect(legacyLayouts).toEqual([expect.objectContaining({
      numericVariables: [{ name: "margin", value: 15 }],
      placements: [{
        x: 0,
        y: { kind: "expression", expression: "margin" },
        angleDeg: 0,
        mirrorX: false,
        groupId: 1
      }]
    })]);
    expect(comparableLayouts(converted.document!.printLayouts, converted.document!.elements)).toEqual(legacyLayouts);
    expect(serializeDocumentToDsl(converted.document!)).toBe(result.sourceText);
  });

  it("rejects invalid v1 source instead of returning a partial v2 document", () => {
    const result = importLegacyV1Document("nui 1\npoint Broken = (");

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain("変換できません");
  });
});
