// Task 51 follow-up: resolves which typed binding (if any) an F2 press should
// rename, from the live cursor offset alone. Pure - reads only already-built
// Task 43 range indices (physical, live-mapped through edits) and the last
// successful compile's own raw statements/scalarProgram/setStatements/
// propertyBindings/textTemplates (logical, from that same compile). Callers
// must only invoke this while SourceEditorController's own
// typedSemanticMetadataFresh flag is true - see stepTypedSourceValue's
// identical contract in sourceEditorController.ts for why a stale pairing of
// live physical spans against a no-longer-matching logical compile cannot be
// detected from the spans alone.
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarValueSource } from "../scalars/propertyBindingCompiler";
import type { ScalarProgram } from "../scalars/scalarProgram";
import type { SetStatementAnalysis } from "../scalars/setStatementCompiler";
import type { TextTemplateAst } from "../scalars/textTemplate";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import { referencesIn } from "../scalars/typedDependencyGraph";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import type { DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslPhysicalSegment } from "../dsl/logicalStatementSourceMap";
import {
  setStatementIdAtCursor,
  typedDeclarationBindingIdAtCursor,
  type PropertyBindingRangeIndex,
  type SetStatementFieldRangeIndex,
  type SetStatementRangeIndex,
  type TemplateHoleRangeIndex,
  type TypedDeclarationFieldRangeIndex,
  type TypedDeclarationRangeIndex
} from "./statementRangeIndex";

export type TypedRenameCursorDocument = {
  statements: readonly DslStatement[];
  scalarProgram?: ScalarProgram;
  setStatements?: ReadonlyMap<number, SetStatementAnalysis>;
  propertyBindings?: ReadonlyMap<string, ScalarValueSource>;
  textTemplates?: ReadonlyMap<string, TextTemplateAst>;
  numericBindings?: ReadonlyMap<string, CompiledNumericBinding>;
};

export type TypedRenameCursorContext = {
  typedDeclarationRanges: TypedDeclarationRangeIndex;
  typedDeclarationFieldRanges: TypedDeclarationFieldRangeIndex;
  setStatementRanges: SetStatementRangeIndex;
  setStatementFieldRanges: SetStatementFieldRangeIndex;
  propertyBindingRanges: PropertyBindingRangeIndex;
  templateHoleRanges: TemplateHoleRangeIndex;
  doc: TypedRenameCursorDocument;
};

/**
 * Every `{kind:"reference"}` node's own span is in the exact same logical
 * coordinate system as the owning field's `payloadSpans.<field>` (proven by
 * reading real compiled offsets against source text - unlike template holes'
 * attribute-value-local convention, an initializer/set-RHS expression's own
 * spans are not re-based to zero). Projecting one to physical therefore only
 * needs the shared delta between the field's own logical and physical start,
 * mirroring createTemplateHoleRangeIndex's identical `project` idiom.
 */
const referenceBindingIdAtLogicalCursor = (
  expression: TypedScalarExpression,
  physicalField: DslPhysicalSegment,
  logicalField: DslSpan,
  cursor: number
): BindingId | null => {
  for (const reference of referencesIn(expression)) {
    const from = physicalField.from + (reference.nameSpan.start - logicalField.start);
    const to = physicalField.from + (reference.nameSpan.end - logicalField.start);
    if (cursor >= from && cursor < to) return reference.bindingId;
  }
  return null;
};

const templateHoleTargetAtCursor = (context: TypedRenameCursorContext, cursor: number): BindingId | null => {
  for (const [occurrenceKey, occurrence] of context.templateHoleRanges) {
    const hole = occurrence.holes.find((candidate) => cursor >= candidate.outer.from && cursor < candidate.outer.to);
    if (!hole) continue;
    const dependency = context.doc.textTemplates?.get(occurrenceKey)?.dependencies[hole.holeIndex];
    if (dependency) return dependency.bindingId;
  }
  return null;
};

const propertyBindingTargetAtCursor = (context: TypedRenameCursorContext, cursor: number): BindingId | null => {
  for (const range of context.propertyBindingRanges.values()) {
    if (cursor < range.span.from || cursor >= range.span.to) continue;
    const source = context.doc.propertyBindings?.get(range.occurrenceKey);
    if (source?.kind === "binding") return source.bindingId;
  }
  return null;
};

const numericBindingTargetAtCursor = (context: TypedRenameCursorContext, cursor: number): BindingId | null => {
  for (const [key, numeric] of context.doc.numericBindings ?? []) {
    void key;
    for (const reference of numeric.references) {
      const segment = reference.physicalNameSpan?.segments.length === 1 ? reference.physicalNameSpan.segments[0] : null;
      if (!segment) continue;
      const { from, to } = segment;
      if (cursor >= from && cursor < to) return reference.bindingId;
    }
  }
  return null;
};

const setStatementTargetAtCursor = (context: TypedRenameCursorContext, cursor: number): BindingId | null => {
  const setStatementId = setStatementIdAtCursor(context.setStatementRanges, cursor);
  if (!setStatementId) return null;
  const fields = context.setStatementFieldRanges.get(setStatementId);
  if (!fields) return null;

  if (fields.target && cursor >= fields.target.from && cursor <= fields.target.to) {
    return context.doc.setStatements?.get(fields.statementIndex)?.targetBindingId ?? null;
  }

  if (fields.expression && cursor >= fields.expression.from && cursor <= fields.expression.to) {
    const statement = context.doc.statements[fields.statementIndex];
    const analysis = context.doc.setStatements?.get(fields.statementIndex);
    if (statement?.kind === "set" && analysis) {
      return referenceBindingIdAtLogicalCursor(analysis.expression, fields.expression, statement.payloadSpans.expression, cursor);
    }
  }

  return null;
};

const typedDeclarationTargetAtCursor = (context: TypedRenameCursorContext, cursor: number): BindingId | null => {
  const bindingId = typedDeclarationBindingIdAtCursor(context.typedDeclarationRanges, cursor);
  if (!bindingId) return null;

  const fields = context.typedDeclarationFieldRanges.get(bindingId);
  if (fields?.initializer && cursor >= fields.initializer.from && cursor <= fields.initializer.to) {
    const programStatement = context.doc.scalarProgram?.statements.find((candidate) => candidate.bindingId === bindingId);
    const statement = programStatement ? context.doc.statements[programStatement.sourceOrder] : undefined;
    if (programStatement && statement?.kind === "typedDeclaration") {
      const referenced = referenceBindingIdAtLogicalCursor(
        programStatement.declaration.initializer,
        fields.initializer,
        statement.payloadSpans.initializer,
        cursor
      );
      if (referenced) return referenced;
    }
  }

  // Cursor is somewhere else in the declaration statement (name, type
  // annotation, or an initializer position that is not itself a reference,
  // e.g. an operator or literal): rename the declaration itself.
  return bindingId;
};

/**
 * Resolves the single typed binding an F2 press at `cursor` should rename, in
 * priority order from the narrowest possible match to the widest:
 * template-hole reference, property-binding reference, `set` target/RHS
 * reference, then a typed declaration's own name/initializer (an
 * initializer-embedded reference resolves to the *referenced* binding, never
 * the declaring one). Returns null when the cursor is not on any typed
 * construct at all - callers fall back to the existing CAD-element rename
 * path in that case, never guessing.
 */
export const typedRenameTargetBindingIdAtCursor = (context: TypedRenameCursorContext, cursor: number): BindingId | null =>
  templateHoleTargetAtCursor(context, cursor) ??
  numericBindingTargetAtCursor(context, cursor) ??
  propertyBindingTargetAtCursor(context, cursor) ??
  setStatementTargetAtCursor(context, cursor) ??
  typedDeclarationTargetAtCursor(context, cursor);
