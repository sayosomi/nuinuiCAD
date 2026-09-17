import type { StatementIdentity } from "@nuinuicad/nui-language/document";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { DslDiagnosticPresentation, DslStatement } from "@nuinuicad/nui-language";
import { IDENTIFIER_PATTERN } from "@nuinuicad/nui-language";
import {
  compileModulePreviewRoot,
  type ModulePreviewArgument,
  type ModulePreviewRootInput,
  type ModulePreviewRootResult
} from "./modulePreviewRoot";
import type {
  ModuleDefinitionSemantic,
  ResolvedModuleParameter
} from "@nuinuicad/nui-language";
import type { DslNumericTypeOptions } from "@nuinuicad/nui-language";
import type {
  ModulePreviewTarget,
  ModulePreviewTargetSemanticSnapshot,
  SourceSnapshot
} from "./modulePreviewTarget";
import {
  modulePreviewInvocationBlockWithText,
  modulePreviewInvocationFor,
  type ModulePreviewInvocation,
  type ModulePreviewInvocationBlockInput
} from "./modulePreviewInvocation";

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
  /** Whether the visible invocation line is an active explicit argument. */
  active: boolean;
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
  /** The exact ephemeral invocation text and semantic sites shown by Preview. */
  invocation: ModulePreviewInvocation;
  inputDiagnostics: readonly ModulePreviewInputDiagnostic[];
  preview: ModulePreviewRenderState;
};

export type ModulePreviewActivateInput = {
  source: SourceSnapshot;
  semantic: ModulePreviewTargetSemanticSnapshot;
  target: ModulePreviewTarget;
};

export type ModulePreviewSession = {
  getState(): ModulePreviewSessionSnapshot | null;
  activate(input: ModulePreviewActivateInput): ModulePreviewSessionSnapshot | null;
  /** Apply one edited call block in one semantic update. */
  setInvocationText(
    definitionStatementId: StatementIdentity,
    text: string
  ): ModulePreviewSessionSnapshot | null;
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

type ActiveParameterValue = {
  value: string;
  active: boolean;
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

const choiceLiteralForExpression = (value: string): string | null => {
  if (value === "true" || value === "false") return null;
  return IDENTIFIER_PATTERN.exec(value)?.[0] === value ? value : null;
};

export const createModulePreviewSession = (): ModulePreviewSession => {
  const valueByInputKey = new Map<string, ActiveParameterValue>();
  const lastGoodByPreviewKey = new Map<string, ModulePreviewRootResult>();
  const lastGoodValueByInputKey = new Map<string, ActiveParameterValue>();
  const invalidDiagnosticByInputKey = new Map<string, ModulePreviewInputDiagnostic>();
  const invocationTextByPreviewKey = new Map<string, Map<StatementIdentity, string>>();
  let active: ActivePreview | null = null;
  let state: ModulePreviewSessionSnapshot | null = null;

  const keyFor = (definition: ModuleDefinitionSemantic, parameter: ResolvedModuleParameter) =>
    active ? inputKeyFor(active.target.definitionStatementId, definition, parameter) : "";

  const inputValueFor = (definition: ModuleDefinitionSemantic, parameter: ResolvedModuleParameter): ActiveParameterValue =>
    active
      ? valueByInputKey.get(keyFor(definition, parameter)) ?? {
          value: "",
          active: parameter.required && parameter.defaultValue === null
        }
      : { value: "", active: false };

  const valueFor = (definition: ModuleDefinitionSemantic, parameter: ResolvedModuleParameter) =>
    inputValueFor(definition, parameter).value;

  const activeFor = (definition: ModuleDefinitionSemantic, parameter: ResolvedModuleParameter) =>
    inputValueFor(definition, parameter).active;

  const invocationBlockInputFor = (
    definition: ModuleDefinitionSemantic,
    kind: ModulePreviewInvocationBlockInput["kind"]
  ): ModulePreviewInvocationBlockInput => ({
    kind,
    definitionStatementId: definition.statementId,
    definitionStatementIndex: definition.statementIndex,
    declarationScopeId: definition.declarationScopeId,
    name: definition.name,
    parameters: definition.parameters.map((parameter) => ({
      definitionStatementId: definition.statementId,
      parameterIndex: parameter.parameterIndex,
      name: parameter.name,
      type: parameter.type,
      recordTypeIdentity: parameter.recordTypeIdentity,
      ...(parameter.numericTypeOptions ? { numericTypeOptions: parameter.numericTypeOptions } : {}),
      optional: parameter.optional,
      required: parameter.required,
      defaultSourceText: parameter.defaultValue,
      active: activeFor(definition, parameter),
      value: valueFor(definition, parameter),
      caller: {
        statementIndex: definition.statementIndex,
        scopeId: definition.declarationScopeId,
        sourceOrderIndex: definition.statementIndex
      }
    }))
  });

  const invocationBlockInputsFor = (
    chain: readonly ModuleDefinitionSemantic[]
  ): ModulePreviewInvocationBlockInput[] => chain.map((definition, index) =>
    invocationBlockInputFor(definition, index === chain.length - 1 ? "target" : "ancestor")
  );

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
    const key = keyFor(definition, parameter);
    const input = valueByInputKey.get(key) ?? { value: "", active: false };
    const expression = overrides?.get(key) ?? input.value;
    if (overrides?.has(key)) return isOmitted(expression) ? [] : [{ name: parameter.name, expression }];
    return input.active ? [{ name: parameter.name, expression }] : [];
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
      const input = inputValueFor(definition, parameter);
      if (!parameter.required || parameter.defaultValue !== null || (input.active && !isOmitted(input.value))) return [];
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
      active: activeFor(definition, parameter),
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
    if (lastGood !== undefined) return lastGood.active ? lastGood.value : "";
    const current = inputValueFor(entry.definition, entry.parameter);
    if (!current.active && (!entry.parameter.required || entry.parameter.defaultValue !== null)) return "";
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
    const editedValue = inputValueFor(edited.definition, edited.parameter);
    if (!editedValue.active) return;

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

  const evaluate = (editedInputs: readonly EditedInput[] = []): ModulePreviewSessionSnapshot | null => {
    if (!active) return null;
    const required = requiredDiagnostics();
    const input = rootInputFor();
    const current = required.length === 0 && input ? compileModulePreviewRoot(input) : null;
    const parameters = activeParameters();

    if (current) {
      for (const entry of parameters) {
        invalidDiagnosticByInputKey.delete(entry.key);
        lastGoodValueByInputKey.set(entry.key, inputValueFor(entry.definition, entry.parameter));
      }
    } else {
      for (const editedInput of editedInputs) refreshEditedDiagnostic(editedInput, parameters);
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
    const chain = active.chain;
    const targetDefinition = chain[chain.length - 1];
    if (!targetDefinition) return null;
    const invocationBlocks = invocationBlockInputsFor(chain);
    const savedTexts = invocationTextByPreviewKey.get(previewKey);
    const invocation = modulePreviewInvocationFor({ blocks: invocationBlocks }).blocks.map((block) =>
      savedTexts?.has(block.definitionStatementId)
        ? modulePreviewInvocationBlockWithText({ blocks: [block] }, block.definitionStatementId, savedTexts.get(block.definitionStatementId) ?? "").blocks[0]!
        : block
    );
    state = {
      sourceRevision: active.source.sourceRevision,
      target: active.target,
      ancestorContexts: active.chain.slice(0, -1).map((definition) => buildGroup(definition, "ancestor", diagnostics)),
      parameters: buildGroup(targetDefinition, "target", diagnostics),
      invocation: { blocks: invocation },
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
    const previewKey = previewKeyFor(active);
    const savedTexts = invocationTextByPreviewKey.get(previewKey);
    if (savedTexts) {
      const blocks = modulePreviewInvocationFor({ blocks: invocationBlockInputsFor(chain) });
      for (const block of blocks.blocks) {
        if (!savedTexts.has(block.definitionStatementId)) continue;
        const text = savedTexts.get(block.definitionStatementId) ?? "";
        const parsed = modulePreviewInvocationBlockWithText({ blocks: [block] }, block.definitionStatementId, text).blocks[0]!;
        for (const parameter of parsed.parameters) {
          const definition = chain.find((candidate) => candidate.statementId === block.definitionStatementId);
          const resolved = definition?.parameters.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
          if (!definition || !resolved) continue;
          valueByInputKey.set(inputKeyFor(input.target.definitionStatementId, definition, resolved), {
            value: parameter.value,
            active: !parameter.omitted
          });
        }
      }
    }
    return evaluate();
  };

  const setInvocationText = (
    definitionStatementId: StatementIdentity,
    text: string
  ): ModulePreviewSessionSnapshot | null => {
    if (!active) return state;
    const definition = active.chain.find((candidate) => candidate.statementId === definitionStatementId);
    if (!definition) return state;
    const previewKey = previewKeyFor(active);
    const texts = invocationTextByPreviewKey.get(previewKey) ?? new Map<StatementIdentity, string>();
    texts.set(definitionStatementId, text);
    invocationTextByPreviewKey.set(previewKey, texts);
    const base = modulePreviewInvocationFor({
      blocks: [invocationBlockInputFor(definition, active.chain.at(-1) === definition ? "target" : "ancestor")]
    });
    const parsed = modulePreviewInvocationBlockWithText(base, definitionStatementId, text).blocks[0];
    if (parsed) {
      for (const parameter of parsed.parameters) {
        const resolved = definition.parameters.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
        if (!resolved) continue;
        valueByInputKey.set(keyFor(definition, resolved), { value: parameter.value, active: !parameter.omitted });
      }
    }
    // Derived values from every block are visible to one compile. This avoids
    // exposing a sequence of intermediate row updates to the evaluator.
    return evaluate(definition.parameters.map((parameter) => ({
      definitionStatementId,
      parameterIndex: parameter.parameterIndex
    })));
  };

  return {
    getState: () => state,
    activate,
    setInvocationText
  };
};
