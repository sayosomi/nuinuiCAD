import { applyLineSplices, type LineSplice } from "../document/textPatch";
import { documentDslRefs, serializedStatementLines } from "./dslSerializer";
import { serializeTypedDeclaration } from "./dslDeclarationSerializer";
import { serializeElementStatementBlock } from "./dslSerializeElement";
import { serializeSetStatement } from "./dslSetSerializer";
import { DSL_INDENT, formatDslName, splitDslComment } from "./dslTokens";
import type { CompiledDslDocument, StatementInfo } from "./dslDocument";
import type { DslStatement } from "./dslTypes";

/** The narrow canonical-source boundary consumed by this DSL-only module. */
export type Nui3CanonicalSource = {
  sourceText: string;
  docText: string;
  doc: CompiledDslDocument & { document: NonNullable<CompiledDslDocument["document"]>; statementMap: NonNullable<CompiledDslDocument["statementMap"]> };
};

/**
 * nui 3-only statement serializer facade.
 *
 * This deliberately composes the serializers owned by Tasks 07/10/29.  It
 * never formats a scalar AST, resolves an ID back into source, or evaluates a
 * runtime value.  A statement that needs information those serializers do not
 * own is left unavailable rather than reconstructed speculatively.
 */
export type Nui3StatementSerialization =
  | { status: "serialized"; replacementLines: readonly string[] }
  | { status: "unavailable"; reason: string };

export type Nui3StatementPatch =
  | { status: "ready"; splices: readonly LineSplice[] }
  | { status: "noop"; reason: string };

export type Nui3DocumentSerialization =
  | { status: "serialized"; sourceText: string; splices: readonly LineSplice[] }
  | { status: "noop"; reason: string };

const sourceMatchesCompiledDocument = (current: Nui3CanonicalSource): boolean =>
  current.docText === current.sourceText &&
  current.doc.statementMap.sourceRevision === current.doc.statements[0]?.sourceRevision;

const isNui3FreshDocument = (current: Nui3CanonicalSource): boolean =>
  current.doc.majorVersion === 3 && sourceMatchesCompiledDocument(current);

const statementInfoAt = (
  compiled: CompiledDslDocument,
  statementIndex: number
): { statement: DslStatement; info: StatementInfo } | null => {
  const statement = compiled.statements[statementIndex];
  const info = compiled.statementMap?.statements[statementIndex];
  if (!statement || !info) return null;
  if (info.statementIndex !== statementIndex || info.kind !== statement.kind) return null;
  if (info.line !== statement.line || info.endLine !== statement.endLine) return null;
  if (info.line < 1 || info.endLine < info.line || info.endLine > compiled.sourceLines.length) return null;
  return { statement, info };
};

const hasSourceOwnedScalarValue = (compiled: CompiledDslDocument, statementIndex: number): boolean => {
  const prefix = `${statementIndex}:`;
  return [compiled.propertyBindings, compiled.conditionalGroupConditions, compiled.textTemplates]
    .some((entries) => [...(entries?.keys() ?? [])].some((key) => key.startsWith(prefix)));
};

/**
 * The Task 07 serializer is safe for a statement only when its scalar-valued
 * source has not been compiled into a separate source-owned representation.
 * Those representations intentionally have no reverse serializer in Task 46.
 */
const serializeElementStatement = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  statement: Extract<DslStatement, { kind: "element" | "group" }>,
  indent: string
): Nui3StatementSerialization => {
  if (!compiled.document || !compiled.statementMap) return { status: "unavailable", reason: "last-good-document" };
  if (hasSourceOwnedScalarValue(compiled, statementIndex)) {
    return { status: "unavailable", reason: "source-owned-scalar-value" };
  }
  const elementId = compiled.statementMap.elementIdByStatementIndex.get(statementIndex);
  const element = elementId ? compiled.document.elements.find((candidate) => candidate.id === elementId) : undefined;
  if (!element) return { status: "unavailable", reason: "missing-element" };

  const serialized = serializeElementStatementBlock(element, documentDslRefs(compiled.document.elements, 3));
  if (!serialized.close) {
    if (!statement.opensBlock || serialized.args.length > 0) return { status: "unavailable", reason: "unsupported-container" };
    return { status: "serialized", replacementLines: [`${indent}${serialized.header} {`] };
  }
  return { status: "serialized", replacementLines: serializedStatementLines(serialized, indent) };
};

export const serializeNui3Statement = (
  compiled: CompiledDslDocument,
  statementIndex: number
): Nui3StatementSerialization => {
  if (compiled.majorVersion !== 3 || !compiled.document || !compiled.statementMap) {
    return { status: "unavailable", reason: "nui3-document-required" };
  }
  const located = statementInfoAt(compiled, statementIndex);
  if (!located) return { status: "unavailable", reason: "statement-range-mismatch" };
  // Reuse Task 07's physical-line indentation convention.  This prefix is
  // derived from the parser-owned statement depth, never from surrounding rows.
  const indent = DSL_INDENT.repeat(located.info.indentDepth);

  switch (located.statement.kind) {
    case "typedDeclaration":
      return { status: "serialized", replacementLines: [`${indent}${serializeTypedDeclaration(located.statement)}`] };
    case "set":
      return { status: "serialized", replacementLines: [`${indent}${serializeSetStatement(located.statement)}`] };
    case "reverse":
      return { status: "serialized", replacementLines: [`${indent}reverse ${formatDslName(located.statement.name)}`] };
    case "element":
    case "group":
      return serializeElementStatement(compiled, statementIndex, located.statement, indent);
    default:
      return { status: "unavailable", reason: "statement-kind-not-registered" };
  }
};

const statementSplice = (
  current: Nui3CanonicalSource,
  statementIndex: number
): Nui3StatementPatch => {
  if (!isNui3FreshDocument(current)) return { status: "noop", reason: "stale-or-non-nui3-document" };
  const located = statementInfoAt(current.doc, statementIndex);
  if (!located) return { status: "noop", reason: "statement-range-mismatch" };
  const serialized = serializeNui3Statement(current.doc, statementIndex);
  if (serialized.status !== "serialized") return { status: "noop", reason: serialized.reason };
  const sourceLines = current.doc.sourceLines.slice(located.info.line - 1, located.info.endLine);
  const comments = sourceLines.map((line) => splitDslComment(line).comment).filter(Boolean);
  if (comments.length > 0 && (sourceLines.length !== 1 || serialized.replacementLines.length !== 1)) {
    return { status: "noop", reason: "commented-multiline-statement" };
  }
  const replacementLines = comments.length === 0
    ? serialized.replacementLines
    : [`${serialized.replacementLines[0]}${comments[0]}`];
  return {
    status: "ready",
    splices: [{
      startLine: located.info.line,
      endLine: located.info.endLine,
      replacementLines: [...replacementLines]
    }]
  };
};

/** Builds exactly one current-source splice for a reconciler-owned statement ID. */
export const buildNui3StatementPatch = (
  current: Nui3CanonicalSource,
  statementId: string
): Nui3StatementPatch => {
  if (!isNui3FreshDocument(current)) return { status: "noop", reason: "stale-or-non-nui3-document" };
  const statementIndex = current.doc.statementMap.statementIndexByStatementId?.get(statementId);
  if (statementIndex === undefined) return { status: "noop", reason: "missing-statement-identity" };
  if (current.doc.statementMap.statementIdByStatementIndex?.get(statementIndex) !== statementId) {
    return { status: "noop", reason: "statement-identity-mismatch" };
  }
  return statementSplice(current, statementIndex);
};

/**
 * Canonicalizes only statements registered above, retaining every other byte
 * of the current nui 3 source.  It is intentionally not a save/open API.
 */
export const serializeNui3Document = (current: Nui3CanonicalSource): Nui3DocumentSerialization => {
  if (!isNui3FreshDocument(current)) return { status: "noop", reason: "stale-or-non-nui3-document" };
  const splices: LineSplice[] = [];
  for (let statementIndex = 0; statementIndex < current.doc.statements.length; statementIndex += 1) {
    const result = statementSplice(current, statementIndex);
    if (result.status === "ready") splices.push(...result.splices);
  }
  if (splices.length === 0) return { status: "noop", reason: "no-registered-statements" };
  return { status: "serialized", sourceText: applyLineSplices(current.sourceText, splices), splices };
};
