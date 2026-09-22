import { DSL_INDENT } from "@nuinuicad/nui-language";
import {
  SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS,
  type SourceValueMatchTemplateId
} from "./sourceValueMatchTemplateCatalog";

export type SourceValueMatchTemplateFieldId =
  | "name"
  | "options"
  | "value"
  | "element-type"
  | "members"
  | "type"
  | "condition"
  | "then-value"
  | "else-value"
  | "choice-value"
  | "arms"
  | "optional-value"
  | "none-value"
  | "binder"
  | "some-value"
  | "collection";

export type SourceValueMatchTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; field: SourceValueMatchTemplateFieldId };

export type SourceValueMatchTemplateMaterialization = {
  templateId: SourceValueMatchTemplateId;
  parts: readonly SourceValueMatchTemplatePart[];
};

const appendText = (parts: SourceValueMatchTemplatePart[], text: string): void => {
  if (text === "") return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  parts.push({ kind: "text", text });
};

const appendHole = (
  parts: SourceValueMatchTemplatePart[],
  field: SourceValueMatchTemplateFieldId
): void => {
  parts.push({ kind: "hole", field });
};

const appendBlock = (
  parts: SourceValueMatchTemplatePart[],
  bodyField: SourceValueMatchTemplateFieldId
): void => {
  appendText(parts, " {\n");
  appendText(parts, DSL_INDENT);
  appendHole(parts, bodyField);
  appendText(parts, "\n}");
};

/** Materializes one fixed Value / Match structure without semantic defaults. */
export const materializeSourceValueMatchTemplate = (
  templateId: SourceValueMatchTemplateId
): SourceValueMatchTemplateMaterialization | null => {
  if (!SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS.some(({ id }) => id === templateId)) return null;

  const parts: SourceValueMatchTemplatePart[] = [];
  switch (templateId) {
    case "choice-declaration":
      appendText(parts, "const ");
      appendHole(parts, "name");
      appendText(parts, ": choice(");
      appendHole(parts, "options");
      appendText(parts, ") = ");
      appendHole(parts, "value");
      break;
    case "collection-declaration":
      appendText(parts, "const ");
      appendHole(parts, "name");
      appendText(parts, ": ");
      appendHole(parts, "element-type");
      appendText(parts, "[] = [");
      appendHole(parts, "members");
      appendText(parts, "]");
      break;
    case "value-if":
      appendText(parts, "const ");
      appendHole(parts, "name");
      appendText(parts, ": ");
      appendHole(parts, "type");
      appendText(parts, " = if (");
      appendHole(parts, "condition");
      appendText(parts, ") {");
      appendText(parts, " ");
      appendHole(parts, "then-value");
      appendText(parts, " } else {");
      appendText(parts, " ");
      appendHole(parts, "else-value");
      appendText(parts, " }");
      break;
    case "choice-match":
      appendText(parts, "const ");
      appendHole(parts, "name");
      appendText(parts, ": ");
      appendHole(parts, "type");
      appendText(parts, " = match @");
      appendHole(parts, "choice-value");
      appendBlock(parts, "arms");
      break;
    case "optional-match":
      appendText(parts, "const ");
      appendHole(parts, "name");
      appendText(parts, ": ");
      appendHole(parts, "type");
      appendText(parts, " = match @");
      appendHole(parts, "optional-value");
      appendText(parts, " {\n");
      appendText(parts, DSL_INDENT);
      appendText(parts, "none => ");
      appendHole(parts, "none-value");
      appendText(parts, " some ");
      appendHole(parts, "binder");
      appendText(parts, " => ");
      appendHole(parts, "some-value");
      appendText(parts, "\n}");
      break;
    case "collection-value-for":
      appendText(parts, "const ");
      appendHole(parts, "name");
      appendText(parts, ": ");
      appendHole(parts, "element-type");
      appendText(parts, "[] =\nfor ");
      appendHole(parts, "binder");
      appendText(parts, " in @");
      appendHole(parts, "collection");
      appendBlock(parts, "value");
      break;
  }

  return { templateId, parts };
};
