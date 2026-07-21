import { describe, expect, it } from "vitest";
import { createElementNameContext } from "../model/elementNames";
import { createCadElement } from "../model/elementFactory";
import { referenceAnchor } from "../model/pointAnchors";
import { getParameterValue } from "../parameters/parameterAccess";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { CadElement, CadElementType } from "../types/geometry";
import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import { applyArgs, type DslApplyArgsResolvers } from "./dslApplyArgs";
import { constructionFor, type DslConstructionSpec } from "./dslConstructions";
import { createNameIndex } from "./dslReferences";

const references: CadElement[] = [
  { id: "p1", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "p2", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
  { id: "p3", name: "C", type: "freePoint", visible: true, enabled: true, x: 20, y: 0 },
  { id: "l1", name: "AB", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("p1"), endPoint: referenceAnchor("p2") },
  { id: "l2", name: "CD", type: "line", visible: true, enabled: true, startPoint: referenceAnchor("p2"), endPoint: referenceAnchor("p3") },
];

const index = createNameIndex(references);
const resolvers: DslApplyArgsResolvers = {
  index,
  line: 7,
  elementsForExpressions: references,
  nameContext: createElementNameContext(references),
  visibilityRoles: [{ id: "seam", name: "縫い代" }],
  createIntermediateId: () => "generated-mid",
};

const sample = (type: CadElementType) =>
  createCadElement(type, [], { createId: (elementType) => `${elementType}-id`, referenceElements: references });

const arg = (key: string | null, value: string): ScannedArg => ({
  key,
  keySpan: key ? { start: 0, end: key.length } : null,
  value,
  valueSpan: { start: key ? key.length + 2 : 0, end: key ? key.length + value.length + 2 : value.length },
});

const valueFor = (element: CadElement, parameterKey: string) => {
  const definition = findParameterDefinition(element, parameterKey)!;
  switch (definition.kind) {
    case "number": return "12";
    case "boolean": return "true";
    case "reference": return parameterKey === "printAnchor" ? "(1, 2)" : "A";
    case "lineEndpointReference": return "AB.end";
    case "lineReference": return "AB";
    case "lineReferenceList": return "[AB, CD]";
    case "text": return '"a value"';
    case "choice": return definition.choiceOptions![0];
    case "color": return "pattern-black";
  }
};

const populatedArgs = (spec: DslConstructionSpec, element: CadElement) =>
  spec.args.flatMap((definition) => {
    if (definition.special === "intermediates") return [arg(definition.arg, "[C: 45: 20: 25: mid-1]")];
    if (definition.special === "roles") return [arg(definition.arg, "[縫い代]")];
    if (definition.special) return [];
    if (definition.arg === "ratio" && spec.exclusiveGroups?.some((group) => group.includes("distance"))) return [];
    return [arg(definition.positional ? null : definition.arg, valueFor(element, definition.parameterKey ?? definition.arg))];
  });

const specs = [
  ["point", "coordinate"], ["point", "offset"], ["point", "polar"], ["point", "between"],
  ["point", "onLine"], ["point", "intersection"], ["point", "tangentOffset"], ["line", "segment"],
  ["line", "polar"], ["line", "offset"], ["line", "split"], ["line", "extend"], ["line", "copy"],
  ["line", "move"], ["line", "mirrorCopy"], ["line", "mirrorMove"], ["line", "edge"],
  ["curve", "bezier"], ["arc", "arc"], ["arc", "through"], ["arc", "corner"], ["text", "label"],
  ["image", "image"], ["var", "expression"], ["var", "pointDistance"], ["var", "pointAngle"],
  ["var", "pointLineDistance"], ["group", ""], ["if", ""], ["for", ""],
] as const;

describe("DSL v2 compiler argument application", () => {
  it("applies populated and minimal arguments for every registry construction", () => {
    for (const [category, construction] of specs) {
      const spec = constructionFor(category, construction)!;
      const base = sample(spec.elementType);
      const prepared = { ...base, ...spec.preset } as CadElement;
      const minimal = applyArgs(base, spec, [], resolvers);
      expect(minimal.diagnostics).toEqual([]);
      expect(minimal.element).toMatchObject({ ...base, ...spec.preset });

      const applied = applyArgs(base, spec, populatedArgs(spec, prepared), resolvers);
      expect(applied.diagnostics).toEqual([]);
      expect(applied.element).toMatchObject({ type: spec.elementType, ...spec.preset });
      for (const definition of spec.args.filter((item) => !item.special)) {
        // The exclusive-group non-selected side (ratio, when distance is the
        // populated arg) has no value under the DivisionPlacement union -- it's
        // not a gap, it's the point of the union (see dslApplyArgs.ts::05).
        if (definition.arg === "ratio" && spec.exclusiveGroups?.some((group) => group.includes("distance"))) continue;
        const parameterKey = definition.parameterKey ?? definition.arg;
        const value = getParameterValue(applied.element, parameterKey);
        expect(value).not.toBeUndefined();
      }
    }
  });

  it("uses parameter kinds, placement selection, and special arguments deterministically", () => {
    const division = sample("divisionPoint");
    const between = applyArgs(division, constructionFor("point", "between")!, [
      arg("start", "A"), arg("end", "B"), arg("ratio", "0.25"),
      arg("locked", "true"), arg("visible", "false"), arg("enabled", "false"), arg("color", "red"),
    ], resolvers);
    expect(between.element).toMatchObject({
      startPoint: referenceAnchor("p1"), endPoint: referenceAnchor("p2"),
      placement: { kind: "ratio", value: 0.25 }, visible: true, enabled: false, colorId: "red",
    });
    expect(between.element).not.toHaveProperty("locked");
    expect(between.diagnostics.map((item) => item.message)).toContain(
      "locked は廃止された属性のため無視されます。"
    );

    const curve = applyArgs(sample("bezierCurve"), constructionFor("curve", "bezier")!, [
      arg("start", "A"), arg("end", "B"), arg("intermediates", "[C: 45: 20: 25: mid-1]"),
      arg("steps", "[startHandleLength: 0.5; endHandleLength: 2]"),
    ], resolvers);
    expect(curve.element).toMatchObject({
      numericParameterSteps: { startHandleLength: 0.5, endHandleLength: 2 },
      intermediatePoints: [expect.objectContaining({ id: "mid-1", point: referenceAnchor("p3"), handleAngleDeg: 45 })],
    });

    const group = applyArgs(sample("group"), constructionFor("group", "")!, [arg("roles", "[縫い代]")], resolvers);
    expect(group.element).toMatchObject({ visibilityRoleIds: ["seam"] });
  });

  it("characterizes DivisionPlacement: applyArgs resolves both distance/ratio to distance in isolation", () => {
    // 04: exclusivityの「同時に指定できません」診断はdslCallParser.ts側だけが出す。applyArgs単体は
    // 診断を出さず、group.find(["distance","ratio"]の並び順)でdistanceを選ぶ。ただしv2の
    // フル文書compileはこの診断がある時点でapplyArgsへ到達せず即座にdocument:nullとなる
    // (dslCompiler.test.tsのDivisionPlacement characterizationを参照)。この2つの事実は
    // 別レイヤーの挙動であり矛盾ではない。
    const between = applyArgs(sample("divisionPoint"), constructionFor("point", "between")!, [
      arg("start", "A"), arg("end", "B"), arg("distance", "7"), arg("ratio", "0.9"),
    ], resolvers);

    expect(between.element).toMatchObject({ placement: { kind: "distance", value: 7 } });
    expect(between.diagnostics).toEqual([]);

    const onLine = applyArgs(sample("lineDivisionPoint"), constructionFor("point", "onLine")!, [
      arg("from", "AB.end"), arg("distance", "3"), arg("ratio", "0.4"),
    ], resolvers);

    expect(onLine.element).toMatchObject({ placement: { kind: "distance", value: 3 } });
    expect(onLine.diagnostics).toEqual([]);
  });

  it("applies the common color argument when a legacy type has no Inspector color definition", () => {
    const edge = sample("edge");
    expect(findParameterDefinition(edge, "colorId")).toBeUndefined();
    const result = applyArgs(edge, constructionFor("line", "edge")!, [arg("color", "cut-red")], resolvers);
    expect(result.diagnostics).toEqual([]);
    expect(result.element).toMatchObject({ colorId: "cut-red" });
  });

  it("resolves each reference, endpoint, list, choice, text, and coordinate kind", () => {
    const offset = applyArgs(sample("offsetPoint"), constructionFor("point", "offset")!, [
      arg("from", "A"), arg("dx", "@width * 2"), arg("dy", "-5"),
    ], resolvers);
    expect(offset.element).toMatchObject({
      fromPoint: referenceAnchor("p1"), dx: { kind: "expression", expression: "@width * 2" }, dy: -5,
    });

    const onLine = applyArgs(sample("lineDivisionPoint"), constructionFor("point", "onLine")!, [
      arg("from", "AB.end"), arg("distance", "20"),
    ], resolvers);
    expect(onLine.element).toMatchObject({
      endpoint: { lineId: "l1", endpointKey: "end" },
      placement: { kind: "distance", value: 20 },
    });

    const offsetLine = applyArgs(sample("offsetLine"), constructionFor("line", "offset")!, [
      arg("sources", "[AB, CD]"), arg("side", "right"), arg("closed", "true"),
    ], resolvers);
    expect(offsetLine.element).toMatchObject({ baseLineIds: ["l1", "l2"], side: "right", closed: true });

    const label = applyArgs(sample("text"), constructionFor("text", "label")!, [
      arg("text", '"前身頃"'), arg("anchor", "none"), arg("size", "4"),
    ], resolvers);
    expect(label.element).toMatchObject({ text: "前身頃", anchor: null, fontSize: 4 });

    const image = applyArgs(sample("image"), constructionFor("image", "image")!, [
      arg("source", '"front.png"'), arg("origin", "(10, 20)"),
    ], resolvers);
    expect(image.element).toMatchObject({
      sourcePath: "front.png", originPoint: { mode: "coordinate", x: 10, y: 20 },
    });
  });

  it("remaps local variable references after applying vars and varIds in either source order", () => {
    const result = applyArgs(sample("freePoint"), constructionFor("point", "coordinate")!, [
      arg("varIds", "[width-id, half-id]"),
      arg("vars", "[幅: 12; 半分: @幅 / 2]"),
    ], resolvers);
    expect(result.diagnostics).toEqual([]);
    expect(result.element.numericVariables).toEqual([
      { id: "width-id", name: "幅", value: 12 },
      { id: "half-id", name: "半分", value: { kind: "expression", expression: "@width-id / 2" } },
    ]);
  });

  it("returns compiler-owned metadata and retains unresolved references with warnings", () => {
    const result = applyArgs(sample("offsetLine"), constructionFor("line", "offset")!, [
      arg("sources", "[missing]"), arg("id", "line-id"), arg("parent", "parent-token"), arg("branch", "else"),
    ], resolvers);
    expect(result.metadata).toEqual({ id: "line-id", parent: "parent-token", branch: "else" });
    expect(result.element).toMatchObject({ baseLineIds: ["missing"] });
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: "warning", message: "参照先が見つかりません: missing" })]);
  });

  it("reports invalid boolean and step values without mutating the input element", () => {
    const input = sample("freePoint");
    const result = applyArgs(input, constructionFor("point", "coordinate")!, [
      arg("locked", "not-a-boolean"), arg("steps", "[x: 0]"),
    ], resolvers);
    expect(result.element).not.toHaveProperty("locked");
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      "locked は true/false で指定してください。",
      "locked は廃止された属性のため無視されます。",
      "steps は parameter:positiveNumber の一覧で指定してください。",
    ]);
  });

  it("consumes P2 scanned argument output without depending on parser wiring", () => {
    const source = "point A = coordinate(x: 10 y: -5)";
    const open = source.indexOf("(");
    const scanned = scanCallArgs(source, { start: open + 1, end: source.length - 1 });
    const result = applyArgs(sample("freePoint"), constructionFor("point", "coordinate")!, scanned.args, resolvers);
    expect(result).toMatchObject({ element: { x: 10, y: -5 }, diagnostics: [] });
  });
});

describe("nui 3 state syntax lowering", () => {
  const resolversV3: DslApplyArgsResolvers = { ...resolvers, majorVersion: 3 };

  it("lowers each of the 3 state literals to the matching legacy flags under nui 3", () => {
    const visible = applyArgs(sample("freePoint"), constructionFor("point", "coordinate")!, [arg("state", "visible")], resolversV3);
    expect(visible.diagnostics).toEqual([]);
    expect(visible.element).toMatchObject({ visible: true, enabled: true });

    const hidden = applyArgs(sample("freePoint"), constructionFor("point", "coordinate")!, [arg("state", "hidden")], resolversV3);
    expect(hidden.diagnostics).toEqual([]);
    expect(hidden.element).toMatchObject({ visible: false, enabled: true });

    const disabled = applyArgs(sample("freePoint"), constructionFor("point", "coordinate")!, [arg("state", "disabled")], resolversV3);
    expect(disabled.diagnostics).toEqual([]);
    expect(disabled.element).toMatchObject({ visible: true, enabled: false });
  });

  it("still accepts legacy visible/enabled alone under nui 3 (compatibility input)", () => {
    const result = applyArgs(sample("freePoint"), constructionFor("point", "coordinate")!, [arg("visible", "false")], resolversV3);
    expect(result.diagnostics).toEqual([]);
    expect(result.element).toMatchObject({ visible: false, enabled: true });
  });

  it("rejects state: under nui 2 with the Task 06 version-gate diagnostic and does not touch activity fields", () => {
    const input = sample("freePoint");
    const result = applyArgs(input, constructionFor("point", "coordinate")!, [arg("state", "hidden")], resolvers);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "typed-syntax-requires-nui3",
        message: "state: 構文 は nui 3 以降でのみ使用できます(現在: nui 2)。",
      }),
    ]);
    expect(result.element).toMatchObject({ visible: input.visible, enabled: input.enabled });
  });

  it("fails closed on an invalid state literal: diagnoses without falling back to any activity value", () => {
    const input = { ...sample("freePoint"), visible: false, enabled: true };
    const result = applyArgs(input, constructionFor("point", "coordinate")!, [arg("state", "maybe")], resolversV3);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ message: "state は visible/hidden/disabled のいずれかで指定してください。" }),
    ]);
    // Fail-closed: the element's prior activity fields are untouched, not defaulted to visible.
    expect(result.element).toMatchObject({ visible: false, enabled: true });
  });

  it("fails closed when state conflicts with visible or enabled: neither is lowered onto the element", () => {
    const input = { ...sample("freePoint"), visible: false, enabled: true };
    const result = applyArgs(
      input,
      constructionFor("point", "coordinate")!,
      [arg("state", "disabled"), arg("visible", "true")],
      resolversV3,
    );
    // dslCallParser.ts's raw-arg validation is responsible for the element-state-conflict
    // diagnostic; applyArgs only needs to mirror its fail-closed behavior here.
    expect(result.element).toMatchObject({ visible: false, enabled: true });
  });
});
