import type { DslNumericTypeOptions } from "@nuinuicad/nui-language";
import { resolveTypedValueStep, typedNumericStepOptions } from "@nuinuicad/nui-language";
import type { DslValueStepDirection } from "@nuinuicad/nui-language";
import type { DslModuleParameterType, DslSpan } from "@nuinuicad/nui-language";

export type ModulePreviewValueStepResult = {
  expression: string;
  selection: DslSpan;
};

/** Resolves one transient Module Preview Value edit through the shared typed step owner. */
export const resolveModulePreviewValueStep = (
  value: string,
  declaredType: DslModuleParameterType | null,
  numericTypeOptions: DslNumericTypeOptions | undefined,
  selection: { start: number; end: number },
  direction: DslValueStepDirection
): ModulePreviewValueStepResult | null => {
  if (
    !declaredType ||
    (declaredType.kind !== "number" && declaredType.kind !== "boolean" && declaredType.kind !== "choice")
  ) return null;

  const edit = resolveTypedValueStep(
    value,
    declaredType,
    { from: 0, to: value.length },
    selection,
    direction,
    declaredType.kind === "number" ? typedNumericStepOptions(numericTypeOptions) : undefined
  );
  if (!edit) return null;

  return {
    expression: `${value.slice(0, edit.from)}${edit.insert}${value.slice(edit.to)}`,
    selection: edit.selection
  };
};
