import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCadElement } from "../model/elementFactory";
import { createElementNameContext } from "../model/elementNames";
import { referenceAnchor } from "../model/pointAnchors";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue, setParameterValue } from "../parameters/parameterAccess";
import type { CadElement, CadElementType } from "../types/geometry";
import { applyArgs, createDefaultIntermediateId, type DslApplyArgsResolvers } from "./dslApplyArgs";
import { parseDslCallStatement } from "./dslCallParser";
import { constructionForElementType } from "./dslConstructions";
import { createNameIndex } from "./dslReferences";
import { flatRefs } from "./dslSerializer";
import { serializeElementStatementLogical } from "./dslSerializeElement";
import { parseDslSettingsStatement } from "./dslSettingsParser";
import { applyDslV2PrintLayout, applyDslV2Setting, emptyDslV2Settings, serializeDslV2Settings } from "./dslV2Settings";
import { v2CanonicalConstructions, v2CanonicalSettingStatements } from "./__fixtures__/v2CanonicalStatements";
import { compileDslToElements } from "./dslCompiler";
import { normalizeForComparison } from "./dslDocumentTestUtils";
import sampleV1 from "./__fixtures__/sample.nui?raw";
import sampleV2 from "./__fixtures__/sample.v2.nui?raw";

const refs: CadElement[] = [
  { id: "A", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "B", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
  { id: "C", name: "C", type: "freePoint", visible: true, enabled: true, x: 20, y: 0 },
  { id: "AB", name: "AB", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("A"), endPoint: referenceAnchor("B") },
  { id: "CD", name: "CD", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("B"), endPoint: referenceAnchor("C") },
];

const base = (type: CadElementType) => createCadElement(type, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
const resolvers = (elements: CadElement[], referenceElements: CadElement[] = refs): DslApplyArgsResolvers => ({
  index: createNameIndex([...referenceElements, ...elements]), line: 1, elementsForExpressions: [...referenceElements, ...elements],
  nameContext: createElementNameContext([...referenceElements, ...elements]), visibilityRoles: [{ id: "seam", name: "縫い代" }],
  createIntermediateId: createDefaultIntermediateId,
});

const sampleValue = (kind: ReturnType<typeof getParameterDefinitions>[number]["kind"]) => {
  switch (kind) {
    case "number": return 12;
    case "boolean": return true;
    case "reference": return referenceAnchor("A");
    case "lineEndpointReference": return { lineId: "AB", endpointKey: "end" };
    case "lineReference": return "AB";
    case "lineReferenceList": return ["AB", "CD"];
    case "text": return "populated";
    case "choice": return "left";
    case "color": return "red";
  }
};

const populated = (type: CadElementType) => {
  let element = { ...base(type), locked: true, visible: false, enabled: false, colorId: "red", numericParameterSteps: { x: 0.5 } } as CadElement;
  for (const definition of getParameterDefinitions(element).filter((definition) => definition.key !== "placementMode")) element = setParameterValue(element, definition.key, sampleValue(definition.kind));
  if (element.type === "group") element = { ...element, visibilityRoleIds: ["seam"] };
  if (element.type === "bezierCurve") element = { ...element, intermediatePoints: [{ id: "mid", point: referenceAnchor("C"), handleAngleDeg: 45, incomingHandleLength: 20, outgoingHandleLength: 25 }] };
  return element;
};

const roundTripElement = (element: CadElement) => {
  const source = serializeElementStatementLogical(element, flatRefs());
  const parsed = parseDslCallStatement(source, { opensBlock: element.type === "group" || element.type === "conditionalGroup" || element.type === "forGroup" });
  expect(parsed.diagnostics).toEqual([]);
  const spec = constructionForElementType(element.type);
  const applied = applyArgs({ ...base(element.type), name: element.name }, spec, parsed.statement!.args, resolvers([]));
  expect(applied.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return { source, parsed: parsed.statement!, element: applied.element };
};

const logicalLines = (source: string) => {
  const result: string[] = []; let current = ""; let depth = 0;
  for (const physical of source.split("\n")) {
    const line = physical.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "}" || line === "} else {") { if (current) { result.push(current); current = ""; } result.push(line); continue; }
    current += `${current ? " " : ""}${line}`;
    for (const char of line) if (char === "(") depth += 1; else if (char === ")") depth -= 1;
    if (depth === 0) { result.push(current); current = ""; }
  }
  if (current) result.push(current);
  return result;
};

const compileV2Elements = (source: string) => {
  const elements: CadElement[] = []; const stack: Array<{ id: string; conditional: boolean; branch: "then" | "else" }> = [];
  for (const text of logicalLines(source)) {
    if (/^(nui|color|role|view|activeView|printLayout|layoutVar|place|activePrintLayout|@stop)\b/.test(text)) continue;
    if (text === "}") { stack.pop(); continue; }
    if (text === "} else {") { stack.at(-1)!.branch = "else"; continue; }
    const opensBlock = text.endsWith("{");
    const parsed = parseDslCallStatement(opensBlock ? text.slice(0, -1).trim() : text, { opensBlock });
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statement!; const spec = constructionForElementType(statement.elementType!);
    const created = createCadElement(spec.elementType, elements, { createId: () => `${spec.elementType}-${elements.length + 1}`, referenceElements: elements });
    const parent = stack.at(-1);
    const applied = applyArgs({ ...created, name: statement.name, ...(parent ? { parentGroupId: parent.id } : {}), ...(parent?.conditional ? { conditionalBranch: parent.branch } : {}) } as CadElement, spec, statement.args, resolvers(elements, []));
    expect(applied.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    elements.push(applied.element);
    if (opensBlock) stack.push({ id: applied.element.id, conditional: applied.element.type === "conditionalGroup", branch: "then" });
  }
  return elements;
};

describe("DSL v2 P7 round-trip and golden fixtures", () => {
  it("round-trips minimal and populated forms of every element type", () => {
    for (const type of Object.keys(v2CanonicalConstructions) as CadElementType[]) for (const element of [base(type), populated(type)]) {
      const result = roundTripElement(element);
      expect([result.parsed.category, result.parsed.construction]).toEqual(v2CanonicalConstructions[type]);
      for (const definition of getParameterDefinitions(element).filter((definition) => {
        if (definition.key === "placementMode") return false;
        if ((definition.key === "distance" || definition.key === "ratio") && (element.type === "divisionPoint" || element.type === "lineDivisionPoint")) return definition.key === element.placementMode;
        return true;
      })) expect(getParameterValue(result.element, definition.key), `${type}.${definition.key}`).toEqual(getParameterValue(element, definition.key));
    }
  });

  it("keeps serializer output as a parse/serialize fixed point", () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(v2CanonicalConstructions) as CadElementType[]), fc.boolean(), (type, rich) => {
      const element = rich ? populated(type) : base(type);
      const first = roundTripElement(element).source;
      expect(serializeElementStatementLogical(roundTripElement(element).element, flatRefs())).toBe(first);
    }), { numRuns: 54 });
  });

  it("uses P4 settings parser and the minimal P7-only settings helper as a v2 fixed point", () => {
    const parse = (line: string, opensBlock = false) => {
      const result = parseDslSettingsStatement(line, { opensBlock }); expect(result.diagnostics).toEqual([]); return result.statement!;
    };
    let settings = emptyDslV2Settings();
    for (const line of v2CanonicalSettingStatements.slice(1, 5)) settings = applyDslV2Setting(settings, parse(line));
    settings = applyDslV2Setting(settings, parse("view 印刷 (default: true seam: true)"));
    const header = parse(v2CanonicalSettingStatements[5], true);
    settings = applyDslV2PrintLayout(settings, header, [parse(v2CanonicalSettingStatements[6]), parse(v2CanonicalSettingStatements[7])], [{ id: "group", name: "前身頃", type: "group", visible: true, enabled: true, printEnabled: false, printAnchor: { mode: "coordinate", x: 0, y: 0 } }]);
    settings = applyDslV2Setting(settings, parse(v2CanonicalSettingStatements[8]));
    const serialized = serializeDslV2Settings(settings, [{ id: "group", name: "前身頃", type: "group", visible: true, enabled: true, printEnabled: false, printAnchor: { mode: "coordinate", x: 0, y: 0 } }]);
    expect(serialized).toContain(v2CanonicalSettingStatements[0]);
    expect(serialized.join("\n")).toContain('color pattern-black ("#31322f" name: "基本線" default: true)');
    expect(serialized.join("\n")).toContain("printLayout A4 (output: pdf view: 印刷 paper: a4 orientation: portrait columns: 2 rows: 2 overlap: 10 scale: 1 canvas: (410, 584)) {");
    let replay = emptyDslV2Settings();
    const groups: CadElement[] = [{ id: "group", name: "前身頃", type: "group", visible: true, enabled: true, printEnabled: false, printAnchor: { mode: "coordinate", x: 0, y: 0 } }];
    for (let index = 0; index < serialized.length; index += 1) {
      const line = serialized[index].trim();
      if (line.startsWith("printLayout ")) {
        const header = parse(line, true); const members = [];
        while (serialized[++index].trim() !== "}") members.push(parse(serialized[index].trim()));
        replay = applyDslV2PrintLayout(replay, header, members, groups);
      } else replay = applyDslV2Setting(replay, parse(line));
    }
    expect(replay).toEqual(settings);
  });

  it("keeps the handwritten v2 golden semantically equal to the current v1 sample", () => {
    const v1 = compileDslToElements(sampleV1, { elements: [], mode: "document" });
    const v2 = compileV2Elements(sampleV2);
    expect(normalizeForComparison(v2)).toEqual(normalizeForComparison(v1.elements));
  });

  it("fixes representative parser diagnostics", () => {
    expect(parseDslCallStatement("point A = unknown(x: 0)").diagnostics.map((item) => item.message).join("\n")).toContain("候補");
    expect(parseDslCallStatement("point A = coordinate(x: 0 x: 1)").diagnostics.map((item) => item.message).join("\n")).toContain("重複");
    expect(parseDslCallStatement("line L = segment(start: A)").diagnostics.map((item) => item.message).join("\n")).toContain("必須引数");
  });
});
