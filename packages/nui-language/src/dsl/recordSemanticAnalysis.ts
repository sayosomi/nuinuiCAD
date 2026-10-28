import { matchingDslDelimiter, scanCallArgs } from "./dslArgScanner";
import type { DslDiagnostic, DslDiagnosticPresentation, DslRecordTypeReference, DslSpan, DslStatement } from "./dslTypes";
import type { DslPhysicalSpan } from "./logicalStatementSourceMap";
import { parseDslSourceReference } from "./dslReferenceTokens";
import type { SourceLexicalLookupWithExternal, SourceLexicalExternalNamespaceMember } from "./sourceLexicalNamespaceIndex";
import { isBareDslIdentifierChar } from "./dslTokens";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import type { ScalarExpressionType } from "../scalars/types";
import { numericGeometryPropertySupportedByStaticTarget, numericGeometryStaticTargetForModuleInterface } from "../geometry/numericGeometryProperties";
import { dslValueTypeWithRecordIdentity, isDslRecordValueType, isDslGeometryValueType, scalarExpressionTypeOfDslValueType } from "./dslValueTypes";
import type { DslValueType } from "./dslValueTypes";
import { dslCoalesceResultType, dslRequiredValueTypeOf, isDslArrayValueType, isDslOptionalValueType, nominalRecordTypeOfDslValueType } from "./dslValueTypes";
import { parseScalarExpression } from "../scalars/expressionParser";
import { parseGeometryArrayExpression, type GeometryArrayExpression } from "./geometryArrayExpression";
import { encodeIdentityTuple } from "../document/identityTuple";

export type RecordTypeIdentity = string;

/** The original defining document remains part of nominal identity across facades. */
export const documentRecordTypeIdentity = (documentId: string, statementId: string): RecordTypeIdentity =>
  `record-type:${encodeIdentityTuple([documentId, statementId])}`;
export type RecordValueIdentity = string;

export type RecordFieldIdentity = {
  recordStatementId: RecordTypeIdentity;
  fieldIndex: number;
};

export type RecordFieldSemantic = {
  identity: RecordFieldIdentity;
  fieldIndex: number;
  name: string;
  type: DslValueType;
  nameSpan: DslSpan;
  typeSpan: DslSpan;
};

export type RecordDefinitionSemantic = {
  statementId: RecordTypeIdentity;
  statementIndex: number;
  name: string;
  fields: readonly RecordFieldSemantic[];
};

export type RecordTypeReferenceSemantic = {
  sourceName: string;
  span: DslSpan;
  typeIdentity: RecordTypeIdentity | null;
  resolution: "resolved" | "undefined" | "forward" | "ambiguous" | "notRecord";
};

export type RecordConstructorFieldSemantic = {
  field: RecordFieldIdentity;
  fieldName: string;
  labelSpan: DslSpan;
  value: string;
  valueSpan: DslSpan;
  expectedType: DslValueType;
};

export type RecordConstructorSemantic = {
  name: string;
  nameSpan: DslSpan;
  targetTypeIdentity: RecordTypeIdentity | null;
  fields: readonly RecordConstructorFieldSemantic[];
};

export type RecordConstructorParseIssue = {
  code: string;
  span: DslSpan;
  message: string;
  presentation?: DslDiagnosticPresentation;
};

/**
 * Parses the already-recognized named fields of a record constructor. Record
 * semantic analysis remains the owner of constructor shape and field identity;
 * Module semantic analysis uses this narrow parser for inline Module
 * arguments without inventing a second constructor grammar.
 */
export type RecordConstructorParseResult = {
  name: string;
  nameSpan: DslSpan;
  argsSpan: DslSpan;
  fields: readonly RecordConstructorFieldSemantic[];
  issues: readonly RecordConstructorParseIssue[];
};

export type RecordValueReferenceSemantic = {
  name: string;
  span: DslSpan;
  targetTypeIdentity: RecordTypeIdentity | null;
  valueType?: DslValueType;
  /** Alias proven non-optional inside its owning some arm. */
  optionalMatchBinder?: true;
};

/** Record-valued control flow keeps its scalar condition/scrutinee AST, while
 * constructor/reference leaves stay owned by this nominal-record analyzer. */
export type RecordValueExpressionSemantic =
  | {
      kind: "constructor";
      span: DslSpan;
      constructor: RecordConstructorSemantic;
      valueType?: DslValueType;
    }
  | {
      kind: "reference";
      span: DslSpan;
      reference: RecordValueReferenceSemantic;
      valueType?: DslValueType;
    }
  | {
      kind: "none";
      span: DslSpan;
      valueType?: DslValueType;
    }
  | {
      kind: "coalesce";
      span: DslSpan;
      left: RecordValueExpressionSemantic | null;
      right: RecordValueExpressionSemantic | null;
      valueType?: DslValueType;
    }
  | {
      kind: "collectionIndex";
      span: DslSpan;
      expression: Extract<ScalarExpressionAst, { kind: "collectionIndex" }>;
      valueType?: DslValueType;
  }
  | {
      kind: "if";
      span: DslSpan;
      condition: ScalarExpressionAst;
      thenBranch: RecordValueExpressionSemantic | null;
      elseBranch: RecordValueExpressionSemantic | null;
      valueType?: DslValueType;
  }
  | {
      kind: "match";
      span: DslSpan;
      scrutinee: ScalarExpressionAst;
      optionalRecordMatch?: true;
      arms: readonly {
        label: string;
        labelSpan: DslSpan;
        binder?: string;
        binderSpan?: DslSpan;
        expression: RecordValueExpressionSemantic | null;
      }[];
      valueType?: DslValueType;
    };

export type RecordValueSemantic = {
  statementId: RecordValueIdentity;
  statementIndex: number;
  name: string;
  typeReference: RecordTypeReferenceSemantic;
  typeIdentity: RecordTypeIdentity | null;
  constructor: RecordConstructorSemantic | null;
  reference: RecordValueReferenceSemantic | null;
  valueExpression: RecordValueExpressionSemantic | null;
  declaredValueType?: DslValueType;
  /** An immutable literal occurrence owned by an authored collection statement. */
  inlineCollectionMember?: { collectionStatementId: string; span: DslSpan };
};

export type RecordModuleParameterSemantic = {
  definitionStatementId: string;
  parameterIndex: number;
  name: string;
  typeReference: RecordTypeReferenceSemantic;
  typeIdentity: RecordTypeIdentity | null;
  valueType?: DslValueType;
};

export type RecordSemanticAnalysis = {
  definitionsByStatementId: ReadonlyMap<RecordTypeIdentity, RecordDefinitionSemantic>;
  definitionsByStatementIndex: ReadonlyMap<number, RecordDefinitionSemantic>;
  valuesByStatementId: ReadonlyMap<RecordValueIdentity, RecordValueSemantic>;
  valuesByStatementIndex: ReadonlyMap<number, RecordValueSemantic>;
  moduleParameters: readonly RecordModuleParameterSemantic[];
  diagnostics: readonly DslDiagnostic[];
};

export type RecordSemanticAnalysisInput = {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  resolveDeclaration: (statementIndex: number, name: string) => SourceLexicalLookupWithExternal;
  identityForDefinition?: (statementId: string) => string;
  externalDefinitions?: ReadonlyMap<string, RecordDefinitionSemantic>;
  resolveExternalDefinition?: (member: SourceLexicalExternalNamespaceMember) => RecordDefinitionSemantic | null;
  deferImportedTypes?: boolean;
};

const projectSpan = (statement: DslStatement, span: DslSpan): DslPhysicalSpan | null => {
  const segments: { from: number; to: number }[] = [];
  let logicalStart = 0;
  for (const segment of statement.physicalSpan.segments) {
    const length = segment.to - segment.from;
    const logicalEnd = logicalStart + length;
    const from = Math.max(span.start, logicalStart);
    const to = Math.min(span.end, logicalEnd);
    if (from < to) {
      segments.push({
        from: segment.from + from - logicalStart,
        to: segment.from + to - logicalStart
      });
    }
    logicalStart = logicalEnd + 1;
  }
  return segments.length > 0 ? { segments, sourceRevision: statement.sourceRevision } : null;
};

const diagnostic = (
  statement: DslStatement,
  span: DslSpan,
  code: string,
  message: string,
  parameters?: Readonly<Record<string, string | number | boolean>>
): DslDiagnostic => {
  const physicalSpan = projectSpan(statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    presentation: {
      key: `diagnostic.${code}`,
      ...(parameters ? { parameters } : {})
    },
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

const definitionIdAt = (
  stableStatementIdByIndex: ReadonlyMap<number, string>,
  statementIndex: number,
  owner: string
) => {
  const id = stableStatementIdByIndex.get(statementIndex);
  if (id === undefined) throw new Error(`recordSemanticAnalysis: no stable statement identity for ${owner} at index ${statementIndex}`);
  return id;
};

const resolveRecordType = (
  input: RecordSemanticAnalysisInput,
  definitionsByStatementIndex: ReadonlyMap<number, RecordDefinitionSemantic>,
  statement: DslStatement,
  statementIndex: number,
  type: DslRecordTypeReference,
  span: DslSpan,
  diagnostics: DslDiagnostic[]
): RecordTypeReferenceSemantic => {
  const lookup = input.resolveDeclaration(statementIndex, type.name);
  if (lookup.kind === "external") {
    const definition = input.resolveExternalDefinition?.(lookup.member);
    if (definition) return { sourceName: type.name, span, typeIdentity: definition.statementId, resolution: "resolved" };
  }
  if (input.deferImportedTypes && type.name.includes("::")) return { sourceName: type.name, span, typeIdentity: null, resolution: "undefined" };
  if (lookup.kind === "external") {
    diagnostics.push(diagnostic(statement, span, "record-type-not-record", `型名「${type.name}」は record definition を参照していません。`, { name: type.name }));
    return { sourceName: type.name, span, typeIdentity: null, resolution: "notRecord" };
  }
  if (lookup.kind === "resolved") {
    if (lookup.declaration.kind === "recordDefinition") {
      const definition = definitionsByStatementIndex.get(lookup.declaration.statementIndex);
      if (definition) return { sourceName: type.name, span, typeIdentity: definition.statementId, resolution: "resolved" };
    }
    diagnostics.push(diagnostic(statement, span, "record-type-not-record", `型名「${type.name}」は record definition を参照していません。`, { name: type.name }));
    return { sourceName: type.name, span, typeIdentity: null, resolution: "notRecord" };
  }
  if (lookup.kind === "forward") {
    diagnostics.push(diagnostic(statement, span, "record-type-forward-reference", `record 型「${type.name}」はこの位置より後で宣言されているため、まだ参照できません。`, { name: type.name }));
    return { sourceName: type.name, span, typeIdentity: null, resolution: "forward" };
  }
  if (lookup.kind === "ambiguous") {
    diagnostics.push(diagnostic(statement, span, "record-type-ambiguous", `record 型「${type.name}」は複数の宣言と一致するため一意に解決できません。`, { name: type.name }));
    return { sourceName: type.name, span, typeIdentity: null, resolution: "ambiguous" };
  }
  diagnostics.push(diagnostic(statement, span, "record-type-undefined", `未定義の record 型「${type.name}」を参照しています。`, { name: type.name }));
  return { sourceName: type.name, span, typeIdentity: null, resolution: "undefined" };
};

const isBareIdentifier = (text: string) => text.length > 0 && [...text].every((character) => isBareDslIdentifierChar(character));

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && /\s/.test(source[start]!)) start += 1;
  while (end > start && /\s/.test(source[end - 1]!)) end -= 1;
  return { start, end };
};

type ConstructorCandidate = {
  name: string;
  nameSpan: DslSpan;
  argsSpan: DslSpan;
};

const constructorCandidate = (
  initializer: string,
  initializerSpan: DslSpan
): ConstructorCandidate | null => {
  const local = trimSpan(initializer, 0, initializer.length);
  const open = initializer.indexOf("(", local.start);
  if (open < 0) return null;
  const nameSpanLocal = trimSpan(initializer, local.start, open);
  const name = initializer.slice(nameSpanLocal.start, nameSpanLocal.end);
  if (!name.split("::").every(isBareIdentifier)) return null;
  const close = matchingDslDelimiter(initializer, open);
  if (close < 0) return null;
  const trailing = trimSpan(initializer, close + 1, initializer.length);
  if (trailing.start < trailing.end) return null;
  return {
    name,
    nameSpan: { start: initializerSpan.start + nameSpanLocal.start, end: initializerSpan.start + nameSpanLocal.end },
    argsSpan: { start: initializerSpan.start + open + 1, end: initializerSpan.start + close }
  };
};

export const parseRecordConstructorFields = ({
  initializer,
  initializerSpan,
  definition
}: {
  initializer: string;
  initializerSpan: DslSpan;
  definition: RecordDefinitionSemantic;
}): RecordConstructorParseResult | null => {
  const candidate = constructorCandidate(initializer, initializerSpan);
  if (!candidate) return null;
  const localArgsSpan = {
    start: candidate.argsSpan.start - initializerSpan.start,
    end: candidate.argsSpan.end - initializerSpan.start
  };
  const scanned = scanCallArgs(initializer, localArgsSpan);
  const issues: RecordConstructorParseIssue[] = scanned.errors.map((error) => ({
    code: error.code ?? "record-constructor-invalid-argument",
    span: {
      start: initializerSpan.start + error.span.start,
      end: initializerSpan.start + error.span.end
    },
    message: error.message,
    ...(error.presentation ? { presentation: error.presentation } : {})
  }));
  const knownFields = new Map(definition.fields.map((field) => [field.name, field] as const));
  const firstLabel = new Set<string>();
  const fields: RecordConstructorFieldSemantic[] = [];
  for (const argument of scanned.args) {
    const valueSpan = {
      start: initializerSpan.start + argument.valueSpan.start,
      end: initializerSpan.start + argument.valueSpan.end
    };
    if (argument.key === null || !argument.keySpan) {
      issues.push({
        code: "record-constructor-positional-argument",
        span: valueSpan,
        message: "record constructor の引数は named-only です。"
      });
      continue;
    }
    const labelSpan = {
      start: initializerSpan.start + argument.keySpan.start,
      end: initializerSpan.start + argument.keySpan.end
    };
    if (firstLabel.has(argument.key)) {
      issues.push({
        code: "record-constructor-duplicate-field",
        span: labelSpan,
        message: `record constructor field「${argument.key}」が重複しています。`,
        presentation: { key: "diagnostic.record-constructor-duplicate-field", parameters: { field: argument.key } }
      });
      continue;
    }
    firstLabel.add(argument.key);
    const field = knownFields.get(argument.key);
    if (!field) {
      issues.push({
        code: "record-constructor-unknown-field",
        span: labelSpan,
        message: `record「${definition.name}」に field「${argument.key}」はありません。`,
        presentation: { key: "diagnostic.record-constructor-unknown-field", parameters: { record: definition.name, field: argument.key } }
      });
      continue;
    }
    fields.push({
      field: field.identity,
      fieldName: field.name,
      labelSpan,
      value: argument.value,
      valueSpan,
      expectedType: field.type
    });
  }
  for (const field of definition.fields) {
    if (!firstLabel.has(field.name)) {
      if (isDslOptionalValueType(field.type)) continue;
      issues.push({
        code: "record-constructor-missing-field",
        span: candidate.nameSpan,
        message: `record constructor「${definition.name}」に必須 field「${field.name}」がありません。`,
        presentation: { key: "diagnostic.record-constructor-missing-field", parameters: { record: definition.name, field: field.name } }
      });
    }
  }
  return {
    name: candidate.name,
    nameSpan: candidate.nameSpan,
    argsSpan: candidate.argsSpan,
    fields: definition.fields.flatMap((field) => {
      const supplied = fields.find((entry) => entry.field.fieldIndex === field.fieldIndex);
      if (supplied) return [supplied];
      if (!isDslOptionalValueType(field.type)) return [];
      return [{
        field: field.identity,
        fieldName: field.name,
        labelSpan: field.nameSpan,
        value: "none",
        valueSpan: field.nameSpan,
        expectedType: field.type
      }];
    }),
    issues
  };
};

const moduleOwnerIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const owner = statements[enclosing.statementIndex];
    if (owner?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = owner?.enclosing ?? null;
  }
  return null;
};

const referenceSpan = (initializer: string, initializerSpan: DslSpan): DslSpan => {
  const startOffset = initializer.length - initializer.trimStart().length;
  const endOffset = initializer.trimEnd().length;
  return { start: initializerSpan.start + startOffset, end: initializerSpan.start + endOffset };
};

const recordModuleParameterAt = (
  statements: readonly DslStatement[],
  stableStatementIdByIndex: ReadonlyMap<number, string>,
  moduleParameterTypeByDefinitionAndIndex: ReadonlyMap<string, RecordModuleParameterSemantic>,
  statementIndex: number,
  name: string
): RecordModuleParameterSemantic | null => {
  const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
  if (ownerIndex === null) return null;
  const owner = statements[ownerIndex];
  if (owner?.kind !== "moduleDefinition") return null;
  const parameterIndex = owner.parameters.findIndex(
    (parameter) => parameter.name === name && parameter.recordTypeReference !== null && parameter.recordTypeReference !== undefined
  );
  const ownerId = stableStatementIdByIndex.get(ownerIndex);
  return parameterIndex >= 0 && ownerId
    ? moduleParameterTypeByDefinitionAndIndex.get(`${ownerId}:${parameterIndex}`) ?? null
    : null;
};

type RecordValueLeafAnalysis = {
  constructor: RecordConstructorSemantic | null;
  reference: RecordValueReferenceSemantic | null;
  collectionIndex: Extract<ScalarExpressionAst, { kind: "collectionIndex" }> | null;
};

const analyzeRecordValueLeaf = ({
  statements,
  stableStatementIdByIndex,
  input,
  definitionsByStatementIndex,
  valuesByStatementIndex,
  moduleParameterTypeByDefinitionAndIndex,
  statement,
  statementIndex,
  initializer,
  initializerSpan,
  expectedTypeReference,
  diagnostics
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  input: RecordSemanticAnalysisInput;
  definitionsByStatementIndex: ReadonlyMap<number, RecordDefinitionSemantic>;
  valuesByStatementIndex: ReadonlyMap<number, RecordValueSemantic>;
  moduleParameterTypeByDefinitionAndIndex: ReadonlyMap<string, RecordModuleParameterSemantic>;
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>;
  statementIndex: number;
  initializer: string;
  initializerSpan: DslSpan;
  expectedTypeReference: RecordTypeReferenceSemantic;
  diagnostics: DslDiagnostic[];
}): RecordValueLeafAnalysis => {
  const paddedInitializer = `${" ".repeat(initializerSpan.start)}${initializer}`;
  const parsedScalar = parseScalarExpression(paddedInitializer, initializerSpan);
  if (parsedScalar.ast?.kind === "collectionIndex") {
    return { constructor: null, reference: null, collectionIndex: parsedScalar.ast };
  }

  if (initializer.trimStart().startsWith("@")) {
    const parsedReference = parseDslSourceReference(initializer);
    const span = referenceSpan(initializer, initializerSpan);
    if (
      parsedReference.kind !== "valid" ||
      parsedReference.reference.path.absolute ||
      parsedReference.reference.path.segments.length === 0 ||
      parsedReference.reference.property !== null
    ) {
      diagnostics.push(diagnostic(statement, span, "record-reference-invalid", "record 値の参照は v1 では単一の whole-record `@name` 参照で指定してください。"));
      return { constructor: null, reference: null, collectionIndex: null };
    }
    const name = parsedReference.reference.pathText;
    let targetTypeIdentity: RecordTypeIdentity | null = null;
    let targetValueType: DslValueType | undefined;
    const lookup = parsedReference.reference.path.segments.length === 1
      ? input.resolveDeclaration(statementIndex, name)
      : null;
    const parameterSemantic = lookup === null || lookup.kind === "resolved" || lookup.kind === "ambiguous"
      ? null
      : recordModuleParameterAt(
          statements,
          stableStatementIdByIndex,
          moduleParameterTypeByDefinitionAndIndex,
          statementIndex,
          name
        );
    if (lookup !== null && lookup.kind === "resolved") {
      if (lookup.declaration.kind === "recordValue") {
        const target = valuesByStatementIndex.get(lookup.declaration.statementIndex);
        targetTypeIdentity = target?.typeIdentity ?? null;
        targetValueType = target?.declaredValueType;
      } else {
        diagnostics.push(diagnostic(statement, span, "record-reference-not-record", `参照「@${name}」は利用可能な record 値または record Module parameter ではありません。`, { name }));
      }
    } else if (lookup !== null && lookup.kind === "ambiguous") {
      diagnostics.push(diagnostic(statement, span, "record-value-ambiguous", `record 値「${name}」は複数の宣言と一致するため一意に解決できません。`, { name }));
    } else if (lookup !== null && parameterSemantic) {
      targetTypeIdentity = parameterSemantic.typeIdentity;
      targetValueType = parameterSemantic.valueType;
    } else if (lookup !== null && lookup.kind === "forward" && lookup.declarations.some((declaration) => declaration.kind === "recordValue")) {
      diagnostics.push(diagnostic(statement, span, "record-value-forward-reference", `record 値「${name}」はこの位置より後で宣言されているため、まだ参照できません。`, { name }));
    } else if (lookup !== null) {
      diagnostics.push(diagnostic(statement, span, "record-reference-not-record", `参照「@${name}」は利用可能な record 値または record Module parameter ではありません。`, { name }));
    }
    if (targetTypeIdentity && expectedTypeReference.typeIdentity && targetTypeIdentity !== expectedTypeReference.typeIdentity) {
      diagnostics.push(diagnostic(statement, span, "record-nominal-type-mismatch", `参照「@${name}」の nominal record 型は宣言された型「${expectedTypeReference.sourceName}」と一致しません。`, { name, expected: expectedTypeReference.sourceName }));
    }
    return {
      constructor: null,
      reference: { name, span, targetTypeIdentity, ...(targetValueType ? { valueType: targetValueType } : {}) },
      collectionIndex: null
    };
  }

  const candidate = constructorCandidate(initializer, initializerSpan);
  if (!candidate) {
    diagnostics.push(diagnostic(statement, initializerSpan, "record-constructor-invalid", "record 値の初期化には `RecordName(field: value, ...)` constructor または同型 record 参照を指定してください。"));
    return { constructor: null, reference: null, collectionIndex: null };
  }
  const targetLookup = input.resolveDeclaration(statementIndex, candidate.name);
  let targetDefinition: RecordDefinitionSemantic | null = null;
  if (targetLookup.kind === "external") {
    targetDefinition = input.resolveExternalDefinition?.(targetLookup.member) ?? null;
    if (!targetDefinition) diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-not-record", `constructor target「${candidate.name}」は record definition ではありません。`, { name: candidate.name }));
  } else if (input.deferImportedTypes && candidate.name.includes("::")) {
    // The saved graph supplies this definition after its dependency catalogs are complete.
  } else if (targetLookup.kind === "resolved") {
    if (targetLookup.declaration.kind === "recordDefinition") {
      targetDefinition = definitionsByStatementIndex.get(targetLookup.declaration.statementIndex) ?? null;
    } else {
      diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-not-record", `constructor target「${candidate.name}」は record definition ではありません。`, { name: candidate.name }));
    }
  } else if (targetLookup.kind === "forward") {
    diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-forward-reference", `record constructor「${candidate.name}」はこの位置より後で宣言されているため、まだ使用できません。`, { name: candidate.name }));
  } else if (targetLookup.kind === "ambiguous") {
    diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-ambiguous", `record constructor「${candidate.name}」は複数の宣言と一致するため一意に解決できません。`, { name: candidate.name }));
  } else {
    diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-undefined", `未定義の record constructor「${candidate.name}」を参照しています。`, { name: candidate.name }));
  }
  if (targetDefinition && expectedTypeReference.typeIdentity && targetDefinition.statementId !== expectedTypeReference.typeIdentity) {
    diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-nominal-type-mismatch", `constructor「${candidate.name}」の nominal record 型は宣言された型「${expectedTypeReference.sourceName}」と一致しません。`, { name: candidate.name, expected: expectedTypeReference.sourceName }));
  }
  const localArgsSpan = {
    start: candidate.argsSpan.start - initializerSpan.start,
    end: candidate.argsSpan.end - initializerSpan.start
  };
  const scanned = scanCallArgs(initializer, localArgsSpan);
  for (const error of scanned.errors) {
    const span = { start: initializerSpan.start + error.span.start, end: initializerSpan.start + error.span.end };
    diagnostics.push(diagnostic(statement, span, error.code ?? "record-constructor-invalid-argument", error.message, error.presentation?.parameters));
  }
  const knownFields = new Map(targetDefinition?.fields.map((field) => [field.name, field] as const) ?? []);
  const firstLabel = new Set<string>();
  const fields: RecordConstructorFieldSemantic[] = [];
  for (const argument of scanned.args) {
    const valueSpan = { start: initializerSpan.start + argument.valueSpan.start, end: initializerSpan.start + argument.valueSpan.end };
    if (argument.key === null || !argument.keySpan) {
      diagnostics.push(diagnostic(statement, valueSpan, "record-constructor-positional-argument", "record constructor の引数は named-only です。"));
      continue;
    }
    const labelSpan = { start: initializerSpan.start + argument.keySpan.start, end: initializerSpan.start + argument.keySpan.end };
    if (firstLabel.has(argument.key)) {
      diagnostics.push(diagnostic(statement, labelSpan, "record-constructor-duplicate-field", `record constructor field「${argument.key}」が重複しています。`, { field: argument.key }));
      continue;
    }
    firstLabel.add(argument.key);
    const field = knownFields.get(argument.key);
    if (!field) {
      if (targetDefinition) diagnostics.push(diagnostic(statement, labelSpan, "record-constructor-unknown-field", `record「${targetDefinition.name}」に field「${argument.key}」はありません。`, { record: targetDefinition.name, field: argument.key }));
      continue;
    }
    fields.push({
      field: field.identity,
      fieldName: field.name,
      labelSpan,
      value: argument.value,
      valueSpan,
      expectedType: field.type
    });
  }
  if (targetDefinition) {
    for (const field of targetDefinition.fields) {
      if (!firstLabel.has(field.name)) {
        if (isDslOptionalValueType(field.type)) continue;
        diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-missing-field", `record constructor「${targetDefinition.name}」に必須 field「${field.name}」がありません。`, { record: targetDefinition.name, field: field.name }));
      }
    }
  }
  return {
    constructor: {
      name: candidate.name,
      nameSpan: candidate.nameSpan,
      targetTypeIdentity: targetDefinition?.statementId ?? null,
      fields: targetDefinition
        ? targetDefinition.fields.flatMap((field) => {
            const supplied = fields.find((entry) => entry.field.fieldIndex === field.fieldIndex);
            if (supplied) return [supplied];
            if (!isDslOptionalValueType(field.type)) return [];
            return [{
              field: field.identity,
              fieldName: field.name,
              labelSpan: field.nameSpan,
              value: "none",
              valueSpan: field.nameSpan,
              expectedType: field.type
            }];
          })
        : fields
    },
    reference: null,
    collectionIndex: null
  };
};

export const analyzeRecordSemantics = (input: RecordSemanticAnalysisInput): RecordSemanticAnalysis => {
  const { statements, stableStatementIdByIndex } = input;
  const diagnostics: DslDiagnostic[] = [];
  const definitionsByStatementId = new Map<RecordTypeIdentity, RecordDefinitionSemantic>(input.externalDefinitions);
  const definitionsByStatementIndex = new Map<number, RecordDefinitionSemantic>();
  const valuesByStatementId = new Map<RecordValueIdentity, RecordValueSemantic>();
  const valuesByStatementIndex = new Map<number, RecordValueSemantic>();
  const moduleParameters: RecordModuleParameterSemantic[] = [];

  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "recordDefinition") continue;
    const localId = definitionIdAt(stableStatementIdByIndex, statementIndex, "record definition");
    const statementId = input.identityForDefinition?.(localId) ?? localId;
    const fields = statement.fields.flatMap((field, fieldIndex) =>
      field.type && field.typeSpan
        ? [{
            identity: { recordStatementId: statementId, fieldIndex },
            fieldIndex,
            name: field.name,
            type: field.type,
            nameSpan: field.nameSpan,
            typeSpan: field.typeSpan
          }]
        : []
    );
    const definition: RecordDefinitionSemantic = { statementId, statementIndex, name: statement.name, fields };
    definitionsByStatementId.set(statementId, definition);
    definitionsByStatementIndex.set(statementIndex, definition);
    if (statement.enclosing) {
      diagnostics.push(diagnostic(statement, statement.keywordSpan, "record-definition-not-top-level", "record definition はトップレベルにのみ宣言できます。"));
    }
  }

  // Declaration parsing intentionally leaves nominal record references
  // unresolved. Enrich every record field, including references nested under
  // optional and array wrappers, with the same stable definition identity used
  // by record values and Module parameters before downstream member resolution.
  for (const definition of definitionsByStatementIndex.values()) {
    const statement = statements[definition.statementIndex];
    if (!statement || statement.kind !== "recordDefinition") continue;
    const resolveFieldType = (type: DslValueType, span: DslSpan): DslValueType => {
      if (type.kind === "record") {
        const reference = resolveRecordType(input, definitionsByStatementIndex, statement, definition.statementIndex, type, span, diagnostics);
        if (reference.typeIdentity) return { ...type, identity: reference.typeIdentity };
        // The declaration-level type resolver below owns the user-facing
        // diagnostic. Keep the unresolved source name here so it can still be
        // reported with the original field span.
        return type;
      }
      if (isDslOptionalValueType(type)) {
        const valueType = resolveFieldType(type.valueType, span);
        return valueType === type.valueType ? type : { ...type, valueType: valueType as typeof type.valueType };
      }
      if (isDslArrayValueType(type)) {
        const elementType = resolveFieldType(type.elementType, span);
        return elementType === type.elementType ? type : { ...type, elementType: elementType as typeof type.elementType };
      }
      return type;
    };
    const fields = definition.fields.map((field) => ({
      ...field,
      type: resolveFieldType(field.type, field.typeSpan)
    }));
    const enriched = { ...definition, fields };
    definitionsByStatementIndex.set(definition.statementIndex, enriched);
    definitionsByStatementId.set(definition.statementId, enriched);
  }

  const moduleParameterTypeByDefinitionAndIndex = new Map<string, RecordModuleParameterSemantic>();
  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "moduleDefinition") continue;
    const recordParameters = statement.parameters
      .map((parameter, parameterIndex) => ({ parameter, parameterIndex }))
      .filter(({ parameter }) => parameter.recordTypeReference && parameter.typeSpan);
    if (recordParameters.length === 0) continue;
    const definitionStatementId = definitionIdAt(stableStatementIdByIndex, statementIndex, "module definition");
    for (const { parameter, parameterIndex } of recordParameters) {
      const recordTypeReference = parameter.recordTypeReference!;
      const typeSpan = parameter.typeSpan!;
      const typeReference = resolveRecordType(input, definitionsByStatementIndex, statement, statementIndex, recordTypeReference, typeSpan, diagnostics);
      if (parameter.defaultValue !== null) {
        diagnostics.push(diagnostic(statement, parameter.defaultSpan ?? typeSpan, "record-parameter-default-unsupported", "record 型 Module parameter に default は指定できません。"));
      }
      const semantic: RecordModuleParameterSemantic = {
        definitionStatementId,
        parameterIndex,
        name: parameter.name,
        typeReference,
        typeIdentity: typeReference.typeIdentity,
        ...(parameter.valueType ? { valueType: typeReference.typeIdentity ? dslValueTypeWithRecordIdentity(parameter.valueType, typeReference.typeIdentity) : parameter.valueType } : {})
      };
      moduleParameters.push(semantic);
      moduleParameterTypeByDefinitionAndIndex.set(`${definitionStatementId}:${parameterIndex}`, semantic);
    }
  }

  for (const [statementIndex, statement] of statements.entries()) {
    const recordTypeReference = statement.kind === "typedDeclaration"
      ? nominalRecordTypeOfDslValueType(dslRequiredValueTypeOf(statement.valueType))
      : null;
    if (statement.kind !== "typedDeclaration" || !recordTypeReference) continue;
    const statementId = definitionIdAt(stableStatementIdByIndex, statementIndex, "record value");
    const typeSpan = statement.payloadSpans.type ?? statement.nameSpan ?? statement.keywordSpan;
    const typeReference = resolveRecordType(
      input,
      definitionsByStatementIndex,
      statement,
      statementIndex,
      recordTypeReference,
      typeSpan,
      diagnostics
    );

    const resolvedValueType = statement.valueType && typeReference.typeIdentity
      ? dslValueTypeWithRecordIdentity(statement.valueType, typeReference.typeIdentity) : statement.valueType;
    const initializerSpan = statement.payloadSpans.initializer;
    let constructor: RecordConstructorSemantic | null = null;
    let reference: RecordValueReferenceSemantic | null = null;
    let valueExpression: RecordValueExpressionSemantic | null = null;
    if (initializerSpan) {
      const paddedInitializer = `${" ".repeat(initializerSpan.start)}${statement.initializer}`;
      const parsed = parseScalarExpression(paddedInitializer, initializerSpan, { allowOpaqueNamedCalls: true });
      const dynamicCandidate = /^(?:if\s*\(|match\b|none\s*$)/.test(statement.initializer.trim()) || parsed.ast?.kind === "binary" && parsed.ast.operator === "??";
      if (dynamicCandidate) {
        for (const parseDiagnostic of parsed.diagnostics) {
          diagnostics.push(diagnostic(statement, parseDiagnostic.span, parseDiagnostic.code, parseDiagnostic.message));
        }
        const parseExpression = (node: ScalarExpressionAst, recordBinders: ReadonlyMap<string, RecordValueReferenceSemantic> = new Map()): RecordValueExpressionSemantic | null => {
          const raw = paddedInitializer.slice(node.span.start, node.span.end);
          if (node.kind === "valueIf") {
            const condition = parseScalarExpression(paddedInitializer, node.condition.span);
            for (const error of condition.diagnostics) diagnostics.push(diagnostic(statement, error.span, error.code, error.message));
            if (!condition.ast) return null;
            return {
              kind: "if",
              span: node.span,
              condition: condition.ast,
              thenBranch: parseExpression(node.thenBranch, recordBinders),
              elseBranch: node.elseBranch ? parseExpression(node.elseBranch, recordBinders) : null,
              ...(resolvedValueType ? { valueType: resolvedValueType } : {})
            };
          }
          if (node.kind === "valueMatch") {
            const scrutinee = parseScalarExpression(paddedInitializer, node.scrutinee.span);
            for (const error of scrutinee.diagnostics) diagnostics.push(diagnostic(statement, error.span, error.code, error.message));
            if (!scrutinee.ast) return null;
            const noneArm = node.arms.find(arm => arm.label === "none" && !arm.binder);
            const someArm = node.arms.find(arm => arm.label === "some" && arm.binder);
            // A record binder aliases the resolved whole scrutinee only in
            // its selected some arm. It never becomes a scalar binding.
            const scrutineeLeaf = (noneArm || someArm) && node.scrutinee.kind === "reference" ? analyzeRecordValueLeaf({
              statements, stableStatementIdByIndex, input, definitionsByStatementIndex, valuesByStatementIndex,
              moduleParameterTypeByDefinitionAndIndex, statement, statementIndex,
              initializer: paddedInitializer.slice(node.scrutinee.span.start, node.scrutinee.span.end),
              initializerSpan: node.scrutinee.span, expectedTypeReference: { ...typeReference, typeIdentity: null }, diagnostics: []
            }) : null;
            const indexedScrutinee = (noneArm || someArm) && node.scrutinee.kind === "collectionIndex"
              ? { name: paddedInitializer.slice(node.scrutinee.span.start + 1, node.scrutinee.span.end), span: node.scrutinee.span, targetTypeIdentity: null }
              : null;
            const optionalRecord = indexedScrutinee ? { reference: indexedScrutinee, valueType: undefined } : scrutineeLeaf?.reference && (isDslOptionalValueType(scrutineeLeaf.reference.valueType) ||
              // Qualified exports are resolved by the Module semantic owner.
              // Retain the arm binder until that owner checks its exact type.
              !scrutineeLeaf.reference.targetTypeIdentity && scrutineeLeaf.reference.name.includes("::"))
              ? { reference: scrutineeLeaf.reference, valueType: scrutineeLeaf.reference.valueType } : null;
            return {
              kind: "match",
              span: node.span,
              scrutinee: scrutinee.ast,
              ...(optionalRecord ? { optionalRecordMatch: true as const } : {}),
              arms: node.arms.map((arm) => ({
                label: arm.label,
                labelSpan: arm.labelSpan,
                binder: arm.binder,
                binderSpan: arm.binderSpan,
                expression: parseExpression(arm.expression, optionalRecord && arm.label === "some" && arm.binder
                  ? new Map([...recordBinders, [arm.binder, { ...optionalRecord.reference, valueType: dslRequiredValueTypeOf(optionalRecord.valueType) ?? undefined, optionalMatchBinder: true as const }]])
                  : recordBinders)
              })),
              ...(resolvedValueType ? { valueType: resolvedValueType } : {})
            };
          }
          if (node.kind === "noneLiteral") {
            return { kind: "none", span: node.span, ...(resolvedValueType ? { valueType: resolvedValueType } : {}) };
          }
          if (node.kind === "binary" && node.operator === "??") {
            const left = parseExpression(node.left);
            const right = parseExpression(node.right);
            const resultType = dslCoalesceResultType(left?.valueType ?? (left?.kind === "reference" ? left.reference.valueType : undefined), right?.valueType ?? (right?.kind === "reference" ? right.reference.valueType : undefined));
            if (!resultType) {
              diagnostics.push(diagnostic(statement, node.span, "coalesce-type-mismatch", "?? の record operands は optional な同一 nominal record 型と、その underlying record 型である必要があります。"));
              return null;
            }
            return {
              kind: "coalesce",
              span: node.span,
              left,
              right,
              valueType: resultType
            };
          }
          if (node.kind === "reference" && recordBinders.has(node.name)) {
            const reference = recordBinders.get(node.name)!;
            if (reference.targetTypeIdentity && reference.targetTypeIdentity !== typeReference.typeIdentity) {
              diagnostics.push(diagnostic(statement, node.span, "record-nominal-type-mismatch", "optional record binder の nominal record 型が一致しません。"));
              return null;
            }
            return { kind: "reference", span: node.span, reference: { ...reference, span: node.span }, valueType: reference.valueType };
          }
          const leaf = analyzeRecordValueLeaf({
            statements,
            stableStatementIdByIndex,
            input,
            definitionsByStatementIndex,
            valuesByStatementIndex,
            moduleParameterTypeByDefinitionAndIndex,
            statement,
            statementIndex,
            initializer: raw,
            initializerSpan: node.span,
            expectedTypeReference: typeReference,
            diagnostics
          });
          if (leaf.collectionIndex) return { kind: "collectionIndex", span: node.span, expression: leaf.collectionIndex, valueType: dslRequiredValueTypeOf(resolvedValueType) ?? undefined };
          if (leaf.constructor) return { kind: "constructor", span: node.span, constructor: leaf.constructor, valueType: dslRequiredValueTypeOf(resolvedValueType) ?? undefined };
          if (leaf.reference) return { kind: "reference", span: node.span, reference: leaf.reference, valueType: leaf.reference.valueType };
          return null;
        };
        valueExpression = parsed.ast?.kind === "valueIf" || parsed.ast?.kind === "valueMatch" || parsed.ast?.kind === "binary" && parsed.ast.operator === "??" || parsed.ast?.kind === "noneLiteral"
          ? parseExpression(parsed.ast)
          : null;
      } else {
        const leaf = analyzeRecordValueLeaf({
          statements,
          stableStatementIdByIndex,
          input,
          definitionsByStatementIndex,
          valuesByStatementIndex,
          moduleParameterTypeByDefinitionAndIndex,
          statement,
          statementIndex,
          initializer: statement.initializer,
          initializerSpan,
          expectedTypeReference: typeReference,
          diagnostics
        });
        if (leaf.collectionIndex) {
          valueExpression = { kind: "collectionIndex", span: initializerSpan, expression: leaf.collectionIndex, valueType: resolvedValueType ?? undefined };
        } else {
          constructor = leaf.constructor;
          reference = leaf.reference;
        }
      }
    }

    const value: RecordValueSemantic = {
      statementId,
      statementIndex,
      name: statement.name,
      typeReference,
      typeIdentity: typeReference.typeIdentity,
      constructor,
      reference,
      valueExpression,
      ...(statement.valueType ? { declaredValueType: typeReference.typeIdentity ? dslValueTypeWithRecordIdentity(statement.valueType, typeReference.typeIdentity) : statement.valueType } : {})
    };
    valuesByStatementId.set(statementId, value);
    valuesByStatementIndex.set(statementIndex, value);
  }

  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "typedDeclaration") continue;
    const type = dslRequiredValueTypeOf(statement.valueType);
    const element = isDslArrayValueType(type) ? dslRequiredValueTypeOf(type.elementType) : null;
    if (!isDslArrayValueType(type) || element?.kind !== "record" || !statement.payloadSpans.initializer) continue;
    const span = statement.payloadSpans.initializer;
    const typeReference = resolveRecordType(input, definitionsByStatementIndex, statement, statementIndex, element, statement.payloadSpans.type ?? span, diagnostics);
    if (!typeReference.typeIdentity) continue;
    const typeIdentity = typeReference.typeIdentity;
    const recordType: DslValueType = { kind: "record", name: element.name, identity: typeIdentity };
    const owner = definitionIdAt(stableStatementIdByIndex, statementIndex, "record collection");
    const text = `${" ".repeat(span.start)}${statement.initializer}`;
    const parsed = parseGeometryArrayExpression(text, span);
    let literalOrdinal = 0;
    const visit = (expression: GeometryArrayExpression): void => {
      if (expression.kind === "literal") {
        const ordinal = literalOrdinal++;
        for (const [index, member] of expression.members.entries()) {
          if (member.text.trimStart().startsWith("@") || member.text.trim() === "none") continue;
          const leaf = analyzeRecordValueLeaf({ statements, stableStatementIdByIndex, input, definitionsByStatementIndex, valuesByStatementIndex,
            moduleParameterTypeByDefinitionAndIndex, statement, statementIndex, initializer: member.text, initializerSpan: member.span,
            expectedTypeReference: typeReference, diagnostics });
          if (!leaf.constructor) continue;
          const statementId = `record-array-member:${encodeIdentityTuple([owner, String(ordinal), String(index)])}`;
          valuesByStatementId.set(statementId, { statementId, statementIndex, name: `${statement.name}[${index}]`, typeReference,
            typeIdentity: typeReference.typeIdentity, constructor: leaf.constructor, reference: null,
            valueExpression: { kind: "constructor", span: member.span, constructor: leaf.constructor, valueType: recordType },
            declaredValueType: recordType,
            inlineCollectionMember: { collectionStatementId: owner, span: member.span } });
        }
      } else if (expression.kind === "if") { visit(expression.thenBranch); if (expression.elseBranch) visit(expression.elseBranch); }
      else if (expression.kind === "match") for (const arm of expression.arms) visit(arm.expression);
      else if (expression.kind === "coalesce") { visit(expression.left); visit(expression.right); }
    };
    if (parsed.expression) visit(parsed.expression);
  }

  return {
    definitionsByStatementId,
    definitionsByStatementIndex,
    valuesByStatementId,
    valuesByStatementIndex,
    moduleParameters,
    diagnostics
  };
};

export type RecordMemberResolution = {
  field: RecordFieldSemantic;
  fieldPath: readonly RecordFieldIdentity[];
  valueType: import("./dslValueTypes").DslValueType;
  property?: string;
  collectionIndex?: number;
  type: ScalarExpressionType | null;
};

const recordPropertyParts = (property: string): { name: string; index: number | null }[] | null => {
  if (!property) return null;
  const parts = property.split(".");
  const parsed = parts.map((part) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(part);
    return match
      ? { name: match[1]!, index: match[2] === undefined ? null : Number(match[2]) }
      : null;
  });
  return parsed.every((part): part is { name: string; index: number | null } => part !== null) ? parsed : null;
};

export const resolveRecordMember = (
  recordDefinition: RecordDefinitionSemantic,
  definitionFor: (identity: RecordTypeIdentity) => RecordDefinitionSemantic | null | undefined,
  property: string,
  allowOptionalTraversal = false
): RecordMemberResolution | null => {
  const parts = recordPropertyParts(property);
  if (!parts) return null;
  let definition: RecordDefinitionSemantic | null = recordDefinition;
  let valueType: import("./dslValueTypes").DslValueType = { kind: "record", name: definition.name, identity: definition.statementId };
  const fieldPath: RecordFieldIdentity[] = [];
  let field: RecordFieldSemantic | null = null;
  let collectionIndex: number | undefined;
  let optionalTraversal = false;
  for (const [partIndex, part] of parts.entries()) {
    const optionalValueType = valueType as import("./dslValueTypes").DslValueType;
    if (isDslOptionalValueType(optionalValueType)) {
      if (!allowOptionalTraversal) return null;
      optionalTraversal = true;
      valueType = optionalValueType.valueType;
    }
    if (isDslRecordValueType(valueType)) {
      definition = partIndex === 0
        ? recordDefinition
        : definitionFor(valueType.identity ?? "") ?? null;
      if (!definition) return null;
      field = definition.fields.find((candidate) => candidate.name === part.name) ?? null;
      if (!field) return null;
      fieldPath.push(field.identity);
      valueType = field.type;
      if (part.index !== null) {
        if (!isDslArrayValueType(valueType)) return null;
        valueType = valueType.elementType;
        collectionIndex = part.index;
      }
    } else if (isDslArrayValueType(valueType)) {
      if (part.name !== "length" || part.index !== null || partIndex !== parts.length - 1) return null;
      return field
        ? { field, fieldPath, valueType, property: "length", type: { kind: "number" } }
        : null;
    } else if (isDslGeometryValueType(valueType)) {
      const geometryProperty = parts.slice(partIndex).map((candidate) => candidate.name + (candidate.index === null ? "" : `[${candidate.index}]`)).join(".");
      const type = numericGeometryPropertySupportedByStaticTarget(
        numericGeometryStaticTargetForModuleInterface(valueType.kind),
        geometryProperty
      ) ? { kind: "number" as const } : null;
      return field && type ? {
        field,
        fieldPath,
        valueType,
        property: geometryProperty,
        type,
        ...(collectionIndex !== undefined ? { collectionIndex } : {})
      } : null;
    } else {
      return null;
    }
  }
  if (optionalTraversal && !isDslOptionalValueType(valueType)) valueType = { kind: "optional", valueType };
  return field ? {
    field,
    fieldPath,
    valueType,
    type: scalarExpressionTypeOfDslValueType(valueType),
    ...(collectionIndex !== undefined ? { collectionIndex } : {})
  } : null;
};
