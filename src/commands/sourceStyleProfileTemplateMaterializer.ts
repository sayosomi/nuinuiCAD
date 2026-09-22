import { DSL_INDENT } from "@nuinuicad/nui-language";
import {
  SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS,
  type SourceStyleProfileTemplateId
} from "./sourceStyleProfileTemplateCatalog";

export type SourceStyleProfileTemplateFieldId =
  | "name"
  | "body"
  | "common-body"
  | "profile"
  | "profile-body";

export type SourceStyleProfileTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; field: SourceStyleProfileTemplateFieldId };

export type SourceStyleProfileTemplateMaterialization = {
  templateId: SourceStyleProfileTemplateId;
  parts: readonly SourceStyleProfileTemplatePart[];
};

const appendText = (parts: SourceStyleProfileTemplatePart[], text: string): void => {
  if (text === "") return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  parts.push({ kind: "text", text });
};

const appendHole = (
  parts: SourceStyleProfileTemplatePart[],
  field: SourceStyleProfileTemplateFieldId
): void => {
  parts.push({ kind: "hole", field });
};

const profileParts = (): SourceStyleProfileTemplatePart[] => {
  const parts: SourceStyleProfileTemplatePart[] = [];
  appendText(parts, "profile ");
  appendHole(parts, "name");
  return parts;
};

const styleParts = (): SourceStyleProfileTemplatePart[] => {
  const parts: SourceStyleProfileTemplatePart[] = [];
  appendText(parts, "style ");
  appendHole(parts, "name");
  appendText(parts, " {\n");
  appendText(parts, DSL_INDENT);
  appendHole(parts, "body");
  appendText(parts, "\n}");
  return parts;
};

const styleProfileOverrideParts = (): SourceStyleProfileTemplatePart[] => {
  const parts: SourceStyleProfileTemplatePart[] = [];
  appendText(parts, "style ");
  appendHole(parts, "name");
  appendText(parts, " {\n");
  appendText(parts, DSL_INDENT);
  appendHole(parts, "common-body");
  appendText(parts, `\n${DSL_INDENT}for @`);
  appendHole(parts, "profile");
  appendText(parts, " {\n");
  appendText(parts, DSL_INDENT.repeat(2));
  appendHole(parts, "profile-body");
  appendText(parts, `\n${DSL_INDENT}}\n}`);
  return parts;
};

/** Projects a fixed Style / Profile template without inventing properties or profile identities. */
export const materializeSourceStyleProfileTemplate = (
  templateId: SourceStyleProfileTemplateId
): SourceStyleProfileTemplateMaterialization | null => {
  if (!SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS.some(({ id }) => id === templateId)) return null;

  const parts = templateId === "profile"
    ? profileParts()
    : templateId === "style"
      ? styleParts()
      : styleProfileOverrideParts();
  return { templateId, parts };
};
