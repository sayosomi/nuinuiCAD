import { describe, expect, it } from "vitest";
import {
  SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS,
  SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS
} from "./sourceStyleProfileTemplateCatalog";

describe("Style / Profile Source Template catalog", () => {
  it("exposes exactly the fixed rows in order", () => {
    expect(SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS).toEqual([
      { id: "profile", label: "Profile" },
      { id: "style", label: "Style" },
      { id: "style-profile-override", label: "Style + Profile Override" }
    ]);
    expect(SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS).toBe(SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS);
  });
});
