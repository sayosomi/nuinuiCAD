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

export type CanvasLayerDeclaration = {
  identity: string;
  name: string;
  ownerPath: readonly string[];
};

export type CanvasLayerRow = {
  /** Exact source layer name projected to one transient Canvas toggle. */
  id: string;
  name: string;
  label: string;
  isDefault: boolean;
};

export type CanvasLayerMembership = {
  layerIdentity: string;
  layerName: string;
};

/** Serializable compiler projection for one source document in a Module graph. */
export type CanvasLayerSourceDocument = {
  documentId: string;
  declarations: readonly CanvasLayerDeclaration[];
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

/** Stable Canvas view key. Lexical declaration identities remain source-qualified separately. */
export const canvasLayerVisibilityKeyForName = (name: string): string =>
  name === "default" ? DEFAULT_SOURCE_LAYER_ID : `canvas-layer-name:${JSON.stringify(name)}`;

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
  const layerByName = new Map<string, CanvasLayerRow>([["default", {
    id: DEFAULT_SOURCE_LAYER_ID,
    name: "default",
    label: "default",
    isDefault: true
  }]]);
  const membershipBySourceIdentity = new Map<string, string>();
  const directMembershipByElementId = new Map<ElementId, string>();
  for (const sourceDocument of documents.values()) {
    for (const declaration of sourceDocument.declarations) {
      if (!layerByName.has(declaration.name)) {
        layerByName.set(declaration.name, {
          id: canvasLayerVisibilityKeyForName(declaration.name),
          name: declaration.name,
          label: declaration.name,
          isDefault: false
        });
      }
    }
    for (const [sourceStatementId, membership] of sourceDocument.membershipsBySourceStatementId) {
      membershipBySourceIdentity.set(
        JSON.stringify([sourceDocument.documentId, sourceStatementId]),
        canvasLayerVisibilityKeyForName(membership.layerName)
      );
    }
    for (const [elementId, membership] of sourceDocument.membershipsByElementId) {
      directMembershipByElementId.set(elementId, canvasLayerVisibilityKeyForName(membership.layerName));
    }
  }
  const rows = [...layerByName.values()];

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
