import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  createNuiLanguageSession,
  parseDsl,
  type DslDocumentData
} from "@nuinuicad/nui-language";
import {
  AutomationDocument,
  compileFreshCanonicalText
} from "@nuinuicad/nui-language/document";
import {
  buildMultiDocumentPublicApiCatalog,
  currentCompiledSemanticSnapshotFor,
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

  it("keeps exact-current compiled semantics behind the workspace entry", () => {
    const source = "nui 1\nconst width: number = @missing\npoint A = coordinate(x: 0, y: 0)\n";
    const session = createNuiLanguageSession(source);
    const snapshot = currentCompiledSemanticSnapshotFor(session);

    expect(snapshot).toMatchObject({
      sourceText: source,
      sourceRevision: session.getSourceRevision(),
      compiled: expect.any(Object)
    });
    expect(snapshot?.compiled.spans.sourceMap).toMatchObject({
      source,
      sourceRevision: session.getSourceRevision()
    });

    const fatalSource = "nui 1\r\npoint A = coordinate(";
    const normalizedFatalSource = fatalSource.replace(/\r\n/g, "\n");
    session.replaceSource(fatalSource);

    expect(session.runtimeEvaluationSnapshot()).toBeNull();

    const fatalSnapshot = currentCompiledSemanticSnapshotFor(session);
    expect(fatalSnapshot).toBeDefined();
    expect(fatalSnapshot?.sourceText).toBe(normalizedFatalSource);
    expect(fatalSnapshot?.sourceRevision).toBe(session.getSourceRevision());
    expect(fatalSnapshot?.compiled.spans.sourceMap.source).toBe(normalizedFatalSource);
    expect(fatalSnapshot?.compiled.spans.sourceMap.sourceRevision).toBe(session.getSourceRevision());
  });
});
