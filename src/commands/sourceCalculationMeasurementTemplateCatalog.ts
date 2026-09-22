import {
  getBuiltinFunctionDefinition,
  type BuiltinFunctionDefinition,
  type BuiltinFunctionName,
  type BuiltinFunctionSignature
} from "@nuinuicad/nui-language";

/**
 * Presentation is intentionally narrower than the Language Core builtin
 * registry. Adding a builtin to the registry does not add it to this catalog.
 */
export const SOURCE_CALCULATION_MEASUREMENT_TEMPLATE_DEFINITIONS = [
  { builtinName: "distance", label: "Distance between points" },
  { builtinName: "angle", label: "Angle between points" },
  { builtinName: "lineDistance", label: "Point-to-line distance" },
  { builtinName: "lineAngle", label: "Angle between lines" },
  { builtinName: "spreadAngle", label: "Spread angle" }
] as const satisfies readonly { builtinName: BuiltinFunctionName; label: string }[];

export type SourceCalculationMeasurementTemplateId =
  (typeof SOURCE_CALCULATION_MEASUREMENT_TEMPLATE_DEFINITIONS)[number]["builtinName"];

export type SourceCalculationMeasurementTemplatePresentation =
  (typeof SOURCE_CALCULATION_MEASUREMENT_TEMPLATE_DEFINITIONS)[number];

export type SourceCalculationMeasurementTemplatePlan = {
  readonly id: SourceCalculationMeasurementTemplateId;
  readonly label: string;
  readonly builtinName: BuiltinFunctionName;
  /** The resolved definition projected from Language Core. */
  readonly definition: BuiltinFunctionDefinition;
  /** The one unambiguous signature used by the materializer. */
  readonly signature: BuiltinFunctionSignature;
};

const usableSignatureFor = (
  definition: BuiltinFunctionDefinition
): BuiltinFunctionSignature | null => {
  if (definition.signatures.length !== 1) return null;
  const signature = definition.signatures[0];
  if (!signature || signature.returnType.kind !== "number") return null;

  if (signature.callingStyle === "named") {
    const parameterNames = signature.parameters.map(({ name }) => name);
    if (
      parameterNames.some((name) => name.trim() === "") ||
      new Set(parameterNames).size !== parameterNames.length
    ) return null;
  }

  return signature;
};

/**
 * Resolves one allowlisted presentation entry against the current Language
 * Core registry. Missing, ambiguous, or non-numeric definitions are omitted
 * rather than repaired with template-owned semantics.
 */
export const sourceCalculationMeasurementTemplatePlanFor = (
  presentation: SourceCalculationMeasurementTemplatePresentation
): SourceCalculationMeasurementTemplatePlan | null => {
  const definition = getBuiltinFunctionDefinition(presentation.builtinName);
  if (!definition) return null;
  const signature = usableSignatureFor(definition);
  if (!signature) return null;

  return {
    id: presentation.builtinName,
    label: presentation.label,
    builtinName: presentation.builtinName,
    definition,
    signature
  };
};

/** Resolves the explicit five-entry presentation allowlist in its authored order. */
export const sourceCalculationMeasurementTemplatePlans = (): readonly SourceCalculationMeasurementTemplatePlan[] =>
  SOURCE_CALCULATION_MEASUREMENT_TEMPLATE_DEFINITIONS.flatMap((presentation) => {
    const plan = sourceCalculationMeasurementTemplatePlanFor(presentation);
    return plan ? [plan] : [];
  });
