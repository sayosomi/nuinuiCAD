import { DSL_INDENT } from "@nuinuicad/nui-language";
import {
  SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS,
  type SourceControlFlowTemplateId
} from "./sourceControlFlowTemplateCatalog";

export type SourceControlFlowTemplateFieldId =
  | "group-name"
  | "condition"
  | "binder"
  | "range-min"
  | "range-max"
  | "range-step"
  | "collection"
  | "carry-name"
  | "carry-type"
  | "carry-initializer"
  | "body"
  | "next-expression";

export type SourceControlFlowTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; field: SourceControlFlowTemplateFieldId };

export type SourceControlFlowTemplateMaterialization = {
  templateId: SourceControlFlowTemplateId;
  parts: readonly SourceControlFlowTemplatePart[];
};

const appendText = (parts: SourceControlFlowTemplatePart[], text: string): void => {
  if (text === "") return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  parts.push({ kind: "text", text });
};

const appendHole = (
  parts: SourceControlFlowTemplatePart[],
  field: SourceControlFlowTemplateFieldId
): void => {
  parts.push({ kind: "hole", field });
};

const appendBlock = (
  parts: SourceControlFlowTemplatePart[],
  bodyField: SourceControlFlowTemplateFieldId,
  next?: { carryField: SourceControlFlowTemplateFieldId; expressionField: SourceControlFlowTemplateFieldId }
): void => {
  appendText(parts, " {\n");
  appendText(parts, DSL_INDENT);
  appendHole(parts, bodyField);
  if (next) {
    appendText(parts, `\n${DSL_INDENT}next `);
    appendHole(parts, next.carryField);
    appendText(parts, " = ");
    appendHole(parts, next.expressionField);
  }
  appendText(parts, "\n}");
};

/** Materializes one fixed Control Flow structure without inventing DSL values. */
export const materializeSourceControlFlowTemplate = (
  templateId: SourceControlFlowTemplateId
): SourceControlFlowTemplateMaterialization | null => {
  if (!SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS.some(({ id }) => id === templateId)) return null;

  const parts: SourceControlFlowTemplatePart[] = [];
  switch (templateId) {
    case "group":
      appendText(parts, "group ");
      appendHole(parts, "group-name");
      appendBlock(parts, "body");
      break;
    case "if":
      appendText(parts, "if (");
      appendHole(parts, "condition");
      appendText(parts, ")");
      appendBlock(parts, "body");
      break;
    case "for-range":
      appendText(parts, "for ");
      appendHole(parts, "binder");
      appendText(parts, " in range(min: ");
      appendHole(parts, "range-min");
      appendText(parts, ", max: ");
      appendHole(parts, "range-max");
      appendText(parts, ", step: ");
      appendHole(parts, "range-step");
      appendText(parts, ")");
      appendBlock(parts, "body");
      break;
    case "for-collection":
      appendText(parts, "for ");
      appendHole(parts, "binder");
      appendText(parts, " in @");
      appendHole(parts, "collection");
      appendBlock(parts, "body");
      break;
    case "for-range-carry":
      appendText(parts, "for ");
      appendHole(parts, "binder");
      appendText(parts, " in range(min: ");
      appendHole(parts, "range-min");
      appendText(parts, ", max: ");
      appendHole(parts, "range-max");
      appendText(parts, ", step: ");
      appendHole(parts, "range-step");
      appendText(parts, `)\n${DSL_INDENT}carry `);
      appendHole(parts, "carry-name");
      appendText(parts, ": ");
      appendHole(parts, "carry-type");
      appendText(parts, " = ");
      appendHole(parts, "carry-initializer");
      appendBlock(parts, "body", { carryField: "carry-name", expressionField: "next-expression" });
      break;
    case "for-collection-carry":
      appendText(parts, "for ");
      appendHole(parts, "binder");
      appendText(parts, " in @");
      appendHole(parts, "collection");
      appendText(parts, `\n${DSL_INDENT}carry `);
      appendHole(parts, "carry-name");
      appendText(parts, ": ");
      appendHole(parts, "carry-type");
      appendText(parts, " = ");
      appendHole(parts, "carry-initializer");
      appendBlock(parts, "body", { carryField: "carry-name", expressionField: "next-expression" });
      break;
  }

  return { templateId, parts };
};
