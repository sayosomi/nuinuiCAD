import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCadElement } from "../model/elementFactory";
import { createElementNameContext } from "../model/elementNames";
import { referenceAnchor } from "../model/pointAnchors";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import type { CadElement, VariableValueMode } from "../types/geometry";
import { applyArgs, createDefaultIntermediateId, type DslApplyArgsResolvers } from "./dslApplyArgs";
import { parseDslCallStatement } from "./dslCallParser";
import { constructionFor } from "./dslConstructions";
import { comparableLayouts, normalizeForComparison } from "./dslDocumentTestUtils";
import { parseLegacyV1Document } from "../document/legacyDsl/parseLegacyV1Document";
import { createNameIndex } from "./dslReferences";
import { documentDslRefs } from "./dslSerializer";
import { serializeElementStatementLogical } from "./dslSerializeElement";
import { parseDslSettingsStatement } from "./dslSettingsParser";
import { applyDslV2PrintLayout, applyDslV2Setting, emptyDslV2Settings, serializeDslV2Settings } from "./dslV2Settings";
import { compileDslV2RoundTripDocument } from "./dslV2RoundTripHarness";
import { v2CanonicalElementStatements, v2CanonicalSettingStatements, type V2CanonicalElementStatement } from "./__fixtures__/v2CanonicalStatements";
import sampleV1 from "./__fixtures__/sample.v1.nui?raw";
import sampleV2 from "./__fixtures__/sample.v2.nui?raw";

const refs: CadElement[] = [
  { id: "A", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "B", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
  { id: "C", name: "C", type: "freePoint", visible: true, enabled: true, x: 20, y: 0 },
  { id: "AB", name: "AB", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("A"), endPoint: referenceAnchor("B") },
  { id: "CD", name: "CD", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("B"), endPoint: referenceAnchor("C") },
];

const variableModeFor = (construction: string): VariableValueMode | null =>
  construction === "expression" || construction === "pointDistance" || construction === "pointAngle" || construction === "pointLineDistance"
    ? construction
    : null;
const isContainer = (element: CadElement) => element.type === "group" || element.type === "conditionalGroup" || element.type === "forGroup";
const sampleValue = (kind: ReturnType<typeof getParameterDefinitions>[number]["kind"]) => ({ number: 12, boolean: true, reference: referenceAnchor("A"), lineEndpointReference: { lineId: "AB", endpointKey: "end" }, lineReference: "AB", lineReferenceList: ["AB", "CD"], text: "populated", choice: "left", color: "red" }[kind]);

const elementFor = (fixture: V2CanonicalElementStatement, populated: boolean) => {
  let element = createCadElement(fixture.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
  const variableMode = variableModeFor(fixture.construction);
  if (element.type === "variable" && variableMode) element = { ...element, valueMode: variableMode };
  element = { ...element, name: `${fixture.elementType}-${fixture.elementType === "variable" ? fixture.construction : "default"}-${populated ? "pop" : "min"}` };
  if (!populated) return element;
  element = { ...element, visible: false, enabled: false, colorId: "red", numericParameterSteps: { x: 0.5 }, numericVariables: [{ id: "width", name: "width", value: 8 }] };
  for (const definition of getParameterDefinitions(element).filter((item) => item.key !== "placementMode" && !item.key.startsWith("variable:"))) element = setParameterValue(element, definition.key, sampleValue(definition.kind));
  if (element.type === "group") element = { ...element, visibilityRoleIds: ["seam"] };
  if (element.type === "bezierCurve") element = { ...element, intermediatePoints: [{ id: "mid", point: referenceAnchor("C"), handleAngleDeg: 45, incomingHandleLength: 20, outgoingHandleLength: 25 }] };
  return element;
};

const resolvers = (elements: CadElement[]): DslApplyArgsResolvers => ({
  index: createNameIndex([...refs, ...elements]), line: 1, elementsForExpressions: [...refs, ...elements],
  nameContext: createElementNameContext([...refs, ...elements]), visibilityRoles: [{ id: "seam", name: "縫い代" }], createIntermediateId: createDefaultIntermediateId,
});

const roundTrip = (element: CadElement, expected: string) => {
  expect(serializeElementStatementLogical(element, documentDslRefs([...refs, element]))).toBe(expected);
  const parsed = parseDslCallStatement(expected, { opensBlock: isContainer(element) });
  expect(parsed.diagnostics).toEqual([]);
  const spec = constructionFor(parsed.statement!.category, parsed.statement!.construction)!;
  const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
  const variableMode = variableModeFor(spec.construction);
  const prepared = base.type === "variable" && variableMode
    ? { ...base, name: parsed.statement!.name, valueMode: variableMode }
    : { ...base, name: parsed.statement!.name };
  const applied = applyArgs(prepared, spec, parsed.statement!.args, resolvers([]));
  expect(applied.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(serializeElementStatementLogical(applied.element, documentDslRefs([...refs, applied.element]))).toBe(expected);
  return applied.element;
};

describe("DSL v2 P7 round-trip and golden fixtures", () => {
  it("stores and matches full P5 canonical statements for all element constructions", () => {
    expect(v2CanonicalElementStatements).toHaveLength(30);
    for (const fixture of v2CanonicalElementStatements) {
      for (const populated of [false, true]) {
        const element = elementFor(fixture, populated);
        const expected = populated ? fixture.populated : fixture.minimal;
        const applied = roundTrip(element, expected);
        expect(applied.type).toBe(fixture.elementType);
      }
    }
  });

  it("keeps all four variable constructions in the P3 → P6 → P5 fixed-point matrix", () => {
    expect(v2CanonicalElementStatements.filter((fixture) => fixture.elementType === "variable").map((fixture) => fixture.construction))
      .toEqual(["expression", "pointDistance", "pointAngle", "pointLineDistance"]);
  });

  it("keeps canonical P5 output stable under repeated parse/apply/serialize", () => {
    fc.assert(fc.property(fc.constantFrom(...v2CanonicalElementStatements), fc.boolean(), (fixture, populated) => {
      const expected = populated ? fixture.populated : fixture.minimal;
      expect(serializeElementStatementLogical(roundTrip(elementFor(fixture, populated), expected), documentDslRefs([...refs, elementFor(fixture, populated)])).replace(/^[^=]*= /, ""))
        .toBe(expected.replace(/^[^=]*= /, ""));
    }), { numRuns: 60 });
  });

  it("round-trips P4 settings through the smallest P7-only helper", () => {
    const parse = (line: string, opensBlock = false) => {
      const result = parseDslSettingsStatement(line, { opensBlock }); expect(result.diagnostics).toEqual([]); return result.statement!;
    };
    let settings = emptyDslV2Settings();
    for (const line of v2CanonicalSettingStatements.slice(1, 5)) settings = applyDslV2Setting(settings, parse(line));
    settings = applyDslV2Setting(settings, parse("view 印刷 (default: true seam: true)"));
    settings = applyDslV2PrintLayout(settings, parse(v2CanonicalSettingStatements[5], true), [parse(v2CanonicalSettingStatements[6]), parse(v2CanonicalSettingStatements[7])], [{ id: "group", name: "前身頃", type: "group", visible: true, enabled: true, printEnabled: false, printAnchor: { mode: "coordinate", x: 0, y: 0 } }]);
    settings = applyDslV2Setting(settings, parse(v2CanonicalSettingStatements[8]));
    const serialized = serializeDslV2Settings(settings, [{ id: "group", name: "前身頃", type: "group", visible: true, enabled: true, printEnabled: false, printAnchor: { mode: "coordinate", x: 0, y: 0 } }]);
    expect(serialized).toContain("nui 2");
    expect(serialized.join("\n")).toContain("printLayout A4");
  });

  it("matches the v1 sample's elements, settings, print members, active selections, and @stop", () => {
    // C1: live dslCompiler は v2 専用になったため、v1 側は W5 の凍結 parser
    // facade(src/document/legacyDsl/)経由で読む(旧 compileDslToElements
    // 直呼びはもう v1 テキストを受理しない)。
    const v1 = parseLegacyV1Document(sampleV1);
    const v2 = compileDslV2RoundTripDocument(sampleV2);
    expect(normalizeForComparison(v2.elements)).toEqual(normalizeForComparison(v1.elements));
    expect(v2.palette).toEqual(v1.palette);
    expect(v2.visibilityRoles).toEqual(v1.visibilityRoles);
    expect(v2.visibilityProfiles).toEqual(v1.visibilityProfiles);
    expect(v2.activeVisibilityProfileId).toBe(v1.activeVisibilityProfileId);
    expect(comparableLayouts(v2.printLayouts, v2.elements)).toEqual(comparableLayouts(v1.printLayouts, v1.elements));
    expect(v2.activePrintLayoutId).toBe(v1.activePrintLayoutId);
    expect(v2.evaluationLimitIndex).toBe(v1.evaluationLimitIndex);
  });

  it("fixes representative parser diagnostics", () => {
    expect(parseDslCallStatement("point A = unknown(x: 0)").diagnostics.map((item) => item.message).join("\n")).toContain("候補");
    expect(parseDslCallStatement("point A = coordinate(x: 0 x: 1)").diagnostics.map((item) => item.message).join("\n")).toContain("重複");
    expect(parseDslCallStatement("line L = segment(start: A)").diagnostics.map((item) => item.message).join("\n")).toContain("必須引数");
  });
});
