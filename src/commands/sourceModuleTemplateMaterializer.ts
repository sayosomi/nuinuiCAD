import {
  DSL_INDENT,
  formatDslName,
  type SourceModuleTemplateCandidate
} from "@nuinuicad/nui-language";
import {
  SOURCE_MODULE_TEMPLATE_DEFINITIONS,
  type SourceModuleTemplateId
} from "./sourceModuleTemplateCatalog";

export type SourceModuleTemplateFieldId =
  | "name"
  | "parameters"
  | "body"
  | "instance-name"
  | "argument";

export type SourceModuleTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; field: SourceModuleTemplateFieldId; parameterName?: string };

export type SourceModuleTemplateMaterialization = {
  templateId: SourceModuleTemplateId;
  parts: readonly SourceModuleTemplatePart[];
  candidate?: SourceModuleTemplateCandidate;
};

const appendText = (parts: SourceModuleTemplatePart[], text: string): void => {
  if (text === "") return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  parts.push({ kind: "text", text });
};

const appendHole = (
  parts: SourceModuleTemplatePart[],
  field: SourceModuleTemplateFieldId,
  parameterName?: string
): void => {
  parts.push({
    kind: "hole",
    field,
    ...(parameterName === undefined ? {} : { parameterName })
  });
};

const moduleDefinitionPartsFor = (
  templateId: "module" | "export-module"
): SourceModuleTemplatePart[] => {
  const parts: SourceModuleTemplatePart[] = [];
  appendText(parts, templateId === "export-module" ? "export module " : "module ");
  appendHole(parts, "name");
  appendText(parts, "(\n");
  appendText(parts, DSL_INDENT);
  appendHole(parts, "parameters");
  appendText(parts, "\n) {\n");
  appendText(parts, DSL_INDENT);
  appendHole(parts, "body");
  appendText(parts, "\n}");
  return parts;
};

const moduleInstancePartsFor = (
  candidate: SourceModuleTemplateCandidate
): SourceModuleTemplatePart[] => {
  const parts: SourceModuleTemplatePart[] = [];
  appendText(parts, "instance ");
  appendHole(parts, "instance-name");
  appendText(parts, ` = ${candidate.sourceCallee}`);
  const requiredParameters = candidate.parameters.filter((parameter) => parameter.required);
  if (requiredParameters.length === 0) {
    appendText(parts, "()");
    return parts;
  }

  appendText(parts, "(\n");
  requiredParameters.forEach((parameter, parameterIndex) => {
    appendText(parts, DSL_INDENT);
    appendText(parts, `${formatDslName(parameter.name)}: `);
    appendHole(parts, "argument", parameter.name);
    appendText(parts, parameterIndex === requiredParameters.length - 1 ? "\n" : ",\n");
  });
  appendText(parts, ")");
  return parts;
};

/** Projects a fixed Module template from canonical semantic candidate data. */
export const materializeSourceModuleTemplate = (
  templateId: SourceModuleTemplateId,
  candidate?: SourceModuleTemplateCandidate
): SourceModuleTemplateMaterialization | null => {
  if (!SOURCE_MODULE_TEMPLATE_DEFINITIONS.some(({ id }) => id === templateId)) return null;
  if (templateId === "module-instance" && !candidate) return null;

  return {
    templateId,
    parts: templateId === "module-instance"
      ? moduleInstancePartsFor(candidate!)
      : moduleDefinitionPartsFor(templateId),
    ...(candidate ? { candidate } : {})
  };
};
