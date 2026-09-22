import type {
  BuiltinFunctionSignature
} from "@nuinuicad/nui-language";
import type { SourceCalculationMeasurementTemplatePlan } from "./sourceCalculationMeasurementTemplateCatalog";

export type SourceCalculationMeasurementTemplateHole =
  | { role: "name" }
  | { role: "argument"; index: number; parameterName?: string };

export type SourceCalculationMeasurementTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; hole: SourceCalculationMeasurementTemplateHole };

export type SourceCalculationMeasurementTemplateMaterialization = {
  plan: SourceCalculationMeasurementTemplatePlan;
  parts: readonly SourceCalculationMeasurementTemplatePart[];
};

const appendText = (parts: SourceCalculationMeasurementTemplatePart[], text: string): void => {
  if (text === "") return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  parts.push({ kind: "text", text });
};

const isContractedSignature = (
  plan: SourceCalculationMeasurementTemplatePlan
): plan is SourceCalculationMeasurementTemplatePlan & { signature: BuiltinFunctionSignature } => {
  if (plan.definition.name !== plan.builtinName) return false;
  if (plan.definition.signatures.length !== 1) return false;
  if (plan.definition.signatures[0] !== plan.signature) return false;
  if (plan.signature.returnType.kind !== "number") return false;
  if (plan.signature.callingStyle !== "named") return true;

  const parameterNames = plan.signature.parameters.map(({ name }) => name);
  return parameterNames.every((name) => name.trim() !== "") &&
    new Set(parameterNames).size === parameterNames.length;
};

const appendArgumentParts = (
  parts: SourceCalculationMeasurementTemplatePart[],
  signature: BuiltinFunctionSignature
): void => {
  if (signature.callingStyle === "named") {
    signature.parameters.forEach((parameter, index) => {
      if (index > 0) appendText(parts, ", ");
      appendText(parts, `${parameter.name}: `);
      parts.push({
        kind: "hole",
        hole: { role: "argument", index, parameterName: parameter.name }
      });
    });
    return;
  }

  signature.parameters.forEach((_, index) => {
    if (index > 0) appendText(parts, ", ");
    parts.push({ kind: "hole", hole: { role: "argument", index } });
  });
};

/** Materializes one registry-backed calculation/measurement declaration. */
export const materializeSourceCalculationMeasurementTemplate = (
  plan: SourceCalculationMeasurementTemplatePlan
): SourceCalculationMeasurementTemplateMaterialization | null => {
  if (!isContractedSignature(plan)) return null;

  const parts: SourceCalculationMeasurementTemplatePart[] = [
    { kind: "text", text: "const " },
    { kind: "hole", hole: { role: "name" } },
    { kind: "text", text: `: ${plan.signature.returnType.kind} = ${plan.definition.name}(` }
  ];
  appendArgumentParts(parts, plan.signature);
  appendText(parts, ")");

  return { plan, parts };
};
