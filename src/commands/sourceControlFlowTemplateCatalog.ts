export const SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS = [
  { id: "group", label: "Group" },
  { id: "if", label: "If" },
  { id: "for-range", label: "For Range" },
  { id: "for-collection", label: "For Collection" },
  { id: "for-range-carry", label: "For Range + Carry" },
  { id: "for-collection-carry", label: "For Collection + Carry" }
] as const;

export type SourceControlFlowTemplateId =
  (typeof SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)[number]["id"];

export type SourceControlFlowTemplatePresentation =
  (typeof SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS)[number];

/** The fixed Control Flow presentation contract used by the native picker. */
export const SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS:
  readonly SourceControlFlowTemplatePresentation[] = SOURCE_CONTROL_FLOW_TEMPLATE_DEFINITIONS;
