import type { DslNumericTypeOptions } from "./dslNumericTypeOptions";
import { resolveTypedValueStep, typedNumericStepOptions } from "./dslTypedValueStep";
import type { DslValueStepDirection } from "./dslValueStep";
import type { DslModuleParameterType, DslSpan } from "./dslTypes";

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
