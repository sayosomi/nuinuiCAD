export const SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS = [
  { id: "profile", label: "Profile" },
  { id: "style", label: "Style" },
  { id: "style-profile-override", label: "Style + Profile Override" }
] as const;

export type SourceStyleProfileTemplateId =
  (typeof SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS)[number]["id"];

export type SourceStyleProfileTemplatePresentation =
  (typeof SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS)[number];

/** The fixed Style / Profile presentation contract used by the native picker. */
export const SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS:
  readonly SourceStyleProfileTemplatePresentation[] = SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS;
