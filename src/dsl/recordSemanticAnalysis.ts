import { matchingDslDelimiter, scanCallArgs } from "./dslArgScanner";
import type { DslDiagnostic, DslRecordTypeReference, DslSpan, DslStatement } from "./dslTypes";
import type { DslPhysicalSpan } from "./logicalStatementSourceMap";
import { parseDslSourceReference } from "./dslReferenceTokens";
import type { SourceLexicalLookup } from "./sourceLexicalNamespaceIndex";
import { isBareDslIdentifierChar } from "./dslTokens";
import type { ScalarType } from "../scalars/types";

export type RecordTypeIdentity = string;
export type RecordValueIdentity = string;

export type RecordFieldIdentity = {
  recordStatementId: RecordTypeIdentity;
  fieldIndex: number;
};

export type RecordFieldSemantic = {
  identity: RecordFieldIdentity;
  fieldIndex: number;
  name: string;
  type: ScalarType;
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
  expectedType: ScalarType;
};

export type RecordConstructorSemantic = {
  name: string;
  nameSpan: DslSpan;
  targetTypeIdentity: RecordTypeIdentity | null;
  fields: readonly RecordConstructorFieldSemantic[];
};

export type RecordValueReferenceSemantic = {
  name: string;
  span: DslSpan;
  targetTypeIdentity: RecordTypeIdentity | null;
};

export type RecordValueSemantic = {
  statementId: RecordValueIdentity;
  statementIndex: number;
  name: string;
  typeReference: RecordTypeReferenceSemantic;
  typeIdentity: RecordTypeIdentity | null;
  constructor: RecordConstructorSemantic | null;
  reference: RecordValueReferenceSemantic | null;
};

export type RecordModuleParameterSemantic = {
  definitionStatementId: string;
  parameterIndex: number;
  name: string;
  typeReference: RecordTypeReferenceSemantic;
  typeIdentity: RecordTypeIdentity | null;
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
  resolveDeclaration: (statementIndex: number, name: string) => SourceLexicalLookup;
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
  message: string
): DslDiagnostic => {
  const physicalSpan = projectSpan(statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
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
  if (lookup.kind === "resolved") {
    if (lookup.declaration.kind === "recordDefinition") {
      const definition = definitionsByStatementIndex.get(lookup.declaration.statementIndex);
      if (definition) return { sourceName: type.name, span, typeIdentity: definition.statementId, resolution: "resolved" };
    }
    diagnostics.push(diagnostic(statement, span, "record-type-not-record", `型名「${type.name}」は record definition を参照していません。`));
    return { sourceName: type.name, span, typeIdentity: null, resolution: "notRecord" };
  }
  if (lookup.kind === "forward") {
    diagnostics.push(diagnostic(statement, span, "record-type-forward-reference", `record 型「${type.name}」はこの位置より後で宣言されているため、まだ参照できません。`));
    return { sourceName: type.name, span, typeIdentity: null, resolution: "forward" };
  }
  if (lookup.kind === "ambiguous") {
    diagnostics.push(diagnostic(statement, span, "record-type-ambiguous", `record 型「${type.name}」は複数の宣言と一致するため一意に解決できません。`));
    return { sourceName: type.name, span, typeIdentity: null, resolution: "ambiguous" };
  }
  diagnostics.push(diagnostic(statement, span, "record-type-undefined", `未定義の record 型「${type.name}」を参照しています。`));
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
  if (!isBareIdentifier(name)) return null;
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

export const analyzeRecordSemantics = (input: RecordSemanticAnalysisInput): RecordSemanticAnalysis => {
  const { statements, stableStatementIdByIndex } = input;
  const diagnostics: DslDiagnostic[] = [];
  const definitionsByStatementId = new Map<RecordTypeIdentity, RecordDefinitionSemantic>();
  const definitionsByStatementIndex = new Map<number, RecordDefinitionSemantic>();
  const valuesByStatementId = new Map<RecordValueIdentity, RecordValueSemantic>();
  const valuesByStatementIndex = new Map<number, RecordValueSemantic>();
  const moduleParameters: RecordModuleParameterSemantic[] = [];

  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "recordDefinition") continue;
    const statementId = definitionIdAt(stableStatementIdByIndex, statementIndex, "record definition");
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
        typeIdentity: typeReference.typeIdentity
      };
      moduleParameters.push(semantic);
      moduleParameterTypeByDefinitionAndIndex.set(`${definitionStatementId}:${parameterIndex}`, semantic);
    }
  }

  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "typedDeclaration" || !statement.recordTypeReference) continue;
    const statementId = definitionIdAt(stableStatementIdByIndex, statementIndex, "record value");
    const typeSpan = statement.payloadSpans.type ?? statement.nameSpan ?? statement.keywordSpan;
    const typeReference = resolveRecordType(
      input,
      definitionsByStatementIndex,
      statement,
      statementIndex,
      statement.recordTypeReference,
      typeSpan,
      diagnostics
    );
    if (statement.bindingKind === "let") {
      diagnostics.push(diagnostic(statement, statement.keywordSpan, "record-let-unsupported", "record 型 binding は v1 では const のみです。let は使用できません。"));
    }

    const initializerSpan = statement.payloadSpans.initializer;
    let constructor: RecordConstructorSemantic | null = null;
    let reference: RecordValueReferenceSemantic | null = null;
    if (initializerSpan && statement.initializer.trimStart().startsWith("@")) {
      const parsedReference = parseDslSourceReference(statement.initializer);
      const span = referenceSpan(statement.initializer, initializerSpan);
      if (
        parsedReference.kind !== "valid" ||
        parsedReference.reference.path.absolute ||
        parsedReference.reference.path.segments.length !== 1 ||
        parsedReference.reference.property !== null
      ) {
        diagnostics.push(diagnostic(statement, span, "record-reference-invalid", "record 値の参照は v1 では単一の whole-record `@name` 参照で指定してください。"));
      } else {
        const name = parsedReference.reference.path.segments[0]!;
        let targetTypeIdentity: RecordTypeIdentity | null = null;
        const lookup = input.resolveDeclaration(statementIndex, name);
        if (lookup.kind === "resolved" && lookup.declaration.kind === "recordValue") {
          targetTypeIdentity = valuesByStatementIndex.get(lookup.declaration.statementIndex)?.typeIdentity ?? null;
        } else if (lookup.kind === "forward" && lookup.declarations.some((declaration) => declaration.kind === "recordValue")) {
          diagnostics.push(diagnostic(statement, span, "record-value-forward-reference", `record 値「${name}」はこの位置より後で宣言されているため、まだ参照できません。`));
        } else if (lookup.kind === "ambiguous") {
          diagnostics.push(diagnostic(statement, span, "record-value-ambiguous", `record 値「${name}」は複数の宣言と一致するため一意に解決できません。`));
        } else {
          const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
          const owner = ownerIndex === null ? null : statements[ownerIndex];
          if (owner?.kind === "moduleDefinition" && ownerIndex !== null) {
            const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === name && parameter.recordTypeReference !== null && parameter.recordTypeReference !== undefined);
            const ownerId = stableStatementIdByIndex.get(ownerIndex);
            const parameterSemantic = parameterIndex >= 0 && ownerId
              ? moduleParameterTypeByDefinitionAndIndex.get(`${ownerId}:${parameterIndex}`)
              : undefined;
            targetTypeIdentity = parameterSemantic?.typeIdentity ?? null;
          }
          if (!targetTypeIdentity) {
            diagnostics.push(diagnostic(statement, span, "record-reference-not-record", `参照「@${name}」は利用可能な record 値または record Module parameter ではありません。`));
          }
        }
        if (targetTypeIdentity && typeReference.typeIdentity && targetTypeIdentity !== typeReference.typeIdentity) {
          diagnostics.push(diagnostic(statement, span, "record-nominal-type-mismatch", `参照「@${name}」の nominal record 型は宣言された型「${statement.recordTypeReference.name}」と一致しません。`));
        }
        reference = { name, span, targetTypeIdentity };
      }
    } else if (initializerSpan) {
      const candidate = constructorCandidate(statement.initializer, initializerSpan);
      if (!candidate) {
        diagnostics.push(diagnostic(statement, initializerSpan, "record-constructor-invalid", "record 値の初期化には `RecordName(field: value, ...)` constructor または同型 record 参照を指定してください。"));
      } else {
        const targetLookup = input.resolveDeclaration(statementIndex, candidate.name);
        let targetDefinition: RecordDefinitionSemantic | null = null;
        if (targetLookup.kind === "resolved") {
          if (targetLookup.declaration.kind === "recordDefinition") {
            targetDefinition = definitionsByStatementIndex.get(targetLookup.declaration.statementIndex) ?? null;
          } else {
            diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-not-record", `constructor target「${candidate.name}」は record definition ではありません。`));
          }
        } else if (targetLookup.kind === "forward") {
          diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-forward-reference", `record constructor「${candidate.name}」はこの位置より後で宣言されているため、まだ使用できません。`));
        } else if (targetLookup.kind === "ambiguous") {
          diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-ambiguous", `record constructor「${candidate.name}」は複数の宣言と一致するため一意に解決できません。`));
        } else {
          diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-undefined", `未定義の record constructor「${candidate.name}」を参照しています。`));
        }

        if (targetDefinition && typeReference.typeIdentity && targetDefinition.statementId !== typeReference.typeIdentity) {
          diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-nominal-type-mismatch", `constructor「${candidate.name}」の nominal record 型は宣言された型「${statement.recordTypeReference.name}」と一致しません。`));
        }

        const localArgsSpan = {
          start: candidate.argsSpan.start - initializerSpan.start,
          end: candidate.argsSpan.end - initializerSpan.start
        };
        const scanned = scanCallArgs(statement.initializer, localArgsSpan);
        for (const error of scanned.errors) {
          const span = { start: initializerSpan.start + error.span.start, end: initializerSpan.start + error.span.end };
          diagnostics.push(diagnostic(statement, span, error.code ?? "record-constructor-invalid-argument", error.message));
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
            diagnostics.push(diagnostic(statement, labelSpan, "record-constructor-duplicate-field", `record constructor field「${argument.key}」が重複しています。`));
            continue;
          }
          firstLabel.add(argument.key);
          const field = knownFields.get(argument.key);
          if (!field) {
            if (targetDefinition) diagnostics.push(diagnostic(statement, labelSpan, "record-constructor-unknown-field", `record「${targetDefinition.name}」に field「${argument.key}」はありません。`));
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
              diagnostics.push(diagnostic(statement, candidate.nameSpan, "record-constructor-missing-field", `record constructor「${targetDefinition.name}」に必須 field「${field.name}」がありません。`));
            }
          }
        }
        constructor = {
          name: candidate.name,
          nameSpan: candidate.nameSpan,
          targetTypeIdentity: targetDefinition?.statementId ?? null,
          fields: targetDefinition
            ? targetDefinition.fields.flatMap((field) => fields.filter((entry) => entry.field.fieldIndex === field.fieldIndex))
            : fields
        };
      }
    }

    const value: RecordValueSemantic = {
      statementId,
      statementIndex,
      name: statement.name,
      typeReference,
      typeIdentity: typeReference.typeIdentity,
      constructor,
      reference
    };
    valuesByStatementId.set(statementId, value);
    valuesByStatementIndex.set(statementIndex, value);
  }

  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "set" || !statement.name) continue;
    const baseName = statement.name.split(".", 1)[0]!;
    const lookup = input.resolveDeclaration(statementIndex, baseName);
    let isRecordTarget = lookup.kind === "resolved" && lookup.declaration.kind === "recordValue";
    if (!isRecordTarget) {
      const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
      const owner = ownerIndex === null ? null : statements[ownerIndex];
      if (owner?.kind === "moduleDefinition" && ownerIndex !== null) {
        const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === baseName && parameter.recordTypeReference !== null && parameter.recordTypeReference !== undefined);
        if (parameterIndex >= 0) {
          const ownerId = stableStatementIdByIndex.get(ownerIndex);
          isRecordTarget = Boolean(ownerId && moduleParameterTypeByDefinitionAndIndex.has(`${ownerId}:${parameterIndex}`));
        }
      }
    }
    if (isRecordTarget) {
      diagnostics.push(diagnostic(statement, statement.nameSpan ?? statement.keywordSpan, "record-set-unsupported", "record 値または record field は v1 では set できません。"));
    }
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
