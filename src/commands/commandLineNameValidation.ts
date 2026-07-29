import type { CadElement, ElementId } from "../types/geometry";

export type CommandLineNameValidation =
  | { kind: "valid" }
  | { kind: "duplicate"; name: string; conflictingElement: CadElement };

/**
 * Creation names obey the DSL's lexical namespace rule: only sibling
 * elements conflict.  Keep this independent from UI state so every creation
 * entry point rejects the same unsafe name.
 */
export const validateCommandLineElementName = ({
  name,
  elements,
  parentGroupId
}: {
  name: string;
  elements: readonly CadElement[];
  parentGroupId?: ElementId;
}): CommandLineNameValidation => {
  const normalizedName = name.trim();
  if (!normalizedName) return { kind: "valid" };
  const conflictingElement = elements.find((element) =>
    element.parentGroupId === parentGroupId && element.name.trim() === normalizedName
  );
  return conflictingElement
    ? { kind: "duplicate", name: normalizedName, conflictingElement }
    : { kind: "valid" };
};

export const commandLineDuplicateNameMessage = (validation: CommandLineNameValidation) =>
  validation.kind === "duplicate"
    ? `このスコープには「${validation.name}」という名前の要素が既にあります。別の名前を入力してください。`
    : null;
