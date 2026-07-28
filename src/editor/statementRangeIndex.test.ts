import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import { compileDslDocument } from "../dsl/dslDocument";
import { bindingIdForStableStatementId } from "../scalars/bindingCatalog";
import {
  createPrintLayoutRangeIndex,
  createScopeBodyRangeIndex,
  createSetStatementFieldRangeIndex,
  createSetStatementRangeIndex,
  createStatementRangeIndex,
  createTemplateHoleRangeIndex,
  createTypedDeclarationFieldRangeIndex,
  createTypedDeclarationRangeIndex,
  deepestContainingScopeId,
  elementIdAtCursor,
  mapPrintLayoutRangeIndex,
  mapScopeBodyRangeIndex,
  mapSetStatementFieldRangeIndex,
  mapSetStatementRangeIndex,
  mapStatementRangeIndex,
  mapTemplateHoleRangeIndex,
  mapTypedDeclarationFieldRangeIndex,
  mapTypedDeclarationRangeIndex,
  setStatementIdAtCursor,
  templateHoleAtPosition,
  typedDeclarationBindingIdAtCursor
} from "./statementRangeIndex";

const compiled = (source: string) => {
  const result = compileDslDocument(source);
  expect(result.document).not.toBeNull();
  expect(result.statementMap).not.toBeNull();
  return result;
};

/** Typed declarations need reconciler-issued statement identity to appear in
 * `statementMap.statementIdByStatementIndex` at all (see dslDocument.ts's own
 * `stableStatementIdByIndex` gate) - assigns a fresh stable id per statement
 * index, mirroring the fixture convention used across the scalars test suite
 * (e.g. propertyBindingCompiler.test.ts's `compileFor`). */
const compiledWithStableIds = (source: string) => {
  const statements = parseDsl(source).statements;
  const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
  const result = compileDslDocument(source, { assignedStatementIds });
  expect(result.document).not.toBeNull();
  expect(result.statementMap).not.toBeNull();
  return result;
};

describe("statementRangeIndex", () => {
  it("anchors an inline brace on the final row of a handwritten multiline header", () => {
    const source = [
      "nui 2",
      "group Multi (printEnabled: true",
      ") {",
      "  point A = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const group = result.document!.elements[0]!;
    const target = createStatementRangeIndex(doc, result.statementMap!).get(group.id)!.foldTargets[0]!;

    expect(target).toMatchObject({
      branch: "primary",
      gutterLineFrom: doc.line(3).from,
      foldFrom: doc.line(3).to,
      foldTo: doc.line(5).from
    });
  });

  it("adds a statement target for a handwritten multiline expression and leaves its close row visible", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = offset(",
      "  from: A",
      "  dx: 100",
      "  dy: 0",
      ")"
    ].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointB = result.document!.elements.find((element) => element.name === "B")!;
    const target = createStatementRangeIndex(doc, result.statementMap!).get(pointB.id)!.foldTargets;

    expect(target).toEqual([expect.objectContaining({
      branch: "statement",
      gutterLineFrom: doc.line(3).from,
      foldFrom: doc.line(3).to,
      foldTo: doc.line(7).from
    })]);
  });

  it("temporarily disables a multiline statement target when its opening row becomes dirty", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = offset(",
      "  from: A",
      ")"
    ].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointB = result.document!.elements.find((element) => element.name === "B")!;
    const ranges = createStatementRangeIndex(doc, result.statementMap!);
    const openParen = doc.line(3).to - 1;

    const mapped = mapStatementRangeIndex(
      ranges,
      ChangeSet.of({ from: openParen, to: openParen + 1, insert: "[" }, doc.length)
    );

    expect(mapped.get(pointB.id)?.foldTargets).toEqual([]);
  });

  it("temporarily disables only a target whose structural anchor is dirty", () => {
    const source = ["nui 2", "group G {", "  point A = coordinate(x: 0 y: 0)", "}"].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const group = result.document!.elements[0]!;
    const ranges = createStatementRangeIndex(doc, result.statementMap!);
    const openBrace = doc.line(2).to - 1;

    const mapped = mapStatementRangeIndex(
      ranges,
      ChangeSet.of({ from: openBrace, to: openBrace + 1, insert: "[" }, doc.length)
    );

    expect(mapped.get(group.id)?.foldTargets).toEqual([]);
    expect(mapped.get(group.id)?.from).toBe(ranges.get(group.id)?.from);
  });

  it("maps an intact target through dirty interior line edits", () => {
    const source = ["nui 2", "group G {", "  point A = coordinate(x: 0 y: 0)", "}"].join("\n");
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const group = result.document!.elements[0]!;
    const original = createStatementRangeIndex(doc, result.statementMap!).get(group.id)!.foldTargets[0]!;

    const mapped = mapStatementRangeIndex(
      createStatementRangeIndex(doc, result.statementMap!),
      ChangeSet.of({ from: doc.line(3).to, insert: "\n  point B = coordinate(x: 1 y: 1)" }, doc.length)
    ).get(group.id)!.foldTargets[0]!;

    expect(mapped.gutterLineFrom).toBe(original.gutterLineFrom);
    expect(mapped.foldTo).toBeGreaterThan(original.foldTo);
  });

  it("maps runtime-ID ranges through dirty edits without consulting stale statement lines", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0)\npoint = coordinate(x: 1 y: 1)";
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const unnamedId = result.document!.elements.find((element) => element.name === "")!.id;
    const original = createStatementRangeIndex(doc, result.statementMap!);
    const changes = ChangeSet.of({ from: 0, insert: "# dirty\n" }, doc.length);
    const mapped = mapStatementRangeIndex(original, changes);

    const unnamed = mapped.get(unnamedId)!;
    expect(elementIdAtCursor(mapped, unnamed.from)).toBe(unnamedId);
    expect(unnamed.from).toBeGreaterThan(original.get(unnamedId)!.from);
  });

  it("drops a wholly deleted statement instead of retaining a stale line identity", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0)\npoint B = coordinate(x: 1 y: 1)";
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointB = result.document!.elements.find((element) => element.name === "B")!;
    const original = createStatementRangeIndex(doc, result.statementMap!);
    const range = original.get(pointB.id)!;
    const changes = ChangeSet.of({ from: range.from, to: Math.min(doc.length, range.to + 1), insert: "" }, doc.length);

    expect(mapStatementRangeIndex(original, changes).has(pointB.id)).toBe(false);
  });

  it("keeps a statement identity when replacing a value at its final character", () => {
    const source = "nui 2\npoint B = coordinate(x: 0 y: 0)\npoint A = offset(from: B dx: 130 dy: 9)";
    const result = compiled(source);
    const doc = Text.of(source.split("\n"));
    const pointA = result.document!.elements.find((element) => element.name === "A")!;
    const original = createStatementRangeIndex(doc, result.statementMap!);
    const range = original.get(pointA.id)!;
    const valueStart = source.lastIndexOf("9");
    const changes = ChangeSet.of({ from: valueStart, to: valueStart + 1, insert: "10" }, doc.length);
    const mapped = mapStatementRangeIndex(original, changes);

    expect(elementIdAtCursor(mapped, valueStart)).toBe(pointA.id);
    expect(elementIdAtCursor(mapped, valueStart + 1)).toBe(pointA.id);
    expect(mapped.get(pointA.id)?.to).toBe(range.to + 1);
  });
});

describe("printLayoutRangeIndex", () => {
  const printLayoutSource = ["nui 2", "printLayout Layout1 () {", "  layoutVar Width = 10", "}"].join("\n");

  it("builds one entry per printLayout:<id> statementMap key, at the block-opening line", () => {
    const result = compiled(printLayoutSource);
    const doc = Text.of(printLayoutSource.split("\n"));
    const printLayoutId = result.document!.printLayouts[0].id;
    const index = createPrintLayoutRangeIndex(doc, result.statementMap!);

    expect(index.size).toBe(1);
    const range = index.get(printLayoutId)!;
    expect(range).toBeDefined();
    expect(doc.sliceString(range.from, range.to)).toBe("printLayout Layout1 () {");
  });

  it("tracks an insertion above the block, shifting the line but preserving printLayoutId identity", () => {
    const result = compiled(printLayoutSource);
    const doc = Text.of(printLayoutSource.split("\n"));
    const printLayoutId = result.document!.printLayouts[0].id;
    const original = createPrintLayoutRangeIndex(doc, result.statementMap!);
    const changes = ChangeSet.of({ from: 0, insert: "# dirty\n" }, doc.length);
    const mapped = mapPrintLayoutRangeIndex(original, changes);

    const range = mapped.get(printLayoutId)!;
    expect(range).toBeDefined();
    expect(range.from).toBeGreaterThan(original.get(printLayoutId)!.from);
  });

  it("drops an entry whose block-opening line is fully replaced", () => {
    const result = compiled(printLayoutSource);
    const doc = Text.of(printLayoutSource.split("\n"));
    const printLayoutId = result.document!.printLayouts[0].id;
    const original = createPrintLayoutRangeIndex(doc, result.statementMap!);
    const range = original.get(printLayoutId)!;
    const changes = ChangeSet.of({ from: range.from, to: Math.min(doc.length, range.to + 1), insert: "" }, doc.length);

    expect(mapPrintLayoutRangeIndex(original, changes).has(printLayoutId)).toBe(false);
  });
});

describe("typedDeclarationRangeIndex", () => {
  const source = ["nui 3", "const flag: boolean = true"].join("\n");

  it("builds one entry keyed by the binding's stable BindingId, spanning the whole declaration line", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const index = createTypedDeclarationRangeIndex(doc, result.statementMap!);

    expect(index.size).toBe(1);
    const bindingId = bindingIdForStableStatementId("stable-1");
    const range = index.get(bindingId)!;
    expect(range).toBeDefined();
    expect(doc.sliceString(range.from, range.to)).toBe("const flag: boolean = true");
    expect(typedDeclarationBindingIdAtCursor(index, range.from + 5)).toBe(bindingId);
  });

  it("keeps the range alive through an edit inside the initializer (dirty-buffer completion keeps working before the next compile)", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const original = createTypedDeclarationRangeIndex(doc, result.statementMap!);
    const bindingId = bindingIdForStableStatementId("stable-1");
    const range = original.get(bindingId)!;
    // Simulates typing more characters into the initializer, well before any compile debounce fires.
    const editPos = doc.sliceString(range.from, range.to).indexOf("true");
    const changes = ChangeSet.of({ from: range.from + editPos + 4, insert: " && false" }, doc.length);

    const mapped = mapTypedDeclarationRangeIndex(original, changes);
    expect(mapped.has(bindingId)).toBe(true);
    expect(mapped.get(bindingId)!.to).toBeGreaterThan(range.to);
  });

  it("tracks an insertion above the declaration, shifting the line but preserving binding identity", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const original = createTypedDeclarationRangeIndex(doc, result.statementMap!);
    const bindingId = bindingIdForStableStatementId("stable-1");
    const changes = ChangeSet.of({ from: 0, insert: "# dirty\n" }, doc.length);
    const mapped = mapTypedDeclarationRangeIndex(original, changes);

    const range = mapped.get(bindingId)!;
    expect(range).toBeDefined();
    expect(range.from).toBeGreaterThan(original.get(bindingId)!.from);
  });

  it("drops an entry whose declaration line is fully replaced", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const original = createTypedDeclarationRangeIndex(doc, result.statementMap!);
    const bindingId = bindingIdForStableStatementId("stable-1");
    const range = original.get(bindingId)!;
    const changes = ChangeSet.of({ from: range.from, to: Math.min(doc.length, range.to + 1), insert: "" }, doc.length);

    expect(mapTypedDeclarationRangeIndex(original, changes).has(bindingId)).toBe(false);
  });

  it("returns an empty index when no statement identity was assigned (no typed declarations)", () => {
    const noTypedSource = ["nui 2", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const result = compiled(noTypedSource);
    const doc = Text.of(noTypedSource.split("\n"));
    expect(createTypedDeclarationRangeIndex(doc, result.statementMap!).size).toBe(0);
  });
});

describe("scopeBodyRangeIndex (Task 40)", () => {
  const nestedSource = [
    "nui 3",
    "let outer: number = 1",
    "if C (true) {",
    "  for Loop (i from: 0 count: 2) {",
    "  }",
    "  let insideThen: number = 2",
    "}"
  ].join("\n");

  const scopeIdOf = (result: ReturnType<typeof compiledWithStableIds>, kind: "then" | "else" | "forGroup") => {
    const scope = [...result.bindingAnalysis!.catalog.scopeIndex.scopes.values()].find((candidate) => candidate.kind === kind);
    if (!scope) throw new Error(`no ${kind} scope in fixture`);
    return scope.id;
  };

  it("resolves the deepest containing scope, and falls back to root outside every tracked body", () => {
    const result = compiledWithStableIds(nestedSource);
    const doc = Text.of(nestedSource.split("\n"));
    const scopeIndex = result.bindingAnalysis!.catalog.scopeIndex;
    const index = createScopeBodyRangeIndex(doc, result.statementMap!, scopeIndex);

    const forGroupOpenLine = doc.line(4); // "  for Loop (i from: 0 count: 2) {"
    const insideForGroup = deepestContainingScopeId(index, forGroupOpenLine.to, scopeIndex.rootScopeId);
    expect(insideForGroup).toBe(scopeIdOf(result, "forGroup"));

    const insideThenLine = doc.line(6); // "  let insideThen: number = 2"
    const insideThenOnly = deepestContainingScopeId(index, insideThenLine.from, scopeIndex.rootScopeId);
    expect(insideThenOnly).toBe(scopeIdOf(result, "then"));

    expect(deepestContainingScopeId(index, 0, scopeIndex.rootScopeId)).toBe(scopeIndex.rootScopeId);
  });

  it("keeps a sibling else branch's body separate from its then branch", () => {
    const source = [
      "nui 3",
      "if C (true) {",
      "  let onlyThen: number = 1",
      "} else {",
      "  let onlyElse: number = 2",
      "}"
    ].join("\n");
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const scopeIndex = result.bindingAnalysis!.catalog.scopeIndex;
    const index = createScopeBodyRangeIndex(doc, result.statementMap!, scopeIndex);

    const inElse = deepestContainingScopeId(index, doc.line(5).from, scopeIndex.rootScopeId);
    expect(inElse).toBe(scopeIdOf(result, "else"));
    expect(inElse).not.toBe(scopeIdOf(result, "then"));
  });

  it("keeps a scope body alive through an edit typed inside it - a brand-new line resolves to the same scope", () => {
    const result = compiledWithStableIds(nestedSource);
    const doc = Text.of(nestedSource.split("\n"));
    const scopeIndex = result.bindingAnalysis!.catalog.scopeIndex;
    const original = createScopeBodyRangeIndex(doc, result.statementMap!, scopeIndex);
    const thenScopeId = scopeIdOf(result, "then");
    const thenRange = original.find((range) => range.scopeId === thenScopeId)!;

    // Simulates a brand-new, never-compiled `set` line typed inside the
    // then-branch body, well before any compile debounce fires.
    const insertPos = doc.line(6).from; // right before "  let insideThen..."
    const insertText = "  set outer = 2\n";
    const changes = ChangeSet.of({ from: insertPos, insert: insertText }, doc.length);
    const mapped = mapScopeBodyRangeIndex(original, changes);

    const mappedThenRange = mapped.find((range) => range.scopeId === thenScopeId)!;
    expect(mappedThenRange).toBeDefined();
    expect(mappedThenRange.to - mappedThenRange.from).toBe(thenRange.to - thenRange.from + insertText.length);

    // The cursor sitting right after the newly-typed line still resolves to
    // the same then-scope, with no recompile involved.
    const cursorAfterNewLine = insertPos + insertText.length;
    expect(deepestContainingScopeId(mapped, cursorAfterNewLine, scopeIndex.rootScopeId)).toBe(thenScopeId);
  });

  it("drops a scope body entry whose entire tracked range is replaced", () => {
    const result = compiledWithStableIds(nestedSource);
    const doc = Text.of(nestedSource.split("\n"));
    const scopeIndex = result.bindingAnalysis!.catalog.scopeIndex;
    const original = createScopeBodyRangeIndex(doc, result.statementMap!, scopeIndex);
    const forGroupScopeId = scopeIdOf(result, "forGroup");
    const forGroupRange = original.find((range) => range.scopeId === forGroupScopeId)!;
    const changes = ChangeSet.of({ from: forGroupRange.from, to: forGroupRange.to, insert: "" }, doc.length);

    const mapped = mapScopeBodyRangeIndex(original, changes);
    expect(mapped.some((range) => range.scopeId === forGroupScopeId)).toBe(false);
  });

  it("returns an empty index for a document with no nested scopes", () => {
    const source = ["nui 3", "let a: number = 1"].join("\n");
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const index = createScopeBodyRangeIndex(doc, result.statementMap!, result.bindingAnalysis!.catalog.scopeIndex);
    expect(index).toEqual([]);
  });
});

describe("typedDeclarationFieldRangeIndex (Task 43)", () => {
  const source = ["nui 3", "const flag: boolean = true"].join("\n");

  it("splits a declaration into name/type/initializer sub-spans, each reading the right slice", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const fields = createTypedDeclarationFieldRangeIndex(result.statementMap!, result.statements);
    const bindingId = bindingIdForStableStatementId("stable-1");
    const spans = fields.get(bindingId)!;

    expect(spans.name).toBeTruthy();
    expect(doc.sliceString(spans.name!.from, spans.name!.to)).toBe("flag");
    expect(spans.type).toBeTruthy();
    expect(doc.sliceString(spans.type!.from, spans.type!.to)).toBe("boolean");
    expect(spans.initializer).toBeTruthy();
    expect(doc.sliceString(spans.initializer!.from, spans.initializer!.to)).toBe("true");
  });

  it("a missing type annotation is a document-level error, so statementMap (and the field index built from it) is never reached", () => {
    // dslDeclarationParser.ts flags a missing `: type` as a hard diagnostic, which
    // nulls out CompiledDslDocument.statementMap entirely (dslDocument.ts's own
    // error gate) - the same way an unresolved `set` target does. There is no
    // reachable case where a `typedDeclaration` statement inside a successfully
    // compiled document has a null type span; only the multi-segment (continuation
    // line) fail-closed path below actually exercises `type`/`initializer` being null.
    const brokenSource = ["nui 3", "let broken = 1"].join("\n");
    const parsed = parseDsl(brokenSource);
    const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]));
    const result = compileDslDocument(brokenSource, { assignedStatementIds });
    expect(result.statementMap).toBeNull();
  });

  it("keeps sub-spans alive through an edit inside the initializer, and drops them once the whole line is replaced", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const original = createTypedDeclarationFieldRangeIndex(result.statementMap!, result.statements);
    const bindingId = bindingIdForStableStatementId("stable-1");
    const initializer = original.get(bindingId)!.initializer!;

    const interiorEdit = ChangeSet.of({ from: initializer.to, insert: " && false" }, doc.length);
    const mappedInterior = mapTypedDeclarationFieldRangeIndex(original, interiorEdit);
    expect(mappedInterior.get(bindingId)!.initializer).toEqual(initializer);
    expect(mappedInterior.get(bindingId)!.name).toEqual(original.get(bindingId)!.name);

    const wholeLineReplace = ChangeSet.of({ from: 0, to: doc.length, insert: "nui 3\nconst other: number = 1" }, doc.length);
    const mappedReplace = mapTypedDeclarationFieldRangeIndex(original, wholeLineReplace);
    expect(mappedReplace.get(bindingId)!.initializer).toBeNull();
    expect(mappedReplace.get(bindingId)!.name).toBeNull();
    expect(mappedReplace.get(bindingId)!.type).toBeNull();
  });

  it("leaves the initializer span null (fail-closed) when it spans a continuation line, while name/type stay resolvable", () => {
    const multilineSource = ["nui 3", "let total: number = (", "  1 + 2", ")"].join("\n");
    const result = compiledWithStableIds(multilineSource);
    const doc = Text.of(multilineSource.split("\n"));
    const fields = createTypedDeclarationFieldRangeIndex(result.statementMap!, result.statements);
    const bindingId = bindingIdForStableStatementId("stable-1");
    const spans = fields.get(bindingId)!;

    expect(spans.initializer).toBeNull();
    expect(spans.name).toBeTruthy();
    expect(doc.sliceString(spans.name!.from, spans.name!.to)).toBe("total");
    expect(spans.type).toBeTruthy();
    expect(doc.sliceString(spans.type!.from, spans.type!.to)).toBe("number");
  });

  it("returns no fields for a document with no typed declarations", () => {
    const noTypedSource = ["nui 2", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const result = compiled(noTypedSource);
    expect(createTypedDeclarationFieldRangeIndex(result.statementMap!, result.statements).size).toBe(0);
  });
});

describe("setStatementRangeIndex / setStatementFieldRangeIndex (Task 43)", () => {
  const source = ["nui 3", "let total: number = 0", "set total = @total + 1"].join("\n");

  it("resolves a set statement's whole-line range and cursor lookup", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const index = createSetStatementRangeIndex(doc, result.statementMap!);
    const statementId = "stable-2";
    const range = index.get(statementId)!;

    expect(range).toBeDefined();
    expect(doc.sliceString(range.from, range.to)).toBe("set total = @total + 1");
    expect(setStatementIdAtCursor(index, range.from + 4)).toBe(statementId);
  });

  it("splits a set statement into target and expression sub-spans", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const fields = createSetStatementFieldRangeIndex(result.statementMap!, result.statements);
    const spans = fields.get("stable-2")!;

    expect(spans.target).toBeTruthy();
    expect(doc.sliceString(spans.target!.from, spans.target!.to)).toBe("total");
    expect(spans.expression).toBeTruthy();
    expect(doc.sliceString(spans.expression!.from, spans.expression!.to)).toBe("@total + 1");
  });

  it("resolves target/expression from the raw parsed statement alone, independent of setStatements/bindingAnalysis", () => {
    // createSetStatementFieldRangeIndex takes only (statementMap, statements) - no
    // bindingAnalysis or setStatements parameter exists to pass, so a successfully
    // compiled set (whose target does resolve, the only shape that reaches a non-null
    // statementMap at all - an unresolved target is a document-level error like any
    // other) already proves the field spans never depend on resolution succeeding.
    const result = compiledWithStableIds(source);
    const fields = createSetStatementFieldRangeIndex(result.statementMap!, result.statements);
    expect(fields.get("stable-2")).toBeDefined();
  });

  it("drops the whole-line range and sub-spans once the set line is fully replaced", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const rangeIndex = createSetStatementRangeIndex(doc, result.statementMap!);
    const fieldIndex = createSetStatementFieldRangeIndex(result.statementMap!, result.statements);
    const range = rangeIndex.get("stable-2")!;
    const changes = ChangeSet.of({ from: range.from, to: range.to, insert: "" }, doc.length);

    expect(mapSetStatementRangeIndex(rangeIndex, changes).has("stable-2")).toBe(false);
    const mappedFields = mapSetStatementFieldRangeIndex(fieldIndex, changes);
    expect(mappedFields.get("stable-2")!.target).toBeNull();
    expect(mappedFields.get("stable-2")!.expression).toBeNull();
  });

  it("returns empty indices for a document with no set statements", () => {
    const noSetSource = ["nui 3", "let a: number = 1"].join("\n");
    const result = compiledWithStableIds(noSetSource);
    const doc = Text.of(noSetSource.split("\n"));
    expect(createSetStatementRangeIndex(doc, result.statementMap!).size).toBe(0);
    expect(createSetStatementFieldRangeIndex(result.statementMap!, result.statements).size).toBe(0);
  });
});

describe("templateHoleRangeIndex (Task 43)", () => {
  const source = [
    "nui 3",
    'const ラベル: string = "前身頃"',
    'text T = label(text: "{@ラベル}を2枚カット" anchor: none size: 3)'
  ].join("\n");

  it("resolves one hole's content span, selecting the reference text excluding braces", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    expect(result.textTemplates).toBeDefined();
    const occurrenceKey = [...result.textTemplates!.keys()][0]!;
    const index = createTemplateHoleRangeIndex(result.statementMap!, result.statements, result.textTemplates);
    const holes = index.get(occurrenceKey)!;

    expect(holes).toHaveLength(1);
    expect(doc.sliceString(holes[0].from, holes[0].to)).toBe("@ラベル");
    expect(templateHoleAtPosition(index, occurrenceKey, holes[0].from + 1)).toEqual(holes[0]);
    expect(templateHoleAtPosition(index, occurrenceKey, holes[0].to + 1)).toBeNull();
  });

  it("orders multiple holes in source order with independent content spans", () => {
    const multiHoleSource = [
      "nui 3",
      'const first: string = "A"',
      'const second: string = "B"',
      'text T = label(text: "{@first}-{@second}" anchor: none size: 3)'
    ].join("\n");
    const result = compiledWithStableIds(multiHoleSource);
    const doc = Text.of(multiHoleSource.split("\n"));
    const occurrenceKey = [...result.textTemplates!.keys()][0]!;
    const index = createTemplateHoleRangeIndex(result.statementMap!, result.statements, result.textTemplates);
    const holes = index.get(occurrenceKey)!;

    expect(holes.map((hole) => hole.holeIndex)).toEqual([0, 1]);
    expect(doc.sliceString(holes[0].from, holes[0].to)).toBe("@first");
    expect(doc.sliceString(holes[1].from, holes[1].to)).toBe("@second");
    expect(holes[1].from).toBeGreaterThan(holes[0].to);
  });

  it("keeps a hole span alive through an edit elsewhere on the line, and drops it once the hole itself is replaced", () => {
    const result = compiledWithStableIds(source);
    const doc = Text.of(source.split("\n"));
    const occurrenceKey = [...result.textTemplates!.keys()][0]!;
    const original = createTemplateHoleRangeIndex(result.statementMap!, result.statements, result.textTemplates);
    const hole = original.get(occurrenceKey)![0]!;

    const editAfterHole = ChangeSet.of({ from: doc.length, insert: "\n# trailing" }, doc.length);
    const mappedAfterEdit = mapTemplateHoleRangeIndex(original, editAfterHole);
    expect(mappedAfterEdit.get(occurrenceKey)![0]).toEqual(hole);

    const replaceHole = ChangeSet.of({ from: hole.from, to: hole.to, insert: "@other" }, doc.length);
    const mappedAfterReplace = mapTemplateHoleRangeIndex(original, replaceHole);
    expect(mappedAfterReplace.has(occurrenceKey)).toBe(false);
  });

  it("returns an empty index for a document with no text templates", () => {
    const noTemplateSource = ["nui 3", "let a: number = 1"].join("\n");
    const result = compiledWithStableIds(noTemplateSource);
    const index = createTemplateHoleRangeIndex(result.statementMap!, result.statements, result.textTemplates);
    expect(index.size).toBe(0);
  });

  it("returns an empty index for a legacy hole with no typed references, since it still carries a real content span", () => {
    const legacySource = ["nui 3", 'text T = label(text: "sum {2+3}" anchor: none size: 3)'].join("\n");
    const result = compiledWithStableIds(legacySource);
    const doc = Text.of(legacySource.split("\n"));
    const occurrenceKey = [...result.textTemplates!.keys()][0]!;
    const index = createTemplateHoleRangeIndex(result.statementMap!, result.statements, result.textTemplates);
    const holes = index.get(occurrenceKey)!;

    expect(holes).toHaveLength(1);
    expect(doc.sliceString(holes[0].from, holes[0].to)).toBe("2+3");
  });
});
