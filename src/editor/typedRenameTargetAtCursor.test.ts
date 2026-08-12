import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { bindingIdForStableStatementId } from "../scalars/bindingCatalog";
import {
  createPropertyBindingRangeIndex,
  createSetStatementFieldRangeIndex,
  createSetStatementRangeIndex,
  createTemplateHoleRangeIndex,
  createTypedDeclarationFieldRangeIndex,
  createTypedDeclarationRangeIndex
} from "./statementRangeIndex";
import { typedRenameTargetBindingIdAtCursor, type TypedRenameCursorContext } from "./typedRenameTargetAtCursor";

/** Mirrors statementRangeIndex.test.ts's own `compiledWithStableIds` fixture
 * convention (typed declarations need reconciler-issued stable identity to
 * appear in statementMap.statementIdByStatementIndex at all). */
const compiledWithStableIds = (source: string): CompiledDslDocument => {
  const statements = parseDsl(source).statements;
  const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
  const result = compileDslDocument(source, { assignedStatementIds });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return result;
};

const contextFor = (source: string): { doc: CompiledDslDocument; context: TypedRenameCursorContext; cmDoc: Text } => {
  const doc = compiledWithStableIds(source);
  const cmDoc = Text.of(source.split("\n"));
  const statementMap = doc.statementMap!;
  const context: TypedRenameCursorContext = {
    typedDeclarationRanges: createTypedDeclarationRangeIndex(cmDoc, statementMap),
    typedDeclarationFieldRanges: createTypedDeclarationFieldRangeIndex(cmDoc, statementMap, doc.statements),
    setStatementRanges: createSetStatementRangeIndex(cmDoc, statementMap),
    setStatementFieldRanges: createSetStatementFieldRangeIndex(cmDoc, statementMap, doc.statements),
    propertyBindingRanges: createPropertyBindingRangeIndex(cmDoc, statementMap, doc.statements, doc.propertyBindings),
    templateHoleRanges: createTemplateHoleRangeIndex(cmDoc, statementMap, doc.statements, doc.textTemplates),
    doc: {
      statements: doc.statements,
      scalarProgram: doc.scalarProgram,
      setStatements: doc.setStatements,
      propertyBindings: doc.propertyBindings,
      textTemplates: doc.textTemplates
    }
  };
  return { doc, context, cmDoc };
};

const bindingIdOfDeclaration = (doc: CompiledDslDocument, statementIndex: number) =>
  bindingIdForStableStatementId(doc.statementMap!.statementIdByStatementIndex!.get(statementIndex)!);

describe("typedRenameTargetBindingIdAtCursor", () => {
  it("resolves a cursor on a typed declaration's own name to its own binding", () => {
    const source = ["nui 3", "const a: number = 1"].join("\n");
    const { doc, context, cmDoc } = contextFor(source);
    const nameOffset = cmDoc.line(2).from + "const ".length;
    expect(typedRenameTargetBindingIdAtCursor(context, nameOffset)).toBe(bindingIdOfDeclaration(doc, 1));
  });

  it("resolves a cursor on a non-reference initializer literal to the declaring binding itself", () => {
    const source = ["nui 3", "const a: number = 1"].join("\n");
    const { doc, context, cmDoc } = contextFor(source);
    const literalOffset = cmDoc.line(2).from + "const a: number = ".length;
    expect(typedRenameTargetBindingIdAtCursor(context, literalOffset)).toBe(bindingIdOfDeclaration(doc, 1));
  });

  it("resolves a cursor on a reference inside another declaration's initializer to the referenced binding", () => {
    const source = ["nui 3", "const a: number = 1", "let b: number = @a + 1"].join("\n");
    const { doc, context, cmDoc } = contextFor(source);
    const refOffset = cmDoc.line(3).from + "let b: number = @".length;
    expect(typedRenameTargetBindingIdAtCursor(context, refOffset)).toBe(bindingIdOfDeclaration(doc, 1));
  });

  it("resolves a cursor on a set target name to the target binding", () => {
    const source = ["nui 3", "let a: number = 1", "set a = 2"].join("\n");
    const { doc, context, cmDoc } = contextFor(source);
    const targetOffset = cmDoc.line(3).from + "set ".length;
    expect(typedRenameTargetBindingIdAtCursor(context, targetOffset)).toBe(bindingIdOfDeclaration(doc, 1));
  });

  it("resolves a cursor on a set RHS reference to the referenced binding", () => {
    const source = ["nui 3", "let a: number = 1", "set a = @a + 1"].join("\n");
    const { doc, context, cmDoc } = contextFor(source);
    const refOffset = cmDoc.line(3).from + "set a = @".length;
    expect(typedRenameTargetBindingIdAtCursor(context, refOffset)).toBe(bindingIdOfDeclaration(doc, 1));
  });

  it("resolves a cursor on a property-binding reference to the referenced binding", () => {
    const source = [
      "nui 3",
      "const side: choice(right, left) = left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 3, side: @side)"
    ].join("\n");
    const { doc, context, cmDoc } = contextFor(source);
    const refOffset = cmDoc.line(6).from + "line Off = offset(sources: [@AB], distance: 3, side: @".length;
    expect(typedRenameTargetBindingIdAtCursor(context, refOffset)).toBe(bindingIdOfDeclaration(doc, 1));
  });

  it("resolves a cursor on a template-hole reference to the referenced binding", () => {
    const source = [
      "nui 3",
      'const label: string = "前身頃"',
      'text Label = label(text: "{@label}", anchor: none, size: 3)'
    ].join("\n");
    const { doc, context, cmDoc } = contextFor(source);
    const refOffset = cmDoc.line(3).from + 'text Label = label(text: "{@'.length;
    expect(typedRenameTargetBindingIdAtCursor(context, refOffset)).toBe(bindingIdOfDeclaration(doc, 1));
  });

  it("returns null for a cursor on an ordinary CAD element line", () => {
    const source = ["nui 3", "const a: number = 1", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const { context, cmDoc } = contextFor(source);
    const offset = cmDoc.line(3).from + "point ".length;
    expect(typedRenameTargetBindingIdAtCursor(context, offset)).toBeNull();
  });

  it("returns null for a cursor on the version header line, outside every tracked statement", () => {
    const source = ["nui 3", "const a: number = 1"].join("\n");
    const { context } = contextFor(source);
    expect(typedRenameTargetBindingIdAtCursor(context, 0)).toBeNull();
  });
});
