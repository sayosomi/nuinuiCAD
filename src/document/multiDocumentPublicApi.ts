import type {
  SourceLexicalDeclaration,
  SourceLexicalExternalNamespaceResolver
} from "../dsl/sourceLexicalNamespaceIndex";
import type {
  DocumentId,
  DocumentQualifiedSemanticIdentity,
  DocumentQualifiedSourceLocation
} from "./multiDocumentPrimitives";
import type { DslDiagnosticPresentation } from "../dsl/dslTypes";

export type FileExportableDeclarationFamily =
  | "module"
  | "modifier"
  | "profile"
  | "layout"
  | "layoutTemplate";

/**
 * Family contributors register both public and private reusable declarations.
 * Keeping private descriptors lets the generic resolver distinguish a private
 * target from a genuinely missing target without learning family syntax.
 */
export type FileExportableDeclarationDescriptor<Metadata = unknown> = {
  identity: DocumentQualifiedSemanticIdentity<string>;
  family: FileExportableDeclarationFamily;
  name: string;
  declaration: DocumentQualifiedSourceLocation;
  exported: boolean;
  metadata?: Metadata;
};

export type FileReExportDescriptor = {
  identity: DocumentQualifiedSemanticIdentity<string>;
  location: DocumentQualifiedSourceLocation;
  importAlias: string;
  exportedName: string;
};

export type MultiDocumentPublicApiEntry<Metadata = unknown> = {
  name: string;
  family: FileExportableDeclarationFamily;
  /** Original declaration identity. Re-export never synthesizes a new identity. */
  identity: DocumentQualifiedSemanticIdentity<string>;
  declaration: DocumentQualifiedSourceLocation;
  metadata?: Metadata;
  /** Empty for a direct export; origin-to-facade re-export occurrences otherwise. */
  reExportPath: readonly DocumentQualifiedSourceLocation[];
};

export type MultiDocumentPublicApiDiagnosticCode =
  | "duplicate-public-export"
  | "invalid-reexport-target"
  | "private-reexport-target"
  | "missing-reexport-target";

export type MultiDocumentPublicApiDiagnostic = {
  code: MultiDocumentPublicApiDiagnosticCode;
  message: string;
  presentation?: DslDiagnosticPresentation;
  location: DocumentQualifiedSourceLocation;
  relatedLocations?: readonly DocumentQualifiedSourceLocation[];
};

export type MultiDocumentPublicApiCatalog<Metadata = unknown> = {
  documentId: DocumentId;
  declarationsByName: ReadonlyMap<string, readonly FileExportableDeclarationDescriptor<Metadata>[]>;
  publicEntriesByName: ReadonlyMap<string, MultiDocumentPublicApiEntry<Metadata>>;
  diagnostics: readonly MultiDocumentPublicApiDiagnostic[];
  valid: boolean;
};

export type MultiDocumentPublicApiLookup<Metadata = unknown> =
  | { kind: "public"; entry: MultiDocumentPublicApiEntry<Metadata> }
  | { kind: "private"; declarations: readonly FileExportableDeclarationDescriptor<Metadata>[] }
  | { kind: "missing" };

export type BuildMultiDocumentPublicApiCatalogInput<Metadata = unknown> = {
  documentId: DocumentId;
  declarations: readonly FileExportableDeclarationDescriptor<Metadata>[];
  reExports?: readonly FileReExportDescriptor[];
  /** Resolved graph edge lookup. A failed/missing/cyclic import returns null. */
  resolveImportCatalog?: (alias: string) => MultiDocumentPublicApiCatalog<Metadata> | null;
};

const addDeclaration = <Metadata>(
  declarationsByName: Map<string, FileExportableDeclarationDescriptor<Metadata>[]>,
  declaration: FileExportableDeclarationDescriptor<Metadata>
) => {
  const sameName = declarationsByName.get(declaration.name);
  if (sameName) sameName.push(declaration);
  else declarationsByName.set(declaration.name, [declaration]);
};

const duplicateDiagnostic = (
  name: string,
  location: DocumentQualifiedSourceLocation,
  previous: MultiDocumentPublicApiEntry<unknown>
): MultiDocumentPublicApiDiagnostic => ({
  code: "duplicate-public-export",
  message: `公開名「${name}」が重複しています。`,
  presentation: { key: "diagnostic.duplicate-public-export" },
  location,
  relatedLocations: [previous.reExportPath.at(-1) ?? previous.declaration]
});

export const resolveMultiDocumentPublicApiMember = <Metadata>(
  catalog: MultiDocumentPublicApiCatalog<Metadata>,
  name: string
): MultiDocumentPublicApiLookup<Metadata> => {
  const entry = catalog.publicEntriesByName.get(name);
  if (entry) return { kind: "public", entry };
  const declarations = catalog.declarationsByName.get(name) ?? [];
  return declarations.length > 0
    ? { kind: "private", declarations }
    : { kind: "missing" };
};

/**
 * Builds one file's public surface after its import targets have been built.
 * Re-export entries retain the original declaration identity/family/metadata
 * and only append the current re-export occurrence to the exposure path.
 */
export const buildMultiDocumentPublicApiCatalog = <Metadata = unknown>(
  input: BuildMultiDocumentPublicApiCatalogInput<Metadata>
): MultiDocumentPublicApiCatalog<Metadata> => {
  const declarationsByName = new Map<string, FileExportableDeclarationDescriptor<Metadata>[]>();
  const publicEntriesByName = new Map<string, MultiDocumentPublicApiEntry<Metadata>>();
  const diagnostics: MultiDocumentPublicApiDiagnostic[] = [];

  for (const declaration of input.declarations) {
    addDeclaration(declarationsByName, declaration);
    if (!declaration.exported) continue;
    const entry: MultiDocumentPublicApiEntry<Metadata> = {
      name: declaration.name,
      family: declaration.family,
      identity: declaration.identity,
      declaration: declaration.declaration,
      ...(declaration.metadata === undefined ? {} : { metadata: declaration.metadata }),
      reExportPath: []
    };
    const previous = publicEntriesByName.get(entry.name);
    if (previous) {
      diagnostics.push(duplicateDiagnostic(entry.name, declaration.declaration, previous));
      continue;
    }
    publicEntriesByName.set(entry.name, entry);
  }

  for (const reExport of input.reExports ?? []) {
    const targetCatalog = input.resolveImportCatalog?.(reExport.importAlias) ?? null;
    if (!targetCatalog || !targetCatalog.valid) {
      diagnostics.push({
        code: "invalid-reexport-target",
        message: `re-export元のimport「${reExport.importAlias}」を安全に解決できません。`,
        presentation: { key: "diagnostic.invalid-reexport-target" },
        location: reExport.location
      });
      continue;
    }
    const target = resolveMultiDocumentPublicApiMember(targetCatalog, reExport.exportedName);
    if (target.kind === "private") {
      diagnostics.push({
        code: "private-reexport-target",
        message: `「${reExport.importAlias}::${reExport.exportedName}」は公開されていないためre-exportできません。`,
        presentation: { key: "diagnostic.private-reexport-target" },
        location: reExport.location,
        relatedLocations: target.declarations.map((declaration) => declaration.declaration)
      });
      continue;
    }
    if (target.kind === "missing") {
      diagnostics.push({
        code: "missing-reexport-target",
        message: `「${reExport.importAlias}::${reExport.exportedName}」に対応する公開宣言がありません。`,
        presentation: { key: "diagnostic.missing-reexport-target" },
        location: reExport.location
      });
      continue;
    }

    const entry: MultiDocumentPublicApiEntry<Metadata> = {
      ...target.entry,
      name: reExport.exportedName,
      reExportPath: [...target.entry.reExportPath, reExport.location]
    };
    const previous = publicEntriesByName.get(entry.name);
    if (previous) {
      diagnostics.push(duplicateDiagnostic(entry.name, reExport.location, previous));
      continue;
    }
    publicEntriesByName.set(entry.name, entry);
  }

  return {
    documentId: input.documentId,
    declarationsByName,
    publicEntriesByName,
    diagnostics,
    valid: diagnostics.length === 0
  };
};

/**
 * Adapter for sourceLexicalNamespaceIndex's external-member hook. The lexical
 * resolver still proves that the import alias is visible at this source
 * position; this adapter exposes only the target file's public catalog member.
 */
export const createPublicApiExternalNamespaceResolver = <Metadata>(
  catalogForImportDeclaration: (
    declaration: SourceLexicalDeclaration
  ) => MultiDocumentPublicApiCatalog<Metadata> | null
): SourceLexicalExternalNamespaceResolver => (
  declaration,
  memberName
) => {
  if (declaration.kind !== "import") return null;
  const catalog = catalogForImportDeclaration(declaration);
  if (!catalog || !catalog.valid) return null;
  const lookup = resolveMultiDocumentPublicApiMember(catalog, memberName);
  return lookup.kind === "public"
    ? { name: memberName, value: lookup.entry }
    : null;
};
