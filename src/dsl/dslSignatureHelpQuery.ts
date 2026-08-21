import {
  dslCallCompletionContextAt,
  type DslCallCompletionContext
} from "./dslCallCompletionContext";
import {
  dslCallAuthoringContextAt,
  type DslCallAuthoringContext
} from "./dslCallAuthoringContext";
import { dslCompletionMetadataForType } from "./dslCompletionMetadata";
import { userFacingConstructionArgumentSpecs } from "./dslCallCompletionCandidates";
import type { CompiledDslDocument } from "./dslDocument";
import type { DslModuleParameterType } from "./dslTypes";
import type { SourceSnapshot } from "./logicalStatementSourceMap";
import {
  getBuiltinFunctionDefinition,
  type BuiltinFunctionDefinition,
  type BuiltinFunctionSignature,
  type BuiltinParameterType
} from "../scalars/builtinFunctions";
import {
  scalarTypeForParameterDefinition,
  type ParameterDefinition
} from "../parameters/parameterDefinitions";
import type { ScalarType } from "../scalars/types";

export type DslSignatureHelpDocumentation = {
  /** Existing metadata, not localized text. The VS Code adapter selects it. */
  en: string;
  ja?: string;
};

export type DslSignatureHelpParameter = {
  identity: string;
  name: string;
  type?: string;
  optional: boolean;
  defaultValue?: string;
  allowedValues?: readonly string[];
  positional?: boolean;
  documentation?: DslSignatureHelpDocumentation;
};

export type DslSignatureHelpSignature = {
  identity: string;
  name: string;
  parameters: readonly DslSignatureHelpParameter[];
  returnType?: string;
  documentation?: DslSignatureHelpDocumentation;
  callingStyle: "positional" | "named" | "construction" | "module";
};

export type DslSignatureHelpQueryResult = {
  signatures: readonly DslSignatureHelpSignature[];
  activeSignature: number;
  activeParameter?: number;
};

export type DslSignatureHelpSemanticSnapshot = {
  sourceRevision: SourceSnapshot["sourceRevision"];
  sourceText: string;
  compiled: CompiledDslDocument;
};

export type DslSignatureHelpQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslSignatureHelpSemanticSnapshot;
};

const scalarTypeName = (type: ScalarType): string =>
  type.kind === "choice" ? `choice(${type.options.join(", ")})` : type.kind;

const builtinTypeName = (type: BuiltinParameterType): string =>
  typeof type === "string" ? type : scalarTypeName(type);

const moduleTypeName = (type: DslModuleParameterType | null): string | undefined => {
  if (!type) return undefined;
  return typeof type === "object" && "options" in type
    ? scalarTypeName(type)
    : type.kind;
};

const scalarModuleType = (type: DslModuleParameterType | null): ScalarType | null =>
  type && typeof type !== "string" && ["number", "string", "boolean", "choice"].includes(type.kind)
    ? type as ScalarType
    : null;

const allowedValuesFor = (type: ScalarType | null | undefined): readonly string[] | undefined => {
  if (!type) return undefined;
  if (type.kind === "boolean") return ["true", "false"];
  if (type.kind === "choice") return type.options;
  return undefined;
};

const parameterMetadataFor = (
  definition: ParameterDefinition,
  identity: string,
  name: string,
  optional: boolean,
  positional: boolean
): DslSignatureHelpParameter => {
  const scalarType = scalarTypeForParameterDefinition(definition);
  const type = scalarType
    ? scalarTypeName(scalarType)
    : definition.kind === "reference"
      ? "point"
      : definition.kind === "lineEndpointReference"
        ? "line endpoint"
        : definition.kind === "lineReference" || definition.kind === "lineReferenceList"
          ? "line"
          : definition.kind;
  return {
    identity,
    name,
    type,
    optional,
    positional,
    ...(definition.emptyInputDefaultValue !== undefined
      ? { defaultValue: String(definition.emptyInputDefaultValue) }
      : {}),
    ...(allowedValuesFor(scalarType) ? { allowedValues: allowedValuesFor(scalarType) } : {}),
    ...(definition.label !== name
      ? { documentation: { en: name, ja: definition.label } }
      : {})
  };
};

const builtinParameter = (
  callableName: string,
  signatureIndex: number,
  parameterIndex: number,
  parameter: BuiltinFunctionSignature["parameters"][number]
): DslSignatureHelpParameter => {
  const named = "name" in parameter ? parameter.name : `arg${parameterIndex + 1}`;
  const scalarType = typeof parameter.type === "string" ? null : parameter.type;
  return {
    identity: `builtin:${callableName}:${signatureIndex}:${parameterIndex}`,
    name: named,
    type: builtinTypeName(parameter.type),
    optional: false,
    positional: !("name" in parameter),
    ...(allowedValuesFor(scalarType) ? { allowedValues: allowedValuesFor(scalarType) } : {})
  };
};

const builtinSignaturesFor = (definition: BuiltinFunctionDefinition): readonly DslSignatureHelpSignature[] =>
  definition.signatures.map((signature, signatureIndex) => ({
    identity: `builtin:${definition.name}:${signatureIndex}`,
    name: definition.name,
    callingStyle: signature.callingStyle,
    parameters: signature.parameters.map((parameter, parameterIndex) =>
      builtinParameter(definition.name, signatureIndex, parameterIndex, parameter)
    ),
    returnType: builtinTypeName(signature.returnType)
  }));

const constructionContext = (authoring: DslCallAuthoringContext): DslCallCompletionContext & { kind: "argument" } | null => {
  const context = dslCallCompletionContextAt(authoring.logicalText, authoring.callee.logicalOpenParen + 1);
  return context?.kind === "argument" ? context : null;
};

const constructionSignatureFor = (
  authoring: DslCallAuthoringContext
): DslSignatureHelpSignature | null => {
  const context = constructionContext(authoring);
  if (!context) return null;
  const specs = userFacingConstructionArgumentSpecs(context.spec);
  const metadata = dslCompletionMetadataForType(context.spec.elementType);
  const parameters = specs.map((arg) => {
    const parameterKey = arg.parameterKey ?? arg.arg;
    const metadataParameter = metadata.parameters.find((candidate) =>
      candidate.source === "attr" && candidate.key === arg.arg
    ) ?? metadata.parameters.find((candidate) =>
      candidate.source === "attr" && candidate.key === parameterKey
    );
    return metadataParameter
      ? parameterMetadataFor(
          metadataParameter.definition,
          `construction:${context.spec.category}:${context.spec.construction}:${arg.arg}`,
          arg.arg,
          !arg.required,
          Boolean(arg.positional)
        )
      : {
          identity: `construction:${context.spec.category}:${context.spec.construction}:${arg.arg}`,
          name: arg.arg,
          optional: !arg.required,
          positional: Boolean(arg.positional)
        };
  });
  return {
    identity: `construction:${context.spec.category}:${context.spec.construction}`,
    name: authoring.callee.name,
    callingStyle: "construction",
    parameters,
    documentation: {
      en: context.spec.category === "mutation" ? "Mutation" : "Construction",
      ja: context.spec.category === "mutation" ? "変更" : "構築"
    }
  };
};

const moduleSignatureFor = (
  authoring: DslCallAuthoringContext,
  semantic: DslSignatureHelpSemanticSnapshot | undefined
): DslSignatureHelpSignature | null => {
  const analysis = semantic?.compiled.moduleSemanticAnalysis;
  if (!analysis) return null;
  const compiled = semantic.compiled;
  const statementIndex = compiled.statements.findIndex((statement) =>
    statement.documentRange.from === authoring.sourceOrderAnchor.statementRange.from
  );
  const statement = compiled.statements[statementIndex];
  if (statement?.kind !== "moduleInstance") return null;
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  if (!statementId) return null;
  const instance = analysis.instancesByStatementId.get(statementId);
  if (
    !instance ||
    instance.calleeResolution !== "resolved" ||
    !instance.callee ||
    instance.callee.name !== authoring.callee.name
  ) return null;
  const definition = analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
  if (!definition) return null;

  return {
    identity: `module:${definition.statementId}`,
    name: definition.name,
    callingStyle: "module",
    parameters: definition.parameters.map((parameter) => ({
      identity: `module:${definition.statementId}:${parameter.parameterIndex}`,
      name: parameter.name,
      type: moduleTypeName(parameter.type),
      optional: parameter.optional,
      ...(parameter.defaultValue !== null ? { defaultValue: parameter.defaultValue } : {}),
      ...(allowedValuesFor(scalarModuleType(parameter.type))
        ? { allowedValues: allowedValuesFor(scalarModuleType(parameter.type)) }
        : {})
    }))
  };
};

const exactSemantic = (
  source: SourceSnapshot,
  semantic: DslSignatureHelpSemanticSnapshot | undefined
): semantic is DslSignatureHelpSemanticSnapshot => Boolean(
  semantic &&
  semantic.sourceRevision === source.sourceRevision &&
  semantic.sourceText === source.normalizedSource &&
  semantic.compiled.spans.sourceMap.source === source.normalizedSource
);

const activeParameterFor = (
  source: SourceSnapshot,
  authoring: DslCallAuthoringContext,
  signature: DslSignatureHelpSignature
): number | undefined => {
  if (authoring.argument.label) {
    const label = source.normalizedSource.slice(authoring.argument.label.from, authoring.argument.label.to);
    const parameterIndex = signature.parameters.findIndex((parameter) => parameter.name === label);
    return parameterIndex >= 0 ? parameterIndex : undefined;
  }
  if (signature.callingStyle === "named" || signature.callingStyle === "module") return undefined;
  const parameter = signature.parameters[authoring.argument.index];
  return parameter?.positional ? authoring.argument.index : undefined;
};

const activeBuiltinSignatureFor = (
  definition: BuiltinFunctionDefinition,
  authoring: DslCallAuthoringContext,
  source: SourceSnapshot
): number => {
  const label = authoring.argument.label
    ? source.normalizedSource.slice(authoring.argument.label.from, authoring.argument.label.to)
    : null;
  const candidates = definition.signatures
    .map((signature, index) => ({ signature, index }))
    .filter(({ signature }) => {
      if (label !== null) return signature.callingStyle === "named" && signature.parameters.some((parameter) => parameter.name === label);
      return signature.callingStyle === "positional" && authoring.argument.index < signature.parameters.length;
    });
  return candidates.length === 1 ? candidates[0]!.index : 0;
};

export const queryDslSignatureHelp = ({
  source,
  position,
  semantic
}: DslSignatureHelpQueryInput): DslSignatureHelpQueryResult | null => {
  if (source.normalizedSource.includes("\r") || position < 0 || position > source.normalizedSource.length) return null;
  const authoring = dslCallAuthoringContextAt(source, position);
  if (!authoring) return null;

  if (authoring.kind === "builtin") {
    const definition = getBuiltinFunctionDefinition(authoring.callee.name);
    if (!definition) return null;
    const signatures = builtinSignaturesFor(definition);
    const activeSignature = activeBuiltinSignatureFor(definition, authoring, source);
    const activeParameter = activeParameterFor(source, authoring, signatures[activeSignature]!);
    return {
      signatures,
      activeSignature,
      ...(activeParameter !== undefined
        ? { activeParameter }
        : {})
    };
  }

  const signature = authoring.kind === "construction"
    ? constructionSignatureFor(authoring)
    : exactSemantic(source, semantic)
      ? moduleSignatureFor(authoring, semantic)
      : null;
  if (!signature) return null;
  const activeParameter = activeParameterFor(source, authoring, signature);
  return {
    signatures: [signature],
    activeSignature: 0,
    ...(activeParameter !== undefined ? { activeParameter } : {})
  };
};
