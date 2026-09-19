import type { DslDiagnostic, DslStatement } from "../dsl/dslTypes";
import type { SourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import { dslRequiredValueTypeOf, isDslArrayValueType, isDslGeometryValueType, isDslRecordValueType, scalarExpressionTypeOfDslValueType, scalarTypeOfDslValueType, type DslValueType } from "../dsl/dslValueTypes";
import { parseRecordConstructorFields, type RecordDefinitionSemantic } from "../dsl/recordSemanticAnalysis";
import type { BindingId, BindingSeed, SourceNamespaceBindingResolver } from "./bindingCatalog";
import { bindingIdForStableStatementId } from "./bindingCatalog";
import type { AdditionalScalarInitializer } from "./typedDeclarationAnalysis";

export type ImmutableCarryInput = {
  bindingId: BindingId;
  nextBindingId?: BindingId;
  ownerStatementIndex: number;
  nextStatementIndex: number;
  nextSourceOrder: number;
  declaredType: NonNullable<ReturnType<typeof scalarTypeOfDslValueType>>;
};

export const immutableCarryCollectionValueId = (bindingId: BindingId): string =>
  `carry-collection:${bindingId}`;

export type ImmutableCarryCompilation = {
  bindings: readonly BindingSeed[];
  initializers: readonly AdditionalScalarInitializer[];
  resolver: SourceNamespaceBindingResolver;
  carries: readonly ImmutableCarryInput[];
  declarations: readonly {
    bindingId: BindingId;
    ownerStatementIndex: number;
    name: string;
    fieldPath?: readonly string[];
    valueType: import("../dsl/dslValueTypes").DslValueType | null;
    initializer: string;
    initializerSpan: { start: number; end: number };
  }[];
  nexts: readonly {
    ownerStatementIndex: number;
    carryName: string;
    fieldPath?: readonly string[];
    statementIndex: number;
    expression: string;
    expressionSpan: { start: number; end: number };
  }[];
  recordPropertyResolver?: (input: {
    statementIndex: number;
    node: Extract<import("../scalars/expressionAst").ScalarExpressionAst, { kind: "geometryProperty" }>;
  }) => import("../scalars/recordScalarLowering").AdditionalRecordScalarPropertyResolution | null;
  collectionLengthPropertyResolver?: (input: {
    statementIndex: number;
    node: Extract<import("../scalars/expressionAst").ScalarExpressionAst, { kind: "geometryProperty" }>;
  }) => import("./typedExpressionAst").ScalarExpressionResolvedGeometryProperty | null;
  diagnostics: readonly DslDiagnostic[];
};

const diagnosticFor = (
  statement: DslStatement,
  span: { start: number; end: number },
  code: string,
  message: string
): DslDiagnostic => ({
  severity: "error",
  line: statement.line,
  column: span.start + 1,
  code,
  message,
  logicalSpan: span
});

const nearestForIndex = (statements: readonly DslStatement[], statementIndex: number): number | undefined => {
  let enclosing = statements[statementIndex]?.enclosing?.statementIndex;
  while (enclosing !== undefined) {
    const candidate = statements[enclosing];
    if (candidate?.kind === "element" && candidate.type === "forGroup") return enclosing;
    enclosing = candidate?.enclosing?.statementIndex;
  }
  return undefined;
};

const conditionalEnclosingFor = (
  statements: readonly DslStatement[],
  statementIndex: number,
  ownerStatementIndex: number
): DslStatement | undefined => {
  let enclosing = statements[statementIndex]?.enclosing;
  while (enclosing && enclosing.statementIndex !== ownerStatementIndex) {
    const candidate = statements[enclosing.statementIndex];
    if (candidate?.kind === "element" && candidate.type === "conditionalGroup") return candidate;
    enclosing = candidate?.enclosing;
  }
  return undefined;
};

const declarationFor = (
  sourceNamespace: SourceLexicalNamespaceIndex,
  statementIndex: number,
  name: string
) => sourceNamespace.allDeclarations.find((declaration) =>
  declaration.kind === "carry" && declaration.statementIndex === statementIndex && declaration.name === name
);

export const compileImmutableCarries = ({
  statements,
  stableStatementIdByIndex,
  sourceNamespace
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  sourceNamespace: SourceLexicalNamespaceIndex;
}): ImmutableCarryCompilation => {
  const bindings: BindingSeed[] = [];
  const initializers: AdditionalScalarInitializer[] = [];
  const carries: ImmutableCarryInput[] = [];
  const diagnostics: DslDiagnostic[] = [];
  const declarations: Array<ImmutableCarryCompilation["declarations"][number]> = [];
  const nexts: Array<ImmutableCarryCompilation["nexts"][number]> = [];
  const bindingByDeclaration = new Map<string, BindingId>();
  const carryNamesByLoop = new Map<number, Map<string, BindingId>>();
  const carryNamesByLoopAll = new Map<number, Set<string>>();
  const nextNamesByLoop = new Map<number, Set<string>>();
  const carryFieldBindings = new Map<string, BindingId>();
  const carryFieldNames = new Map<string, { bindingId: BindingId; valueType: DslValueType; name: string; nameSpan: { start: number; end: number }; statementIndex: number; scopeId: string }>();

  const recordDefinitionFor = (valueType: DslValueType | null): RecordDefinitionSemantic | undefined => {
    const required = dslRequiredValueTypeOf(valueType);
    if (!isDslRecordValueType(required)) return undefined;
    const analysis = sourceNamespace.recordSemanticAnalysis;
    return analysis?.definitionsByStatementId.get(required.identity ?? "") ??
      [...(analysis?.definitionsByStatementId.values() ?? [])].find((definition) => definition.name === required.name);
  };
  const nextSyntheticSourceOrder = (statementIndex: number): number =>
    bindings.filter((binding) => binding.statementIndex === statementIndex).length;

  const directReferencePath = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("@")) return null;
    const parsed = parseDslReferenceToken(trimmed.slice(1));
    return parsed.segments.length > 0
      ? parsed.segments.join(".")
      : null;
  };

  const recordFieldRaw = (
    raw: string,
    rawSpan: { start: number; end: number },
    definition: RecordDefinitionSemantic,
    fieldPath: readonly string[]
  ): { raw: string; span: { start: number; end: number }; valueType: DslValueType } | null => {
    const reference = directReferencePath(raw);
    if (reference !== null) {
      let current: DslValueType = { kind: "record", name: definition.name, identity: definition.statementId };
      for (const fieldName of fieldPath) {
        const currentDefinition = recordDefinitionFor(current);
        const field = currentDefinition?.fields.find((candidate) => candidate.name === fieldName);
        if (!field) return null;
        current = field.type;
      }
      return {
        raw: `@${reference}.${fieldPath.join(".")}`,
        span: { start: rawSpan.start, end: rawSpan.start + `@${reference}.${fieldPath.join(".")}`.length },
        valueType: current
      };
    }
    let currentDefinition: RecordDefinitionSemantic | undefined = definition;
    let currentRaw = raw;
    let currentSpan = rawSpan;
    let currentType: DslValueType = { kind: "record", name: definition.name, identity: definition.statementId };
    for (const [index, fieldName] of fieldPath.entries()) {
      const parsed = parseRecordConstructorFields({ initializer: currentRaw, initializerSpan: currentSpan, definition: currentDefinition! });
      const field = parsed?.fields.find((candidate) => candidate.fieldName === fieldName);
      if (!field) return null;
      currentRaw = field.value;
      currentSpan = field.valueSpan;
      currentType = field.expectedType;
      if (index < fieldPath.length - 1) {
        const reference = directReferencePath(currentRaw);
        if (reference !== null) {
          let referencedType = currentType;
          for (const remainingFieldName of fieldPath.slice(index + 1)) {
            const referencedDefinition = recordDefinitionFor(referencedType);
            const remainingField = referencedDefinition?.fields.find((candidate) => candidate.name === remainingFieldName);
            if (!remainingField) return null;
            referencedType = remainingField.type;
          }
          return {
            raw: `@${reference}.${fieldPath.slice(index + 1).join(".")}`,
            span: { start: currentSpan.start, end: currentSpan.start + `@${reference}.${fieldPath.slice(index + 1).join(".")}`.length },
            valueType: referencedType
          };
        }
        currentDefinition = recordDefinitionFor(currentType);
        if (!currentDefinition) return null;
      }
    }
    return { raw: currentRaw, span: currentSpan, valueType: currentType };
  };

  const recordLeafPaths = (definition: RecordDefinitionSemantic, prefix: readonly string[] = []): Array<{ path: readonly string[]; type: DslValueType }> => {
    const leaves: Array<{ path: readonly string[]; type: DslValueType }> = [];
    for (const field of definition.fields) {
      const path = [...prefix, field.name];
      const nested = recordDefinitionFor(field.type);
      if (nested) leaves.push(...recordLeafPaths(nested, path));
      else if (
        scalarExpressionTypeOfDslValueType(field.type) !== null ||
        isDslGeometryValueType(field.type) ||
        isDslArrayValueType(field.type)
      ) leaves.push({ path, type: field.type });
    }
    return leaves;
  };

  const addRecordCarryFields = (
    statement: Extract<DslStatement, { kind: "element" }>,
    statementIndex: number,
    carryIndex: number,
    carry: NonNullable<Extract<DslStatement, { kind: "element" }>["forCarries"]>[number],
    loopScopeId: string
  ) => {
    const definition = recordDefinitionFor(carry.valueType);
    if (!definition) return;
    for (const field of recordLeafPaths(definition)) {
      const initializer = recordFieldRaw(carry.initializer, carry.initializerSpan, definition, field.path);
      if (!initializer) continue;
      const bindingId = `binding:${stableStatementIdByIndex.get(statementIndex) ?? statementIndex}:carry:${carryIndex}:field:${field.path.join(".")}`;
      const key = `${statementIndex}:${carry.name}.${field.path.join(".")}`;
      declarations.push({
        bindingId,
        ownerStatementIndex: statementIndex,
        name: `${carry.name}.${field.path.join(".")}`,
        fieldPath: field.path,
        valueType: field.type,
        initializer: initializer.raw,
        initializerSpan: initializer.span
      });
      carryFieldBindings.set(key, bindingId);
      carryFieldNames.set(key, {
        bindingId,
        valueType: field.type,
        name: `${carry.name}.${field.path.join(".")}`,
        nameSpan: carry.nameSpan,
        statementIndex,
        scopeId: loopScopeId
      });
      const scalarType = scalarTypeOfDslValueType(initializer.valueType);
      if (!scalarType) continue;
      bindings.push({
        id: bindingId,
        kind: "typed",
        name: `${carry.name}.${field.path.join(".")}`,
        nameSpan: carry.nameSpan,
        statementIndex,
        sourceOrder: nextSyntheticSourceOrder(statementIndex),
        effectiveScopeId: loopScopeId,
        visibility: { kind: "typed", scopeId: loopScopeId },
        mutability: "const",
        declaredType: field.type,
        resolutionMode: "sourceLookup",
        catalogOrder: "source"
      });
      initializers.push({ bindingId, raw: initializer.raw, span: initializer.span, expectedType: scalarType });
    }
  };

  const forStatements = statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter((entry): entry is { statement: Extract<DslStatement, { kind: "element" }>; statementIndex: number } =>
      entry.statement.kind === "element" && entry.statement.type === "forGroup" && Boolean(entry.statement.forCarries?.length)
    );

  for (const { statement, statementIndex } of forStatements) {
    const stableStatementId = stableStatementIdByIndex.get(statementIndex);
    const loopScopeId = stableStatementId && sourceNamespace.scopeIndex.scopes.has(`for:${stableStatementId}`)
      ? `for:${stableStatementId}`
      : sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId;
    const names = new Map<string, BindingId>();
    carryNamesByLoop.set(statementIndex, names);
    carryNamesByLoopAll.set(statementIndex, new Set());
    const seen = new Set<string>();
    for (const [carryIndex, carry] of (statement.forCarries ?? []).entries()) {
      if (seen.has(carry.name)) {
        diagnostics.push(diagnosticFor(statement, carry.nameSpan, "duplicate-carry", `carry 名が重複しています: ${carry.name}`));
        continue;
      }
      seen.add(carry.name);
      carryNamesByLoopAll.get(statementIndex)!.add(carry.name);
      const declaration = declarationFor(sourceNamespace, statementIndex, carry.name);
      if (!declaration) continue;
      const bindingId = bindingIdForStableStatementId(declaration.statementId);
      bindingByDeclaration.set(declaration.statementId, bindingId);
      names.set(carry.name, bindingId);
      const scalarType = scalarTypeOfDslValueType(carry.valueType);
      declarations.push({
        bindingId,
        ownerStatementIndex: statementIndex,
        name: carry.name,
        valueType: carry.valueType,
        initializer: carry.initializer,
        initializerSpan: carry.initializerSpan
      });
      if (scalarType) {
        bindings.push({
          id: bindingId,
          kind: "typed",
          name: carry.name,
          nameSpan: carry.nameSpan,
          statementIndex,
          sourceOrder: nextSyntheticSourceOrder(statementIndex),
          effectiveScopeId: loopScopeId,
          visibility: { kind: "typed", scopeId: loopScopeId },
          mutability: "const",
          declaredType: carry.valueType,
          resolutionMode: "sourceLookup",
          catalogOrder: "source"
        });
        initializers.push({
          bindingId,
          raw: carry.initializer,
          span: carry.initializerSpan,
          expectedType: scalarType
        });
      }
      if (isDslRecordValueType(dslRequiredValueTypeOf(carry.valueType))) {
        addRecordCarryFields(statement, statementIndex, carryIndex, carry, loopScopeId);
      }
    }
  }

  const nextByStatement = new Map<number, { carry: ImmutableCarryInput; bindingId: BindingId }>();
  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "next") continue;
    const ownerStatementIndex = nearestForIndex(statements, statementIndex);
    if (ownerStatementIndex === undefined) continue;
    const ownerCarries = carryNamesByLoop.get(ownerStatementIndex) ?? new Map();
    const carryBindingId = ownerCarries.get(statement.name);
    if (!carryBindingId) {
      const ancestorCarry = [...carryNamesByLoop.entries()]
        .filter(([candidateIndex]) => candidateIndex !== ownerStatementIndex && nearestForIndex(statements, ownerStatementIndex) === candidateIndex)
        .map(([, names]) => names.get(statement.name))
        .find((value): value is BindingId => value !== undefined);
      diagnostics.push(diagnosticFor(
        statement,
        statement.nameSpan ?? statement.keywordSpan,
        ancestorCarry ? "next-outer-carry" : "unknown-next-carry",
        ancestorCarry
          ? `内側の for から外側の carry「${statement.name}」を直接 next できません。`
          : `next の対象 carry が見つかりません: ${statement.name}`
      ));
      continue;
    }
    const nextNames = nextNamesByLoop.get(ownerStatementIndex) ?? new Set<string>();
    if (nextNames.has(statement.name)) {
      diagnostics.push(diagnosticFor(statement, statement.nameSpan ?? statement.keywordSpan, "duplicate-next", `carry「${statement.name}」には next を1つだけ指定してください。`));
      continue;
    }
    nextNames.add(statement.name);
    nextNamesByLoop.set(ownerStatementIndex, nextNames);
    if (conditionalEnclosingFor(statements, statementIndex, ownerStatementIndex)) {
      diagnostics.push(diagnosticFor(
        statement,
        statement.nameSpan ?? statement.keywordSpan,
        "next-inside-conditional",
        "next は statement-for の直接 body にのみ書けます。条件分岐内では next RHS の value-if または match を使ってください。"
      ));
      continue;
    }
      nexts.push({
      ownerStatementIndex,
      carryName: statement.name,
      statementIndex,
      expression: statement.expression,
      expressionSpan: statement.expressionSpan
    });
    const declaration = sourceNamespace.allDeclarations.find((candidate) =>
      candidate.kind === "carry" && candidate.statementIndex === ownerStatementIndex && candidate.name === statement.name
    );
    const carryDeclaration = declaration?.statement.kind === "element"
      ? declaration.statement.forCarries?.find((carry) => carry.name === statement.name)
      : undefined;
    const carryDefinition = recordDefinitionFor(carryDeclaration?.valueType ?? null);
    if (carryDeclaration && carryDefinition) {
      for (const field of recordLeafPaths(carryDefinition)) {
        const fieldKey = `${ownerStatementIndex}:${statement.name}.${field.path.join(".")}`;
        const fieldBindingId = carryFieldBindings.get(fieldKey);
        const nextField = recordFieldRaw(statement.expression, statement.expressionSpan, carryDefinition, field.path);
        if (!fieldBindingId || !nextField) continue;
        nexts.push({
          ownerStatementIndex,
          carryName: statement.name,
          fieldPath: field.path,
          statementIndex,
          expression: nextField.raw,
          expressionSpan: nextField.span
        });
        const scalarType = scalarTypeOfDslValueType(nextField.valueType);
        if (!scalarType) continue;
        const nextBindingId = `binding:next:${stableStatementIdByIndex.get(ownerStatementIndex) ?? ownerStatementIndex}:${statementIndex}:field:${field.path.join(".")}`;
        const nextScopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId;
        bindings.push({
          id: nextBindingId,
          kind: "typed",
          name: `${statement.name}.${field.path.join(".")}:next`,
          nameSpan: statement.nameSpan,
          statementIndex,
          sourceOrder: nextSyntheticSourceOrder(statementIndex),
          effectiveScopeId: nextScopeId,
          visibility: { kind: "typed", scopeId: nextScopeId },
          mutability: "const",
          declaredType: field.type,
          resolutionMode: "preResolvedOnly",
          catalogOrder: "append"
        });
        initializers.push({ bindingId: nextBindingId, raw: nextField.raw, span: nextField.span, expectedType: scalarType });
        carries.push({
          bindingId: fieldBindingId,
          nextBindingId,
          ownerStatementIndex,
          nextStatementIndex: statementIndex,
          nextSourceOrder: statementIndex,
          declaredType: scalarType
        });
      }
      continue;
    }
    const existing = carries.find((carry) => carry.bindingId === carryBindingId && carry.ownerStatementIndex === ownerStatementIndex);
    if (existing) {
      continue;
    }
    const valueType = declaration?.statement.kind === "element"
      ? declaration.statement.forCarries?.find((carry) => carry.name === statement.name)?.valueType
      : null;
    const scalarType = scalarTypeOfDslValueType(valueType ?? null);
    if (!scalarType) continue;
    const nextBindingId = `binding:next:${stableStatementIdByIndex.get(ownerStatementIndex) ?? ownerStatementIndex}:${statementIndex}`;
    const nextScopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId;
    bindings.push({
      id: nextBindingId,
      kind: "typed",
      name: `${statement.name}:next`,
      nameSpan: statement.nameSpan,
      statementIndex,
      sourceOrder: nextSyntheticSourceOrder(statementIndex),
      effectiveScopeId: nextScopeId,
      visibility: { kind: "typed", scopeId: nextScopeId },
      mutability: "const",
      declaredType: valueType,
      resolutionMode: "preResolvedOnly",
      catalogOrder: "append"
    });
    initializers.push({ bindingId: nextBindingId, raw: statement.expression, span: statement.expressionSpan, expectedType: scalarType });
    const carry: ImmutableCarryInput = {
      bindingId: carryBindingId,
      nextBindingId,
      ownerStatementIndex,
      nextStatementIndex: statementIndex,
      nextSourceOrder: statementIndex,
      declaredType: scalarType
    };
    carries.push(carry);
    nextByStatement.set(statementIndex, { carry, bindingId: nextBindingId });
  }

  for (const [statementIndex, names] of carryNamesByLoopAll) {
    for (const name of names) {
      if (!nextNamesByLoop.get(statementIndex)?.has(name)) {
        const statement = statements[statementIndex]!;
        const carry = statement.kind === "element" ? statement.forCarries?.find((candidate) => candidate.name === name) : undefined;
        if (carry) diagnostics.push(diagnosticFor(statement, carry.nameSpan, "missing-next", `carry「${name}」には completed iteration ごとの next が必要です。`));
      }
    }
  }

  const resolver: SourceNamespaceBindingResolver = (name, statementIndex) => {
    const path = parseDslReferenceToken(name);
    if (path.segments.length > 1) {
      const base = resolveSourceLexicalPath(sourceNamespace, statementIndex, parseDslReferenceToken(path.segments[0]!));
      if (base.kind === "resolved" && base.declaration.kind === "carry") {
        const fieldPath = path.segments.slice(1).join(".");
        const bindingId = carryFieldBindings.get(`${base.declaration.statementIndex}:${base.declaration.name}.${fieldPath}`);
        if (bindingId) return { kind: "resolved", bindingId };
        return { kind: "blocked", reason: "incompatible", declarationKind: "carry", statementId: base.declaration.statementId };
      }
    }
    const lookup = resolveSourceLexicalPath(sourceNamespace, statementIndex, parseDslReferenceToken(name));
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "carry") return null;
    const bindingId = bindingByDeclaration.get(lookup.declaration.statementId);
    return bindingId ? { kind: "resolved", bindingId } : { kind: "blocked", reason: "incompatible", declarationKind: "carry", statementId: lookup.declaration.statementId };
  };

  const recordPropertyResolver: ImmutableCarryCompilation["recordPropertyResolver"] = ({ statementIndex, node }) => {
    const base = resolveSourceLexicalPath(sourceNamespace, statementIndex, parseDslReferenceToken(node.elementName));
    if (base.kind !== "resolved" || base.declaration.kind !== "carry") return null;
    const fieldKey = `${base.declaration.statementIndex}:${base.declaration.name}.${node.property}`;
    const field = carryFieldNames.get(fieldKey);
    if (!field) return null;
    const type = scalarExpressionTypeOfDslValueType(field.valueType);
    if (!type) return null;
    return {
      resolution: { kind: "resolvedType", bindingId: field.bindingId, type },
      dependency: { bindingId: field.bindingId, name: field.name, span: node.span }
    };
  };

  const collectionLengthPropertyResolver: ImmutableCarryCompilation["collectionLengthPropertyResolver"] = ({ statementIndex, node }) => {
    if (!node.property.endsWith(".length")) return null;
    const base = resolveSourceLexicalPath(sourceNamespace, statementIndex, parseDslReferenceToken(node.elementName));
    if (base.kind !== "resolved" || base.declaration.kind !== "carry") return null;
    const field = carryFieldNames.get(`${base.declaration.statementIndex}:${base.declaration.name}.${node.property.slice(0, -".length".length)}`);
    const valueType = dslRequiredValueTypeOf(field?.valueType);
    if (!field || !valueType || !isDslArrayValueType(valueType)) return null;
    return {
      kind: "collection",
      collectionValueId: immutableCarryCollectionValueId(field.bindingId),
      collectionLength: null,
      targetSourceOrder: base.declaration.statementIndex,
      type: { kind: "number" }
    };
  };

  return { bindings, initializers, resolver, carries, declarations, nexts, recordPropertyResolver, collectionLengthPropertyResolver, diagnostics };
};
