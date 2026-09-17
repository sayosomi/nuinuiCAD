import type { DslModuleParameterType, DslNumericTypeOptions } from "@nuinuicad/nui-language";
import { scanCallArgs, scanDslSource } from "@nuinuicad/nui-language";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";

export type ModulePreviewInvocationCallerSite = {
  statementIndex: number;
  scopeId: string;
  sourceOrderIndex: number;
};

export type ModulePreviewInvocationParameterInput = {
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  name: string;
  type: DslModuleParameterType | null;
  recordTypeIdentity?: string | null;
  numericTypeOptions?: DslNumericTypeOptions;
  optional: boolean;
  required: boolean;
  defaultSourceText: string | null;
  /** True when the argument is an explicit caller-side argument. */
  active: boolean;
  /** Exact caller-side expression text. Empty text is meaningful while editing. */
  value: string;
  caller: ModulePreviewInvocationCallerSite;
};

export type ModulePreviewInvocationBlockInput = {
  kind: "ancestor" | "target";
  definitionStatementId: StatementIdentity;
  definitionStatementIndex: number;
  declarationScopeId: string;
  name: string;
  parameters: readonly ModulePreviewInvocationParameterInput[];
};

export type ModulePreviewInvocationParameterSite = ModulePreviewInvocationParameterInput & {
  /** Range of the complete visible argument line, including a comment marker. */
  lineRange: { from: number; to: number };
  /** Range of the visible argument name, excluding `//` and whitespace. */
  labelRange: { from: number; to: number };
  /** Range of the visible expression. For an empty active argument this is a cursor range. */
  valueRange: { from: number; to: number };
  /** True when the line is a semantic omission rather than a supplied argument. */
  omitted: boolean;
};

export type ModulePreviewInvocationArgument = {
  name: string;
  expression: string;
  parameterIndex: number | null;
  range: { from: number; to: number };
};

export type ModulePreviewInvocationBlock = Omit<ModulePreviewInvocationBlockInput, "parameters"> & {
  text: string;
  callRange: { from: number; to: number };
  parameters: readonly ModulePreviewInvocationParameterSite[];
  activeArguments: readonly ModulePreviewInvocationArgument[];
};

export type ModulePreviewInvocation = {
  blocks: readonly ModulePreviewInvocationBlock[];
};

const trimRange = (source: string, from: number, to: number): { from: number; to: number } => {
  while (from < to && /\s/.test(source[from] ?? "")) from += 1;
  while (to > from && /\s/.test(source[to - 1] ?? "")) to -= 1;
  return { from, to };
};

const separatorFor = (parameterIndex: number, parameterCount: number): string =>
  parameterIndex < parameterCount - 1 ? "," : "";

/**
 * Render one ephemeral call. The text is deliberately ordinary nui call text:
 * comments are only the omission presentation and never acquire Preview-only
 * syntax or semantics.
 */
export const modulePreviewInvocationTextFor = (
  block: Pick<ModulePreviewInvocationBlockInput, "name" | "parameters">
): string => [
  `${block.name}(`,
  ...block.parameters.map((parameter) => {
    const separator = separatorFor(parameter.parameterIndex, block.parameters.length);
    if (parameter.active) return `  ${parameter.name}: ${parameter.value}${separator}`;
    const defaultText = parameter.defaultSourceText ?? "";
    return `  // ${parameter.name}:${defaultText.length > 0 ? ` ${defaultText}` : ""}${separator}`;
  }),
  ")"
].join("\n");

const codeViewFor = (source: string): string => scanDslSource(source).lines.map((line) => line.code).join("\n");

const lineParameterFor = (
  source: string,
  lineStart: number,
  lineEnd: number,
  parameter: ModulePreviewInvocationParameterInput
): { labelRange: { from: number; to: number }; active: boolean; valueRange: { from: number; to: number } } | null => {
  const line = source.slice(lineStart, lineEnd);
  const escapedName = parameter.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^(\\s*)(//\\s*)?${escapedName}\\s*:`).exec(line);
  if (!match) return null;
  const labelFrom = lineStart + match[1]!.length + (match[2]?.length ?? 0);
  const labelTo = labelFrom + parameter.name.length;
  const colon = lineStart + (match.index ?? 0) + match[0].lastIndexOf(":");
  const visibleValue = trimRange(source, colon + 1, lineEnd);
  const valueTo = visibleValue.to > visibleValue.from && source[visibleValue.to - 1] === ","
    ? trimRange(source, visibleValue.from, visibleValue.to - 1)
    : visibleValue;
  return {
    labelRange: { from: labelFrom, to: labelTo },
    active: !match[2],
    valueRange: valueTo
  };
};

const callOpenAt = (source: string): number => {
  const match = /^\s*[^\s(]+\s*\(/.exec(source);
  return match ? match[0].lastIndexOf("(") : -1;
};

/** Parse only the ordinary call representation; delimiter and argument work is
 * delegated to the shared nui scanner. */
export const parseModulePreviewInvocationBlock = (
  input: ModulePreviewInvocationBlockInput & { text: string }
): ModulePreviewInvocationBlock => {
  const source = input.text;
  const open = callOpenAt(source);
  const close = source.lastIndexOf(")");
  const callFrom = open >= 0 ? 0 : 0;
  const callTo = close >= 0 ? close + 1 : source.length;
  const code = codeViewFor(source);
  const codeOpen = callOpenAt(code);
  const codeClose = code.lastIndexOf(")");
  const args = codeOpen >= 0
    ? scanCallArgs(code, { start: codeOpen + 1, end: codeClose >= codeOpen ? codeClose : code.length })
    : { args: [], errors: [] };
  const argsByName = new Map<string, ModulePreviewInvocationArgument>();
  for (const argument of args.args) {
    if (!argument.key || argsByName.has(argument.key)) continue;
    argsByName.set(argument.key, {
      name: argument.key,
      expression: argument.value,
      parameterIndex: input.parameters.find((parameter) => parameter.name === argument.key)?.parameterIndex ?? null,
      range: { from: argument.valueSpan.start, to: argument.valueSpan.end }
    });
  }
  const parameters = input.parameters.map((parameter) => {
    const position = [...source.split("\n").entries()].find(([index, line]) => {
      const from = source.split("\n").slice(0, index).reduce((total, part) => total + part.length + 1, 0);
      return lineParameterFor(source, from, from + line.length, parameter) !== null;
    });
    const lineStart = position
      ? source.split("\n").slice(0, position[0]).reduce((total, line) => total + line.length + 1, 0)
      : 0;
    const lineEnd = position ? lineStart + position[1].length : 0;
    const line = position ? lineParameterFor(source, lineStart, lineEnd, parameter) : null;
    const activeArgument = argsByName.get(parameter.name);
    const active = line?.active === true;
    const value = activeArgument?.expression ?? (active && line ? source.slice(line.valueRange.from, line.valueRange.to) : "");
    return {
      ...parameter,
      active,
      value,
      lineRange: { from: lineStart, to: lineEnd },
      labelRange: line?.labelRange ?? { from: lineStart, to: lineStart },
      valueRange: activeArgument?.range ?? line?.valueRange ?? { from: lineStart, to: lineStart },
      omitted: !active
    } satisfies ModulePreviewInvocationParameterSite;
  });
  return {
    ...input,
    text: source,
    callRange: { from: callFrom, to: callTo },
    parameters,
    activeArguments: [
      ...argsByName.values(),
      ...parameters
        .filter((parameter) => parameter.active && !argsByName.has(parameter.name))
        .map((parameter) => ({
          name: parameter.name,
          expression: parameter.value,
          parameterIndex: parameter.parameterIndex,
          range: parameter.valueRange
        }))
    ]
  };
};

export const modulePreviewInvocationFor = ({
  blocks
}: {
  blocks: readonly ModulePreviewInvocationBlockInput[];
}): ModulePreviewInvocation => ({
  blocks: blocks.map((block) => parseModulePreviewInvocationBlock({
    ...block,
    text: modulePreviewInvocationTextFor(block)
  }))
});

export const modulePreviewInvocationParameterSiteAt = (
  invocation: ModulePreviewInvocation,
  definitionStatementId: StatementIdentity,
  position: number
): ModulePreviewInvocationParameterSite | null => {
  const block = invocation.blocks.find((candidate) => candidate.definitionStatementId === definitionStatementId);
  return block?.parameters.find((parameter) => position >= parameter.lineRange.from && position <= parameter.lineRange.to) ?? null;
};

export const modulePreviewInvocationBlockWithText = (
  invocation: ModulePreviewInvocation,
  definitionStatementId: StatementIdentity,
  text: string
): ModulePreviewInvocation => ({
  blocks: invocation.blocks.map((block) => block.definitionStatementId === definitionStatementId
    ? parseModulePreviewInvocationBlock({ ...block, text })
    : block)
});

export const modulePreviewInvocationArgumentStateFor = (
  invocation: ModulePreviewInvocation
): ReadonlyMap<StatementIdentity, readonly ModulePreviewInvocationArgument[]> => new Map(
  invocation.blocks.map((block) => [block.definitionStatementId, block.activeArguments] as const)
);
