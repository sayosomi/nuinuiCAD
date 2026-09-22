export const SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS = [
  { id: "choice-declaration", label: "Choice Declaration" },
  { id: "collection-declaration", label: "Collection Declaration" },
  { id: "value-if", label: "Value If" },
  { id: "choice-match", label: "Choice Match" },
  { id: "optional-match", label: "Optional Match" },
  { id: "collection-value-for", label: "Collection Value For" }
] as const;

export type SourceValueMatchTemplateId =
  (typeof SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS)[number]["id"];

export type SourceValueMatchTemplatePresentation =
  (typeof SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS)[number];

/** The fixed Value / Match presentation contract used by the native picker. */
export const SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS:
  readonly SourceValueMatchTemplatePresentation[] = SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS;
