import { describe, expect, it } from "vitest";
import {
  documentIdFromHost,
  qualifySemanticIdentity,
  qualifySourceLocation,
  savedSourceFingerprintFromHost,
  sourceIdentityOf,
  type DependencySavedSourceSnapshot
} from "./multiDocumentPrimitives";
import {
  buildMultiDocumentPublicApiCatalog,
  resolveMultiDocumentPublicApiMember,
  type FileExportableDeclarationDescriptor
} from "./multiDocumentPublicApi";

const savedSource = (id: string): DependencySavedSourceSnapshot => ({
  kind: "dependency-saved",
  documentId: documentIdFromHost(id),
  normalizedSource: "nui 4\n",
  savedSourceFingerprint: savedSourceFingerprintFromHost(`sha256:${id}`)
});

const descriptor = (
  source: DependencySavedSourceSnapshot,
  name: string,
  exported: boolean,
  from: number
): FileExportableDeclarationDescriptor<{ docs: string }> => ({
  identity: qualifySemanticIdentity(source.documentId, `statement:${name}`),
  family: "module",
  name,
  declaration: qualifySourceLocation(sourceIdentityOf(source), { from, to: from + name.length }),
  exported,
  metadata: { docs: `${name} docs` }
});

describe("multi-document public API catalog", () => {
  it("exposes only explicit public descriptors while retaining private lookup", () => {
    const source = savedSource("library");
    const pocket = descriptor(source, "Pocket", true, 10);
    const hidden = descriptor(source, "Hidden", false, 30);
    const catalog = buildMultiDocumentPublicApiCatalog({
      documentId: source.documentId,
      declarations: [pocket, hidden]
    });

    expect([...catalog.publicEntriesByName.keys()]).toEqual(["Pocket"]);
    expect(resolveMultiDocumentPublicApiMember(catalog, "Pocket")).toMatchObject({
      kind: "public",
      entry: { identity: pocket.identity, family: "module", metadata: { docs: "Pocket docs" } }
    });
    expect(resolveMultiDocumentPublicApiMember(catalog, "Hidden")).toMatchObject({
      kind: "private",
      declarations: [{ identity: hidden.identity }]
    });
    expect(resolveMultiDocumentPublicApiMember(catalog, "Missing")).toEqual({ kind: "missing" });
  });

  it("flattens re-exports without replacing the original semantic identity", () => {
    const library = savedSource("library");
    const facade = savedSource("facade");
    const pocket = descriptor(library, "Pocket", true, 10);
    const libraryCatalog = buildMultiDocumentPublicApiCatalog({
      documentId: library.documentId,
      declarations: [pocket]
    });
    const reExportLocation = qualifySourceLocation(sourceIdentityOf(facade), { from: 20, to: 43 });
    const facadeCatalog = buildMultiDocumentPublicApiCatalog({
      documentId: facade.documentId,
      declarations: [],
      reExports: [{
        identity: qualifySemanticIdentity(facade.documentId, "statement:reexport:Pocket"),
        location: reExportLocation,
        importAlias: "common",
        exportedName: "Pocket"
      }],
      resolveImportCatalog: (alias) => alias === "common" ? libraryCatalog : null
    });

    expect(facadeCatalog.valid).toBe(true);
    expect(facadeCatalog.publicEntriesByName.get("Pocket")).toEqual({
      name: "Pocket",
      family: "module",
      identity: pocket.identity,
      declaration: pocket.declaration,
      metadata: { docs: "Pocket docs" },
      reExportPath: [reExportLocation]
    });
  });

  it("distinguishes private and missing re-export targets", () => {
    const library = savedSource("library");
    const facade = savedSource("facade");
    const libraryCatalog = buildMultiDocumentPublicApiCatalog({
      documentId: library.documentId,
      declarations: [descriptor(library, "Hidden", false, 10)]
    });
    const location = qualifySourceLocation(sourceIdentityOf(facade), { from: 1, to: 5 });
    const catalog = buildMultiDocumentPublicApiCatalog({
      documentId: facade.documentId,
      declarations: [],
      reExports: [
        {
          identity: qualifySemanticIdentity(facade.documentId, "statement:hidden"),
          location,
          importAlias: "common",
          exportedName: "Hidden"
        },
        {
          identity: qualifySemanticIdentity(facade.documentId, "statement:missing"),
          location,
          importAlias: "common",
          exportedName: "Missing"
        }
      ],
      resolveImportCatalog: () => libraryCatalog
    });

    expect(catalog.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "private-reexport-target",
      "missing-reexport-target"
    ]);
    expect(catalog.valid).toBe(false);
  });

  it("rejects duplicate direct/re-export public names", () => {
    const library = savedSource("library");
    const facade = savedSource("facade");
    const libraryCatalog = buildMultiDocumentPublicApiCatalog({
      documentId: library.documentId,
      declarations: [descriptor(library, "Pocket", true, 10)]
    });
    const localPocket = descriptor(facade, "Pocket", true, 30);
    const location = qualifySourceLocation(sourceIdentityOf(facade), { from: 50, to: 60 });
    const catalog = buildMultiDocumentPublicApiCatalog({
      documentId: facade.documentId,
      declarations: [localPocket],
      reExports: [{
        identity: qualifySemanticIdentity(facade.documentId, "statement:reexport"),
        location,
        importAlias: "common",
        exportedName: "Pocket"
      }],
      resolveImportCatalog: () => libraryCatalog
    });

    expect(catalog.publicEntriesByName.get("Pocket")?.identity).toEqual(localPocket.identity);
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({ code: "duplicate-public-export", location })
    ]);
    expect(catalog.valid).toBe(false);
  });
});
