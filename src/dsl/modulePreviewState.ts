import type { StatementIdentity } from "../document/statementIdentity";
import { createLazyScalarProgramEvaluator } from "../scalars/declarationEvaluator";
import { IDENTIFIER_PATTERN } from "../scalars/literalScanner";
import { numericLiteralForExpression } from "../scalars/numericLiteral";
import type { ScalarEvaluation, ScalarValue } from "../scalars/types";
import type { CompiledDslDocument } from "./dslDocument";
import type { DslDiagnosticPresentation, DslStatement } from "./dslTypes";
import {
  compileModulePreviewRoot,
  type ModulePreviewArgument,
  type ModulePreviewRootInput,
  type ModulePreviewRootResult
} from "./modulePreviewRoot";
import type {
  ModuleDefinitionSemantic,
  ResolvedModuleParameter
} from "./moduleSemanticTypes";
import type { DslNumericTypeOptions } from "./dslNumericTypeOptions";
import type {
  ModulePreviewTarget,
  ModulePreviewTargetSemanticSnapshot,
  SourceSnapshot
} from "./modulePreviewTarget";

export type ModulePreviewInputDiagnostic = {
  code: "required-value-missing" | "invalid-expression";
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  message: string;
  presentation?: DslDiagnosticPresentation;
};

export type ModulePreviewParameterState = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  name: string;
  type: ResolvedModuleParameter["type"];
  numericTypeOptions?: DslNumericTypeOptions;
  optional: boolean;
  required: boolean;
  /** Authored default expression text, for presentation only. */
  defaultSourceText: string | null;
  /** Exact ephemeral caller-side argument expression text. Empty means omitted. */
  value: string;
  diagnostic: ModulePreviewInputDiagnostic | null;
};

export type ModulePreviewInputGroup = {
  kind: "ancestor" | "target";
  definitionStatementId: StatementIdentity;
  name: string;
  parameters: readonly ModulePreviewParameterState[];
};

export type ModulePreviewRenderState =
  | { kind: "current"; result: ModulePreviewRootResult }
  | { kind: "lastGood"; result: ModulePreviewRootResult }
  | { kind: "noValidPreview"; result: null };

export type ModulePreviewSessionSnapshot = {
  sourceRevision: number;
  target: ModulePreviewTarget;
  /** Ancestor Module contexts in outermost-to-innermost order. */
  ancestorContexts: readonly ModulePreviewInputGroup[];
  parameters: ModulePreviewInputGroup;
  inputDiagnostics: readonly ModulePreviewInputDiagnostic[];
  preview: ModulePreviewRenderState;
};

export type ModulePreviewActivateInput = {
  source: SourceSnapshot;
  semantic: ModulePreviewTargetSemanticSnapshot;
  target: ModulePreviewTarget;
};

export type ModulePreviewDefaultActionResult = {
  applied: boolean;
  state: ModulePreviewSessionSnapshot | null;
};

export type ModulePreviewSession = {
  getState(): ModulePreviewSessionSnapshot | null;
  activate(input: ModulePreviewActivateInput): ModulePreviewSessionSnapshot | null;
  setValue(
    definitionStatementId: StatementIdentity,
    parameterIndex: number,
    expression: string
  ): ModulePreviewSessionSnapshot | null;
  useDefaultExplicitly(
    definitionStatementId: StatementIdentity,
    parameterIndex: number
  ): ModulePreviewDefaultActionResult;
};

type ActivePreview = {
  source: SourceSnapshot;
  semantic: ModulePreviewTargetSemanticSnapshot;
  target: ModulePreviewTarget;
  compiled: CompiledDslDocument;
  chain: readonly ModuleDefinitionSemantic[];
};

type EditedInput = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
};

type ActiveParameter = {
  definition: ModuleDefinitionSemantic;
  parameter: ResolvedModuleParameter;
  key: string;
};

const exactCompiled = (
  source: SourceSnapshot,
  semantic: ModulePreviewTargetSemanticSnapshot
): CompiledDslDocument | null => {
  const compiled = semantic.compiled;
  if (!compiled || semantic.sourceRevision !== source.sourceRevision || source.normalizedSource.includes("\r")) return null;
  const semanticText = semantic.sourceText ?? compiled.spans.sourceMap.source;
  if (
    semanticText !== source.normalizedSource ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision
  ) return null;
  return compiled;
};

const ownerModuleIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const parent = statements[enclosing.statementIndex];
    if (parent?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = parent?.enclosing ?? null;
  }
  return null;
};

const definitionChainFor = (
  compiled: CompiledDslDocument,
  target: ModulePreviewTarget
): readonly ModuleDefinitionSemantic[] | null => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) return null;
  const definition = analysis.definitionsByStatementId.get(target.definitionStatementId);
  if (
    !definition ||
    definition.statementIndex !== target.definitionStatementIndex ||
    definition.name !== target.name
  ) return null;

  const chain: ModuleDefinitionSemantic[] = [definition];
  const visited = new Set<number>([definition.statementIndex]);
  let ownerIndex = ownerModuleIndexOf(compiled.statements, definition.statementIndex);
  while (ownerIndex !== null) {
    if (visited.has(ownerIndex)) return null;
    visited.add(ownerIndex);
    const owner = analysis.definitions.find((candidate) => candidate.statementIndex === ownerIndex);
    if (!owner) return null;
    chain.push(owner);
    ownerIndex = ownerModuleIndexOf(compiled.statements, owner.statementIndex);
  }
  return chain.reverse();
};

const inputKeyFor = (
  targetDefinitionStatementId: StatementIdentity,
  definition: ModuleDefinitionSemantic,
  parameter: ResolvedModuleParameter
) => JSON.stringify([
  targetDefinitionStatementId,
  definition.statementId,
  parameter.parameterIndex,
  parameter.name
]);

const previewKeyFor = (active: ActivePreview) =>
  JSON.stringify(active.chain.map((definition) => definition.statementId));

const isOmitted = (expression: string) => expression.trim().length === 0;

const stringLiteralForExpression = (value: string): string | null => {
  let result = '"';
  for (const character of value) {
    switch (character) {
      case "\\": result += "\\\\"; break;
      case '"': result += '\\"'; break;
      case "\n": result += "\\n"; break;
      case "\r": result += "\\r"; break;
      case "\t": result += "\\t"; break;
      case "{": result += "\\{"; break;
      case "}": result += "\\}"; break;
      default: {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && codePoint < 0x20) return null;
        result += character;
      }
    }
  }
  return `${result}"`;
};

const choiceLiteralForExpression = (value: string): string | null => {
  if (value === "true" || value === "false") return null;
  const match = IDENTIFIER_PATTERN.exec(value);
  return match?.[0] === value ? value : null;
};

const scalarLiteralForEvaluation = (evaluation: ScalarEvaluation): string | null => {
  if (evaluation.status !== "ok") return null;
  const value: ScalarValue = evaluation.value;
  switch (value.kind) {
    case "number": return numericLiteralForExpression(value.value);
    case "string": return stringLiteralForExpression(value.value);
    case "boolean": return value.value ? "true" : "false";
    case "choice": return choiceLiteralForExpression(value.value);
  }
};

export const createModulePreviewSession = (): ModulePreviewSession => {
  const valueByInputKey = new Map<string, string>();
  const lastGoodByPreviewKey = new Map<string, ModulePreviewRootResult>();
  const lastGoodValueByInputKey = new Map<string, string>();
  const invalidDiagnosticByInputKey = new Map<string, ModulePreviewInputDiagnostic>();
  let active: ActivePreview | null = null;
  let state: ModulePreviewSessionSnapshot | null = null;

  const keyFor = (definition: ModuleDefinitionSemantic, parameter: ResolvedModuleParameter) =>
    active ? inputKeyFor(active.target.definitionStatementId, definition, parameter) : "";

  const valueFor = (definition: ModuleDefinitionSemantic, parameter: ResolvedModuleParameter) =>
    active ? valueByInputKey.get(keyFor(definition, parameter)) ?? "" : "";

  const activeParameters = (): ActiveParameter[] => {
    const currentActive = active;
    return currentActive?.chain.flatMap((definition) =>
      definition.parameters.map((parameter) => ({
        definition,
        parameter,
        key: inputKeyFor(currentActive.target.definitionStatementId, definition, parameter)
      }))
    ) ?? [];
  };

  const parameterFor = (
    definitionStatementId: StatementIdentity,
    parameterIndex: number
  ): { definition: ModuleDefinitionSemantic; parameter: ResolvedModuleParameter } | null => {
    const definition = active?.chain.find((candidate) => candidate.statementId === definitionStatementId);
    const parameter = definition?.parameters.find((candidate) => candidate.parameterIndex === parameterIndex);
    return definition && parameter ? { definition, parameter } : null;
  };

  const argumentsFor = (
    definition: ModuleDefinitionSemantic,
    omittedInput?: EditedInput,
    overrides?: ReadonlyMap<string, string>
  ): ModulePreviewArgument[] => definition.parameters.flatMap((parameter) => {
    if (
      omittedInput?.definitionStatementId === definition.statementId &&
      omittedInput.parameterIndex === parameter.parameterIndex
    ) return [];
    const expression = overrides?.get(keyFor(definition, parameter)) ?? valueFor(definition, parameter);
    return isOmitted(expression) ? [] : [{ name: parameter.name, expression }];
  });

  const rootInputFor = (
    omittedInput?: EditedInput,
    overrides?: ReadonlyMap<string, string>
  ): ModulePreviewRootInput | null => {
    if (!active) return null;
    const targetDefinition = active.chain[active.chain.length - 1];
    if (!targetDefinition) return null;
    return {
      source: active.source,
      semantic: active.semantic,
      target: active.target,
      ancestorContexts: active.chain.slice(0, -1).map((definition) => ({
        definitionStatementId: definition.statementId,
        arguments: argumentsFor(definition, omittedInput, overrides)
      })),
      arguments: argumentsFor(targetDefinition, omittedInput, overrides)
    };
  };

  const requiredDiagnostics = (): ModulePreviewInputDiagnostic[] => {
    if (!active) return [];
    return active.chain.flatMap((definition) => definition.parameters.flatMap((parameter) => {
      if (!parameter.required || parameter.defaultValue !== null || !isOmitted(valueFor(definition, parameter))) return [];
      return [{
        code: "required-value-missing" as const,
        definitionStatementId: definition.statementId,
        parameterIndex: parameter.parameterIndex,
        message: `Parameter "${parameter.name}" requires a value.`,
        presentation: {
          key: "modulePreview.parameters.diagnostic.required-value-missing",
          parameters: { name: parameter.name }
        }
      }];
    }));
  };

  const invalidDiagnosticFor = (
    definition: ModuleDefinitionSemantic,
    parameter: ResolvedModuleParameter
  ): ModulePreviewInputDiagnostic => ({
    code: "invalid-expression",
    definitionStatementId: definition.statementId,
    parameterIndex: parameter.parameterIndex,
    message: `Value for "${parameter.name}" is not a valid Module argument expression in this context.`,
    presentation: {
      key: "modulePreview.parameters.diagnostic.invalid-expression",
      parameters: { name: parameter.name }
    }
  });

  const buildGroup = (
    definition: ModuleDefinitionSemantic,
    kind: ModulePreviewInputGroup["kind"],
    diagnostics: readonly ModulePreviewInputDiagnostic[]
  ): ModulePreviewInputGroup => ({
    kind,
    definitionStatementId: definition.statementId,
    name: definition.name,
    parameters: definition.parameters.map((parameter) => ({
      definitionStatementId: definition.statementId,
      parameterIndex: parameter.parameterIndex,
      name: parameter.name,
      type: parameter.type,
      ...(parameter.numericTypeOptions ? { numericTypeOptions: parameter.numericTypeOptions } : {}),
      optional: parameter.optional,
      required: parameter.required,
      defaultSourceText: parameter.defaultValue,
      value: valueFor(definition, parameter),
      diagnostic: diagnostics.find((candidate) =>
        candidate.definitionStatementId === definition.statementId &&
        candidate.parameterIndex === parameter.parameterIndex
      ) ?? null
    }))
  });

  const compileWithOverrides = (overrides: ReadonlyMap<string, string>) => {
    const input = rootInputFor(undefined, overrides);
    return input ? compileModulePreviewRoot(input) : null;
  };

  const fallbackExpressionFor = (entry: ActiveParameter): string | null => {
    const lastGood = lastGoodValueByInputKey.get(entry.key);
    if (lastGood !== undefined) return lastGood;
    const current = valueFor(entry.definition, entry.parameter);
    if (isOmitted(current) && (!entry.parameter.required || entry.parameter.defaultValue !== null)) return "";
    const type = entry.parameter.type;
    if (!type) return null;
    switch (type.kind) {
      case "number": return "0";
      case "string": return '""';
      case "boolean": return "false";
      case "choice": {
        const first = type.options[0];
        return first === undefined ? null : choiceLiteralForExpression(first);
      }
      case "point":
      case "line":
      case "path": return null;
    }
  };

  const refreshEditedDiagnostic = (
    editedInput: EditedInput,
    parameters: readonly ActiveParameter[]
  ) => {
    const edited = parameterFor(editedInput.definitionStatementId, editedInput.parameterIndex);
    if (!edited) return;
    const editedKey = keyFor(edited.definition, edited.parameter);
    invalidDiagnosticByInputKey.delete(editedKey);
    if (isOmitted(valueFor(edited.definition, edited.parameter))) return;

    const editedEntry = parameters.find((entry) => entry.key === editedKey);
    if (!editedEntry) return;
    const overrides = new Map<string, string>();
    for (const entry of parameters) {
      if (entry.key === editedKey) continue;
      const fallback = fallbackExpressionFor(entry);
      if (fallback === null) return;
      overrides.set(entry.key, fallback);
    }

    if (compileWithOverrides(overrides)) return;
    const editedFallback = fallbackExpressionFor(editedEntry);
    if (editedFallback === null) return;
    overrides.set(editedKey, editedFallback);
    if (compileWithOverrides(overrides)) {
      invalidDiagnosticByInputKey.set(editedKey, invalidDiagnosticFor(edited.definition, edited.parameter));
    }
  };

  const evaluate = (editedInput?: EditedInput): ModulePreviewSessionSnapshot | null => {
    if (!active) return null;
    const required = requiredDiagnostics();
    const input = rootInputFor();
    const current = required.length === 0 && input ? compileModulePreviewRoot(input) : null;
    const parameters = activeParameters();

    if (current) {
      for (const entry of parameters) {
        invalidDiagnosticByInputKey.delete(entry.key);
        lastGoodValueByInputKey.set(entry.key, valueFor(entry.definition, entry.parameter));
      }
    } else if (editedInput) {
      refreshEditedDiagnostic(editedInput, parameters);
    }

    const requiredKeys = new Set(required.flatMap((diagnostic) => {
      const resolved = parameterFor(diagnostic.definitionStatementId, diagnostic.parameterIndex);
      return resolved ? [keyFor(resolved.definition, resolved.parameter)] : [];
    }));
    const diagnostics = [
      ...required,
      ...parameters.flatMap((entry) => {
        if (requiredKeys.has(entry.key)) return [];
        const diagnostic = invalidDiagnosticByInputKey.get(entry.key);
        return diagnostic ? [diagnostic] : [];
      })
    ];
    const previewKey = previewKeyFor(active);
    if (current) lastGoodByPreviewKey.set(previewKey, current);
    const lastGood = lastGoodByPreviewKey.get(previewKey) ?? null;
    const preview: ModulePreviewRenderState = current
      ? { kind: "current", result: current }
      : lastGood
        ? { kind: "lastGood", result: lastGood }
        : { kind: "noValidPreview", result: null };
    const targetDefinition = active.chain[active.chain.length - 1];
    if (!targetDefinition) return null;
    state = {
      sourceRevision: active.source.sourceRevision,
      target: active.target,
      ancestorContexts: active.chain.slice(0, -1).map((definition) => buildGroup(definition, "ancestor", diagnostics)),
      parameters: buildGroup(targetDefinition, "target", diagnostics),
      inputDiagnostics: diagnostics,
      preview
    };
    return state;
  };

  const activate = (input: ModulePreviewActivateInput): ModulePreviewSessionSnapshot | null => {
    const compiled = exactCompiled(input.source, input.semantic);
    if (!compiled) return null;
    const chain = definitionChainFor(compiled, input.target);
    if (!chain) return null;
    active = { ...input, compiled, chain };
    return evaluate();
  };

  const setValue = (
    definitionStatementId: StatementIdentity,
    parameterIndex: number,
    expression: string
  ): ModulePreviewSessionSnapshot | null => {
    const resolved = parameterFor(definitionStatementId, parameterIndex);
    if (!active || !resolved) return state;
    valueByInputKey.set(keyFor(resolved.definition, resolved.parameter), expression);
    return evaluate({ definitionStatementId, parameterIndex });
  };

  const useDefaultExplicitly = (
    definitionStatementId: StatementIdentity,
    parameterIndex: number
  ): ModulePreviewDefaultActionResult => {
    const resolved = parameterFor(definitionStatementId, parameterIndex);
    if (!active || !resolved || resolved.parameter.defaultValue === null) return { applied: false, state };
    const currentActive = active;
    const type = resolved.parameter.type;
    if (!type || (type.kind !== "number" && type.kind !== "string" && type.kind !== "boolean" && type.kind !== "choice")) {
      return { applied: false, state };
    }

    const input = rootInputFor({ definitionStatementId, parameterIndex });
    const preview = input ? compileModulePreviewRoot(input) : null;
    if (!preview) return { applied: false, state };

    const syntheticInstance = preview.moduleSemanticAnalysis.instances.find((instance) =>
      instance.statementIndex >= currentActive.compiled.statements.length &&
      instance.callee?.definitionStatementId === definitionStatementId
    );
    if (!syntheticInstance) return { applied: false, state };
    const binding = preview.moduleScalarRuntime.bindingAnalysis.catalog.bindings.find((candidate) =>
      candidate.kind === "typed" &&
      candidate.resolutionMode === "preResolvedOnly" &&
      candidate.statementIndex === syntheticInstance.statementIndex &&
      candidate.name === resolved.parameter.name
    );
    if (!binding) return { applied: false, state };

    const evaluation = createLazyScalarProgramEvaluator(preview.moduleScalarRuntime.scalarProgram).resolve(binding.id);
    const literal = scalarLiteralForEvaluation(evaluation);
    if (literal === null) return { applied: false, state };
    return { applied: true, state: setValue(definitionStatementId, parameterIndex, literal) };
  };

  return {
    getState: () => state,
    activate,
    setValue,
    useDefaultExplicitly
  };
};
