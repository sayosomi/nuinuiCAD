import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { DependencyError } from "../types/geometry";
import {
  createPrintLayoutRangeIndex,
  createScopeBodyRangeIndex,
  createStatementRangeIndex,
  createTypedDeclarationRangeIndex
} from "./statementRangeIndex";
import { createDslCompletionSource } from "./cmAutocomplete";

const baseSource = [
  "nui 4",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "line AB = segment(start: @A, end: @B)",
  "let amount: number = 0",
  "let label: string = \"\""
].join("\n");

const statementIds = (source: string) => new Map(parseDsl(source).statements.map((_, index) => [index, `test:${index}`]));

const compiledFixture = (source = baseSource) => {
  const compiled = compileDslDocument(source, { assignedStatementIds: statementIds(source) });
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  const doc = EditorState.create({ doc: source }).doc;
  const lineIds = new Map([...compiled.statementMap!.byElementId].map(([id, statement]) => [statement.line, id]));
  const ab = compiled.document!.elements.find((element) => element.type === "line")!;
  const point = (id: string, name: string, x: number) => ({ kind: "point" as const, elementId: id, name, x, y: 0 });
  const geometry = new Map([[ab.id, {
    kind: "line" as const,
    elementId: ab.id,
    name: ab.name,
    startPointId: null,
    endPointId: null,
    start: point("a", "A", 0),
    end: point("b", "B", 10),
    length: 10,
    startAngleDeg: 0,
    endAngleDeg: 0,
    startTangentAngleDeg: 0,
    endTangentAngleDeg: 0
  }]]);
  return {
    compiled,
    lineIds,
    statementRanges: createStatementRangeIndex(doc, compiled.statementMap!),
    printLayoutRanges: createPrintLayoutRangeIndex(doc, compiled.statementMap!),
    typedRanges: createTypedDeclarationRangeIndex(doc, compiled.statementMap!),
    scopeRanges: compiled.bindingAnalysis
      ? createScopeBodyRangeIndex(doc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex)
      : [],
    geometry,
    enabled: new Set([ab.id])
  };
};

const completionAt = async ({
  fixture,
  source,
  pos = source.length,
  evaluationIsCurrent = true,
  enabled = fixture.enabled,
  errors = [],
  geometry = fixture.geometry
}: {
  fixture: ReturnType<typeof compiledFixture>;
  source: string;
  pos?: number;
  evaluationIsCurrent?: boolean;
  enabled?: Set<string>;
  errors?: DependencyError[];
  geometry?: ReturnType<typeof compiledFixture>["geometry"];
}) => {
  const state = EditorState.create({ doc: source });
  const completion = createDslCompletionSource({
    elements: () => fixture.compiled.document!.elements,
    statementRanges: () => fixture.statementRanges,
    printLayouts: () => [],
    printLayoutRanges: () => fixture.printLayoutRanges,
    isComposing: () => false,
    computedGeometry: () => geometry,
    effectiveEnabledElementIds: () => enabled,
    evaluationErrors: () => errors,
    bindingAnalysis: () => fixture.compiled.bindingAnalysis,
    typedDeclarationRanges: () => fixture.typedRanges,
    scopeBodyRanges: () => fixture.scopeRanges,
    statementInfoByElementId: () => fixture.compiled.statementMap!.byElementId,
    evaluationIsCurrent: () => evaluationIsCurrent
  });
  return completion({ state, pos, explicit: true } as never);
};

describe("typed geometry-property completion", () => {
  it("completes an earlier element property in a number initializer without replacing @Element.", async () => {
    const fixture = compiledFixture();
    const source = `${baseSource}\nconst length: number = @AB.le`;
    const result = await completionAt({ fixture, source });
    expect(result).toMatchObject({ from: source.length - 2, to: source.length });
    expect(result?.options.map((option) => option.label)).toContain("length");
    expect(result?.options.find((option) => option.label === "length")?.apply).toBe("length");
  });

  it("completes a property after a scoped element path", async () => {
    const scopedSource = [
      "nui 4",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "const length: number = @G::AB.le"
    ].join("\n");
    const fixture = compiledFixture(scopedSource.replace("@G::AB.le", "@G::AB.length"));
    const result = await completionAt({ fixture, source: scopedSource });
    expect(result).toMatchObject({ from: scopedSource.length - 2, to: scopedSource.length });
    expect(result?.options.map((option) => option.label)).toContain("length");
  });

  it("completes an earlier element property in a number set RHS", async () => {
    const fixture = compiledFixture();
    const source = `${baseSource}\nset amount = @AB.`;
    const result = await completionAt({ fixture, source });
    expect(result).toMatchObject({ from: source.length, to: source.length });
    expect(result?.options.map((option) => option.label)).toContain("length");
  });

  it("keeps @ binding completion separate and rejects non-number typed sites", async () => {
    const fixture = compiledFixture();
    const bindingResult = await completionAt({ fixture, source: `${baseSource}\nconst total: number = @` });
    expect(bindingResult?.options.map((option) => option.label)).toContain("amount");
    expect(bindingResult?.options.map((option) => option.label)).not.toContain("AB");

    expect(await completionAt({ fixture, source: `${baseSource}\nconst text: string = @AB.` })).toBeNull();
    const stringSet = await completionAt({ fixture, source: `${baseSource}\nset label = @AB.` });
    expect(stringSet?.options).toEqual([]);
  });

  it("does not offer properties for later, disabled, invalid, or stale geometry", async () => {
    const laterSource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "const length: number = @Later.length",
      "line Later = segment(start: @A, end: @B)"
    ].join("\n");
    const laterFixture = compiledFixture(laterSource);
    // Keep all compiled statement offsets stable; the editor's range index
    // maps edits incrementally in production, while this focused test keeps
    // the same identity map to exercise source-order filtering.
    const dirtyLater = laterSource.replace("@Later.length", "@Later.      ");
    const laterPos = dirtyLater.indexOf("@Later.") + "@Later.".length;
    const laterResult = await completionAt({ fixture: laterFixture, source: dirtyLater, pos: laterPos });
    expect(laterResult?.options).toEqual([]);

    const fixture = compiledFixture();
    const source = `${baseSource}\nconst length: number = @AB.`;
    expect((await completionAt({ fixture, source, enabled: new Set() }))?.options).toEqual([]);
    expect((await completionAt({ fixture, source, errors: [{ elementId: fixture.compiled.document!.elements.find((element) => element.name === "AB")!.id } as never] }))?.options).toEqual([]);
    expect((await completionAt({ fixture, source, evaluationIsCurrent: false }))?.options).toEqual([]);
  });
});
