import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { dslElementParameterCompletionOptions } from "./dslElementParameterCompletionCandidates";
import type { ComputedGeometry, ComputedLine, ComputedPoint, ElementId } from "../types/geometry";

const identities = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return {
    elements: compiled.document!.elements,
    ids: new Map([...compiled.statementMap!.byElementId].map(([elementId, statement]) => [statement.line, elementId]))
  };
};

const point = (id: ElementId, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: id,
  name: id,
  x,
  y
});

const lineGeometry = (id: ElementId): ComputedLine => ({
  kind: "line",
  elementId: id,
  name: id,
  startPointId: null,
  endPointId: null,
  start: point("a", 0, 0),
  end: point("b", 10, 0),
  length: 10,
  startAngleDeg: 0,
  endAngleDeg: 0,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 0
});

const baseSource = ["nui 4", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 10, y: 0)", "line AB = segment(start: @A, end: @B)", "point Target = coordinate(x: 5, y: 5)"].join("\n");

describe("dslElementParameterCompletionOptions", () => {
  it("lists AB's referenceable parameters when identity/type/enabled all agree with the last evaluation", () => {
    const { elements, ids } = identities(baseSource);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    const options = dslElementParameterCompletionOptions({
      source: baseSource,
      cursorLine: 5,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    const paths = options.map((option) => option.path);
    expect(paths).toContain("length");
    expect(paths).toContain("startTangentAngleDeg");
  });

  it("excludes a later statement (forward reference / cursor position)", () => {
    const { elements, ids } = identities(baseSource);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    const options = dslElementParameterCompletionOptions({
      source: baseSource,
      cursorLine: 4, // at AB's own declaration line - AB itself isn't visible yet
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(options).toEqual([]);
  });

  it("excludes a statement declared after the document's stop marker, even if it would otherwise resolve", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "stop",
      "point C = coordinate(x: 20, y: 0)",
      "line CD = segment(start: @B, end: @C)",
      "point Target = coordinate(x: 5, y: 5)"
    ].join("\n");
    const { elements, ids } = identities(source);
    const cdId = ids.get(7)!;
    // Fabricate as if CD had somehow been computed - the stop cutoff must
    // still exclude it from the name-resolution pool regardless of whatever
    // computedGeometry/effectiveEnabledElementIds are passed in.
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[cdId, lineGeometry(cdId)]]);
    const options = dslElementParameterCompletionOptions({
      source,
      cursorLine: 8,
      statementElementIds: ids,
      elements,
      elementToken: "CD",
      computedGeometry,
      effectiveEnabledElementIds: new Set([cdId]),
      errors: []
    });
    expect(options).toEqual([]);
  });

  it("excludes a group-scoped element outside the cursor's live group scope", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: @A, end: @B)",
      "}",
      "point Target = coordinate(x: 5, y: 5)"
    ].join("\n");
    const { elements, ids } = identities(source);
    const abId = ids.get(5)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    const outside = dslElementParameterCompletionOptions({
      source,
      cursorLine: 7,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(outside).toEqual([]);

    const insideSource = [...source.split("\n").slice(0, 5), "  point Target = coordinate(x: 5, y: 5)", "}"].join("\n");
    const inside = dslElementParameterCompletionOptions({
      source: insideSource,
      cursorLine: 6,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(inside.map((option) => option.path)).toContain("length");
  });

  it("resolves element-property candidates for a layout header attribute (scale=), even though layout is a BlockFrame scope with no elementId", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "group G {",
      "  point C = coordinate(x: 0, y: 0)",
      "}",
      "layout Layout1 (",
      "  scale: 1+@AB.length",
      ") {",
      "  place @G(at: (0, 0), angle: 0+@AB.length, mirror: false)",
      "}"
    ].join("\n");
    const { elements, ids } = identities(source);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    // Line 9: "  scale: 1+@AB.length" - physically after layout's own
    // opening line (8) but still part of the same statement's continuation,
    // which is exactly the shape dslScopeBeforeParsedLine reports as an
    // enclosing layout BlockFrame.
    const options = dslElementParameterCompletionOptions({
      source,
      cursorLine: 9,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(options.map((option) => option.path)).toContain("length");
  });

  it("resolves element-property candidates for a place @attribute(angle=) inside a layout block", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "group G {",
      "  point C = coordinate(x: 0, y: 0)",
      "}",
      "layout Layout1 (",
      "  scale: 1",
      ") {",
      "  place @G(at: (0, 0), angle: 0+@AB.length, mirror: false)",
      "}"
    ].join("\n");
    const { elements, ids } = identities(source);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    const options = dslElementParameterCompletionOptions({
      source,
      cursorLine: 11, // "  place @G(at: (0, 0), angle: 0+@AB.length, mirror: false)"
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(options.map((option) => option.path)).toContain("length");
  });

  it("excludes a disabled compiled element", () => {
    const { elements, ids } = identities(baseSource);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    const options = dslElementParameterCompletionOptions({
      source: baseSource,
      cursorLine: 5,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set(), // AB not enabled
      errors: []
    });
    expect(options).toEqual([]);
  });

  it("excludes an element with an evaluation error", () => {
    const { elements, ids } = identities(baseSource);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    const options = dslElementParameterCompletionOptions({
      source: baseSource,
      cursorLine: 5,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: [{ elementId: abId, elementName: "AB", missingDependencyId: abId, message: "評価エラー" }]
    });
    expect(options).toEqual([]);
  });

  it("returns no candidates while evaluation has no footprint for caller in range('s responsibility to treat as pending, not fall back)", () => {
    // dslElementParameterCompletionOptions never itself infers "pending" from
    // an empty/missing evaluation, && never runs a synchronous TS-reference
    // evaluation as a substitute - that would risk disagreeing with Rust for
    // typed conditional groups/property bindings/forGroup-generated elements.
    // The caller (cmAutocomplete.ts) is responsible for checking
    // evaluationIsCurrent && not calling this at all until Rust catches up -
    // see elementParameterCandidateState in elementParameterReferenceOptions.ts.
    const { elements, ids } = identities(baseSource);
    const options = dslElementParameterCompletionOptions({
      source: baseSource,
      cursorLine: 5,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry: new Map(),
      effectiveEnabledElementIds: new Set(),
      errors: []
    });
    expect(options).toEqual([]);
  });

  it("resolves namespace-qualified and Japanese element names", () => {
    const source = [
      "nui 4",
      "group グループ1 {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line 直線AB = segment(start: @A, end: @B)",
      "  point Target = coordinate(x: 5, y: 5)",
      "}"
    ].join("\n");
    const { elements, ids } = identities(source);
    const lineId = ids.get(5)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[lineId, lineGeometry(lineId)]]);
    const options = dslElementParameterCompletionOptions({
      source,
      cursorLine: 6,
      statementElementIds: ids,
      elements,
      elementToken: "直線AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([lineId]),
      errors: []
    });
    expect(options.map((option) => option.path)).toContain("length");

    const qualified = dslElementParameterCompletionOptions({
      source,
      cursorLine: 6,
      statementElementIds: ids,
      elements,
      elementToken: "グループ1::直線AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([lineId]),
      errors: []
    });
    expect(qualified.map((option) => option.path)).toContain("length");
  });

  it("never guesses for an ambiguous (duplicate) element name", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B, id: ab-1)",
      "point C = coordinate(x: 20, y: 0)",
      "line AB = segment(start: @A, end: @C, id: ab-2)",
      "point Target = coordinate(x: 5, y: 5)"
    ].join("\n");
    const { elements, ids } = identities(source);
    const firstId = ids.get(4)!;
    const secondId = ids.get(6)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([
      [firstId, lineGeometry(firstId)],
      [secondId, lineGeometry(secondId)]
    ]);
    const options = dslElementParameterCompletionOptions({
      source,
      cursorLine: 7,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([firstId, secondId]),
      errors: []
    });
    expect(options).toEqual([]);
  });

  it("live/compiled type mismatch: suppresses candidates rather than falling back to the old type's computedGeometry", () => {
    const { elements, ids } = identities(baseSource);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    // Same line number, but the live text now declares a "point" where the
    // compiled document still has a "line" - dirty, uncommitted structural edit.
    const dirtySource = ["nui 4", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 10, y: 0)", "point AB = coordinate(x: 5, y: 5)", "point Target = coordinate(x: 5, y: 5)"].join("\n");
    const options = dslElementParameterCompletionOptions({
      source: dirtySource,
      cursorLine: 5,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(options).toEqual([]);
  });

  it("live/compiled enabled mismatch: suppresses candidates rather than trusting the stale (pre-edit) evaluation", () => {
    const { elements, ids } = identities(baseSource);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    // Same statement/type/identity, but the live text was just dirty-edited to
    // add enabled=false - the compiled element (elements array) && the
    // computedGeometry/effectiveEnabledElementIds snapshot both still reflect
    // the previous (enabled) evaluation.
    const dirtySource = ["nui 4", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 10, y: 0)", "line AB = segment(start: @A, end: @B, state: disabled)", "point Target = coordinate(x: 5, y: 5)"].join("\n");
    const options = dslElementParameterCompletionOptions({
      source: dirtySource,
      cursorLine: 5,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(options).toEqual([]);
  });

  it("live/compiled enabled agreement: still offers candidates once the dirty text matches the compiled enabled state", () => {
    const { elements, ids } = identities(baseSource);
    const abId = ids.get(4)!;
    const computedGeometry = new Map<ElementId, ComputedGeometry>([[abId, lineGeometry(abId)]]);
    // A dirty edit unrelated to enabled/type (e.g. touching a later line) still
    // leaves AB's own live statement agreeing with the compiled snapshot.
    const dirtySource = ["nui 4", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 10, y: 0)", "line AB = segment(start: @A, end: @B)", "point Target = coordinate(x: 6, y: 5)"].join("\n");
    const options = dslElementParameterCompletionOptions({
      source: dirtySource,
      cursorLine: 5,
      statementElementIds: ids,
      elements,
      elementToken: "AB",
      computedGeometry,
      effectiveEnabledElementIds: new Set([abId]),
      errors: []
    });
    expect(options.map((option) => option.path)).toContain("length");
  });

  it("returns [] for a blank elementToken", () => {
    const { elements, ids } = identities(baseSource);
    expect(
      dslElementParameterCompletionOptions({
        source: baseSource,
        cursorLine: 5,
        statementElementIds: ids,
        elements,
        elementToken: "",
        computedGeometry: new Map(),
        errors: []
      })
    ).toEqual([]);
  });
});
