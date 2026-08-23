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
import { createCadElement } from "../model/elementFactory";
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
import { getParameterValue } from "../parameters/parameterAccess";
import type { CadElementType } from "../types/geometry";
import type { ScalarType } from "../scalars/types";

export type DslSignatureHelpDocumentation = {
  /** Stable localization key; the host presentation layer selects the locale. */
  key: string;
  parameters?: Readonly<Record<string, string | number | boolean>>;
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
  typeof type === "string"
    ? type
    : type.kind === "anyChoice"
      ? "choice(...)"
      : scalarTypeName(type);

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

const parameterTypeFor = (definition: ParameterDefinition): string | undefined => {
  const scalarType = scalarTypeForParameterDefinition(definition);
  if (scalarType) return scalarTypeName(scalarType);
  switch (definition.kind) {
    case "reference":
      return "point";
    case "lineReference":
      return "line";
    default:
      // `lineEndpointReference` and `lineReferenceList` have no single
      // established nui4 type spelling. Their documentation carries the
      // structural meaning instead of presenting an invented type.
      return undefined;
  }
};

const constructionDefaults = new Map<CadElementType, ReturnType<typeof createCadElement>>();

const constructionDefaultFor = (
  elementType: CadElementType,
  definition: ParameterDefinition
): string | undefined => {
  if (definition.kind !== "number" && definition.kind !== "boolean" && definition.kind !== "choice") {
    return undefined;
  }
  let element = constructionDefaults.get(elementType);
  if (!element) {
    element = createCadElement(elementType, [], { createId: (type) => `signature-help-${type}` });
    constructionDefaults.set(elementType, element);
  }
  const value = getParameterValue(element, definition.key);
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : undefined;
};

const genericParameterDocumentationKeyFor = (definition: ParameterDefinition): string => {
  switch (definition.kind) {
    case "reference":
      return "signatureHelp.parameter.pointReference";
    case "lineEndpointReference":
      return "signatureHelp.parameter.lineEndpointReference";
    case "lineReference":
      return "signatureHelp.parameter.lineReference";
    case "lineReferenceList":
      return "signatureHelp.parameter.lineReferenceList";
    case "number":
      return "signatureHelp.parameter.number";
    case "boolean":
      return "signatureHelp.parameter.boolean";
    case "choice":
      return "signatureHelp.parameter.choice";
    case "text":
      return "signatureHelp.parameter.text";
  }
};

const constructionParameterDocumentationKeyFor = (
  category: string,
  construction: string,
  argName: string,
  definition: ParameterDefinition | undefined
): string => {
  if (category === "point" && construction === "coordinate" && argName === "x") {
    return "signatureHelp.construction.point.coordinate.x";
  }
  if (category === "point" && construction === "coordinate" && argName === "y") {
    return "signatureHelp.construction.point.coordinate.y";
  }
  if (category === "line" && construction === "segment" && argName === "start") {
    return "signatureHelp.construction.line.segment.start";
  }
  if (category === "line" && construction === "segment" && argName === "end") {
    return "signatureHelp.construction.line.segment.end";
  }
  if (category === "line" && construction === "offset" && argName === "distance") {
    return "signatureHelp.construction.line.offset.distance";
  }
  if (category === "line" && construction === "offset" && argName === "side") {
    return "signatureHelp.construction.line.offset.side";
  }
  if (category === "line" && construction === "offset" && argName === "closed") {
    return "signatureHelp.construction.line.offset.closed";
  }
  return definition
    ? genericParameterDocumentationKeyFor(definition)
    : "signatureHelp.parameter.argument";
};

const parameterMetadataFor = (
  definition: ParameterDefinition,
  elementType: CadElementType,
  identity: string,
  name: string,
  optional: boolean,
  positional: boolean,
  documentationKey: string
): DslSignatureHelpParameter => {
  const scalarType = scalarTypeForParameterDefinition(definition);
  const type = parameterTypeFor(definition);
  const defaultValue = constructionDefaultFor(elementType, definition);
  return {
    identity,
    name,
    type,
    optional,
    positional,
    ...(defaultValue !== undefined
      ? { defaultValue }
      : {}),
    ...(allowedValuesFor(scalarType) ? { allowedValues: allowedValuesFor(scalarType) } : {}),
    documentation: { key: documentationKey }
  };
};

const builtinParameter = (
  callableName: string,
  signatureIndex: number,
  parameterIndex: number,
  parameter: BuiltinFunctionSignature["parameters"][number]
): DslSignatureHelpParameter => {
  const named = "name" in parameter ? parameter.name : `arg${parameterIndex + 1}`;
  const scalarType = typeof parameter.type === "string" || parameter.type.kind === "anyChoice"
    ? null
    : parameter.type;
  const documentationKey = "name" in parameter
    ? `signatureHelp.builtin.${callableName}.${named}`
    : typeof parameter.type === "string"
      ? `signatureHelp.parameter.${parameter.type}`
      : `signatureHelp.parameter.${parameter.type.kind === "anyChoice" ? "choice" : parameter.type.kind}`;
  return {
    identity: `builtin:${callableName}:${signatureIndex}:${parameterIndex}`,
    name: named,
    type: builtinTypeName(parameter.type),
    optional: false,
    positional: !("name" in parameter),
    ...(allowedValuesFor(scalarType) ? { allowedValues: allowedValuesFor(scalarType) } : {}),
    documentation: { key: documentationKey }
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
    returnType: builtinTypeName(signature.returnType),
    documentation: { key: `signatureHelp.builtin.${definition.name}` }
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
  const constructionName = context.spec.construction || context.spec.category;
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
          context.spec.elementType,
          `construction:${context.spec.category}:${context.spec.construction}:${arg.arg}`,
          arg.arg,
          !arg.required,
          Boolean(arg.positional),
          constructionParameterDocumentationKeyFor(
            context.spec.category,
            context.spec.construction,
            arg.arg,
            metadataParameter.definition
          )
        )
      : {
          identity: `construction:${context.spec.category}:${context.spec.construction}:${arg.arg}`,
          name: arg.arg,
          optional: !arg.required,
          positional: Boolean(arg.positional),
          documentation: {
            key: constructionParameterDocumentationKeyFor(
              context.spec.category,
              context.spec.construction,
              arg.arg,
              undefined
            )
          }
        };
  });
  return {
    identity: `construction:${context.spec.category}:${context.spec.construction}`,
    name: authoring.callee.name,
    callingStyle: "construction",
    parameters,
    documentation: { key: `signatureHelp.construction.${context.spec.category}.${constructionName}` }
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
    documentation: { key: "signatureHelp.module" },
    parameters: definition.parameters.map((parameter) => ({
      identity: `module:${definition.statementId}:${parameter.parameterIndex}`,
      name: parameter.name,
      type: moduleTypeName(parameter.type),
      optional: parameter.optional,
      ...(parameter.defaultValue !== null ? { defaultValue: parameter.defaultValue } : {}),
      ...(allowedValuesFor(scalarModuleType(parameter.type))
        ? { allowedValues: allowedValuesFor(scalarModuleType(parameter.type)) }
        : {}),
      documentation: { key: "signatureHelp.module.parameter" }
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