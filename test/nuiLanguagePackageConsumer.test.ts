import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDsl,
  type DslDocumentData
} from "@nuinuicad/nui-language";
import {
  AutomationDocument,
  compileFreshCanonicalText
} from "@nuinuicad/nui-language/document";
import {
  buildMultiDocumentPublicApiCatalog,
  documentIdFromHost
} from "@nuinuicad/nui-language/workspace";

describe("nui-language workspace package surfaces", () => {
  it("consumes the root, document, and workspace entries", () => {
    const source = "nui 1\n";
    const parsed = parseDsl(source);
    const compiled = compileDslDocument(source);
    const fresh = compileFreshCanonicalText(source);
    const automation = AutomationDocument.fromSource(source);
    const documentId = documentIdFromHost("file:///fixture.nui");
    const catalog = buildMultiDocumentPublicApiCatalog({
      documentId,
      declarations: []
    });

    const documentData: DslDocumentData | null = compiled.document;
    expect(parsed.diagnostics).toEqual([]);
    expect(compiled.majorVersion).toBe(1);
    expect(documentData).not.toBeNull();
    expect(fresh.status).toBe("valid");
    expect(automation.getSource()).toBe(source);
    expect(catalog.valid).toBe(true);
    expect(catalog.documentId).toBe(documentId);
  });
});
