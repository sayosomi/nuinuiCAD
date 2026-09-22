import { describe, expect, it } from "vitest";
import {
  SOURCE_MODULE_TEMPLATE_DEFINITIONS,
  SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS
} from "./sourceModuleTemplateCatalog";

describe("Module Source Template catalog", () => {
  it("exposes exactly the fixed Module rows in order", () => {
    expect(SOURCE_MODULE_TEMPLATE_DEFINITIONS).toEqual([
      { id: "module", label: "Module" },
      { id: "export-module", label: "Export Module" },
      { id: "module-instance", label: "Module Instance" }
    ]);
    expect(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS).toBe(SOURCE_MODULE_TEMPLATE_DEFINITIONS);
  });
});
