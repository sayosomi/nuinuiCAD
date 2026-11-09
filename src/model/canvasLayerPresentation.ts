import type {
  CompiledDslDocument,
  DslDocumentData,
  DslStatement,
  ModuleMaterialization,
  SourceLexicalNamespaceIndex
} from "@nuinuicad/nui-language";
import { DEFAULT_SOURCE_LAYER_ID } from "@nuinuicad/nui-language";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import { isContainerElement } from "@nuinuicad/nui-language";
import { runtimeOnlyElementTypes } from "../types/geometry";

export type CanvasLayerRow = {
  id: string;
  identity: string;
  documentId: string;
  name: string;
  label: string;
  ownerPath: readonly string[];
  isDefault: boolean;
};

export type CanvasLayerMembership = {
  layerIdentity: string;
  layerName: string;
};

/** Serializable compiler projection for one source document in a Module graph. */
export type CanvasLayerSourceDocument = {
  documentId: string;
  declarations: readonly Pick<CanvasLayerRow, "identity" | "name" | "ownerPath">[];
  membershipsBySourceStatementId: readonly (readonly [string, CanvasLayerMembership])[];
  membershipsByElementId: readonly (readonly [ElementId, CanvasLayerMembership])[];
};

export type CanvasLayerPresentation = {
  layers: readonly CanvasLayerRow[];
  hiddenLayerIds: ReadonlySet<string>;
  layerIdByElementId: ReadonlyMap<ElementId, string>;
  /** Module body drawables whose document-qualified source membership is unavailable. */
  unmappedModuleDrawableIds: ReadonlySet<ElementId>;
};

export type CanvasLayerMaterialization = Pick<ModuleMaterialization, "rootDocumentId" | "originByRuntimeElementId">;

const layerIdFor = (documentId: string, identity: string): string =>
  identity === DEFAULT_SOURCE_LAYER_ID
    ? DEFAULT_SOURCE_LAYER_ID
    : `source-layer:${JSON.stringify([documentId, identity])}`;

const ownerPathFor = (
  declarationScopeId: string,
  namespace: SourceLexicalNamespaceIndex,
  statements: readonly DslStatement[]
): string[] => {
  const segments: string[] = [];
  let scopeId: string | null = declarationScopeId;
  while (scopeId) {
    const scope = namespace.scopeIndex.scopes.get(scopeId);
    if (!scope) break;
    if ((scope.kind === "module" || scope.kind === "group") && scope.openingStatementIndex !== null) {
      const statement = statements[scope.openingStatementIndex];
      const name = statement?.name?.trim();
      segments.unshift(`${scope.kind === "module" ? "Module" : "Group"} ${name || "(unnamed)"}`);
    }
    scopeId = scope.parentId;
  }
  return segments;
};

const membershipProjectionFor = (
  namespace: SourceLexicalNamespaceIndex
): readonly (readonly [string, CanvasLayerMembership])[] =>
  [...namespace.layerMembershipsByStatementIndex.values()].map((membership) => [
    membership.sourceStatementId,
    { layerIdentity: membership.layerIdentity, layerName: membership.layerName }
  ] as const);

/** Build the serializable layer source view from the existing compiler owners. */
export const canvasLayerSourceDocumentFor = ({
  documentId,
  sourceLexicalNamespace,
  statements,
  document
}: {
  documentId: string;
  sourceLexicalNamespace: SourceLexicalNamespaceIndex;
  statements: readonly DslStatement[];
  document?: DslDocumentData | null;
}): CanvasLayerSourceDocument => {
  const namespaceDeclarations = new Map(sourceLexicalNamespace.layerDeclarations.map((declaration) => [
    declaration.statementId,
    declaration
  ]));
  const declarations = (document?.sourceLayerDeclarations ?? sourceLexicalNamespace.layerDeclarations.map((declaration) => ({
    identity: declaration.statementId,
    name: declaration.name
  }))).map((declaration) => {
    const lexicalDeclaration = namespaceDeclarations.get(declaration.identity);
    return {
      identity: declaration.identity,
      name: declaration.name,
      ownerPath: lexicalDeclaration
        ? ownerPathFor(lexicalDeclaration.scopeId, sourceLexicalNamespace, statements)
        : []
    };
  });

  const lexicalMemberships = membershipProjectionFor(sourceLexicalNamespace);
  const membershipsBySourceStatementId = document?.sourceLayerMembershipsBySourceStatementId
    ? [...document.sourceLayerMembershipsBySourceStatementId.entries()].map(([statementId, membership]) => [
        statementId,
        { layerIdentity: membership.layerIdentity, layerName: membership.layerName }
      ] as const)
    : lexicalMemberships;
  const membershipsByElementId = document?.sourceLayerMembershipsByElementId
    ? [...document.sourceLayerMembershipsByElementId.entries()].map(([elementId, membership]) => [
        elementId,
        { layerIdentity: membership.layerIdentity, layerName: membership.layerName }
      ] as const)
    : [];

  return { documentId, declarations, membershipsBySourceStatementId, membershipsByElementId };
};

export const canvasLayerSourceDocumentForCompiled = (
  compiledDocument: CompiledDslDocument | undefined,
  fallbackDocumentId = "root"
): CanvasLayerSourceDocument | null => {
  if (!compiledDocument?.sourceLexicalNamespace) return null;
  return canvasLayerSourceDocumentFor({
    documentId: String(compiledDocument.moduleRuntimeContext?.rootDocumentId ?? fallbackDocumentId),
    sourceLexicalNamespace: compiledDocument.sourceLexicalNamespace,
    statements: compiledDocument.statements,
    document: compiledDocument.document
  });
};

const displayLabelsFor = (layers: readonly CanvasLayerRow[]): Map<string, string> => {
  const byName = new Map<string, CanvasLayerRow[]>();
  for (const layer of layers) byName.set(layer.name, [...(byName.get(layer.name) ?? []), layer]);
  const labels = new Map<string, string>();
  for (const [name, rows] of byName) {
    if (rows.length === 1) {
      labels.set(rows[0]!.id, name);
      continue;
    }
    for (const row of rows) {
      const owner = row.ownerPath.length ? row.ownerPath.join(" › ") : `Document ${row.documentId}`;
      labels.set(row.id, `${name} — ${owner}`);
    }
    const duplicateLabels = new Map<string, CanvasLayerRow[]>();
    for (const row of rows) {
      const label = labels.get(row.id)!;
      duplicateLabels.set(label, [...(duplicateLabels.get(label) ?? []), row]);
    }
    for (const duplicates of duplicateLabels.values()) {
      if (duplicates.length < 2) continue;
      for (const row of duplicates) labels.set(row.id, `${labels.get(row.id)} · ${row.documentId}`);
    }
  }
  return labels;
};

/**
 * Projects compiler-owned layer identities onto concrete Canvas drawables.
 * Module bodies resolve through source provenance; generated occurrences
 * inherit through the evaluator's generated-to-template rows.
 */
export const projectCanvasLayerPresentation = ({
  compiledDocument,
  sourceDocuments = [],
  moduleMaterialization,
  elements,
  evaluation,
  hiddenLayerIds = new Set<string>()
}: {
  compiledDocument?: CompiledDslDocument;
  sourceDocuments?: readonly CanvasLayerSourceDocument[];
  moduleMaterialization?: CanvasLayerMaterialization;
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  hiddenLayerIds?: ReadonlySet<string>;
}): CanvasLayerPresentation => {
  const rootDocumentId = String(
    moduleMaterialization?.rootDocumentId ?? compiledDocument?.moduleRuntimeContext?.rootDocumentId ?? "root"
  );
  const rootSourceDocument = canvasLayerSourceDocumentForCompiled(compiledDocument, rootDocumentId);
  const documents = new Map<string, CanvasLayerSourceDocument>();
  for (const sourceDocument of [...sourceDocuments, ...(rootSourceDocument ? [rootSourceDocument] : [])]) {
    documents.set(sourceDocument.documentId, sourceDocument);
  }
  const layers: CanvasLayerRow[] = [{
    id: DEFAULT_SOURCE_LAYER_ID,
    identity: DEFAULT_SOURCE_LAYER_ID,
    documentId: "builtin",
    name: "default",
    label: "default",
    ownerPath: [],
    isDefault: true
  }];
  const membershipBySourceIdentity = new Map<string, string>();
  const directMembershipByElementId = new Map<ElementId, string>();
  for (const sourceDocument of documents.values()) {
    for (const declaration of sourceDocument.declarations) {
      layers.push({
        id: layerIdFor(sourceDocument.documentId, declaration.identity),
        identity: declaration.identity,
        documentId: sourceDocument.documentId,
        name: declaration.name,
        label: declaration.name,
        ownerPath: declaration.ownerPath,
        isDefault: false
      });
    }
    for (const [sourceStatementId, membership] of sourceDocument.membershipsBySourceStatementId) {
      membershipBySourceIdentity.set(
        JSON.stringify([sourceDocument.documentId, sourceStatementId]),
        layerIdFor(sourceDocument.documentId, membership.layerIdentity)
      );
    }
    for (const [elementId, membership] of sourceDocument.membershipsByElementId) {
      directMembershipByElementId.set(elementId, layerIdFor(sourceDocument.documentId, membership.layerIdentity));
    }
  }
  const labels = displayLabelsFor(layers);
  const rows = layers.map((layer) => ({ ...layer, label: labels.get(layer.id) ?? layer.name }));

  const layerIdByElementId = new Map<ElementId, string>(directMembershipByElementId);
  const unmappedModuleDrawableIds = new Set<ElementId>();
  const drawableRuntimeIds = new Set(elements
    .filter((element) => !isContainerElement(element) && !runtimeOnlyElementTypes.has(element.type))
    .map((element) => element.id));
  for (const [elementId, origin] of moduleMaterialization?.originByRuntimeElementId ?? []) {
    if (origin.kind !== "moduleBody") continue;
    const sourceDocumentId = String(origin.sourceDocumentId ?? moduleMaterialization?.rootDocumentId ?? rootDocumentId);
    const layerId = membershipBySourceIdentity.get(JSON.stringify([sourceDocumentId, origin.sourceStatementId]));
    if (layerId) layerIdByElementId.set(elementId, layerId);
    else if (drawableRuntimeIds.has(elementId)) unmappedModuleDrawableIds.add(elementId);
  }

  const generatedTemplateById = new Map<ElementId, ElementId>(
    (evaluation.forGroupGeneratedRows ?? []).map((row) => [row.generatedElementId, row.templateElementId])
  );
  const resolving = new Set<ElementId>();
  const resolveGeneratedLayer = (elementId: ElementId): string | null => {
    const known = layerIdByElementId.get(elementId);
    if (known) return known;
    if (unmappedModuleDrawableIds.has(elementId) || resolving.has(elementId)) return null;
    const templateId = generatedTemplateById.get(elementId);
    if (!templateId) return null;
    resolving.add(elementId);
    const inherited = resolveGeneratedLayer(templateId);
    resolving.delete(elementId);
    if (inherited) layerIdByElementId.set(elementId, inherited);
    else if (unmappedModuleDrawableIds.has(templateId)) unmappedModuleDrawableIds.add(elementId);
    return inherited;
  };
  for (const generatedId of generatedTemplateById.keys()) resolveGeneratedLayer(generatedId);

  return { layers: rows, hiddenLayerIds: new Set(hiddenLayerIds), layerIdByElementId, unmappedModuleDrawableIds };
};

export const canvasLayerVisibleElementIds = (
  elementIds: ReadonlySet<ElementId>,
  presentation?: CanvasLayerPresentation
): Set<ElementId> => {
  if (!presentation) return new Set(elementIds);
  return new Set([...elementIds].filter((elementId) => {
    if (presentation.unmappedModuleDrawableIds.has(elementId)) return false;
    const layerId = presentation.layerIdByElementId.get(elementId);
    return layerId === undefined || !presentation.hiddenLayerIds.has(layerId);
  }));
};
