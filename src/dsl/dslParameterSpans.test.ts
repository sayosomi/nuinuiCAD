import { describe, expect, it } from "vitest";
import { elementTypesWithoutOwnDrawableGeometry } from "../model/elementActivity";
import { createCadElement } from "../model/elementFactory";
import { referenceAnchor } from "../model/pointAnchors";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { createElementNameContext } from "../model/elementNames";
import type { CadElement } from "../types/geometry";
import { applyArgs, createDefaultIntermediateId, type DslApplyArgsResolvers } from "./dslApplyArgs";
import { parseDslCallStatement } from "./dslCallParser";
import { argNameForParameter, constructionFor } from "./dslConstructions";
import { createNameIndex } from "./dslReferences";
import { documentDslRefs } from "./dslSerializer";
import {
  resolveParameterKeyForValueSpan,
  resolveParameterTargetAt,
  resolveParameterValueSpan,
} from "./dslParameterSpans";
import { nui1CanonicalElementStatements, type Nui1CanonicalElementStatement } from "./__fixtures__/nui1CanonicalStatements";

const refs: CadElement[] = [
  { id: "A", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "B", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
  { id: "C", name: "C", type: "freePoint", activity: "visible", x: 20, y: 0 },
  { id: "AB", name: "AB", type: "line", activity: "visible", startPoint: referenceAnchor("A"), endPoint: referenceAnchor("B") },
  { id: "CD", name: "CD", type: "line", activity: "visible", startPoint: referenceAnchor("B"), endPoint: referenceAnchor("C") },
];

const resolvers = (elements: CadElement[]): DslApplyArgsResolvers => ({
  index: createNameIndex([...refs, ...elements]), line: 1, elementsForExpressions: [...refs, ...elements],
  nameContext: createElementNameContext([...refs, ...elements]), visibilityRoles: [{ id: "seam", name: "縫い代" }], createIntermediateId: createDefaultIntermediateId,
});

const isContainerElementType = (elementType: Nui1CanonicalElementStatement["elementType"]) =>
  elementType === "group" || elementType === "conditionalGroup" || elementType === "forGroup";

/** Parses+applies canonical text the same way the production compiler eventually will (C1), so
 * span resolution is always checked against the element the text actually produces. */
const applyFixtureText = (fixture: Nui1CanonicalElementStatement, text: string) => {
  const parsed = parseDslCallStatement(text, { opensBlock: isContainerElementType(fixture.elementType) });
  expect(parsed.diagnostics, text).toEqual([]);
  const statement = parsed.statement!;
  const spec = constructionFor(statement.category, statement.construction)!;
  const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
  const prepared = { ...base, name: statement.name };
  const applied = applyArgs(prepared, spec, statement.args, resolvers([]));
  expect(applied.diagnostics.filter((item) => item.severity === "error"), text).toEqual([]);
  return { element: applied.element, statement };
};

/** Special args carry structured records/bookkeeping, not a single parameterKey. */
const specialArgNames = new Set(["steps", "id", "roles", "parent", "branch", "intermediates", "points"]);

/**
 * `state` is a universal `CadElement` field that P5 serializes whenever
 * non-default. The reverse "every emitted arg is claimed" check would otherwise
 * flag this type-independent behavior as a gap; the forward per-type check below
 * still covers editable parameter keys.
 */
const universalArgNames = new Set(["state"]);

/**
 * Two parameterKeys are never written to nui 1 text directly, by construction
 * of the P1 registry && P5 serializer (not a gap in P9): `placementMode` has
 * no arg at all; the inactive distance/ratio side is omitted by
 * `shouldSerializeConstructionArg`. Both are fixed/asserted in dedicated
 * tests below, not in the generic sweep.
 */
const isFixedElsewhere = (element: CadElement, key: string) =>
  key === "placementMode" ||
  ((element.type === "divisionPoint" || element.type === "lineDivisionPoint") && (key === "distance" || key === "ratio"));

const baseKeyOf = (key: string) => key.match(/^(.+):(x|y)$/)?.[1] ?? key;

/** Independently decomposes a coordinate-literal `(x, y)` outer span for `:x`/`:y`
 * sub-keys; a plain key's expected text is just the outer arg's own text. */
const expectedArgText = (text: string, outer: { start: number; end: number }, parameterKey: string) => {
  const suffix = parameterKey.match(/^(.+):(x|y)$/);
  if (!suffix) return text.slice(outer.start, outer.end);
  const inner = text.slice(outer.start + 1, outer.end - 1);
  const commaIndex = inner.indexOf(",");
  return (suffix[2] === "x" ? inner.slice(0, commaIndex) : inner.slice(commaIndex + 1)).trim();
};

/**
 * Bidirectional check for one canonical fixture text:
 *  - every ordinary arg the parser actually found (`payloadSpans`) is claimed by
 *    some parameterKey (catches P1/P9 mapping gaps — this is the "populated:
 *    every emitted arg resolves" requirement, && trivially holds for minimal too).
 *  - every parameterKey resolves iff its arg is present in the text (this is the
 *    "minimal: present resolves, omitted defaults are null" requirement).
 */
const checkFixtureSpans = (fixture: Nui1CanonicalElementStatement, text: string) => {
  const { element, statement } = applyFixtureText(fixture, text);
  const present = new Set(Object.keys(statement.payloadSpans));

  const definitions = getParameterDefinitions(element).filter(
    (definition) => definition.key !== "name" && !isFixedElsewhere(element, definition.key) &&
      !definition.key.startsWith("variable:") && !definition.key.startsWith("intermediate:")
  );
  const claimedArgNames = new Set(
    definitions
      .map((definition) => argNameForParameter(element.type, baseKeyOf(definition.key)))
      .filter((argName): argName is string => argName !== null)
  );
  // distance/ratio are asserted in the dedicated placementMode test below, not here.
  const exclusivePlacementArgs = element.type === "divisionPoint" || element.type === "lineDivisionPoint"
    ? new Set(["distance", "ratio"])
    : new Set<string>();
  for (const argName of present) {
    if (specialArgNames.has(argName) || universalArgNames.has(argName) || exclusivePlacementArgs.has(argName)) continue;
    expect(claimedArgNames.has(argName), `${fixture.key} (${text}): 引数「${argName}」に対応する parameterKey がありません`).toBe(true);
  }

  for (const definition of getParameterDefinitions(element)) {
    const key = definition.key;
    if (key === "name" || isFixedElsewhere(element, key)) continue;
    if (key.startsWith("variable:") || key.startsWith("intermediate:")) {
      const span = resolveParameterValueSpan(text, element, key, { committedLineText: text });
      expect(span, `${fixture.key}: ${key} が解決できません`).not.toBeNull();
      continue;
    }
    const argName = argNameForParameter(element.type, baseKeyOf(key));
    const expectedPresent = argName !== null && present.has(argName);
    const span = resolveParameterValueSpan(text, element, key, { committedLineText: text });
    if (expectedPresent) {
      expect(span, `${fixture.key}: ${key} が解決できません`).not.toBeNull();
      expect(text.slice(span!.start, span!.end)).toBe(expectedArgText(text, statement.payloadSpans[argName!], key));
    } else {
      expect(span, `${fixture.key}: ${key} は null であるべきです`).toBeNull();
    }
  }
};

describe("DSL nui 1 P9 parameter value span resolution", () => {
  describe("全27要素型の populated/minimal 網羅", () => {
    for (const fixture of nui1CanonicalElementStatements) {
      it(`resolves ${fixture.key} (populated)`, () => checkFixtureSpans(fixture, fixture.populated));
      it(`resolves ${fixture.key} (minimal)`, () => checkFixtureSpans(fixture, fixture.minimal));
    }
  });

  it("resolves the element name span for every fixture with a name", () => {
    for (const fixture of nui1CanonicalElementStatements) {
      // A bare mutation statement (edge/extend/move/mirrorMove/reverse) has
      // no `<category> <name> =` head at all - its compiled name is always
      // "", so there is no name span to resolve.
      if (elementTypesWithoutOwnDrawableGeometry.has(fixture.elementType)) continue;
      if (fixture.elementType === "conditionalGroup" || fixture.elementType === "forGroup") continue;
      for (const text of [fixture.populated, fixture.minimal]) {
        const { element, statement } = applyFixtureText(fixture, text);
        const span = resolveParameterValueSpan(text, element, "name", {});
        expect(span, `${fixture.key}: ${text}`).not.toBeNull();
        expect(span!.source).toBe("name");
        expect(span!.start).toBe(statement.nameSpan!.start);
        expect(span!.end).toBe(statement.nameSpan!.end);
      }
    }
  });

  it("resolves bezierCurve intermediate records with content matching P5's own serialization", () => {
    const fixture = nui1CanonicalElementStatements.find((item) => item.key === "bezierCurve")!;
    const { element } = applyFixtureText(fixture, fixture.populated);
    const bezier = element as Extract<CadElement, { type: "bezierCurve" }>;
    const dslRefs = documentDslRefs([...refs, element]);
    for (const point of bezier.intermediatePoints) {
      const expectations: Record<string, string> = {
        point: dslRefs.anchor(point.point, element),
        handleAngleDeg: dslRefs.numeric(point.handleAngleDeg, element),
        incomingHandleLength: dslRefs.numeric(point.incomingHandleLength, element),
        outgoingHandleLength: dslRefs.numeric(point.outgoingHandleLength, element),
      };
      for (const [field, expected] of Object.entries(expectations)) {
        const span = resolveParameterValueSpan(fixture.populated, element, `intermediate:${point.id}:${field}`, { committedLineText: fixture.populated });
        expect(span, field).not.toBeNull();
        expect(fixture.populated.slice(span!.start, span!.end)).toBe(expected);
      }
    }
  });

  describe("placementMode・非アクティブ側・測定variableのscope(DSL上に直接表現されない)", () => {
    it("fixes placementMode to null and resolves only the active distance/ratio side", () => {
      for (const fixture of nui1CanonicalElementStatements.filter((item) => item.key === "divisionPoint" || item.key === "lineDivisionPoint")) {
        for (const text of [fixture.populated, fixture.minimal]) {
          const { element } = applyFixtureText(fixture, text);
          const mode = (element as { placement: { kind: "distance" | "ratio" } }).placement.kind;
          expect(resolveParameterValueSpan(text, element, "placementMode"), fixture.key).toBeNull();
          const inactive = mode === "distance" ? "ratio" : "distance";
          expect(resolveParameterValueSpan(text, element, inactive), `${fixture.key}.${inactive}`).toBeNull();
          expect(resolveParameterValueSpan(text, element, mode), `${fixture.key}.${mode}`).not.toBeNull();
        }
      }
    });

    it("prefers the element's placementMode over a stray inactive-side argument in hand-edited text", () => {
      const text = "point p = between(start: A,end: B,distance: 5,ratio: 0.7)";
      const parsed = parseDslCallStatement(text);
      const spec = constructionFor("point", "between")!;
      const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
      const applied = applyArgs({ ...base, name: parsed.statement!.name }, spec, parsed.statement!.args, resolvers([]));
      const element = { ...applied.element, placement: { kind: "ratio" as const, value: 0.7 } };
      expect(resolveParameterValueSpan(text, element, "distance")).toBeNull();
      const ratioSpan = resolveParameterValueSpan(text, element, "ratio");
      expect(ratioSpan).not.toBeNull();
      expect(text.slice(ratioSpan!.start, ratioSpan!.end)).toBe("0.7");
    });

  });

  it("resolves x/y sub-spans for a literal coordinate anchor (line accepts coordinate literals for any reference-kind parameter)", () => {
    const text = "line L = segment(start: (12, -8),end: (0, 0))";
    const parsed = parseDslCallStatement(text);
    const spec = constructionFor("line", "segment")!;
    const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
    const applied = applyArgs({ ...base, name: parsed.statement!.name }, spec, parsed.statement!.args, resolvers([]));
    const element = applied.element;
    const keys = getParameterDefinitions(element).map((definition) => definition.key);
    expect(keys).toContain("startPoint:x");
    expect(keys).toContain("startPoint:y");
    const xSpan = resolveParameterValueSpan(text, element, "startPoint:x");
    const ySpan = resolveParameterValueSpan(text, element, "startPoint:y");
    expect(xSpan).not.toBeNull();
    expect(ySpan).not.toBeNull();
    expect(text.slice(xSpan!.start, xSpan!.end)).toBe("12");
    expect(text.slice(ySpan!.start, ySpan!.end)).toBe("-8");
  });

  it("resolves x/y sub-spans nested inside a bezierCurve intermediate record", () => {
    const text = "curve C = bezier(start: A,end: B,startAngle: 0,startLength: 30,endAngle: 0,endLength: 30,intermediates: [(5, 9):10:15:20])";
    const parsed = parseDslCallStatement(text);
    const spec = constructionFor("curve", "bezier")!;
    const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
    const applied = applyArgs({ ...base, name: parsed.statement!.name }, spec, parsed.statement!.args, resolvers([]));
    const element = applied.element as Extract<CadElement, { type: "bezierCurve" }>;
    const point = element.intermediatePoints[0];
    const key = `intermediate:${point.id}:point:x`;
    expect(getParameterDefinitions(element).map((definition) => definition.key)).toContain(key);
    const span = resolveParameterValueSpan(text, element, key, { committedLineText: text });
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe("5");
  });

  it("resolves spans in reordered, whitespace-padded, non-canonical text", () => {
    const text = "point   p  =  offset( dy: 5,from: A, dx:  -3 )";
    const parsed = parseDslCallStatement(text);
    const spec = constructionFor("point", "offset")!;
    const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
    const applied = applyArgs({ ...base, name: parsed.statement!.name }, spec, parsed.statement!.args, resolvers([]));
    const element = applied.element;
    const fromSpan = resolveParameterValueSpan(text, element, "fromPoint");
    const dxSpan = resolveParameterValueSpan(text, element, "dx");
    const dySpan = resolveParameterValueSpan(text, element, "dy");
    expect(text.slice(fromSpan!.start, fromSpan!.end)).toBe("A");
    expect(text.slice(dxSpan!.start, dxSpan!.end)).toBe("-3");
    expect(text.slice(dySpan!.start, dySpan!.end)).toBe("5");
  });


  describe("resolveParameterTargetAt / resolveParameterKeyForValueSpan", () => {
    it("picks the most specific span containing the caret, and the reverse lookup agrees", () => {
      const text = "point p = offset(from: A, dx: 12, dy: -8)";
      const parsed = parseDslCallStatement(text);
      const spec = constructionFor("point", "offset")!;
      const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
      const applied = applyArgs({ ...base, name: parsed.statement!.name }, spec, parsed.statement!.args, resolvers([]));
      const element = applied.element;
      const dxIndex = text.indexOf("12");
      const target = resolveParameterTargetAt(text, element, { start: dxIndex + 1, end: dxIndex + 1 });
      expect(target?.parameterKey).toBe("dx");
      expect(resolveParameterKeyForValueSpan(text, element, { start: dxIndex, end: dxIndex + 2 })).toBe("dx");
    });

    it("returns null outside any resolvable span", () => {
      const text = "point p = offset(from: A, dx: 12, dy: -8)";
      const parsed = parseDslCallStatement(text);
      const spec = constructionFor("point", "offset")!;
      const base = createCadElement(spec.elementType, [], { createId: (kind) => `${kind}-id`, referenceElements: refs });
      const applied = applyArgs({ ...base, name: parsed.statement!.name }, spec, parsed.statement!.args, resolvers([]));
      const element = applied.element;
      const parenIndex = text.indexOf("(");
      expect(resolveParameterTargetAt(text, element, { start: parenIndex, end: parenIndex })).toBeNull();
    });
  });
});
