export const SOURCE_MODULE_TEMPLATE_DEFINITIONS = [
  { id: "module", label: "Module" },
  { id: "export-module", label: "Export Module" },
  { id: "module-instance", label: "Module Instance" }
] as const;

export type SourceModuleTemplateId =
  (typeof SOURCE_MODULE_TEMPLATE_DEFINITIONS)[number]["id"];

export type SourceModuleTemplatePresentation =
  (typeof SOURCE_MODULE_TEMPLATE_DEFINITIONS)[number];

/** The fixed Module presentation contract used by the native picker. */
export const SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS:
  readonly SourceModuleTemplatePresentation[] = SOURCE_MODULE_TEMPLATE_DEFINITIONS;
