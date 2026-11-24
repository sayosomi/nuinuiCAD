import { getBuiltinConstantDefinition, parseDslSourceReference } from "@nuinuicad/nui-language";
import type { CadElement, ElementId } from "../types/geometry";

export type CommandLineNameValidation =
  | { kind: "valid" }
  | { kind: "invalid"; name: string }
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
  const parsed = parseDslSourceReference(normalizedName);
  if (parsed.kind !== "valid" || parsed.reference.path.absolute ||
    parsed.reference.path.segments.length !== 1 || parsed.reference.property !== null ||
    parsed.reference.occurrenceIndex !== null || getBuiltinConstantDefinition(normalizedName)) {
    return { kind: "invalid", name: normalizedName };
  }
  const conflictingElement = elements.find((element) =>
    element.parentGroupId === parentGroupId && element.name.trim() === normalizedName
  );
  return conflictingElement
    ? { kind: "duplicate", name: normalizedName, conflictingElement }
    : { kind: "valid" };
};

export const commandLineNameErrorMessage = (validation: CommandLineNameValidation) => {
  if (validation.kind === "invalid") return `「${validation.name}」は要素名に使えません。`;
  if (validation.kind === "duplicate") return `このスコープには「${validation.name}」という名前の要素が既にあります。別の名前を入力してください。`;
  return null;
};
