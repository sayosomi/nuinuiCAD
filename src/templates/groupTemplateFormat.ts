import type { NumericValue } from "../types/geometry";
import type { GroupTemplate, GroupTemplateInput, GroupTemplateLibrary } from "./groupTemplate";

export const GROUP_TEMPLATE_SCHEMA_VERSION = 1;
export const GROUP_TEMPLATE_APP_ID = "nuinuiCAD";
export const GROUP_TEMPLATE_KIND = "groupTemplate";
export const GROUP_TEMPLATE_EXTENSION = "nuinui-template.json";

export type GroupTemplateFile = {
  app: typeof GROUP_TEMPLATE_APP_ID;
  kind: typeof GROUP_TEMPLATE_KIND;
  schemaVersion: typeof GROUP_TEMPLATE_SCHEMA_VERSION;
  savedAt: string;
  template: GroupTemplate;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const defaultGroupTemplateLibrary = (): GroupTemplateLibrary => ({
  version: 1,
  templates: []
});

export const groupTemplateFileFromTemplate = (
  template: GroupTemplate,
  savedAt = new Date().toISOString()
): GroupTemplateFile => ({
  app: GROUP_TEMPLATE_APP_ID,
  kind: GROUP_TEMPLATE_KIND,
  schemaVersion: GROUP_TEMPLATE_SCHEMA_VERSION,
  savedAt,
  template
});

export const serializeGroupTemplateFile = (template: GroupTemplate) =>
  `${JSON.stringify(groupTemplateFileFromTemplate(template), null, 2)}\n`;

const parseNumericValue = (value: unknown): NumericValue =>
  typeof value === "number" ||
  (isRecord(value) && value.kind === "expression" && typeof value.expression === "string")
    ? value as NumericValue
    : 0;

const parseTemplateInput = (value: unknown): GroupTemplateInput | null => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") {
    return null;
  }
  if (value.kind === "numeric" && typeof value.variableElementId === "string") {
    return {
      id: value.id,
      kind: "numeric",
      label: value.label,
      variableElementId: value.variableElementId,
      defaultValue: parseNumericValue(value.defaultValue)
    };
  }
  if (
    (value.kind === "point" || value.kind === "line") &&
    typeof value.sourceElementId === "string"
  ) {
    return {
      id: value.id,
      kind: value.kind,
      label: value.label,
      sourceElementId: value.sourceElementId
    };
  }
  return null;
};

const parseTemplate = (value: unknown): GroupTemplate | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.rootGroupId !== "string" ||
    !Array.isArray(value.elements)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    rootGroupId: value.rootGroupId,
    elements: value.elements as GroupTemplate["elements"],
    inputs: Array.isArray(value.inputs)
      ? value.inputs.map(parseTemplateInput).filter((input): input is GroupTemplateInput => Boolean(input))
      : [],
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
  };
};

export const normalizeGroupTemplateLibrary = (value: unknown): GroupTemplateLibrary => {
  if (!isRecord(value) || !Array.isArray(value.templates)) return defaultGroupTemplateLibrary();
  return {
    version: 1,
    templates: value.templates
      .map(parseTemplate)
      .filter((template): template is GroupTemplate => Boolean(template))
  };
};

export const parseGroupTemplateFile = (content: string): GroupTemplate => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("テンプレートファイルをJSONとして読み込めません。");
  }
  if (
    !isRecord(parsed) ||
    parsed.app !== GROUP_TEMPLATE_APP_ID ||
    parsed.kind !== GROUP_TEMPLATE_KIND ||
    parsed.schemaVersion !== GROUP_TEMPLATE_SCHEMA_VERSION
  ) {
    throw new Error("nuinuiCADテンプレートではありません。");
  }
  const template = parseTemplate(parsed.template);
  if (!template) throw new Error("テンプレート内容が不正です。");
  return template;
};
